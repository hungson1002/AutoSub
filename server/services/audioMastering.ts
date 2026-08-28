import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, workdir } from './ffmpeg';

export const DUB_MASTERING_VERSION = 4;
export const DUB_TARGET_LUFS = -16;
const DUB_TARGET_LRA = 11;
const DUB_TARGET_TRUE_PEAK = -2.0;
const loudnessBase = `loudnorm=I=${DUB_TARGET_LUFS}:LRA=${DUB_TARGET_LRA}:TP=${DUB_TARGET_TRUE_PEAK.toFixed(1)}`;
export const DUB_LOUDNESS_FILTER = `${loudnessBase},alimiter=limit=0.794:level=false:latency=true`;

type LoudnessMeasurements = {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
};

function parseLoudnessMeasurements(stderr: string): LoudnessMeasurements {
  const blocks = stderr.match(/\{[\s\S]*?\}/g) || [];
  const parsed = JSON.parse(blocks.at(-1) || '{}') as Partial<LoudnessMeasurements>;
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const) {
    if (!Number.isFinite(Number(parsed[key]))) throw new Error(`FFmpeg loudnorm did not return ${key}.`);
  }
  return parsed as LoudnessMeasurements;
}

export function buildLinearLoudnessFilter(measured: LoudnessMeasurements) {
  return `${loudnessBase}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,alimiter=limit=0.794:level=false:latency=true`;
}

export async function masterDubFile(input: string, output: string, signal?: AbortSignal) {
  const analysis = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', input,
    '-map', '0:a:0', '-vn', '-af', `${loudnessBase}:print_format=json`,
    '-f', 'null', '-',
  ], signal);
  const filter = buildLinearLoudnessFilter(parseLoudnessMeasurements(analysis.stderr));
  await run('ffmpeg', [
    '-y', '-v', 'error', '-i', input,
    '-map', '0:a:0', '-vn', '-af', filter,
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
