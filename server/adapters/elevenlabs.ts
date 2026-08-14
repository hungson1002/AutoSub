import type { AIModel, AIVoice, AIProvider, SubtitleSegment, SubtitleWord } from '../types';
import { openAsBlob } from 'node:fs';
import { buildAuthHeaders, endpoint, providerBase, withAuthQuery } from '../providers/base';
import { assertExpectedTranscript, assertPlayableAudio, capabilityTestSpeech } from './capabilityTestMedia';
import { providerResponseError, ProviderError } from './errors';
import { normalizeSttLanguage } from './openaiCompatible';

const headers = buildAuthHeaders;

async function responseJson(response: Response, provider: AIProvider, fallback: string) {
  if (!response.ok) await providerResponseError(response, provider, fallback);
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function normalizeModel(item: unknown): AIModel | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const value = item as Record<string, unknown>;
  const id = typeof value.model_id === 'string' ? value.model_id : typeof value.id === 'string' ? value.id : undefined;
  if (!id) return undefined;
  const capabilities = {
    ...(value.can_do_text_to_speech === true ? { tts: true } : {}),
    ...(value.can_do_speech_to_text === true ? { stt: true } : {}),
  };
  if (!Object.keys(capabilities).length) capabilities.tts = true;
  return { id, name: typeof value.name === 'string' ? value.name : undefined, capabilities, raw: item };
}

export async function listModels(provider: AIProvider) {
  const response = await fetch(withAuthQuery(endpoint(provider, 'models', '/models'), provider), { headers: headers(provider) });
  const data = await responseJson(response, provider, 'Không thể lấy model từ ElevenLabs.');
  const raw = Array.isArray(data) ? data : Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : [];
  return raw.flatMap((item) => { const model = normalizeModel(item); return model ? [model] : []; });
}

export async function listVoices(provider: AIProvider) {
  const response = await fetch(withAuthQuery(endpoint(provider, 'voices', '/voices'), provider), { headers: headers(provider) });
  const data = await responseJson(response, provider, 'Không thể lấy voice từ ElevenLabs.');
  const raw = Array.isArray(data) ? data : Array.isArray(data.voices) ? data.voices : [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const id = typeof value.voice_id === 'string' ? value.voice_id : typeof value.id === 'string' ? value.id : undefined;
    return id ? [{ id, name: typeof value.name === 'string' ? value.name : undefined, language: typeof value.language_code === 'string' ? value.language_code : undefined }] : [];
  }) as AIVoice[];
}

export async function testConnection(provider: AIProvider) {
  const response = await fetch(withAuthQuery(providerBase(provider), provider), { headers: headers(provider) });
  if (!response.ok && ![404, 405, 501].includes(response.status)) await providerResponseError(response, provider, 'Kiểm tra kết nối ElevenLabs thất bại.');
  return { ok: true };
}

export async function transcribe(provider: AIProvider, model: string, audio: Buffer | string, filename: string, language: string, signal?: AbortSignal) {
  const form = new FormData();
  const blob = typeof audio === 'string' ? await openAsBlob(audio, { type: 'audio/wav' }) : new Blob([audio], { type: /\.ogg$/i.test(filename) ? 'audio/ogg' : /\.mp3$/i.test(filename) ? 'audio/mpeg' : 'audio/wav' });
  form.append('file', blob, filename);
  form.append('model_id', model);
  const languageCode = normalizeSttLanguage(language);
  if (languageCode) form.append('language_code', languageCode);
  const response = await fetch(withAuthQuery(endpoint(provider, 'stt', '/speech-to-text'), provider), { method: 'POST', headers: headers(provider), body: form, signal });
  const data = await responseJson(response, provider, 'ElevenLabs STT không phản hồi.');
  const text = typeof data.text === 'string' ? data.text : '';
  const rawSegments = (Array.isArray(data.segments) ? data.segments : []) as SubtitleSegment[];
  const rawWords = (Array.isArray(data.words) ? data.words : []) as SubtitleWord[];
  const segments = rawSegments.length || !rawWords.length || !text
    ? rawSegments
    : [{ start: rawWords[0]?.start, end: rawWords.at(-1)?.end, text, words: rawWords }];
  return { text, segments };
}

export async function synthesize(provider: AIProvider, model: string, voice: string, text: string, options: { signal?: AbortSignal }) {
  if (!voice?.trim()) throw new ProviderError('Model TTS này yêu cầu chọn Voice.', 400);
  const target = endpoint(provider, 'tts', '/text-to-speech/{voice_id}').replace('{voice_id}', encodeURIComponent(voice.trim()));
  const response = await fetch(withAuthQuery(target, provider), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(provider) }, signal: options.signal, body: JSON.stringify({ text, model_id: model }) });
  if (!response.ok) await providerResponseError(response, provider, 'ElevenLabs TTS không phản hồi.');
  return Buffer.from(await response.arrayBuffer());
}

export async function testModel(provider: AIProvider, model: string, capability: 'translation' | 'vision' | 'stt' | 'tts') {
  const providerCapability = capability === 'translation' ? 'chat' : capability;
  if (provider.capabilities?.[providerCapability] === false) throw new ProviderError(`Provider ${provider.name} không hỗ trợ capability ${providerCapability}.`, 400);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const started = Date.now();
  try {
    if (capability === 'tts') {
      const voices = provider.voices?.length ? provider.voices : await listVoices(provider);
      const audio = await synthesize(provider, model, voices[0]?.id || '', 'This is a short ElevenLabs voice test.', { signal: controller.signal });
      assertPlayableAudio(audio);
      return { ok: true, model, capability, latencyMs: Date.now() - started, output: `${audio.length} bytes audio` };
    }
    if (capability === 'stt') {
      const result = await transcribe(provider, model, capabilityTestSpeech(), 'autosub-test.ogg', 'Auto Detect', controller.signal);
      const output = result.text || result.segments.map((segment) => segment.text || '').join(' ').trim();
      assertExpectedTranscript(output);
      return { ok: true, model, capability, latencyMs: Date.now() - started, output };
    }
    throw new ProviderError('ElevenLabs không cung cấp capability Chat/Vision.', 400);
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError('Test model timeout sau 15 giây.', 504);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
