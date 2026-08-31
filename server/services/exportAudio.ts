export type ExportAudioFilterOptions = {
  hasDub: boolean;
  dubInputIndex?: number;
  backgroundInputIndex?: number;
  keepAudio: boolean;
  originalVolume?: number;
  jobDubIncludesBackground?: boolean;
  originalInputLabel?: string;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const safeLimiter = "alimiter=limit=0.891:level=false,aresample=48000";
// Dubbing jobs are mastered once when their timeline is built. Re-running
// loudnorm here changes the voice a second time and can create pumping/noise.
const normalizeDub = "anull";

/**
 * Builds the final export audio graph.
 *
 * A dubbing job that used vocal separation already returns a track containing
 * the generated voice plus the separated background. Mixing input 0 again in
 * that case reintroduces the original dialogue and doubles the background.
 */
export function buildExportAudioFilter(options: ExportAudioFilterOptions) {
  const {
    hasDub,
    dubInputIndex,
    backgroundInputIndex,
    keepAudio,
    jobDubIncludesBackground = false,
    originalInputLabel = "0:a",
  } = options;

  if (hasDub) {
    if (dubInputIndex === undefined)
      throw new Error("Thiếu audio input của dub track.");
    if (jobDubIncludesBackground) {
      return `[${dubInputIndex}:a]${normalizeDub},${safeLimiter},apad[audioout]`;
    }
    if (backgroundInputIndex !== undefined) {
      const volume = clamp(
        Number(options.originalVolume ?? 0.35),
        0,
        1,
      ).toFixed(3);
      return `[${backgroundInputIndex}:a]volume=${volume}[background];[${dubInputIndex}:a]${normalizeDub}[dub];[background][dub]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,${safeLimiter},apad[audioout]`;
    }
    if (keepAudio) {
      const volume = clamp(
        Number(options.originalVolume ?? 0.25),
        0,
        1,
      ).toFixed(3);
      return `[${originalInputLabel}]volume=${volume}[original];[${dubInputIndex}:a]${normalizeDub}[dub];[original][dub]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,${safeLimiter},apad[audioout]`;
    }
    return `[${dubInputIndex}:a]${normalizeDub},${safeLimiter},apad[audioout]`;
  }

  if (backgroundInputIndex !== undefined)
    return `[${backgroundInputIndex}:a]anull[audioout]`;
  return keepAudio ? `[${originalInputLabel}]anull[audioout]` : "";
}

export type RetimeCue = { originalDurationMs: number; ttsDurationMs: number; timelineStartMs?: number; timelineShiftMs?: number };

export const retimedWindows = (metadata: RetimeCue[]) => {
  const candidates = metadata.flatMap((cue) => {
    const durationMs = Math.max(1, Number(cue.originalDurationMs) || 1);
    const speechMs = Math.max(1, Number(cue.ttsDurationMs) || 1);
    if (speechMs <= durationMs || !Number.isFinite(cue.timelineStartMs)) return [];
    const startMs = Math.max(0, Number(cue.timelineStartMs) - Number(cue.timelineShiftMs || 0));
    return [{ startMs, endMs: startMs + durationMs, scale: speechMs / durationMs }];
  }).sort((left, right) => left.startMs - right.startMs);
  let cursorMs = 0;
  return candidates.flatMap((cue) => {
    const startMs = Math.max(cursorMs, cue.startMs);
    const endMs = Math.max(startMs, cue.endMs);
    cursorMs = endMs;
    return endMs > startMs ? [{ startMs, endMs, scale: cue.scale }] : [];
  });
};

export const retimedDurationMs = (sourceDurationMs: number, metadata: RetimeCue[]) =>
  Math.max(1, sourceDurationMs) + retimedWindows(metadata).reduce(
    (total, cue) => total + (cue.endMs - cue.startMs) * (cue.scale - 1),
    0,
  );

const atempoChain = (rate: number) => {
  const filters: string[] = [];
  let remaining = Math.max(0.0625, Math.min(1, rate));
  while (remaining < 0.5) { filters.push("atempo=0.5"); remaining /= 0.5; }
  if (Math.abs(remaining - 1) > 0.0005) filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(",") || "anull";
};

export function buildRetimedSourceAudioFilter(metadata: RetimeCue[], input = "0:a", output = "retimedOriginal", targetDurationMs?: number) {
  const slowed = retimedWindows(metadata).map((cue) => ({ ...cue, rate: 1 / cue.scale }));
  const finish = (source: string) => Number.isFinite(targetDurationMs) && Number(targetDurationMs) > 0
    ? `${source}apad,atrim=end=${(Number(targetDurationMs) / 1000).toFixed(6)}[${output}]`
    : `${source}anull[${output}]`;
  if (!slowed.length) return finish(`[${input}]`);

  const segments: Array<{ startMs: number; endMs?: number; rate: number }> = [];
  let cursorMs = 0;
  for (const cue of slowed) {
    const { startMs, endMs } = cue;
    if (startMs > cursorMs) segments.push({ startMs: cursorMs, endMs: startMs, rate: 1 });
    if (endMs > startMs) segments.push({ startMs, endMs, rate: cue.rate });
    cursorMs = endMs;
  }
  segments.push({ startMs: cursorMs, rate: 1 });
  const timestamps = segments.slice(0, -1).map((segment) => ((segment.endMs || 0) / 1000).toFixed(6)).join("|");
  const inputs = segments.map((_segment, index) => `[retimeSrc${index}]`).join("");
  const parts = segments.map((_segment, index) => `[retimePart${index}]`).join("");
  // asegment consumes the source once and emits consecutive windows. The old
  // asplit + atrim graph sent the complete long-form audio through every cue
  // branch, making a 2,000-cue audio export slower than rendering the video.
  const filters = [`[${input}]asegment=timestamps=${timestamps}${inputs}`];
  segments.forEach((segment, index) => {
    filters.push(`[retimeSrc${index}]asetpts=PTS-STARTPTS,${atempoChain(segment.rate)}[retimePart${index}]`);
  });
  const joined = targetDurationMs ? "retimedOriginalJoined" : output;
  filters.push(`${parts}concat=n=${segments.length}:v=0:a=1[${joined}]`);
  if (targetDurationMs) filters.push(finish(`[${joined}]`));
  return filters.join(";");
}
