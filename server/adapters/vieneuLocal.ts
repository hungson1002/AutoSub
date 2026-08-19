import type { AIModel, AIVoice, AIProvider, Capability } from '../types';
import { listVoiceCloneProfiles, resolveVoiceCloneReference, voiceProfileToVoice } from '../services/voiceClones';
import { synthesizeWithVieneu, vieneuRuntimeStatus } from '../services/vieneuRuntime';
import { assertPlayableAudio } from './capabilityTestMedia';
import { ProviderError } from './errors';

export const VIENEU_LOCAL_MODEL = 'vieneu-v3-turbo';
export const VIENEU_PRESET_VOICE_PREFIX = 'preset:';

const VIENEU_PRESET_VOICES: Array<{ id: string; name: string; language: string; description: string }> = [
  { id: 'minh-duc', name: 'Minh Đức', language: 'vi-VN', description: 'Nam · Bắc · Phong cách tin tức' },
  { id: 'pham-tuyen', name: 'Phạm Tuyên', language: 'vi-VN', description: 'Nam · Bắc · Phong cách tự nhiên' },
  { id: 'thai-son', name: 'Thái Sơn', language: 'vi-VN', description: 'Nam · Nam · Phong cách kể chuyện' },
  { id: 'xuan-vinh', name: 'Xuân Vĩnh', language: 'vi-VN', description: 'Nam · Nam · Phong cách tự nhiên' },
  { id: 'thanh-binh', name: 'Thanh Bình', language: 'vi-VN', description: 'Nam · Bắc · Phong cách kể chuyện' },
  { id: 'truc-ly', name: 'Trúc Ly', language: 'vi-VN', description: 'Nữ · Bắc · Phong cách tự nhiên' },
  { id: 'ngoc-linh', name: 'Ngọc Linh', language: 'vi-VN', description: 'Nữ · Bắc · Phong cách kể chuyện' },
  { id: 'doan-trang', name: 'Đoan Trang', language: 'vi-VN', description: 'Nữ · Bắc · Phong cách tự nhiên' },
  { id: 'mai-anh', name: 'Mai Anh', language: 'vi-VN', description: 'Nữ · Bắc · Phong cách tin tức' },
  { id: 'thuc-doan', name: 'Thục Đoan', language: 'vi-VN', description: 'Nữ · Nam · Phong cách kể chuyện' },
  { id: 'minh-triet', name: 'Minh Triết', language: 'vi-VN', description: 'Nam · Nam · Phong cách tin tức' },
  { id: 'thuy-dung', name: 'Thùy Dung', language: 'vi-VN', description: 'Nữ · Nam · Phong cách tin tức' },
  { id: 'quang-son', name: 'Quang Sơn', language: 'vi-VN', description: 'Nam · Trung · Phong cách tự nhiên' },
  { id: 'ngoc-tran', name: 'Ngọc Trân', language: 'vi-VN', description: 'Nữ · Trung · Phong cách tự nhiên' },
  { id: 'my-duyen', name: 'Mỹ Duyên', language: 'vi-VN', description: 'Nữ · Nam · Phong cách đọc truyện' },
  { id: 'quynh-anh', name: 'Quỳnh Anh', language: 'vi-VN', description: 'Nữ · Bắc · Phong cách đọc truyện' },
  { id: 'duc-tri', name: 'Đức Trí', language: 'vi-VN', description: 'Nam · Nam · Phong cách đọc truyện' },
  { id: 'kim-thanh', name: 'Kim Thanh', language: 'vi-VN', description: 'Nữ · Nam · Phong cách đọc truyện' },
  { id: 'ngoc-huyen', name: 'Ngọc Huyền', language: 'vi-VN', description: 'Nữ · Bắc · Giọng đọc tự nhiên' },
  { id: 'adam', name: 'Adam', language: 'en-US', description: 'Nam · Tiếng Anh · Giọng đọc tự nhiên' },
];

export function listVieneuPresetVoices(): AIVoice[] {
  return VIENEU_PRESET_VOICES.map((voice) => ({
    id: `${VIENEU_PRESET_VOICE_PREFIX}${voice.id}`,
    name: voice.name,
    language: voice.language,
    description: voice.description,
    source: 'preset',
  }));
}

export function vieneuPresetVoiceName(id: string) {
  const presetId = id.startsWith(VIENEU_PRESET_VOICE_PREFIX) ? id.slice(VIENEU_PRESET_VOICE_PREFIX.length) : '';
  return VIENEU_PRESET_VOICES.find((voice) => voice.id === presetId)?.name;
}

export async function listModels(_provider: AIProvider): Promise<AIModel[]> {
  return [{ id: VIENEU_LOCAL_MODEL, name: 'VieNeu-TTS v3 Turbo · CPU/ONNX · 48 kHz', capabilities: { tts: true } }];
}

export async function listVoices(_provider: AIProvider): Promise<AIVoice[]> {
  return [...listVieneuPresetVoices(), ...(await listVoiceCloneProfiles()).map(voiceProfileToVoice)];
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
  const presetName = vieneuPresetVoiceName(voice);
  const voiceInput = presetName ? { presetName } : { referencePath: (await resolveVoiceCloneReference(voice)).referencePath };
  const audio = await synthesizeWithVieneu(text, voiceInput, options.speed, options.signal);
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
