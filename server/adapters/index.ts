import type { AIModel, AIProvider, Capability, SubtitleSegment, TranslationItem } from '../types';
import { resolveProviderType } from '../providers/base';
import * as elevenlabs from './elevenlabs';
import * as openai from './openaiCompatible';
import { ProviderError, TranslationValidationError } from './errors';

export { ProviderError, TranslationValidationError } from './errors';

function isElevenLabs(provider: AIProvider) {
  return resolveProviderType(provider) === 'elevenlabs';
}

export function listModels(provider: AIProvider): Promise<AIModel[]> {
  return isElevenLabs(provider) ? elevenlabs.listModels(provider) : openai.listModels(provider);
}

export function listVoices(provider: AIProvider) {
  return isElevenLabs(provider) ? elevenlabs.listVoices(provider) : Promise.resolve(provider.voices || []);
}

export function testConnection(provider: AIProvider) {
  return isElevenLabs(provider) ? elevenlabs.testConnection(provider) : openai.testConnection(provider);
}

export function testModel(provider: AIProvider, model: string, capability: Capability) {
  return isElevenLabs(provider) ? elevenlabs.testModel(provider, model, capability) : openai.testModel(provider, model, capability);
}

export function chat(provider: AIProvider, model: string, messages: Array<{ role: 'system' | 'user'; content: string | Array<Record<string, string>> }>, signal?: AbortSignal) {
  if (isElevenLabs(provider)) throw new ProviderError('ElevenLabs không cung cấp capability Chat.', 400);
  return openai.chat(provider, model, messages, signal);
}

export function translateBatch(provider: AIProvider, model: string, items: TranslationItem[], sourceLanguage: string, targetLanguage: string, style: string, customPrompt: string, glossary: Array<{ source: string; target: string }>) {
  if (isElevenLabs(provider)) throw new ProviderError('Dịch phụ đề cần provider có capability Chat.', 400);
  return openai.translateBatch(provider, model, items, sourceLanguage, targetLanguage, style, customPrompt, glossary);
}

export function transcribe(provider: AIProvider, model: string, audio: Buffer | string, filename: string, language: string): Promise<{ text: string; segments: SubtitleSegment[] }> {
  return isElevenLabs(provider) ? elevenlabs.transcribe(provider, model, audio, filename, language) : openai.transcribe(provider, model, audio, filename, language);
}

export function recognizeImage(provider: AIProvider, model: string, imagePath: string, prompt: string) {
  if (isElevenLabs(provider)) throw new ProviderError('ElevenLabs không cung cấp capability Vision.', 400);
  return openai.recognizeImage(provider, model, imagePath, prompt);
}

export function synthesize(provider: AIProvider, model: string, voice: string, text: string, options: { speed?: number; format?: string; signal?: AbortSignal }) {
  return isElevenLabs(provider) ? elevenlabs.synthesize(provider, model, voice, text, options) : openai.synthesize(provider, model, voice, text, options);
}
