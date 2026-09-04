import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export const FLOW_VIDEO_MODELS = ['Flow Agent Auto'] as const;
export type FlowVideoModel = typeof FLOW_VIDEO_MODELS[number];
export type FlowVideoAspectRatio = '9:16' | '16:9';
export type FlowVideoReferences = {
  startImagePath?: string;
  referenceImagePaths?: string[];
};

type FlowAgentHealth = { status?: string; extension_connected?: boolean; has_flow_key?: boolean; transport?: string };
type FlowAgentMedia = { url?: string; media_id?: string; resolution?: string };
type FlowAgentVideoResult = { job_id: string; status: 'processing' | 'succeeded' | 'failed'; data?: FlowAgentMedia[]; note?: string; error?: { status_code?: number; detail?: string } };

const baseUrl = () => String(process.env.FLOW_AGENT_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const headers = (json = false) => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(process.env.FLOW_AGENT_API_KEY?.trim() ? { Authorization: `Bearer ${process.env.FLOW_AGENT_API_KEY.trim()}` } : {}),
});

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const detail = String(body?.detail || body?.error?.detail || body?.error?.message || text || response.statusText).slice(0, 500);
    if (response.status === 402) throw new Error(`Flow Agent không đủ credit: ${detail}`);
    if (response.status === 401 || response.status === 403) throw new Error(`Flow Agent từ chối xác thực (HTTP ${response.status}): ${detail}`);
    if (response.status === 429) throw new Error(`Flow Agent đang giới hạn request hoặc không đủ credit: ${detail}`);
    throw new Error(`Flow Agent HTTP ${response.status}: ${detail}`);
  }
  return body as T;
}

export async function flowAgentStatus(signal?: AbortSignal) {
  try {
    const response = await fetch(`${baseUrl()}/health`, { signal, headers: headers() });
    const health = await parseResponse<FlowAgentHealth>(response);
    const extensionConnected = Boolean(health.extension_connected);
    const hasFlowKey = Boolean(health.has_flow_key);
    return { installed: true, connected: health.status === 'healthy' && extensionConnected && hasFlowKey, extensionConnected, hasFlowKey, status: health.status || 'unknown', transport: health.transport || 'none', url: baseUrl() };
  } catch (error) {
    return { installed: false, connected: false, extensionConnected: false, hasFlowKey: false, status: 'offline', transport: 'none', url: baseUrl(), error: error instanceof Error ? error.message : String(error) };
  }
}

export async function validateGoogleFlowSession(_credentials?: unknown, signal?: AbortSignal) {
  const status = await flowAgentStatus(signal);
  if (!status.installed) throw new Error(`Flow Agent chưa chạy tại ${status.url}. Hãy cài Flow Agent và chạy lệnh “flow”.`);
  if (!status.extensionConnected) throw new Error('Extension Flow Agent chưa kết nối. Hãy mở Google Flow trong Opera GX và giữ tab đăng nhập hoạt động.');
  if (!status.hasFlowKey) throw new Error('Flow Agent chưa lấy được Flow key. Hãy tải lại tab Google Flow sau khi bật extension.');
  if (!status.connected) throw new Error(`Flow Agent chưa sẵn sàng (${status.status}).`);
  return { ok: true as const };
}

export async function generateGoogleFlowImage(prompt: string, outputFile: string, options: { model?: string; size?: string; referenceImagePath?: string; signal?: AbortSignal } = {}) {
  await validateGoogleFlowSession(undefined, options.signal);
  const reference = options.referenceImagePath ? await readFile(options.referenceImagePath) : undefined;
  const extension = options.referenceImagePath?.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
  const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';
  const idempotencyKey = `autosub-image-${createHash('sha256').update(`${outputFile}\n${prompt}\n${randomUUID()}`).digest('hex').slice(0, 32)}`;
  const response = await fetch(`${baseUrl()}/v1/images/generations`, {
    method: 'POST',
    signal: options.signal,
    headers: { ...headers(true), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      prompt,
      model: options.model || 'narwhal',
      n: 1,
      size: options.size || '1024x1024',
      response_format: 'b64_json',
      ...(reference ? { image_base64: `data:${mime};base64,${reference.toString('base64')}` } : {}),
    }),
  });
  const result = await parseResponse<{ data?: Array<{ b64_json?: string }> }>(response);
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new Error('Flow Agent hoàn tất nhưng không trả về dữ liệu ảnh.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 100) throw new Error('Flow Agent trả về file ảnh không hợp lệ.');
  await writeFile(outputFile, bytes);
  return { model: options.model || 'narwhal', bytes: bytes.length };
}

async function uploadReference(filePath: string, signal?: AbortSignal) {
  const bytes = await readFile(filePath);
  const response = await fetch(`${baseUrl()}/v1/upload`, { method: 'POST', signal, headers: headers(true), body: JSON.stringify({ image_base64: bytes.toString('base64') }) });
  const uploaded = await parseResponse<{ media_id?: string }>(response);
  if (!uploaded.media_id) throw new Error('Flow Agent không trả về media_id cho ảnh tham chiếu.');
  return uploaded.media_id;
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Đã dừng tác vụ.', 'AbortError')); }, { once: true });
});

export async function generateGoogleFlowVideo(prompt: string, outputFile: string, model: FlowVideoModel = 'Flow Agent Auto', _credentials?: unknown, references: FlowVideoReferences = {}, aspectRatio: FlowVideoAspectRatio = '9:16', signal?: AbortSignal, _browserRequired = false) {
  const startImagePath = references.startImagePath?.trim();
  const referenceImagePaths = (references.referenceImagePaths || []).filter(Boolean);
  if (startImagePath && referenceImagePaths.length) {
    throw new Error('Flow Agent không hỗ trợ đồng thời khung bắt đầu và ảnh reference trong cùng một lượt tạo.');
  }
  await validateGoogleFlowSession(undefined, signal);
  const startMediaId = startImagePath ? await uploadReference(startImagePath, signal) : undefined;
  const referenceMediaIds: string[] = [];
  for (const reference of referenceImagePaths) referenceMediaIds.push(await uploadReference(reference, signal));
  const requestedDuration = Number(/Duration:\s*(\d+(?:\.\d+)?)\s*seconds/i.exec(prompt)?.[1] || 8);
  const duration = requestedDuration <= 4 ? 4 : requestedDuration <= 6 ? 6 : 8;
  // A key belongs to one user-initiated attempt. Reusing a deterministic key
  // here would permanently replay a stored failure when the user resumes.
  const idempotencyKey = `autosub-${createHash('sha256').update(`${outputFile}\n${prompt}\n${randomUUID()}`).digest('hex').slice(0, 32)}`;
  const response = await fetch(`${baseUrl()}/v1/videos/generations`, {
    method: 'POST', signal, headers: { ...headers(true), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ prompt, aspect: aspectRatio === '16:9' ? 'landscape' : 'portrait', duration, n: 1, ...(startMediaId ? { start_media_id: startMediaId } : {}), ...(referenceMediaIds.length ? { ref_media_ids: referenceMediaIds } : {}) }),
  });
  let result = await parseResponse<FlowAgentVideoResult>(response);
  for (let attempt = 0; result.status === 'processing' && attempt < 180; attempt += 1) {
    await wait(3_000, signal);
    const polled = await fetch(`${baseUrl()}/v1/videos/generations/${encodeURIComponent(result.job_id)}`, { signal, headers: headers() });
    result = await parseResponse<FlowAgentVideoResult>(polled);
  }
  if (result.status === 'failed') throw new Error(`Flow Agent tạo video thất bại: ${result.error?.detail || 'không có chi tiết'}`);
  if (result.status !== 'succeeded') throw new Error('Flow Agent quá thời gian tạo video.');
  const media = result.data?.[0];
  if (!media?.url) throw new Error('Flow Agent hoàn tất nhưng không trả về URL video.');
  const downloaded = await fetch(new URL(media.url, `${baseUrl()}/`), { signal, headers: headers() });
  if (!downloaded.ok) throw new Error(`Không tải được video từ Flow Agent (HTTP ${downloaded.status}).`);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  if (bytes.length < 10_000 || !bytes.subarray(0, 64).includes(Buffer.from('ftyp'))) throw new Error('Flow Agent trả về file không phải video MP4 hợp lệ.');
  await writeFile(outputFile, bytes);
  return { model, taskId: result.job_id, mediaId: media.media_id, note: result.note };
}

export const generateGoogleFlowPreview = (prompt: string, outputFile: string) => generateGoogleFlowVideo(prompt, outputFile);
