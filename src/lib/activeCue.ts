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

const latestCue = (cues: SubtitleCue[]) => cues.reduce<SubtitleCue | undefined>((best, cue) => {
  if (!best) return cue;
  if (cue.startMs !== best.startMs) return cue.startMs > best.startMs ? cue : best;
  return cue.index >= best.index ? cue : best;
}, undefined);

export function filterPreviewActiveCues(cues: SubtitleCue[]): SubtitleCue[] {
  const manualText = cues.filter((cue) => cue.sourceKind === 'onscreen-text' && cue.textOrigin === 'manual');
  const latestOcrText = latestCue(cues.filter((cue) => cue.sourceKind === 'onscreen-text' && cue.textOrigin !== 'manual'));
  const latestSubtitle = latestCue(cues.filter((cue) => cue.sourceKind !== 'onscreen-text'));
  const keep = new Set([
    ...manualText.map((cue) => cue.id),
    latestOcrText?.id,
    latestSubtitle?.id,
  ].filter(Boolean));
  return cues.filter((cue) => keep.has(cue.id));
}

export function findPreviewActiveCue(index: ActiveCueIndex, timeMs: number): SubtitleCue | undefined {
  const active = filterPreviewActiveCues(findActiveCues(index, timeMs));
  return latestCue(active.filter((cue) => cue.sourceKind !== 'onscreen-text'))
    || latestCue(active.filter((cue) => cue.sourceKind === 'onscreen-text' && cue.textOrigin !== 'manual'))
    || active.at(-1);
}

export function findActiveCue(index: ActiveCueIndex, timeMs: number): SubtitleCue | undefined {
  return findActiveCues(index, timeMs).at(-1);
}

export function findActiveCues(index: ActiveCueIndex, timeMs: number): SubtitleCue[] {
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

  const active: SubtitleCue[] = [];
  for (let position = candidate; position >= 0; position -= 1) {
    if ((index.maxEndMs[position] ?? Number.NEGATIVE_INFINITY) <= timeMs) break;
    const cue = index.cues[position];
    if (cue && timeMs < cue.endMs) active.push(cue);
  }

  return active.reverse();
}
