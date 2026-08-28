import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ProviderError } from '../adapters/errors';
import { workdir } from './ffmpeg';

type BridgeRequest = Record<string, unknown>;
type BridgeResponse = { ok?: boolean; error?: string; [key: string]: unknown };

const bridgeScript = path.join(process.cwd(), 'server', 'services', 'capcut_tts_bridge.py');
const requirementsFile = path.join(process.cwd(), 'requirements-capcut-tts.txt');
const runtimeRoot = path.join(workdir, 'capcut-tts', 'runtime');
const runtimePython = process.platform === 'win32'
  ? path.join(runtimeRoot, 'Scripts', 'python.exe')
  : path.join(runtimeRoot, 'bin', 'python');

export function capCutBridgeEnvironment(source: NodeJS.ProcessEnv = process.env) {
  return { ...source, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
}

function systemPythonCommands() {
  const configured = process.env.AUTOSUB_CAPCUT_PYTHON?.trim();
  if (configured) return [{ command: configured, args: [] }];
  return process.platform === 'win32'
    ? [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }]
    : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
}

function runProcess(command: string, args: string[], timeoutMs = 15 * 60_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: capCutBridgeEnvironment(), stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Cài CapCut TTS quá thời gian cho phép.')); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Lệnh cài CapCut TTS thoát với mã ${code ?? 'unknown'}.`)); });
  });
}

let runtimePromise: Promise<string> | undefined;

export function ensureCapCutTtsRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    if (process.env.AUTOSUB_CAPCUT_PYTHON?.trim()) {
      const command = process.env.AUTOSUB_CAPCUT_PYTHON.trim();
      await runProcess(command, ['-c', 'import capcut_tts_api']);
      return command;
    }
    if ((await stat(runtimePython).catch(() => undefined))?.isFile()) {
      try { await runProcess(runtimePython, ['-c', 'import capcut_tts_api']); return runtimePython; } catch { /* repair below */ }
    }
    let lastError: unknown;
    for (const candidate of systemPythonCommands()) {
      try {
        await runProcess(candidate.command, [...candidate.args, '-m', 'venv', runtimeRoot]);
        await runProcess(runtimePython, ['-m', 'pip', 'install', '-r', requirementsFile]);
        await runProcess(runtimePython, ['-c', 'import capcut_tts_api']);
        return runtimePython;
      } catch (error) { lastError = error; }
    }
    throw new ProviderError('Không thể tự cài CapCut TTS. Hãy kiểm tra Python 3 và kết nối mạng.', 503, lastError instanceof Error ? lastError.message : undefined);
  })().catch((error) => { runtimePromise = undefined; throw error; });
  return runtimePromise;
}

function runBridgeOnce(command: string, args: string[], request: BridgeRequest, signal?: AbortSignal): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: capCutBridgeEnvironment() });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => { child.kill(); fail(new Error('CapCut TTS đã bị hủy.')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const output = stdout.trim();
      let parsed: BridgeResponse | undefined;
      try { parsed = output ? JSON.parse(output) as BridgeResponse : undefined; } catch { /* handled below */ }
      if (parsed) { resolve(parsed); return; }
      fail(new Error(stderr.trim() || `CapCut bridge thoát với mã ${code ?? 'unknown'}.`));
    });
    child.stdin?.end(`${JSON.stringify(request)}\n`);
  });
}

export async function runCapCutBridge(request: BridgeRequest, signal?: AbortSignal): Promise<BridgeResponse> {
  const python = await ensureCapCutTtsRuntime();
  try {
      const response = await runBridgeOnce(python, [bridgeScript], request, signal);
      if (response.ok === false) {
        const message = String(response.error || 'CapCut bridge thất bại.');
        if (/No module named ['"]capcut_tts_api['"]/.test(message)) {
          throw new ProviderError('CapCut TTS chưa được cài trên máy. Hãy chạy: py -3 -m pip install -r requirements-capcut-tts.txt', 503, message);
        }
        throw new ProviderError(message, 502);
      }
      return response;
    } catch (error) {
      throw error;
  }
}
