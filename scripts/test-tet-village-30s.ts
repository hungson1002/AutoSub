import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import type { CanvasStudioProject } from '../shared/canvasAnimationStudio';
import { buildTetVillageBrief } from '../shared/filmRecipes';
import { run } from '../server/services/ffmpeg';

const output = path.resolve('tmp/tet-village-30s-v2');
await mkdir(output, { recursive: true });

const db = new DatabaseSync(path.join(process.env.APPDATA!, '9router/db/data.sqlite'), { readOnly: true });
const credential = db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get() as { key: string } | undefined;
db.close();
if (!credential) throw new Error('No configured local 9Router credential');

const post = async <T>(url: string, body: unknown): Promise<T> => {
  const payload = JSON.stringify(body);
  return new Promise<T>((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:8787${url}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!response.statusCode || response.statusCode >= 400) reject(new Error(result.error || `HTTP ${response.statusCode}`));
          else resolve(result as T);
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(1800000, () => req.destroy(new Error('Generation timed out; checkpoint retained')));
    req.on('error', reject);
    req.end(payload);
  });
};

const brief = buildTetVillageBrief("Video đúng 30 giây tên Chợ Tết Đầu Làng, hoạt hình 2D phẳng ngang 16:9, khoảng 80 từ tiếng Việt, giọng người kể, không thoại nhân vật. 4 cảnh: 1 (8 giây) toàn cảnh chợ Tết ban ngày nhìn từ trên cao, sạp rạ hai bên, chậu mai vàng, dây lồng đèn đỏ, 5-6 dân làng đi lại; 2 (7 giây) hiên nhà ngày Tết, cô gái tóc búi áo dài đứng cạnh câu đối đỏ và chậu mai vàng; 3 (8 giây) sân nhà ban ngày, gà nhỏ đi từng bước, rắn mảnh trườn qua sân, người đàn ông giật mình; 4 (7 giây) chợ đêm lồng đèn đỏ sáng, cột nêu đứng giữa sân, kết bằng lời chúc Tết.");
console.log('Live generation: tet-village 30s through the Animation Studio endpoint');
const project = await post<CanvasStudioProject>('/api/canvas-animation-studio/generate', {
  brief, width: 1280, height: 720, targetDurationSeconds: 30, visualMode: 'code-vector',
  provider: { id: 'qa-router', name: '9Router', baseUrl: 'http://127.0.0.1:20128/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'bearer', apiKey: credential.key },
  model: 'ag/gemini-3.8-flash-high',
  narration: { provider: { id: 'edge-tts-local', name: 'Edge TTS', baseUrl: 'local://edge-tts', enabled: true, models: [], providerType: 'edge-tts', authType: 'none' }, model: 'edge-tts', voice: 'vi-VN-NamMinhNeural', speed: 1 },
  audioProduction: { enabled: true, autoSound: false },
});
await writeFile(path.join(output, 'project.json'), JSON.stringify(project, null, 2));
console.log(JSON.stringify({ scenes: project.scenes.length, durationMs: project.scenes.reduce((sum, s) => sum + s.durationMs, 0), review: project.vectorReview }));

const job = await post<{ id: string }>(`/api/canvas-animation-studio/projects/${project.id}/render-jobs`, { project });
console.log(`Render job ${job.id}`);
for (let n = 0; n < 1200; n++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const response = await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${job.id}`);
  if (!response.ok) throw new Error(`Render status HTTP ${response.status}`);
  const status = await response.json();
  if (n % 20 === 0) console.log(`${status.status} ${status.progress}%`);
  if (status.status === 'failed') throw new Error(status.error);
  if (status.status !== 'completed') continue;
  const video = path.join(output, 'tet-village-30s.mp4');
  const downloaded = await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${job.id}/video`);
  if (!downloaded.ok) throw new Error('Completed video download failed');
  await writeFile(video, Buffer.from(await downloaded.arrayBuffer()));
  await run('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-']);
  await run('ffmpeg', ['-y', '-i', video, '-vf', 'fps=1,scale=320:180,tile=5x2:padding=5:margin=5', '-frames:v', '1', path.join(output, 'overview.jpg')]);
  if (project.vectorReview) await copyFile(path.join(project.vectorReview.previewDirectory, 'samples.json'), path.join(output, 'samples.json'));
  console.log(JSON.stringify({ video, size: status.result.size, reviewed: project.vectorReview?.pass, cached: status.cached }));
  process.exit(0);
}
throw new Error('Render pending; project and job retained');
