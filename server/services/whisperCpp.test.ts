import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseWhisperJson, parseWhisperProgress, WHISPER_MODEL_DEFINITIONS } from './whisperCpp';

test('parseWhisperJson converts whisper.cpp millisecond offsets to subtitle seconds', () => {
  const result = parseWhisperJson({
    result: { language: 'zh' },
    transcription: [
      { timestamps: { from: '00:00:00,000', to: '00:00:01,250' }, offsets: { from: 0, to: 1250 }, text: ' 你好 ' },
      { timestamps: { from: '00:00:01,250', to: '00:00:03,500' }, offsets: { from: 1250, to: 3500 }, text: ' 世界 ' },
    ],
  });
  assert.equal(result.text, '你好 世界');
  assert.deepEqual(result.segments.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 0, end: 1.25, text: '你好' },
    { start: 1.25, end: 3.5, text: '世界' },
  ]);
});

test('Whisper Local exposes only bounded quantized models', () => {
  assert.deepEqual(WHISPER_MODEL_DEFINITIONS.map((model) => model.id), ['small-q5_1', 'medium-q5_0']);
  assert.ok(WHISPER_MODEL_DEFINITIONS.every((model) => model.sizeBytes < 600 * 1024 * 1024));
});

test('parseWhisperJson rejects malformed output instead of creating fake timestamps', () => {
  assert.throws(() => parseWhisperJson({ text: 'missing transcription' }), /danh sách transcript/i);
});

test('parseWhisperProgress reads the latest CLI progress update', () => {
  assert.equal(parseWhisperProgress('progress =  21%\rprogress = 42%'), 42);
  assert.equal(parseWhisperProgress('no progress here'), undefined);
});
