import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { prepareSpriteSheet } from '../server/services/animationSpriteGeneration';
import { registerAnimationAsset } from '../server/services/animationAssets';
import { workdir } from '../server/services/ffmpeg';

const source = path.join(workdir, 'animation-sprites', '9f170af73cc010c0b364a6de12ed5cf32befebefb631e118c128d65fc1cbb9d1', 'walk-source.png');
const prepared = await prepareSpriteSheet(source);
console.log('FRAMES', prepared.cells.length, prepared.frameWidth, prepared.frameHeight);
const fw = prepared.frameWidth, fh = prepared.frameHeight;
const composites = prepared.cells.map((cell, frame) => ({
  input: cell, left: (frame % 4) * fw, top: Math.floor(frame / 4) * fh,
}));
const id = randomUUID();
const file = path.join(workdir, 'animation-assets', 'files', `${id}.png`);
await mkdir(path.dirname(file), { recursive: true });
await sharp({ create: { width: fw * 4, height: fh * 2, channels: 4, background: '#00000000' } }).composite(composites).png().toFile(file);
const design = 'Vietnamese naval soldier walk loop, editorial style';
const asset = await registerAnimationAsset({
  id, name: 'Chien binh Bach Dang', type: 'sprite',
  uri: `/api/animation-studio/assets/${id}/file`,
  tags: ['generated-sprite', 'bach-dang-warrior'], width: fw, height: fh,
  createdAt: new Date().toISOString(), source: 'generated', status: 'candidate',
  cacheKey: createHash('sha256').update('bach-dang-warrior-walk-v1').digest('hex'),
  generationPrompt: design, animations: ['walk'],
  sprite: { frameWidth: fw, frameHeight: fh, columns: 4, frameCount: 8, clips: { walk: { from: 0, to: 7, fps: 8, loop: true } } },
});
console.log('SPRITE_REGISTERED', asset.id, JSON.stringify(asset.sprite));
