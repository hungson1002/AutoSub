import type { AIModel, AIVoice, AIProvider } from '../types';
import { runCapCutBridge } from '../services/capcutTtsBridge';
import { assertPlayableAudio } from './capabilityTestMedia';
import { ProviderError } from './errors';

export const CAPCUT_TTS_MODEL = 'capcut-tts';

/**
 * The unofficial bridge has to preserve CapCut's response text for diagnosis,
 * but that payload is not useful in the editor.  In particular, `TTSInvalidText`
 * is a permanent validation failure, not a retryable upstream/server failure.
 */
export function capCutTtsFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'CapCut TTS thất bại.');
  if (/TTSInvalidText|err_code['"]?\s*[:=]\s*['"]?40402002/i.test(message)) {
    return new ProviderError(
      'CapCut không đọc được nội dung của cue này. Hãy kiểm tra ký tự đặc biệt, emoji hoặc tạo lại voice cho riêng cue đó.',
      422,
      message,
    );
  }
  return error instanceof ProviderError ? error : new ProviderError('CapCut TTS không thể tạo audio cho cue này. Hãy thử lại sau.', 502, message);
}

// The unofficial CapCut endpoint is not safe to drive concurrently. A long
// dubbing job otherwise gets intermittent, valid-looking but wrong audio
// responses. Keep the bridge process/request lifecycle strictly ordered even
// when a caller asks the job runner for more than one TTS worker.
let capcutQueue: Promise<void> = Promise.resolve();

function waitForTurn(previous: Promise<void>, signal?: AbortSignal) {
  if (!signal) return previous;
  if (signal.aborted) return Promise.reject(new Error('CapCut TTS đã bị hủy.'));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(new Error('CapCut TTS đã bị hủy.')));
    signal.addEventListener('abort', onAbort, { once: true });
    void previous.then(() => finish(resolve), () => finish(resolve));
  });
}

async function withCapCutQueue<T>(task: () => Promise<T>, signal?: AbortSignal) {
  const previous = capcutQueue;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  // `current` is resolved only after this request finishes. This also keeps
  // the queue intact when the caller aborts while waiting for its turn.
  capcutQueue = previous.then(() => current);
  let started = false;
  try {
    await waitForTurn(previous, signal);
    started = true;
    return await task();
  } finally {
    if (started || !signal?.aborted) release();
    else void previous.then(release, release);
  }
}

export function capcutVoiceResourceId(provider: AIProvider, voice: string) {
  return provider.voices?.find((item) => item.id === voice.trim())?.resourceId;
}

export async function listModels(_provider: AIProvider): Promise<AIModel[]> {
  return [{ id: CAPCUT_TTS_MODEL, name: 'CapCut TTS', capabilities: { tts: true } }];
}

export async function listVoices(_provider: AIProvider): Promise<AIVoice[]> {
  const response = await runCapCutBridge({ op: 'voices' });
  const voices = Array.isArray(response.voices) ? response.voices : [];
  return voices.flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') return [];
    const value = item as { id: string; name?: unknown; language?: unknown; resourceId?: unknown };
    return [{ id: value.id, name: typeof value.name === 'string' ? value.name : value.id, language: typeof value.language === 'string' ? value.language : undefined, resourceId: typeof value.resourceId === 'string' ? value.resourceId : undefined }];
  });
}

export async function testConnection(_provider: AIProvider) {
  const response = await runCapCutBridge({ op: 'health' });
  return { ok: true, warning: `CapCut TTS bridge sẵn sàng · ${String(response.voiceCount || 0)} voice.` };
}

export async function synthesize(provider: AIProvider, _model: string, voice: string, text: string, options: { speed?: number; signal?: AbortSignal }) {
  if (!voice?.trim()) throw new ProviderError('CapCut TTS cần chọn Voice ID.', 400);
  const resourceId = capcutVoiceResourceId(provider, voice);
  let response;
  try {
    response = await withCapCutQueue(
      () => runCapCutBridge({ op: 'synthesize', voice: voice.trim(), ...(resourceId ? { resourceId } : {}), text, rate: options.speed || 1 }, options.signal),
      options.signal,
    );
  } catch (error) {
    throw capCutTtsFailure(error);
  }
  if (typeof response.audioBase64 !== 'string') throw new ProviderError('CapCut TTS không trả về audio.', 502);
  return Buffer.from(response.audioBase64, 'base64');
}

export async function testModel(provider: AIProvider, model: string) {
  const voices = provider.voices?.length ? provider.voices : await listVoices(provider);
  const voice = voices[0]?.id;
  if (!voice) throw new ProviderError('CapCut TTS chưa có voice cache. Hãy tải danh sách voice trước.', 400);
  const startedAt = Date.now();
  const audio = await synthesize(provider, model, voice, 'Xin chào, đây là bản test CapCut TTS của AutoSub.', {});
  assertPlayableAudio(audio);
  return { ok: true, model, capability: 'tts', latencyMs: Date.now() - startedAt, output: `${audio.length} bytes audio · ${voices[0]?.name || voice}` };
}
