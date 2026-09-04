import assert from 'node:assert/strict';
import test from 'node:test';
import { directorRepairRule, jsonFromDirectorReply, replaceUnavailableGeneratedAssets } from './animationDirector';
import { wavDurationMs } from './animationAssets';

test('parses Director JSON wrapped in provider explanation and fenced output', () => {
  const explained = jsonFromDirectorReply('Here is the project:\n{"name":"Demo","scenes":[]}\nDone.');
  const fenced = jsonFromDirectorReply('```json\n{"name":"Fenced","scenes":[]}\n```');
  assert.equal(explained.name, 'Demo');
  assert.equal(fenced.name, 'Fenced');
});

test('does not stop at braces inside a JSON string', () => {
  const result = jsonFromDirectorReply('Result: {"name":"A {useful} title","scenes":[]} thanks');
  assert.equal(result.name, 'A {useful} title');
});

test('uses a smaller retry when provider output is truncated', () => {
  const rule = directorRepairRule('JSON từ AI Director bị thiếu phần kết thúc.');
  assert.match(rule, /exactly 2 scenes/);
  assert.match(rule, /compact one-line JSON/);
});

test('keeps the project editable when an optional generated asset fails', () => {
  const scene = { id: 'scene', name: 'Scene', order: 0, durationMs: 3000, narration: '', renderMode: 'composite' as const, backgroundColor: '#000000', layers: [{ id: 'visual', name: 'Planet', type: 'image' as const, assetId: 'requested-planet', visible: true, locked: false, zIndex: 1, width: 300, height: 300, transform: { position: { x: 100, y: 100 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } }], commands: [], camera: { transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } }, commands: [] } };
  const [result] = replaceUnavailableGeneratedAssets([scene], new Map(), new Set(['requested-planet']));
  assert.equal(result.renderMode, 'composite');
  if (result.renderMode !== 'composite') return;
  assert.equal(result.layers[0].type, 'shape');
  assert.equal(result.layers[0].assetId, undefined);
});

test('reads real WAV duration for voice-synced scenes', () => {
  const wav = Buffer.alloc(44 + 32_000);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32_000, 40);
  assert.equal(wavDurationMs(wav), 1000);
});
