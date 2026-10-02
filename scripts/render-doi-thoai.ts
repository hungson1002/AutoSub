import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

// Đối thoại 2 dân làng: xanh nói -> nâu chỉ -> xanh ngạc nhiên.
// Hai mặt khác nhau = hai người khác nhau, như cảnh nhóm trong mẫu.
const GREEN_TALK = '/api/animation-studio/assets/7e865a4c-ea6e-4c90-9174-a641f3f7cbb3/file';
const BROWN_POINT = '/api/animation-studio/assets/e5df5a6a-a22d-49e9-a230-d61741881076/file';
const BUN = '/api/animation-studio/assets/7bd33667-df9d-4d1a-a734-59987d11defa/file';
const cell = { frameWidth: 338, frameHeight: 378, columns: 4, from: 0, to: 7, fps: 8 };

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 1,
});
const villager = (id: string, sheet: string, slot: any, facing: 'left' | 'right') => ({
  id, kind: 'character' as const, label: id, assetRef: 'character:villager',
  characterKey: id, archetype: 'villager' as const, hair: 'short' as const, role: 'focal' as const,
  slot, depth: 'foreground' as const, sizeClass: 'large' as const,
  pose: 'talk' as const, expression: 'neutral' as const, facing,
  x: 640, y: 360, width: 300, height: 380, scale: 1, rotation: 0, opacity: 1,
  color: '#d3a34c', accent: '#2f2b27', zIndex: 20, motion: 'none' as const,
  delayMs: 0, motionDurationMs: 480, motionCurve: 'smooth' as const, motionIntensity: 1,
  imageUrl: sheet, sprite: { ...cell },
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: 'Doi thoai', durationMs: 8000,
    template: 'two-shot', background: 'field', backgroundRef: 'bg:field-open',
    backgroundImageUrl: BUN, backgroundAssetId: '7bd33667-df9d-4d1a-a734-59987d11defa',
    visualBrief: 'Hai dan lang doi thoai tren bai bun.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(200, 1800, 'talk', ['xanh']),
      beat(2200, 1500, 'point', ['nau']),
      beat(3900, 1800, 'talk', ['xanh']),
      beat(5900, 1500, 'react', ['nau']),
    ],
    objects: [
      villager('xanh', GREEN_TALK, 'mid-left', 'right') as any,
      villager('nau', BROWN_POINT, 'mid-right', 'left') as any,
    ],
  },
];

const project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Doi thoai test',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.message);
if (!report.pass) throw new Error('QC failed');
const result = await renderCanvasAnimationProject(project, 'doi-thoai-v1');
console.log('RENDERED', result.path, result.size);
const dir = resolve('workdir/round23-verify');
mkdirSync(dir, { recursive: true });
for (const [name, ss] of [['dt-10', 1.0], ['dt-30', 3.0], ['dt-50', 5.0], ['dt-70', 7.0]] as const) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(ss), '-i', result.path, '-frames:v', '1', `${dir}/${name}.jpg`], { stdio: 'ignore' });
}
console.log('FRAMES_DONE');
