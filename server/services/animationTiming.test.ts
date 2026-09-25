import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateNarrationTimings, buildAnimationBeatWindows, buildNarrationSceneTasks, splitNarrationUnits } from './animationTiming';

test('splits Vietnamese narration at sentence boundaries without rewriting text', () => {
  const text = 'Mặt Trăng biến mất. Trái Đất vẫn quay! Điều gì xảy ra?';
  assert.deepEqual(splitNarrationUnits(text), ['Mặt Trăng biến mất.', 'Trái Đất vẫn quay!', 'Điều gì xảy ra?']);
});

test('keeps a scene as one continuous TTS task while leaving sentence splitting for captions', () => {
  const narration = 'Bạn thấy món này rẻ hơn. Nhưng tổng hóa đơn lại cao hơn! Vì sao?';
  const tasks = buildNarrationSceneTasks([
    { id: 'scene-1', name: 'Cảnh 1', renderMode: 'composite', narration },
    { id: 'video-1', name: 'Video', renderMode: 'generated-video', narration: 'Không đưa clip ngoài vào TTS.' },
    { id: 'scene-2', name: 'Cảnh rỗng', renderMode: 'composite', narration: '  ' },
  ]);
  assert.deepEqual(tasks, [{ sceneId: 'scene-1', sceneName: 'Cảnh 1', text: narration }]);
  assert.equal(splitNarrationUnits(tasks[0]!.text).length, 3);
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

test('keeps fractional frame-aligned scene duration as the exact beat boundary', () => {
  const durationMs = 9866.666666666668;
  const windows = buildAnimationBeatWindows({
    beats: [{ narrationCue: 'Alpha' }, { narrationCue: 'beta' }, { narrationCue: 'gamma' }, { narrationCue: 'delta' }],
    narration: 'Alpha beta gamma delta',
    durationMs,
  });

  assert.equal(windows.at(-1)?.endMs, durationMs);
  assert.ok(windows.every((window) => window.startMs >= 0 && window.startMs < window.endMs && window.endMs <= durationMs));
});
