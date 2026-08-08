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
  const statusMessage = response.status === 401
    ? type === 'elevenlabs' ? 'API key ElevenLabs không hợp lệ hoặc request chưa dùng header xi-api-key.' : `${prefix} API key không hợp lệ hoặc chưa được gửi dưới dạng Bearer token.`
    : response.status === 403 ? 'API key không có quyền sử dụng model hoặc endpoint này.'
      : response.status === 404 ? 'Endpoint không tồn tại hoặc provider không hỗ trợ chức năng này.'
        : response.status === 429 ? 'Đã vượt rate limit/quota của provider.'
          : message || fallback;
  throw new ProviderError(statusMessage, response.status, redactSecrets(body, provider));
}
