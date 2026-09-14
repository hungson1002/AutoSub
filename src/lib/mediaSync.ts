// Browser audio and video clocks commonly differ by a few frames. Seeking the
// dub for that harmless jitter makes the current syllable play again. Keep
// explicit seeks exact, but only repair drift that is actually perceptible.
export const DUB_SYNC_TOLERANCE_SECONDS = 0.25;

export function dubAudioNeedsResync(
  videoTimeSeconds: number,
  audioTimeSeconds: number,
  toleranceSeconds = DUB_SYNC_TOLERANCE_SECONDS,
) {
  if (!Number.isFinite(videoTimeSeconds) || !Number.isFinite(audioTimeSeconds))
    return true;
  return Math.abs(audioTimeSeconds - videoTimeSeconds) > toleranceSeconds;
}
