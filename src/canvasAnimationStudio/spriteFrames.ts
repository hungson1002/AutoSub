export type SpriteClipSpec = {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  from: number;
  to: number;
  fps: number;
  loop?: boolean;
};

export function spriteFrameAt(sprite: SpriteClipSpec, timeMs: number) {
  const from = Math.max(0, Math.floor(sprite.from));
  const to = Math.max(from, Math.floor(sprite.to));
  const length = to - from + 1;
  const fps = Math.max(1, Math.min(24, sprite.fps || 8));
  const offset = Math.floor(Math.max(0, timeMs) / 1000 * fps);
  const frame = sprite.loop === false ? Math.min(to, from + offset) : from + offset % length;
  const columns = Math.max(1, Math.floor(sprite.columns) || 1);
  return { frame, column: frame % columns, row: Math.floor(frame / columns) };
}

export function resolveSpriteAct(
  acts: Array<SpriteClipSpec & { action: string; imageUrl: string }> | undefined,
  beatAction: string | undefined,
) {
  if (!acts?.length) return undefined;
  // An unavailable action must not silently play an unrelated talk/point clip.
  return beatAction ? acts.find((act) => act.action === beatAction) : undefined;
}
