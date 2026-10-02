import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import { workdir } from '../server/services/ffmpeg';
import {
  createCanvasObject,
  type CanvasStudioObject,
  type CanvasStudioProject,
  type CanvasStudioScene,
} from '../shared/canvasAnimationStudio';

/**
 * 1-minute Canvas showcase v2: same 10x6s tour, but every object carries an
 * explicit slot/depth/sizeClass so the layout compiler stages scenes
 * intentionally instead of stacking everything at the center.
 */
const W = 1280;
const H = 720;
const FPS = 30;
const SCENE_MS = 6000;
const outRoot = path.join(workdir, 'canvas-showcase-1min');

let counter = 100;
const oid = (prefix: string) => `${prefix}-${String(counter += 1).padStart(2, '0')}`;

function character(overrides: Partial<CanvasStudioObject> = {}) {
  return createCanvasObject('character', { id: oid('obj'), depth: 'midground', sizeClass: 'large', ...overrides });
}
function title(text: string) {
  return createCanvasObject('text', {
    id: oid('obj'), text, width: 620, height: 110, zIndex: 30,
    slot: 'caption-top', depth: 'midground', sizeClass: 'medium', motion: 'pop',
  });
}

function scene(base: Partial<CanvasStudioScene> & { name: string }): CanvasStudioScene {
  return {
    id: `scene-${randomUUID().slice(0, 8)}`,
    durationMs: SCENE_MS,
    background: 'river',
    camera: { shot: 'wide', motion: 'none', focusX: W / 2, focusY: H / 2, zoom: 1 },
    effects: [],
    animationBeats: [],
    objects: [],
    ...base,
  } as CanvasStudioScene;
}

async function main() {
  // S1: hero-left template — general left, stakes right background, title top.
  const hero = character({ slot: 'hero-left', expression: 'angry', pose: 'talk', motion: 'slide-left', archetype: 'warrior', hair: 'hat', designNotes: 'vị tướng già mặc giáp', label: 'Tran Hung Dao' });
  const s1 = scene({
    name: '01 Mo man Bach Dang',
    background: 'river',
    template: 'hero-left',
    camera: { shot: 'wide', motion: 'push-in', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [
      hero,
      title('3 lan - 1 meo'),
      createCanvasObject('stake', { id: oid('obj'), slot: 'background-right', depth: 'background', sizeClass: 'medium', rotation: -10, motion: 'pop', label: 'Coc 1' }),
      createCanvasObject('stake', { id: oid('obj'), slot: 'mid-right', depth: 'midground', sizeClass: 'medium', rotation: 8, motion: 'pop', label: 'Coc 2' }),
    ],
    effects: [{ id: 'fx-s1', type: 'glow', x: 370, y: 400, scale: 1.4, color: '#ffd98b', intensity: 1, durationMs: 3000 }],
  });
  s1.animationBeats = [{ id: 'beat-s1', atMs: 400, durationMs: 4800, action: 'talk', targetIds: [hero.id], intensity: 1 }];

  // S2: ships mid-river, scout foreground watching, stakes far background.
  const ship1 = createCanvasObject('ship', { id: oid('obj'), slot: 'mid-center', depth: 'midground', sizeClass: 'hero', motion: 'drift-left', label: 'Thuyen Nguyen' });
  const ship2 = createCanvasObject('ship', { id: oid('obj'), x: 0, y: 0, slot: 'background-right', depth: 'background', sizeClass: 'small', motion: 'drift-left', label: 'Thuyen 2' });
  const scout = character({ slot: 'foreground-left', depth: 'foreground', sizeClass: 'medium', expression: 'surprised', pose: 'brace', motion: 'pop', archetype: 'villager', label: 'Dan binh' });
  const s2 = scene({
    name: '02 Thuyen mac coc',
    background: 'river',
    template: 'wide-establishing',
    camera: { shot: 'wide', motion: 'follow', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [
      ship1, ship2, scout,
      createCanvasObject('stake', { id: oid('obj'), slot: 'background-center', depth: 'background', sizeClass: 'small', motion: 'pop', label: 'Coc ngam' }),
      createCanvasObject('stake', { id: oid('obj'), slot: 'background-left', depth: 'background', sizeClass: 'small', rotation: 6, motion: 'pop', label: 'Coc ngam 2' }),
      title('Nuoc rut - thuyen mac can'),
    ],
    effects: [
      { id: 'fx-s2a', type: 'splash', x: 640, y: 560, scale: 1.6, color: '#bfe9f5', intensity: 2, startMs: 1800, durationMs: 1600 },
      { id: 'fx-s2b', type: 'impact', x: 700, y: 480, scale: 1.2, color: '#ffd98b', intensity: 1.6, startMs: 2000, durationMs: 1200 },
    ],
  });
  s2.animationBeats = [
    { id: 'beat-s2a', atMs: 2000, durationMs: 1500, action: 'react', targetIds: [scout.id], intensity: 1.4 },
    { id: 'beat-s2b', atMs: 2200, durationMs: 1200, action: 'impact', targetIds: [ship1.id], intensity: 2 },
  ];

  // S3: march across midground, title top.
  const march1 = character({ slot: 'mid-center', pose: 'run', motion: 'walk-right', archetype: 'warrior', label: 'Quan Tran 1' });
  const march2 = character({ slot: 'mid-left', sizeClass: 'medium', pose: 'run', motion: 'walk-right', archetype: 'sailor', label: 'Quan Tran 2' });
  const s3 = scene({
    name: '03 Hanh quan',
    background: 'field',
    template: 'wide-establishing',
    camera: { shot: 'wide', motion: 'follow', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [march1, march2, title('Quan Tran do ra')],
    effects: [{ id: 'fx-s3', type: 'dust', x: 300, y: 620, scale: 1.4, color: '#d9c4a2', intensity: 1.4, durationMs: 5000 }],
  });
  s3.animationBeats = [{ id: 'beat-s3', atMs: 500, durationMs: 4000, action: 'run', targetIds: [march1.id, march2.id], intensity: 1.2 }];

  // S4: two-shot commander + advisor.
  const commander = character({ slot: 'hero-left', expression: 'angry', pose: 'point', motion: 'slide-left', archetype: 'warrior', hair: 'hat', designNotes: 'vị tướng già mặc giáp', label: 'Chu soai' });
  const advisor = character({ slot: 'hero-right', expression: 'happy', pose: 'talk', motion: 'slide-right', archetype: 'scholar', label: 'Quan si' });
  const s4 = scene({
    name: '04 Chi huy',
    background: 'field',
    template: 'two-shot',
    camera: { shot: 'medium', motion: 'push-in', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [commander, advisor, title('Duoi theo - bat het')],
    effects: [{ id: 'fx-s4', type: 'arrows', x: 640, y: 300, scale: 1, color: '#ff8a5c', intensity: 1.2, startMs: 1500, durationMs: 2500 }],
  });
  s4.animationBeats = [
    { id: 'beat-s4a', atMs: 600, durationMs: 1800, action: 'point', targetIds: [commander.id], intensity: 1.3 },
    { id: 'beat-s4b', atMs: 1200, durationMs: 3200, action: 'talk', targetIds: [advisor.id], intensity: 1 },
  ];

  // S5: single ship focus center.
  const hitShip = createCanvasObject('ship', { id: oid('obj'), slot: 'mid-center', depth: 'midground', sizeClass: 'hero', motion: 'hit', label: 'Thuyen dich' });
  const s5 = scene({
    name: '05 Va dap',
    background: 'river',
    template: 'prop-focus',
    camera: { shot: 'medium', motion: 'impact', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [hitShip, title('Vo tran!')],
    effects: [
      { id: 'fx-s5a', type: 'impact', x: 640, y: 420, scale: 1.8, color: '#ffe9a8', intensity: 2.5, startMs: 1200, durationMs: 1400 },
      { id: 'fx-s5b', type: 'splash', x: 640, y: 580, scale: 2, color: '#bfe9f5', intensity: 2.5, startMs: 1400, durationMs: 1800 },
    ],
  });
  s5.animationBeats = [{ id: 'beat-s5', atMs: 1200, durationMs: 1400, action: 'impact', targetIds: [hitShip.id], intensity: 2.2 }];

  // S6: props spread across mid slots, small size.
  const s6 = scene({
    name: '06 Dao cu',
    background: 'paper',
    template: 'diagram-clean',
    camera: { shot: 'wide', motion: 'pull-out', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [
      createCanvasObject('prop', { id: oid('obj'), slot: 'mid-left', depth: 'midground', sizeClass: 'small', motion: 'float', label: 'Cay', variant: 'tree' }),
      createCanvasObject('prop', { id: oid('obj'), slot: 'mid-center', depth: 'midground', sizeClass: 'small', motion: 'pulse', label: 'Co', variant: 'flag' }),
      createCanvasObject('prop', { id: oid('obj'), slot: 'mid-right', depth: 'midground', sizeClass: 'small', motion: 'bounce', label: 'Kiem', variant: 'sword' }),
      createCanvasObject('prop', { id: oid('obj'), slot: 'foreground-right', depth: 'foreground', sizeClass: 'small', motion: 'float', label: 'Khien', variant: 'shield' }),
      title('Ke cho con nuoc'),
    ],
    effects: [{ id: 'fx-s6', type: 'glow', x: 640, y: 400, scale: 2, color: '#ffe9a8', intensity: 0.8, durationMs: 5000 }],
  });

  // S7: night sky props up, guard foreground.
  const s7 = scene({
    name: '07 Dem truoc tran',
    background: 'night',
    template: 'wide-establishing',
    camera: { shot: 'wide', motion: 'pan-left', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [
      createCanvasObject('prop', { id: oid('obj'), slot: 'background-right', depth: 'background', sizeClass: 'small', motion: 'float', label: 'Trang', variant: 'moon' }),
      createCanvasObject('prop', { id: oid('obj'), slot: 'background-left', depth: 'background', sizeClass: 'small', motion: 'drift-right', label: 'May', variant: 'cloud' }),
      character({ slot: 'foreground-left', depth: 'foreground', sizeClass: 'medium', pose: 'idle', expression: 'neutral', motion: 'none', archetype: 'villager', label: 'Linh gac' }),
      createCanvasObject('text', { id: oid('obj'), text: 'Dem truoc gio G', width: 480, height: 90, zIndex: 30, slot: 'caption-bottom', depth: 'midground', sizeClass: 'medium', motion: 'pop' }),
    ],
    effects: [{ id: 'fx-s7', type: 'vignette', x: 640, y: 360, scale: 1, color: '#000000', intensity: 1, durationMs: 6000 }],
  });

  // S8: narrator hero center.
  const narrator = character({ slot: 'hero', sizeClass: 'hero', pose: 'talk', expression: 'neutral', motion: 'none', archetype: 'narrator', label: 'Nguoi ke' });
  const s8 = scene({
    name: '08 Loi ke',
    background: 'room',
    template: 'close-reaction',
    camera: { shot: 'close-up', motion: 'push-in', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [narrator, title('Hang van quan Nguyen khong ve duoc')],
  });
  s8.animationBeats = [{ id: 'beat-s8', atMs: 300, durationMs: 5200, action: 'talk', targetIds: [narrator.id], intensity: 1 }];

  // S9: two-shot defeat.
  const faller = character({ slot: 'mid-left', pose: 'idle', expression: 'sad', motion: 'fall', archetype: 'sailor', label: 'Linh dich' });
  const tilter = character({ slot: 'mid-right', pose: 'brace', expression: 'surprised', motion: 'tilt-right', archetype: 'sailor', label: 'Linh dich 2' });
  const s9 = scene({
    name: '09 That bai',
    background: 'city',
    template: 'two-shot',
    camera: { shot: 'medium', motion: 'impact', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [faller, tilter],
    effects: [
      { id: 'fx-s9a', type: 'smoke', x: 640, y: 500, scale: 1.6, color: '#8d8d8d', intensity: 1.6, durationMs: 5000 },
      { id: 'fx-s9b', type: 'speed-lines', x: 640, y: 360, scale: 1.2, color: '#ffffff', intensity: 1, startMs: 800, durationMs: 1500 },
    ],
  });
  s9.animationBeats = [{ id: 'beat-s9', atMs: 800, durationMs: 1600, action: 'react', targetIds: [tilter.id], intensity: 1.6 }];

  // S10: victory two-shot + flag background.
  const win1 = character({ slot: 'hero-left', pose: 'celebrate', expression: 'happy', motion: 'pop', archetype: 'warrior', hair: 'hat', designNotes: 'vị tướng già mặc giáp', label: 'Tuong Tran' });
  const win2 = character({ slot: 'hero-right', pose: 'celebrate', expression: 'happy', motion: 'pop', archetype: 'villager', label: 'Dan lang' });
  const s10 = scene({
    name: '10 Dai thang',
    background: 'river',
    template: 'two-shot',
    camera: { shot: 'wide', motion: 'pull-out', focusX: W / 2, focusY: H / 2, zoom: 1 },
    objects: [
      win1, win2,
      createCanvasObject('prop', { id: oid('obj'), slot: 'background-center', depth: 'background', sizeClass: 'small', motion: 'float', label: 'Co chien thang', variant: 'flag' }),
      title('Biet doi con nuoc'),
    ],
    effects: [
      { id: 'fx-s10a', type: 'speed-lines', x: 640, y: 360, scale: 1.4, color: '#ffe9a8', intensity: 1.2, durationMs: 3000 },
      { id: 'fx-s10b', type: 'splash', x: 640, y: 580, scale: 1.6, color: '#bfe9f5', intensity: 1.6, startMs: 2500, durationMs: 2000 },
    ],
  });
  s10.animationBeats = [{ id: 'beat-s10', atMs: 500, durationMs: 3000, action: 'celebrate', targetIds: [win1.id, win2.id], intensity: 1.4 }];

  const stillScenes = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10].map((s) => ({
    ...s,
    // Camera khóa đứng yên: bỏ mọi zoom/pan kiểu slide PowerPoint.
    camera: { ...s.camera!, motion: 'none' as const },
  }));
  const project: CanvasStudioProject = {
    version: 1,
    id: randomUUID(),
    name: 'Showcase 1 phut v3 - camera dung yen',
    width: W,
    height: H,
    fps: FPS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scenes: stillScenes,
  };
  const totalMs = project.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  console.log(`Project v2: ${project.scenes.length} scenes, ${totalMs}ms @${FPS}fps`);

  await mkdir(outRoot, { recursive: true });
  await writeFile(path.join(outRoot, 'showcase-1min-v2.project.json'), JSON.stringify(project, null, 2), 'utf8');

  let last = -1;
  const rendered = await renderCanvasAnimationProject(project, undefined, (progress) => {
    const percent = Math.floor(progress * 100);
    if (percent !== last && percent % 10 === 0) { last = percent; console.log(`RENDER ${percent}%`); }
  });
  const outputPath = path.join(outRoot, 'showcase-1min-v2.mp4');
  if (rendered.path !== outputPath) await copyFile(rendered.path, outputPath);
  console.log(JSON.stringify({ outputPath, size: rendered.size, cached: rendered.cached, durationMs: totalMs }, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
