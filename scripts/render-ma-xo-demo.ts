import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import { synthesize } from '../server/adapters/edgeTts';

// Demo phong cách Ma Xó: đêm + vignette + sub cháy hình + ma đơn giản.
const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 0.8,
});
const sub = (id: string, text: string) => ({
  id, kind: 'text' as const, label: text, text,
  x: 640, y: 640, width: 1100, height: 130, scale: 1, rotation: 0, opacity: 1,
  color: '#ffffff', accent: '#000000', zIndex: 30, slot: 'caption-bottom' as const,
  depth: 'midground' as const, sizeClass: 'medium' as const,
  motion: 'none' as const, delayMs: 300, motionDurationMs: 600,
  motionCurve: 'smooth' as const, motionIntensity: 1,
});
const propObj = (id: string, variant: any, slot: any, size: any, color = '#8a7a5f') => ({
  id, kind: 'prop' as const, label: id, assetRef: `prop:${variant}`, variant,
  role: 'focal' as const, slot, depth: 'midground' as const, sizeClass: size,
  x: 640, y: 360, width: 200, height: 200, scale: 1, rotation: 0, opacity: 1,
  color, accent: '#1a1512', zIndex: 15, motion: 'none' as const,
  delayMs: 200, motionDurationMs: 800, motionCurve: 'smooth' as const, motionIntensity: 1,
});
const vignette = () => ({
  id: randomUUID(), type: 'vignette' as const, x: 640, y: 360, scale: 1.2,
  intensity: 1, startMs: 0, durationMs: 9000, zIndex: 40,
});

const NAR1 = 'Tháng chín trên đó vào mùa thảo quả, người ta thuê công hái.';
const NAR2 = 'Rồi trong cái xó đó có tiếng thưa.';
const NAR3 = 'Hôm sau nó lấy thêm cái bật lửa. Hôm sau nữa nó lấy con dao nhỏ.';

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: 'Dem duong', durationMs: 7000,
    template: 'wide-establishing', background: 'night', backgroundRef: 'bg:night-river',
    visualBrief: 'Dem den, xe nho, vignette.',
    camera: { shot: 'wide', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [vignette()],
    animationBeats: [beat(400, 2000, 'talk', ['sub1']), beat(3000, 2000, 'react', ['sub1']), beat(100, 6800, 'float', ['xe']), beat(3500, 2000, 'pulse', ['xe'])],
    objects: [
      propObj('xe', 'cart', 'mid-center', 'medium', '#5a5f66') as any,
      sub('sub1', NAR1) as any,
    ],
  },
  {
    id: randomUUID(), name: 'Ma cua', durationMs: 7000,
    template: 'close-reaction', background: 'night', backgroundRef: 'bg:night-river',
    visualBrief: 'Ma hien cua toi + den pin.',
    camera: { shot: 'close-up', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [
      vignette(),
      { id: randomUUID(), type: 'flashlight' as const, x: 640, y: 360, scale: 1.4, intensity: 1, startMs: 0, durationMs: 7000, zIndex: 10 },
    ],
    animationBeats: [beat(400, 2500, 'react', ['ma']), beat(3500, 2000, 'talk', ['ma']), beat(100, 6800, 'float', ['ma']), beat(4000, 1500, 'pulse', ['ma'])],
    objects: [
      propObj('ma', 'ghost', 'center', 'large') as any,
      sub('sub2', NAR2) as any,
    ],
  },
  {
    id: randomUUID(), name: 'Do vat', durationMs: 7000,
    template: 'prop-focus', background: 'room', backgroundRef: 'bg:room-study',
    visualBrief: 'Ban go + bat lua + dao nho duoi vung sang.',
    camera: { shot: 'close-up', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [
      vignette(),
      { id: randomUUID(), type: 'flashlight' as const, x: 640, y: 380, scale: 1.1, intensity: 1, startMs: 0, durationMs: 7000, zIndex: 39 },
    ],
    animationBeats: [beat(400, 2500, 'reveal', ['dao']), beat(3500, 2000, 'talk', ['dao']), beat(100, 6800, 'float', ['hop']), beat(2000, 2000, 'pulse', ['batlua'])],
    objects: [
      propObj('hop', 'box', 'mid-left', 'small', '#a03a2e') as any,
      propObj('batlua', 'box', 'mid-center', 'small', '#b78a3d') as any,
      propObj('dao', 'sword', 'mid-right', 'medium') as any,
      sub('sub3', NAR3) as any,
    ],
  },
];

const project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Ma Xo Demo',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'ma-xo-demo-v1');
console.log('SILENT_RENDER', result.path, result.size);

const edgeProvider: any = {
  id: 'edge-tts-local', name: 'Edge TTS', baseUrl: 'local://edge-tts',
  enabled: true, models: [], providerType: 'edge-tts', authType: 'none', capabilities: { tts: true },
};
const synthWithRetry = async (text: string, attempt = 0): Promise<Buffer> => {
  try {
    return await synthesize(edgeProvider, 'edge-tts', 'vi-VN-NamMinhNeural', text, { speed: 0.9 });
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 4000 * (attempt + 1)));
    return synthWithRetry(text, attempt + 1);
  }
};
const outDir = resolve('workdir/round23-verify/maxo');
mkdirSync(outDir, { recursive: true });
const lines = [NAR1, NAR2, NAR3];
const starts = [0, 7000, 14000];
const inputs: string[] = [];
const filters: string[] = [];
for (let i = 0; i < 3; i += 1) {
  const audio = await synthWithRetry(lines[i]!);
  const file = `${outDir}/n${i}.mp3`;
  await writeFile(file, audio);
  inputs.push('-i', file);
  filters.push(`[${i + 1}:a]adelay=${starts[i]}|${starts[i]},apad[a${i}]`);
  console.log('TTS', i, audio.length);
}
filters.push('[a0][a1][a2]amix=inputs=3:duration=longest:dropout_transition=0[aout]');
const finalOut = resolve('workdir/round23-verify/ma-xo-demo.mp4');
execFileSync('ffmpeg', ['-y', '-i', result.path, ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', finalOut], { stdio: 'ignore' });
console.log('FINAL_MAXO', finalOut);
const contact = resolve('workdir/round23-verify/contact-ma-xo-demo.jpg');
execFileSync('ffmpeg', ['-y', '-i', finalOut, '-vf', 'fps=1/4,scale=480:-1,tile=3x1', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT_SHEET', contact);
