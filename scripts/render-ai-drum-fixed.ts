/** Re-render the SAME AI drum after the cx/cy style-lock fix. No AI cost. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { lockCustomVectorStyle } from '../shared/canvasVectorStyleLock';
import { parseVectorPlan } from '../server/services/canvasVectorDirector';
import { renderCanvasFast } from '../server/services/canvasFastRender';
import { resolveBrowserExecutable } from '../server/services/animationBrowser';
import { run } from '../server/services/ffmpeg';

const out = path.resolve('tmp/ai-drum-test');
const raw = await readFile(path.join(out, 'ai-raw.json'), 'utf8');
const locked = lockCustomVectorStyle(JSON.parse(raw).nodes);
console.log('lock:', locked.ok, locked.issues.map((i) => (i.fixed ? 'fixed:' : 'FAIL:') + i.rule).join(','));
if (!locked.ok) throw new Error('still failing');
await writeFile(path.join(out, 'drum-nodes-fixed.json'), JSON.stringify(locked.repaired, null, 2));

const drumNodes = (locked.repaired as Array<Record<string, unknown>>).map((n) => ({ ...n, parent: 'ai-drum' }));
const hero = { rig: 'simple-puppet', finish: 'handdrawn', hair: 'side-part', outfit: 'tunic' };
const input = {
  vectorAssets: { hero },
  vectorStages: {
    yard: {
      template: 'illustrated-place', place: 'village', setting: 'residential',
      finish: 'handdrawn', light: 'day', festival: 'tet', cast: { person: 'hero' },
      nodes: [{ id: 'ai-drum', type: 'group', x: 500, y: 830 }, ...drumNodes],
    },
  },
  scenes: [
    { durationMs: 4000, narration: 'Trống hội dựng giữa sân, chờ giờ khai hội.', vectorScene: { stage: 'yard' } },
  ],
};
const project = parseVectorPlan(JSON.stringify(input), 'AI drum demo fixed', { width: 720, height: 1280 }, 4);
project.fps = 15;
project.exportDurationMs = 4000;
const browser = resolveBrowserExecutable();
if (!browser) throw new Error('No browser for render');
const movie = path.join(out, 'ai-drum-fixed-4s.mp4');
await renderCanvasFast(project, movie, { signature: 'ai-drum-test-v2', executable: browser, assetOrigin: 'http://127.0.0.1:8787', preset: 'ultrafast' });
await run('ffmpeg', ['-v', 'error', '-i', movie, '-f', 'null', '-']);
await run('ffmpeg', ['-v', 'error', '-y', '-i', movie, '-vf', 'fps=1,scale=180:320,tile=4x1:padding=4:margin=4', '-frames:v', '1', path.join(out, 'overview-fixed.jpg')]);
console.log(JSON.stringify({ video: movie }));
