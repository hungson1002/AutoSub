import type { SubtitleSegment } from '../types';

const finiteTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Add a chunk's absolute offset without deriving timestamps from adjacent speech. */
export function offsetSubtitleSegments(segments: SubtitleSegment[], offsetSeconds: number) {
  const offset = finiteTimestamp(offsetSeconds) ? offsetSeconds : 0;
  return segments.map((segment) => ({
    ...segment,
    ...(finiteTimestamp(segment.start) ? { start: segment.start + offset } : {}),
    ...(finiteTimestamp(segment.end) ? { end: segment.end + offset } : {}),
    ...(Array.isArray(segment.words) ? {
      words: segment.words.map((word) => ({
        ...word,
        ...(finiteTimestamp(word.start) ? { start: word.start + offset } : {}),
        ...(finiteTimestamp(word.end) ? { end: word.end + offset } : {}),
        ...(finiteTimestamp(word.startMs) ? { startMs: word.startMs + offset * 1000 } : {}),
        ...(finiteTimestamp(word.endMs) ? { endMs: word.endMs + offset * 1000 } : {}),
      })),
    } : {}),
  }));
}

/**
 * Repair overlaps without touching intentional gaps. A later cue that crosses
 * the previous end is shifted forward; a cue fully nested in the previous cue
 * keeps its own provider timestamps and clips the previous cue at its start.
 */
export function normalizeCueTimeline<T extends { startMs: number; endMs: number }>(cues: T[]) {
  const normalized: T[] = [];
  for (const cue of cues) {
    const previous = normalized.at(-1);
    if (!previous || cue.startMs >= previous.endMs) {
      normalized.push({ ...cue });
      continue;
    }
    if (cue.endMs > previous.endMs) {
      normalized.push({ ...cue, startMs: previous.endMs });
      continue;
    }
    if (cue.startMs > previous.startMs && cue.endMs > cue.startMs) {
      previous.endMs = cue.startMs;
      normalized.push({ ...cue });
    } else {
      // Keep malformed/out-of-order entries intact so cue indexes and
      // alignment metadata remain one-to-one; the editor resolves ties by
      // choosing the latest-starting active cue.
      normalized.push({ ...cue });
    }
  }
  return normalized;
}

export function segmentsToCues(segments: SubtitleSegment[]) {
  const cues = segments
    .filter((segment) => typeof segment.text === 'string' && segment.text.trim())
    .map((segment, index) => {
      const start = finiteTimestamp(segment.start) ? segment.start : 0;
      const end = finiteTimestamp(segment.end) ? segment.end : start + 2;
      return {
        id: `stt-${index + 1}-${Date.now()}`,
        index: index + 1,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        originalText: segment.text?.trim() || '',
        translatedText: '',
        voiceGroup: 'G1' as const,
        enabled: true,
        ...(Array.isArray(segment.words) && segment.words.length ? { words: segment.words } : {}),
      };
    });
  return normalizeCueTimeline(cues);
}
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
const similarity = (a: string, b: string) => { if (a === b) return 1; const aa = new Set(a.split('')); const bb = new Set(b.split('')); const intersection = [...aa].filter((char) => bb.has(char)).length; return intersection / Math.max(aa.size, bb.size, 1); };
export function groupOcrResults(results: Array<{ text: string; timestampMs: number }>, filterWatermark: boolean) { const normalized = results.map((item) => ({ ...item, text: item.text.replace(/\r?\n/g, ' ').trim(), normalized: normalize(item.text) })).filter((item) => item.normalized); const counts = new Map<string, number>(); normalized.forEach((item) => counts.set(item.normalized, (counts.get(item.normalized) || 0) + 1)); const filtered = filterWatermark ? normalized.filter((item) => (counts.get(item.normalized) || 0) < normalized.length * 0.8) : normalized; const groups: Array<{ text: string; startMs: number; endMs: number }> = []; for (const item of filtered) { const last = groups.at(-1); if (last && similarity(normalize(last.text), item.normalized) > .82 && item.timestampMs - last.endMs < 3000) last.endMs = item.timestampMs; else groups.push({ text: item.text, startMs: item.timestampMs, endMs: item.timestampMs }); } return groups.map((group, index) => ({ id: `ocr-${index + 1}-${Date.now()}`, index: index + 1, startMs: group.startMs, endMs: group.endMs + 600, originalText: group.text, translatedText: '', voiceGroup: 'G1' as const, enabled: true })); }
export function hasSignificantFrameChange(previous: Buffer | undefined, current: Buffer, threshold = 0.08) { if (!previous) return true; const samples = 512; let changed = 0; for (let index = 0; index < samples; index += 1) { const currentIndex = Math.floor((index / samples) * current.length); const previousIndex = Math.floor((index / samples) * previous.length); if (Math.abs((current[currentIndex] || 0) - (previous[previousIndex] || 0)) > 14) changed += 1; } return changed / samples >= threshold; }
