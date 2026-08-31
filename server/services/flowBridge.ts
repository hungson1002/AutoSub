import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

type FlowBridgeControl = { tag: string; text: string; ariaLabel: string; placeholder: string };
type FlowBridgeHeartbeat = { url?: string; title?: string; controls?: FlowBridgeControl[] };
let lastHeartbeat: { receivedAt: number; url: string; title: string; controls: FlowBridgeControl[] } | undefined;
type BridgeCommand = { id: string; prompt: string; outputFile: string; referenceImagePaths?: string[]; recoverLatest?: boolean; delivered: boolean; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
let command: BridgeCommand | undefined;

export function updateFlowBridge(value: FlowBridgeHeartbeat) {
  lastHeartbeat = {
    receivedAt: Date.now(),
    url: String(value.url || '').slice(0, 2000),
    title: String(value.title || '').slice(0, 300),
    controls: Array.isArray(value.controls) ? value.controls.slice(0, 120) : [],
  };
  const next = command && !command.delivered ? { id: command.id, prompt: command.prompt, referenceImagePaths: command.referenceImagePaths, recoverLatest: command.recoverLatest } : undefined;
  if (next && command) command.delivered = true;
  return { ...flowBridgeStatus(), command: next };
}

export function flowBridgeStatus() {
  // Chromium throttles timers in background tabs, sometimes to roughly one tick per minute.
  const connected = Boolean(lastHeartbeat && Date.now() - lastHeartbeat.receivedAt < 90_000);
  return { connected, url: connected ? lastHeartbeat?.url || '' : '', title: connected ? lastHeartbeat?.title || '' : '' };
}

export function inspectFlowBridge() {
  return { ...flowBridgeStatus(), controls: lastHeartbeat?.controls || [] };
}

export function generateViaFlowBridge(prompt: string, outputFile: string, signal?: AbortSignal, recoverLatest = false, referenceImagePaths?: string[]) {
  if (!flowBridgeStatus().connected) return Promise.reject(new Error('Tab Google Flow chưa kết nối AutoSub Flow Bridge.'));
  if (command) return Promise.reject(new Error('Google Flow đang xử lý một cảnh khác.'));
  return new Promise<void>((resolve, reject) => {
    const id = randomUUID();
    const finish = (error?: Error) => {
      if (!command || command.id !== id) return;
      clearTimeout(command.timer);
      command = undefined;
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('Google Flow quá thời gian tạo video qua trình duyệt.')), 20 * 60_000);
    command = { id, prompt, outputFile, referenceImagePaths, recoverLatest, delivered: false, resolve: () => finish(), reject: (error) => finish(error), timer };
    signal?.addEventListener('abort', () => finish(new DOMException('Đã dừng tác vụ.', 'AbortError')), { once: true });
  });
}

export const recoverLatestViaFlowBridge = (outputFile: string, signal?: AbortSignal) => generateViaFlowBridge('', outputFile, signal, true);

export async function completeFlowBridgeVideo(id: string, data: Buffer) {
  if (!command || command.id !== id) throw new Error('Lệnh Flow không còn hiệu lực.');
  if (data.length < 10_000) throw new Error('Flow trả về file video không hợp lệ.');
  await writeFile(command.outputFile, data);
  command.resolve();
  return { ok: true };
}

export function failFlowBridgeCommand(id: string, message: string) {
  if (!command || command.id !== id) return { ok: false };
  command.reject(new Error(String(message || 'Google Flow không thể tạo video.').slice(0, 500)));
  return { ok: true };
}
