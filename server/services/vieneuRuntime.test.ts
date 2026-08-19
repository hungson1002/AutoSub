import assert from 'node:assert/strict';
import test from 'node:test';
import { listVieneuPresetVoices, vieneuPresetVoiceName } from '../adapters/vieneuLocal';
import { buildVieneuPauseRepairFilter, parseVieneuInternalSilences, usesShortUtteranceQualityPass, vieneuHesitationScore } from './vieneuRuntime';

test('VieNeu exposes the built-in preset catalog alongside clone voices', () => {
  const voices = listVieneuPresetVoices();
  assert.equal(voices.length, 20);
  assert.equal(voices[0]?.source, 'preset');
  assert.equal(voices[0]?.id, 'preset:minh-duc');
  assert.equal(vieneuPresetVoiceName('preset:ngoc-huyen'), 'Ngọc Huyền');
  assert.equal(vieneuPresetVoiceName('clone-id'), undefined);
});

test('VieNeu quality parser keeps only pauses inside an utterance', () => {
  const log = [
    '[silencedetect] silence_start: 0',
    '[silencedetect] silence_end: 0.220 | silence_duration: 0.220',
    '[silencedetect] silence_start: 1.100',
    '[silencedetect] silence_end: 1.440 | silence_duration: 0.340',
    '[silencedetect] silence_start: 4.850',
    '[silencedetect] silence_end: 5.000 | silence_duration: 0.150',
  ].join('\n');

  assert.deepEqual(parseVieneuInternalSilences(log, 5_000), [
    { startMs: 1_100, endMs: 1_440, durationMs: 340 },
  ]);
});

test('VieNeu hesitation score ignores a short natural pause', () => {
  assert.equal(vieneuHesitationScore([
    { startMs: 100, endMs: 250, durationMs: 150 },
    { startMs: 500, endMs: 720, durationMs: 220 },
    { startMs: 900, endMs: 1_250, durationMs: 350 },
  ]), 250);
});

test('VieNeu short-utterance repair does not flatten multi-sentence narration', () => {
  assert.equal(usesShortUtteranceQualityPass('Mọi ánh mắt lập tức hướng về Peter.'), true);
  assert.equal(usesShortUtteranceQualityPass('Peter quay lại. Ned bước vào.'), false);
  assert.equal(usesShortUtteranceQualityPass('Một câu rất dài '.repeat(20)), false);
});

test('VieNeu pause repair removes only the middle of a measured silence', () => {
  const filter = buildVieneuPauseRepairFilter([
    { startMs: 500, endMs: 850, durationMs: 350 },
  ], 2_000, 100);
  assert.match(filter, /atrim=start=0\.000000:end=0\.550000/);
  assert.match(filter, /atrim=start=0\.800000:end=2\.000000/);
  assert.match(filter, /concat=n=2:v=0:a=1\[out\]/);
});
