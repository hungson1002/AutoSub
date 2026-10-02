import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const TALK = '/api/animation-studio/assets/7e865a4c-ea6e-4c90-9174-a641f3f7cbb3/file';
const POINT = '/api/animation-studio/assets/e5df5a6a-a22d-49e9-a230-d61741881076/file';
const BUN = '/api/animation-studio/assets/7bd33667-df9d-4d1a-a734-59987d11defa/file';
const cell = { frameWidth: 338, frameHeight: 378, columns: 4, from: 0, to: 7, fps: 8 };

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: 'Dien: noi-chi-noi', durationMs: 7000,
    template: 'two-shot', background: 'field', backgroundRef: 'bg:field-open',
    backgroundImageUrl: BUN, backgroundAssetId: '7bd33667-df9d-4d1a-a734-59987d11defa',
    visualBrief: 'Chibi dien: noi -> chi tay -> noi.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(200, 1800, 'talk', ['dien']),
      beat(3200, 1200, 'point', ['dien']),
      beat(5600, 1800, 'talk', ['dien']),
      beat(7600, 1000, 'react', ['dien']),
    ],
    objects: [
      {
        id: 'dien', kind: 'character' as const, label: 'Dien vien',
        assetRef: 'character:warrior', characterKey: 'dien', archetype: 'warrior' as const,
        hair: 'hat' as const, role: 'focal' as const, slot: 'mid-center' as const,
        depth: 'foreground' as const, sizeClass: 'large' as const,
        pose: 'talk' as const, expression: 'happy' as const, facing: 'right' as const,
        x: 640, y: 360, width: 300, height: 380, scale: 1, rotation: 0, opacity: 1,
        color: '#d3a34c', accent: '#2f2b27', zIndex: 20, motion: 'none' as const,
        delayMs: 0, motionDurationMs: 480, motionCurve: 'smooth' as const, motionIntensity: 1,
        imageUrl: TALK,
        sprite: { ...cell },
        spriteActs: [
          { action: 'talk' as const, imageUrl: TALK, ...cell },
          { action: 'point' as const, imageUrl: POINT, ...cell, loop: false },
        ],
      } as any,
    ],
  },
];

const project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Dien test',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.message);
if (!report.pass) throw new Error('QC failed');
const result = await renderCanvasAnimationProject(project, 'dien-test-v1');
console.log('RENDERED', result.path, result.size);
const dir = resolve('workdir/round23-verify');
mkdirSync(dir, { recursive: true });
for (const [name, ss] of [['dien-talk', 1.0], ['dien-hold', 2.6], ['dien-point', 3.8], ['dien-hold2', 5.0], ['dien-talk2', 6.2]] as const) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(ss), '-i', result.path, '-frames:v', '1', `${dir}/${name}.jpg`], { stdio: 'ignore' });
}
console.log('FRAMES_DONE');
