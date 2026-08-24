import type { AIModel, AIProvider, Capability, SubtitleSegment, TranslationItem, TranslationMemoryItem } from '../types';
import { resolveProviderType } from '../providers/base';
import * as elevenlabs from './elevenlabs';
import * as capcut from './capcut';
import * as whisperLocal from './whisperLocal';
import * as edgeTts from './edgeTts';
import * as vieneuLocal from './vieneuLocal';
import * as openai from './openaiCompatible';
import { ProviderError, TranslationValidationError } from './errors';

export { ProviderError, TranslationValidationError } from './errors';

function isElevenLabs(provider: AIProvider) {
  return resolveProviderType(provider) === 'elevenlabs';
}

function isCapCut(provider: AIProvider) {
  return resolveProviderType(provider) === 'capcut-tts';
}

function isWhisperLocal(provider: AIProvider) {
  return resolveProviderType(provider) === 'whisper-local';
}

function isEdgeTts(provider: AIProvider) {
  return resolveProviderType(provider) === 'edge-tts';
}

function isVieneuLocal(provider: AIProvider) {
  return resolveProviderType(provider) === 'vieneu-local';
}

export function listModels(provider: AIProvider): Promise<AIModel[]> {
  return isElevenLabs(provider) ? elevenlabs.listModels(provider) : isCapCut(provider) ? capcut.listModels(provider) : isWhisperLocal(provider) ? whisperLocal.listModels(provider) : isEdgeTts(provider) ? edgeTts.listModels(provider) : isVieneuLocal(provider) ? vieneuLocal.listModels(provider) : openai.listModels(provider);
}

export function listVoices(provider: AIProvider) {
  return isElevenLabs(provider) ? elevenlabs.listVoices(provider) : isCapCut(provider) ? capcut.listVoices(provider) : isEdgeTts(provider) ? edgeTts.listVoices(provider) : isVieneuLocal(provider) ? vieneuLocal.listVoices(provider) : Promise.resolve(provider.voices || []);
}

export function testConnection(provider: AIProvider) {
  return isElevenLabs(provider) ? elevenlabs.testConnection(provider) : isCapCut(provider) ? capcut.testConnection(provider) : isWhisperLocal(provider) ? whisperLocal.testConnection(provider) : isEdgeTts(provider) ? edgeTts.testConnection(provider) : isVieneuLocal(provider) ? vieneuLocal.testConnection(provider) : openai.testConnection(provider);
}

export function testModel(provider: AIProvider, model: string, capability: Capability) {
  if (isVieneuLocal(provider)) return vieneuLocal.testModel(provider, model, capability);
  return isElevenLabs(provider) ? elevenlabs.testModel(provider, model, capability) : isCapCut(provider) ? capability === 'tts' ? capcut.testModel(provider, model) : Promise.reject(new ProviderError('CapCut TTS chỉ hỗ trợ capability TTS.', 400)) : isWhisperLocal(provider) ? whisperLocal.testModel(provider, model, capability) : isEdgeTts(provider) ? capability === 'tts' ? edgeTts.testModel(provider, model) : Promise.reject(new ProviderError('Edge TTS chỉ hỗ trợ capability TTS.', 400)) : openai.testModel(provider, model, capability);
}

export function chat(provider: AIProvider, model: string, messages: Array<{ role: 'system' | 'user'; content: string | Array<Record<string, unknown>> }>, signal?: AbortSignal, maxTokens?: number) {
  if (isVieneuLocal(provider)) throw new ProviderError('VieNeu Local chỉ cung cấp capability TTS.', 400);
  if (isElevenLabs(provider)) throw new ProviderError('ElevenLabs không cung cấp capability Chat.', 400);
  if (isWhisperLocal(provider)) throw new ProviderError('Whisper Local chỉ cung cấp capability STT.', 400);
  if (isEdgeTts(provider)) throw new ProviderError('Edge TTS chỉ cung cấp capability TTS.', 400);
  return openai.chat(provider, model, messages, signal, maxTokens);
}

export function translateBatch(provider: AIProvider, model: string, items: TranslationItem[], sourceLanguage: string, targetLanguage: string, style: string, customPrompt: string, glossary: Array<{ source: string; target: string }>, translationMemory: TranslationMemoryItem[] = [], translationGuide = '') {
  if (isVieneuLocal(provider)) throw new ProviderError('VieNeu Local chỉ cung cấp capability TTS.', 400);
  if (isElevenLabs(provider)) throw new ProviderError('Dịch phụ đề cần provider có capability Chat.', 400);
  if (isWhisperLocal(provider)) throw new ProviderError('Whisper Local chỉ cung cấp capability STT.', 400);
  if (isEdgeTts(provider)) throw new ProviderError('Edge TTS chỉ cung cấp capability TTS.', 400);
  return openai.translateBatch(provider, model, items, sourceLanguage, targetLanguage, style, customPrompt, glossary, translationMemory, translationGuide);
}

export function buildTranslationGuide(provider: AIProvider, model: string, items: TranslationItem[], sourceLanguage: string, targetLanguage: string, style: string, customPrompt: string, glossary: Array<{ source: string; target: string }>) {
  if (isVieneuLocal(provider)) throw new ProviderError('VieNeu Local chỉ cung cấp capability TTS.', 400);
  if (isElevenLabs(provider)) throw new ProviderError('Dịch phụ đề cần provider có capability Chat.', 400);
  if (isWhisperLocal(provider)) throw new ProviderError('Whisper Local chỉ cung cấp capability STT.', 400);
  if (isEdgeTts(provider)) throw new ProviderError('Edge TTS chỉ cung cấp capability TTS.', 400);
  return openai.buildTranslationGuide(provider, model, items, sourceLanguage, targetLanguage, style, customPrompt, glossary);
}

export function transcribe(provider: AIProvider, model: string, audio: Buffer | string, filename: string, language: string, signal?: AbortSignal, onProgress?: (percent: number) => void): Promise<{ text: string; segments: SubtitleSegment[] }> {
  if (isVieneuLocal(provider)) throw new ProviderError('VieNeu Local chỉ cung cấp capability TTS.', 400);
  if (isCapCut(provider)) throw new ProviderError('CapCut TTS chỉ cung cấp capability TTS.', 400);
  if (isEdgeTts(provider)) throw new ProviderError('Edge TTS chỉ cung cấp capability TTS.', 400);
  return isElevenLabs(provider) ? elevenlabs.transcribe(provider, model, audio, filename, language, signal) : isWhisperLocal(provider) ? whisperLocal.transcribe(provider, model, audio, filename, language, signal, onProgress) : openai.transcribe(provider, model, audio, filename, language, signal);
}

export function recognizeImage(provider: AIProvider, model: string, imagePath: string, prompt: string, signal?: AbortSignal) {
  if (isVieneuLocal(provider)) throw new ProviderError('VieNeu Local chỉ cung cấp capability TTS.', 400);
  if (isElevenLabs(provider)) throw new ProviderError('ElevenLabs không cung cấp capability Vision.', 400);
  if (isWhisperLocal(provider)) throw new ProviderError('Whisper Local chỉ cung cấp capability STT.', 400);
  if (isEdgeTts(provider)) throw new ProviderError('Edge TTS chỉ cung cấp capability TTS.', 400);
  return openai.recognizeImage(provider, model, imagePath, prompt, signal);
}

export function synthesize(provider: AIProvider, model: string, voice: string, text: string, options: { speed?: number; format?: string; signal?: AbortSignal }) {
  if (isVieneuLocal(provider)) return vieneuLocal.synthesize(provider, model, voice, text, options);
  if (isWhisperLocal(provider)) throw new ProviderError('Whisper Local chỉ cung cấp capability STT.', 400);
  return isElevenLabs(provider) ? elevenlabs.synthesize(provider, model, voice, text, options) : isCapCut(provider) ? capcut.synthesize(provider, model, voice, text, options) : isEdgeTts(provider) ? edgeTts.synthesize(provider, model, voice, text, options) : openai.synthesize(provider, model, voice, text, options);
}
