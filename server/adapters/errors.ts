import type { AIProvider } from '../types';
import { resolveProviderType } from '../providers/base';

export class ProviderError extends Error {
  constructor(message: string, public status = 502, public detail?: string) { super(message); }
}

export class TranslationValidationError extends ProviderError {
  constructor(message: string, public partialItems: Array<{ id: string; translation: string }>) { super(message); }
}

export function redactSecrets(value: string, provider?: AIProvider) {
  let output = value;
  if (provider?.apiKey) output = output.split(provider.apiKey).join('[REDACTED]');
  return output
    .replace(/(authorization\s*[:=]\s*)([^\s,}]+)/gi, '$1[REDACTED]')
    .replace(/(xi-api-key|x-api-key|api[-_]?key|secret)\s*[:=]\s*([^\s,}]+)/gi, '$1: [REDACTED]');
}

function quotaMessage(message: string) {
  return /usage[_ -]?exceeded|insufficient[_ -]?quota|quota.{0,24}(exceed|exhaust|limit|empty)|(?:credit|credits).{0,24}(exhaust|used|limit|insufficient)|billing|monthly limit|plan limit/i.test(message);
}

function readableProviderMessage(message: string, status: number, providerName: string, providerType: string, fallback: string) {
  if (quotaMessage(message)) return `${providerName} đã hết hạn mức sử dụng (quota/credit). Hãy đổi provider, kiểm tra API key hoặc chờ quota được reset.`;
  if (status === 413) return providerType === 'groq'
    ? 'Groq STT upload quá lớn: audio đã vượt giới hạn upload của Groq.'
    : 'Dữ liệu gửi lên quá lớn. Hãy kiểm tra giới hạn request của provider.';
  if (status === 401) return providerType === 'elevenlabs'
    ? 'API key ElevenLabs không hợp lệ hoặc đã hết hạn. Hãy kiểm tra lại trong Cài đặt.'
    : `API key ${providerName} không hợp lệ hoặc đã hết hạn. Hãy kiểm tra lại trong Cài đặt.`;
  if (status === 403) return `API key ${providerName} không có quyền dùng model hoặc endpoint này.`;
  if (status === 404) return `Không tìm thấy endpoint hoặc model trên ${providerName}. Hãy kiểm tra Base URL và model.`;
  if (status === 429) return /rate[ -]?limit|too many requests|throttl/i.test(message)
    ? `${providerName} đang giới hạn tần suất request. Hãy chờ một chút rồi thử lại.`
    : `${providerName} đã từ chối request vì giới hạn sử dụng. Hãy kiểm tra quota/API key hoặc đổi provider.`;
  if (status >= 500) return `${providerName} đang gặp lỗi máy chủ. Hãy thử lại sau.`;
  return message || fallback;
}

export async function providerResponseError(response: Response, provider: AIProvider, fallback: string) {
  const body = await response.text().catch(() => '');
  let message = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const error = parsed.error;
    message = typeof error === 'string' ? error : error && typeof error === 'object' && typeof error.message === 'string' ? error.message : typeof parsed.message === 'string' ? parsed.message : '';
  } catch { /* non-JSON response is kept as redacted detail */ }
  const type = resolveProviderType(provider);
  const prefix = type === 'groq' ? 'Groq' : type === 'elevenlabs' ? 'ElevenLabs' : provider.name;
  if (response.status === 413 && type === 'groq' && process.env.AUTOSUB_DEBUG_UPLOADS === '1') console.warn(`[stt] Groq STT upload too large ${JSON.stringify({ provider: provider.name, status: response.status })}`);
  const statusMessage = readableProviderMessage(message, response.status, prefix, type, fallback);
  throw new ProviderError(statusMessage, response.status, redactSecrets(body, provider));
}
