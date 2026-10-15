/** Tet village short-film smoke test: stage reuse + Tet dressing + crowd + day/home/night.
 * No AI provider, no TTS. Deterministic vector plan + headless fast render. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseVectorPlan } from '../server/services/canvasVectorDirector';
import { renderCanvasFast } from '../server/services/canvasFastRender';
import { resolveBrowserExecutable } from '../server/services/animationBrowser';
import { run } from '../server/services/ffmpeg';

const out = path.resolve('tmp/tet-village-test');
await mkdir(out, { recursive: true });

const hero = { rig: 'simple-puppet', finish: 'handdrawn', hair: 'side-part', outfit: 'tunic', palette: { skin: '#e8c39a', shirt: '#3f5566', hair: '#222222', trim: '#c9b489', accent: '#7a6a55', inner: '#e6dcc9' } };
const wife = { rig: 'simple-puppet', finish: 'handdrawn', hair: 'bun', outfit: 'ao-dai', palette: { skin: '#efd7b9', shirt: '#6b5a7a', hair: '#1e1e1e', trim: '#d1bd87', accent: '#a38b73', inner: '#efdfc5' } };
const elder = { rig: 'simple-puppet', finish: 'handdrawn', hair: 'tied', outfit: 'shawl', facialHair: 'beard', palette: { skin: '#e2c39a', shirt: '#6f6a58', hair: '#bbbbbb', trim: '#c6b191', accent: '#8a7a66', inner: '#e6dcc9' } };
const vendor = { rig: 'simple-puppet', finish: 'handdrawn', hair: 'none', headwear: 'conical', outfit: 'vest', palette: { skin: '#e8c39a', shirt: '#7a6a4a', hair: '#333333', trim: '#c9b489', accent: '#7a6a55', inner: '#e6dcc9' } };

const input = {
  vectorAssets: { hero, wife, elder, vendor, hen: { rig: 'simple-chicken', facing: 'right' }, snake: { rig: 'simple-snake', facing: 'left' } },
  vectorStages: {
    tetMarket: {
      template: 'illustrated-place', place: 'village', setting: 'market',
      finish: 'handdrawn', light: 'day', festival: 'tet', cast: { person: 'hero' },
      extras: [
        { id: 'wife', asset: 'wife' },
        { id: 'elder', asset: 'elder' },
        { id: 'vendor', asset: 'vendor' },
      ],
    },
    tetHome: {
      template: 'illustrated-place', place: 'village', setting: 'residential',
      finish: 'handdrawn', light: 'day', festival: 'tet', cast: { person: 'wife' },
      extras: [{ id: 'hero-at-home', asset: 'hero', x: 480, footY: 960, height: 250 }],
    },
    tetNight: {
      template: 'illustrated-place', place: 'village', setting: 'market',
      finish: 'handdrawn', light: 'night', festival: 'tet', cast: { person: 'elder' },
      extras: [{ id: 'night-vendor', asset: 'vendor' }],
    },
    tetYard: {
      template: 'illustrated-place', place: 'village', setting: 'residential',
      finish: 'handdrawn', light: 'day', festival: 'tet', cast: { person: 'hero' },
      extras: [
        { id: 'hen', asset: 'hen', x: 130, footY: 950, height: 52 },
        { id: 'snake', asset: 'snake', x: 260, footY: 968, height: 34 },
      ],
    },
  },
  scenes: [
    {
      id: 'cho-tet', durationMs: 4000, narration: 'Sáng mùng một, chợ Tết đông vui, mai vàng nở trước sân.',
      vectorScene: { stage: 'tetMarket' },
    },
    {
      id: 'nha-tet', durationMs: 4000, narration: 'Trước hiên nhà, câu đối đỏ dán hai bên cửa, chậu mai vàng rực.',
      vectorScene: { stage: 'tetHome', shot: { target: 'person', height: 0.5 } },
    },
    {
      id: 'gap-cu-gia', durationMs: 4000, narration: 'Cụ già lặng nhìn phiên chợ, lồng đèn đỏ treo cao.',
      vectorScene: {
        stage: 'tetMarket',
        shot: { target: 'elder', height: 0.4 },
        reactions: [{ actor: 'person', kind: 'startle', toward: 'elder', start: 0.4, end: 0.7, cue: 'lặng nhìn phiên chợ' }],
      },
    },
    {
      id: 'dem-tet', durationMs: 4000, narration: 'Đêm xuống, chợ vẫn sáng đèn, cột nêu đứng giữa sân.',
      vectorScene: { stage: 'tetNight' },
    },
    {
      id: 'san-ga-ran', durationMs: 5000, narration: 'Ngoài sân, gà đứng mổ thóc, rắn trườn qua.',
      vectorScene: {
        stage: 'tetYard',
        walks: [
          { actor: 'snake', to: 'hen', gap: 80, start: 0.3, end: 0.6, cue: 'rắn trườn qua' },
        ],
      },
    },
    {
      id: 'giu-khung-hinh', durationMs: 4000, narration: 'Vẫn phiên chợ ấy, mọi người giữ nguyên vị trí, tiếng pháo xa dần.',
      vectorScene: { stage: 'tetMarket' },
    },
  ],
};

const project = parseVectorPlan(JSON.stringify(input), 'Làng Tết test', { width: 1280, height: 720 }, 25);
project.fps = 15;
project.exportDurationMs = 25000;
await writeFile(path.join(out, 'project.json'), JSON.stringify(project, null, 2));

// Proofs: tet dressing present on every stage; market reused between cuts 1 and 5.
for (const [i, s] of project.scenes.entries()) {
  const ids = s.vectorScene!.nodes.filter((n) => n.id.startsWith('tet-')).map((n) => n.id);
  if (!ids.includes('tet-mai-0') || !ids.includes('tet-neu-pole') || !ids.includes('tet-lantern-string')) {
    throw new Error(`Scene ${i} missing tet dressing: ` + ids.join(','));
  }
}
const a = project.scenes[0]!.vectorScene!.nodes;
const e = project.scenes[5]!.vectorScene!.nodes;
if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error('Long-form stage reuse broken between cuts 1 and 6');
console.log(JSON.stringify({ scenes: project.scenes.length, actors: a.filter((n) => n.type === 'instance').length }));

const browser = resolveBrowserExecutable();
if (!browser) throw new Error('No browser available for render');
const movie = path.join(out, 'tet-village-25s.mp4');
await renderCanvasFast(project, movie, { signature: 'tet-village-test-v2', executable: browser, assetOrigin: 'http://127.0.0.1:8787', preset: 'ultrafast' });
await run('ffmpeg', ['-v', 'error', '-i', movie, '-f', 'null', '-']);
const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height,codec_name', '-of', 'json', movie])).stdout);
await run('ffmpeg', ['-v', 'error', '-y', '-i', movie, '-vf', 'fps=1,scale=320:180,tile=5x4:padding=4:margin=4', '-frames:v', '1', path.join(out, 'overview.jpg')]);
console.log(JSON.stringify({ video: movie, probe }));
