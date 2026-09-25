import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { ProviderError } from '../adapters/errors';
import { workdir } from './ffmpeg';

const KOKORO_VERSION = '0.6.1';
const RUNTIME_ROOT = path.join(workdir, 'kokoro', 'runtime');
const MODEL_ROOT = path.join(RUNTIME_ROOT, 'models');
const MODEL_FILE = 'kokoro-v1.0.onnx';
const VOICES_FILE = 'voices-v1.0.bin';
const MODEL_URL = `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/${MODEL_FILE}`;
const VOICES_URL = `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/${VOICES_FILE}`;
const BRIDGE_SCRIPT = path.join(process.cwd(), 'server', 'services', 'kokoro_bridge.py');
const IDLE_TIMEOUT_MS = Math.max(60_000, Number(process.env.AUTOSUB_KOKORO_IDLE_TIMEOUT_MS) || 10 * 60_000);

const pythonExecutable = () => process.platform === 'win32'
  ? path.join(RUNTIME_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(RUNTIME_ROOT, '.venv', 'bin', 'python');

function runProcess(command: string, args: string[], signal?: AbortSignal, timeoutMs = 15 * 60_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => { child.kill(); fail(new ProviderError('Cài Kokoro đã quá thời gian cho phép.', 504)); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => { child.kill(); fail(new ProviderError('Đã hủy cài Kokoro.', 499)); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-256 * 1024); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-256 * 1024); });
    child.once('error', fail);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ProviderError('Không thể cài runtime Kokoro Local.', 503, stderr || stdout || `exit ${code}`));
    });
  });
}

async function findUv() {
  const candidates = [process.env.AUTOSUB_UV_PATH?.trim(), 'uv'];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe', 'uv.exe'));
  }
  for (const candidate of candidates.filter((value): value is string => Boolean(value))) {
    try { await runProcess(candidate, ['--version'], undefined, 15_000); return candidate; } catch { /* try the next uv location */ }
  }
  throw new ProviderError('Không tìm thấy uv để cài Kokoro Local. Cài uv hoặc đặt AUTOSUB_UV_PATH rồi thử lại.', 503);
}

async function runtimeIsReady(executable: string, checkVersion = false) {
  try {
    const versionCheck = checkVersion ? `import importlib.metadata; assert importlib.metadata.version('kokoro-onnx') == '${KOKORO_VERSION}'; ` : '';
    await runProcess(executable, ['-c', `${versionCheck}import kokoro_onnx, onnxruntime; print('ready')`], undefined, 90_000);
    return true;
  } catch { return false; }
}

async function downloadAsset(url: string, destination: string, minimumBytes: number, signal?: AbortSignal) {
  const existing = await stat(destination).catch(() => undefined);
  if (existing && existing.size >= minimumBytes) return;
  const temporary = `${destination}.part`;
  await rm(temporary, { force: true });
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]) : AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new ProviderError(`Không tải được model Kokoro (${response.status}).`, 503, url);
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(temporary), { signal });
    const downloaded = await stat(temporary);
    if (downloaded.size < minimumBytes) throw new ProviderError('File tải về không phải model Kokoro đầy đủ; hãy kiểm tra mạng rồi thử lại.', 502, `${downloaded.size} bytes`);
    await rm(destination, { force: true });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('Tải model Kokoro thất bại; file tải dở đã được dọn để có thể thử lại.', 503, error instanceof Error ? error.message : undefined);
  }
}

let runtimePromise: Promise<{ executable: string; modelPath: string; voicesPath: string }> | undefined;

export async function ensureKokoroRuntime(signal?: AbortSignal) {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    await mkdir(MODEL_ROOT, { recursive: true });
    const modelPath = path.resolve(process.env.AUTOSUB_KOKORO_MODEL_PATH?.trim() || path.join(MODEL_ROOT, MODEL_FILE));
    const voicesPath = path.resolve(process.env.AUTOSUB_KOKORO_VOICES_PATH?.trim() || path.join(MODEL_ROOT, VOICES_FILE));
    const explicit = process.env.AUTOSUB_KOKORO_PYTHON?.trim();
    let executable = explicit ? path.resolve(explicit) : pythonExecutable();

    if (explicit) {
      if (!await runtimeIsReady(executable, true)) throw new ProviderError('AUTOSUB_KOKORO_PYTHON chưa có đúng kokoro-onnx==0.6.1 và onnxruntime.', 503);
    } else {
      const uv = await findUv();
      if (!await stat(executable).then((item) => item.isFile()).catch(() => false)) {
        await runProcess(uv, ['venv', '--python', '3.12', path.join(RUNTIME_ROOT, '.venv')], signal);
      }
      if (!await runtimeIsReady(executable, true)) {
        await runProcess(uv, ['pip', 'install', '--python', executable, `kokoro-onnx==${KOKORO_VERSION}`], signal, 30 * 60_000);
      }
      if (!await runtimeIsReady(executable, true)) throw new ProviderError('Kokoro Local đã cài nhưng Python chưa import được ONNX runtime.', 503);
    }

    await Promise.all([mkdir(path.dirname(modelPath), { recursive: true }), mkdir(path.dirname(voicesPath), { recursive: true })]);
    await Promise.all([
      downloadAsset(MODEL_URL, modelPath, 200_000_000, signal),
      downloadAsset(VOICES_URL, voicesPath, 15_000_000, signal),
    ]);
    return { executable, modelPath, voicesPath };
  })().catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

type KokoroResponse = { id?: string; ready?: boolean; ok?: boolean; fatal?: boolean; error?: string; audioBase64?: string };
type PendingRequest = { resolve: (response: KokoroResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; cleanup: () => void };

let worker: ChildProcessWithoutNullStreams | undefined;
let workerStartPromise: Promise<ChildProcessWithoutNullStreams> | undefined;
let stdoutBuffer = '';
let stderrTail = '';
let idleTimer: NodeJS.Timeout | undefined;
const pending = new Map<string, PendingRequest>();

function stopWorker(reason?: Error) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  const current = worker;
  worker = undefined;
  stdoutBuffer = '';
  if (current && !current.killed) current.kill();
  if (reason) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.cleanup(); item.reject(reason); }
    pending.clear();
  }
}

function scheduleIdleStop() {
  if (idleTimer) clearTimeout(idleTimer);
  if (pending.size) return;
  idleTimer = setTimeout(() => stopWorker(), IDLE_TIMEOUT_MS);
  idleTimer.unref();
}

function handleWorkerExit(child: ChildProcessWithoutNullStreams, error: Error) {
  if (worker !== child) return;
  stopWorker(new ProviderError('Kokoro Local bị dừng khi đang tạo giọng.', 502, stderrTail || error.message));
}

async function getWorker(signal?: AbortSignal) {
  if (worker && !worker.killed && worker.exitCode === null) return worker;
  if (workerStartPromise) return workerStartPromise;
  workerStartPromise = (async () => {
    const runtime = await ensureKokoroRuntime(signal);
    const child = spawn(runtime.executable, [BRIDGE_SCRIPT, runtime.modelPath, runtime.voicesPath], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        AUTOSUB_KOKORO_THREADS: String(Math.max(1, Math.min(4, Number(process.env.AUTOSUB_KOKORO_THREADS) || 2))),
      },
    });
    worker = child;
    stdoutBuffer = '';
    stderrTail = '';
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const readyTimer = setTimeout(() => { child.kill(); readyReject(new ProviderError('Kokoro model không khởi động kịp thời.', 504)); }, 5 * 60_000);

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
      if (stdoutBuffer.length > 64 * 1024 * 1024) {
        handleWorkerExit(child, new Error('Kokoro bridge response exceeded limit'));
        return;
      }
      let newline = stdoutBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        newline = stdoutBuffer.indexOf('\n');
        if (!line) continue;
        let response: KokoroResponse;
        try { response = JSON.parse(line) as KokoroResponse; }
        catch { handleWorkerExit(child, new Error('Invalid Kokoro bridge JSON')); return; }
        if (response.ready) { readyResolve(); continue; }
        if (response.fatal) { readyReject(new ProviderError('Kokoro không nạp được model ONNX.', 503, response.error)); continue; }
        const item = response.id ? pending.get(response.id) : undefined;
        if (!item) continue;
        pending.delete(response.id!);
        clearTimeout(item.timer);
        item.cleanup();
        item.resolve(response);
        scheduleIdleStop();
      }
    });
    child.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString('utf8')).slice(-64 * 1024); });
    child.once('error', (error) => { clearTimeout(readyTimer); readyReject(error); handleWorkerExit(child, error); });
    child.once('close', (code) => {
      clearTimeout(readyTimer);
      const error = new ProviderError('Tiến trình Kokoro đã thoát.', 502, stderrTail || `exit ${code ?? 'unknown'}`);
      readyReject(error);
      handleWorkerExit(child, error);
    });
    try {
      await ready;
      clearTimeout(readyTimer);
      scheduleIdleStop();
      return child;
    } catch (error) {
      clearTimeout(readyTimer);
      handleWorkerExit(child, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  })().finally(() => { workerStartPromise = undefined; });
  return workerStartPromise;
}

export async function synthesizeWithKokoro(text: string, voice: string, language: string, speed = 1, signal?: AbortSignal) {
  if (signal?.aborted) throw new ProviderError('Đã hủy tạo giọng Kokoro.', 499);
  const child = await getWorker(signal);
  if (signal?.aborted) throw new ProviderError('Đã hủy tạo giọng Kokoro.', 499);
  const id = randomUUID();
  return new Promise<Buffer>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timeout = setTimeout(() => {
      pending.delete(id);
      const error = new ProviderError('Kokoro tạo giọng quá thời gian cho phép.', 504);
      reject(error);
      stopWorker(error);
    }, 5 * 60_000);
    const abort = () => stopWorker(new ProviderError('Đã hủy tạo giọng Kokoro.', 499));
    const onResponse = (response: KokoroResponse) => {
      if (!response.ok || !response.audioBase64) { reject(new ProviderError('Kokoro không tạo được audio.', 502, response.error)); return; }
      resolve(Buffer.from(response.audioBase64, 'base64'));
    };
    pending.set(id, { resolve: onResponse, reject, timer: timeout, cleanup });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    child.stdin.write(`${JSON.stringify({ id, text, voice, language, speed })}\n`, (error) => {
      if (!error) return;
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      clearTimeout(timeout);
      cleanup();
      reject(error);
    });
  });
}
