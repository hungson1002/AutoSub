/** LIVE demo: the tool authors a brand-new asset by itself.
 * AI draws a festival drum as raw vector nodes -> style-lock validates and
 * repairs -> the drum renders in a Tet yard scene. No developer drew it. */
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lockCustomVectorStyle } from '../shared/canvasVectorStyleLock';
import { parseVectorPlan } from '../server/services/canvasVectorDirector';
import { renderCanvasFast } from '../server/services/canvasFastRender';
import { resolveBrowserExecutable } from '../server/services/animationBrowser';
import { run } from '../server/services/ffmpeg';

const out = path.resolve('tmp/ai-drum-test');
await mkdir(out, { recursive: true });

const db = new DatabaseSync(path.join(process.env.APPDATA!, '9router/db/data.sqlite'), { readOnly: true });
const credential = db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get() as { key: string } | undefined;
db.close();
if (!credential) throw new Error('No local 9Router credential');

const SYSTEM = `You author flat 2D cartoon vector nodes for a Vietnamese folk-horror chibi film (hand-ink outlines, simple shapes, muted warm colors).
Return JSON ONLY, no markdown, no commentary: {"nodes":[...]}.
RULES: 10-20 nodes. Each node: {"id":"kebab-id","type":"path|ellipse|rect","d"|coords,"fill":"#rrggbb|none","stroke":"#rrggbb|none","strokeWidth":1-4}.
Ellipse centers use x/y (NEVER cx/cy - the engine ignores cx/cy).
Local coordinates around origin: the drum is ~120 wide, ~150 tall, bottom (stand feet) at y=0, centered x=0.
Draw: wooden A-stand (two legs + crossbar), barrel body (red #a63d32), two rope diagonals (light #e6dcc9), top+bottom rims (tan #d9c4a2), two drumstick heads resting against the body.
Paints must be #rrggbb hex or "none". No text, no eyes, no instances, ids unique kebab-case.`;

async function ask(prompt: string): Promise<{ nodes: unknown[]; usage: unknown }> {
  const response = await fetch('http://127.0.0.1:20128/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential!.key}` },
    body: JSON.stringify({ model: 'ag/gemini-3.8-flash-low', stream: false, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], temperature: 0.4, max_tokens: 1500 }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`AI HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { choices: Array<{ message: { content: string } }>; usage: unknown };
  const text = body.choices[0]!.message.content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  await writeFile(path.join(out, 'ai-raw.json'), text);
  return { nodes: (JSON.parse(text) as { nodes: unknown[] }).nodes, usage: body.usage };
}

let attempt = 0, locked = lockCustomVectorStyle([]);
let usage: unknown;
while (attempt < 2) {
  attempt += 1;
  const brief = attempt === 1
    ? 'Draw the festival drum (trong chau) for a Tet village yard.'
    : `Retry. Previous attempt failed style-lock: ${locked.issues.filter((i) => !i.fixed).map((i) => i.rule + ': ' + i.message).join('; ')}. Fix ONLY those, keep everything else.`;
  const answer = await ask(brief);
  usage = answer.usage;
  locked = lockCustomVectorStyle(answer.nodes);
  console.log(`attempt ${attempt}: ok=${locked.ok} issues=${locked.issues.map((i) => (i.fixed ? 'fixed:' : 'FAIL:') + i.rule).join(',')}`);
  if (locked.ok) break;
}
if (!locked.ok) throw new Error('AI could not pass style-lock in 2 attempts: ' + JSON.stringify(locked.issues));
await writeFile(path.join(out, 'usage.json'), JSON.stringify({ usage, attempts: attempt }));
await writeFile(path.join(out, 'drum-nodes.json'), JSON.stringify(locked.repaired, null, 2));

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
const project = parseVectorPlan(JSON.stringify(input), 'AI drum demo', { width: 720, height: 1280 }, 4);
project.fps = 15;
project.exportDurationMs = 4000;
await writeFile(path.join(out, 'project.json'), JSON.stringify(project, null, 2));

const browser = resolveBrowserExecutable();
if (!browser) throw new Error('No browser for render');
const movie = path.join(out, 'ai-drum-4s.mp4');
await renderCanvasFast(project, movie, { signature: 'ai-drum-test-v1', executable: browser, assetOrigin: 'http://127.0.0.1:8787', preset: 'ultrafast' });
await run('ffmpeg', ['-v', 'error', '-i', movie, '-f', 'null', '-']);
await run('ffmpeg', ['-v', 'error', '-y', '-i', movie, '-vf', 'fps=1,scale=180:320,tile=4x1:padding=4:margin=4', '-frames:v', '1', path.join(out, 'overview.jpg')]);
console.log(JSON.stringify({ video: movie, nodes: drumNodes.length }));
