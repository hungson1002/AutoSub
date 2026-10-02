import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const WALK_SHEET = '/api/animation-studio/assets/935af421-63a3-44d2-917a-49fcd27e5ba0/file';
const TALK_SHEET = '/api/animation-studio/assets/9e3d4150-9191-4017-a7c4-fdb8661a47ac/file';
const RIVER_PLATE = '/api/animation-studio/assets/db6d47d5-df39-447b-9739-06507700e6a7/file';
const walk = { frameWidth: 344, frameHeight: 384, columns: 4, from: 0, to: 7, fps: 8 };
const talk = { frameWidth: 338, frameHeight: 378, columns: 4, from: 0, to: 7, fps: 8 };

const spriteChar = (id: string, sheet: string, clip: any, slot: any, pose: any, motion: any, x: number, y: number) => ({
  id, kind: 'character' as const, label: id, assetRef: 'character:warrior',
  characterKey: id, archetype: 'warrior' as const, hair: 'hat' as const, role: 'focal' as const,
  slot, depth: 'foreground' as const, sizeClass: 'large' as const,
  pose, expression: pose === 'talk' ? 'happy' as const : 'angry' as const,
  facing: 'right' as const, x, y, width: 210, height: 340, scale: 1, rotation: 0, opacity: 1,
  color: '#d3a34c', accent: '#2f2b27', zIndex: 20, motion,
  delayMs: 0, motionDurationMs: 480, motionCurve: 'cinematic' as const, motionIntensity: 1,
  imageUrl: sheet, sprite: clip,
});
const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: 'Hanh quan', durationMs: 5000,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    backgroundImageUrl: RIVER_PLATE, backgroundAssetId: 'db6d47d5-df39-447b-9739-06507700e6a7',
    visualBrief: 'Chien binh sprite di bo doc bo song.',
    camera: { shot: 'medium', motion: 'follow', focusX: 640, focusY: 420, zoom: 1.1 },
    effects: [],
    animationBeats: [beat(100, 1200, 'run', ['w']), beat(1800, 1200, 'run', ['w']), beat(3400, 1000, 'react', ['w']), beat(4400, 500, 'celebrate', ['w'])],
    objects: [spriteChar('w', WALK_SHEET, walk, 'foreground-left', 'run', 'walk-right', 320, 600) as any],
  },
  {
    id: randomUUID(), name: 'Hieu trieu', durationMs: 5000,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    backgroundImageUrl: RIVER_PLATE, backgroundAssetId: 'db6d47d5-df39-447b-9739-06507700e6a7',
    visualBrief: 'Chien binh dung noi, khau hinh chuyen dong.',
    camera: { shot: 'medium', motion: 'push-in', focusX: 640, focusY: 400, zoom: 1.05 },
    effects: [],
    animationBeats: [beat(100, 1500, 'talk', ['t']), beat(2000, 1500, 'talk', ['t']), beat(3800, 1000, 'point', ['t'])],
    objects: [spriteChar('t', TALK_SHEET, talk, 'foreground-left', 'talk', 'none', 320, 600) as any],
  },
];

const project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Sprite Walk+Talk',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.message);
if (!report.pass) throw new Error('QC failed');
const result = await renderCanvasAnimationProject(project, 'sprite-walktalk-v1');
console.log('RENDERED', result.path, result.size);
const dir = resolve('workdir/round23-verify');
mkdirSync(dir, { recursive: true });
for (const [name, ss] of [['wt-20', 2.0], ['wt-60', 6.0], ['wt-80', 8.0]] as const) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(ss), '-i', result.path, '-frames:v', '1', `${dir}/${name}.jpg`], { stdio: 'ignore' });
}
console.log('FRAMES_DONE');
