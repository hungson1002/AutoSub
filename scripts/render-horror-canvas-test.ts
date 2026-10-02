import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createCanvasObject, type CanvasStudioObject, type CanvasStudioProject, type CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { defaultCanvasAssetRef, defaultCanvasBackgroundRef } from '../shared/canvasAssetRegistry';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import { workdir } from '../server/services/ffmpeg';

const execFileAsync = promisify(execFile);
const outDir = path.join(workdir, 'horror-canvas-test');
await mkdir(outDir, { recursive: true });

function object(kind: CanvasStudioObject['kind'], overrides: Partial<CanvasStudioObject>): CanvasStudioObject {
  const base = createCanvasObject(kind, { motion: 'none', ...overrides });
  return { ...base, assetRef: base.assetRef || defaultCanvasAssetRef(base) };
}

function scene(
  name: string,
  durationMs: number,
  template: CanvasStudioScene['template'],
  background: CanvasStudioScene['background'],
  objects: CanvasStudioObject[],
  options: Partial<CanvasStudioScene> = {},
): CanvasStudioScene {
  const draft: CanvasStudioScene = {
    id: randomUUID(),
    name,
    durationMs,
    template,
    background,
    visualBrief: name,
    narration: '',
    camera: { shot: template === 'close-reaction' ? 'close-up' : 'wide', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [],
    objects,
    ...options,
  };
  const horrorBackgroundRef = background === 'room'
    ? 'bg:room-stilt-house'
    : background === 'night'
      ? 'bg:night-stilt-house'
      : options.backgroundRef || defaultCanvasBackgroundRef(draft);
  const effects = (draft.effects || []).map((effect) =>
    effect.type === 'vignette' || effect.type === 'flashlight'
      ? { ...effect, startMs: 0, durationMs }
      : effect,
  );
  return { ...draft, effects, backgroundRef: horrorBackgroundRef };
}

const main = (overrides: Partial<CanvasStudioObject> = {}) => object('character', {
  label: 'Nam',
  characterKey: 'nam-horror',
  archetype: 'worker',
  hair: 'short',
  color: '#9a704e',
  secondaryColor: '#55656a',
  skinTone: '#ddb08a',
  role: 'focal',
  depth: 'midground',
  sizeClass: 'large',
  ...overrides,
});

const owner = (overrides: Partial<CanvasStudioObject> = {}) => object('character', {
  label: 'Bà chủ',
  characterKey: 'ba-chu',
  archetype: 'villager',
  hair: 'bun',
  color: '#6f765f',
  secondaryColor: '#806653',
  skinTone: '#d2a27e',
  role: 'support',
  depth: 'midground',
  sizeClass: 'large',
  ...overrides,
});

const scenes: CanvasStudioScene[] = [
  scene('Nhà sàn cô lập trong đêm', 6500, 'wide-establishing', 'night', [
    object('prop', { label: 'Tre tiền cảnh', variant: 'bamboo', role: 'support', slot: 'foreground-left', depth: 'foreground', sizeClass: 'large',
      keyframes: [{ atMs: 0, dx: 0, rotation: -1 }, { atMs: 3250, dx: 8, rotation: .6 }, { atMs: 6500, dx: 0, rotation: -1, easing: 'ease-in-out' }] }),
  ], {
    camera: { shot: 'wide', motion: 'push-in', focusX: 540, focusY: 400, zoom: 1.015 },
    effects: [
      { id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 1.65, startMs: 0, durationMs: 6500, zIndex: 90 },
      { id: randomUUID(), type: 'smoke', x: 350, y: 510, scale: 1.2, color: '#83908f', intensity: .4, startMs: 600, durationMs: 5000, zIndex: 8 },
    ],
  }),
  scene('Lời dặn trong căn nhà gỗ', 6200, 'two-shot', 'room', [
    main({ role: 'support', slot: 'hero-left', pose: 'idle', expression: 'neutral' }),
    owner({ role: 'focal', slot: 'hero-right', pose: 'point', expression: 'angry',
      keyframes: [{ atMs: 0, dx: 0 }, { atMs: 900, dx: -10, pose: 'point' }, { atMs: 2200, dx: 0, expression: 'neutral', easing: 'ease-in-out' }] }),
    object('prop', { label: 'Bếp lửa', variant: 'fire', role: 'background', slot: 'background-center', depth: 'background', sizeClass: 'medium' }),
  ], {
    camera: { shot: 'medium', motion: 'none', focusX: 770, focusY: 400, zoom: 1.02 },
    effects: [
      { id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 1.2, startMs: 0, durationMs: 3900, zIndex: 90 },
      { id: randomUUID(), type: 'glow', x: 640, y: 545, scale: 1.4, color: '#d98645', intensity: .45, startMs: 0, durationMs: 3900, zIndex: 7 },
    ],
    animationBeats: [
      { id: randomUUID(), atMs: 350, durationMs: 1000, action: 'point', targetIds: [], intensity: .7 },
    ],
  }),
  scene('Nằm nghe tiếng gõ', 7000, 'close-reaction', 'room', [
    main({ slot: 'hero', pose: 'idle', expression: 'neutral',
      keyframes: [{ atMs: 0, dx: 0, dy: 0 }, { atMs: 1300, dx: 8, expression: 'surprised' }, { atMs: 2800, dx: -5, rotation: -2, easing: 'ease-in-out' }] }),
    object('prop', { label: 'Giường', variant: 'bed', role: 'support', slot: 'mid-center', depth: 'midground', sizeClass: 'hero', color: '#725946', secondaryColor: '#b49a77' }),
  ], {
    camera: { shot: 'close-up', motion: 'push-in', focusX: 640, focusY: 385, zoom: 1.06 },
    effects: [
      { id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 1.5, startMs: 0, durationMs: 4200, zIndex: 90 },
      { id: randomUUID(), type: 'flashlight', x: 700, y: 330, scale: 1.6, color: '#d6b57e', intensity: .45, startMs: 0, durationMs: 4200, zIndex: 60 },
    ],
  }),
  scene('Insert sàn gỗ', 3000, 'prop-focus', 'room', [
    object('prop', { label: 'Ván sàn', variant: 'floorboard', role: 'focal', slot: 'hero', sizeClass: 'hero', color: '#654938', secondaryColor: '#8d674c',
      keyframes: [{ atMs: 0, dy: 0 }, { atMs: 900, dy: -5 }, { atMs: 1200, dy: 0 }, { atMs: 2100, dy: -4 }, { atMs: 2350, dy: 0, easing: 'snappy' }] }),
  ], {
    camera: { shot: 'extreme-close-up', motion: 'none', focusX: 640, focusY: 420, zoom: 1.12 },
    effects: [{ id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 1.8, startMs: 0, durationMs: 3000, zIndex: 90 }],
  }),
  scene('Bếp lửa yếu dần', 3600, 'prop-focus', 'room', [
    object('prop', { label: 'Bếp lửa', variant: 'fire', role: 'focal', slot: 'hero', sizeClass: 'large', color: '#b65339', secondaryColor: '#d59a45',
      keyframes: [{ atMs: 0, scale: 1, opacity: 1 }, { atMs: 2500, scale: .68, opacity: .62, easing: 'ease-in-out' }, { atMs: 3300, scale: .58, opacity: .5 }] }),
    object('prop', { label: 'Bát nước', variant: 'bowl', role: 'support', slot: 'support-right', sizeClass: 'medium', color: '#d3c4aa', secondaryColor: '#776658' }),
  ], {
    camera: { shot: 'close-up', motion: 'none', focusX: 610, focusY: 430, zoom: 1.05 },
    effects: [
      { id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 1.5, startMs: 0, durationMs: 3300, zIndex: 90 },
      { id: randomUUID(), type: 'smoke', x: 620, y: 315, scale: 1.2, color: '#aaa69d', intensity: .7, startMs: 0, durationMs: 3300, zIndex: 20 },
    ],
  }),
  scene('POV về cửa tối', 7000, 'foreground-pov', 'room', [], {
    camera: { shot: 'pov', motion: 'push-in', focusX: 660, focusY: 350, zoom: 1.04,
      keyframes: [{ atMs: 0, dx: 0, dy: 0, zoom: 1 }, { atMs: 7000, dx: 12, dy: -5, zoom: 1.055, easing: 'ease-in-out' }] },
    effects: [
      { id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 1.9, startMs: 0, durationMs: 4200, zIndex: 90 },
      { id: randomUUID(), type: 'flashlight', x: 665, y: 345, scale: 1.1, color: '#c7ad7c', intensity: .35, startMs: 0, durationMs: 4200, zIndex: 70 },
    ],
  }),
  scene('Giọng nói dưới sàn', 6500, 'close-reaction', 'room', [
    main({ slot: 'hero', pose: 'brace', expression: 'surprised',
      keyframes: [{ atMs: 0, dx: 0, scale: 1 }, { atMs: 900, dx: -12, scale: 1.04 }, { atMs: 2500, dx: -20, scale: 1.08, rotation: -2, easing: 'ease-in-out' }] }),
    object('prop', { label: 'Bát nước', variant: 'bowl', role: 'support', slot: 'support-right', sizeClass: 'small', opacity: .7 }),
  ], {
    camera: { shot: 'close-up', motion: 'none', focusX: 570, focusY: 360, zoom: 1.08 },
    effects: [
      { id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 2.1, startMs: 0, durationMs: 4100, zIndex: 90 },
      { id: randomUUID(), type: 'smoke', x: 820, y: 480, scale: 1.1, color: '#8c9390', intensity: .55, startMs: 500, durationMs: 3200, zIndex: 50 },
    ],
  }),
  scene('Bóng dưới gầm sàn', 5200, 'wide-establishing', 'night', [
    object('prop', { label: 'Bóng trắng', variant: 'ghost', role: 'focal', slot: 'background-center', depth: 'background', sizeClass: 'medium', opacity: .28,
      keyframes: [{ atMs: 0, opacity: 0, dy: 20 }, { atMs: 2400, opacity: .2, dy: 6, easing: 'ease-in-out' }, { atMs: 5200, opacity: 0, dy: -8, easing: 'ease-in-out' }] }),
  ], {
    camera: { shot: 'wide', motion: 'none', focusX: 640, focusY: 430, zoom: 1.05 },
    effects: [{ id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 2.2, startMs: 0, durationMs: 3300, zIndex: 90 }],
  }),
  scene('Sáng hôm sau', 6200, 'two-shot', 'room', [
    main({ role: 'support', slot: 'hero-left', pose: 'talk', expression: 'sad' }),
    owner({ role: 'focal', slot: 'hero-right', pose: 'idle', expression: 'surprised',
      keyframes: [{ atMs: 0, dx: 0 }, { atMs: 1600, dx: -8, expression: 'sad', easing: 'ease-in-out' }] }),
  ], {
    camera: { shot: 'medium', motion: 'none', focusX: 760, focusY: 390, zoom: 1.02 },
    effects: [{ id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: .75, startMs: 0, durationMs: 4000, zIndex: 90 }],
  }),
  scene('Kết bỏ lửng', 6500, 'wide-establishing', 'night', [
    object('prop', { label: 'Bát nước', variant: 'bowl', role: 'focal', slot: 'foreground-right', depth: 'foreground', sizeClass: 'medium', opacity: .58 }),
  ], {
    camera: { shot: 'wide', motion: 'pull-out', focusX: 640, focusY: 400, zoom: 1.06 },
    effects: [{ id: randomUUID(), type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 1.8, startMs: 0, durationMs: 3600, zIndex: 90 }],
  }),
];

const project: CanvasStudioProject = {
  version: 1,
  id: randomUUID(),
  name: 'Horror Ma Xo Canvas Test',
  width: 1280,
  height: 720,
  fps: 30,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  sourcePrompt: 'Internal horror reference visual regression test',
  scenes,
};

const result = await renderCanvasAnimationProject(project, 'horror-ma-xo-style-v3');
const videoOut = path.join(outDir, 'horror-ma-xo-v3.mp4');
await execFileAsync(process.platform === 'win32' ? 'cmd' : 'sh', process.platform === 'win32'
  ? ['/c', 'copy', '/Y', result.path, videoOut]
  : ['-lc', `cp "${result.path}" "${videoOut}"`]);

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const contact = path.join(outDir, 'horror-ma-xo-v3-contact.jpg');
await execFileAsync(ffmpeg, [
  '-y', '-i', videoOut,
  '-vf', 'fps=1/3,scale=320:180,tile=4x3',
  '-frames:v', '1', '-q:v', '3', contact,
], { maxBuffer: 20 * 1024 * 1024 });

console.log(JSON.stringify({ video: videoOut, contact, durationMs: scenes.reduce((sum, item) => sum + item.durationMs, 0), scenes: scenes.length }));
