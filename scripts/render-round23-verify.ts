import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioProject, CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { densifyAnimationBeats } from '../server/services/canvasBeatDensifier';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

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

const ship = (id: string, slot: any) => ({
  id, kind: 'ship' as const, label: id, assetRef: 'ship:historical-warship',
  role: 'support' as const, slot, depth: 'midground' as const, sizeClass: 'large' as const,
  x: 640, y: 360, width: 320, height: 155, scale: 1, rotation: 0, opacity: 1,
  color: '#8a5437', accent: '#d9c4a2', zIndex: 12, motion: 'drift-left' as const,
  delayMs: 120, motionDurationMs: 900, motionCurve: 'smooth' as const, motionIntensity: 1,
});

const stake = (id: string, x: number) => ({
  id, kind: 'stake' as const, label: id, assetRef: 'stake:wood-cluster',
  role: 'support' as const, depth: 'midground' as const, sizeClass: 'medium' as const,
  x, y: 580, width: 60, height: 220, scale: 1, rotation: 0, opacity: 1,
  color: '#6c4933', accent: '#39281e', zIndex: 8, motion: 'pop' as const,
  delayMs: 200, motionDurationMs: 480, motionCurve: 'snappy' as const, motionIntensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: '01 Song Bach Dang', durationMs: 6000,
    template: 'wide-establishing', background: 'river', backgroundRef: 'bg:river-establishing',
    visualBrief: 'Cua song Bach Dang rong, thuyen chien, coc ngam.',
    camera: { shot: 'wide', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'splash', x: 640, y: 560, scale: 1.2, intensity: 1, startMs: 2500, durationMs: 1200, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'talk', ['tran-hung-dao']),
      beat(1200, 600, 'point', ['tran-hung-dao']),
      beat(2600, 700, 'react', ['tran-hung-dao']),
      beat(4200, 700, 'talk', ['tran-hung-dao']),
    ],
    objects: [
      character('tran-hung-dao', 'warrior', 'talk', 'mid-left', 'right', 'angry'),
      ship('thuyen-nguyen', 'mid-right'),
      stake('coc-1', 690) as any, stake('coc-2', 770) as any,
    ],
  },
  {
    id: randomUUID(), name: '02 Thuy trieu', durationMs: 6000,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    visualBrief: 'Nuoc rut, coc nho len.',
    camera: { shot: 'medium', motion: 'pan-right', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'glow', x: 690, y: 500, scale: 1, intensity: 1, startMs: 1500, durationMs: 1500, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'talk', ['tuong-linh']),
      beat(1400, 600, 'brace', ['tuong-linh']),
      beat(2800, 700, 'react', ['tuong-linh']),
      beat(4400, 700, 'point', ['tuong-linh']),
    ],
    objects: [
      character('tuong-linh', 'warrior', 'point', 'hero', 'right', 'neutral'),
      stake('coc-3', 640) as any,
    ],
  },
  {
    id: randomUUID(), name: '03 Ban do 400 thuyen', durationMs: 6000,
    template: 'diagram-clean', background: 'map', backgroundRef: 'bg:map-tactical',
    backgroundCredit: 'Ảnh: Luu Ly • Wikimedia • CC-BY',
    visualBrief: 'Ban do tran Bach Dang, mui ten tien cong.',
    camera: { shot: 'diagram', motion: 'follow', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'arrows', x: 640, y: 360, scale: 1.4, intensity: 1.1, startMs: 800, durationMs: 3000, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'reveal', ['ban-do']),
      beat(1300, 800, 'react', ['quan-su']),
      beat(2900, 700, 'point', ['quan-su']),
      beat(4500, 700, 'celebrate', ['quan-su']),
    ],
    objects: [
      {
        id: 'ban-do', kind: 'image' as const, label: 'Ban do tran Bach Dang 1288',
        x: 640, y: 360, width: 560, height: 380, scale: 1, rotation: 0, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 14, motion: 'pop' as const,
        credit: 'Ảnh: Luu Ly • Wikimedia • CC-BY',
      } as any,
      character('quan-su', 'scholar', 'point', 'mid-right', 'left', 'neutral'),
    ],
  },
  {
    id: randomUUID(), name: '04 Quyet chien', durationMs: 6000,
    template: 'split-contrast', background: 'map', backgroundRef: 'bg:map-tactical',
    visualBrief: 'Hai canh quan - ta dich.',
    camera: { shot: 'medium', motion: 'impact', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'impact', x: 640, y: 360, scale: 1.2, intensity: 1, startMs: 2800, durationMs: 900, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'run', ['chinh-binh']),
      beat(1400, 600, 'impact', ['chinh-binh']),
      beat(2900, 700, 'react', ['chinh-binh']),
      beat(4500, 700, 'celebrate', ['chinh-binh']),
    ],
    objects: [character('chinh-binh', 'warrior', 'run', 'hero', 'right', 'angry')],
  },
  {
    id: randomUUID(), name: '05 Nguoi hung la ban', durationMs: 6000,
    template: 'close-reaction', background: 'field', backgroundRef: 'bg:field-camp',
    visualBrief: 'Nguoi linh an mung giua dong.',
    camera: { shot: 'close-up', motion: 'pull-out', focusX: 640, focusY: 360, zoom: 1.02 },
    effects: [{ id: randomUUID(), type: 'smoke', x: 900, y: 300, scale: 1, intensity: 0.9, startMs: 500, durationMs: 2000, zIndex: 5 }],
    animationBeats: [
      beat(100, 800, 'talk', ['nguoi-linh']),
      beat(1300, 600, 'react', ['nguoi-linh']),
      beat(2800, 700, 'talk', ['nguoi-linh']),
      beat(4500, 800, 'celebrate', ['nguoi-linh']),
    ],
    objects: [character('nguoi-linh', 'warrior', 'talk', 'hero', 'right', 'happy')],
  },
];

let project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Round23 Bach Dang 30s',
  width: 1280, height: 720, fps: 30, scenes,
} satisfies CanvasStudioProject);

project = densifyAnimationBeats(project as any) as any;
const report = evaluateCanvasVisualQuality(project);
console.log('VISUAL_QUALITY score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed score ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'round23-bachdang-30s');
console.log('RENDERED', JSON.stringify({ path: result.path, size: result.size }));
const contact = resolve('workdir/round23-verify/contact-30s.jpg');
mkdirSync(dirname(contact), { recursive: true });
execFileSync('ffmpeg', ['-y', '-i', result.path, '-vf', 'fps=1/3,scale=480:-1,tile=5x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT', contact);
