export interface AnimationCaptionTiming {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  source: 'sentence-proportional';
}

export interface AnimationBeatWindow {
  startMs: number;
  endMs: number;
  source: 'narration-cue' | 'even-fallback';
}

const punctuation = /[.!?…]+$/u;

/** Split narration at natural sentence boundaries without rewriting the source text. */
export function splitNarrationUnits(text: string) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];
  const units: string[] = [];
  let start = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1] || '';
    const boundary = /[.!?…;]/u.test(character) && (!next || /\s/u.test(next));
    if (boundary) {
      const unit = normalized.slice(start, index + 1).trim();
      if (unit) units.push(unit);
      start = index + 1;
    }
  }
  const remainder = normalized.slice(start).trim();
  if (remainder) units.push(remainder);
  return units.length ? units : [normalized];
}

function contentWeight(value: string) {
  const letters = value.replace(/[^\p{L}\p{N}]/gu, '');
  return Math.max(1, letters.length);
}

/**
 * Allocate sentence-level captions from the measured audio duration.
 * This is deliberately sentence-level: it must not be presented as word alignment.
 */
export function allocateNarrationTimings(text: string, durationMs: number, idPrefix = 'narration'): AnimationCaptionTiming[] {
  const rawUnits = splitNarrationUnits(text);
  const duration = Math.max(1, Math.round(Number(durationMs) || 0));
  // Keep every range positive and inside the scene even when a malformed or
  // very short fixture has more sentences than milliseconds. The final range
  // absorbs the remainder instead of leaking past the scene boundary.
  const units = rawUnits.length > duration
    ? [...rawUnits.slice(0, Math.max(0, duration - 1)), rawUnits.slice(Math.max(0, duration - 1)).join(' ')]
    : rawUnits;
  const totalWeight = Math.max(1, units.reduce((total, unit) => total + contentWeight(unit), 0));
  let cursor = 0;
  return units.map((unit, index) => {
    const startMs = cursor;
    const allocated = index === units.length - 1 ? duration : Math.round(duration * (units.slice(0, index + 1).reduce((total, item) => total + contentWeight(item), 0) / totalWeight));
    cursor = Math.min(duration, Math.max(startMs + 1, allocated));
    return { id: `${idPrefix}-${index + 1}`, text: unit, startMs, endMs: cursor, source: 'sentence-proportional' as const };
  });
}

function findOccurrence(text: string, cue: string, occurrence: number) {
  if (!cue) return -1;
  let from = 0;
  for (let count = 0; count <= occurrence; count += 1) {
    const found = text.indexOf(cue, from);
    if (found < 0) return -1;
    if (count === occurrence) return found;
    from = found + Math.max(1, cue.length);
  }
  return -1;
}

/**
 * Give each visual beat a cue-anchored window when the director supplied an exact
 * narration quote. Missing/invalid quotes intentionally use an even fallback.
 */
export function buildAnimationBeatWindows(input: { beats: Array<{ narrationCue?: string }>; narration?: string; durationMs: number }): AnimationBeatWindow[] {
  const { beats, narration = '' } = input;
  const duration = Math.max(1, Math.round(Number(input.durationMs) || 0));
  if (!beats.length) return [];
  const occurrences = new Map<string, number>();
  const matches = beats.map((beat, index) => {
    const cue = beat.narrationCue?.trim() || '';
    if (!cue || !narration) return { index, position: -1, length: 0 };
    const occurrence = occurrences.get(cue) || 0;
    occurrences.set(cue, occurrence + 1);
    return { index, position: findOccurrence(narration, cue, occurrence), length: cue.length };
  });
  // Partial or out-of-order cue sets cannot safely mix cue windows with
  // independently allocated fallback windows: that causes overlapping visuals.
  const ordered = matches.every((match, index) => match.position >= 0 && (index === 0 || match.position > matches[index - 1].position));
  const starts = beats.map((_beat, index) => index === 0 ? 0 : Math.round(duration * (ordered ? matches[index].position / Math.max(1, narration.length) : index / beats.length)));
  return starts.map((startMs, index) => ({
    startMs,
    endMs: index + 1 < starts.length ? starts[index + 1] : duration,
    source: ordered ? 'narration-cue' : 'even-fallback',
  }));
}

export function hasSentencePunctuation(value: string) {
  return punctuation.test(value.trim());
}

/** Piecewise remapping keeps sentence boundaries anchored after voice changes. */
export function createSentenceTimeMapper(before: Array<{ startMs: number; endMs: number }>, after: Array<{ startMs: number; endMs: number }>, oldDuration: number, newDuration: number) {
  return (time: number) => {
    if (time <= 0) return 0;
    if (time >= oldDuration) return newDuration;
    const index = before.findIndex((unit) => time >= unit.startMs && time < unit.endMs);
    const previous = before[index];
    const next = after[index];
    if (!previous || !next || before.length !== after.length) return Math.min(newDuration, Math.max(0, time / Math.max(1, oldDuration) * newDuration));
    return next.startMs + (time - previous.startMs) / Math.max(1, previous.endMs - previous.startMs) * (next.endMs - next.startMs);
  };
}
