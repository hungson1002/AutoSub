import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { densifyAnimationBeats } from '../server/services/canvasBeatDensifier';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const SONG_URL = '/api/animation-studio/assets/db6d47d5-df39-447b-9739-06507700e6a7/file';
const DOAN_URL = '/api/animation-studio/assets/6b082b29-5418-47f0-b913-470952bc6713/file';
const TUONG_URL = '/api/animation-studio/assets/b5aa18da-d101-4318-8fc1-e8a89950f9d8/file';
const STAKES_URL = 'https://upload.wikimedia.org/wikipedia/commons/2/27/Stakes_Used_to_Repel_Mongol_Invasion_at_Bach_Dang_River%2C_1288_%289735656156%29.jpg';
const STAKES_CREDIT = 'Ảnh: Gary Todd • Wikimedia • Public domain';
const VICTORY_URL = 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Bach_Dang_River_Victory_over_Mongols%2C_1288_%289980691453%29.jpg';

const beat = (atMs: number, durationMs: number, action: any, targetIds: string[], intensity = 0.9) => ({
  id: randomUUID(), atMs, durationMs, action, targetIds, intensity,
});
const character = (id: string, archetype: any, pose: any, slot: any, facing: 'left' | 'right' = 'right', expression: any = 'neutral') => ({
  id, kind: 'character' as const, label: id, assetRef: `character:${archetype}`,
  characterKey: id, archetype, hair: 'hat' as const, role: 'focal' as const,
  slot, depth: 'foreground' as const, sizeClass: 'medium' as const,
  pose, expression, facing, x: 640, y: 360, width: 130, height: 280,
  scale: 1, rotation: 0, opacity: 1, color: '#d3a34c', secondaryColor: '#657577',
  skinTone: '#ddb08a', accent: '#2f2b27', zIndex: 20, motion: 'none' as const,
  delayMs: 0, motionDurationMs: 480, motionCurve: 'cinematic' as const, motionIntensity: 1,
});

// Durations = narration + padding: 6.2->7.5s, 4.3->5.5s, 4.4->5.5s, 5.2->6.5s = 25s
const scenes: CanvasStudioScene[] = [
  {
    id: randomUUID(), name: '01 Song Bach Dang', durationMs: 7500,
    template: 'two-shot', background: 'river', backgroundRef: 'bg:river-establishing',
    backgroundImageUrl: SONG_URL, backgroundAssetId: 'db6d47d5-df39-447b-9739-06507700e6a7',
    visualBrief: 'Nen AI song Bach Dang + anh that coc + tuong.',
    camera: { shot: 'medium', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'glow', x: 950, y: 350, scale: 1, intensity: 0.9, startMs: 1500, durationMs: 1500, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'talk', ['tran-hung-dao']),
      beat(1500, 600, 'point', ['tran-hung-dao']),
      beat(3200, 700, 'react', ['tran-hung-dao']),
      beat(5200, 700, 'talk', ['tran-hung-dao']),
    ],
    objects: [
      character('tran-hung-dao', 'warrior', 'talk', 'mid-left', 'right', 'angry'),
      {
        id: 'anh-coc-that', kind: 'image' as const, label: 'Coc Bach Dang that',
        x: 640, y: 360, width: 300, height: 420, scale: 1, rotation: -2, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 15, motion: 'pop' as const,
        imageUrl: STAKES_URL, credit: STAKES_CREDIT,
      } as any,
    ],
  },
  {
    id: randomUUID(), name: '02 Doan thuyen', durationMs: 5500,
    template: 'wide-establishing', background: 'river', backgroundRef: 'bg:river-establishing',
    backgroundImageUrl: DOAN_URL, backgroundAssetId: '6b082b29-5418-47f0-b913-470952bc6713',
    visualBrief: 'Nen AI doan thuyen + splash.',
    camera: { shot: 'wide', motion: 'pan-right', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'splash', x: 640, y: 560, scale: 1.2, intensity: 1, startMs: 2200, durationMs: 1200, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'talk', ['tuong-linh']),
      beat(1400, 600, 'brace', ['tuong-linh']),
      beat(2800, 700, 'react', ['tuong-linh']),
      beat(4200, 600, 'point', ['tuong-linh']),
    ],
    objects: [character('tuong-linh', 'warrior', 'point', 'mid-right', 'left', 'neutral')],
  },
  {
    id: randomUUID(), name: '03 Hai chien', durationMs: 5500,
    template: 'diagram-clean', background: 'map', backgroundRef: 'bg:map-tactical',
    backgroundImageUrl: VICTORY_URL, backgroundCredit: 'Ảnh: Gary Todd • Wikimedia • Public domain',
    visualBrief: 'Anh that tran hai chien + mui ten.',
    camera: { shot: 'diagram', motion: 'follow', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'arrows', x: 640, y: 300, scale: 1.2, intensity: 1.1, startMs: 800, durationMs: 3000, zIndex: 16 }],
    animationBeats: [
      beat(100, 700, 'reveal', ['tran-thuy']),
      beat(1300, 700, 'react', ['quan-su']),
      beat(3000, 700, 'point', ['quan-su']),
      beat(4400, 600, 'celebrate', ['quan-su']),
    ],
    objects: [
      {
        id: 'tran-thuy', kind: 'image' as const, label: 'Tranh hai chien Bach Dang',
        x: 640, y: 360, width: 560, height: 360, scale: 1, rotation: 0, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 14, motion: 'pop' as const,
        imageUrl: VICTORY_URL, credit: 'Ảnh: Gary Todd • Wikimedia • Public domain',
      } as any,
      character('quan-su', 'scholar', 'point', 'mid-right', 'left', 'neutral'),
    ],
  },
  {
    id: randomUUID(), name: '04 Chan dung vi tuong', durationMs: 6500,
    template: 'two-shot', background: 'room', backgroundRef: 'bg:room-study',
    visualBrief: 'Chan dung AI vi tuong + ket.',
    camera: { shot: 'medium', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'glow', x: 920, y: 360, scale: 1.1, intensity: 1, startMs: 4000, durationMs: 1500, zIndex: 16 }],
    animationBeats: [
      beat(100, 800, 'reveal', ['chan-dung']),
      beat(1400, 700, 'talk', ['nguoi-linh']),
      beat(3200, 700, 'react', ['nguoi-linh']),
      beat(5000, 800, 'celebrate', ['nguoi-linh']),
    ],
    objects: [
      {
        id: 'chan-dung', kind: 'image' as const, label: 'Chan dung vi tuong AI',
        x: 640, y: 360, width: 560, height: 620, scale: 1, rotation: 0, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 18, slot: 'hero' as const,
        depth: 'midground' as const, sizeClass: 'hero' as const,
        motion: 'pop' as const,
        imageUrl: TUONG_URL,
      } as any,
      character('nguoi-linh', 'warrior', 'celebrate', 'foreground-right', 'left', 'happy'),
    ],
  },
];

let project = compileCanvasProjectLayout({
  version: 1, id: randomUUID(), name: 'Bach Dang Final AI+TTS',
  width: 1280, height: 720, fps: 30, scenes,
} as any);
project = densifyAnimationBeats(project as any) as any;
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'round23-final-ai-tts');
console.log('SILENT_RENDER', result.path, result.size);

// Mux 4 narration tracks at scene offsets 0 / 7.5 / 13 / 18.5s
const assetsDir = resolve('workdir/round23-verify/assets');
const finalOut = resolve('workdir/round23-verify/bach-dang-final.mp4');
mkdirSync(dirname(finalOut), { recursive: true });
const starts = [0, 7500, 13000, 18500];
const inputs: string[] = [];
const filters: string[] = [];
for (let i = 0; i < 4; i += 1) {
  inputs.push('-i', `${assetsDir}/narration-${i + 1}.mp3`);
  filters.push(`[${i + 1}:a]adelay=${starts[i]}|${starts[i]},apad[a${i}]`);
}
filters.push('[a0][a1][a2][a3]amix=inputs=4:duration=longest:dropout_transition=0[aout]');
execFileSync('ffmpeg', ['-y', '-i', result.path, ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', finalOut], { stdio: 'inherit' });
console.log('FINAL', finalOut);
const contact = resolve('workdir/round23-verify/contact-final.jpg');
execFileSync('ffmpeg', ['-y', '-i', finalOut, '-vf', 'fps=1/3,scale=480:-1,tile=4x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT', contact);
