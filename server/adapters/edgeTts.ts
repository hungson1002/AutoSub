import type { AIModel, AIVoice, AIProvider } from '../types';
import { runEdgeTtsBridge } from '../services/edgeTtsBridge';
import { assertPlayableAudio } from './capabilityTestMedia';
import { ProviderError } from './errors';

export const EDGE_TTS_MODEL = 'edge-tts';
export const EDGE_VIETNAMESE_VOICES: AIVoice[] = [
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My · Nữ', language: 'vi-VN' },
  { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh · Nam', language: 'vi-VN' },
];

let edgeQueue: Promise<void> = Promise.resolve();

async function serialized<T>(task: () => Promise<T>) {
  const run = edgeQueue.then(task, task);
  edgeQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function listModels(_provider: AIProvider): Promise<AIModel[]> {
  return [{ id: EDGE_TTS_MODEL, name: 'Microsoft Edge TTS', capabilities: { tts: true } }];
}

export async function listVoices(_provider: AIProvider): Promise<AIVoice[]> {
  return EDGE_VIETNAMESE_VOICES;
}

export async function testConnection(_provider: AIProvider) {
  const response = await runEdgeTtsBridge({ op: 'health' });
  return { ok: true, warning: `Edge TTS online sẵn sàng · ${Number(response.voiceCount) || 2} giọng Việt · không API key.` };
}

export async function synthesize(_provider: AIProvider, _model: string, voice: string, text: string, options: { speed?: number; signal?: AbortSignal }) {
  if (!EDGE_VIETNAMESE_VOICES.some((item) => item.id === voice)) throw new ProviderError('Edge TTS cần chọn Hoài My hoặc Nam Minh.', 400);
  const response = await serialized(() => runEdgeTtsBridge({ op: 'synthesize', voice, text, speed: options.speed || 1 }, options.signal));
  if (typeof response.audioBase64 !== 'string') throw new ProviderError('Edge TTS không trả về audio.', 502);
  return Buffer.from(response.audioBase64, 'base64');
}

export async function synthesizeBatch(_provider: AIProvider, _model: string, voice: string, texts: string[], options: { speed?: number; signal?: AbortSignal }) {
  if (!EDGE_VIETNAMESE_VOICES.some((item) => item.id === voice)) throw new ProviderError('Edge TTS cần chọn Hoài My hoặc Nam Minh.', 400);
  if (!texts.length || texts.length > 32 || texts.some((text) => !text.trim())) throw new ProviderError('Batch Edge TTS cần từ 1 đến 32 đoạn có nội dung.', 400);
  const response = await serialized(() => runEdgeTtsBridge({ op: 'synthesize_batch', voice, texts, speed: options.speed || 1 }, options.signal));
  if (typeof response.audioBase64 !== 'string' || !Array.isArray(response.ranges) || response.ranges.length !== texts.length) throw new ProviderError('Edge TTS không trả về audio/timestamp batch hợp lệ.', 502);
  const audio = Buffer.from(response.audioBase64, 'base64');
  assertPlayableAudio(audio);
  return { audio, ranges: response.ranges };
}

export async function testModel(provider: AIProvider, model: string) {
  const startedAt = Date.now();
  const audio = await synthesize(provider, model, EDGE_VIETNAMESE_VOICES[0].id, 'Xin chào, đây là bản thử giọng Edge TTS của AutoSub.', {});
  assertPlayableAudio(audio);
  return { ok: true, model, capability: 'tts', latencyMs: Date.now() - startedAt, output: `${audio.length} bytes audio · Hoài My` };
}
