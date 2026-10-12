import { strict as assert } from 'node:assert';
import test from 'node:test';
import { sliceDubbingPcm } from './dubbingPcm';

export function fixtureWav(durationMs = 2000) {
  const size = Math.round(durationMs * 192);
  const wav = Buffer.alloc(44 + size);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(size, 40);
  for (let offset = 44; offset < wav.length; offset += 4) {
    const sample = Math.round(Math.sin((offset - 44) / 4 * 2 * Math.PI * 220 / 48000) * 7000);
    wav.writeInt16LE(sample, offset); wav.writeInt16LE(sample, offset + 2);
  }
  return wav;
}

test('preview slicing preserves exact PCM samples and stereo frame alignment', () => {
  const wav = fixtureWav();
  const clip = sliceDubbingPcm(wav, 500, 1250);
  assert.equal(clip.length - 44, 750 * 192);
  assert.deepEqual(clip.subarray(44), wav.subarray(44 + 500 * 192, 44 + 1250 * 192));
  assert.equal(clip.readUInt32LE(4), clip.length - 8);
});

test('preview slicing handles extra chunks and rejects malformed audio', () => {
  const wav = fixtureWav();
  const chunk = Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 42, 0]);
  const extended = Buffer.concat([wav.subarray(0, 12), chunk, wav.subarray(12)]);
  extended.writeUInt32LE(extended.length - 8, 4);
  assert.deepEqual(sliceDubbingPcm(extended, 0, 100), sliceDubbingPcm(wav, 0, 100));
  assert.throws(() => sliceDubbingPcm(wav.subarray(0, wav.length - 1), 0, 100));
  assert.throws(() => sliceDubbingPcm(wav, NaN, 100));
  assert.throws(() => sliceDubbingPcm(wav, 2200, 2300));
  const compressed = Buffer.from(wav); compressed.writeUInt16LE(3, 20);
  assert.throws(() => sliceDubbingPcm(compressed, 0, 100));
});
