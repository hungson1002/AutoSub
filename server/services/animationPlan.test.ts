import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAnimationProductionPlan } from './animationPlan';

test('compiles an inspectable production contract from normalized beats', () => {
  const plan = compileAnimationProductionPlan({
    sceneIds: ['scene-1'],
    sceneDurationsMs: [5000],
    continuityBible: 'One consistent moon and earth design.',
    segments: [{
      title: 'Cơ chế',
      narration: 'Mặt Trăng biến mất và thủy triều thay đổi.',
      visualBeats: [{ narrationCue: 'thủy triều thay đổi', action: 'Biên độ nước thay đổi theo thời gian.', visual: 'Bờ biển', actors: [{ assetId: 'moon', animation: 'idle', fromX: .2, toX: .8 }] }],
    }],
  });
  assert.equal(plan.version, 1);
  assert.equal(plan.status, 'draft');
  assert.equal(plan.narrationUnits[0]?.sceneId, 'scene-1');
  assert.equal(plan.beats[0]?.technique, 'sprite');
  assert.equal(plan.beats[0]?.cueText, 'thủy triều thay đổi');
  assert.equal(plan.beats[0]?.action?.description, 'Biên độ nước thay đổi theo thời gian.');
  assert.ok((plan.beats[0]?.failureConditions.length || 0) >= 2);
});
