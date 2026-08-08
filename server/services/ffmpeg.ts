import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const workdir = path.join(process.cwd(), 'workdir');
export async function ensureWorkdir() { for (const name of ['uploads', 'audio', 'frames', 'subtitles', 'tts', 'exports']) await mkdir(path.join(workdir, name), { recursive: true }); }
export function run(command: string, args: string[], signal?: AbortSignal, onStderr?: (chunk: string) => void) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => { child.kill(); fail(new Error(`${command} cancelled`)); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { const text = chunk.toString(); stderr += text; onStderr?.(text); });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}
export async function available(command: string) { try { await run(command, ['-version']); return true; } catch { return false; } }
export async function cleanWorkdir() { await rm(workdir, { recursive: true, force: true }); await ensureWorkdir(); }
export async function probeDimensions(filePath: string) { const result = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', filePath]); const [width, height] = result.stdout.trim().split('x').map(Number); return { width: width || 1920, height: height || 1080 }; }
export async function extractAudio(input: string, output: string) { await run('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output]); }
export async function extractRoiFrames(input: string, outputPattern: string, fps: number, roi: { x: number; y: number; w: number; h: number }) { const filter = `fps=${fps},crop=iw*${roi.w / 100}:ih*${roi.h / 100}:iw*${roi.x / 100}:ih*${roi.y / 100}`; await run('ffmpeg', ['-y', '-i', input, '-vf', filter, '-q:v', '4', outputPattern]); }
