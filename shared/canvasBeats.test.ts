import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLipSyncFromBeats,
  clampBeatToScene,
  createCanvasBeat,
  isVoiceActiveAt,
  mouthOpenAmount,
  resolveVoiceWindows,
  validateCanvasBeat,
} from './canvasBeats';

const scene = () => ({
  durationMs: 4200,
  objects: [{ id: 'obj-hero' } as never, { id: 'obj-ship' } as never],
});

describe('canvas beats + lipsync (Bach Dang cutout style)', () => {
  it('creates a talk beat targeting the first object', () => {
    const beat = createCanvasBeat(scene());
    assert.equal(beat.action, 'talk');
    assert.deepEqual(beat.targetIds, ['obj-hero']);
  });

  it('rejects beats beyond scene duration or with unknown targets', () => {
    const bad = { ...createCanvasBeat(scene()), atMs: 4000, durationMs: 1000, targetIds: ['ghost'] };
    const issues = validateCanvasBeat(scene(), bad);
    assert.ok(issues.some((issue) => issue.includes('vượt quá')));
    assert.ok(issues.some((issue) => issue.includes('ghost')));
  });

  it('clamps beats into the scene instead of dropping them', () => {
    const beat = createCanvasBeat(scene(), { atMs: 5000, durationMs: 9000 });
    const clamped = clampBeatToScene(scene(), beat);
    assert.ok(clamped.atMs + clamped.durationMs <= scene().durationMs + 1);
  });

  it('carves pauses into talk beats and stays silent between chunks', () => {
    const windows = buildLipSyncFromBeats(
      [{ id: 'b1', atMs: 0, durationMs: 1000, action: 'talk', targetIds: ['obj-hero'] }],
      4200,
    );
    assert.ok(windows.length >= 2, 'talk 1s phải tách thành nhiều chunk kèm pause');
    assert.equal(isVoiceActiveAt(windows, 50), true);
    // Pause after the first 380ms chunk (+90ms) lands around 400ms.
    assert.equal(isVoiceActiveAt(windows, 410), false);
  });

  it('keeps legacy behavior when a scene has no talk beats', () => {
    assert.equal(resolveVoiceWindows({ durationMs: 4200, animationBeats: [] }), undefined);
    assert.equal(isVoiceActiveAt(undefined, 1234), true);
  });

  it('explicit lipSync wins over derived beats', () => {
    const windows = resolveVoiceWindows({
      durationMs: 4200,
      lipSync: [{ startMs: 100, endMs: 200 }],
      animationBeats: [{ id: 'b1', atMs: 0, durationMs: 4000, action: 'talk', targetIds: ['x'] }],
    });
    assert.deepEqual(windows, [{ startMs: 100, endMs: 200 }]);
  });

  it('closes the mouth when voice is inactive', () => {
    assert.ok(mouthOpenAmount(500, true) > 0.06);
    assert.equal(mouthOpenAmount(500, false), 0.05);
  });
});
