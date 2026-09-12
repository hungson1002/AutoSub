import type { AIProvider } from '../types';
import { api } from './api';

export const VI_VOICE_PREVIEW_TEXT = 'Xin chào, đây là bản nghe thử để bạn đánh giá màu giọng, độ rõ, nhịp nói và cảm xúc trước khi dùng cho toàn bộ video.';
export const EN_VOICE_PREVIEW_TEXT = 'Hello, this voice preview lets you evaluate tone, clarity, speaking rhythm, and expression before using the voice throughout your video.';

const previews = new Map<string, Blob>();
const pending = new Map<string, Promise<Blob>>();
const MAX_PREVIEWS = 32;

const previewKey = (provider: AIProvider, model: string, voice: string, speed: number, text: string) =>
  [provider.id, provider.baseUrl, model, voice, speed.toFixed(2), text].join('::');

export function hasVoicePreview(provider: AIProvider, model: string, voice: string, speed: number, text = VI_VOICE_PREVIEW_TEXT) {
  return previews.has(previewKey(provider, model, voice, speed, text));
}

export function loadVoicePreview(provider: AIProvider, model: string, voice: string, speed: number, text = VI_VOICE_PREVIEW_TEXT) {
  const key = previewKey(provider, model, voice, speed, text);
  const cached = previews.get(key);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const task = api.testVoice(provider, model, voice, speed, text).then((blob) => {
    previews.set(key, blob);
    while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value as string);
    return blob;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export function primeVoicePreview(provider: AIProvider | undefined, model: string, voice: string, speed: number, text = VI_VOICE_PREVIEW_TEXT) {
  if (!provider || !model || !voice) return;
  void loadVoicePreview(provider, model, voice, speed, text).catch(() => undefined);
}
