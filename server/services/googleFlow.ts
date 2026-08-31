import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { flowBridgeStatus, generateViaFlowBridge } from './flowBridge';

const generateUrl = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
const checkUrl = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus';
const creditsUrl = 'https://aisandbox-pa.googleapis.com/v1/credits';
export const FLOW_VIDEO_MODELS = ['Omni Flash', 'Veo 3.1 - Fast', 'Veo 3.1 - Lite', 'Veo 3.1 - Quality', 'Veo 3.1 - Lite [Lower Priority]'] as const;
export type FlowVideoModel = typeof FLOW_VIDEO_MODELS[number];
type FlowCredentials = { nanoApiKey?: string; veoToken?: string; veoCookie?: string };
export type FlowVideoAspectRatio = '9:16' | '16:9';
const directModelKeys: Partial<Record<FlowVideoModel, string>> = { 'Veo 3.1 - Lite [Lower Priority]': 'veo_3_1_t2v_lite_4s_low_priority' };

function walk(value: unknown, visit: (node: Record<string, unknown>) => void) { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach((item) => walk(item, visit)); return; } const node = value as Record<string, unknown>; visit(node); Object.values(node).forEach((item) => walk(item, visit)); }
function mediaEntries(value: unknown, fallbackProjectId: string) { const entries: Array<{ name: string; projectId: string; status: string; url?: string }> = []; walk(value, (node) => { const status = String(node.mediaGenerationStatus || ''); const name = String(node.name || node.mediaId || node.mediaGenerationId || node.sceneId || ''); if (!status || !name) return; const url = [node.mediaUrl, node.videoUrl, node.downloadUri, node.uri].find((item) => typeof item === 'string' && /^https?:\/\//i.test(item)) as string | undefined; entries.push({ name, projectId: String(node.projectId || fallbackProjectId), status: status.replace(/^MEDIA_GENERATION_STATUS_/i, '').toUpperCase(), url }); }); return entries; }
function findDownloadUrl(value: unknown) { let result = ''; walk(value, (node) => { if (result) return; const candidate = [node.mediaUrl, node.videoUrl, node.downloadUri, node.signedUri, node.uri].find((item) => typeof item === 'string' && /^https?:\/\//i.test(item)); if (candidate) result = String(candidate); }); return result; }
const flowUrl = (url: string, apiKey: string) => `${url}?key=${encodeURIComponent(apiKey)}`;
const cleanToken = (value: string) => value.trim().replace(/^Bearer\s+/i, '');
export function normalizeFlowApiKey(value: string | undefined) {
  const input = String(value || '').trim();
  const fromUrl = /[?&]key=([A-Za-z0-9_-]+)/.exec(input)?.[1];
  return (fromUrl || input).replace(/^['"]|['"]$/g, '').replace(/\s+/g, '');
}
function flowHttpError(status: number, value: any) {
  const detail = String(value?.error?.message || value?.message || '').slice(0, 300);
  if (status === 401 || status === 403) return new Error(`Google Flow session expired or unauthorized (HTTP ${status})${detail ? `: ${detail}` : '.'}`);
  if (status === 429) return new Error(`Google Flow rate limit or insufficient credits (HTTP 429)${detail ? `: ${detail}` : '.'}`);
  return new Error(`Google Flow Direct HTTP ${status}${detail ? `: ${detail}` : '.'}`);
}
async function parseGoogleResponse(response: Response) { const text = await response.text(); let value: any; try { value = text ? JSON.parse(text) : {}; } catch { value = {}; } if (!response.ok) throw flowHttpError(response.status, value); return value; }
async function googleRequest(url: string, apiKey: string, token: string, cookie: string, body: unknown, signal?: AbortSignal) { const response = await fetch(flowUrl(url, apiKey), { method: 'POST', signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }); return parseGoogleResponse(response); }
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Đã dừng tác vụ.', 'AbortError')); }, { once: true }); });

async function waitForBrowserBridge(signal?: AbortSignal, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!flowBridgeStatus().connected && Date.now() < deadline) await delay(500, signal);
  return flowBridgeStatus().connected;
}

export async function generateGoogleFlowVideo(prompt: string, outputFile: string, model: FlowVideoModel = 'Veo 3.1 - Lite [Lower Priority]', credentials?: FlowCredentials, referenceImagePath?: string | string[], aspectRatio: FlowVideoAspectRatio = '9:16', signal?: AbortSignal, browserRequired = false) {
  if (browserRequired && !await waitForBrowserBridge(signal)) throw new Error('Mất kết nối AutoSub Flow Bridge. Hãy giữ tab Google Flow và tiện ích đang hoạt động rồi bấm tiếp tục; AutoSub không chuyển sang access token để tránh lỗi 401.');
  if (flowBridgeStatus().connected) { const referenceImagePaths = Array.isArray(referenceImagePath) ? referenceImagePath : referenceImagePath ? [referenceImagePath] : undefined; await generateViaFlowBridge(prompt, outputFile, signal, false, referenceImagePaths); return { model, taskId: `browser-${Date.now()}` }; }
  const apiKey = normalizeFlowApiKey(credentials?.nanoApiKey || process.env.GOOGLE_FLOW_API_KEY); const token = cleanToken(credentials?.veoToken || process.env.VEO_TOKEN || ''); const cookie = credentials?.veoCookie?.trim() || process.env.VEO_COOKIE?.trim() || '';
  if (!apiKey) throw new Error('Missing Flow client API key from the key= parameter of the Flow credits request.');
  if (!token) throw new Error('Thiếu Google Flow accessToken.'); const videoModelKey = directModelKeys[model]; if (!videoModelKey) throw new Error(`${model} chưa có model key Flow Direct được xác minh. Hãy dùng Veo 3.1 - Lite [Lower Priority].`);
  const projectId = randomUUID(); const body = { mediaGenerationContext: { batchId: randomUUID(), audioFailurePreference: 'BLOCK_SILENCED_VIDEOS' }, clientContext: { projectId, tool: 'PINHOLE', userPaygateTier: 'PAYGATE_TIER_TWO', sessionId: `;${Date.now()}`, recaptchaContext: { token: '', applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' } }, requests: [{ outputSpec: { resolution: 'VIDEO_RESOLUTION_720P' }, aspectRatio: aspectRatio === '16:9' ? 'VIDEO_ASPECT_RATIO_LANDSCAPE' : 'VIDEO_ASPECT_RATIO_PORTRAIT', textInput: { structuredPrompt: { parts: [{ text: prompt }] } }, videoModelKey, seed: Math.floor(Math.random() * 10_000), metadata: {} }], useV2ModelConfig: true };
  let current = await googleRequest(generateUrl, apiKey, token, cookie, body, signal);
  for (let attempt = 0; attempt < 120; attempt += 1) { const entries = mediaEntries(current, projectId); const failed = entries.find((item) => ['FAILED', 'FAILURE'].includes(item.status)); if (failed) throw new Error(`Google Flow từ chối tạo video: ${failed.status}.`); const completed = entries.find((item) => ['SUCCESS', 'SUCCESSFUL'].includes(item.status)); const mediaUrl = completed?.url || (completed ? findDownloadUrl(current) : ''); if (mediaUrl) { const response = await fetch(mediaUrl, { signal, headers: { Authorization: `Bearer ${token}`, ...(cookie ? { Cookie: cookie } : {}) } }); if (!response.ok) throw new Error(`Không tải được video Flow Direct (HTTP ${response.status}).`); await writeFile(outputFile, Buffer.from(await response.arrayBuffer())); return { model, taskId: completed?.name || projectId }; } const pending = entries.filter((item) => ['SCHEDULED', 'ACTIVE'].includes(item.status)); if (!pending.length) throw new Error(`Google Flow Direct không trả về trạng thái media hợp lệ: ${JSON.stringify(current).slice(0, 1200)}`); await delay(4_000, signal); current = await googleRequest(checkUrl, apiKey, token, cookie, { media: pending.map((item) => ({ name: item.name, projectId: item.projectId })) }, signal); }
  throw new Error('Google Flow Direct quá thời gian xử lý video.');
}
export async function validateGoogleFlowSession(credentials?: FlowCredentials, signal?: AbortSignal) {
  const apiKey = normalizeFlowApiKey(credentials?.nanoApiKey || process.env.GOOGLE_FLOW_API_KEY);
  const token = cleanToken(credentials?.veoToken || process.env.VEO_TOKEN || '');
  const cookie = credentials?.veoCookie?.trim() || process.env.VEO_COOKIE?.trim() || '';
  if (!apiKey) throw new Error('Hãy nhập Flow client API key lấy từ tham số key= của request credits.');
  if (!token) throw new Error('Hãy nhập Google Flow accessToken.');
  const response = await fetch(flowUrl(creditsUrl, apiKey), { signal, headers: { Authorization: `Bearer ${token}`, ...(cookie ? { Cookie: cookie } : {}) } });
  await parseGoogleResponse(response);
  return { ok: true as const };
}
export const generateGoogleFlowPreview = (prompt: string, outputFile: string) => generateGoogleFlowVideo(prompt, outputFile);
