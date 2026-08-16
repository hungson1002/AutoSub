import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, workdir } from './ffmpeg';

export const DUB_MASTERING_VERSION = 1;
export const DUB_TARGET_LUFS = -14;
export const DUB_LOUDNESS_FILTER = `loudnorm=I=${DUB_TARGET_LUFS}:LRA=7:TP=-1.0,alimiter=limit=0.891:level=false`;

export async function masterDubFile(input: string, output: string, signal?: AbortSignal) {
  await run('ffmpeg', [
    '-y', '-v', 'error', '-i', input,
    '-map', '0:a:0', '-vn', '-af', DUB_LOUDNESS_FILTER,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output,
  ], signal);
}

export async function masterDubBuffer(audio: Buffer, signal?: AbortSignal) {
  const directory = path.join(workdir, 'audio-mastering');
  await mkdir(directory, { recursive: true });
  const id = randomUUID();
  const input = path.join(directory, `${id}.input`);
  const output = path.join(directory, `${id}.wav`);
  try {
    await writeFile(input, audio);
    await masterDubFile(input, output, signal);
    return await readFile(output);
  } finally {
    await Promise.all([rm(input, { force: true }), rm(output, { force: true })]);
  }
}
