import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCalibrationStoryboardIndexes } from './animationCalibration';

test('calibration batch samples systemic risk categories before full generation', () => {
  const tasks = [
    { sceneIndex: 0, beatIndex: 0, beat: { purpose: 'story', visual: 'A man reaches into his pocket.', characterRefs: ['CAST_01'] } },
    { sceneIndex: 0, beatIndex: 1, beat: { purpose: 'reaction', visual: 'CAST_01 looks confused.', characterRefs: ['CAST_01'] } },
    { sceneIndex: 1, beatIndex: 0, beat: { purpose: 'story', visual: 'The mascot stands beside CAST_02.', characterRefs: ['mascot', 'CAST_02'] } },
    { sceneIndex: 2, beatIndex: 0, beat: { purpose: 'story', visual: 'A woman scientist washes a cup.', characterRefs: [] } },
    { sceneIndex: 3, beatIndex: 0, beat: { purpose: 'label', visual: 'Simple label frame.', onScreenText: 'GỢI NHỚ', characterRefs: [] } },
    { sceneIndex: 4, beatIndex: 0, beat: { purpose: 'comparison', visual: 'A hand-drawn comparison diagram.', characterRefs: [] } },
    { sceneIndex: 5, beatIndex: 0, beat: { purpose: 'detail', visual: 'Close-up detail of keys.', characterRefs: [] } },
    { sceneIndex: 6, beatIndex: 0, beat: { purpose: 'story', visual: 'Empty hallway.', characterRefs: [] } },
  ];
  const indexes = selectCalibrationStoryboardIndexes(tasks, 7);
  assert.ok(indexes.includes(0));
  assert.ok(indexes.includes(2));
  assert.ok(indexes.includes(3));
  assert.ok(indexes.includes(4));
  assert.ok(indexes.includes(5));
  assert.ok(indexes.includes(6));
  assert.equal(new Set(indexes).size, indexes.length);
  assert.ok(indexes.length <= 7);
});
