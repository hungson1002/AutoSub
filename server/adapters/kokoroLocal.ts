import type { AIModel, AIVoice, AIProvider } from '../types';
import { isLikelyVietnamese, KOKORO_ENGLISH_VOICES } from '../../shared/kokoroVoices';
import { synthesizeWithKokoro } from '../services/kokoroRuntime';
import { assertPlayableAudio } from './capabilityTestMedia';
import { ProviderError } from './errors';

export const KOKORO_LOCAL_MODEL = 'kokoro-v1.0';

export async function listModels(_provider: AIProvider): Promise<AIModel[]> {
  return [{ id: KOKORO_LOCAL_MODEL, name: 'Kokoro 82M · ONNX · CPU', capabilities: { tts: true } }];
}

export async function listVoices(_provider: AIProvider): Promise<AIVoice[]> {
  return KOKORO_ENGLISH_VOICES;
}

export function languageForKokoroVoice(voice: string) {
  return KOKORO_ENGLISH_VOICES.find((item) => item.id === voice)?.language;
}

export async function testConnection(_provider: AIProvider) {
  return { ok: true, warning: 'Kokoro TTS chạy cục bộ, không API key/quota. Lần tổng hợp đầu tải model khoảng 354 MB và cài runtime; các lần sau dùng lại dữ liệu đã lưu.' };
}

function assertModel(model: string) {
  if (model !== KOKORO_LOCAL_MODEL) throw new ProviderError(`Kokoro Local không có model “${model}”.`, 400);
}

export async function synthesize(_provider: AIProvider, model: string, voice: string, text: string, options: { speed?: number; signal?: AbortSignal }) {
  assertModel(model);
  const language = languageForKokoroVoice(voice);
  if (!language) throw new ProviderError('Hãy chọn một giọng Kokoro English có sẵn.', 400);
  if (!text.trim()) throw new ProviderError('Văn bản Kokoro không được để trống.', 400);
  if (isLikelyVietnamese(text)) throw new ProviderError('Kokoro trong AutoSub đang cấu hình giọng tiếng Anh; nội dung có vẻ là tiếng Việt nên đã dừng để tránh đọc sai. Hãy chọn VieNeu Local hoặc một giọng Việt.', 400);
  const audio = await synthesizeWithKokoro(text, voice, language, options.speed || 1, options.signal);
  assertPlayableAudio(audio);
  return audio;
}

export async function testModel(provider: AIProvider, model: string) {
  const startedAt = Date.now();
  const voice = KOKORO_ENGLISH_VOICES.find((item) => item.id === 'af_sarah')!;
  const audio = await synthesize(provider, model, voice.id, 'Hello. Let me tell you one surprising detail you may have missed.', {});
  return { ok: true, model, capability: 'tts', latencyMs: Date.now() - startedAt, output: `${audio.length} bytes WAV · ${voice.name}` };
}
