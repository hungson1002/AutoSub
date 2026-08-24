import type { AIProvider, Capability } from '../types';
import { assertExpectedTranscript, capabilityTestSpeech } from './capabilityTestMedia';
import { ProviderError } from './errors';
import { listWhisperModels, transcribeWithWhisper, whisperRuntimeStatus } from '../services/whisperCpp';

export async function listModels(_provider: AIProvider) {
  return listWhisperModels();
}

export async function testConnection(_provider: AIProvider) {
  const status = await whisperRuntimeStatus();
  return {
    ok: true,
    warning: `Whisper Local sẵn sàng · CPU ${status.threads} luồng · model sẽ tự tải một lần khi test/chạy STT.`,
  };
}

export async function testModel(_provider: AIProvider, model: string, capability: Capability) {
  if (capability !== 'stt') throw new ProviderError('Whisper Local chỉ hỗ trợ capability STT.', 400);
  const startedAt = Date.now();
  const result = await transcribeWithWhisper(model, capabilityTestSpeech(), 'autosub-test.ogg', 'en');
  assertExpectedTranscript(result.text);
  return { ok: true, model, capability: 'stt', latencyMs: Date.now() - startedAt, output: result.text.slice(0, 120) };
}

export function transcribe(_provider: AIProvider, model: string, audio: Buffer | string, filename: string, language: string, signal?: AbortSignal, onProgress?: (percent: number) => void) {
  return transcribeWithWhisper(model, audio, filename, language, signal, onProgress);
}
