import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAnimationProductionPlan, validateAnimationProductionPlanTimeline } from './animationPlan';

test('compiles an inspectable production contract from normalized beats', () => {
  const plan = compileAnimationProductionPlan({
    sceneIds: ['scene-1'],
    sceneDurationsMs: [5000],
    targetDurationMs: 5000,
    continuityBible: 'One consistent moon and earth design.',
    segments: [{
      title: 'Cơ chế',
      narration: 'Mặt Trăng biến mất và thủy triều thay đổi.',
      visualBeats: [{ narrationCue: 'thủy triều thay đổi', action: 'Biên độ nước thay đổi theo thời gian.', visual: 'Bờ biển', characterRefs: ['CAST_01'], actors: [{ assetId: 'moon', animation: 'idle', fromX: .2, toX: .8 }] }],
    }],
  });
  assert.equal(plan.version, 1);
  assert.equal(plan.status, 'draft');
  assert.equal(plan.targetDurationMs, 5000);
  assert.equal(plan.narrationUnits[0]?.sceneId, 'scene-1');
  assert.equal(plan.beats[0]?.technique, 'sprite');
  assert.equal(plan.beats[0]?.cueText, 'thủy triều thay đổi');
  assert.equal(plan.beats[0]?.action?.description, 'Biên độ nước thay đổi theo thời gian.');
  assert.deepEqual(plan.beats[0]?.characterRefs, ['CAST_01']);
  assert.ok((plan.beats[0]?.failureConditions.length || 0) >= 2);
});

test('preflights fractional scene timelines before image generation', () => {
  const durationMs = 9866.666666666668;
  const sceneIds = ['scene-1'];
  const sceneDurationsMs = [durationMs];
  const plan = compileAnimationProductionPlan({
    sceneIds,
    sceneDurationsMs,
    segments: [{
      title: 'Fractional frame duration',
      narration: 'Alpha beta gamma delta',
      visualBeats: [{ narrationCue: 'Alpha' }, { narrationCue: 'beta' }, { narrationCue: 'gamma' }, { narrationCue: 'delta' }],
    }],
  });

  assert.deepEqual(validateAnimationProductionPlanTimeline(plan, sceneIds, sceneDurationsMs), []);
  assert.ok(plan.beats.every((beat) => beat.endMs! <= durationMs));
});

test('preflight rejects a beat that exceeds its scene duration', () => {
  const plan = compileAnimationProductionPlan({
    sceneIds: ['scene-1'],
    sceneDurationsMs: [1000],
    segments: [{ title: 'Invalid duration', narration: 'Alpha beta', visualBeats: [{}, {}] }],
  });
  plan.beats[1]!.endMs = 1001;

  assert.deepEqual(validateAnimationProductionPlanTimeline(plan, ['scene-1'], [1000]), [
    'scene-1-beat-2: beat window is outside its scene duration',
  ]);
});
