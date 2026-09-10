import { createEmptyAnimationProject, saveAnimationProject } from '../server/services/animationProjects';
import { normalizeAnimatedObjects } from '../server/services/animationObjects';
import { buildBeatPerformances } from '../server/services/animationDirector';
import { renderAnimationProject } from '../server/services/animationRender';
import { defaultTransform } from '../shared/animationStudio';

const project = createEmptyAnimationProject({ name: 'QA chuyển động đối tượng độc lập', width: 1280, height: 720, fps: 30 });
const objects = normalizeAnimatedObjects([
  { name: 'Tâm quỹ đạo', shape: 'ellipse', fill: '#288bd4', width: .18, height: .32, path: [{ t: 0, x: .5, y: .4 }, { t: 1, x: .5, y: .4 }] },
  { name: 'Vệ tinh chuyển động', shape: 'rectangle', fill: '#ffc770', width: .045, height: .065, path: Array.from({ length: 17 }, (_, i) => ({ t: i / 16, x: .5 + .28 * Math.cos(i / 16 * Math.PI * 2), y: .4 + .24 * Math.sin(i / 16 * Math.PI * 2), rotation: i / 16 * 360 })) },
]);
const performance = buildBeatPerformances({ sceneIndex: 0, width: project.width, height: project.height, durationMs: 5000, assets: [], beats: [{ purpose: 'Minh họa đường đi', visual: '', motion: 'locked', transition: 'cut', objects }] });
project.scenes = [{ id: 'orbit', name: 'Kiểm tra chuyển động', order: 0, durationMs: 5000, narration: '', renderMode: 'composite', backgroundColor: '#091825', layers: performance.layers, commands: performance.commands, camera: { transform: defaultTransform(), commands: [] } }];
await saveAnimationProject(project);
console.log(JSON.stringify(await renderAnimationProject(project, false)));
