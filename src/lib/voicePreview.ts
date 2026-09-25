import type { AIProvider } from '../types';
import { api } from './api';
import { resolvedProviderType } from './providers';
import { KOKORO_VOICE_PREVIEW_TEXT } from '../../shared/kokoroVoices';

export const VI_VOICE_PREVIEW_TEXT = 'Xin chào, đây là bản nghe thử để bạn đánh giá màu giọng, độ rõ, nhịp nói và cảm xúc trước khi dùng cho toàn bộ video.';
export const EN_VOICE_PREVIEW_TEXT = 'Hello, this voice preview lets you evaluate tone, clarity, speaking rhythm, and expression before using the voice throughout your video.';

const previews = new Map<string, Blob>();
const pending = new Map<string, Promise<Blob>>();
const MAX_PREVIEWS = 32;

export function voicePreviewTextFor(provider: AIProvider, voice: string, text?: string) {
  if (text !== undefined) return text;
  const language = provider.voices?.find((item) => item.id === voice)?.language?.toLowerCase() || '';
  return resolvedProviderType(provider) === 'kokoro-local' || language.startsWith('en-')
    ? KOKORO_VOICE_PREVIEW_TEXT
    : VI_VOICE_PREVIEW_TEXT;
}

const previewKey = (provider: AIProvider, model: string, voice: string, speed: number, text: string) =>
  [provider.id, provider.baseUrl, model, voice, speed.toFixed(2), text].join('::');

export function hasVoicePreview(provider: AIProvider, model: string, voice: string, speed: number, text?: string) {
  return previews.has(previewKey(provider, model, voice, speed, voicePreviewTextFor(provider, voice, text)));
}

export function loadVoicePreview(provider: AIProvider, model: string, voice: string, speed: number, text?: string) {
  const spokenText = voicePreviewTextFor(provider, voice, text);
  const key = previewKey(provider, model, voice, speed, spokenText);
  const cached = previews.get(key);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const task = api.testVoice(provider, model, voice, speed, spokenText).then((blob) => {
    previews.set(key, blob);
    while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value as string);
    return blob;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export function primeVoicePreview(provider: AIProvider | undefined, model: string, voice: string, speed: number, text?: string) {
  if (!provider || !model || !voice) return;
  // Kokoro needs a one-time local runtime/model setup. Do it under the visible
  // "Nghe thử" action so selecting it never silently starts a large download.
  if (resolvedProviderType(provider) === 'kokoro-local') return;
  void loadVoicePreview(provider, model, voice, speed, text).catch(() => undefined);
}
