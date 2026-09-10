import sharp, { type OverlayOptions } from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { workdir } from './ffmpeg';
import { generateGoogleFlowImage } from './googleFlow';
import { findCachedAnimationAsset, registerAnimationAsset } from './animationAssets';
import type { AnimationAsset } from '../../shared/animationStudio';
import { runAnimationOnce } from './animationCheckpoint';

export const spriteActions = ['idle', 'walk', 'run', 'point', 'talk'] as const;
export type SpriteRequest = { key: string; name: string; design: string; clips: Array<typeof spriteActions[number]> };
export function normalizeSpriteRequests(value: unknown): SpriteRequest[] {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  return value.slice(0, 3).flatMap((r) => {
    if (!r || typeof r.key !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(r.key) || keys.has(r.key) || typeof r.name !== 'string' || !r.name.trim() || typeof r.design !== 'string' || r.design.trim().length < 20 || !Array.isArray(r.clips)) return [];
    const clips = [...new Set(r.clips.filter((c: unknown) => spriteActions.includes(c as typeof spriteActions[number])))].slice(0, 3) as SpriteRequest['clips'];
    if (!clips.length) return [];
    keys.add(r.key); return [{ key: r.key, name: r.name.slice(0, 100), design: r.design.slice(0, 2400), clips }];
  });
}

/** Controlled matte extraction, not a claim of semantic/anatomical quality. */
export async function prepareSpriteSheet(input: string | Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: 24_000_000 }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const fw = info.width / 4, fh = info.height / 2;
  if (!Number.isInteger(fw) || !Number.isInteger(fh) || fw < 128 || fh < 128) throw new Error('Sprite sheet phải có lưới 4×2, mỗi ô tối thiểu 128px.');
  const cells: Buffer[] = []; const heights: number[] = []; const thumbnails: Buffer[] = [];
  for (let frame = 0; frame < 8; frame++) {
    const rgba = Buffer.alloc(fw * fh * 4); let visible = 0, edgePixels = 0, matteBorder = 0, border = 0, minY = fh, maxY = -1, minX = fw, maxX = -1;
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const source = ((Math.floor(frame / 4) * fh + y) * info.width + (frame % 4) * fw + x) * 4;
      const target = (y * fw + x) * 4;
      const [r, g, b, alpha] = data.subarray(source, source + 4);
      // Magenta matte with tolerance; forbid magenta in the generated subject contract.
      const matte = r > 170 && b > 170 && g < 110 && Math.min(r, b) - g > 90;
      rgba[target] = r; rgba[target + 1] = g; rgba[target + 2] = b; rgba[target + 3] = matte ? 0 : alpha;
      const edge = x < 2 || y < 2 || x >= fw - 2 || y >= fh - 2;
      if (edge) { border++; if (matte || alpha < 16) matteBorder++; }
      if (rgba[target + 3] > 32) { visible++; minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); if (edge) edgePixels++; }
    }
    if (matteBorder / border < .97 || edgePixels > fw * fh * .002) throw new Error(`Ô sprite ${frame + 1} bị cắt hoặc không có nền matte sạch.`);
    if (visible < fw * fh * .025 || visible > fw * fh * .8) throw new Error(`Ô sprite ${frame + 1} trống hoặc mask không hợp lệ.`);
    heights.push(maxY - minY + 1);
    const png = await sharp(rgba, { raw: { width: fw, height: fh, channels: 4 } }).png().toBuffer();
    cells.push(png);
    // Compare aligned subjects, not their positions in the atlas. Translating
    // one still pose is not a new pose; ignore RGB hidden under transparent matte.
    thumbnails.push(await sharp(png).extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }).resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).flatten({ background: '#000000' }).raw().toBuffer());
  }
  if (Math.min(...heights) / Math.max(...heights) < .55) throw new Error('Kích thước nhân vật giữa các ô biến đổi quá lớn.');
  const distinct = thumbnails.some((thumb, i) => i > 0 && thumb.reduce((sum, v, k) => sum + Math.abs(v - thumbnails[0][k]), 0) / thumb.length > 2);
  if (!distinct) throw new Error('Các ô sprite giống nhau; chưa có pose chuyển động thật.');
  return { cells, frameWidth: fw, frameHeight: fh };
}

export async function generateAnimationSprite(request: SpriteRequest, model = 'narwhal', continuity = '', onStage: (stage: string) => Promise<void> = async () => {}): Promise<AnimationAsset> {
  const key = createHash('sha256').update(JSON.stringify({ request, model, continuity })).digest('hex');
  return runAnimationOnce(`sprite-${key}`, () => generateSprite(request, model, continuity, onStage));
}

async function generateSprite(request: SpriteRequest, model: string, continuity: string, onStage: (stage: string) => Promise<void>): Promise<AnimationAsset> {
  const normalized = normalizeSpriteRequests([request])[0];
  if (!normalized) throw new Error('Invalid sprite request');
  request = normalized;
  const cacheKey = createHash('sha256').update(JSON.stringify({ geometryVersion: 2, request, model, continuity: continuity.slice(0, 1200) })).digest('hex');
  const cached = await findCachedAnimationAsset(cacheKey);
  if (cached?.sprite) return cached;
  // Stable source checkpoint: a later clip failure must not discard earlier work.
  const id = randomUUID(); const directory = path.join(workdir, 'animation-sprites', cacheKey);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'request.json'), JSON.stringify({ request, continuity, model }));
  const prepared: Awaited<ReturnType<typeof prepareSpriteSheet>>[] = [];
  for (const [index, clip] of request.clips.entries()) {
    await onStage(`Sprite ${request.name}: ${clip} (${index + 1}/${request.clips.length})`);
    const source = path.join(directory, `${clip}-source.png`);
    const prompt = `Professional 2D animation production sprite sheet. Exactly 8 equally sized cells, 4 columns by 2 rows, read left-to-right then top-to-bottom. No grid lines, labels, text, scenery, shadows, borders or checkerboard. Solid pure magenta #FF00FF matte background in every cell; no magenta on character. One identical full-body character per cell, 12% clear padding around all limbs, consistent camera, scale, ground baseline, side facing right. Character design: ${request.design}. Style/continuity: ${continuity.slice(0, 1200)}. Action: ${clip}, eight successive distinct poses of one coherent ${clip === 'point' ? 'pointing gesture' : 'loop'}; include anticipation, main poses and recovery. For walk/run animate articulated limbs in place, do NOT translate the character across cells. Preserve face, anatomy, costume and colors in all frames. Do not substitute a robot/stick figure unless specified. Image is a sprite atlas, not a comic or character contact sheet.`;
    try {
      // Revalidate retained sources. Invalid retained images fail visibly rather
      // than silently authorizing another generation on every resume.
      if (!existsSync(source)) await generateGoogleFlowImage(prompt, source, { model, size: '1536x768', referenceImagePath: index ? path.join(directory, `${request.clips[0]}-source.png`) : undefined });
      prepared.push(await prepareSpriteSheet(source));
      await writeFile(path.join(directory, `${clip}-check.json`), JSON.stringify({ status: 'geometry-passed', semanticReview: 'not-performed' }));
    } catch (error) {
      await writeFile(path.join(directory, 'failure.json'), JSON.stringify({ clip, status: 'failed', sourceRetained: true }));
      throw new Error(`Sprite ${request.name}/${clip} chưa đạt; giữ ảnh nguồn để kiểm tra, không tự retry. ${error instanceof Error ? error.message : 'Lỗi tạo ảnh.'}`);
    }
  }
  const fw = Math.min(...prepared.map((p) => p.frameWidth)), fh = Math.min(...prepared.map((p) => p.frameHeight));
  const composites: OverlayOptions[] = [];
  for (let row = 0; row < prepared.length; row++) for (let frame = 0; frame < 8; frame++) composites.push({ input: await sharp(prepared[row].cells[frame]).resize(fw, fh, { fit: 'contain', background: '#00000000' }).png().toBuffer(), left: frame % 4 * fw, top: (row * 2 + Math.floor(frame / 4)) * fh });
  const file = path.join(workdir, 'animation-assets', 'files', `${id}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: fw * 4, height: fh * 2 * prepared.length, channels: 4, background: '#00000000' } }).composite(composites).png().toFile(file);
  return registerAnimationAsset({ id, name: request.name, type: 'sprite', uri: `/api/animation-studio/assets/${id}/file`, tags: ['generated-sprite', request.key], width: fw, height: fh, createdAt: new Date().toISOString(), source: 'generated', status: 'candidate', cacheKey, generationPrompt: request.design, animations: request.clips, sprite: { frameWidth: fw, frameHeight: fh, columns: 4, frameCount: 8 * prepared.length, clips: Object.fromEntries(request.clips.map((clip, row) => [clip, { from: row * 8, to: row * 8 + 7, fps: clip === 'run' ? 12 : 8, loop: clip !== 'point' }])) } });
}
