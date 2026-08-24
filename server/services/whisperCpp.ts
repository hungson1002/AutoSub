import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { availableParallelism, constants as osConstants, setPriority } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import type { AIModel, SubtitleSegment } from '../types';
import { ProviderError } from '../adapters/errors';
import { run, temporaryRoot, workdir } from './ffmpeg';

const WHISPER_RELEASE = 'v1.9.2';
const WHISPER_ROOT = path.join(workdir, 'whisper');
const RUNTIME_ROOT = path.join(WHISPER_ROOT, 'runtime');
const MODEL_ROOT = path.join(WHISPER_ROOT, 'models');
const DOWNLOAD_ROOT = path.join(WHISPER_ROOT, 'downloads');
const TEMP_ROOT = path.join(temporaryRoot, 'whisper');

interface WhisperModelDefinition {
  id: string;
  fileName: string;
  name: string;
  detail: string;
  sizeBytes: number;
  sha1: string;
}

export const WHISPER_MODEL_DEFINITIONS: readonly WhisperModelDefinition[] = [
  {
    id: 'small-q5_1',
    fileName: 'ggml-small-q5_1.bin',
    name: 'Whisper Small Q5 · 181 MiB · khuyên dùng',
    detail: '181 MiB · cân bằng tốc độ và độ chính xác cho phim tiếng Trung',
    sizeBytes: 190_085_487,
    sha1: '6fe57ddcfdd1c6b07cdcc73aaf620810ce5fc771',
  },
  {
    id: 'medium-q5_0',
    fileName: 'ggml-medium-q5_0.bin',
    name: 'Whisper Medium Q5 · 514 MiB · chính xác hơn',
    detail: '514 MiB · nhận tên riêng tốt hơn nhưng chạy chậm hơn',
    sizeBytes: 539_212_467,
    sha1: '7718d4c1ec62ca96998f058114db98236937490e',
  },
] as const;

interface RuntimeAsset {
  fileName: string;
  url: string;
  sha256: string;
  sizeBytes: number;
}

function runtimeAsset(): RuntimeAsset | undefined {
  if (process.platform === 'win32' && process.arch === 'x64') return {
    fileName: 'whisper-bin-x64.zip',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-x64.zip`,
    sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
    sizeBytes: 8_194_445,
  };
  if (process.platform === 'linux' && process.arch === 'x64') return {
    fileName: 'whisper-bin-ubuntu-x64.tar.gz',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-ubuntu-x64.tar.gz`,
    sha256: '46811a3ecf584307480a220b9ef5ff81b7b22dc41577cbc274ce3afc61f753b1',
    sizeBytes: 9_497_583,
  };
  if (process.platform === 'linux' && process.arch === 'arm64') return {
    fileName: 'whisper-bin-ubuntu-arm64.tar.gz',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-ubuntu-arm64.tar.gz`,
    sha256: '7e26fa6a36d9174d5c0bf033ccbc026c3b5e569e2ee787058241346ef5392719',
    sizeBytes: 4_572_842,
  };
  return undefined;
}

function managedPath(target: string, root = WHISPER_ROOT) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ProviderError('Đường dẫn Whisper Local không hợp lệ.', 500);
  return target;
}

function modelDefinition(modelId: string) {
  const model = WHISPER_MODEL_DEFINITIONS.find((item) => item.id === modelId.trim());
  if (!model) throw new ProviderError(`Whisper Local không có model “${modelId}”. Hãy tải lại danh sách model.`, 400);
  return model;
}

async function hashFile(filePath: string, algorithm: 'sha1' | 'sha256') {
  const hash = createHash(algorithm);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

async function downloadFile(url: string, destination: string, expected: { algorithm: 'sha1' | 'sha256'; digest: string; sizeBytes: number }, signal?: AbortSignal) {
  await mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.${randomUUID()}.part`;
  try {
    const response = await fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'AutoSub-Whisper-Installer' } });
    if (!response.ok || !response.body) throw new ProviderError(`Không thể tải Whisper (${response.status || 'network error'}).`, 502);
    await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createWriteStream(partial));
    const downloaded = await stat(partial);
    if (downloaded.size !== expected.sizeBytes) throw new ProviderError(`File Whisper tải chưa đủ (${downloaded.size}/${expected.sizeBytes} byte).`, 502);
    const digest = await hashFile(partial, expected.algorithm);
    if (digest !== expected.digest) throw new ProviderError('File Whisper tải về không vượt qua kiểm tra toàn vẹn.', 502);
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    if (signal?.aborted) throw new ProviderError('Đã hủy tải Whisper Local.', 499);
    throw error;
  }
}

async function findExecutable(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const expected = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === expected) return candidate;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findExecutable(path.join(directory, entry.name));
    if (found) return found;
  }
  return undefined;
}

function runProcess(command: string, args: string[], signal?: AbortSignal, cwd?: string, onStderr?: (chunk: string) => void) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    if (child.pid && process.env.AUTOSUB_BACKGROUND_PRIORITY === '1') {
      try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* OS may deny priority changes; execution can continue safely. */ }
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => { child.kill(); fail(new ProviderError('Đã hủy Whisper Local.', 499)); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-256 * 1024); });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-256 * 1024);
      onStderr?.(text);
    });
    child.once('error', (error) => fail(error));
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ProviderError('Whisper Local xử lý audio thất bại.', 502, stderr || stdout || `exit ${code}`));
    });
  });
}

let runtimePromise: Promise<string> | undefined;

export async function ensureWhisperRuntime(signal?: AbortSignal) {
  const explicit = process.env.AUTOSUB_WHISPER_CPP_PATH?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!(await stat(resolved).catch(() => undefined))?.isFile()) throw new ProviderError('AUTOSUB_WHISPER_CPP_PATH không trỏ tới whisper-cli hợp lệ.', 500);
    return resolved;
  }
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const asset = runtimeAsset();
    if (!asset) throw new ProviderError(`Whisper Local chưa tự cài được trên ${process.platform}/${process.arch}. Hãy đặt AUTOSUB_WHISPER_CPP_PATH.`, 501);
    const destination = managedPath(path.join(RUNTIME_ROOT, WHISPER_RELEASE));
    const existing = await findExecutable(destination);
    if (existing) return existing;

    await Promise.all([mkdir(RUNTIME_ROOT, { recursive: true }), mkdir(DOWNLOAD_ROOT, { recursive: true })]);
    const archive = managedPath(path.join(DOWNLOAD_ROOT, `${WHISPER_RELEASE}-${asset.fileName}`));
    const archiveInfo = await stat(archive).catch(() => undefined);
    if (!archiveInfo || archiveInfo.size !== asset.sizeBytes || await hashFile(archive, 'sha256') !== asset.sha256) {
      await rm(archive, { force: true });
      await downloadFile(asset.url, archive, { algorithm: 'sha256', digest: asset.sha256, sizeBytes: asset.sizeBytes }, signal);
    }

    const staging = managedPath(await mkdtemp(path.join(RUNTIME_ROOT, `.install-${WHISPER_RELEASE}-`)));
    try {
      await runProcess('tar', ['-xf', archive, '-C', staging], signal);
      const executable = await findExecutable(staging);
      if (!executable) throw new ProviderError('Gói whisper.cpp không chứa whisper-cli.', 502);
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      const installed = await findExecutable(destination);
      if (!installed) throw new ProviderError('Không thể hoàn tất cài đặt whisper-cli.', 502);
      if (process.platform !== 'win32') await chmod(installed, 0o755);
      return installed;
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  })().catch((error) => {
    runtimePromise = undefined;
    if (signal?.aborted) throw new ProviderError('Đã hủy cài Whisper Local.', 499);
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new ProviderError('Không tìm thấy công cụ giải nén tar của hệ điều hành.', 500);
    throw error;
  });
  return runtimePromise;
}

const modelPromises = new Map<string, Promise<string>>();

export async function ensureWhisperModel(modelId: string, signal?: AbortSignal) {
  const definition = modelDefinition(modelId);
  const customRoot = process.env.AUTOSUB_WHISPER_MODEL_DIR?.trim();
  const modelDirectory = customRoot ? path.resolve(customRoot) : MODEL_ROOT;
  const destination = path.join(modelDirectory, definition.fileName);
  const existing = await stat(destination).catch(() => undefined);
  if (existing?.isFile() && existing.size === definition.sizeBytes) return destination;
  const pending = modelPromises.get(definition.id);
  if (pending) return pending;
  const promise = (async () => {
    await mkdir(modelDirectory, { recursive: true });
    if (existing) await rm(destination, { force: true });
    await downloadFile(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${definition.fileName}`,
      destination,
      { algorithm: 'sha1', digest: definition.sha1, sizeBytes: definition.sizeBytes },
      signal,
    );
    return destination;
  })().finally(() => modelPromises.delete(definition.id));
  modelPromises.set(definition.id, promise);
  return promise;
}

export async function listWhisperModels(): Promise<AIModel[]> {
  const customRoot = process.env.AUTOSUB_WHISPER_MODEL_DIR?.trim();
  const modelDirectory = customRoot ? path.resolve(customRoot) : MODEL_ROOT;
  return Promise.all(WHISPER_MODEL_DEFINITIONS.map(async (model) => {
    const info = await stat(path.join(modelDirectory, model.fileName)).catch(() => undefined);
    const downloaded = Boolean(info?.isFile() && info.size === model.sizeBytes);
    return {
      id: model.id,
      name: `${model.name}${downloaded ? ' · đã tải' : ''}`,
      capabilities: { stt: true },
      raw: { engine: 'whisper.cpp', detail: model.detail, sizeBytes: model.sizeBytes, downloaded },
    };
  }));
}

function normalizeLanguage(language?: string) {
  const value = language?.trim() || '';
  if (!value || /^(?:auto(?:matic)?(?:[\s_-]*detect)?|tự\s*nhận\s*diện)$/i.test(value)) return 'auto';
  const aliases: Record<string, string> = { 'Tiếng Việt': 'vi', '中文': 'zh', English: 'en', '한국어': 'ko' };
  return aliases[value] || value.toLowerCase();
}

export function parseWhisperJson(value: unknown): { text: string; segments: SubtitleSegment[] } {
  if (!value || typeof value !== 'object') throw new ProviderError('Whisper Local trả về JSON không hợp lệ.', 502);
  const transcription = (value as { transcription?: unknown }).transcription;
  if (!Array.isArray(transcription)) throw new ProviderError('Whisper Local không trả về danh sách transcript.', 502);
  const segments = transcription.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as { text?: unknown; offsets?: { from?: unknown; to?: unknown } };
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const startMs = Number(item.offsets?.from);
    const endMs = Number(item.offsets?.to);
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
    return [{ id: `whisper-${index + 1}`, start: startMs / 1000, end: endMs / 1000, text }];
  });
  return { text: segments.map((segment) => segment.text || '').join(' ').trim(), segments };
}

export function parseWhisperProgress(chunk: string) {
  const matches = [...chunk.matchAll(/progress\s*=\s*(\d{1,3})%/gi)];
  if (!matches.length) return undefined;
  return Math.max(0, Math.min(100, Number(matches.at(-1)?.[1])));
}

let whisperQueue: Promise<void> = Promise.resolve();

function waitForTurn(previous: Promise<void>, signal?: AbortSignal) {
  if (!signal) return previous;
  if (signal.aborted) return Promise.reject(new ProviderError('Đã hủy Whisper Local.', 499));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => finish(() => reject(new ProviderError('Đã hủy Whisper Local.', 499)));
    signal.addEventListener('abort', abort, { once: true });
    void previous.then(() => finish(resolve), () => finish(resolve));
  });
}

async function withWhisperQueue<T>(task: () => Promise<T>, signal?: AbortSignal) {
  const previous = whisperQueue;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  whisperQueue = previous.then(() => current, () => current);
  let started = false;
  try {
    await waitForTurn(previous, signal);
    started = true;
    return await task();
  } finally {
    if (started || !signal?.aborted) release();
    else void previous.then(release, release);
  }
}

function whisperThreads() {
  const fallback = Math.min(8, availableParallelism());
  const configured = Number(process.env.AUTOSUB_WHISPER_THREADS || fallback);
  return Math.max(1, Math.min(16, Number.isFinite(configured) ? Math.round(configured) : fallback));
}

async function prepareAudio(audio: Buffer | string, filename: string, directory: string, signal?: AbortSignal) {
  // The official CLI documents several formats, but some Windows release
  // builds only ship the WAV decoder. Keep the runtime deterministic by
  // passing through PCM WAV and normalizing every other container with FFmpeg.
  if (typeof audio === 'string' && /\.wav$/i.test(audio)) return audio;
  const extension = path.extname(filename).toLowerCase();
  if (Buffer.isBuffer(audio) && extension === '.wav') {
    const input = path.join(directory, `input${extension}`);
    await writeFile(input, audio);
    return input;
  }
  const source = typeof audio === 'string' ? audio : path.join(directory, `source${extension || '.bin'}`);
  if (Buffer.isBuffer(audio)) await writeFile(source, audio);
  const wav = path.join(directory, 'input.wav');
  await run('ffmpeg', ['-y', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], signal);
  return wav;
}

export async function transcribeWithWhisper(modelId: string, audio: Buffer | string, filename: string, language: string, signal?: AbortSignal, onProgress?: (percent: number) => void) {
  return withWhisperQueue(async () => {
    const [executable, modelPath] = await Promise.all([ensureWhisperRuntime(signal), ensureWhisperModel(modelId, signal)]);
    await mkdir(TEMP_ROOT, { recursive: true });
    const directory = managedPath(await mkdtemp(path.join(TEMP_ROOT, 'stt-')), TEMP_ROOT);
    try {
      const input = await prepareAudio(audio, filename, directory, signal);
      const outputBase = path.join(directory, 'result');
      const execution = await runProcess(executable, [
        '--model', modelPath,
        '--file', input,
        '--language', normalizeLanguage(language),
        '--threads', String(whisperThreads()),
        '--processors', '1',
        '--output-json',
        '--output-file', outputBase,
        '--print-progress',
      ], signal, path.dirname(executable), (chunk) => {
        const percent = parseWhisperProgress(chunk);
        if (percent !== undefined) onProgress?.(percent);
      });
      const raw = await readFile(`${outputBase}.json`, 'utf8').catch(() => {
        throw new ProviderError('Whisper Local không tạo được transcript.', 502, execution.stderr || execution.stdout || 'Không có file JSON đầu ra.');
      });
      return parseWhisperJson(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('Whisper Local không thể nhận dạng audio.', 502, error instanceof Error ? error.message : String(error));
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }, signal);
}

export async function whisperRuntimeStatus() {
  const executable = await ensureWhisperRuntime();
  const version = await runProcess(executable, ['--version'], undefined, path.dirname(executable));
  return { executable, version: (version.stdout || version.stderr).trim(), threads: whisperThreads() };
}
