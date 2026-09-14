import assert from 'node:assert/strict';
import test from 'node:test';
import { ASS_CSS_PIXEL_SCALE, cuesForDubbingTimeline, cuesToAss, cuesToSrt, cuesWithDubbingTimelineMetadata, isDubbableSubtitleCue, repairRunawayOcrCueEnds } from './subtitles';
import { defaultStyle, type SubtitleCue } from '../types';

const cue: SubtitleCue = {
  id: 'cue-1',
  index: 1,
  startMs: 0,
  endMs: 1000,
  originalText: 'Original',
  translatedText: 'Bản dịch',
  enabled: true,
  voiceGroup: 'G1',
};

test('ASS export only applies the text outline in outline mode', () => {
  const boxed = cuesToAss([cue], { ...defaultStyle, background: 'box', outlineWidth: 8 });
  const outlined = cuesToAss([cue], { ...defaultStyle, background: 'outline', outlineWidth: 8 });

  assert.match(boxed, /Style: Box,.*?,1,0,0,2,154,154,108,1/);
  assert.match(boxed, /\\p1\\bord0\\shad0/);
  assert.match(outlined, /Style: Outline,.*?,1,10\.7,0,2,154,154,108,1/);
});

test('per-cue outline width matches the value shown in preview', () => {
  const ass = cuesToAss([{ ...cue, sourceKind: 'onscreen-text', styleOverrides: { outlineWidth: 6 } }], { ...defaultStyle, background: 'outline', outlineWidth: 2 });
  assert.match(ass, /\\bord8}/);
});

test('ASS boxed subtitles preserve configurable horizontal and vertical padding', () => {
  const ass = cuesToAss([cue], { ...defaultStyle, background: 'box', boxPaddingX: 14, boxPaddingY: 6 });
  assert.match(ass, /m 0 0 l 168 0 l 168 50 l 0 50/);
});

test('ASS boxed subtitles export their background color, opacity, and border', () => {
  const ass = cuesToAss([cue], {
    ...defaultStyle,
    background: 'box',
    backgroundColor: '#80a800',
    backgroundOpacity: 0.9,
    boxPaddingX: 12,
    boxPaddingY: 5,
    boxBorderColor: '#ffffff',
    boxBorderWidth: 3,
  });
  assert.match(ass, /\\1c&H0000A880\\1a&H19&/);
  assert.match(ass, /\\1c&H00FFFFFF\\1a&H00&/);
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, 3);
});

test('ASS export honors a per-cue background mode instead of the global mode', () => {
  const ass = cuesToAss([{ ...cue, sourceKind: 'onscreen-text', styleOverrides: { background: 'box', backgroundColor: '#123456' } }], defaultStyle);
  assert.match(ass, /^Dialogue: .*?,Box,/m);
  assert.match(ass, /\\1c&H00563412\\1a&H47&/);
});

test('ASS export preserves an individual cue canvas position', () => {
  const ass = cuesToAss([{ ...cue, sourceKind: 'onscreen-text', screenPosition: { xPercent: 25, yPercent: 40 } }], defaultStyle);
  assert.match(ass, /\\an5\\pos\(480,432\)/);
});

test('subtitle cues always use the shared font and position', () => {
  const ass = cuesToAss([{ ...cue, sourceKind: 'subtitle', screenPosition: { xPercent: 25, yPercent: 40 }, styleOverrides: { fontFamily: 'Courier New', fontSize: 70 } }], { ...defaultStyle, fontFamily: 'Arial', fontSize: 34, position: 'bottom' });
  assert.match(ass, /\\fnArial\\fs45\.3/);
  assert.match(ass, /\\an5\\pos\(960,886\)/);
  assert.doesNotMatch(ass, /Courier New|pos\(480,432\)/);
});

test('ASS export converts CSS font pixels and uses the same default canvas position as preview', () => {
  const ass = cuesToAss([cue], { ...defaultStyle, fontSize: 48, position: 'bottom' });
  assert.equal(ASS_CSS_PIXEL_SCALE, 4 / 3);
  assert.match(ass, /\\fs64/);
  assert.match(ass, /\\an5\\pos\(960,886\)/);
});

test('repairs persisted OCR cues that incorrectly share one video-long end time', () => {
  const source = [
    { ...cue, id: 'ocr-1-old', startMs: 1_000, endMs: 20_000 },
    { ...cue, id: 'ocr-2-old', startMs: 2_000, endMs: 20_000 },
    { ...cue, id: 'ocr-3-old', startMs: 3_000, endMs: 20_000 },
    { ...cue, id: 'ocr-4-old', startMs: 4_000, endMs: 5_000 },
  ];
  const repaired = repairRunawayOcrCueEnds(source);
  assert.deepEqual(repaired.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 1_000, endMs: 2_000 },
    { startMs: 2_000, endMs: 3_000 },
    { startMs: 3_000, endMs: 4_000 },
    { startMs: 4_000, endMs: 5_000 },
  ]);
});

test('ASS export gives the upper editor track the higher render layer', () => {
  const ass = cuesToAss([
    { ...cue, id: 'upper', originalText: 'Upper', translatedText: '', timelineLane: 0 },
    { ...cue, id: 'lower', originalText: 'Lower', translatedText: '', timelineLane: 1 },
  ], defaultStyle);
  assert.match(ass, /Dialogue: 11,.*Upper/);
  assert.match(ass, /Dialogue: 7,.*Lower/);
});

test('ASS boxed subtitles render rounded corners as vector curves', () => {
  const ass = cuesToAss([cue], { ...defaultStyle, background: 'box', boxBorderRadius: 12 });
  assert.match(ass, /\\p1.*m 12 0.*b .*\\p0/);
});

test('dubbing accepts subtitles but rejects OCR screen text', () => {
  assert.equal(isDubbableSubtitleCue({ ...cue, sourceKind: 'subtitle' }), true);
  assert.equal(isDubbableSubtitleCue({ ...cue, sourceKind: 'onscreen-text' }), false);
});

test('ASS export does not enable bold or italic for persisted string flags', () => {
  const ass = cuesToAss([cue], {
    ...defaultStyle,
    bold: 'false' as unknown as boolean,
    italic: 'false' as unknown as boolean,
  });

  assert.match(ass, /,0,0,0,0,100,100,0,0,1,2\.7,0,2,154/);
});

test('ASS both-content mode does not duplicate identical source and translation', () => {
  const ass = cuesToAss([{ ...cue, originalText: 'Giống nhau', translatedText: 'Giống nhau' }], { ...defaultStyle, content: 'both' });
  assert.match(ass, /}Giống nhau$/m);
  assert.doesNotMatch(ass, /Giống nhau\\NGiống nhau/);
});

test('SRT export trims an overlapping cue end to the next cue start without mutating timeline cues', () => {
  const first = { ...cue, endMs: 1_400 };
  const second = { ...cue, id: 'cue-2', index: 2, startMs: 1_000, endMs: 2_000, originalText: 'Next' };

  const srt = cuesToSrt([first, second]);

  assert.match(srt, /00:00:00,000 --> 00:00:01,000/);
  assert.equal(first.endMs, 1_400);
  assert.equal(second.startMs, 1_000);
});

test('SRT timeline export uses slowed dubbing timestamps without mutating source cues', () => {
  const source = { ...cue, startMs: 1_000, endMs: 2_000, dubbing: { cueId: cue.id, originalText: cue.originalText, translatedText: cue.translatedText, finalDubbingText: cue.translatedText, originalDurationMs: 1_000, targetDurationMs: 1_000, ttsDurationMs: 1_500, finalAudioDurationMs: 1_500, rewriteAttempts: 0, speedApplied: 1, extensionMs: 0, timelineStartMs: 1_200, timelineEndMs: 2_700, timelineShiftMs: 200 } };
  const retimed = cuesForDubbingTimeline([source], true);
  assert.equal(retimed[0]?.startMs, 1_200);
  assert.equal(retimed[0]?.endMs, 2_700);
  assert.equal(source.startMs, 1_000);
  assert.match(cuesToSrt(retimed, true), /00:00:01,200 --> 00:00:02,700/);
});

test('timeline metadata falls back to cue order when imported SRT regenerated cue ids', () => {
  const metadata = [{ cueId: 'old-id', originalText: cue.originalText, translatedText: cue.translatedText, finalDubbingText: cue.translatedText, originalDurationMs: 1_000, targetDurationMs: 1_000, ttsDurationMs: 1_500, finalAudioDurationMs: 1_500, rewriteAttempts: 0, speedApplied: 1, extensionMs: 0, timelineStartMs: 200, timelineEndMs: 1_700, timelineShiftMs: 200 }];
  const imported = [{ ...cue, id: 'new-id' }];
  const merged = cuesWithDubbingTimelineMetadata(imported, metadata);
  assert.equal(merged[0]?.dubbing?.cueId, 'old-id');
  assert.equal(cuesForDubbingTimeline(merged, true)[0]?.endMs, 1_700);
});
