import { randomUUID } from 'node:crypto';
import { createProceduralCharacter } from '../server/services/animationCharacters';
import { buildBeatPerformances } from '../server/services/animationDirector';
import { renderAnimationProject } from '../server/services/animationRender';
import { defaultTransform, type AnimationProject, type SceneLayer } from '../shared/animationStudio';

async function main() {
  const actor = createProceduralCharacter({ name: 'Robot demo', kind: 'robot', color: '#54d8c2' });
  const width = 1280, height = 720, durationMs = 8000;
  const performance = buildBeatPerformances({ sceneIndex: 0, width, height, durationMs, assets: [actor], beats: [
    { purpose: 'Đi bộ', visual: '', motion: 'locked', transition: 'cut', actors: [{ assetId: actor.id, animation: 'walk', fromX: .2, toX: .45, y: .6 }] },
    { purpose: 'Giải thích', visual: '', motion: 'locked', transition: 'cut', actors: [{ assetId: actor.id, animation: 'point', fromX: .45, toX: .45, y: .6 }] },
    { purpose: 'Chạy', visual: '', motion: 'locked', transition: 'cut', actors: [{ assetId: actor.id, animation: 'run', fromX: .45, toX: .8, y: .6 }] },
    { purpose: 'Kết thúc', visual: '', motion: 'locked', transition: 'cut', actors: [{ assetId: actor.id, animation: 'talk', fromX: .8, toX: .8, y: .6 }] },
  ] });
  const layers: SceneLayer[] = [
    { id: 'floor', type: 'shape', shape: 'rectangle', name: 'Sàn', width, height: 4, fill: '#315263', visible: true, locked: true, zIndex: 0, transform: { ...defaultTransform(), position: { x: width / 2, y: height * .73 } } },
    { id: 'title', type: 'text', name: 'Demo', text: 'ĐI BỘ → CHỈ TAY → CHẠY → NÓI', width: 1100, height: 90, fontSize: 40, fill: '#eaf7f3', visible: true, locked: true, zIndex: 1, transform: { ...defaultTransform(), position: { x: width / 2, y: 110 } } },
    ...performance.layers,
  ];
  const now = new Date().toISOString();
  const project: AnimationProject = { schemaVersion: 1, id: randomUUID(), name: 'Articulated sprite QA', width, height, fps: 30, createdAt: now, updatedAt: now, assets: [actor], scenes: [{ id: 'demo', name: 'Rig demo', order: 0, durationMs, narration: '', renderMode: 'composite', backgroundColor: '#091825', layers, commands: performance.commands, camera: { transform: defaultTransform(), commands: [] } }] };
  console.log(await renderAnimationProject(project, false));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
