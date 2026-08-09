import { spawn } from 'node:child_process';
import path from 'node:path';
import { ProviderError } from '../adapters/errors';

type BridgeRequest = Record<string, unknown>;
type BridgeResponse = { ok?: boolean; error?: string; [key: string]: unknown };

const bridgeScript = path.join(process.cwd(), 'server', 'services', 'capcut_tts_bridge.py');

export function capCutBridgeEnvironment(source: NodeJS.ProcessEnv = process.env) {
  return { ...source, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
}

function commands() {
  const configured = process.env.AUTOSUB_CAPCUT_PYTHON?.trim();
  if (configured) return [{ command: configured, args: [bridgeScript] }];
  return process.platform === 'win32'
    ? [{ command: 'py', args: ['-3', bridgeScript] }, { command: 'python', args: [bridgeScript] }]
    : [{ command: 'python3', args: [bridgeScript] }, { command: 'python', args: [bridgeScript] }];
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
  let lastError: unknown;
  for (const candidate of commands()) {
    try {
      const response = await runBridgeOnce(candidate.command, candidate.args, request, signal);
      if (response.ok === false) {
        const message = String(response.error || 'CapCut bridge thất bại.');
        if (/No module named ['"]capcut_tts_api['"]/.test(message)) {
          throw new ProviderError('CapCut TTS chưa được cài trên máy. Hãy chạy: py -3 -m pip install -r requirements-capcut-tts.txt', 503, message);
        }
        throw new ProviderError(message, 502);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !/ENOENT|spawn .*not found/i.test(error.message)) throw error;
    }
  }
  throw new ProviderError('Chưa cài Python hoặc không tìm thấy Python để chạy CapCut TTS. Hãy cài Python 3.9+ và requirements-capcut-tts.txt.', 503, lastError instanceof Error ? lastError.message : undefined);
}
