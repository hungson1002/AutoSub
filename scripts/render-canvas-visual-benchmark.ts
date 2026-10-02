import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioProject, CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const actor = (id: string, role: 'focal' | 'support', slot: CanvasStudioScene['objects'][number]['slot'], pose: CanvasStudioScene['objects'][number]['pose'], facing: 'left' | 'right', archetype: CanvasStudioScene['objects'][number]['archetype'] = 'narrator') => ({
  id,
  kind: 'character' as const,
  label: id,
  assetRef: `character:${archetype}`,
  characterKey: id,
  archetype,
  hair: archetype === 'warrior' ? 'hat' as const : 'short' as const,
  role,
  slot,
  depth: 'midground' as const,
  sizeClass: role === 'focal' ? 'large' as const : 'medium' as const,
  pose,
  expression: pose === 'brace' ? 'surprised' as const : 'neutral' as const,
  facing,
  x: 640,
  y: 360,
  width: 170,
  height: 370,
  scale: 1,
  rotation: 0,
  opacity: 1,
  color: '#d3a34c',
  secondaryColor: '#657577',
  skinTone: '#ddb08a',
  accent: '#2f2b27',
  zIndex: 20,
  motion: 'none' as const,
  delayMs: 0,
  motionDurationMs: 480,
  motionCurve: 'cinematic' as const,
  motionIntensity: 1,
});

const prop = (
  id: string,
  variant: CanvasStudioScene['objects'][number]['variant'],
  role: 'focal' | 'support',
  slot: CanvasStudioScene['objects'][number]['slot'],
  sizeClass: CanvasStudioScene['objects'][number]['sizeClass'] = 'medium',
) => ({
  id,
  kind: 'prop' as const,
  label: id,
  assetRef: `prop:${variant}`,
  variant,
  role,
  slot,
  depth: slot?.startsWith('foreground') ? 'foreground' as const : 'midground' as const,
  sizeClass,
  x: 640,
  y: 360,
  width: 220,
  height: 220,
  scale: 1,
  rotation: 0,
  opacity: 1,
  color: '#b78a5d',
  secondaryColor: '#7a8270',
  accent: '#2f2b27',
  zIndex: 15,
  motion: 'none' as const,
  delayMs: 0,
  motionDurationMs: 480,
  motionCurve: 'smooth' as const,
  motionIntensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(),
    name: '01 hero myth',
    durationMs: 2400,
    template: 'hero-left',
    background: 'night',
    backgroundRef: 'bg:night-river',
    visualBrief: 'Legendary hero at night by the water, flag support on the right, editorial negative space.',
    camera: { shot: 'medium', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      { id: randomUUID(), atMs: 260, durationMs: 760, action: 'point', targetIds: ['hero-warrior'], intensity: 1 },
      { id: randomUUID(), atMs: 620, durationMs: 680, action: 'reveal', targetIds: ['hero-flag'], intensity: 1 },
      { id: randomUUID(), atMs: 1380, durationMs: 650, action: 'react', targetIds: ['hero-warrior'], intensity: .7 },
    ],
    objects: [
      actor('hero-warrior', 'focal', 'hero-left', 'point', 'right', 'warrior'),
      prop('hero-flag', 'flag', 'support', 'support-right', 'medium'),
    ],
  },
  {
    id: randomUUID(),
    name: '02 ordinary city',
    durationMs: 2300,
    template: 'hero-right',
    background: 'city',
    backgroundRef: 'bg:city-street',
    visualBrief: 'Ordinary person on a city street, asymmetrical framing, quiet supporting barrel in foreground left.',
    camera: { shot: 'medium', motion: 'pan-right', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      { id: randomUUID(), atMs: 180, durationMs: 900, action: 'talk', targetIds: ['ordinary-person'], intensity: .85 },
      { id: randomUUID(), atMs: 620, durationMs: 520, action: 'reveal', targetIds: ['barrel-context'], intensity: .9 },
      { id: randomUUID(), atMs: 1320, durationMs: 620, action: 'react', targetIds: ['ordinary-person'], intensity: .6 },
    ],
    objects: [
      actor('ordinary-person', 'focal', 'hero-right', 'talk', 'left', 'narrator'),
      prop('barrel-context', 'barrel', 'support', 'foreground-left', 'small'),
    ],
  },
  {
    id: randomUUID(),
    name: '03 camp discovery',
    durationMs: 2400,
    template: 'prop-focus',
    background: 'field',
    backgroundRef: 'bg:field-camp',
    visualBrief: 'Warm camp scene, fire as focal semantic prop, person reacting from the left, trees as background context.',
    camera: { shot: 'medium', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      { id: randomUUID(), atMs: 120, durationMs: 1200, action: 'pulse', targetIds: ['camp-fire'], intensity: .75 },
      { id: randomUUID(), atMs: 520, durationMs: 760, action: 'talk', targetIds: ['ordinary-person'], intensity: .8 },
      { id: randomUUID(), atMs: 1280, durationMs: 720, action: 'react', targetIds: ['ordinary-person'], intensity: .7 },
    ],
    objects: [
      prop('camp-fire', 'fire', 'focal', 'hero', 'hero'),
      actor('ordinary-person', 'support', 'support-left', 'talk', 'right', 'narrator'),
      prop('camp-tree', 'tree', 'background', 'background-right', 'small'),
    ],
  },
  {
    id: randomUUID(),
    name: '04 reaction two shot',
    durationMs: 2400,
    template: 'two-shot',
    background: 'field',
    backgroundRef: 'bg:field-open',
    visualBrief: 'Two-person reaction shot with clearly different silhouettes and no floating equipment.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      { id: randomUUID(), atMs: 180, durationMs: 780, action: 'brace', targetIds: ['serious-person'], intensity: .85 },
      { id: randomUUID(), atMs: 540, durationMs: 900, action: 'talk', targetIds: ['ordinary-person'], intensity: .85 },
      { id: randomUUID(), atMs: 1320, durationMs: 620, action: 'react', targetIds: ['serious-person'], intensity: .65 },
    ],
    objects: [
      actor('serious-person', 'focal', 'hero-left', 'brace', 'right', 'worker'),
      actor('ordinary-person', 'support', 'hero-right', 'talk', 'left', 'narrator'),
    ],
  },
  {
    id: randomUUID(),
    name: '05 shield subject',
    durationMs: 2200,
    template: 'foreground-pov',
    background: 'paper',
    backgroundRef: 'bg:paper-editorial',
    visualBrief: 'Shield itself is the story subject in foreground, character remains secondary in midground.',
    camera: { shot: 'pov', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      { id: randomUUID(), atMs: 140, durationMs: 620, action: 'reveal', targetIds: ['shield-subject'], intensity: 1 },
      { id: randomUUID(), atMs: 680, durationMs: 760, action: 'point', targetIds: ['ordinary-person'], intensity: .9 },
      { id: randomUUID(), atMs: 1380, durationMs: 520, action: 'pulse', targetIds: ['shield-subject'], intensity: .65 },
    ],
    objects: [
      prop('shield-subject', 'shield', 'focal', 'foreground-left', 'hero'),
      actor('ordinary-person', 'support', 'mid-right', 'point', 'left', 'narrator'),
    ],
  },
  {
    id: randomUUID(),
    name: '06 close reaction',
    durationMs: 2200,
    template: 'close-reaction',
    background: 'room',
    backgroundRef: 'bg:room-study',
    visualBrief: 'Clean interior close reaction, actor dominates frame, minimal furniture context.',
    camera: { shot: 'close-up', motion: 'pull-out', focusX: 640, focusY: 360, zoom: 1.02 },
    effects: [],
    animationBeats: [
      { id: randomUUID(), atMs: 120, durationMs: 820, action: 'talk', targetIds: ['ordinary-person'], intensity: .85 },
      { id: randomUUID(), atMs: 980, durationMs: 620, action: 'react', targetIds: ['ordinary-person'], intensity: .6 },
      { id: randomUUID(), atMs: 1520, durationMs: 520, action: 'talk', targetIds: ['ordinary-person'], intensity: .7 },
    ],
    objects: [
      actor('ordinary-person', 'focal', 'hero', 'talk', 'right', 'narrator'),
    ],
  },
];

const project = compileCanvasProjectLayout({
  version: 1,
  id: randomUUID(),
  name: 'Canvas Visual Benchmark',
  width: 1280,
  height: 720,
  fps: 30,
  scenes,
} satisfies CanvasStudioProject);

const report = evaluateCanvasVisualQuality(project);
console.log('VISUAL_QUALITY', JSON.stringify(report, null, 2));
if (!report.pass) {
  throw new Error(`Visual benchmark plan failed deterministic QC with score ${report.score}.`);
}

const result = await renderCanvasAnimationProject(project, 'canvas-visual-benchmark-v1');
const contact = resolve('workdir/visual-benchmark/canvas-visual-benchmark-v1.jpg');
mkdirSync(dirname(contact), { recursive: true });
execFileSync('ffmpeg', [
  '-y',
  '-i', result.path,
  '-vf', 'fps=1/2,scale=480:-1,tile=4x2',
  '-frames:v', '1',
  contact,
], { stdio: 'ignore' });

console.log(JSON.stringify({
  video: result.path,
  bytes: result.size,
  contact,
  report,
}, null, 2));
