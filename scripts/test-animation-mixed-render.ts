import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultTransform, type AnimationProject } from '../shared/animationStudio';

const root = await mkdtemp(path.join(tmpdir(), 'autosub-mixed-render-'));
process.env.AUTOSUB_WORKDIR = root;
const { run } = await import('../server/services/ffmpeg');
const { renderAnimationProject, validateAnimationOutput } = await import('../server/services/animationRender');
const source = path.join(root, 'blue.mp4');
await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
const bytes = await readFile(source);
const server = createServer((req, res) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
  res.end(bytes.subarray(start, end + 1));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server');
  const project: AnimationProject = {
    schemaVersion: 1, id: randomUUID(), name: 'Mixed render verification', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), width: 320, height: 180, fps: 30, assets: [],
    scenes: [
      { id: 'red', name: 'Red composite', order: 0, durationMs: 1000, narration: '', renderMode: 'composite', backgroundColor: '#ff0000', layers: [], commands: [], camera: { transform: defaultTransform(), commands: [] } },
      { id: 'blue', name: 'Blue clip', order: 1, durationMs: 1000, narration: '', renderMode: 'generated-video', prompt: 'Fixture', source: { kind: 'external-video', uri: `http://127.0.0.1:${address.port}/blue.mp4` } },
    ],
  };
  const output = await renderAnimationProject(project, false);
  await validateAnimationOutput(output.path, { width: 320, height: 180, fps: 30, durationInFrames: 60 });
  // Decode and inspect pixels in each half, not only container metadata.
  for (const [time, dominant] of [[0.5, 0], [1.5, 2]] as const) {
    const pixelFile = path.join(root, `pixel-${time}.rgb`);
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(time), '-i', output.path, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', pixelFile]);
    const pixel = await readFile(pixelFile);
    assert.ok(pixel[dominant] > 180 && pixel[(dominant + 1) % 3] < 60, `Wrong frame at ${time}s: ${[...pixel]}`);
  }
  console.log(JSON.stringify({ passed: true, output: output.path, seconds: 2, decodedSceneColors: ['red', 'blue'] }));
} finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
