import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

// Nhân vật CHUYỂN ĐỘNG bằng sprite frames kiểu mẫu (miệng + tay cử động).
const CHIBI_TALK = '/api/animation-studio/assets/7e865a4c-ea6e-4c90-9174-a641f3f7cbb3/file';
const CHIBI_POINT = '/api/animation-studio/assets/e5df5a6a-a22d-49e9-a230-d61741881076/file';
const MAT_CAT = '/api/animation-studio/assets/d7c56495-6d9b-49c2-ab47-e19e6b293e6c/file';
const BUN_HOANG_HON = '/api/animation-studio/assets/7bd33667-df9d-4d1a-a734-59987d11defa/file';
const MACRO_COC = '/api/animation-studio/assets/fb96b548-8ceb-4ce7-a9ca-1c32c2ef1ea3/file';
const LINH_TRE = '/api/animation-studio/assets/6ea21b50-0a1f-4635-86d2-a66201779a63/file';
const VI_TUONG = '/api/animation-studio/assets/b5aa18da-d101-4318-8fc1-e8a89950f9d8/file';
const STAKES_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/2/27/Stakes_Used_to_Repel_Mongol_Invasion_at_Bach_Dang_River%2C_1288_%289735656156%29.jpg';
const VICTORY_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Bach_Dang_River_Victory_over_Mongols%2C_1288_%289980691453%29.jpg';

const chibiTalk = { frameWidth: 338, frameHeight: 378, columns: 4, from: 0, to: 7, fps: 8 };

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 1,
});
// Chibi DIỄN theo beat, GIỮ pose khi nghỉ (limited animation như mẫu).
// Xanh lá nói, nâu chỉ: hai người khác nhau, không morph.
const speaker = (id: string, slot: any, size: any = 'large') => ({
  id, kind: 'character' as const, label: id, assetRef: 'character:warrior',
  characterKey: 'chibi-noi', archetype: 'warrior' as const, hair: 'hat' as const, role: 'focal' as const,
  slot, depth: 'foreground' as const, sizeClass: size,
  pose: 'talk' as const, expression: 'happy' as const, facing: 'right' as const,
  x: 640, y: 360, width: 300, height: 380, scale: 1, rotation: 0, opacity: 1,
  color: '#d3a34c', accent: '#2f2b27', zIndex: 20, motion: 'none' as const,
  delayMs: 0, motionDurationMs: 480, motionCurve: 'smooth' as const, motionIntensity: 1,
  imageUrl: CHIBI_TALK, sprite: chibiTalk,
  spriteActs: [
    { action: 'talk' as const, imageUrl: CHIBI_TALK, ...chibiTalk },
    { action: 'point' as const, imageUrl: CHIBI_POINT, ...chibiTalk, loop: false },
  ],
});
const pointer = (id: string, slot: any, size: any = 'large') => ({
  ...speaker(id, slot, size),
  characterKey: 'chibi-chi',
  imageUrl: CHIBI_POINT,
  sprite: chibiTalk,
  spriteActs: [
    { action: 'point' as const, imageUrl: CHIBI_POINT, ...chibiTalk, loop: false },
    { action: 'talk' as const, imageUrl: CHIBI_TALK, ...chibiTalk },
  ],
});
const polaroid = (id: string, label: string, url: string, credit: string, slot: any, w = 420, h = 520) => ({
  id, kind: 'image' as const, label,
  x: 640, y: 360, width: w, height: h, scale: 1, rotation: 2, opacity: 1,
  color: '#fff', accent: '#000', zIndex: 15, slot,
  depth: 'midground' as const, sizeClass: 'large' as const,
  motion: 'pop' as const, delayMs: 400, motionDurationMs: 480,
  motionCurve: 'snappy' as const, motionIntensity: 1,
  imageUrl: url, credit,
});
const aiFrame = (id: string, label: string, url: string, slot: any, w = 440, h = 520) => ({
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
    visualBrief: 'Mat cat nuoc + chibi noi + polaroid coc.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(300, 1400, 'talk', ['noi1']),
      beat(2700, 1300, 'talk', ['noi1']),
      beat(4600, 1300, 'talk', ['noi1']),
      beat(6200, 800, 'react', ['noi1']),
    ],
    objects: [
      speaker('noi1', 'mid-left') as any,
      polaroid('coc-1', 'Cọc Bạch Đằng 1288', STAKES_PHOTO, 'Ảnh: Gary Todd • Wikimedia • Public domain', 'mid-right') as any,
      titleTop('t1', '3 LẦN · 1 MẸO', 'caption-bottom') as any,
    ],
  },
  {
    id: randomUUID(), name: '02 Cho trieu rut', durationMs: 5500,
    template: 'two-shot', background: 'field', backgroundRef: 'bg:field-open',
    backgroundImageUrl: BUN_HOANG_HON, backgroundAssetId: '7bd33667-df9d-4d1a-a734-59987d11defa',
    visualBrief: 'Bai bun hoang hon + 2 dan lang doi thoai.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(300, 1500, 'talk', ['xanh2']),
      beat(2100, 1200, 'point', ['nau2']),
      beat(3600, 1200, 'talk', ['xanh2']),
      beat(4900, 500, 'react', ['nau2']),
    ],
    objects: [
      speaker('xanh2', 'mid-left') as any,
      pointer('nau2', 'mid-right') as any,
      titleTop('t2', 'CHỜ THỦY TRIỀU RÚT') as any,
      chipBottom('c2', 'Sông Bạch Đằng') as any,
    ],
  },
  {
    id: randomUUID(), name: '03 Quyet chien', durationMs: 5500,
    template: 'diagram-clean', background: 'paper', backgroundRef: 'bg:paper-editorial',
    backgroundImageUrl: VICTORY_PHOTO, backgroundCredit: 'Ảnh: Gary Todd • Wikimedia • Public domain',
    visualBrief: 'Tranh chien + chibi noi + mui ten.',
    camera: { shot: 'diagram', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'arrows', x: 640, y: 300, scale: 1.2, intensity: 1.1, startMs: 800, durationMs: 2500, zIndex: 16 }],
    animationBeats: [
      beat(300, 1500, 'talk', ['noi3']),
      beat(2300, 1300, 'talk', ['noi3']),
      beat(4100, 1000, 'celebrate', ['noi3']),
    ],
    objects: [
      speaker('noi3', 'mid-left', 'medium') as any,
      titleTop('t3', '400 CHIẾN THUYỀN') as any,
      chipBottom('c3', '1288 · Bạch Đằng') as any,
    ],
  },
  {
    id: randomUUID(), name: '04 Nguoi hung', durationMs: 6500,
    template: 'split-contrast', background: 'paper', backgroundRef: 'bg:paper-editorial',
    backgroundImageUrl: MACRO_COC, backgroundAssetId: 'fb96b548-8ceb-4ce7-a9ca-1c32c2ef1ea3',
    visualBrief: 'Macro coc + 2 chan dung + chibi mung.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'glow', x: 640, y: 360, scale: 1.2, intensity: 0.7, startMs: 4500, durationMs: 1200, zIndex: 5 }],
    animationBeats: [
      beat(300, 1500, 'talk', ['noi4']),
      beat(2200, 1200, 'reveal', ['tuong-4']),
      beat(3800, 1200, 'talk', ['noi4']),
      beat(5300, 900, 'celebrate', ['noi4']),
    ],
    objects: [
      aiFrame('tuong-4', 'Vị tướng', VI_TUONG, 'mid-left', 380, 460) as any,
      aiFrame('linh-4', 'Người lính trẻ', LINH_TRE, 'mid-right', 380, 460) as any,
      speaker('noi4', 'foreground-right', 'small') as any,
      titleTop('t4', 'NGƯỜI HÙNG LÀ BẠN') as any,
    ],
  },
];

let project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Bach Dang Chibi Dong',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'bach-dang-chibi-dong-v1');
console.log('SILENT_RENDER', result.path, result.size);

const assetsDir = resolve('workdir/round23-verify/assets');
const finalOut = resolve('workdir/round23-verify/bach-dang-chibi-dong.mp4');
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
console.log('FINAL_CHIBI_VIDEO', finalOut);
const contact = resolve('workdir/round23-verify/contact-bach-dang-chibi-dong.jpg');
execFileSync('ffmpeg', ['-y', '-i', finalOut, '-vf', 'fps=1/4,scale=480:-1,tile=4x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT_SHEET', contact);
