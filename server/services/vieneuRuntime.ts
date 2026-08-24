import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rm, stat } from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import path from 'node:path';
import { ProviderError } from '../adapters/errors';
import { run, temporaryRoot, workdir } from './ffmpeg';

const VIENEU_VERSION = '3.3.0';
const SEA_G2P_VERSION = '0.9.0';
const RUNTIME_ROOT = path.join(workdir, 'vieneu', 'runtime');
const TEMP_ROOT = path.join(temporaryRoot, 'vieneu');
const BRIDGE_SCRIPT = path.join(process.cwd(), 'server', 'services', 'vieneu_bridge.py');
const IDLE_TIMEOUT_MS = 45_000;

const pythonExecutable = () => process.platform === 'win32'
  ? path.join(RUNTIME_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(RUNTIME_ROOT, '.venv', 'bin', 'python');

type BridgeResponse = { requestId?: string; ok?: boolean; error?: string; bytes?: number; sampleRate?: number; [key: string]: unknown };
type PendingRequest = { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void; cleanup: () => void };
export type VieneuInternalSilence = { startMs: number; endMs: number; durationMs: number };

const VIENEU_HESITATION_MIN_MS = 160;
const VIENEU_NATURAL_PAUSE_MS = 95;
const VIENEU_EDGE_GUARD_MS = 80;
// Lower sampling keeps short subtitle cues from developing unstable tails or
// repeated phonemes. A second, colder pass is used when the first pass has a
// measurable hesitation problem.
const VIENEU_PRIMARY_TEMPERATURE = 0.42;
const VIENEU_RETRY_TEMPERATURE = 0.35;

export function parseVieneuInternalSilences(stderr: string, durationMs: number, edgeGuardMs = VIENEU_EDGE_GUARD_MS): VieneuInternalSilence[] {
  const pauses: VieneuInternalSilence[] = [];
  let startMs: number | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    if (start) {
      startMs = Number(start[1]) * 1000;
      continue;
    }
    const end = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (!end) continue;
    const endMs = Number(end[1]) * 1000;
    const measuredDurationMs = Number(end[2]) * 1000;
    const resolvedStartMs = startMs ?? endMs - measuredDurationMs;
    startMs = undefined;
    if (![resolvedStartMs, endMs, measuredDurationMs].every(Number.isFinite)) continue;
    if (resolvedStartMs <= edgeGuardMs || endMs >= durationMs - edgeGuardMs) continue;
    pauses.push({ startMs: Math.round(resolvedStartMs), endMs: Math.round(endMs), durationMs: Math.round(measuredDurationMs) });
  }
  return pauses;
}

export function vieneuHesitationScore(pauses: VieneuInternalSilence[]) {
  return pauses.reduce((score, pause) => score + Math.max(0, pause.durationMs - VIENEU_HESITATION_MIN_MS), 0);
}

export function buildVieneuPauseRepairFilter(pauses: VieneuInternalSilence[], durationMs: number, keepPauseMs = VIENEU_NATURAL_PAUSE_MS) {
  const cuts = [...pauses]
    .filter((pause) => pause.durationMs > VIENEU_HESITATION_MIN_MS)
    .sort((left, right) => left.startMs - right.startMs)
    .map((pause) => ({
      startMs: pause.startMs + keepPauseMs / 2,
      endMs: pause.endMs - keepPauseMs / 2,
    }))
    .filter((cut) => cut.endMs - cut.startMs >= 5);
  if (!cuts.length) return 'anull';
  const segments: Array<{ startMs: number; endMs: number }> = [];
  let cursorMs = 0;
  for (const cut of cuts) {
    const startMs = Math.max(cursorMs, Math.min(durationMs, cut.startMs));
    if (startMs > cursorMs) segments.push({ startMs: cursorMs, endMs: startMs });
    cursorMs = Math.max(cursorMs, Math.min(durationMs, cut.endMs));
  }
  if (cursorMs < durationMs) segments.push({ startMs: cursorMs, endMs: durationMs });
  if (segments.length < 2) return 'anull';
  const filters = segments.map((segment, index) => `[0:a]atrim=start=${(segment.startMs / 1000).toFixed(6)}:end=${(segment.endMs / 1000).toFixed(6)},asetpts=PTS-STARTPTS[s${index}]`);
  filters.push(`${segments.map((_segment, index) => `[s${index}]`).join('')}concat=n=${segments.length}:v=0:a=1[out]`);
  return filters.join(';');
}

export function usesShortUtteranceQualityPass(text: string) {
  const sentenceBreaks = text.match(/[.!?…]+/g)?.length || 0;
  return text.length <= 220 && sentenceBreaks <= 1;
}

function terminateProcess(child: { pid?: number; kill: () => boolean }) {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.unref();
    return;
  }
  child.kill();
}

function runProcess(command: string, args: string[], signal?: AbortSignal, timeoutMs = 15 * 60_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => { terminateProcess(child); fail(new ProviderError('Cài VieNeu Local quá thời gian cho phép.', 504)); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => { terminateProcess(child); fail(new ProviderError('Đã hủy cài VieNeu Local.', 499)); };
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
      else reject(new ProviderError('Không thể cài runtime VieNeu Local.', 503, stderr || stdout || `exit ${code}`));
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
  throw new ProviderError('VieNeu Local cần uv để tự cài runtime. Hãy cài uv bằng “winget install astral-sh.uv” rồi thử lại.', 503);
}

async function runtimeIsReady(executable: string, requiredVersion?: string) {
  if (!(await stat(executable).catch(() => undefined))?.isFile()) return false;
  try {
    const versionCheck = requiredVersion
      ? `import importlib.metadata as metadata; assert metadata.version("vieneu") == ${JSON.stringify(requiredVersion)}; `
      : '';
    await runProcess(executable, ['-c', `${versionCheck}import vieneu, kaldi_native_fbank, onnxruntime; print("ready")`], undefined, 90_000);
    return true;
  } catch {
    return false;
  }
}

let runtimePromise: Promise<string> | undefined;

export async function ensureVieneuRuntime(signal?: AbortSignal) {
  const explicit = process.env.AUTOSUB_VIENEU_PYTHON?.trim();
  if (explicit) {
    const executable = path.resolve(explicit);
    if (!await runtimeIsReady(executable)) throw new ProviderError('AUTOSUB_VIENEU_PYTHON chưa có đủ VieNeu ONNX và kaldi-native-fbank.', 503);
    return executable;
  }
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    await mkdir(RUNTIME_ROOT, { recursive: true });
    const executable = pythonExecutable();
    if (await runtimeIsReady(executable, VIENEU_VERSION)) return executable;
    const uv = await findUv();
    if (!(await stat(executable).catch(() => undefined))?.isFile()) await runProcess(uv, ['venv', '--python', '3.12', path.join(RUNTIME_ROOT, '.venv')], signal);
    await runProcess(uv, ['pip', 'install', '--python', executable, '--no-deps', `vieneu==${VIENEU_VERSION}`], signal);
    await runProcess(uv, ['pip', 'install', '--python', executable, `sea-g2p==${SEA_G2P_VERSION}`, 'onnxruntime>=1.20.0', 'numpy', 'soundfile', 'soxr', 'tokenizers>=0.20', 'huggingface_hub', 'PyYAML', 'perth>=0.2.0', 'kaldi-native-fbank==1.22.3'], signal);
    if (!await runtimeIsReady(executable, VIENEU_VERSION)) throw new ProviderError('VieNeu Local đã cài nhưng Python không import được runtime.', 503);
    return executable;
  })().catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

interface BridgeSlot {
  worker?: ChildProcessWithoutNullStreams;
  startPromise?: Promise<ChildProcessWithoutNullStreams>;
  stdoutBuffer: string;
  stderrTail: string;
  idleTimer?: NodeJS.Timeout;
  load: number;
  pending: Map<string, PendingRequest>;
}

const vieneuThreads = () => Math.max(1, Math.min(4, Number(process.env.AUTOSUB_VIENEU_THREADS) || 2));
const vieneuWorkerCount = () => Math.max(1, Math.min(4, Number(process.env.AUTOSUB_VIENEU_WORKERS) || 3));
const bridgeSlots: BridgeSlot[] = Array.from(
  { length: vieneuWorkerCount() },
  () => ({ stdoutBuffer: '', stderrTail: '', load: 0, pending: new Map() }),
);

function clearIdleTimer(slot: BridgeSlot) {
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = undefined;
}

function stopWorker(slot: BridgeSlot, reason?: Error) {
  clearIdleTimer(slot);
  const current = slot.worker;
  slot.worker = undefined;
  slot.startPromise = undefined;
  slot.stdoutBuffer = '';
  if (current) terminateProcess(current);
  if (reason) {
    for (const item of slot.pending.values()) { item.cleanup(); item.reject(reason); }
    slot.pending.clear();
  }
  slot.load = 0;
}

function scheduleIdleStop(slot: BridgeSlot) {
  clearIdleTimer(slot);
  if (slot.pending.size || slot.load) return;
  slot.idleTimer = setTimeout(() => stopWorker(slot), IDLE_TIMEOUT_MS);
  slot.idleTimer.unref();
}

async function getWorker(slot: BridgeSlot, signal?: AbortSignal) {
  if (slot.worker && !slot.worker.killed) return slot.worker;
  if (slot.startPromise) return slot.startPromise;
  slot.startPromise = (async () => {
    const executable = await ensureVieneuRuntime(signal);
    const child = spawn(executable, [BRIDGE_SCRIPT], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        AUTOSUB_VIENEU_THREADS: String(vieneuThreads()),
      },
    });
    if (child.pid && process.env.AUTOSUB_BACKGROUND_PRIORITY === '1') {
      try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Windows may deny priority changes. */ }
    }
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
        const item = slot.pending.get(requestId);
        if (!item) continue;
        slot.pending.delete(requestId);
        slot.load = Math.max(0, slot.load - 1);
        item.cleanup();
        if (response.ok === false) item.reject(new ProviderError('VieNeu Local không tạo được giọng đọc.', 502, String(response.error || 'Unknown bridge error')));
        else item.resolve(response);
        scheduleIdleStop(slot);
      }
    });
    child.stderr.on('data', (chunk) => { slot.stderrTail = (slot.stderrTail + chunk.toString()).slice(-256 * 1024); });
    child.once('error', (error) => stopWorker(slot, error));
    child.once('close', (code) => {
      if (slot.worker !== child) return;
      stopWorker(slot, new ProviderError('VieNeu Local đã dừng ngoài dự kiến.', 502, slot.stderrTail || `exit ${code ?? 'unknown'}`));
    });
    return child;
  })().catch((error) => {
    slot.startPromise = undefined;
    throw error;
  });
  return slot.startPromise;
}

async function sendBridge(request: Record<string, unknown>, signal?: AbortSignal) {
  const slot = bridgeSlots.reduce((best, candidate) => candidate.load < best.load ? candidate : best);
  clearIdleTimer(slot);
  slot.load += 1;
  let child: ChildProcessWithoutNullStreams;
  try {
    child = await getWorker(slot, signal);
  } catch (error) {
    slot.load = Math.max(0, slot.load - 1);
    throw error;
  }
  return new Promise<BridgeResponse>((resolve, reject) => {
    const requestId = randomUUID();
    const abort = () => stopWorker(slot, new ProviderError('Đã hủy VieNeu Local.', 499));
    const cleanup = () => signal?.removeEventListener('abort', abort);
    if (signal?.aborted) { slot.load = Math.max(0, slot.load - 1); abort(); reject(new ProviderError('Đã hủy VieNeu Local.', 499)); return; }
    signal?.addEventListener('abort', abort, { once: true });
    slot.pending.set(requestId, { resolve, reject, cleanup });
    child.stdin.write(`${JSON.stringify({ ...request, requestId })}\n`, (error) => {
      if (!error) return;
      const item = slot.pending.get(requestId);
      if (!item) return;
      slot.pending.delete(requestId);
      slot.load = Math.max(0, slot.load - 1);
      item.cleanup();
      item.reject(error);
      scheduleIdleStop(slot);
    });
  });
}

export async function vieneuRuntimeStatus(signal?: AbortSignal) {
  const executable = await ensureVieneuRuntime(signal);
  return { executable, threads: vieneuThreads(), workers: vieneuWorkerCount() };
}

async function vieneuAudioQuality(file: string, signal?: AbortSignal) {
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], signal);
  const durationMs = Math.max(1, Number(probe.stdout.trim()) * 1000);
  const detection = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=-42dB:d=${(VIENEU_HESITATION_MIN_MS / 1000).toFixed(3)}`, '-f', 'null', '-'], signal);
  const pauses = parseVieneuInternalSilences(detection.stderr, durationMs);
  return { durationMs, pauses, score: vieneuHesitationScore(pauses) };
}

export type VieneuVoiceInput = { referencePath?: string; presetName?: string };

export async function synthesizeWithVieneu(text: string, voice: VieneuVoiceInput | string, speed = 1, signal?: AbortSignal) {
  const content = text.trim();
  const voiceInput: VieneuVoiceInput = typeof voice === 'string' ? { referencePath: voice } : voice;
  if (!voiceInput.referencePath && !voiceInput.presetName) throw new ProviderError('VieNeu TTS requires a preset voice or reference file.', 400);
  if (!content) throw new ProviderError('Nội dung VieNeu TTS đang trống.', 400);
  if (content.length > 8_000) throw new ProviderError('Mỗi lượt VieNeu TTS tối đa 8.000 ký tự.', 400);
  await mkdir(TEMP_ROOT, { recursive: true });
  const id = randomUUID();
  const rawOutput = path.join(TEMP_ROOT, `${id}.raw.wav`);
  const retryOutput = path.join(TEMP_ROOT, `${id}.retry.wav`);
  const repairedOutput = path.join(TEMP_ROOT, `${id}.repaired.wav`);
  const finalOutput = path.join(TEMP_ROOT, `${id}.wav`);
  try {
    await sendBridge({ op: 'synthesize', text: content, ...voiceInput, outputPath: rawOutput, temperature: VIENEU_PRIMARY_TEMPERATURE }, signal);
    let selectedOutput = rawOutput;
    let selectedQuality = usesShortUtteranceQualityPass(content) ? await vieneuAudioQuality(rawOutput, signal) : undefined;
    if (selectedQuality?.score) {
      await sendBridge({ op: 'synthesize', text: content, ...voiceInput, outputPath: retryOutput, temperature: VIENEU_RETRY_TEMPERATURE }, signal);
      const retryQuality = await vieneuAudioQuality(retryOutput, signal);
      if (retryQuality.score < selectedQuality.score) {
        selectedOutput = retryOutput;
        selectedQuality = retryQuality;
      }
    }
    if (selectedQuality?.score) {
      const repairFilter = buildVieneuPauseRepairFilter(selectedQuality.pauses, selectedQuality.durationMs);
      if (repairFilter !== 'anull') {
        await run('ffmpeg', ['-y', '-v', 'error', '-i', selectedOutput, '-filter_complex', repairFilter, '-map', '[out]', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', repairedOutput], signal);
        selectedOutput = repairedOutput;
      }
    }
    const normalizedSpeed = Math.max(0.75, Math.min(1.5, Number(speed) || 1));
    const speedChanged = Math.abs(normalizedSpeed - 1) > 0.001;
    if (speedChanged) {
      await run('ffmpeg', ['-y', '-v', 'error', '-i', selectedOutput, '-filter:a', `atempo=${normalizedSpeed.toFixed(3)}`, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', finalOutput], signal);
    }
    return await readFile(speedChanged ? finalOutput : selectedOutput);
  } finally {
    await Promise.all([rm(rawOutput, { force: true }), rm(retryOutput, { force: true }), rm(repairedOutput, { force: true }), rm(finalOutput, { force: true })]);
  }
}

process.once('exit', () => bridgeSlots.forEach((slot) => stopWorker(slot)));
