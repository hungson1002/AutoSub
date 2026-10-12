import type { AIModel, AIVoice, AIProvider, Capability } from '../types';
import { ZEROTTS_VIETNAMESE_VOICES } from '../../shared/zeroTtsVoices';
import { synthesizeWithZeroTts, zeroTtsRuntimeStatus } from '../services/zerottsRuntime';
import { assertPlayableAudio } from './capabilityTestMedia';
import { ProviderError } from './errors';

export const ZEROTTS_LOCAL_MODEL = 'zerotts-v0.1.5';

export async function listModels(_provider: AIProvider): Promise<AIModel[]> {
  return [{
    id: ZEROTTS_LOCAL_MODEL,
    name: 'ZeroTTS 0.1.5 · ONNX CPU · 48 kHz',
    capabilities: { tts: true },
    raw: { detail: 'Vietnamese-native · 8 preset voices · MIT · ~900 MB' },
  }];
}

export async function listVoices(_provider: AIProvider): Promise<AIVoice[]> {
  return ZEROTTS_VIETNAMESE_VOICES.map((voice) => ({ ...voice }));
}

export async function testConnection(_provider: AIProvider) {
  const runtime = await zeroTtsRuntimeStatus();
  return {
    ok: true,
    warning: `ZeroTTS Local sẵn sàng · CPU ${runtime.threads} luồng · ONNX · 8 giọng Việt preset · model tải một lần khi nghe thử.`,
  };
}

function assertModel(model: string) {
  if (model !== ZEROTTS_LOCAL_MODEL) throw new ProviderError(`ZeroTTS Local không có model “${model}”.`, 400);
}

function assertVoice(voice: string) {
  if (!ZEROTTS_VIETNAMESE_VOICES.some((item) => item.id === voice)) {
    throw new ProviderError(`ZeroTTS Local không có voice “${voice}”.`, 400);
  }
}

export async function synthesize(_provider: AIProvider, model: string, voice: string, text: string, options: { speed?: number; signal?: AbortSignal }) {
  assertModel(model);
  assertVoice(voice);
  const audio = await synthesizeWithZeroTts(text, voice, options.speed, options.signal);
  assertPlayableAudio(audio);
  return audio;
}

export async function testModel(provider: AIProvider, model: string, capability: Capability) {
  if (capability !== 'tts') throw new ProviderError('ZeroTTS Local chỉ hỗ trợ capability TTS.', 400);
  assertModel(model);
  const voice = ZEROTTS_VIETNAMESE_VOICES.find((item) => item.id === 'giahuy') || ZEROTTS_VIETNAMESE_VOICES[0];
  const startedAt = Date.now();
  const audio = await synthesize(
    provider,
    model,
    voice.id,
    'Đại ca cứ yên tâm, em tìm được đường vào rồi. Bây giờ mình vòng qua bên trái rồi tiến thẳng lên núi.',
    { speed: 1 },
  );
  return {
    ok: true,
    model,
    capability: 'tts',
    latencyMs: Date.now() - startedAt,
    output: `${audio.length} bytes WAV · ${voice.name}`,
  };
}
