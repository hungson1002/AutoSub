import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { generateAnimationSprite, prepareSpriteSheet } from './animationSpriteGeneration';
import { findCachedAnimationAsset, registerAnimationAsset } from './animationAssets';
import { workdir } from './ffmpeg';
import type { FilmCastMember } from './canvasScriptFilm';
import type { CanvasSpriteAct } from '../../shared/canvasAnimationStudio';

const STYLE = 'Cute chibi with HUGE round head and tiny body. Flat cartoon style, thick dark outlines, solid colors.';
const LAYOUT = 'SHEET LAYOUT IS STRICT: each action is its own image with EXACTLY 8 character cells in EXACTLY 4 columns and EXACTLY 2 rows, four per row. No grid lines, no borders between cells.';

export type CastWithSprites = FilmCastMember & {
  acts: CanvasSpriteAct[];
  sheetUrl: string;
};

/**
 * Mỗi diễn viên 1 request duy nhất clips [talk, point]: clip point dùng
 * ảnh talk làm reference nên cùng khuôn mặt (reference chaining).
 * Sheet nhiều hàng: talk = hàng 0-1 (frame 0-7), point = hàng 2-3 (frame 8-15).
 */
export async function ensureCastSprites(
  cast: FilmCastMember[],
  designHint: (member: FilmCastMember) => string,
  onStage: (message: string) => void = () => {},
): Promise<CastWithSprites[]> {
  const out: CastWithSprites[] = [];
  for (const member of cast) {
    const key = `film-cast-${member.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    onStage(`Gen sprite cho ${member.name}`);
    try {
      const asset = await generateAnimationSprite(
        {
          key,
          name: `Dien vien ${member.name}`,
          design: `${STYLE} Character: ${designHint(member)}`,
          clips: ['talk', 'point'],
        },
        'narwhal',
        `History explainer cast. Same person in every image. ${LAYOUT}`,
        async (stage) => onStage(`${member.name}: ${stage}`),
      );
      out.push(withActs(member, asset.id, asset.sprite));
    } catch (error) {
      // Rớt clip 2 (thường là upload transport): cứu sheet talk giữ trong checkpoint.
      onStage(`${member.name}: rớt multi-clip, cứu talk-only`);
      const rescued = await rescueTalkOnly(member, onStage);
      if (!rescued) throw error;
      out.push(rescued);
    }
  }
  return out;
}

function withActs(
  member: FilmCastMember,
  assetId: string,
  meta: { frameWidth?: number; frameHeight?: number; columns?: number; clips?: Record<string, { from: number; to: number; fps: number; loop?: boolean }> } | undefined,
): CastWithSprites {
  const sheetUrl = `/api/animation-studio/assets/${assetId}/file`;
  const fw = meta?.frameWidth || 338;
  const fh = meta?.frameHeight || 378;
  const cols = meta?.columns || 4;
  const talkClip = meta?.clips?.talk || { from: 0, to: 7, fps: 8, loop: true };
  // Sheet talk-only (cứu hộ): point tái dùng frame talk, không đọc hàng ma.
  const pointClip = meta?.clips?.point || { ...talkClip, loop: false };
  return {
    ...member,
    sheetUrl,
    talkSheetUrl: sheetUrl,
    pointSheetUrl: sheetUrl,
    acts: [
      { action: 'talk', imageUrl: sheetUrl, frameWidth: fw, frameHeight: fh, columns: cols, from: talkClip.from, to: talkClip.to, fps: 8 },
      ...(meta?.clips?.point ? [{ action: 'point' as const, imageUrl: sheetUrl, frameWidth: fw, frameHeight: fh, columns: cols, from: pointClip.from, to: pointClip.to, fps: 8, loop: false }] : []),
    ],
  };
}

async function rescueTalkOnly(member: FilmCastMember, onStage: (m: string) => void): Promise<CastWithSprites | undefined> {
  const name = member.name;
  const root = path.join(workdir, 'animation-sprites');
  let best: { file: string; mtime: number } | undefined;
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, 'talk-source.png');
      try {
        const checkpoint = JSON.parse(await readFile(path.join(root, entry.name, 'request.json'), 'utf8'));
        if (checkpoint.request?.name !== 'Dien vien ' + name) continue;
        const st = await stat(file);
        if (Date.now() - st.mtimeMs < 30 * 60 * 1000 && (!best || st.mtimeMs > best.mtime)) {
          best = { file, mtime: st.mtimeMs };
        }
      } catch { /* next */ }
    }
  } catch {
    return undefined;
  }
  if (!best) return undefined;
  try {
    const prepared = await prepareSpriteSheet(best.file);
    const fw = prepared.frameWidth, fh = prepared.frameHeight;
    const id = randomUUID();
    const file = path.join(workdir, 'animation-assets', 'files', `${id}.png`);
    await mkdir(path.dirname(file), { recursive: true });
    await sharp({ create: { width: fw * 4, height: fh * 2, channels: 4, background: '#00000000' } })
      .composite(prepared.cells.map((cell, frame) => ({ input: cell, left: (frame % 4) * fw, top: Math.floor(frame / 4) * fh })))
      .png().toFile(file);
    const cacheKey = createHash('sha256').update(`rescue-talk-${name}-${best.mtime}`).digest('hex');
    const asset = await findCachedAnimationAsset(cacheKey).catch(() => undefined)
      || await registerAnimationAsset({
        id, name: `Dien vien ${name} (talk)`, type: 'sprite',
        uri: `/api/animation-studio/assets/${id}/file`,
        tags: ['generated-sprite', 'rescued-talk'], width: fw, height: fh,
        createdAt: new Date().toISOString(), source: 'generated', status: 'candidate',
        cacheKey, generationPrompt: `rescued talk ${name}`,
        animations: ['talk'],
        sprite: { frameWidth: fw, frameHeight: fh, columns: 4, frameCount: 8, clips: { talk: { from: 0, to: 7, fps: 8, loop: true } } },
      });
    onStage(`${name}: cứu talk-only OK ${asset.id}`);
    return withActs(member, asset.id, asset.sprite);
  } catch {
    return undefined;
  }
}
