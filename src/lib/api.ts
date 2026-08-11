import type { AIModel, AIProvider, BlurRegion, Capability, DubbingJobStatus, DubbingMetadata, GlossaryEntry, LogoOverlay, SubtitleCue, SubtitleStyle } from '../types';
import { cuesToAss } from './subtitles';

// Large media bypasses Vite's development proxy. JSON requests remain relative.
const MEDIA_BACKEND_ORIGIN = 'http://127.0.0.1:8787';
export const MAX_BROWSER_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

export type StoredMediaResult = { uploadId: string; storedPath: string; filename: string; contentType: string; size: number; sourceMode?: 'copied' | 'linked' };

type ApiError = Error & { detail?: string; status?: number; code?: string };

const quotaErrorPattern = /usage[_ -]?exceeded|insufficient[_ -]?quota|quota.{0,24}(exceed|exhaust|limit|empty)|(?:credit|credits).{0,24}(exhaust|used|limit|insufficient)|billing|monthly limit|plan limit/i;
const rateLimitPattern = /rate[ -]?limit|too many requests|throttl/i;

export function friendlyErrorMessage(error: unknown, fallback = 'Đã xảy ra lỗi. Vui lòng thử lại.') {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Đã hủy thao tác.';
  const typed = error as Partial<ApiError> | undefined;
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!raw) return fallback;
  const status = typeof typed?.status === 'number' ? typed.status : undefined;
  const lower = raw.toLowerCase();
  if (/spawn ffprobe enoent|không tìm thấy ffprobe/i.test(raw)) return 'Máy chưa tìm thấy FFprobe nên không thể đọc thời lượng video để xuất file. Hãy cài hoặc khôi phục FFmpeg rồi chạy lại AutoSub.';
  if (/spawn ffmpeg enoent|không tìm thấy ffmpeg/i.test(raw)) return 'Máy chưa tìm thấy FFmpeg nên không thể render video. Hãy cài hoặc khôi phục FFmpeg rồi chạy lại AutoSub.';

  if (quotaErrorPattern.test(raw)) return 'Provider đã hết hạn mức sử dụng (quota/credit). Hãy đổi provider, kiểm tra API key hoặc chờ quota được reset.';
  if (status === 401 || /unauthorized|invalid.*(?:api[ -_]?key|token)|api[ -_]?key.{0,20}(invalid|expired|missing)/i.test(raw)) return 'API key không hợp lệ hoặc đã hết hạn. Hãy kiểm tra lại API key trong Cài đặt.';
  if (status === 403 || /forbidden|permission denied|not allowed/i.test(raw)) return 'API key không có quyền dùng model hoặc endpoint này.';
  if (status === 404 || /not found|unknown model|unsupported endpoint/i.test(raw)) return 'Không tìm thấy endpoint hoặc model. Hãy kiểm tra Base URL và model trong Cài đặt.';
  if (/requires? .*voice|voice id|missing provider, model, voice|needs a provider and model/i.test(raw)) return 'Cấu hình TTS còn thiếu Provider, Model hoặc Voice ID. Hãy kiểm tra lại trong Cài đặt.';
  if (/not completed|not ready|is not completed yet/i.test(raw)) return 'Tác vụ chưa hoàn tất. Hãy chờ xử lý xong rồi thử lại.';
  if (status === 413 || /request entity too large|payload too large|upload too large/i.test(raw)) return 'Dữ liệu gửi lên quá lớn. Với STT, hãy kiểm tra giới hạn audio của provider.';
  if (status === 429 || rateLimitPattern.test(raw)) return 'Provider đang giới hạn tần suất request. Hãy chờ một chút rồi thử lại hoặc giảm số request đồng thời.';
  if (status !== undefined && status >= 500 || /fetch failed|network error|network request|timeout|timed out|econn|socket hang up/i.test(lower)) return 'Provider hoặc máy chủ đang không phản hồi. Hãy kiểm tra mạng/Base URL rồi thử lại.';
  return raw;
}

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
  if (!response.ok) { const genericFastifyError = data.error === 'Bad Request' || data.error === 'Internal Server Error'; const rawMessage = genericFastifyError && typeof data.message === 'string' ? data.message : data.error || data.message || `Request failed (${response.status})`; const error = new Error(friendlyErrorMessage(Object.assign(new Error(String(rawMessage)), { status: response.status }), `Request thất bại (${response.status}).`)) as ApiError; error.detail = typeof data.detail === 'string' ? data.detail : undefined; error.status = response.status; error.code = typeof data.code === 'string' ? data.code : undefined; throw error; }
  return data as T;
}

const readError = async (response: Response, fallback: string) => {
  const data = await response.json().catch(() => ({}));
  const genericFastifyError = data.error === 'Bad Request' || data.error === 'Internal Server Error';
  const rawMessage = genericFastifyError && typeof data.message === 'string' ? data.message : data.error || data.message || fallback;
  const error = new Error(friendlyErrorMessage(Object.assign(new Error(String(rawMessage)), { status: response.status }), fallback)) as ApiError;
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
  cleanupTemporaryFiles: () => request<{ removedFiles: number; removedDirectories: number; freedBytes: number; skippedActiveJobs: number; skippedRecentFiles: number }>('/api/system/cleanup', { method: 'POST', body: '{}' }),
  listModels: (provider: AIProvider, signal?: AbortSignal) => request<{ models: AIModel[]; warning?: string }>('/api/providers/models', { method: 'POST', body: JSON.stringify({ provider }), signal }),
  listVoices: (provider: AIProvider, signal?: AbortSignal) => request<{ voices: Array<{ id: string; name?: string; language?: string }> }>('/api/providers/voices', { method: 'POST', body: JSON.stringify({ provider }), signal }),
  testProvider: (provider: AIProvider) => request<{ ok: boolean; warning?: string }>('/api/providers/test', { method: 'POST', body: JSON.stringify({ provider }) }),
  testModel: (provider: AIProvider, model: string, signal?: AbortSignal, capability: Capability = 'translation') => request<{ ok: boolean; model: string; latencyMs: number; output: string }>('/api/providers/test-model', { method: 'POST', body: JSON.stringify({ provider, model, capability }), signal }),
  translate: (provider: AIProvider, model: string | undefined, cues: SubtitleCue[], sourceLanguage: string, targetLanguage: string, style: string, customPrompt: string, glossary: GlossaryEntry[], signal?: AbortSignal) => request<{ items: Array<{ id: string; translation: string }> }>('/api/translate', { method: 'POST', body: JSON.stringify({ provider, model, items: cues.map((cue) => { const durationMs = Math.max(cue.endMs - cue.startMs, 50); return { id: cue.id, text: cue.originalText, durationMs, targetDurationMs: durationMs }; }), sourceLanguage, targetLanguage, style, customPrompt, glossary }), signal }),
  uploadMedia: async (file: File, signal?: AbortSignal) => { const form = new FormData(); form.append('file', file); const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/uploads`, { method: 'POST', body: form, signal }); if (!response.ok) await readError(response, 'Không thể lưu file lên máy.'); return response.json() as Promise<StoredMediaResult>; },
  importLocalMedia: async (kind: 'video' | 'audio' | 'media', signal?: AbortSignal) => { const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/uploads/import-local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }), signal }); if (!response.ok) await readError(response, 'Không thể mở file local.'); return response.json() as Promise<StoredMediaResult | { cancelled: true }>; },
  deleteUpload: async (uploadId: string) => { const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }); if (!response.ok && response.status !== 404) await readError(response, 'Không thể dọn file tạm.'); },
  extractStt: async (uploadId: string, provider: AIProvider, model: string, language: string, signal?: AbortSignal) => request<{ cues: SubtitleCue[]; audioName: string; uploadId: string; timestampRefinement?: { enabled: boolean; method: string; alignmentMethod?: string; alignmentConfidence?: number; timestampSource?: string; refinedCount: number; fallbackCount: number; analysisMs: number; speechRegions?: Array<{ startMs: number; endMs: number }>; }; textAudioAlignment?: { entries: Array<{ text: string; providerStartMs: number; providerEndMs: number; alignedStartMs: number; alignedEndMs: number; confidence: number; alignmentMethod: string; timestampSource: string }>; metadata: { alignmentMethod: string; alignmentConfidence: number; timestampSource: string } } }>('/api/extract/stt', { method: 'POST', body: JSON.stringify({ uploadId, provider, model, language }), signal }),
  extractOcr: async (uploadId: string, provider: AIProvider, model: string, roi: { x: number; y: number; w: number; h: number }, samplingFps: number, filterWatermark: boolean, signal?: AbortSignal, progressId?: string) => request<{ cues: SubtitleCue[]; uploadId: string }>('/api/extract/ocr', { method: 'POST', body: JSON.stringify({ uploadId, provider, model, roi, samplingFps, filterWatermark, progressId }), signal }),
  getExtractionProgress: (progressId: string, signal?: AbortSignal) => request<{ percent: number; stage: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; processed?: number; total?: number; error?: string }>(`/api/extract/progress/${encodeURIComponent(progressId)}`, { signal }),
  generateDubTrack: async (cues: Array<{ id: string; startMs: number; endMs: number; originalText: string; translatedText: string; text: string; previousText: string; nextText: string; provider: AIProvider; model: string; voice: string; speed: number; volume: number }>, signal?: AbortSignal) => { const created = await request<{ jobId: string }>('/api/dubbing/jobs', { method: 'POST', body: JSON.stringify({ cues, timingMode: 'natural' }), signal }); await request(`/api/dubbing/jobs/${encodeURIComponent(created.jobId)}/start`, { method: 'POST', signal }); return { blob: new Blob(), warnings: [`Dubbing job ${created.jobId} đang chạy.`], metadata: [] as DubbingMetadata[] }; },
  createDubbingJob: async (cues: Array<{ id: string; index?: number; startMs: number; endMs: number; originalText: string; translatedText: string; text: string; previousText: string; nextText: string; provider: AIProvider; model: string; voice: string; speed: number; volume: number }>, options?: { videoId?: string; timingMode?: 'natural' | 'strict'; batchSize?: number; ttsConcurrency?: number; llmConcurrency?: number; maxRetries?: number; audioMix?: { mode: import('../types').OriginalAudioMode; keepOriginal: boolean; originalVolume: number; separateVocals?: boolean }; rewrite?: { provider: AIProvider; model: string } }, signal?: AbortSignal) => request<{ jobId: string; status: string; totalCues: number }>('/api/dubbing/jobs', { method: 'POST', body: JSON.stringify({ cues, ...options }), signal }),
  startDubbingJob: (id: string, signal?: AbortSignal) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/start`, { method: 'POST', signal }),
  getDubbingJobStatus: (id: string, signal?: AbortSignal) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/status`, { signal }),
  getLatestDubbingJobForVideo: (videoId: string, signal?: AbortSignal) => request<{ job?: DubbingJobStatus }>(`/api/dubbing/jobs/latest-for-video?videoId=${encodeURIComponent(videoId)}`, { signal }),
  pauseDubbingJob: (id: string) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeDubbingJob: (id: string) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  cancelDubbingJob: (id: string) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  retryFailedDubbingJob: (id: string) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/retry-failed`, { method: 'POST' }),
  regenerateDubbingCue: (id: string, cue: Pick<SubtitleCue, 'id' | 'startMs' | 'endMs' | 'originalText' | 'translatedText'> & { text: string; previousText?: string; nextText?: string }) => request<DubbingJobStatus>(`/api/dubbing/jobs/${encodeURIComponent(id)}/cues/${encodeURIComponent(cue.id)}/regenerate`, { method: 'POST', body: JSON.stringify({ startMs: cue.startMs, endMs: cue.endMs, originalText: cue.originalText, translatedText: cue.translatedText, text: cue.text, previousText: cue.previousText || '', nextText: cue.nextText || '' }) }),
  getDubbingResult: (id: string) => request<{ job: DubbingJobStatus; metadata: DubbingMetadata[]; audioUrl: string }>(`/api/dubbing/jobs/${encodeURIComponent(id)}/result`),
  downloadDubbingAudio: async (id: string) => { const response = await fetch(`/api/dubbing/jobs/${encodeURIComponent(id)}/result/audio`); if (!response.ok) await readError(response, 'Không thể tải dub track.'); return response.blob(); },
  testVoice: async (provider: AIProvider, model: string, voice: string, speed: number, text = 'Đây là bản thử giọng đọc của AutoSub.') => { const response = await fetch('/api/dubbing/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model, voice, speed, text }) }); if (!response.ok) await readError(response, 'Không thể test voice.'); return response.blob(); },
  // Rendering a video can take minutes. Bypass Vite's dev proxy for this
  // long-lived media request so the proxy cannot reset the socket mid-render.
  exportVideo: async (file: File | undefined, cues: SubtitleCue[], style: SubtitleStyle, options: { exportId: string; uploadId?: string; resolution: 'original' | '1080' | '720'; crf: number; keepAudio: boolean; originalVolume: number; burnSubtitles: boolean; separateVocals: boolean; blurRegions?: BlurRegion[]; logo?: LogoOverlay; dubTrack?: Blob; dubbingJobId?: string; fontFile?: File; videoEdit?: import('../types').VideoEditState }, signal?: AbortSignal) => { const form = new FormData(); form.append('exportId', options.exportId); if (options.uploadId) form.append('uploadId', options.uploadId); else if (file) form.append('file', file); else throw new Error('Video chưa được upload lên máy.'); form.append('ass', cuesToAss(cues, style)); form.append('options', JSON.stringify({ resolution: options.resolution, crf: options.crf, keepAudio: options.keepAudio, originalVolume: options.originalVolume, burnSubtitles: options.burnSubtitles, separateVocals: options.separateVocals, blurRegions: options.blurRegions || [], dubbingJobId: options.dubbingJobId, videoEdit: options.videoEdit, logo: options.logo ? { xPercent: options.logo.xPercent, yPercent: options.logo.yPercent, widthPercent: options.logo.widthPercent, opacity: options.logo.opacity } : undefined })); if (options.dubTrack && !options.dubbingJobId) form.append('dubTrack', options.dubTrack, 'dub-track.wav'); if (options.fontFile) form.append('fontFile', options.fontFile, options.fontFile.name); if (options.logo?.file) form.append('logoFile', options.logo.file, options.logo.file.name); const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/export/video`, { method: 'POST', body: form, signal }); if (!response.ok) await readError(response, 'Không thể xuất video.'); return response.blob(); },
  exportAudio: async (options: { uploadId?: string; dubbingJobId?: string; trimStartMs?: number; trimEndMs?: number }, signal?: AbortSignal) => { const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/export/audio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options), signal }); if (!response.ok) await readError(response, 'Không thể xuất audio.'); return response.blob(); },
  getExportProgress: (id: string, signal?: AbortSignal) => request<{ percent: number; stage: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; error?: string }>(`/api/export/progress/${encodeURIComponent(id)}`, { signal }),
};
