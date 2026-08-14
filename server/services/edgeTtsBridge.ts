import { spawn } from 'node:child_process';
import path from 'node:path';
import { ProviderError } from '../adapters/errors';

type BridgeRequest = Record<string, unknown>;
export type EdgeBridgeResponse = { ok?: boolean; error?: string; voices?: Array<{ id: string; name?: string; language?: string }>; audioBase64?: string; ranges?: Array<{ startMs: number; endMs?: number | null }>; voiceCount?: number; [key: string]: unknown };

const bridgeScript = path.join(process.cwd(), 'server', 'services', 'edge_tts_bridge.py');

function commands() {
  const configured = process.env.AUTOSUB_EDGE_TTS_PYTHON?.trim();
  if (configured) return [{ command: configured, args: [bridgeScript] }];
  return process.platform === 'win32'
    ? [{ command: 'py', args: ['-3', bridgeScript] }, { command: 'python', args: [bridgeScript] }]
    : [{ command: 'python3', args: [bridgeScript] }, { command: 'python', args: [bridgeScript] }];
}

function runBridgeOnce(command: string, args: string[], request: BridgeRequest, signal?: AbortSignal): Promise<EdgeBridgeResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => { child.kill(); fail(new ProviderError('Đã hủy Edge TTS.', 499)); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 32 * 1024 * 1024) {
        child.kill();
        fail(new ProviderError('Edge TTS trả về batch audio quá lớn.', 502));
      }
    });
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-128 * 1024); });
    child.once('error', fail);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      let response: EdgeBridgeResponse | undefined;
      try { response = stdout.trim() ? JSON.parse(stdout.trim()) as EdgeBridgeResponse : undefined; } catch { /* handled below */ }
      if (response) { resolve(response); return; }
      reject(new Error(stderr.trim() || `Edge TTS bridge thoát với mã ${code ?? 'unknown'}.`));
    });
    child.stdin?.end(`${JSON.stringify(request)}\n`);
  });
}

export async function runEdgeTtsBridge(request: BridgeRequest, signal?: AbortSignal) {
  let lastError: unknown;
  for (const candidate of commands()) {
    try {
      const response = await runBridgeOnce(candidate.command, candidate.args, request, signal);
      if (response.ok === false) {
        const detail = String(response.error || 'Edge TTS thất bại.');
        if (/No module named ['"]edge_tts['"]/.test(detail)) throw new ProviderError('Edge TTS chưa được cài. Hãy chạy: py -3 -m pip install -r requirements-edge-tts.txt', 503, detail);
        throw new ProviderError('Edge TTS không tạo được giọng đọc. Dịch vụ online của Microsoft có thể đang tạm từ chối request.', 502, detail);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !/ENOENT|spawn .*not found/i.test(error.message)) throw error;
    }
  }
  throw new ProviderError('Không tìm thấy Python để chạy Edge TTS.', 503, lastError instanceof Error ? lastError.message : undefined);
}
