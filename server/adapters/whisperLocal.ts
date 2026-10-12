import type { AIProvider, Capability } from '../types';
import { allowedLocalSttModels, assertLocalSttAllowed } from '../services/localSttPolicy';
import { assertExpectedTranscript, capabilityTestSpeech } from './capabilityTestMedia';
import { ProviderError } from './errors';
import { listWhisperModels, transcribeWithWhisper, whisperRuntimeStatus } from '../services/whisperCpp';
import {FASTER_WHISPER_MODELS,isFasterWhisperModel,transcribeWithFasterWhisper} from '../services/fasterWhisper';

export async function listModels(_provider: AIProvider) {
  return allowedLocalSttModels([...FASTER_WHISPER_MODELS,...await listWhisperModels()]);
}

export async function testConnection(_provider: AIProvider) {
  const status = await whisperRuntimeStatus();
  return {
    ok: true,
    warning: `Whisper Local runtime đã sẵn sàng · Q5: CPU ${status.threads} luồng · Faster INT8: tối đa 4 luồng, VAD + timestamp từng từ · model/cache không đi kèm source clone; bấm Test model để tải và kiểm tra inference thật.`,
  };
}

export async function testModel(_provider: AIProvider, model: string, capability: Capability) {
  assertLocalSttAllowed(model);
  if (capability !== 'stt') throw new ProviderError('Whisper Local chỉ hỗ trợ capability STT.', 400);
  const startedAt = Date.now();
  const result = await transcribe(_provider, model, capabilityTestSpeech(), 'autosub-test.ogg', 'en');
  assertExpectedTranscript(result.text);
  return { ok: true, model, capability: 'stt', latencyMs: Date.now() - startedAt, output: result.text.slice(0, 120) };
}

export function transcribe(_provider: AIProvider, model: string, audio: Buffer | string, filename: string, language: string, signal?: AbortSignal, onProgress?: (percent: number) => void) {
  assertLocalSttAllowed(model);
  return isFasterWhisperModel(model) ? transcribeWithFasterWhisper(model, audio, filename, language, signal, onProgress) : transcribeWithWhisper(model, audio, filename, language, signal, onProgress);
}
