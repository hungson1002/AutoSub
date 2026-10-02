import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const SHEET = '/api/animation-studio/assets/935af421-63a3-44d2-917a-49fcd27e5ba0/file';
const sprite = { frameWidth: 344, frameHeight: 384, columns: 4, from: 0, to: 7, fps: 8 };

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: 'Hanh quan', durationMs: 6000,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    visualBrief: 'Chien binh sprite di bo doc bo song.',
    camera: { shot: 'medium', motion: 'follow', focusX: 640, focusY: 420, zoom: 1.1 },
    effects: [],
    animationBeats: [
      beat(100, 1500, 'run', ['chien-binh']),
      beat(2000, 1500, 'run', ['chien-binh']),
      beat(3800, 1000, 'react', ['chien-binh']),
      beat(5000, 800, 'celebrate', ['chien-binh']),
    ],
    objects: [
      {
        id: 'chien-binh', kind: 'character' as const, label: 'Chien binh sprite',
        assetRef: 'character:warrior', characterKey: 'chien-binh', archetype: 'warrior' as const,
        hair: 'hat' as const, role: 'focal' as const, slot: 'foreground-left' as const,
        depth: 'foreground' as const, sizeClass: 'large' as const,
        pose: 'run' as const, expression: 'angry' as const, facing: 'right' as const,
        x: 320, y: 600, width: 260, height: 420, scale: 1, rotation: 0, opacity: 1,
        color: '#d3a34c', accent: '#2f2b27', zIndex: 20, motion: 'walk-right' as const,
        delayMs: 0, motionDurationMs: 480, motionCurve: 'cinematic' as const, motionIntensity: 1,
        imageUrl: SHEET, sprite,
      } as any,
    ],
  },
];

const project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Sprite Walk Test',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.message);
if (!report.pass) throw new Error('QC failed');
const result = await renderCanvasAnimationProject(project, 'sprite-walk-test-v1');
console.log('RENDERED', result.path, result.size);
const dir = resolve('workdir/round23-verify');
mkdirSync(dir, { recursive: true });
for (const [name, ss] of [['spr-05', 0.5], ['spr-20', 2.0], ['spr-35', 3.5]] as const) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(ss), '-i', result.path, '-frames:v', '1', `${dir}/${name}.jpg`], { stdio: 'ignore' });
}
console.log('FRAMES_DONE');
