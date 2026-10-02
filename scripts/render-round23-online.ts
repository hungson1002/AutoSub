import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { densifyAnimationBeats } from '../server/services/canvasBeatDensifier';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const STAKES_URL = 'https://upload.wikimedia.org/wikipedia/commons/2/27/Stakes_Used_to_Repel_Mongol_Invasion_at_Bach_Dang_River%2C_1288_%289735656156%29.jpg';
const STAKES_CREDIT = 'Ảnh: Gary Todd from Xinzheng, China • Wikimedia • Public domain';
const VICTORY_URL = 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Bach_Dang_River_Victory_over_Mongols%2C_1288_%289980691453%29.jpg';
const VICTORY_CREDIT = 'Ảnh: Gary Todd from Xinzheng, China • Wikimedia • Public domain';
const MODEL_URL = 'https://upload.wikimedia.org/wikipedia/commons/d/da/Model_of_Battle_in_Bach_Dang_River_in_938_AD_-_DSC05544.JPG';
const MODEL_CREDIT = 'Ảnh: Daderot • Wikimedia • Public domain';

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[], intensity = 0.9) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity,
});

const character = (id: string, archetype: any, pose: any, slot: any, facing: 'left' | 'right' = 'right', expression: any = 'neutral') => ({
  id, kind: 'character' as const, label: id, assetRef: `character:${archetype}`,
  characterKey: id, archetype, hair: 'hat' as const, role: 'focal' as const,
  slot, depth: 'midground' as const, sizeClass: 'large' as const,
  pose, expression, facing, x: 640, y: 360, width: 170, height: 370,
  scale: 1, rotation: 0, opacity: 1, color: '#d3a34c', secondaryColor: '#657577',
  skinTone: '#ddb08a', accent: '#2f2b27', zIndex: 20, motion: 'none' as const,
  delayMs: 0, motionDurationMs: 480, motionCurve: 'cinematic' as const, motionIntensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: '01 Coc Bach Dang that', durationMs: 7000,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    visualBrief: 'Anh that coc Bach Dang 1288 + tuong thuyet minh.',
    camera: { shot: 'medium', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'glow', x: 920, y: 360, scale: 1, intensity: 0.9, startMs: 1200, durationMs: 1500, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'talk', ['tran-hung-dao']),
      beat(1300, 600, 'point', ['tran-hung-dao']),
      beat(2800, 700, 'react', ['tran-hung-dao']),
      beat(4600, 700, 'talk', ['tran-hung-dao']),
    ],
    objects: [
      character('tran-hung-dao', 'warrior', 'talk', 'mid-left', 'right', 'angry'),
      {
        id: 'anh-coc-that', kind: 'image' as const, label: 'Coc Bach Dang 1288 that',
        x: 640, y: 360, width: 420, height: 520, scale: 1, rotation: -2, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 15, motion: 'pop' as const,
        imageUrl: STAKES_URL, credit: STAKES_CREDIT,
      } as any,
    ],
  },
  {
    id: randomUUID(), name: '02 Song nuoc', durationMs: 6000,
    template: 'wide-establishing', background: 'river', backgroundRef: 'bg:river-establishing',
    visualBrief: 'Thuyen chien treng song, splash.',
    camera: { shot: 'wide', motion: 'pan-right', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'splash', x: 640, y: 560, scale: 1.2, intensity: 1, startMs: 2500, durationMs: 1200, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'talk', ['tuong-linh']),
      beat(1400, 600, 'brace', ['tuong-linh']),
      beat(2900, 700, 'react', ['tuong-linh']),
      beat(4500, 700, 'point', ['tuong-linh']),
    ],
    objects: [
      character('tuong-linh', 'warrior', 'point', 'mid-left', 'right', 'neutral'),
      {
        id: 'thuyen', kind: 'ship' as const, label: 'Thuyen chien', assetRef: 'ship:historical-warship',
        role: 'support' as const, slot: 'mid-right' as const, depth: 'midground' as const, sizeClass: 'large' as const,
        x: 640, y: 360, width: 320, height: 155, scale: 1, rotation: 0, opacity: 1,
        color: '#8a5437', accent: '#d9c4a2', zIndex: 12, motion: 'drift-left' as const,
        delayMs: 120, motionDurationMs: 900, motionCurve: 'smooth' as const, motionIntensity: 1,
      } as any,
    ],
  },
  {
    id: randomUUID(), name: '03 Mo hinh tran danh', durationMs: 7000,
    template: 'diagram-clean', background: 'map', backgroundRef: 'bg:map-tactical',
    backgroundImageUrl: VICTORY_URL, backgroundCredit: VICTORY_CREDIT,
    visualBrief: 'Anh that mo hinh tran Bach Dang + mui ten chien thuat.',
    camera: { shot: 'diagram', motion: 'follow', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'arrows', x: 640, y: 300, scale: 1.2, intensity: 1.1, startMs: 800, durationMs: 3000, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'reveal', ['mo-hinh']),
      beat(1400, 800, 'react', ['quan-su']),
      beat(3200, 700, 'point', ['quan-su']),
      beat(5000, 800, 'celebrate', ['quan-su']),
    ],
    objects: [
      {
        id: 'mo-hinh', kind: 'image' as const, label: 'Mo hinh tran Bach Dang',
        x: 640, y: 360, width: 620, height: 400, scale: 1, rotation: 0, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 14, motion: 'pop' as const,
        imageUrl: MODEL_URL, credit: MODEL_CREDIT,
      } as any,
      character('quan-su', 'scholar', 'point', 'mid-right', 'left', 'neutral'),
    ],
  },
  {
    id: randomUUID(), name: '04 Ket', durationMs: 6000,
    template: 'close-reaction', background: 'field', backgroundRef: 'bg:field-camp',
    visualBrief: 'Nguoi linh an mung.',
    camera: { shot: 'close-up', motion: 'pull-out', focusX: 640, focusY: 360, zoom: 1.02 },
    effects: [],
    animationBeats: [
      beat(100, 800, 'talk', ['nguoi-linh']),
      beat(1400, 600, 'react', ['nguoi-linh']),
      beat(2900, 700, 'talk', ['nguoi-linh']),
      beat(4600, 800, 'celebrate', ['nguoi-linh']),
    ],
    objects: [character('nguoi-linh', 'warrior', 'talk', 'hero', 'right', 'happy')],
  },
];

let project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Round23 Bach Dang Online 26s',
  width: 1280, height: 720, fps: 30, scenes,
} as any);

project = densifyAnimationBeats(project as any) as any;
const report = evaluateCanvasVisualQuality(project);
console.log('VISUAL_QUALITY score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed score ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'round23-bachdang-online');
console.log('RENDERED', JSON.stringify({ path: result.path, size: result.size }));
const contact = resolve('workdir/round23-verify/contact-online.jpg');
mkdirSync(dirname(contact), { recursive: true });
execFileSync('ffmpeg', ['-y', '-i', result.path, '-vf', 'fps=1/3,scale=480:-1,tile=4x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT', contact);
