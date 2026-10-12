import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { ProviderError } from '../adapters/errors';
import { run, temporaryRoot, workdir } from './ffmpeg';

const ZEROTTS_VERSION = '0.1.5';
const RUNTIME_ROOT = path.join(workdir, 'zerotts', 'runtime');
const TEMP_ROOT = path.join(temporaryRoot, 'zerotts');
const BRIDGE_SCRIPT = path.join(process.cwd(), 'server', 'services', 'zerotts_bridge.py');
const IDLE_TIMEOUT_MS = Math.max(60_000, Number(process.env.AUTOSUB_ZEROTTS_IDLE_TIMEOUT_MS) || 10 * 60_000);

const pythonExecutable = () => process.platform === 'win32'
  ? path.join(RUNTIME_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(RUNTIME_ROOT, '.venv', 'bin', 'python');

type BridgeResponse = { requestId?: string; ok?: boolean; error?: string; sampleRate?: number };
type PendingRequest = { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void; cleanup: () => void };

function terminateProcess(child: { pid?: number; kill: () => boolean }) {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.unref();
    return;
  }
  child.kill();
}

function runProcess(command: string, args: string[], signal?: AbortSignal, timeoutMs = 20 * 60_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => { terminateProcess(child); fail(new ProviderError('Đã hủy ZeroTTS Local.', 499)); };
    const timer = setTimeout(() => {
      terminateProcess(child);
      fail(new ProviderError('Cài ZeroTTS Local quá thời gian cho phép.', 504, stderr || stdout));
    }, timeoutMs);
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
      else reject(new ProviderError('Không thể cài/chạy ZeroTTS Local.', 503, stderr || stdout || `exit ${code}`));
    });
  });
}

async function findUv() {
  const configured = process.env.AUTOSUB_UV_PATH?.trim();
  const candidates = [configured, 'uv'];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe', 'uv.exe'));
  }
  for (const candidate of candidates.filter((value): value is string => Boolean(value))) {
    try { await runProcess(candidate, ['--version'], undefined, 15_000); return candidate; }
    catch (error) { if (!(error instanceof Error) || !/ENOENT|not found|cannot find/i.test(error.message)) continue; }
  }
  throw new ProviderError('ZeroTTS Local cần uv để tự cài runtime.', 503);
}

async function runtimeIsReady(executable: string) {
  if (!(await stat(executable).catch(() => undefined))?.isFile()) return false;
  try {
    await runProcess(executable, [BRIDGE_SCRIPT, '--check'], undefined, 120_000);
    return true;
  } catch {
    return false;
  }
}

let runtimePromise: Promise<string> | undefined;

export async function ensureZeroTtsRuntime(signal?: AbortSignal) {
  const explicit = process.env.AUTOSUB_ZEROTTS_PYTHON?.trim();
  if (explicit) {
    const executable = path.resolve(explicit);
    if (!await runtimeIsReady(executable)) throw new ProviderError('AUTOSUB_ZEROTTS_PYTHON chưa có ZeroTTS runtime.', 503);
    return executable;
  }
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    await mkdir(RUNTIME_ROOT, { recursive: true });
    const executable = pythonExecutable();
    if (await runtimeIsReady(executable)) return executable;
    const uv = await findUv();
    if (!(await stat(executable).catch(() => undefined))?.isFile()) {
      await runProcess(uv, ['venv', '--python', '3.12', path.join(RUNTIME_ROOT, '.venv')], signal);
    }
    await runProcess(uv, [
      'pip', 'install', '--python', executable,
      '--index-url', 'https://pypi.org/simple',
      `zerotts==${ZEROTTS_VERSION}`,
    ], signal);
    if (!await runtimeIsReady(executable)) throw new ProviderError('ZeroTTS đã cài nhưng Python không import được runtime.', 503);
    return executable;
  })().catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

const slot: {
  worker?: ChildProcessWithoutNullStreams;
  startPromise?: Promise<ChildProcessWithoutNullStreams>;
  stdoutBuffer: string;
  stderrTail: string;
  pending: Map<string, PendingRequest>;
  idleTimer?: NodeJS.Timeout;
} = { stdoutBuffer: '', stderrTail: '', pending: new Map() };

let warmed = false;
let warmupPromise: Promise<void> | undefined;

function clearIdleTimer() {
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = undefined;
}

function stopWorker(reason?: Error) {
  clearIdleTimer();
  const worker = slot.worker;
  slot.worker = undefined;
  slot.startPromise = undefined;
  slot.stdoutBuffer = '';
  if (worker) terminateProcess(worker);
  if (reason) {
    for (const item of slot.pending.values()) { item.cleanup(); item.reject(reason); }
    slot.pending.clear();
  }
  warmed = false;
}

function scheduleIdleStop() {
  clearIdleTimer();
  if (slot.pending.size) return;
  slot.idleTimer = setTimeout(() => stopWorker(), IDLE_TIMEOUT_MS);
  slot.idleTimer.unref();
}

async function getWorker(signal?: AbortSignal) {
  if (slot.worker && !slot.worker.killed) return slot.worker;
  if (slot.startPromise) return slot.startPromise;
  slot.startPromise = (async () => {
    const executable = await ensureZeroTtsRuntime(signal);
    const threads = Math.max(1, Math.min(12, Number(process.env.AUTOSUB_ZEROTTS_THREADS) || 8));
    const child = spawn(executable, [BRIDGE_SCRIPT, '--worker'], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        AUTOSUB_ZEROTTS_THREADS: String(threads),
        OMP_NUM_THREADS: String(threads),
        OPENBLAS_NUM_THREADS: String(threads),
      },
    });
    slot.worker = child;
    slot.stderrTail = '';
    child.stdout.on('data', (chunk) => {
      slot.stdoutBuffer += chunk.toString();
      for (;;) {
        const newline = slot.stdoutBuffer.indexOf('\n');
        if (newline < 0) break;
        const line = slot.stdoutBuffer.slice(0, newline).trim();
        slot.stdoutBuffer = slot.stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        let response: BridgeResponse | undefined;
        try { response = JSON.parse(line) as BridgeResponse; } catch { continue; }
        const requestId = String(response.requestId || '');
        const pending = slot.pending.get(requestId);
        if (!pending) continue;
        slot.pending.delete(requestId);
        pending.cleanup();
        if (response.ok === false) pending.reject(new ProviderError('ZeroTTS Local không tạo được giọng đọc.', 502, String(response.error || 'Unknown bridge error')));
        else pending.resolve(response);
        scheduleIdleStop();
      }
    });
    child.stderr.on('data', (chunk) => { slot.stderrTail = (slot.stderrTail + chunk.toString()).slice(-256 * 1024); });
    child.once('error', (error) => stopWorker(error));
    child.once('close', (code) => {
      if (slot.worker !== child) return;
      stopWorker(new ProviderError('ZeroTTS Local đã dừng ngoài dự kiến.', 502, slot.stderrTail || `exit ${code ?? 'unknown'}`));
    });
    return child;
  })().catch((error) => { slot.startPromise = undefined; throw error; });
  return slot.startPromise;
}

async function sendBridge(request: Record<string, unknown>, signal?: AbortSignal) {
  clearIdleTimer();
  const child = await getWorker(signal);
  return new Promise<BridgeResponse>((resolve, reject) => {
    const requestId = randomUUID();
    const abort = () => stopWorker(new ProviderError('Đã hủy ZeroTTS Local.', 499));
    const cleanup = () => signal?.removeEventListener('abort', abort);
    if (signal?.aborted) { abort(); reject(new ProviderError('Đã hủy ZeroTTS Local.', 499)); return; }
    signal?.addEventListener('abort', abort, { once: true });
    slot.pending.set(requestId, { resolve, reject, cleanup });
    child.stdin.write(`${JSON.stringify({ ...request, requestId })}\n`, (error) => {
      if (!error) return;
      const item = slot.pending.get(requestId);
      if (!item) return;
      slot.pending.delete(requestId);
      item.cleanup();
      item.reject(error);
      scheduleIdleStop();
    });
  });
}

export async function warmZeroTtsRuntime(signal?: AbortSignal) {
  if (warmed) return;
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    await ensureZeroTtsRuntime(signal);
    await sendBridge({ op: 'warmup' }, signal);
    warmed = true;
  })().catch((error) => { warmed = false; throw error; }).finally(() => { warmupPromise = undefined; });
  return warmupPromise;
}

export async function zeroTtsRuntimeStatus(signal?: AbortSignal) {
  const executable = await ensureZeroTtsRuntime(signal);
  return {
    executable,
    warmed,
    threads: Math.max(1, Math.min(12, Number(process.env.AUTOSUB_ZEROTTS_THREADS) || 8)),
    device: 'cpu',
    version: ZEROTTS_VERSION,
  };
}

export async function synthesizeWithZeroTts(text: string, voice: string, speed = 1, signal?: AbortSignal) {
  const content = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!content) throw new ProviderError('Nội dung ZeroTTS đang trống.', 400);
  if (!voice) throw new ProviderError('ZeroTTS cần chọn voice.', 400);
  if (content.length > 2_000) throw new ProviderError('Mỗi lượt ZeroTTS tối đa 2.000 ký tự.', 400);
  await warmZeroTtsRuntime(signal);
  await mkdir(TEMP_ROOT, { recursive: true });
  const id = randomUUID();
  const rawOutput = path.join(TEMP_ROOT, `${id}.raw.wav`);
  const finalOutput = path.join(TEMP_ROOT, `${id}.wav`);
  try {
    await sendBridge({ op: 'synthesize', text: content, voice, outputPath: rawOutput }, signal);
    const normalizedSpeed = Math.max(0.75, Math.min(1.5, Number(speed) || 1));
    const filters = Math.abs(normalizedSpeed - 1) > 0.005 ? ['-af', `atempo=${normalizedSpeed.toFixed(4)}`] : [];
    await run('ffmpeg', [
      '-y', '-v', 'error', '-i', rawOutput,
      ...filters,
      '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', finalOutput,
    ], signal);
    return await readFile(finalOutput);
  } finally {
    await rm(rawOutput, { force: true }).catch(() => undefined);
    await rm(finalOutput, { force: true }).catch(() => undefined);
  }
}
