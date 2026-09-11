import type { SubtitleSegment } from '../types';

const finiteTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Remove only segments that Whisper itself marks as both silence and low confidence. */
export function filterLowConfidenceWhisperSegments(segments: SubtitleSegment[]) {
  return segments.filter((segment) => {
    const noSpeech = segment.no_speech_prob;
    const logProbability = segment.avg_logprob;
    if (!finiteTimestamp(noSpeech) || !finiteTimestamp(logProbability)) return true;
    return !(noSpeech > 0.6 && logProbability < -1);
  });
}

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
export function groupOcrResults(results: Array<{ text: string; timestampMs: number }>, filterWatermark: boolean, frameIntervalMs = 500) {
  const samples = results
    .map((item) => ({ ...item, text: item.text.replace(/\r?\n/g, ' ').trim(), normalized: normalize(item.text) }))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const nonEmpty = samples.filter((item) => item.normalized);
  const appearances = new Map<string, { count: number; firstMs: number; lastMs: number }>();
  nonEmpty.forEach((item) => {
    const current = appearances.get(item.normalized);
    appearances.set(item.normalized, current
      ? { count: current.count + 1, firstMs: current.firstMs, lastMs: item.timestampMs }
      : { count: 1, firstMs: item.timestampMs, lastMs: item.timestampMs });
  });
  const timelineSpan = Math.max(frameIntervalMs, (samples.at(-1)?.timestampMs || 0) - (samples[0]?.timestampMs || 0) + frameIntervalMs);
  const isWatermark = (item: (typeof samples)[number]) => {
    if (!filterWatermark || !item.normalized || samples.length < 10) return false;
    const appearance = appearances.get(item.normalized);
    return Boolean(appearance
      && appearance.count / samples.length >= 0.8
      && appearance.lastMs - appearance.firstMs >= Math.max(3000, timelineSpan * 0.7));
  };
  const groups: Array<{ text: string; startMs: number; endMs: number; candidates: Map<string, { text: string; count: number }> }> = [];
  let active: (typeof groups)[number] | undefined;
  for (const item of samples) {
    if (!item.normalized || isWatermark(item)) {
      if (active) active.endMs = Math.max(active.endMs, item.timestampMs - frameIntervalMs);
      active = undefined;
      continue;
    }
    if (active && similarity(normalize(active.text), item.normalized) > .82 && item.timestampMs - active.endMs < 3000) {
      active.endMs = item.timestampMs;
      const candidate = active.candidates.get(item.normalized);
      active.candidates.set(item.normalized, candidate ? { ...candidate, count: candidate.count + 1 } : { text: item.text, count: 1 });
      const best = [...active.candidates.values()].sort((a, b) => b.count - a.count || b.text.length - a.text.length)[0];
      if (best) active.text = best.text;
      continue;
    }
    if (active) active.endMs = Math.max(active.endMs, item.timestampMs - frameIntervalMs);
    active = { text: item.text, startMs: item.timestampMs, endMs: item.timestampMs, candidates: new Map([[item.normalized, { text: item.text, count: 1 }]]) };
    groups.push(active);
  }
  return groups.map((group, index) => ({ id: `ocr-${index + 1}-${Date.now()}`, index: index + 1, startMs: group.startMs, endMs: Math.max(group.startMs + frameIntervalMs, group.endMs + frameIntervalMs), originalText: group.text, translatedText: '', voiceGroup: 'G1' as const, enabled: true }));
}
export function hasSignificantFrameChange(previous: Buffer | undefined, current: Buffer, threshold = 0.08) { if (!previous) return true; const samples = 512; let changed = 0; for (let index = 0; index < samples; index += 1) { const currentIndex = Math.floor((index / samples) * current.length); const previousIndex = Math.floor((index / samples) * previous.length); if (Math.abs((current[currentIndex] || 0) - (previous[previousIndex] || 0)) > 14) changed += 1; } return changed / samples >= threshold; }
