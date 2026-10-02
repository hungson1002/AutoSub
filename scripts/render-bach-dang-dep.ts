import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

// Full tranh AI. Chibi code chỉ làm người dẫn NHỎ góc khung như mẫu Vui Vẻ.
const BAI_COC = '/api/animation-studio/assets/dfc32420-dd5a-4526-b75e-610eaf7a1ec1/file';
const FLEET = '/api/animation-studio/assets/6b082b29-5418-47f0-b913-470952bc6713/file';
const LINH_TRE = '/api/animation-studio/assets/6ea21b50-0a1f-4635-86d2-a66201779a63/file';
const QUAN_SU = '/api/animation-studio/assets/0bd0a686-5801-4fb8-9348-b75d23f25463/file';
const VI_TUONG = '/api/animation-studio/assets/b5aa18da-d101-4318-8fc1-e8a89950f9d8/file';
const STAKES_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/2/27/Stakes_Used_to_Repel_Mongol_Invasion_at_Bach_Dang_River%2C_1288_%289735656156%29.jpg';
const VICTORY_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Bach_Dang_River_Victory_over_Mongols%2C_1288_%289980691453%29.jpg';

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 1,
});
// Người dẫn nhỏ góc khung.
const narrator = (id: string, slot: any, pose: any) => ({
  id, kind: 'character' as const, label: id, assetRef: 'character:sailor',
  characterKey: 'dan-chung', archetype: 'sailor' as const, hair: 'short' as const, role: 'focal' as const,
  slot, depth: 'foreground' as const, sizeClass: 'small' as const,
  pose, expression: 'happy' as const, facing: 'right' as const,
  x: 640, y: 360, width: 115, height: 225, scale: 1, rotation: 0, opacity: 1,
  color: '#e8b04f', accent: '#22201f', zIndex: 25, motion: 'pop' as const,
  delayMs: 200, motionDurationMs: 450, motionCurve: 'snappy' as const, motionIntensity: 1,
});
const polaroid = (id: string, label: string, url: string, credit: string | undefined, slot: any, w = 520, h = 600) => ({
  id, kind: 'image' as const, label,
  x: 640, y: 360, width: w, height: h, scale: 1, rotation: 2, opacity: 1,
  color: '#fff', accent: '#000', zIndex: 15, slot,
  depth: 'midground' as const, sizeClass: 'large' as const,
  motion: 'pop' as const, delayMs: 400, motionDurationMs: 480,
  motionCurve: 'snappy' as const, motionIntensity: 1,
  imageUrl: url, ...(credit ? { credit } : {}),
});
const aiFrame = (id: string, label: string, url: string, slot: any, w = 520, h = 560) => ({
  id, kind: 'image' as const, label,
  x: 640, y: 360, width: w, height: h, scale: 1, rotation: 0, opacity: 1,
  color: '#fff', accent: '#000', zIndex: 15, slot,
  depth: 'midground' as const, sizeClass: 'large' as const,
  motion: 'pop' as const, delayMs: 300, motionDurationMs: 480,
  motionCurve: 'snappy' as const, motionIntensity: 1,
  imageUrl: url,
});
const title = (id: string, text: string) => ({
  id, kind: 'text' as const, label: text, text,
  x: 640, y: 100, width: 640, height: 110, scale: 1, rotation: 0, opacity: 1,
  color: '#ffffff', accent: '#1f1f1f', zIndex: 30, slot: 'caption-top' as const,
  depth: 'midground' as const, sizeClass: 'medium' as const,
  motion: 'pop' as const, delayMs: 100, motionDurationMs: 400,
  motionCurve: 'snappy' as const, motionIntensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: '01 Bai coc', durationMs: 7500,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    backgroundImageUrl: BAI_COC, backgroundAssetId: 'dfc32420-dd5a-4526-b75e-610eaf7a1ec1',
    visualBrief: 'Nen AI bai coc POV + anh coc that polaroid + dan nho.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(500, 1500, 'talk', ['dan1']),
      beat(2600, 1000, 'reveal', ['anh-coc-2']),
      beat(4200, 1200, 'talk', ['dan1']),
      beat(6000, 900, 'point', ['dan1']),
    ],
    objects: [
      narrator('dan1', 'foreground-left', 'talk') as any,
      polaroid('anh-coc-2', 'Cọc đóng dưới lòng sông', STAKES_PHOTO, 'Ảnh: Gary Todd • Wikimedia • Public domain', 'mid-right') as any,
      title('t1', 'BÃI CỌC BẠCH ĐẰNG') as any,
    ],
  },
  {
    id: randomUUID(), name: '02 Doan thuyen', durationMs: 5500,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    backgroundImageUrl: FLEET, backgroundAssetId: '6b082b29-5418-47f0-b913-470952bc6713',
    visualBrief: 'Nen AI doan thuyen + splash + dan nho.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'splash', x: 760, y: 580, scale: 1, intensity: 0.9, startMs: 2200, durationMs: 1000, zIndex: 16 }],
    animationBeats: [
      beat(500, 1500, 'talk', ['dan2']),
      beat(2500, 1000, 'react', ['dan2']),
      beat(4000, 1000, 'point', ['dan2']),
    ],
    objects: [
      narrator('dan2', 'foreground-left', 'talk') as any,
      title('t2', 'THỦY TRIỀU RÚT') as any,
    ],
  },
  {
    id: randomUUID(), name: '03 Ban luan', durationMs: 5500,
    template: 'split-contrast', background: 'paper', backgroundRef: 'bg:paper-editorial',
    visualBrief: 'Chan dung quan su AI + tranh hai chien polaroid.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(300, 1000, 'reveal', ['quan-su-3']),
      beat(1700, 1500, 'talk', ['dan3']),
      beat(3700, 1200, 'point', ['dan3']),
    ],
    objects: [
      aiFrame('quan-su-3', 'Quân sư bàn kế', QUAN_SU, 'mid-left', 460, 540) as any,
      polaroid('hai-chien-3', 'Hải chiến Bạch Đằng', VICTORY_PHOTO, 'Ảnh: Gary Todd • Wikimedia • Public domain', 'mid-right', 460, 420) as any,
      narrator('dan3', 'foreground-right', 'talk') as any,
      title('t3', '400 CHIẾN THUYỀN') as any,
    ],
  },
  {
    id: randomUUID(), name: '04 Nguoi hung', durationMs: 6500,
    template: 'split-contrast', background: 'paper', backgroundRef: 'bg:paper-editorial',
    visualBrief: 'Chan dung vi tuong + linh tre + ket.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'glow', x: 420, y: 360, scale: 1.1, intensity: 0.9, startMs: 4500, durationMs: 1200, zIndex: 16 }],
    animationBeats: [
      beat(300, 1000, 'reveal', ['tuong-4']),
      beat(1700, 1200, 'talk', ['dan4']),
      beat(3400, 1200, 'reveal', ['linh-4']),
      beat(5100, 1000, 'celebrate', ['dan4']),
    ],
    objects: [
      aiFrame('tuong-4', 'Vị tướng', VI_TUONG, 'mid-left', 440, 520) as any,
      aiFrame('linh-4', 'Người lính trẻ', LINH_TRE, 'mid-right', 440, 520) as any,
      narrator('dan4', 'foreground-right', 'celebrate') as any,
      title('t4', 'NGƯỜI HÙNG LÀ BẠN') as any,
    ],
  },
];

let project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Bach Dang Dep Full AI',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'bach-dang-dep-v1');
console.log('SILENT_RENDER', result.path, result.size);

const assetsDir = resolve('workdir/round23-verify/assets');
const finalOut = resolve('workdir/round23-verify/bach-dang-dep.mp4');
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
console.log('FINAL_DEP_VIDEO', finalOut);
const contact = resolve('workdir/round23-verify/contact-bach-dang-dep.jpg');
execFileSync('ffmpeg', ['-y', '-i', finalOut, '-vf', 'fps=1/4,scale=480:-1,tile=4x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT_SHEET', contact);
