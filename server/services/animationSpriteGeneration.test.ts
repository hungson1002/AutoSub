import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildSpriteBibleDesign, buildSpriteSheetPrompt, normalizeSpriteRequests, prepareSpriteSheet, SPRITE_STYLE_ANCHOR } from './animationSpriteGeneration';

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

test('sprite bible locks one design + style anchor for every clip', () => {
  const bible = buildSpriteBibleDesign('Tran Hung Dao', 'old general in bronze armor and helmet');
  assert.ok(bible.includes('Tran Hung Dao'));
  assert.ok(bible.includes(SPRITE_STYLE_ANCHOR));
  const talk = buildSpriteSheetPrompt(bible, 'river battle', 'talk');
  const point = buildSpriteSheetPrompt(bible, 'river battle', 'point');
  // Same locked bible in both prompts; only the action differs.
  assert.ok(talk.includes(bible) && point.includes(bible));
  assert.ok(talk.includes('talking gesture') && point.includes('pointing gesture'));
  // Deterministic: same inputs always give the same prompt.
  assert.equal(buildSpriteSheetPrompt(bible, 'river battle', 'talk'), talk);
});

test('sprite matte extraction produces eight transparent cells', async () => {
  const result = await prepareSpriteSheet(await fixture());
  assert.equal(result.cells.length, 8);
  // The production extractor removes a 3px grid border from each cell edge.
  assert.equal(result.frameWidth, 122);
  assert.equal(result.frameHeight, 122);
  const pixels = await sharp(result.cells[0]).raw().toBuffer();
  assert.equal(pixels[3], 0);
  assert.equal(pixels[(40 * result.frameWidth + 40) * 4 + 3], 255);
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
