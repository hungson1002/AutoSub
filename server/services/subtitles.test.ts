import { strict as assert } from 'node:assert';
import test from 'node:test';
import { diarizedWordsToSegments, filterLowConfidenceWhisperSegments, groupOcrResults, normalizeCueTimeline, offsetSubtitleSegments, parseOcrTextBlocks, segmentsToCues, verbalizeOcrSymbols } from './subtitles';

test('OCR verbalizes semantic symbols in the selected language but preserves punctuation', () => {
  assert.equal(verbalizeOcrSymbols('1+1=2, đúng không?...', 'vi'), 'một cộng một bằng hai, đúng không?...');
  assert.equal(verbalizeOcrSymbols('8 - 3 = 5; 6 x 4 = 24.', 'vi'), 'tám trừ ba bằng năm; sáu nhân bốn bằng hai mươi tư.');
  assert.equal(verbalizeOcrSymbols('1920x1080, 8/2, 3*4', 'vi'), 'một nghìn chín trăm hai mươi nhân một nghìn không trăm tám mươi, tám chia hai, ba nhân bốn');
  assert.equal(verbalizeOcrSymbols('Giá 12.500, tăng 2,5%.', 'vi'), 'Giá mười hai nghìn năm trăm, tăng hai phẩy năm phần trăm.');
  assert.equal(verbalizeOcrSymbols('xin chào, nam-nữ?', 'vi'), 'xin chào, nam-nữ?');
  assert.equal(verbalizeOcrSymbols('50% × 2 ≠ 30!', 'English'), 'five zero percent times two not equal to three zero!');
  assert.equal(verbalizeOcrSymbols('가격+세금=합계?', 'ko'), '가격 더하기 세금 같음 합계?');
});

test('OCR cue grouping applies symbol words after recognition', () => {
  const cues = groupOcrResults([{ text: '[{"text":"2+2=4?","kind":"subtitle","xPercent":50,"yPercent":85}]', timestampMs: 0 }], false, 500, undefined, 'vi');
  assert.equal(cues[0]?.originalText, 'hai cộng hai bằng bốn?');
});

test('diarization splits speaker turns and assigns stable voice groups', () => {
  const segments = diarizedWordsToSegments([
    { text: 'Xin ', start: 0, end: .2, speaker_id: 'speaker_0', type: 'word' },
    { text: 'chào.', start: .2, end: .5, speaker_id: 'speaker_0', type: 'word' },
    { text: 'Chào bạn.', start: .6, end: 1.1, speaker_id: 'speaker_1', type: 'word' },
    { text: 'Tôi đây.', start: 1.2, end: 1.7, speaker_id: 'speaker_0', type: 'word' },
  ]);
  const cues = segmentsToCues(segments);
  assert.deepEqual(cues.map((cue) => cue.speakerId), ['speaker_0', 'speaker_1', 'speaker_0']);
  assert.deepEqual(cues.map((cue) => cue.voiceGroup), ['G1', 'G2', 'G1']);
});

test('Whisper confidence filter removes a low-confidence no-speech hallucination', () => {
  const segments = filterLowConfidenceWhisperSegments([
    { start: 0, end: 2, text: 'real speech', no_speech_prob: 0.08, avg_logprob: -0.2 },
    { start: 5, end: 8, text: 'hallucinated in silence', no_speech_prob: 0.94, avg_logprob: -1.8 },
    { start: 9, end: 10, text: 'provider without metrics' },
  ]);
  assert.deepEqual(segments.map((segment) => segment.text), ['real speech', 'provider without metrics']);
});

test('OCR timing closes a subtitle on the next text or blank frame', () => {
  const cues = groupOcrResults([
    { text: 'Câu đầu', timestampMs: 1000 },
    { text: 'Câu đầu', timestampMs: 1500 },
    { text: '', timestampMs: 2000 },
    { text: 'Câu sau', timestampMs: 3000 },
    { text: '', timestampMs: 4000 },
  ], false, 500);
  assert.deepEqual(cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 1000, endMs: 2000 },
    { startMs: 3000, endMs: 3500 },
  ]);
});

test('OCR watermark filtering does not erase subtitles from short clips', () => {
  const cues = groupOcrResults([
    { text: 'Hello world', timestampMs: 0 },
    { text: 'Hello world', timestampMs: 500 },
    { text: '', timestampMs: 1000 },
  ], true, 500);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.originalText, 'Hello world');
  assert.equal(cues[0]?.endMs, 1000);
});

test('OCR grouping selects the most stable reading across adjacent frames', () => {
  const cues = groupOcrResults([
    { text: 'I am going hom', timestampMs: 0 },
    { text: 'I am going home', timestampMs: 500 },
    { text: 'I am going home', timestampMs: 1000 },
    { text: '', timestampMs: 1500 },
  ], false, 500);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.originalText, 'I am going home');
});

test('OCR keeps stable screen text as one cue across briefly missed frames', () => {
  const logo = JSON.stringify([{ text: 'AUTO SUB', kind: 'onscreen-text', xPercent: 90, yPercent: 8 }]);
  const cues = groupOcrResults([
    { text: logo, timestampMs: 0 },
    { text: '', timestampMs: 500 },
    { text: '', timestampMs: 1_000 },
    { text: logo, timestampMs: 1_500 },
    { text: logo, timestampMs: 2_000 },
  ], false, 500);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.startMs, 0);
  assert.equal(cues[0]?.endMs, 2_500);
});

test('OCR keeps a subtitle as one cue across one missed sample', () => {
  const line = JSON.stringify([{ text: 'Một câu liên tục', kind: 'subtitle', xPercent: 50, yPercent: 85 }]);
  const cues = groupOcrResults([
    { text: line, timestampMs: 0 },
    { text: '[]', timestampMs: 500 },
    { text: line, timestampMs: 1_000 },
  ], false, 500);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.startMs, 0);
  assert.equal(cues[0]?.endMs, 1_500);
});

test('full-frame OCR keeps simultaneous visible text blocks as separate cues', () => {
  const cues = groupOcrResults([
    { text: 'Tiêu đề góc trên\nPhụ đề phía dưới', timestampMs: 0 },
    { text: 'Tiêu đề góc trên\nPhụ đề phía dưới', timestampMs: 500 },
    { text: '', timestampMs: 1000 },
  ], false, 500);
  assert.deepEqual(cues.map((cue) => ({ text: cue.originalText, startMs: cue.startMs, endMs: cue.endMs })), [
    { text: 'Tiêu đề góc trên', startMs: 0, endMs: 1000 },
    { text: 'Phụ đề phía dưới', startMs: 0, endMs: 1000 },
  ]);
});

test('OCR text block parser accepts plain lines and common JSON output', () => {
  assert.deepEqual(parseOcrTextBlocks('- Dòng đầu\n- Dòng sau\n- Dòng đầu'), ['Dòng đầu', 'Dòng sau']);
  assert.deepEqual(parseOcrTextBlocks('{"regions":[{"text":"Góc trên"},{"text":"Góc dưới"}]}'), ['Góc trên', 'Góc dưới']);
});

test('OCR parser strips provider json labels and unwrapped object lines', () => {
  const payload = `json
{"text":"手术失败后的门外...","kind":"onscreen-text","xPercent":18,"yPercent":6},
{"text":"她还那么年轻","kind":"subtitle","xPercent":50,"yPercent":81}`;
  assert.deepEqual(parseOcrTextBlocks(payload), ['手术失败后的门外...', '她还那么年轻']);
  const cues = groupOcrResults([{ text: payload, timestampMs: 0 }], false, 250);
  assert.deepEqual(cues.map((cue) => ({ text: cue.originalText, kind: cue.sourceKind, position: cue.screenPosition })), [
    { text: '手术失败后的门外...', kind: 'onscreen-text', position: { xPercent: 18, yPercent: 6 } },
    { text: '她还那么年轻', kind: 'subtitle', position: undefined },
  ]);
});

test('full-frame OCR marks screen text so dubbing can exclude it', () => {
  const payload = JSON.stringify([
    { text: 'Tiêu đề', kind: 'onscreen-text', xPercent: 18, yPercent: 7 },
    { text: 'Lời thoại', kind: 'subtitle', xPercent: 50, yPercent: 86 },
  ]);
  const cues = groupOcrResults([{ text: payload, timestampMs: 0 }], false, 500);
  assert.deepEqual(cues.map((cue) => ({ text: cue.originalText, sourceKind: cue.sourceKind, screenPosition: cue.screenPosition })), [
    { text: 'Tiêu đề', sourceKind: 'onscreen-text', screenPosition: { xPercent: 18, yPercent: 7 } },
    { text: 'Lời thoại', sourceKind: 'subtitle', screenPosition: undefined },
  ]);
});

test('OCR preserves semantic subtitle classification outside the lower caption band', () => {
  const payload = JSON.stringify([
    { text: 'Dám nhìn thẳng vào lưới hái tử thần', kind: 'subtitle', xPercent: 32, yPercent: 18 },
  ]);
  const cues = groupOcrResults([{ text: payload, timestampMs: 0 }], false, 500);
  assert.equal(cues[0]?.sourceKind, 'subtitle');
  assert.equal(cues[0]?.screenPosition, undefined);
});

test('OCR kind flicker is resolved by temporal majority without duplicating the cue', () => {
  const frame = (kind: string) => JSON.stringify([
    { text: 'Tiêu đề cố định', kind, xPercent: 35, yPercent: 16 },
  ]);
  const cues = groupOcrResults([
    { text: frame('subtitle'), timestampMs: 0 },
    { text: frame('onscreen-text'), timestampMs: 500 },
    { text: frame('subtitle'), timestampMs: 1_000 },
  ], false, 500);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.sourceKind, 'subtitle');
  assert.equal(cues[0]?.startMs, 0);
  assert.equal(cues[0]?.endMs, 1_500);
});

test('OCR positions from a cropped ROI are remapped onto the full video frame', () => {
  const cues = groupOcrResults([
    { timestampMs: 0, text: '[{"text":"标题","kind":"onscreen-text","xPercent":50,"yPercent":20}]' },
  ], false, 250, { x: 10, y: 70, w: 80, h: 25 });
  assert.deepEqual(cues[0]?.screenPosition, { xPercent: 50, yPercent: 75 });
});

test('STT cue conversion preserves provider timestamps and silence gaps', () => {
  const cues = segmentsToCues([
    { start: 0, end: 2.44, text: 'A' },
    { start: 9.48, end: 10.9, text: 'B' },
  ]);

  assert.deepEqual(cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 2440 },
    { startMs: 9480, endMs: 10900 },
  ]);
  assert.equal(cues[1].startMs - cues[0].endMs, 7040);
});

test('chunk offset is added to each absolute segment timestamp', () => {
  const shifted = offsetSubtitleSegments([{ start: 3.2, end: 5.1, text: 'chunk 2' }], 600);

  assert.deepEqual(shifted, [{ start: 603.2, end: 605.1, text: 'chunk 2' }]);
  const cues = segmentsToCues(shifted);
  assert.deepEqual(cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 603200, endMs: 605100 }]);
});

test('chunk offset preserves provider word timestamps', () => {
  const shifted = offsetSubtitleSegments([{ start: 3.2, end: 5.1, text: 'worded', words: [{ word: 'worded', start: 3.4, end: 4.2 }] }], 600);
  assert.deepEqual(shifted[0].words, [{ word: 'worded', start: 603.4, end: 604.2 }]);
  assert.deepEqual(segmentsToCues(shifted)[0].words, [{ word: 'worded', start: 603.4, end: 604.2 }]);
});

test('timeline normalization repairs overlap only and keeps a real gap', () => {
  const normalized = normalizeCueTimeline([
    { id: 'overlap', startMs: 0, endMs: 3000 },
    { id: 'overlap-2', startMs: 2900, endMs: 5000 },
    { id: 'gap', startMs: 9480, endMs: 10900 },
  ]);

  assert.deepEqual(normalized.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 3000 },
    { startMs: 3000, endMs: 5000 },
    { startMs: 9480, endMs: 10900 },
  ]);
  assert.equal(normalized[2].startMs - normalized[1].endMs, 4480);
});

test('timeline normalization clips a nested cue instead of hiding it behind the previous cue', () => {
  const normalized = normalizeCueTimeline([
    { id: 'outer', startMs: 2140, endMs: 5750 },
    { id: 'nested', startMs: 2520, endMs: 3920 },
  ]);

  assert.deepEqual(normalized.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 2140, endMs: 2520 },
    { startMs: 2520, endMs: 3920 },
  ]);
});
