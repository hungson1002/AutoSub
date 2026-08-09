export type ExportAudioFilterOptions = {
  hasDub: boolean;
  dubInputIndex?: number;
  backgroundInputIndex?: number;
  keepAudio: boolean;
  originalVolume?: number;
  jobDubIncludesBackground?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const safeLimiter = 'alimiter=limit=0.891:level=false,aresample=48000';
const normalizeDub = 'loudnorm=I=-16:LRA=11:TP=-1.5';

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
  } = options;

  if (hasDub) {
    if (dubInputIndex === undefined) throw new Error('Thiếu audio input của dub track.');
    if (jobDubIncludesBackground) {
      return `[${dubInputIndex}:a]${normalizeDub},${safeLimiter},apad[audioout]`;
    }
    if (backgroundInputIndex !== undefined) {
      const volume = clamp(Number(options.originalVolume ?? 0.35), 0, 1).toFixed(3);
      return `[${backgroundInputIndex}:a]volume=${volume}[background];[${dubInputIndex}:a]${normalizeDub}[dub];[background][dub]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,${safeLimiter},apad[audioout]`;
    }
    if (keepAudio) {
      const volume = clamp(Number(options.originalVolume ?? 0.25), 0, 1).toFixed(3);
      return `[0:a]volume=${volume}[original];[${dubInputIndex}:a]${normalizeDub}[dub];[original][dub]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,${safeLimiter},apad[audioout]`;
    }
    return `[${dubInputIndex}:a]${normalizeDub},${safeLimiter},apad[audioout]`;
  }

  if (backgroundInputIndex !== undefined) return `[${backgroundInputIndex}:a]anull[audioout]`;
  return keepAudio ? '[0:a]anull[audioout]' : '';
}
