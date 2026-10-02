import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

// Phong cách Vui Vẻ: chibi đơn giản vẽ code, nền flat, đứng yên,
// chỉ cử động theo beat hành động, cắt khô, ảnh polaroid TO + caption.
const STAKES_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/2/27/Stakes_Used_to_Repel_Mongol_Invasion_at_Bach_Dang_River%2C_1288_%289735656156%29.jpg';
const VICTORY_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Bach_Dang_River_Victory_over_Mongols%2C_1288_%289980691453%29.jpg';

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[]) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity: 1,
});
// Chibi vẽ code: pop-in rồi ĐỨNG YÊN, chỉ đổi pose theo beat. Không drift/walk/float.
const chibi = (id: string, archetype: any, pose: any, slot: any, expression: any = 'neutral') => ({
  id, kind: 'character' as const, label: id, assetRef: `character:${archetype}`,
  characterKey: id, archetype, hair: 'hat' as const, role: 'focal' as const,
  slot, depth: 'midground' as const, sizeClass: 'large' as const,
  pose, expression, facing: 'right' as const,
  x: 640, y: 360, width: 170, height: 370, scale: 1, rotation: 0, opacity: 1,
  color: '#e8b04f', accent: '#22201f', zIndex: 20, motion: 'pop' as const,
  delayMs: 0, motionDurationMs: 480, motionCurve: 'snappy' as const, motionIntensity: 1,
});
const polaroid = (id: string, label: string, url: string, credit: string, slot: any) => ({
  id, kind: 'image' as const, label,
  x: 640, y: 360, width: 560, height: 640, scale: 1, rotation: 2, opacity: 1,
  color: '#fff', accent: '#000', zIndex: 15, slot,
  depth: 'midground' as const, sizeClass: 'large' as const,
  motion: 'pop' as const, delayMs: 250, motionDurationMs: 480,
  motionCurve: 'snappy' as const, motionIntensity: 1,
  imageUrl: url, credit,
});
const title = (id: string, text: string) => ({
  id, kind: 'text' as const, label: text, text,
  x: 640, y: 110, width: 620, height: 120, scale: 1, rotation: 0, opacity: 1,
  color: '#ffffff', accent: '#1f1f1f', zIndex: 30, slot: 'caption-top' as const,
  depth: 'midground' as const, sizeClass: 'medium' as const,
  motion: 'pop' as const, delayMs: 100, motionDurationMs: 400,
  motionCurve: 'snappy' as const, motionIntensity: 1,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: '01 Coc go', durationMs: 7500,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    visualBrief: 'Chibi dung yen thuyet minh + anh coc polaroid TO.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [
      beat(600, 1500, 'talk', ['tuong']),
      beat(2800, 1000, 'point', ['tuong']),
      beat(4500, 1200, 'talk', ['tuong']),
      beat(6200, 800, 'react', ['tuong']),
    ],
    objects: [
      chibi('tuong', 'warrior', 'talk', 'mid-left', 'angry') as any,
      polaroid('anh-coc', 'Cọc Bạch Đằng 1288', STAKES_PHOTO, 'Ảnh: Gary Todd • Wikimedia • Public domain', 'mid-right') as any,
      title('t1', 'CỌC GỖ BẠCH ĐẰNG') as any,
    ],
  },
  {
    id: randomUUID(), name: '02 Thuy trieu', durationMs: 5500,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    visualBrief: 'Chibi + thuyen + splash dung 1 lan.',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'splash', x: 830, y: 560, scale: 1, intensity: 1, startMs: 2200, durationMs: 1000, zIndex: 16 }],
    animationBeats: [
      beat(600, 1500, 'talk', ['linh']),
      beat(2600, 1000, 'brace', ['linh']),
      beat(4000, 1000, 'point', ['linh']),
    ],
    objects: [
      chibi('linh', 'warrior', 'talk', 'mid-left', 'neutral') as any,
      {
        id: 'thuyen', kind: 'ship' as const, label: 'Thuyen', assetRef: 'ship:historical-warship',
        role: 'support' as const, slot: 'mid-right' as const, depth: 'midground' as const, sizeClass: 'large' as const,
        x: 640, y: 360, width: 320, height: 155, scale: 1, rotation: 0, opacity: 1,
        color: '#8a5437', accent: '#d9c4a2', zIndex: 12, motion: 'none' as const,
        delayMs: 300, motionDurationMs: 480, motionCurve: 'smooth' as const, motionIntensity: 1,
      } as any,
      title('t2', 'THỦY TRIỀU RÚT') as any,
    ],
  },
  {
    id: randomUUID(), name: '03 Quyet chien', durationMs: 5500,
    template: 'diagram-clean', background: 'map', backgroundRef: 'bg:map-tactical',
    visualBrief: 'Anh tran chien TO + mui ten + chibi chi.',
    camera: { shot: 'diagram', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'arrows', x: 640, y: 300, scale: 1.2, intensity: 1.1, startMs: 800, durationMs: 2500, zIndex: 16 }],
    animationBeats: [
      beat(300, 1000, 'reveal', ['tranhai']),
      beat(1800, 1500, 'talk', ['su']),
      beat(3800, 1200, 'point', ['su']),
    ],
    objects: [
      {
        id: 'tranhai', kind: 'image' as const, label: 'Hải chiến Bạch Đằng',
        x: 640, y: 360, width: 640, height: 420, scale: 1, rotation: 0, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 14, slot: 'center' as const,
        depth: 'midground' as const, sizeClass: 'large' as const,
        motion: 'pop' as const, delayMs: 100, motionDurationMs: 480,
        motionCurve: 'snappy' as const, motionIntensity: 1,
        imageUrl: VICTORY_PHOTO, credit: 'Ảnh: Gary Todd • Wikimedia • Public domain',
      } as any,
      chibi('su', 'scholar', 'point', 'mid-right', 'neutral') as any,
      title('t3', '400 CHIẾN THUYỀN') as any,
    ],
  },
  {
    id: randomUUID(), name: '04 Ket', durationMs: 6500,
    template: 'close-reaction', background: 'field', backgroundRef: 'bg:field-camp',
    visualBrief: 'Chibi an mung giua dong.',
    camera: { shot: 'close-up', motion: 'none', focusX: 640, focusY: 360, zoom: 1.02 },
    effects: [],
    animationBeats: [
      beat(600, 1500, 'talk', ['hung']),
      beat(2800, 1000, 'point', ['hung']),
      beat(4200, 1000, 'react', ['hung']),
      beat(5500, 800, 'celebrate', ['hung']),
    ],
    objects: [
      chibi('hung', 'warrior', 'talk', 'hero', 'happy') as any,
      title('t4', 'NGƯỜI HÙNG LÀ BẠN') as any,
    ],
  },
];

let project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Bach Dang Vui Ve',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'bach-dang-vuive-v1');
console.log('SILENT_RENDER', result.path, result.size);

const assetsDir = resolve('workdir/round23-verify/assets');
const finalOut = resolve('workdir/round23-verify/bach-dang-vuive.mp4');
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
console.log('FINAL_VUIVE_VIDEO', finalOut);
const contact = resolve('workdir/round23-verify/contact-bach-dang-vuive.jpg');
execFileSync('ffmpeg', ['-y', '-i', finalOut, '-vf', 'fps=1/4,scale=480:-1,tile=4x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT_SHEET', contact);
