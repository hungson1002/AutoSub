import type { AnimationCommand, CompositeScene, SceneLayer } from './animationStudio';

// Original AutoSub recipes, inspired by Shotcraft's parameterized shot-card
// workflow. Compile to the commands shared by canvas preview and Remotion.
export const motionRecipes = [
  { id: 'fade', name: 'Hiện dần', description: 'Đưa chữ hoặc hình vào nhẹ nhàng.' },
  { id: 'rise', name: 'Trượt lên', description: 'Hiện đối tượng từ phía dưới.' },
  { id: 'slide', name: 'Trượt ngang', description: 'Đưa đối tượng vào từ bên trái.' },
  { id: 'push', name: 'Phóng vào', description: 'Tiến gần để nhấn chi tiết.' },
  { id: 'pulse', name: 'Nhấn nhẹ', description: 'Phóng nhẹ rồi trở về kích thước gốc.' },
] as const;
export type MotionRecipeId = typeof motionRecipes[number]['id'];

export function compileMotionRecipe(layer: SceneLayer, recipe: MotionRecipeId, durationMs: number, strength = 1): AnimationCommand[] {
  const duration = Math.max(1, Math.round(Number.isFinite(durationMs) ? durationMs : 800));
  const amount = Math.max(.25, Math.min(2, Number.isFinite(strength) ? strength : 1));
  const base = layer.transform;
  const command = (type: AnimationCommand['type'], from: AnimationCommand['from'], to: AnimationCommand['to'], startMs = 0, length = duration): AnimationCommand => ({
    id: `recipe-${layer.id}-${recipe}-${startMs}-${type}`, targetId: layer.id, type,
    startMs, durationMs: length, from, to, easing: 'ease-in-out', parameters: { motionRecipe: recipe },
  });
  const fade = command('FADE_IN', 0, base.opacity);
  if (recipe === 'fade') return [fade];
  if (recipe === 'rise' || recipe === 'slide') {
    const offset = Math.max(12, Math.min(layer.width, layer.height) * .25) * amount;
    return [fade, command('MOVE', { x: base.position.x - (recipe === 'slide' ? offset : 0), y: base.position.y + (recipe === 'rise' ? offset : 0) }, { ...base.position })];
  }
  const enlarged = { x: base.scale.x * (1 + .12 * amount), y: base.scale.y * (1 + .12 * amount) };
  if (recipe === 'push') return [command('SCALE', { ...base.scale }, enlarged)];
  const half = Math.floor(duration / 2);
  return [command('SCALE', { ...base.scale }, enlarged, 0, half), command('SCALE', enlarged, { ...base.scale }, half, duration - half)];
}

export function applyMotionRecipe(scene: CompositeScene, layerId: string, recipe: MotionRecipeId, durationMs: number, strength: number): CompositeScene {
  const layer = scene.layers.find((item) => item.id === layerId);
  if (!layer || layer.locked || layer.type === 'audio') return scene;
  const commands = compileMotionRecipe(layer, recipe, Math.min(scene.durationMs, durationMs), strength);
  const replacedTypes = new Set(commands.map((item) => item.type));
  return { ...scene, commands: [...scene.commands.filter((item) => item.targetId !== layerId || (!item.parameters?.motionRecipe && !replacedTypes.has(item.type))), ...commands] };
}
