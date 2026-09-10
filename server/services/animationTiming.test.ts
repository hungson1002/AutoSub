import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateNarrationTimings, buildAnimationBeatWindows, splitNarrationUnits } from './animationTiming';

test('splits Vietnamese narration at sentence boundaries without rewriting text', () => {
  const text = 'Mặt Trăng biến mất. Trái Đất vẫn quay! Điều gì xảy ra?';
  assert.deepEqual(splitNarrationUnits(text), ['Mặt Trăng biến mất.', 'Trái Đất vẫn quay!', 'Điều gì xảy ra?']);
});

test('allocates contiguous sentence captions over measured duration', () => {
  const timings = allocateNarrationTimings('Một câu ngắn. Một câu dài hơn một chút.', 5000, 'scene');
  assert.equal(timings.length, 2);
  assert.equal(timings[0].startMs, 0);
  assert.equal(timings.at(-1)?.endMs, 5000);
  assert.ok(timings[0].endMs > timings[0].startMs);
  assert.equal(timings[1].startMs, timings[0].endMs);
  assert.equal(timings[0].source, 'sentence-proportional');
});

test('keeps caption ranges inside a very short scene', () => {
  const timings = allocateNarrationTimings('Một. Hai. Ba.', 2, 'short');
  assert.ok(timings.length <= 2);
  assert.equal(timings[0].startMs, 0);
  assert.equal(timings.at(-1)?.endMs, 2);
  assert.ok(timings.every((timing) => timing.endMs > timing.startMs && timing.endMs <= 2));
});

test('anchors beat windows to exact cue order and handles repeated cues', () => {
  const beats = [{ narrationCue: 'Mặt Trăng' }, { narrationCue: 'Mặt Trăng' }, { narrationCue: 'kết luận' }];
  const windows = buildAnimationBeatWindows({ beats, narration: 'Mặt Trăng đầu tiên. Mặt Trăng thứ hai. Đây là kết luận.', durationMs: 9000 });
  assert.equal(windows.length, 3);
  assert.equal(windows[0].source, 'narration-cue');
  assert.ok(windows[1].startMs >= windows[0].startMs);
  assert.equal(windows.at(-1)?.endMs, 9000);
});

test('uses an explicit even fallback when a beat has no valid cue', () => {
  const windows = buildAnimationBeatWindows({ beats: [{}, {}], narration: 'Không có cue.', durationMs: 4000 });
  assert.deepEqual(windows.map((item) => item.source), ['even-fallback', 'even-fallback']);
  assert.deepEqual(windows.map((item) => [item.startMs, item.endMs]), [[0, 2000], [2000, 4000]]);
});

test('partial and reversed cues never create overlapping beat windows', () => {
  for (const beats of [[{ narrationCue: 'Đầu' }, {}, { narrationCue: 'Cuối' }], [{ narrationCue: 'Cuối' }, { narrationCue: 'Đầu' }]]) {
    const windows = buildAnimationBeatWindows({ beats, narration: 'Đầu câu. Giữa câu. Cuối câu.', durationMs: 6000 });
    assert.ok(windows.every((window) => window.source === 'even-fallback'));
    windows.slice(1).forEach((window, index) => assert.equal(window.startMs, windows[index].endMs));
    assert.equal(windows.at(-1)?.endMs, 6000);
  }
});
