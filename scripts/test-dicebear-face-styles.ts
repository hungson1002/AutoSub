import { Avatar, Style } from '@dicebear/core';
import lineFace from '@dicebear/styles/line-face.json';
import lorelei from '@dicebear/styles/lorelei-neutral.json';
import notionists from '@dicebear/styles/notionists-neutral.json';
import adventurer from '@dicebear/styles/adventurer-neutral.json';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('tmp/dicebear-face-test');
await mkdir(outDir, { recursive: true });
const styles = [
  ['line-face', lineFace],
  ['lorelei-neutral', lorelei],
  ['notionists-neutral', notionists],
  ['adventurer-neutral', adventurer],
] as const;

const tiles: Buffer[] = [];
for (const [name, definition] of styles) {
  const avatar = new Avatar(new Style(definition), {
    seed: 'autosub-minh-horror',
    backgroundColor: ['e9e2d6'],
    skinColor: ['d4a47f'],
    hairColor: ['2f2a27'],
    hairProbability: 100,
  } as any);
  const svg = avatar.toString();
  await writeFile(path.join(outDir, name + '.svg'), svg, 'utf8');
  const png = await sharp(Buffer.from(svg)).resize(360, 360, { fit: 'contain', background: '#2b2927' }).png().toBuffer();
  await writeFile(path.join(outDir, name + '.png'), png);
  tiles.push(png);
}
const canvas = sharp({
  create: { width: 720, height: 720, channels: 4, background: '#2b2927' },
});
const composites = [
  { input: tiles[0]!, left: 0, top: 0 },
  { input: tiles[1]!, left: 360, top: 0 },
  { input: tiles[2]!, left: 0, top: 360 },
  { input: tiles[3]!, left: 360, top: 360 },
];
await canvas.composite(composites).jpeg({ quality: 62 }).toFile(path.join(outDir, 'styles.jpg'));
console.log(path.join(outDir, 'styles.jpg'));
