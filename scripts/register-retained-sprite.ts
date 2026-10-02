import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { prepareSpriteSheet } from '../server/services/animationSpriteGeneration';
import { registerAnimationAsset } from '../server/services/animationAssets';
import { workdir } from '../server/services/ffmpeg';

const [sourceRel, clip, key, name] = process.argv.slice(2);
const source = path.join(workdir, 'animation-sprites', sourceRel!);
const prepared = await prepareSpriteSheet(source);
console.log('FRAMES', prepared.cells.length, prepared.frameWidth, prepared.frameHeight);
const fw = prepared.frameWidth, fh = prepared.frameHeight;
const id = randomUUID();
const file = path.join(workdir, 'animation-assets', 'files', `${id}.png`);
await mkdir(path.dirname(file), { recursive: true });
await sharp({ create: { width: fw * 4, height: fh * 2, channels: 4, background: '#00000000' } })
  .composite(prepared.cells.map((cell, frame) => ({ input: cell, left: (frame % 4) * fw, top: Math.floor(frame / 4) * fh })))
  .png().toFile(file);
const asset = await registerAnimationAsset({
  id, name: name!, type: 'sprite',
  uri: `/api/animation-studio/assets/${id}/file`,
  tags: ['generated-sprite', key!], width: fw, height: fh,
  createdAt: new Date().toISOString(), source: 'generated', status: 'candidate',
  cacheKey: createHash('sha256').update(`${key}-v1`).digest('hex'),
  generationPrompt: `${name} ${clip} loop`, animations: [clip!],
  sprite: { frameWidth: fw, frameHeight: fh, columns: 4, frameCount: 8, clips: { [clip!]: { from: 0, to: 7, fps: 8, loop: true } } },
});
console.log('SPRITE_REGISTERED', asset.id, JSON.stringify(asset.sprite));
