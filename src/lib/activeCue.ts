import type { SubtitleCue } from '../types';

export type ActiveCueIndex = {
  cues: SubtitleCue[];
  maxEndMs: number[];
};

export function buildActiveCueIndex(cues: SubtitleCue[]): ActiveCueIndex {
  const enabled = cues
    .filter((cue) => cue.enabled && cue.endMs > cue.startMs)
    .slice()
    .sort((left, right) => left.startMs - right.startMs || left.index - right.index);
  const maxEndMs: number[] = [];
  let maxEnd = Number.NEGATIVE_INFINITY;

  for (const cue of enabled) {
    maxEnd = Math.max(maxEnd, cue.endMs);
    maxEndMs.push(maxEnd);
  }

  return { cues: enabled, maxEndMs };
}

export function findActiveCue(index: ActiveCueIndex, timeMs: number): SubtitleCue | undefined {
  let low = 0;
  let high = index.cues.length - 1;
  let candidate = -1;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const cue = index.cues[middle];
    if (cue && cue.startMs <= timeMs) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  for (let position = candidate; position >= 0; position -= 1) {
    if ((index.maxEndMs[position] ?? Number.NEGATIVE_INFINITY) <= timeMs) break;
    const cue = index.cues[position];
    if (cue && timeMs < cue.endMs) return cue;
  }

  return undefined;
}
