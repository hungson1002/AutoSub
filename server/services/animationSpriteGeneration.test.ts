import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizeSpriteRequests, prepareSpriteSheet } from './animationSpriteGeneration';

async function fixture(identical = false, clipped = false) {
  const shapes = Array.from({ length: 8 }, (_, i) => {
    const x = i % 4 * 128, y = Math.floor(i / 4) * 128;
    return `<rect x="${x + (clipped ? 0 : 30)}" y="${y + 20}" width="${identical ? 40 : 25 + i * 4}" height="80" fill="#2299cc"/>`;
  }).join('');
  return sharp(Buffer.from(`<svg width="512" height="256"><rect width="512" height="256" fill="#ff00ff"/>${shapes}</svg>`)).png().toBuffer();
}

test('sprite request requires explicit identity and supported actions', () => {
  const request = { key: 'hero', name: 'Hero', design: 'A consistent blue illustrated character', clips: ['walk', 'walk', 'invalid'] };
  assert.deepEqual(normalizeSpriteRequests([request])[0].clips, ['walk']);
  assert.deepEqual(normalizeSpriteRequests([{ ...request, key: undefined }]), []);
  assert.deepEqual(normalizeSpriteRequests([{ ...request, name: ' ' }]), []);
});

test('sprite matte extraction produces eight transparent cells', async () => {
  const result = await prepareSpriteSheet(await fixture());
  assert.equal(result.cells.length, 8);
  assert.equal(result.frameWidth, 128);
  const pixels = await sharp(result.cells[0]).raw().toBuffer();
  assert.equal(pixels[3], 0);
  assert.equal(pixels[(40 * 128 + 40) * 4 + 3], 255);
});

test('rejects identical poses and cropped subjects', async () => {
  await assert.rejects(prepareSpriteSheet(await fixture(true)));
  await assert.rejects(prepareSpriteSheet(await fixture(false, true)));
});

test('rejects a translated still pose even when raw atlas cells differ', async () => {
  const shapes = Array.from({ length: 8 }, (_, i) => `<rect x="${i % 4 * 128 + 15 + i * 3}" y="${Math.floor(i / 4) * 128 + 20}" width="40" height="80" fill="#2299cc"/>`).join('');
  const image = await sharp(Buffer.from(`<svg width="512" height="256"><rect width="512" height="256" fill="#ff00ff"/>${shapes}</svg>`)).png().toBuffer();
  await assert.rejects(prepareSpriteSheet(image), /pose/);
});

test('rejects empty and undersized sheets', async () => {
  const empty = await sharp({ create: { width: 512, height: 256, channels: 4, background: '#ff00ff' } }).png().toBuffer();
  await assert.rejects(prepareSpriteSheet(empty));
  await assert.rejects(prepareSpriteSheet(await sharp(empty).resize(256, 128).png().toBuffer()));
});
