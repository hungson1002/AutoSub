import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AIVoice } from '../types';
import { ProviderError } from '../adapters/errors';
import { run, workdir } from './ffmpeg';

export const VIENEU_VOICE_ROOT = path.join(workdir, 'voice-clones', 'vieneu');
export const MAX_VOICE_REFERENCE_BYTES = 25 * 1024 * 1024;
export const MIN_VOICE_REFERENCE_SECONDS = 3;
export const MAX_VOICE_REFERENCE_SECONDS = 15;
const NORMALIZED_REFERENCE_SECONDS = 8;
export const VOICE_REFERENCE_VERSION = 2;
export const VOICE_REFERENCE_SAMPLE_RATE = 48_000;
export const VOICE_REFERENCE_FILTER = 'silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_duration=0.10:start_threshold=-45dB,areverse,loudnorm=I=-20:LRA=7:TP=-3';

export interface VoiceCloneProfile {
  id: string;
  name: string;
  language: 'vi-VN';
  durationMs: number;
  createdAt: string;
  sourceName: string;
  authorized: true;
  referenceVersion?: number;
}

const validProfileId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

function cleanProfileName(value: string) {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) throw new ProviderError('Hãy nhập tên cho giọng clone.', 400);
  if (name.length > 80) throw new ProviderError('Tên giọng clone tối đa 80 ký tự.', 400);
  return name;
}

async function probeDurationSeconds(file: string) {
  try {
    const result = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    const duration = Number(result.stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('duration unavailable');
    return duration;
  } catch (error) {
    throw new ProviderError('File mẫu không phải audio/video hợp lệ hoặc FFprobe không đọc được.', 400, error instanceof Error ? error.message : undefined);
  }
}

async function readProfile(directory: string): Promise<VoiceCloneProfile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path.join(directory, 'profile.json'), 'utf8')) as VoiceCloneProfile;
    if (!validProfileId(parsed.id) || !parsed.name || parsed.authorized !== true) return undefined;
    if (!(await stat(path.join(directory, 'reference.wav')).catch(() => undefined))?.isFile()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function listVoiceCloneProfiles(): Promise<VoiceCloneProfile[]> {
  await mkdir(VIENEU_VOICE_ROOT, { recursive: true });
  const entries = await readdir(VIENEU_VOICE_ROOT, { withFileTypes: true });
  const profiles = await Promise.all(entries.filter((entry) => entry.isDirectory() && validProfileId(entry.name)).map((entry) => readProfile(path.join(VIENEU_VOICE_ROOT, entry.name))));
  return profiles.filter((profile): profile is VoiceCloneProfile => Boolean(profile)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function voiceProfileToVoice(profile: VoiceCloneProfile): AIVoice {
  return { id: profile.id, name: profile.name, language: profile.language, source: 'clone' };
}

export async function resolveVoiceCloneReference(id: string) {
  if (!validProfileId(id)) throw new ProviderError('Voice ID của VieNeu Local không hợp lệ.', 400);
  const directory = path.join(VIENEU_VOICE_ROOT, id);
  const profile = await readProfile(directory);
  if (!profile) throw new ProviderError('Không tìm thấy hồ sơ giọng clone. Hãy tạo hoặc chọn lại giọng.', 404);
  return { profile, referencePath: path.join(directory, 'reference.wav') };
}

export async function createVoiceCloneProfile(input: { name: string; sourcePath: string; sourceName: string; authorized: boolean }) {
  if (input.authorized !== true) throw new ProviderError('Bạn phải xác nhận sở hữu giọng hoặc đã được người nói cho phép.', 400);
  const name = cleanProfileName(input.name);
  const sourceInfo = await stat(input.sourcePath).catch(() => undefined);
  if (!sourceInfo?.isFile()) throw new ProviderError('Thiếu file mẫu giọng.', 400);
  if (sourceInfo.size > MAX_VOICE_REFERENCE_BYTES) throw new ProviderError('File mẫu giọng tối đa 25 MB.', 413);
  const sourceDuration = await probeDurationSeconds(input.sourcePath);
  if (sourceDuration < MIN_VOICE_REFERENCE_SECONDS) throw new ProviderError('Mẫu giọng phải dài ít nhất 3 giây.', 400);
  if (sourceDuration > MAX_VOICE_REFERENCE_SECONDS) throw new ProviderError('Mẫu giọng tối đa 15 giây. Hãy cắt một đoạn sạch khoảng 3–8 giây.', 400);

  await mkdir(VIENEU_VOICE_ROOT, { recursive: true });
  const id = randomUUID();
  const staging = path.join(VIENEU_VOICE_ROOT, `.${id}.tmp`);
  const destination = path.join(VIENEU_VOICE_ROOT, id);
  const referencePath = path.join(staging, 'reference.wav');
  await mkdir(staging, { recursive: true });
  try {
    await run('ffmpeg', [
      '-y', '-v', 'error', '-i', input.sourcePath,
      '-vn', '-filter:a', VOICE_REFERENCE_FILTER, '-t', String(NORMALIZED_REFERENCE_SECONDS),
      '-ac', '1', '-ar', String(VOICE_REFERENCE_SAMPLE_RATE), '-c:a', 'pcm_s16le', referencePath,
    ]);
    const normalizedDuration = await probeDurationSeconds(referencePath);
    if (normalizedDuration < MIN_VOICE_REFERENCE_SECONDS) throw new ProviderError('Sau khi chuẩn hóa, mẫu giọng còn quá ngắn.', 400);
    const profile: VoiceCloneProfile = {
      id,
      name,
      language: 'vi-VN',
      durationMs: Math.round(normalizedDuration * 1000),
      createdAt: new Date().toISOString(),
      sourceName: path.basename(input.sourceName || 'voice-reference'),
      authorized: true,
      referenceVersion: VOICE_REFERENCE_VERSION,
    };
    await writeFile(path.join(staging, 'profile.json'), JSON.stringify(profile, null, 2), 'utf8');
    await rename(staging, destination);
    return profile;
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('Không thể chuẩn hóa mẫu giọng bằng FFmpeg.', 400, error instanceof Error ? error.message : undefined);
  }
}

export async function deleteVoiceCloneProfile(id: string) {
  const { profile } = await resolveVoiceCloneReference(id);
  await rm(path.join(VIENEU_VOICE_ROOT, profile.id), { recursive: true, force: true });
  return profile;
}
