# Front-end diagnostic report

> Generation time: 2026-08-29 09:20
> Question type: runtime/UI
> Scope of influence: Editor dubbing preview when “Giữ giọng 1.00x, làm chậm video theo cue” is enabled

## Problem description

- The completed dubbing job kept TTS at 1.00x, but the Editor preview still played source video at normal speed.
- A rendered 4:3 source did not visually match the 16:9 preview canvas; subtitle text appeared twice with a heavier outline and blur regions shifted relative to the picture.

## Reproduction path

1. Enable slow-video dubbing and create a dub track.
2. Play the dubbed preview in Editor.
3. Long cues keep source-video speed instead of slowing to the measured speech duration.

## Evidence collected

- Latest job `dub-1787969208062-dbb5a87c` is completed with 57/57 cues and `slowVideoToMatchSpeech: true`.
- Its metadata contains natural TTS durations and timeline offsets.
- `VideoPlayer` previously synchronized dub audio directly to `video.currentTime` and copied video playback rate to the dub audio.
- Video retiming existed only in the FFmpeg export route.
- A later job had 0/57 slowed cues because expanded dubbing timestamps had been written back into canonical subtitle cues and then reused as source timing.
- The export at 10% was an `h264_amf` benchmark process that had remained alive since 09:20 without a timeout.
- A later export reached the UI's 96% cap but kept encoding indefinitely: its looping logo input and padded audio were both unbounded, while the command had no explicit output duration.
- The generated ASS contained `text\\Ntext` inside each Dialogue when source and translation were identical.
- Preview forced “Original” video into a 16:9 coordinate canvas although the source and output were 1440×1080 (4:3).
- ASS used the full UI outline value even though libass expands strokes more heavily than CSS text-stroke.

## Hypothesis and Verification

| Hypothesis | Verification Method | Results |
| --- | --- | --- |
| The option was not saved in the job | Inspect latest `job.json` | Falsified |
| The job lacks timing metadata | Inspect result metadata | Falsified |
| Preview never consumes retiming metadata | Trace `VideoPlayer` time/rate synchronization | Confirmed |

## Root cause

- The export path implemented cue-based video retiming, but the browser preview continued to treat source-video time as dubbing timeline time and never changed `HTMLVideoElement.playbackRate` per cue.
- Expanded dubbing timestamps were fed into later jobs as source timestamps, eliminating every calculated extension.
- Hardware encoder selection could wait indefinitely when the AMD driver accepted the process but produced no output.
- `-shortest` was insufficient when filter inputs were intentionally infinite, so FFmpeg never finalized the MP4.
- Preview and export used different aspect-ratio coordinate systems, while duplicate ASS content and stroke scaling caused the subtitle mismatch.

## Fix content

- Pass the job retiming flag into `VideoPlayer`.
- Map source-video time to the expanded dubbing timeline and back for playback and seeking.
- Apply cue-specific video playback rates while keeping dub audio at 1.00x.
- Include accumulated cue extensions in the preview duration.
- Keep subtitle source timestamps canonical and apply expanded timestamps only in preview/export views.
- Abort encoder benchmarks after 8 seconds and fall back to `libx264`.
- Pass a hard `-t` equal to source duration plus retime extensions, and calculate progress against that same duration.
- Use the actual source aspect ratio for the “Original” preview canvas so blur/logo/subtitle percentages match FFmpeg.
- Deduplicate identical source/translated content in ASS and halve libass outline scaling to match CSS weight.

## Verification results

- `npx tsc -b` passes.
- Latest persisted job provides the flag and metadata required by the new preview path.
- A minimal FFmpeg reproduction with padded audio now exits successfully at the explicit duration.
- Subtitle export tests pass 4/4, including identical bilingual-content deduplication and outline scaling.

## Residual risk

- Browser playback rate is clamped at 0.0625 for exceptionally long speech cues.

## Next step

- Reload Editor and play the existing completed dub job; no job regeneration is required.
