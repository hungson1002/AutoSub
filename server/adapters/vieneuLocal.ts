import type { AIModel, AIVoice, AIProvider, Capability } from '../types';
import { listVoiceCloneProfiles, resolveVoiceCloneReference, voiceProfileToVoice } from '../services/voiceClones';
import { synthesizeWithVieneu, vieneuRuntimeStatus } from '../services/vieneuRuntime';
import { assertPlayableAudio } from './capabilityTestMedia';
import { ProviderError } from './errors';

export const VIENEU_LOCAL_MODEL = 'vieneu-v3-turbo';

export async function listModels(_provider: AIProvider): Promise<AIModel[]> {
  return [{ id: VIENEU_LOCAL_MODEL, name: 'VieNeu-TTS v3 Turbo · CPU/ONNX · 48 kHz', capabilities: { tts: true } }];
}

export async function listVoices(_provider: AIProvider): Promise<AIVoice[]> {
  return (await listVoiceCloneProfiles()).map(voiceProfileToVoice);
}

export async function testConnection(_provider: AIProvider) {
  const [runtime, profiles] = await Promise.all([vieneuRuntimeStatus(), listVoiceCloneProfiles()]);
  return { ok: true, warning: `VieNeu Local sẵn sàng · CPU ${runtime.threads} luồng · ${profiles.length} giọng clone · model tự tải một lần khi nghe thử.` };
}

function assertModel(model: string) {
  if (model !== VIENEU_LOCAL_MODEL) throw new ProviderError(`VieNeu Local không có model “${model}”.`, 400);
}

export async function synthesize(_provider: AIProvider, model: string, voice: string, text: string, options: { speed?: number; signal?: AbortSignal }) {
  assertModel(model);
  const reference = await resolveVoiceCloneReference(voice);
  const audio = await synthesizeWithVieneu(text, reference.referencePath, options.speed, options.signal);
  assertPlayableAudio(audio);
  return audio;
}

export async function testModel(provider: AIProvider, model: string, capability: Capability) {
  if (capability !== 'tts') throw new ProviderError('VieNeu Local chỉ hỗ trợ capability TTS.', 400);
  assertModel(model);
  const voices = await listVoices(provider);
  const voice = voices[0];
  if (!voice) throw new ProviderError('Hãy tạo ít nhất một giọng clone trong mục Clone giọng trước khi test model VieNeu.', 400);
  const startedAt = Date.now();
  const audio = await synthesize(provider, model, voice.id, 'Xin chào, đây là bản thử giọng clone cục bộ của AutoSub.', {});
  return { ok: true, model, capability: 'tts', latencyMs: Date.now() - startedAt, output: `${audio.length} bytes WAV · ${voice.name || voice.id}` };
}
