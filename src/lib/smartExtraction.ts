import type { SubtitleCue } from '../types';

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const overlapMs = (a: SubtitleCue, b: SubtitleCue) => Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

/** Keep the audio transcript as timing truth and add only useful, non-duplicate OCR cues. */
export function mergeSmartExtractionCues(stt: SubtitleCue[], ocr: SubtitleCue[]) {
  const merged: SubtitleCue[] = stt.map((cue) => ({ ...cue, sourceKind: cue.sourceKind || 'subtitle' }));
  for (const candidate of ocr) {
    const text = normalize(candidate.originalText);
    if (!text) continue;
    const duplicate = merged.some((cue) => {
      if (!overlapMs(cue, candidate)) return false;
      const other = normalize(cue.originalText);
      return text === other || text.includes(other) || other.includes(text);
    });
    if (!duplicate) merged.push({ ...candidate });
  }
  return merged
    .sort((a, b) => a.startMs - b.startMs || Number(b.sourceKind === 'onscreen-text') - Number(a.sourceKind === 'onscreen-text') || a.endMs - b.endMs)
    .map((cue, index) => ({ ...cue, index: index + 1 }));
}
