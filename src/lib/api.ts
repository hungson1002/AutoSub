import type { AIModel, AIProvider, BlurRegion, Capability, DubbingJobStatus, DubbingMetadata, GlossaryEntry, LogoOverlay, SubtitleCue, SubtitleStyle } from '../types';
import { cuesToAss } from './subtitles';

export function buildRequestInit(init?: RequestInit): RequestInit {
  const hasBody = init?.body !== undefined && init.body !== null && init.body !== '';
  const headers = new Headers(init?.headers);
  if (hasBody) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  } else if (headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    headers.delete('Content-Type');
  }
  return { ...init, headers };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, buildRequestInit(init));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const genericFastifyError = data.error === 'Bad Request' || data.error === 'Internal Server Error'; const message = genericFastifyError && typeof data.message === 'string' ? data.message : data.error || data.message || `Request failed (${response.status})`; const error = new Error(message) as Error & { detail?: string; status?: number; code?: string }; error.detail = typeof data.detail === 'string' ? data.detail : undefined; error.status = response.status; error.code = typeof data.code === 'string' ? data.code : undefined; throw error; }
  return data as T;
}

const readError = async (response: Response, fallback: string) => {
  const data = await response.json().catch(() => ({}));
  const genericFastifyError = data.error === 'Bad Request' || data.error === 'Internal Server Error';
  const error = new Error(genericFastifyError && typeof data.message === 'string' ? data.message : data.error || data.message || fallback) as Error & { detail?: string; status?: number; code?: string };
  error.detail = typeof data.detail === 'string' ? data.detail : undefined;
  error.status = response.status;
  error.code = typeof data.code === 'string' ? data.code : undefined;
  throw error;
};

function decodeBase64Json<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return undefined;
  }
}

export const api = {
  system: () => request<{ ffmpeg: boolean; ffprobe: boolean; demucs: boolean; workdir: string }>('/api/system'),
  listModels: (provider: AIProvider, signal?: AbortSignal) => request<{ models: AIModel[]; warning?: string }>('/api/providers/models', { method: 'POST', body: JSON.stringify({ provider }), signal }),
  listVoices: (provider: AIProvider, signal?: AbortSignal) => request<{ voices: Array<{ id: string; name?: string; language?: string }> }>('/api/providers/voices', { method: 'POST', body: JSON.stringify({ provider }), signal }),
  testProvider: (provider: AIProvider) => request<{ ok: boolean; warning?: string }>('/api/providers/test', { method: 'POST', body: JSON.stringify({ provider }) }),
  testModel: (provider: AIProvider, model: string, signal?: AbortSignal, capability: Capability = 'translation') => request<{ ok: boolean; model: string; latencyMs: number; output: string }>('/api/providers/test-model', { method: 'POST', body: JSON.stringify({ provider, model, capability }), signal }),
  translate: (provider: AIProvider, model: string | undefined, cues: SubtitleCue[], sourceLanguage: string, targetLanguage: string, style: string, customPrompt: string, glossary: GlossaryEntry[], signal?: AbortSignal) => request<{ items: Array<{ id: string; translation: string }> }>('/api/translate', { method: 'POST', body: JSON.stringify({ provider, model, items: cues.map((cue, index) => { const nextCue = cues[index + 1]; const durationMs = Math.max(cue.endMs - cue.startMs, 50); const safeGapAfter = nextCue ? Math.max(0, nextCue.startMs - cue.endMs - 80) : Number.POSITIVE_INFINITY; const extensionMs = Math.round(Math.min(durationMs * 0.15, 400, safeGapAfter)); return { id: cue.id, text: cue.originalText, durationMs, targetDurationMs: durationMs + extensionMs, previousText: cues[index - 1]?.originalText || '', nextText: nextCue?.originalText || '' }; }), sourceLanguage, targetLanguage, style, customPrompt, glossary }), signal }),
  extractStt: async (file: File, provider: AIProvider, model: string, language: string, signal?: AbortSignal) => { const form = new FormData(); form.append('provider', JSON.stringify(provider)); form.append('model', model); form.append('language', language); form.append('file', file); const response = await fetch('/api/extract/stt', { method: 'POST', body: form, signal }); if (!response.ok) await readError(response, 'Không thể trích xuất từ âm thanh.'); return response.json() as Promise<{ cues: SubtitleCue[]; audioName: string }>; },
  extractOcr: async (file: File, provider: AIProvider, model: string, roi: { x: number; y: number; w: number; h: number }, samplingFps: number, filterWatermark: boolean, signal?: AbortSignal) => { const form = new FormData(); form.append('provider', JSON.stringify(provider)); form.append('model', model); form.append('roi', JSON.stringify(roi)); form.append('samplingFps', String(samplingFps)); form.append('filterWatermark', String(filterWatermark)); form.append('file', file); const response = await fetch('/api/extract/ocr', { method: 'POST', body: form, signal }); if (!response.ok) await readError(response, 'Không thể OCR video.'); return response.json() as Promise<{ cues: SubtitleCue[] }>; },
  generateDubTrack: async (cues: Array<{ id: string; startMs: number; endMs: number; originalText: string; translatedText: string; text: string; previousText: string; nextText: string; provider: AIProvider; model: string; voice: string; speed: number; volume: number }>, signal?: AbortSignal) => { const created = await request<{ jobId: string }>('/api/dubbing/jobs', { method: 'POST', body: JSON.stringify({ cues, timingMode: 'natural' }), signal }); await request(`/api/dubbing/jobs/${encodeURIComponent(created.jobId)}/start`, { method: 'POST', signal }); return { blob: new Blob(), warnings: [`Dubbing job ${created.jobId} đang chạy.`], metadata: [] as DubbingMetadata[] }; },
  createDubbingJob: async (cues: Array<{ id: string; index?: number; startMs: number; endMs: number; originalText: string; translatedText: string; text: string; previousText: string; nextText: string; provider: AIProvider; model: string; voice: string; speed: number; volume: number }>, options?: { timingMode?: 'natural' | 'strict'; batchSize?: number; ttsConcurrency?: number; llmConcurrency?: number; maxRetries?: number; audioMix?: { keepOriginal: boolean; originalVolume: number }; rewrite?: { provider: AIProvider; model: string } }, signal?: AbortSignal) => request<{ jobId: string; status: string; totalCues: number }>('/api/dubbing/jobs', { method: 'POST', body: JSON.stringify({ cues, ...options }), signal }),
  startDubbingJob: (id: string, signal?: AbortSignal) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/start`, { method: 'POST', signal }),
  getDubbingJobStatus: (id: string, signal?: AbortSignal) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/status`, { signal }),
  pauseDubbingJob: (id: string) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeDubbingJob: (id: string) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  cancelDubbingJob: (id: string) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  retryFailedDubbingJob: (id: string) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/retry-failed`, { method: 'POST' }),
  getDubbingResult: (id: string) => request<{ job: DubbingJobStatus; metadata: Array<{ cueId: string; originalText: string; translatedText: string; finalDubbingText: string; originalDurationMs: number; targetDurationMs: number; ttsDurationMs: number; finalAudioDurationMs: number; rewriteAttempts: number; speedApplied: number; extensionMs: number; warning?: string }>; audioUrl: string }>(`/api/dubbing/jobs/${encodeURIComponent(id)}/result`),
  downloadDubbingAudio: async (id: string) => { const response = await fetch(`/api/dubbing/jobs/${encodeURIComponent(id)}/result/audio`); if (!response.ok) await readError(response, 'Không thể tải dub track.'); return response.blob(); },
  testVoice: async (provider: AIProvider, model: string, voice: string, speed: number, text = 'Đây là bản thử giọng đọc của AutoSub.') => { const response = await fetch('/api/dubbing/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model, voice, speed, text }) }); if (!response.ok) await readError(response, 'Không thể test voice.'); return response.blob(); },
  exportVideo: async (file: File, cues: SubtitleCue[], style: SubtitleStyle, options: { exportId: string; resolution: 'original' | '1080' | '720'; crf: number; keepAudio: boolean; originalVolume: number; burnSubtitles: boolean; separateVocals: boolean; blurRegions?: BlurRegion[]; logo?: LogoOverlay; dubTrack?: Blob; dubbingJobId?: string; fontFile?: File }, signal?: AbortSignal) => { const form = new FormData(); form.append('exportId', options.exportId); form.append('file', file); form.append('ass', cuesToAss(cues, style)); form.append('options', JSON.stringify({ resolution: options.resolution, crf: options.crf, keepAudio: options.keepAudio, originalVolume: options.originalVolume, burnSubtitles: options.burnSubtitles, separateVocals: options.separateVocals, blurRegions: options.blurRegions || [], dubbingJobId: options.dubbingJobId, logo: options.logo ? { xPercent: options.logo.xPercent, yPercent: options.logo.yPercent, widthPercent: options.logo.widthPercent, opacity: options.logo.opacity } : undefined })); if (options.dubTrack) form.append('dubTrack', options.dubTrack, 'dub-track.wav'); if (options.fontFile) form.append('fontFile', options.fontFile, options.fontFile.name); if (options.logo?.file) form.append('logoFile', options.logo.file, options.logo.file.name); const response = await fetch('/api/export/video', { method: 'POST', body: form, signal }); if (!response.ok) await readError(response, 'Không thể xuất video.'); return response.blob(); },
  getExportProgress: (id: string, signal?: AbortSignal) => request<{ percent: number; stage: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; error?: string }>(`/api/export/progress/${encodeURIComponent(id)}`, { signal }),
};
