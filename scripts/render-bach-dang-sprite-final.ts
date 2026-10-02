import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { densifyAnimationBeats } from '../server/services/canvasBeatDensifier';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

// Asset đặt tên dễ tìm trong library: 'Chien binh Bach Dang' (walk), 'Chien binh Bach Dang noi' (talk)
const WALK_SHEET = '/api/animation-studio/assets/935af421-63a3-44d2-917a-49fcd27e5ba0/file';
const TALK_SHEET = '/api/animation-studio/assets/9e3d4150-9191-4017-a7c4-fdb8661a47ac/file';
const RIVER_PLATE = '/api/animation-studio/assets/db6d47d5-df39-447b-9739-06507700e6a7/file';
const FLEET_PLATE = '/api/animation-studio/assets/6b082b29-5418-47f0-b913-470952bc6713/file';
const GENERAL_PORTRAIT = '/api/animation-studio/assets/b5aa18da-d101-4318-8fc1-e8a89950f9d8/file';
const STAKES_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/2/27/Stakes_Used_to_Repel_Mongol_Invasion_at_Bach_Dang_River%2C_1288_%289735656156%29.jpg';
const VICTORY_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Bach_Dang_River_Victory_over_Mongols%2C_1288_%289980691453%29.jpg';

const walk = { frameWidth: 344, frameHeight: 384, columns: 4, from: 0, to: 7, fps: 8 };
const talk = { frameWidth: 338, frameHeight: 378, columns: 4, from: 0, to: 7, fps: 8 };

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[], intensity = 0.9) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity,
});
const spriteWarrior = (id: string, sheet: string, clip: any, pose: any, motion: any, slot: any = 'foreground-left', size: any = 'medium') => ({
  id, kind: 'character' as const, label: id, assetRef: 'character:warrior',
  characterKey: id, archetype: 'warrior' as const, hair: 'hat' as const, role: 'focal' as const,
  slot, depth: 'foreground' as const, sizeClass: size,
  pose, expression: 'angry' as const, facing: 'right' as const,
  x: 320, y: 600, width: 210, height: 340, scale: 1, rotation: 0, opacity: 1,
  color: '#d3a34c', accent: '#2f2b27', zIndex: 20, motion,
  delayMs: 0, motionDurationMs: 480, motionCurve: 'cinematic' as const, motionIntensity: 1,
  imageUrl: sheet, sprite: clip,
});
const photo = (id: string, label: string, url: string, credit: string) => ({
  id, kind: 'image' as const, label,
  x: 640, y: 360, width: 300, height: 420, scale: 1, rotation: -2, opacity: 1,
  color: '#fff', accent: '#000', zIndex: 15, motion: 'pop' as const,
  imageUrl: url, credit,
});

const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: '01 Hanh quan ra tran', durationMs: 7500,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    backgroundImageUrl: RIVER_PLATE, backgroundAssetId: 'db6d47d5-df39-447b-9739-06507700e6a7',
    visualBrief: 'Sprite chien binh hanh quan tren bo song AI + anh that coc.',
    camera: { shot: 'medium', motion: 'follow', focusX: 640, focusY: 420, zoom: 1.1 },
    effects: [],
    animationBeats: [
      beat(100, 1500, 'run', ['sprite-hanh-quan']),
      beat(2000, 1500, 'run', ['sprite-hanh-quan']),
      beat(4000, 1000, 'react', ['sprite-hanh-quan']),
      beat(5500, 1000, 'point', ['sprite-hanh-quan']),
    ],
    objects: [
      spriteWarrior('sprite-hanh-quan', WALK_SHEET, walk, 'run', 'walk-right') as any,
      photo('anh-coc-that', 'Coc Bach Dang 1288 that', STAKES_PHOTO, 'Ảnh: Gary Todd • Wikimedia • Public domain') as any,
    ],
  },
  {
    id: randomUUID(), name: '02 Dong coc cho trieu', durationMs: 5500,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    backgroundImageUrl: FLEET_PLATE, backgroundAssetId: '6b082b29-5418-47f0-b913-470952bc6713',
    visualBrief: 'Can canh chien binh noi truoc doan thuyen AI + splash nuoc.',
    camera: { shot: 'medium', motion: 'push-in', focusX: 760, focusY: 400, zoom: 1.1 },
    effects: [{ id: randomUUID(), type: 'splash', x: 480, y: 580, scale: 1, intensity: 0.9, startMs: 2000, durationMs: 1200, zIndex: 16 }],
    animationBeats: [
      beat(100, 1200, 'talk', ['sprite-dong-coc']),
      beat(1700, 1000, 'react', ['sprite-dong-coc']),
      beat(3100, 1000, 'talk', ['sprite-dong-coc']),
      beat(4400, 800, 'point', ['sprite-dong-coc']),
    ],
    objects: [spriteWarrior('sprite-dong-coc', TALK_SHEET, talk, 'talk', 'none', 'hero-right', 'large') as any],
  },
  {
    id: randomUUID(), name: '03 Quyet chien', durationMs: 5500,
    template: 'diagram-clean', background: 'map', backgroundRef: 'bg:map-tactical',
    backgroundImageUrl: VICTORY_PHOTO, backgroundCredit: 'Ảnh: Gary Todd • Wikimedia • Public domain',
    visualBrief: 'Anh that hai chien + sprite noi + mui ten.',
    camera: { shot: 'diagram', motion: 'follow', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'arrows', x: 640, y: 300, scale: 1.2, intensity: 1.1, startMs: 800, durationMs: 3000, zIndex: 16 }],
    animationBeats: [
      beat(100, 1200, 'talk', ['sprite-quyet-chien']),
      beat(1700, 1200, 'talk', ['sprite-quyet-chien']),
      beat(3400, 800, 'react', ['sprite-quyet-chien']),
      beat(4500, 700, 'celebrate', ['sprite-quyet-chien']),
    ],
    objects: [spriteWarrior('sprite-quyet-chien', TALK_SHEET, talk, 'talk', 'none', 'foreground-left', 'large') as any],
  },
  {
    id: randomUUID(), name: '04 Vi tuong ket', durationMs: 6500,
    template: 'two-shot', background: 'room', backgroundRef: 'bg:room-study',
    visualBrief: 'Chan dung AI vi tuong + sprite chao mung.',
    camera: { shot: 'medium', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'glow', x: 920, y: 360, scale: 1.1, intensity: 1, startMs: 4000, durationMs: 1500, zIndex: 16 }],
    animationBeats: [
      beat(100, 1200, 'reveal', ['chan-dung-vi-tuong']),
      beat(1700, 1200, 'talk', ['sprite-chao-mung']),
      beat(3400, 1200, 'celebrate', ['sprite-chao-mung']),
      beat(5100, 900, 'celebrate', ['sprite-chao-mung']),
    ],
    objects: [
      {
        id: 'chan-dung-vi-tuong', kind: 'image' as const, label: 'Chan dung vi tuong AI',
        x: 640, y: 360, width: 560, height: 620, scale: 1, rotation: 0, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 18, slot: 'hero' as const,
        depth: 'midground' as const, sizeClass: 'hero' as const, motion: 'pop' as const,
        imageUrl: GENERAL_PORTRAIT,
      } as any,
      { ...spriteWarrior('sprite-chao-mung', TALK_SHEET, talk, 'celebrate', 'none'), slot: 'foreground-right' as const } as any,
    ],
  },
];

let project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Bach Dang Sprite Final',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
project = densifyAnimationBeats(project as any) as any;
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'bach-dang-sprite-final');
console.log('SILENT_RENDER', result.path, result.size);

const assetsDir = resolve('workdir/round23-verify/assets');
const finalOut = resolve('workdir/round23-verify/bach-dang-sprite-final.mp4');
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
console.log('FINAL_SPRITE_VIDEO', finalOut);
const contact = resolve('workdir/round23-verify/contact-bach-dang-sprite-final.jpg');
execFileSync('ffmpeg', ['-y', '-i', finalOut, '-vf', 'fps=1/4,scale=480:-1,tile=4x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT_SHEET', contact);
