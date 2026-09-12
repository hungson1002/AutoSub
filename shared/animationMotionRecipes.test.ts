import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTransform, type SceneLayer, type CompositeScene } from './animationStudio';
import { motionRecipes, compileMotionRecipe, applyMotionRecipe } from './animationMotionRecipes';
import { evaluateTransform } from '../src/animationStudio/evaluator';

const layer: SceneLayer = { id: 'title', name: 'Title', type: 'text', visible: true, locked: false, width: 200, height: 80, zIndex: 1, transform: defaultTransform() };
const scene: CompositeScene = { id: 'scene', name: 'Scene', order: 0, narration: '', durationMs: 500, renderMode: 'composite', backgroundColor: '#000000', layers: [layer], commands: [], camera: { transform: defaultTransform(), commands: [] } };

test('every motion recipe evaluates identically after serialization and arbitrary seeking', () => {
  for (const recipe of motionRecipes) {
    const commands = compileMotionRecipe(layer, recipe.id, 800, 1);
    const restored = JSON.parse(JSON.stringify(commands));
    for (const time of [0, 400, 800, 200, 400]) {
      assert.deepEqual(evaluateTransform(layer.transform, commands, time), evaluateTransform(layer.transform, restored, time));
    }
    if (recipe.id !== 'push') assert.deepEqual(evaluateTransform(layer.transform, commands, 800), layer.transform);
  }
});

test('applying a recipe stays in scene bounds and replaces prior recipe without accumulating commands', () => {
  const first = applyMotionRecipe(scene, layer.id, 'rise', 800, 1);
  const second = applyMotionRecipe(first, layer.id, 'pulse', 800, 1);
  assert.equal(first.commands.length, 2);
  assert.equal(second.commands.length, 2);
  assert.ok(second.commands.every((command) => command.startMs + command.durationMs <= scene.durationMs));
  assert.equal(scene.commands.length, 0);
  assert.equal(applyMotionRecipe({ ...scene, layers: [{ ...layer, locked: true }] }, layer.id, 'fade', 800, 1).commands.length, 0);
});
