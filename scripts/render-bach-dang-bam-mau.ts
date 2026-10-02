import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

// Bám shot mẫu 6a2e: mặt cắt nước / bãi bùn hoàng hôn / macro cọc / tranh chiến + caption.
const MAT_CAT = '/api/animation-studio/assets/d7c56495-6d9b-49c2-ab47-e19e6b293e6c/file';
const BUN_HOANG_HON = '/api/animation-studio/assets/7bd33667-df9d-4d1a-a734-59987d11defa/file';
const MACRO_COC = '/api/animation-studio/assets/fb96b548-8ceb-4ce7-a9ca-1c32c2ef1ea3/file';
const LINH_TRE = '/api/animation-studio/assets/6ea21b50-0a1f-4635-86d2-a66201779a63/file';
const QUAN_SU = '/api/animation-studio/assets/0bd0a686-5801-4fb8-9348-b75d23f25463/file';
const VI_TUONG = '/api/animation-studio/assets/b5aa18da-d101-4318-8fc1-e8a89950f9d8/file';
const STAKES_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/2/27/Stakes_Used_to_Repel_Mongol_Invasion_at_Bach_Dang_River%2C_1288_%289735656156%29.jpg';
const VICTORY_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Bach_Dang_River_Victory_over_Mongols%2C_1288_%289980691453%29.jpg';

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 1,
});
const narrator = (id: string, slot: any, pose: any) => ({
  id, kind: 'character' as const, label: id, assetRef: 'character:sailor',
  characterKey: 'dan-chung', archetype: 'sailor' as const, hair: 'short' as const, role: 'focal' as const,
  slot, depth: 'foreground' as const, sizeClass: 'small' as const,
  pose, expression: 'happy' as const, facing: 'right' as const,
  x: 640, y: 360, width: 115, height: 225, scale: 1, rotation: 0, opacity: 1,
  color: '#e8b04f', accent: '#22201f', zIndex: 25, motion: 'pop' as const,
  delayMs: 200, motionDurationMs: 450, motionCurve: 'snappy' as const, motionIntensity: 1,
});
const polaroid = (id: string, label: string, url: string, credit: string, slot: any, w = 480, h = 560) => ({
  id, kind: 'image' as const, label,
  x: 640, y: 360, width: w, height: h, scale: 1, rotation: 2, opacity: 1,
  color: '#fff', accent: '#000', zIndex: 15, slot,
  depth: 'midground' as const, sizeClass: 'large' as const,
  motion: 'pop' as const, delayMs: 400, motionDurationMs: 480,
  motionCurve: 'snappy' as const, motionIntensity: 1,
  imageUrl: url, credit,
});
const aiFrame = (id: string, label: string, url: string, slot: any, w = 460, h = 540) => ({
  id, kind: 'image' as const, label,
  x: 640, y: 360, width: w, height: h, scale: 1, rotation: 0, opacity: 1,
  color: '#fff', accent: '#000', zIndex: 15, slot,
  depth: 'midground' as const, sizeClass: 'large' as const,
  motion: 'pop' as const, delayMs: 300, motionDurationMs: 480,
  motionCurve: 'snappy' as const, motionIntensity: 1,
  imageUrl: url,
});
const titleTop = (id: string, text: string, slot: any = 'caption-top') => ({
  id, kind: 'text' as const, label: text, text,
  x: 640, y: 100, width: 640, height: 110, scale: 1, rotation: 0, opacity: 1,
  color: '#ffffff', accent: '#1f1f1f', zIndex: 30, slot,
  depth: 'midground' as const, sizeClass: 'medium' as const,
  motion: 'pop' as const, delayMs: 100, motionDurationMs: 400,
  motionCurve: 'snappy' as const, motionIntensity: 1,
});
const chipBottom = (id: string, text: string) => ({
  id, kind: 'text' as const, label: text, text,
  x: 640, y: 660, width: 420, height: 64, scale: 1, rotation: 0, opacity: 1,
  color: '#ffffff', accent: '#1f1f1f', zIndex: 30, slot: 'caption-bottom' as const,
  depth: 'midground' as const, sizeClass: 'small' as const,
  motion: 'pop' as const, delayMs: 500, motionDurationMs: 400,
  motionCurve: 'snappy' as const, motionIntensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: '01 Meo thuy trieu', durationMs: 7500,
    template: 'wide-establishing', background: 'underwater', backgroundRef: 'bg:underwater-stakes',
    backgroundImageUrl: MAT_CAT, backgroundAssetId: 'd7c56495-6d9b-49c2-ab47-e19e6b293e6c',
    visualBrief: 'Mat cat duoi nuoc: thuyen + coc + bun, nhu shot mo mau.',
    camera: { shot: 'wide', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(500, 1500, 'talk', ['dan1']),
      beat(2600, 1000, 'reveal', ['coc-that-1']),
      beat(4200, 1200, 'talk', ['dan1']),
      beat(6000, 900, 'point', ['dan1']),
    ],
    objects: [
      narrator('dan1', 'foreground-left', 'talk') as any,
      polaroid('coc-that-1', 'Cọc Bạch Đằng 1288', STAKES_PHOTO, 'Ảnh: Gary Todd • Wikimedia • Public domain', 'mid-right', 400, 500) as any,
      titleTop('t1', '3 LẦN · 1 MẸO', 'caption-bottom') as any,
    ],
  },
  {
    id: randomUUID(), name: '02 Cho trieu rut', durationMs: 5500,
    template: 'two-shot', background: 'field', backgroundRef: 'bg:field-open',
    backgroundImageUrl: BUN_HOANG_HON, backgroundAssetId: '7bd33667-df9d-4d1a-a734-59987d11defa',
    visualBrief: 'Bai bun hoang hon + dan thuyet minh.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(500, 1500, 'talk', ['dan2']),
      beat(2500, 1000, 'react', ['dan2']),
      beat(4000, 1000, 'point', ['dan2']),
    ],
    objects: [
      narrator('dan2', 'foreground-left', 'talk') as any,
      titleTop('t2', 'CHỜ THỦY TRIỀU RÚT') as any,
      chipBottom('c2', 'Sông Bạch Đằng') as any,
    ],
  },
  {
    id: randomUUID(), name: '03 Quyet chien', durationMs: 5500,
    template: 'diagram-clean', background: 'paper', backgroundRef: 'bg:paper-editorial',
    backgroundImageUrl: VICTORY_PHOTO, backgroundCredit: 'Ảnh: Gary Todd • Wikimedia • Public domain',
    visualBrief: 'Anh tran chien full + quan su + mui ten.',
    camera: { shot: 'diagram', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'arrows', x: 640, y: 300, scale: 1.2, intensity: 1.1, startMs: 800, durationMs: 2500, zIndex: 16 }],
    animationBeats: [
      beat(300, 1000, 'reveal', ['su-3']),
      beat(1700, 1500, 'talk', ['dan3']),
      beat(3700, 1200, 'point', ['dan3']),
    ],
    objects: [
      aiFrame('su-3', 'Quân sư', QUAN_SU, 'mid-left', 400, 480) as any,
      narrator('dan3', 'foreground-right', 'talk') as any,
      titleTop('t3', '400 CHIẾN THUYỀN') as any,
      chipBottom('c3', '1288 · Bạch Đằng') as any,
    ],
  },
  {
    id: randomUUID(), name: '04 Nguoi hung', durationMs: 6500,
    template: 'split-contrast', background: 'paper', backgroundRef: 'bg:paper-editorial',
    backgroundImageUrl: MACRO_COC, backgroundAssetId: 'fb96b548-8ceb-4ce7-a9ca-1c32c2ef1ea3',
    visualBrief: 'Macro coc lam nen + 2 chan dung + ket.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'glow', x: 640, y: 360, scale: 1.2, intensity: 0.8, startMs: 4500, durationMs: 1200, zIndex: 5 }],
    animationBeats: [
      beat(300, 1000, 'reveal', ['tuong-4']),
      beat(1700, 1200, 'talk', ['dan4']),
      beat(3400, 1200, 'reveal', ['linh-4']),
      beat(5100, 1000, 'celebrate', ['dan4']),
    ],
    objects: [
      aiFrame('tuong-4', 'Vị tướng', VI_TUONG, 'mid-left', 400, 480) as any,
      aiFrame('linh-4', 'Người lính trẻ', LINH_TRE, 'mid-right', 400, 480) as any,
      narrator('dan4', 'foreground-right', 'celebrate') as any,
      titleTop('t4', 'NGƯỜI HÙNG LÀ BẠN') as any,
    ],
  },
];

let project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Bach Dang Bam Mau',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'bach-dang-bam-mau-v1');
console.log('SILENT_RENDER', result.path, result.size);

const assetsDir = resolve('workdir/round23-verify/assets');
const finalOut = resolve('workdir/round23-verify/bach-dang-bam-mau.mp4');
mkdirSync(dirname(finalOut), { recursive: true });
const starts = [0, 7500, 13000, 18500];
const inputs: string[] = [];
const filters: string[] = [];
for (let i = 0; i < 4; i += 1) {
  inputs.push('-i', `${assetsDir}/narration-${i + 1}.mp3`);
  filters.push(`[${i + 1}:a]adelay=${starts[i]}|${starts[i]},apad[a${i}]`);
}
filters.push('[a0][a1][a2][a3]amix=inputs=4:duration=longest:dropout_transition=0[aout]');
execFileSync('ffmpeg', ['-y', '-i', result.path, ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', finalOut], { stdio: 'ignore' });
console.log('FINAL_BAM_MAU_VIDEO', finalOut);
const contact = resolve('workdir/round23-verify/contact-bach-dang-bam-mau.jpg');
execFileSync('ffmpeg', ['-y', '-i', finalOut, '-vf', 'fps=1/4,scale=480:-1,tile=4x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT_SHEET', contact);
