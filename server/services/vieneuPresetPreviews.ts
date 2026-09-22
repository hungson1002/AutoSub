import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listVieneuPresetVoices, vieneuPresetVoiceName } from '../adapters/vieneuLocal';
import { DUB_MASTERING_VERSION, masterDubBuffer } from './audioMastering';
import { workdir } from './ffmpeg';
import { synthesizeWithVieneu, warmVieneuRuntime } from './vieneuRuntime';

// Keep this ASCII-escaped so the value is identical to the UI constant even
// when the Windows terminal uses a legacy code page.
export const VIENEU_PREVIEW_TEXT = JSON.parse('"Xin ch\\u00e0o, \\u0111\\u00e2y l\\u00e0 b\\u1ea3n nghe th\\u1eed \\u0111\\u1ec3 b\\u1ea1n \\u0111\\u00e1nh gi\\u00e1 m\\u00e0u gi\\u1ecdng, \\u0111\\u1ed9 r\\u00f5, nh\\u1ecbp n\\u00f3i v\\u00e0 c\\u1ea3m x\\u00fac tr\\u01b0\\u1edbc khi d\\u00f9ng cho to\\u00e0n b\\u1ed9 video."');
export const VIENEU_PREVIEW_SPEED = 1;

const CACHE_VERSION = 'vieneu-3.8.1-' + DUB_MASTERING_VERSION;
const PREVIEW_ROOT = path.join(workdir, 'vieneu', 'previews');
const pending = new Map<string, Promise<Buffer>>();
let firstPresetWarmup: Promise<void> | undefined;
let backgroundWarmupStarted = false;

function cacheKey(voice: string, text: string, speed: number) {
  return createHash('sha256').update(JSON.stringify({ CACHE_VERSION, voice, text, speed })).digest('hex');
}

function cacheFile(voice: string, text: string, speed: number) {
  return path.join(PREVIEW_ROOT, cacheKey(voice, text, speed) + '.wav');
}

export function isDefaultVieneuPresetPreview(voice: string, text: string, speed: number) {
  return Boolean(vieneuPresetVoiceName(voice)) && text === VIENEU_PREVIEW_TEXT && Math.abs(speed - VIENEU_PREVIEW_SPEED) < 0.001;
}

export async function readVieneuPresetPreview(voice: string, text: string, speed: number) {
  if (!isDefaultVieneuPresetPreview(voice, text, speed)) return undefined;
  try {
    return await readFile(cacheFile(voice, text, speed));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeVieneuPresetPreview(voice: string, text: string, speed: number, audio: Buffer) {
  await mkdir(PREVIEW_ROOT, { recursive: true });
  const target = cacheFile(voice, text, speed);
  const temporary = target + '.' + process.pid + '.' + Date.now() + '.tmp';
  await writeFile(temporary, audio);
  await rename(temporary, target);
}

async function createVieneuPresetPreview(voice: string, text: string, speed: number) {
  const presetName = vieneuPresetVoiceName(voice);
  if (!presetName) throw new Error('Unknown VieNeu preset voice: ' + voice);
  const raw = await synthesizeWithVieneu(text, { presetName }, speed);
  return masterDubBuffer(raw);
}

export async function ensureVieneuPresetPreview(voice: string, text = VIENEU_PREVIEW_TEXT, speed = VIENEU_PREVIEW_SPEED) {
  if (!isDefaultVieneuPresetPreview(voice, text, speed)) return undefined;
  const cached = await readVieneuPresetPreview(voice, text, speed);
  if (cached) return cached;

  const key = cacheFile(voice, text, speed);
  const existing = pending.get(key);
  if (existing) return existing;

  const task = createVieneuPresetPreview(voice, text, speed)
    .then(async (audio) => {
      await writeVieneuPresetPreview(voice, text, speed, audio);
      return audio;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

async function warmBackgroundPresets(voices: string[]) {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const voice = voices[next++];
      if (!voice) return;
      try {
        await ensureVieneuPresetPreview(voice);
      } catch (error) {
        console.warn('[VieNeu] Failed to create preset preview ' + voice + ':', error instanceof Error ? error.message : String(error));
      }
    }
  };
  await Promise.all([worker(), worker()]);
}

/** Warm the default preview first, then fill the remaining preset cache in the background. */
export function warmVieneuPresetPreviews() {
  if (!firstPresetWarmup) {
    firstPresetWarmup = (async () => {
      await warmVieneuRuntime();
      const voices = listVieneuPresetVoices().map((voice) => voice.id);
      if (!voices.length) return;
      await ensureVieneuPresetPreview(voices[0]);
      if (!backgroundWarmupStarted) {
        backgroundWarmupStarted = true;
        void warmBackgroundPresets(voices.slice(1));
      }
    })().finally(() => { firstPresetWarmup = undefined; });
  }
  return firstPresetWarmup;
}
