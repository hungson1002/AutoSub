import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { createCanvasObject, type CanvasStudioProject, type CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const now = new Date().toISOString();
const projectId = randomUUID();

function actor(label: string, key: string, overrides: any = {}) {
  return createCanvasObject('character', {
    label,
    characterKey: key,
    archetype: overrides.archetype || 'worker',
    hair: overrides.hair || 'short',
    role: overrides.role || 'focal',
    slot: overrides.slot || 'hero',
    depth: overrides.depth || 'midground',
    sizeClass: overrides.sizeClass || 'large',
    motion: 'none',
    expression: overrides.expression || 'neutral',
    pose: overrides.pose || 'idle',
    facing: overrides.facing || 'right',
    color: overrides.color || '#66747a',
    secondaryColor: overrides.secondaryColor || '#3e484c',
    skinTone: overrides.skinTone || '#d4a47f',
    assetRef: 'character:' + (overrides.archetype || 'worker'),
    designNotes: overrides.designNotes,
  });
}

function scene(name: string, shot: NonNullable<CanvasStudioScene['camera']>['shot'], objects: ReturnType<typeof createCanvasObject>[], template: CanvasStudioScene['template'] = 'close-reaction'): CanvasStudioScene {
  return {
    id: randomUUID(),
    name,
    durationMs: 1600,
    template,
    background: 'room',
    backgroundRef: 'bg:room-stilt-house',
    visualBrief: 'Horror character gallery. Dark timber interior. Restrained editorial hand-drawn character acting.',
    narration: '',
    camera: { shot, motion: 'none', focusX: 640, focusY: 360, zoom: shot === 'close-up' ? 1.08 : 1 },
    effects: [{ id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, intensity: .8, startMs: 0, durationMs: 1600, zIndex: 90 }],
    objects,
  };
}

const scenes: CanvasStudioScene[] = [
  scene('Wide cast silhouette', 'wide', [
    actor('Minh', 'hero-minh', { slot: 'hero-left', sizeClass: 'medium', archetype: 'worker', hair: 'short', role: 'focal' }),
    actor('Bà chủ', 'ba-chu', { slot: 'hero-right', sizeClass: 'medium', archetype: 'villager', hair: 'bun', color: '#79604f', secondaryColor: '#51463f', designNotes: 'older woman, gaunt, stern' }),
    actor('Người làng', 'villager-02', { slot: 'background-right', sizeClass: 'small', archetype: 'villager', hair: 'crop', color: '#675b50' }),
  ], 'two-shot'),
  scene('Medium neutral', 'medium', [
    actor('Minh', 'hero-minh', { slot: 'hero', sizeClass: 'hero', expression: 'neutral' }),
  ]),
  scene('Close uneasy', 'close-up', [
    actor('Minh', 'hero-minh', { slot: 'hero', sizeClass: 'hero', expression: 'sad' }),
  ]),
  scene('Close frightened', 'close-up', [
    actor('Minh', 'hero-minh', { slot: 'hero', sizeClass: 'hero', expression: 'surprised', pose: 'brace' }),
  ]),
  scene('Older woman close', 'close-up', [
    actor('Bà chủ', 'ba-chu', { slot: 'hero', sizeClass: 'hero', archetype: 'villager', hair: 'bun', expression: 'sad', pose: 'talk', color: '#79604f', secondaryColor: '#51463f', designNotes: 'older woman, gaunt, stern, tired eyes' }),
  ]),
  scene('IK point pose', 'medium', [
    actor('Minh', 'hero-minh', { slot: 'hero-left', sizeClass: 'large', pose: 'point', expression: 'neutral', facing: 'right' }),
    createCanvasObject('prop', { label: 'Cửa', variant: 'door', assetRef: 'prop:door', slot: 'support-right', sizeClass: 'large', role: 'support', motion: 'none', color: '#49382f' }),
  ], 'hero-left'),
];

const project: CanvasStudioProject = compileCanvasProjectLayout({
  version: 1,
  id: projectId,
  name: 'Character Renderer V2 Gallery',
  width: 1280,
  height: 720,
  fps: 30,
  createdAt: now,
  updatedAt: now,
  sourcePrompt: 'Horror character gallery Ma Xó, code-first vector rig.',
  scenes,
});

const outDir = path.resolve('tmp/character-v2');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
const result = await renderCanvasAnimationProject(project);
const target = path.join(outDir, 'character-v2.mp4');
await copyFile(result.path, target);
console.log('CHARACTER_V2_VIDEO=' + target);
console.log('SOURCE_VIDEO=' + result.path);
