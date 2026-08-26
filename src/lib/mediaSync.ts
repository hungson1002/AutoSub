export const DUB_SYNC_TOLERANCE_SECONDS = 0.06;

export function dubAudioNeedsResync(
  videoTimeSeconds: number,
  audioTimeSeconds: number,
  toleranceSeconds = DUB_SYNC_TOLERANCE_SECONDS,
) {
  if (!Number.isFinite(videoTimeSeconds) || !Number.isFinite(audioTimeSeconds))
    return true;
  return Math.abs(audioTimeSeconds - videoTimeSeconds) > toleranceSeconds;
}
