import { readFile } from 'node:fs/promises';
import type { AIModel, AIProvider, SubtitleSegment, TranslationItem } from '../types';
import { buildAuthHeaders, endpoint, providerBase, resolveProviderType, withAuthQuery } from '../providers/base';
import { providerResponseError, ProviderError, TranslationValidationError } from './errors';

export { ProviderError, TranslationValidationError } from './errors';
const headers = buildAuthHeaders;

async function responseJson(response: Response, provider: AIProvider, fallback = 'Provider không trả về JSON hợp lệ.') { if (!response.ok) await providerResponseError(response, provider, fallback); return response.json().catch(() => ({})) as Promise<Record<string, unknown>>; }

function inferModelCapabilities(id: string, raw?: Record<string, unknown>) {
  const value = id.toLowerCase();
  if (value.includes('whisper') || value.includes('transcri')) return { stt: true };
  if (value.includes('tts') || value.includes('orpheus') || value.includes('speech')) return { tts: true };
  if (value.includes('vision') || value.includes('vl') || (raw?.modalities && JSON.stringify(raw.modalities).toLowerCase().includes('image'))) return { chat: true, vision: true };
  return { chat: true };
}

function normalizeModel(item: unknown): AIModel | undefined {
  if (typeof item === 'string') return { id: item, capabilities: inferModelCapabilities(item), raw: item };
  if (!item || typeof item !== 'object') return undefined;
  const value = item as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id : typeof value.model_id === 'string' ? value.model_id : undefined;
  if (!id) return undefined;
  return { id, name: typeof value.name === 'string' ? value.name : undefined, capabilities: inferModelCapabilities(id, value), raw: item };
}

export async function listModels(provider: AIProvider) { const response = await fetch(withAuthQuery(endpoint(provider, 'models', '/models'), provider), { headers: headers(provider) }); const data = await responseJson(response, provider, 'Không thể lấy danh sách model từ provider.'); const raw = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : []; return raw.flatMap((item) => { const normalized = normalizeModel(item); return normalized ? [normalized] : []; }); }

export async function testConnection(provider: AIProvider) {
  const response = await fetch(withAuthQuery(providerBase(provider), provider), { headers: headers(provider) });
  if ([404, 405, 501].includes(response.status)) return { ok: true, warning: 'Provider không hỗ trợ tự động lấy model. Bạn vẫn có thể nhập Model ID thủ công.' };
  if (!response.ok && ![404, 405, 501].includes(response.status)) await providerResponseError(response, provider, 'Kiểm tra kết nối provider thất bại.');
  return { ok: true };
}

function responseText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const item = part as { text?: unknown; content?: unknown };
    return typeof item.text === 'string' ? item.text : typeof item.content === 'string' ? item.content : '';
  }).join('');
}

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function tinyWav() {
  const sampleRate = 8000;
  const samples = sampleRate / 2;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

async function testChat(provider: AIProvider, model: string, messages: Array<{ role: 'user'; content: string | Array<Record<string, string>> }>, signal: AbortSignal, endpointKey: 'chat' | 'vision' = 'chat') {
  const response = await fetch(withAuthQuery(endpoint(provider, endpointKey, '/chat/completions'), provider), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(provider) }, signal, body: JSON.stringify({ model, messages, max_tokens: 16 }) });
  const data = await responseJson(response, provider, 'Model chat không phản hồi.');
  const choice = (Array.isArray(data.choices) ? data.choices[0] : undefined) as { message?: { content?: unknown }; text?: unknown } | undefined;
  const output = responseText(choice?.message?.content ?? choice?.text).trim();
  if (!output) throw new ProviderError('Model không trả về nội dung.', 502);
  return output;
}

export async function testModel(provider: AIProvider, model: string, capability: 'translation' | 'vision' | 'stt' | 'tts' = 'translation') {
  const providerCapability = capability === 'translation' ? 'chat' : capability;
  if (provider.capabilities?.[providerCapability] === false) throw new ProviderError(`Provider ${provider.name} không hỗ trợ capability ${providerCapability}.`, 400);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const started = Date.now();
  try {
    let output = '';
    if (capability === 'stt') {
      const result = await transcribe(provider, model, tinyWav(), 'autosub-test.wav', 'Auto Detect');
      output = result.text || (result.segments.length ? `${result.segments.length} segment(s)` : 'STT endpoint phản hồi nhưng không có text.');
    } else if (capability === 'vision') {
      output = await testChat(provider, model, [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK only.' }, { type: 'image_url', image_url: `data:image/png;base64,${tinyPng.toString('base64')}` }] }], controller.signal, 'vision');
    } else if (capability === 'tts') {
      const isGroq = resolveProviderType(provider) === 'groq';
      const audio = await synthesize(provider, model, isGroq ? 'troy' : 'alloy', isGroq ? 'This is a short Groq voice test.' : 'OK', { format: 'wav', signal: controller.signal });
      if (!audio.length) throw new ProviderError('TTS provider trả về audio rỗng.', 502);
      output = `${audio.length} bytes audio`;
    } else {
      output = await testChat(provider, model, [{ role: 'user', content: 'Reply with OK only.' }], controller.signal);
    }
    return { ok: true, model, capability, latencyMs: Date.now() - started, output: output.trim().slice(0, 120) };
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderError('Test model timeout sau 15 giây.', 504);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function chat(provider: AIProvider, model: string, messages: Array<{ role: 'system' | 'user'; content: string | Array<Record<string, string>> }>, signal?: AbortSignal) { const response = await fetch(withAuthQuery(endpoint(provider, 'chat', '/chat/completions'), provider), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(provider) }, signal, body: JSON.stringify({ model, messages, temperature: 0.2 }) }); const data = await responseJson(response, provider, 'Provider chat không phản hồi.'); const choices = Array.isArray(data.choices) ? data.choices : []; const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content; if (typeof content !== 'string') throw new ProviderError('Provider không trả về message content.'); return content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim(); }

export async function translateBatch(provider: AIProvider, model: string, items: TranslationItem[], sourceLanguage: string, targetLanguage: string, style: string, customPrompt: string, glossary: Array<{ source: string; target: string }>) { const glossaryText = glossary.length ? `\nGlossary:\n${glossary.map((entry) => `- ${entry.source} -> ${entry.target}`).join('\n')}` : ''; const system = `You translate subtitle batches for natural dubbing. Return ONLY valid JSON with shape {"items":[{"id":"...","translation":"..."}]}. Preserve every id exactly once, preserve item order, never add timestamps or commentary. Source: ${sourceLanguage}. Target: ${targetLanguage}. Style: ${style}. For every item, use its targetDurationMs as a speaking-time budget. Preserve meaning, but prefer concise natural spoken language; do not translate word-for-word, add ideas, or make a sentence longer than needed. Previous/next subtitle context is provided only to avoid repetition and preserve continuity.${customPrompt ? ` Custom instruction: ${customPrompt}.` : ''}${glossaryText}`; const content = await chat(provider, model, [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ items }) }]); let parsed: unknown; try { parsed = JSON.parse(content); } catch { throw new ProviderError('Translation provider trả về JSON không hợp lệ.'); } const output = (parsed as { items?: unknown }).items; if (!Array.isArray(output)) throw new ProviderError('Translation response thiếu items.'); const result = output.flatMap((item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { translation?: unknown }).translation === 'string' ? [{ id: (item as { id: string }).id, translation: (item as { translation: string }).translation }] : []); const expected = new Set(items.map((item) => item.id)); const seen = new Set<string>(); const partialItems = result.filter((item) => expected.has(item.id) && !seen.has(item.id) && seen.add(item.id)); const valid = result.length === items.length && result.every((item) => expected.has(item.id)) && seen.size === items.length; if (!valid) throw new TranslationValidationError('Translation response thiếu/trùng id. Chỉ retry các cue còn thiếu.', partialItems); return result; }

export async function transcribe(provider: AIProvider, model: string, audio: Buffer, filename: string, language: string) {
  const request = async (responseFormat: 'verbose_json' | 'json') => {
    const form = new FormData();
    form.append('file', new Blob([audio]), filename);
    form.append('model', model);
    if (language !== 'Auto Detect') form.append('language', language);
    form.append('response_format', responseFormat);
    const response = await fetch(withAuthQuery(endpoint(provider, 'stt', '/audio/transcriptions'), provider), { method: 'POST', headers: headers(provider), body: form });
    const data = await responseJson(response, provider, 'Provider STT không phản hồi.');
    return { text: typeof data.text === 'string' ? data.text : '', segments: (Array.isArray(data.segments) ? data.segments : []) as SubtitleSegment[] };
  };
  try {
    try {
      return await request('verbose_json');
    } catch (error) {
      if (error instanceof ProviderError && /response_format|verbose_json/i.test(error.message)) return request('json');
      throw error;
    }
  } catch (error) {
    if (error instanceof ProviderError && [404, 405, 415].includes(error.status)) {
      throw new ProviderError(`Provider ${provider.name} hoặc model ${model} không hỗ trợ endpoint STT /audio/transcriptions. Hãy chọn model có khả năng audio/STT.`, error.status);
    }
    throw error;
  }
}

export async function recognizeImage(provider: AIProvider, model: string, imagePath: string, prompt: string) { const buffer = await readFile(imagePath); const image = `data:image/jpeg;base64,${buffer.toString('base64')}`; const response = await fetch(withAuthQuery(endpoint(provider, 'vision', '/chat/completions'), provider), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(provider) }, body: JSON.stringify({ model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: image }] }], temperature: 0.1 }) }); const data = await responseJson(response, provider, 'Provider Vision không phản hồi.'); const choices = Array.isArray(data.choices) ? data.choices : []; const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content; if (typeof content !== 'string') throw new ProviderError('Provider không trả về nội dung Vision.'); return content.replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/, '').trim(); }

export async function synthesize(provider: AIProvider, model: string, voice: string, text: string, options: { speed?: number; format?: string; signal?: AbortSignal }) { if (!voice?.trim()) throw new ProviderError('Model TTS này yêu cầu chọn Voice.', 400); const response = await fetch(withAuthQuery(endpoint(provider, 'tts', '/audio/speech'), provider), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(provider) }, signal: options.signal, body: JSON.stringify({ model, voice, input: text, speed: options.speed || 1, response_format: options.format || 'wav' }) }); if (!response.ok) await providerResponseError(response, provider, 'Provider không hỗ trợ TTS.'); return Buffer.from(await response.arrayBuffer()); }
