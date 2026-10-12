import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { run } from '../server/services/ffmpeg';
import {compileCanvasCharacterCostumes,compileSimpleHorrorStaging} from '../server/services/canvasAnimationDirector';
import {compileCanvasProjectLayout} from '../shared/canvasLayoutCompiler';

const output = path.resolve('tmp/simple-horror-check');
await mkdir(output, { recursive: true });
const db = new DatabaseSync(path.join(process.env.APPDATA!, '9router/db/data.sqlite'), { readOnly: true });
const credential = db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get() as { key: string } | undefined;
db.close();
if (!credential) throw new Error('No active 9Router credential');
const post = async (url: string, body: unknown) => new Promise<any>((resolve, reject) => {
  const payload = JSON.stringify(body);
  const request = http.request({
    hostname: '127.0.0.1', port: 8787, path: url, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  }, response => {
    const chunks: Buffer[] = [];
    response.on('data', chunk => chunks.push(Buffer.from(chunk)));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if ((response.statusCode || 500) >= 400) return reject(new Error(text));
      try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
    });
  });
  request.setTimeout(900000, () => request.destroy(new Error('QA production request timed out after 15 minutes')));
  request.on('error', reject);
  request.end(payload);
});
console.log('Generating through the real production tool');
const project = process.env.CANVAS_QA_RERENDER==='1'
  ? compileCanvasProjectLayout(compileCanvasCharacterCostumes(compileSimpleHorrorStaging(JSON.parse(await readFile(path.join(output,'project.json'),'utf8')))))
  : await post('/api/canvas-animation-studio/generate', {
  brief: 'Truyện ma đơn giản 38 giây tên Người ở dưới sàn. Minh áo xanh đứng bên trái bếp lửa trong một căn nhà sàn ban đêm, ông Panh áo nâu đứng bên phải. Cảnh sau vẫn đúng căn phòng và đúng vị trí đó, chỉ có thêm một chiếc đèn dầu được đặt gần bếp; không được re-layout hai người hay camera. Sau đó bà Lý bước vào từ phía sau bên phải; Minh, ông Panh và bếp vẫn giữ nguyên vị trí, chỉ bà Lý xuất hiện nhẹ nhàng. Sau đó câu chuyện thật sự cắt sang góc nhìn cánh cửa tối khi Minh nghe tiếng gõ. Cuối cùng mới đổi địa điểm xuống gầm nhà sàn: phải nhìn rõ mặt dưới sàn gỗ ở phía trên, cột chống, giằng chéo, cầu thang từ đất lên sàn và nền đất; Minh ở tiền cảnh, một bóng người đứng sâu phía sau. Chỉ 5 cảnh, nhịp chậm, hình 2D tối giản kinh dị. Không reset camera khi chỉ thêm asset hoặc nhân vật, không teleport nhân vật, không zoom/pan/rung trang trí. Có người kể chuyện và lời thoại rất ngắn nếu cần.',
  provider: { id: 'qa-router', name: '9Router', baseUrl: 'http://127.0.0.1:20128/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'bearer', apiKey: credential.key },
  model: 'ag/gemini-3.8-flash-high', visualMode: 'procedural', targetDurationSeconds: 38,
  narration: { provider: { id: 'edge-tts-local', name: 'Edge TTS', baseUrl: 'local://edge-tts', enabled: true, models: [], providerType: 'edge-tts', authType: 'none' }, model: 'edge-tts', voice: 'vi-VN-NamMinhNeural', speed: 1 },
  audioProduction: { enabled: true, autoSound: true },
});
await writeFile(path.join(output, 'project.json'), JSON.stringify(project, null, 2));
console.log(`Generated ${project.scenes.length} scenes, ${project.scenes.reduce((sum: number, scene: any) => sum + scene.durationMs, 0)}ms`);
const initial = await post(`/api/canvas-animation-studio/projects/${project.id}/render-jobs`, { project });
console.log(`Render job ${initial.id}`);
for (let n = 0; n < 900; n++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const response = await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${initial.id}`);
  if (!response.ok) throw new Error(await response.text());
  const job = await response.json();
  if (n % 20 === 0) console.log(`Render ${job.status} ${job.progress}%`);
  if (job.status === 'failed') throw new Error(job.error);
  if (job.status !== 'completed') continue;
  const video = path.join(output, 'nguoi-o-duoi-san-continuity.mp4');
  await copyFile(job.result.path, video);
  await run('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-']);
  await run('ffmpeg', ['-y', '-i', video, '-vf', 'fps=1/4,scale=480:270,tile=4x3', '-frames:v', '1', path.join(output, 'overview.png')]);
  console.log(`Completed: ${video}`);
  process.exit(0);
}
throw new Error('Render still pending; job retained');
