import { deleteStorageInBatches, type StorageDeleteResult } from './storageDeletion';
import type {
  AIModel,
  AiVideoScene,
  AiVideoJobStatus,
  AIProvider,
  AIVoice,
  BlurRegion,
  Capability,
  DouyinBatchJob,
  DubbingJobStatus,
  DubbingMetadata,
  GlossaryEntry,
  LogoOverlay,
  ProductAdJobStatus,
  ProductAdOutputMode,
  ProductAdPlatform,
  ReviewAspectRatio,
  ReviewJobStatus,
  SubtitleCue,
  SubtitleStyle,
  VoiceCloneProfile,
  FilmVideoModel,
} from "../types";
import { cuesToAss } from "./subtitles";
import type { AnimationAsset, AnimationProject } from "../../shared/animationStudio";
import type { CanvasStudioProject } from "../../shared/canvasAnimationStudio";

// Large media bypasses Vite's development proxy. JSON requests remain relative.
const MEDIA_BACKEND_ORIGIN = "http://127.0.0.1:8787";
export const MAX_BROWSER_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

export interface BackgroundExportJob {
  id: string;
  kind: 'video-export' | 'animation-render';
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
export const backgroundExportVideoUrl = (job: BackgroundExportJob) => `${MEDIA_BACKEND_ORIGIN}${job.kind === 'video-export' ? `/api/export/result/${encodeURIComponent(job.id)}` : `/api/animation-studio/render-jobs/${encodeURIComponent(job.id)}/video`}`;

export async function animationProjectRenderCacheKey(project: AnimationProject, showSubtitles: boolean) {
  const renderState = { ...project, createdAt: "", updatedAt: "", assets: project.assets.map((asset) => ({ ...asset, createdAt: "" })), showSubtitles, engine: "hybrid-remotion-v2" };
  const encoded = new TextEncoder().encode(JSON.stringify(renderState));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function dataUrlToBlob(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Logo image could not be read.");
  return response.blob();
}

export interface TranslationMemoryItem {
  source: string;
  translation: string;
}
type AnimationAssetGeneration = { provider?: AIProvider; model?: string; generator?: 'flow-agent'; referenceUploadId?: string; referenceAssetId?: string; referenceUploadIds?: string[]; supportingCastReferenceUploadIds?: string[]; characterAppearanceLock?: string };
export interface AnimationDirectorJobStatus { id: string; projectId: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'; stage: string; error?: string; hasResult?: boolean; progressPercent?: number; progressLabel?: string; progressCurrent?: number; progressTotal?: number }
export interface AnimationDirectorInput { brief: string; project: AnimationProject; provider: AIProvider; model: string; targetDurationSeconds?: number; narration?: { provider: AIProvider; model: string; voice: string; speed?: number }; assetGeneration?: AnimationAssetGeneration }
export interface AnimationProjectSummary { id: string; name: string; width: number; height: number; fps: number; sceneCount: number; createdAt: string; updatedAt: string }
export function buildTranslationMemory(cues: SubtitleCue[], cueId: string, limit = 24): TranslationMemoryItem[] {
  const cueIndex = cues.findIndex((cue) => cue.id === cueId);
  const previous = cues
    .slice(0, cueIndex < 0 ? cues.length : cueIndex)
    .filter((cue) => cue.translatedText.trim());
  const anchors = previous.slice(0, Math.min(8, limit));
  const recent = limit > anchors.length ? previous.slice(-(limit - anchors.length)) : [];
  const seen = new Set<string>();
  return [...anchors, ...recent].flatMap((cue) => {
    if (seen.has(cue.id)) return [];
    seen.add(cue.id);
    return [{ source: cue.originalText, translation: cue.translatedText.trim() }];
  });
}
export const reviewVideoUrl = (jobId: string, download = false) =>
  `${MEDIA_BACKEND_ORIGIN}/api/review/jobs/${encodeURIComponent(jobId)}/video${download ? "?download=1" : ""}`;
export const reviewSubtitleUrl = (jobId: string) =>
  `${MEDIA_BACKEND_ORIGIN}/api/review/jobs/${encodeURIComponent(jobId)}/subtitles.srt`;
export const productAdVideoUrl = (jobId: string, download = false) =>
  `${MEDIA_BACKEND_ORIGIN}/api/product-ads/jobs/${encodeURIComponent(jobId)}/video${download ? "?download=1" : ""}`;
export const productAdSubtitleUrl = (jobId: string) =>
  `${MEDIA_BACKEND_ORIGIN}/api/product-ads/jobs/${encodeURIComponent(jobId)}/subtitles.srt`;
export const aiVideoUrl = (jobId: string, download = false) => `${MEDIA_BACKEND_ORIGIN}/api/ai-video/jobs/${encodeURIComponent(jobId)}/video${download ? '?download=1' : ''}`;
export const aiVideoCharacterSheetUrl = (jobId: string, characterIndex?: number) => `${MEDIA_BACKEND_ORIGIN}/api/ai-video/jobs/${encodeURIComponent(jobId)}/preproduction/character-sheet${characterIndex ? `?character=${characterIndex}` : ''}`;
export const aiVideoStoryboardUrl = (jobId: string, sceneIndex: number) => `${MEDIA_BACKEND_ORIGIN}/api/ai-video/jobs/${encodeURIComponent(jobId)}/preproduction/storyboard?scene=${sceneIndex}`;
export const aiVideoClipUrl = (jobId: string, sceneIndex: number, download = false, candidate?: 'last') => {
  const query = [download ? 'download=1' : '', candidate ? 'candidate=last' : ''].filter(Boolean).join('&');
  return `${MEDIA_BACKEND_ORIGIN}/api/ai-video/jobs/${encodeURIComponent(jobId)}/clips/${sceneIndex}${query ? `?${query}` : ''}`;
};
export const animationAssetUrl = (uploadId: string) => `${MEDIA_BACKEND_ORIGIN}/api/uploads/${encodeURIComponent(uploadId)}/media`;

export type StoredMediaResult = {
  uploadId: string;
  storedPath: string;
  filename: string;
  contentType: string;
  size: number;
  sourceMode?: "copied" | "linked";
};

export interface StorageItem {
  id: string;
  categoryId: string;
  name: string;
  displayName: string;
  detail: string;
  sizeBytes: number;
  fileCount: number;
  modifiedAt: string;
  status?: string;
  canDelete: boolean;
  deleteBlockedReason?: string;
}

export interface StorageSnapshot {
  workdir: string;
  totalBytes: number;
  managedBytes: number;
  otherBytes: number;
  itemCount: number;
  scannedAt: string;
  categories: Array<{ id: string; label: string; description: string; sizeBytes: number; items: StorageItem[] }>;
}

type ApiError = Error & { detail?: string; status?: number; code?: string; context?: "export" };

const quotaErrorPattern =
  /usage[_ -]?exceeded|insufficient[_ -]?quota|quota.{0,24}(exceed|exhaust|limit|empty)|(?:credit|credits).{0,24}(exhaust|used|limit|insufficient)|billing|monthly limit|plan limit/i;
const rateLimitPattern = /rate[ -]?limit|too many requests|throttl/i;

export function friendlyErrorMessage(
  error: unknown,
  fallback = "Đã xảy ra lỗi. Vui lòng thử lại.",
) {
  if (error instanceof DOMException && error.name === "AbortError")
    return "Đã hủy thao tác.";
  const typed = error as Partial<ApiError> | undefined;
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!raw) return fallback;
  // Local render failures are not provider errors (even with HTTP 500).
  if (typed?.context === "export") return raw;
  const status = typeof typed?.status === "number" ? typed.status : undefined;
  const lower = raw.toLowerCase();
  if (/google flow|flow client|recaptcha/i.test(raw)) return raw;
  if (/không thể kết nối provider viết kịch bản/i.test(raw)) return raw;
  if (/spawn ffprobe enoent|không tìm thấy ffprobe/i.test(raw))
    return "Máy chưa tìm thấy FFprobe nên không thể đọc thời lượng video để xuất file. Hãy cài hoặc khôi phục FFmpeg rồi chạy lại AutoSub.";
  if (/spawn ffmpeg enoent|không tìm thấy ffmpeg/i.test(raw))
    return "Máy chưa tìm thấy FFmpeg nên không thể render video. Hãy cài hoặc khôi phục FFmpeg rồi chạy lại AutoSub.";
  if (
    /whisper local|whisper\.cpp|autosub_whisper|funasr|paraformer|sensevoice|autosub_funasr|qwen3-asr|qwen3 forcedaligner|autosub_qwen3|edge tts|requirements-edge-tts|vieneu|kaldi-native-fbank|autosub_vieneu|zerotts|autosub_zerotts/i.test(
      raw,
    )
  )
    return raw;

  if (quotaErrorPattern.test(raw))
    return "Provider đã hết hạn mức sử dụng (quota/credit). Hãy đổi provider, kiểm tra API key hoặc chờ quota được reset.";
  if (
    status === 401 ||
    /unauthorized|invalid.*(?:api[ -_]?key|token)|api[ -_]?key.{0,20}(invalid|expired|missing)/i.test(
      raw,
    )
  )
    return "API key không hợp lệ hoặc đã hết hạn. Hãy kiểm tra lại API key trong Cài đặt.";
  if (status === 403 || /forbidden|permission denied|not allowed/i.test(raw))
    return "API key không có quyền dùng model hoặc endpoint này.";
  if (
    status === 404 ||
    /unknown model|model.{0,30}not found|endpoint.{0,30}(not found|unsupported)|unsupported endpoint/i.test(raw)
  )
    return "Không tìm thấy endpoint hoặc model. Hãy kiểm tra Base URL và model trong Cài đặt.";
  if (
    /requires? .*voice|voice id|missing provider, model, voice|needs a provider and model/i.test(
      raw,
    )
  )
    return "Cấu hình TTS còn thiếu Provider, Model hoặc Voice ID. Hãy kiểm tra lại trong Cài đặt.";
  if (/not completed|not ready|is not completed yet/i.test(raw))
    return "Tác vụ chưa hoàn tất. Hãy chờ xử lý xong rồi thử lại.";
  if (
    status === 413 ||
    /request entity too large|payload too large|upload too large/i.test(raw)
  )
    return "Dữ liệu gửi lên quá lớn. Với STT, hãy kiểm tra giới hạn audio của provider.";
  if (status === 429 || rateLimitPattern.test(raw))
    return "Provider đang giới hạn tần suất request. Hãy chờ một chút rồi thử lại hoặc giảm số request đồng thời.";
  if (
    (status !== undefined && status >= 500) ||
    /fetch failed|network error|network request|timeout|timed out|econn|socket hang up/i.test(
      lower,
    )
  )
    return "Provider hoặc máy chủ đang không phản hồi. Hãy kiểm tra mạng/Base URL rồi thử lại.";
  return raw;
}

export function buildRequestInit(init?: RequestInit): RequestInit {
  const hasBody =
    init?.body !== undefined && init.body !== null && init.body !== "";
  const headers = new Headers(init?.headers);
  if (hasBody) {
    if (!headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
  } else if (
    headers.get("Content-Type")?.toLowerCase().startsWith("application/json")
  ) {
    headers.delete("Content-Type");
  }
  return { ...init, headers };
}

async function request<T>(url: string, init?: RequestInit, acceptedStatus?: number): Promise<T> {
  const response = await fetch(url, buildRequestInit(init));
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== acceptedStatus) {
    const genericFastifyError =
      data.error === "Bad Request" || data.error === "Internal Server Error";
    const rawMessage =
      genericFastifyError && typeof data.message === "string"
        ? data.message
        : data.error || data.message || `Request failed (${response.status})`;
    const error = new Error(
      friendlyErrorMessage(
        Object.assign(new Error(String(rawMessage)), {
          status: response.status,
        }),
        `Request thất bại (${response.status}).`,
      ),
    ) as ApiError;
    error.detail = typeof data.detail === "string" ? data.detail : undefined;
    error.status = response.status;
    error.code = typeof data.code === "string" ? data.code : undefined;
    throw error;
  }
  return data as T;
}

const readError = async (response: Response, fallback: string, context?: "export") => {
  const data = await response.json().catch(() => ({}));
  const genericFastifyError =
    data.error === "Bad Request" || data.error === "Internal Server Error";
  const rawMessage =
    genericFastifyError && typeof data.message === "string"
      ? data.message
      : data.error || data.message || fallback;
  const error = new Error(
    friendlyErrorMessage(
      Object.assign(new Error(String(rawMessage)), { status: response.status, context }),
      fallback,
    ),
  ) as ApiError;
  error.detail = typeof data.detail === "string" ? data.detail : undefined;
  error.status = response.status;
  error.context = context;
  error.code = typeof data.code === "string" ? data.code : undefined;
  throw error;
};

function decodeBase64Json<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    const normalized = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return undefined;
  }
}

export const api = {
  listBackgroundExports: (signal?: AbortSignal) => request<BackgroundExportJob[]>('/api/export/jobs', {signal}),
  cancelBackgroundExport: (job: BackgroundExportJob) => request(job.kind === 'video-export'
    ? `/api/export/cancel/${encodeURIComponent(job.id)}`
    : `/api/animation-studio/render-jobs/${encodeURIComponent(job.id)}/cancel`, {method:'POST',body:'{}'}),
  generateCanvasAnimationVideo: (input: {
    project?:CanvasStudioProject;
    referenceImages?:string[];
    refineVisuals?:boolean;
    brief: string;
    provider: AIProvider;
    model: string;
    narration: { provider: AIProvider; model: string; voice: string; speed?: number };
    audioProduction?: { enabled?: boolean; autoSound?: boolean };
    targetDurationSeconds?: number;
    width?: number;
    height?: number;
    visualMode?: 'procedural' | 'code-vector' | 'ai-fallback';
    assetGeneration?: {
      enabled: true;
      quality: 'professional';
      provider?: AIProvider;
      model?: string;
      generator?: 'flow-agent';
      fallback?: { provider: AIProvider; model: string };
    };
  }) => (async () => {
    const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/canvas-animation-studio/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) await readError(response, 'Không thể tạo video Animation Studio.');
    return response.json() as Promise<CanvasStudioProject>;
  })(),
  buildCanvasAudio: async (input: {project:CanvasStudioProject;narration:{provider:AIProvider;model:string;voice:string;speed?:number};autoSound?:boolean}) => {
    const response=await fetch(`${MEDIA_BACKEND_ORIGIN}/api/canvas-animation-studio/audio`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    if(!response.ok)await readError(response,'Không thể dựng âm thanh cảnh.');
    return response.json() as Promise<CanvasStudioProject>;
  },
  renderCanvasAnimationProject: async (project: CanvasStudioProject, onProgress?: (progress: number) => void) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...project, createdAt: '', updatedAt: '', engine: 'canvas-remotion-v4-lipsync-gated' })));
    const cacheKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const queued = await fetch(`/api/canvas-animation-studio/projects/${encodeURIComponent(project.id)}/render-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, cacheKey }) });
    if (!queued.ok) { const body = await queued.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || 'Không thể xếp render Canvas video.'); }
    const initial = await queued.json() as { id: string };
    let job: { status: string; progress?: number; error?: string } = { status: 'queued', progress: 0 };
    onProgress?.(0);
    for (let attempt = 0; attempt < 1800; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      job = await request<{ status: string; progress?: number; error?: string }>(`/api/animation-studio/render-jobs/${encodeURIComponent(initial.id)}`);
      onProgress?.(Math.max(0, Math.min(100, Number(job.progress) || 0)));
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') break;
    }
    if (job.status !== 'completed') throw new Error(job.status === 'cancelled' ? 'Đã hủy xuất video.' : job.error || 'Render Canvas quá thời gian chờ.');
    onProgress?.(100);
    const response = await fetch(`/api/animation-studio/render-jobs/${encodeURIComponent(initial.id)}/video`);
    if (!response.ok) throw new Error('Không tải được Canvas video đã render.');
    return response.blob();
  },
  douyinTrends: () => request<{ items: Array<{ topic: string; rank: number; heat: number | null }>; fetchedAt: string }>('/api/douyin/trends'),
  assessDouyinTopic: (input: { topic: string; provider: AIProvider; model: string; items: Array<{ id: string; title: string }> }, signal?: AbortSignal) => request<{ items: Array<{ id: string; verdict: 'match' | 'uncertain' | 'off-topic'; reason: string }> }>('/api/douyin/relevance', { method: 'POST', body: JSON.stringify(input), signal }),
  runDouyinTool: (input: { operation: string; params: Record<string, string>; cursor: string; confirmed?: boolean; requestId?: string }) => request<{ data: unknown; write: boolean }>('/api/douyin/tools', { method: 'POST', body: JSON.stringify(input) }),
  douyinCookieStatus: () => request<{ saved: boolean; environment: boolean }>('/api/douyin/search-cookie'),
  saveDouyinCookie: (cookie: string) => request<{ saved: boolean; environment: boolean }>('/api/douyin/search-cookie', { method: 'PUT', body: JSON.stringify({ cookie }) }),
  deleteDouyinCookie: () => request<{ saved: boolean; environment: boolean }>('/api/douyin/search-cookie', { method: 'DELETE' }),
  searchDouyin: (input: { keyword: string; sort: string; publishTime: string; cookie?: string; offset?: number; count?: number; searchId?: string; filterDuration?: string; searchRange?: string; exactKeyword?: boolean; excludeKeywords?: string }) => request<{ warning: string; hasMore: boolean; nextOffset: number; searchId: string; items: Array<{ id: string; title: string; author: string; url: string; coverUrl?: string; duration: number; likes: number; comments: number; shares: number; publishedAt: number; views: number | null }> }>('/api/douyin/search', { method: 'POST', body: JSON.stringify(input) }),
  inspectStorage: (signal?: AbortSignal) => request<StorageSnapshot>('/api/storage', { signal }),
  deleteStorageItems: (items: Array<Pick<StorageItem, 'categoryId' | 'name'>>, onProgress?: (processed: number, total: number) => void) => deleteStorageInBatches(items, batch => request<StorageDeleteResult>('/api/storage/delete', { method: 'POST', body: JSON.stringify({ items: batch }) }, 409), onProgress),
  createAnimationProject: (input: { name: string; width: number; height: number; fps: number }) =>
    request<AnimationProject>("/api/animation-studio/projects", { method: "POST", body: JSON.stringify(input) }),
  listAnimationProjects: () => request<AnimationProjectSummary[]>("/api/animation-studio/projects"),
  getAnimationProject: (id: string) => request<AnimationProject>(`/api/animation-studio/projects/${encodeURIComponent(id)}`),
  saveAnimationProject: (project: AnimationProject) => request<AnimationProject>(`/api/animation-studio/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify(project) }),
  listAnimationProjectVersions: (id: string) => request<Array<{ id: string; createdAt: string; name: string; sceneCount: number }>>(`/api/animation-studio/projects/${encodeURIComponent(id)}/versions`),
  restoreAnimationProjectVersion: (id: string, versionId: string) => request<AnimationProject>(`/api/animation-studio/projects/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`, { method: "POST" }),
  directAnimationProject: (input: { brief: string; project: AnimationProject; provider: AIProvider; model: string; targetDurationSeconds?: number; narration?: { provider: AIProvider; model: string; voice: string; speed?: number }; assetGeneration?: AnimationAssetGeneration }) =>
    request<AnimationProject>("/api/animation-studio/direct", { method: "POST", body: JSON.stringify(input) }),
  startAnimationDirectorJob: (input: AnimationDirectorInput, resumeId?: string): Promise<AnimationDirectorJobStatus> => request<AnimationDirectorJobStatus>('/api/animation-studio/director-jobs', { method: 'POST', body: JSON.stringify({ input, resumeId }) }),
  generateAnimationCharacterOptions: (input: { brief: string; provider: AIProvider; model: string; assetGeneration: AnimationAssetGeneration; width?: number; height?: number }, signal?: AbortSignal) => request<AnimationAsset[]>('/api/animation-studio/character-options', { method: 'POST', body: JSON.stringify(input), signal }),
  generateAnimationThumbnails: (input: { project: AnimationProject; brief?: string; provider: AIProvider; model: string; assetGeneration: AnimationAssetGeneration; count?: number }, signal?: AbortSignal) => request<AnimationAsset[]>('/api/animation-studio/thumbnails', { method: 'POST', body: JSON.stringify(input), signal }),
  animationDirectorJob: (id: string) => request<AnimationDirectorJobStatus>(`/api/animation-studio/director-jobs/${encodeURIComponent(id)}`),
  animationDirectorResult: (id: string) => request<AnimationProject>(`/api/animation-studio/director-jobs/${encodeURIComponent(id)}/result`),
  animationDirectorInput: (id: string) => request<AnimationDirectorInput>(`/api/animation-studio/director-jobs/${encodeURIComponent(id)}/input`),
  cancelAnimationDirectorJob: (id: string) => request<AnimationDirectorJobStatus>(`/api/animation-studio/director-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }),
  batchDirectAnimationProjects: (input: Omit<AnimationDirectorInput, 'brief' | 'project'> & { briefs: string[]; template: AnimationProject }) => request<{ total: number; completed: number; failed: number; results: Array<{ brief: string; status: "completed" | "failed"; project?: AnimationProject; error?: string }> }>("/api/animation-studio/direct-batch", { method: "POST", body: JSON.stringify(input) }),
  editAnimationScene: (input: { instruction: string; project: AnimationProject; sceneId: string; provider: AIProvider; model: string; mode?: "edit" | "animation" | "visual" }) => request<AnimationProject>("/api/animation-studio/edit", { method: "POST", body: JSON.stringify(input) }),
  editAnimationProject: (input: { instruction: string; project: AnimationProject; provider: AIProvider; model: string }) => request<AnimationProject>("/api/animation-studio/edit-project", { method: "POST", body: JSON.stringify(input) }),
  checkAnimationQuality: (project: AnimationProject) => request<{ issues: Array<{ severity: "error" | "warning"; code: string; sceneId: string; layerId?: string; message: string }> }>("/api/animation-studio/quality-check", { method: "POST", body: JSON.stringify(project) }),
  fixAnimationQuality: (project: AnimationProject) => request<{ project: AnimationProject; fixed: number; remaining: Array<{ severity: "error" | "warning"; code: string; sceneId: string; layerId?: string; message: string }> }>("/api/animation-studio/quality-fix", { method: "POST", body: JSON.stringify(project) }),
  renderAnimationProject: async (projectId: string, recording: Blob, project?: AnimationProject, onProgress?: (progress: number) => void) => {
    const renderState = project ? { ...project, createdAt: "", updatedAt: "", assets: project.assets.map((asset) => ({ ...asset, createdAt: "" })) } : { projectId }; const encoded = new TextEncoder().encode(JSON.stringify(renderState)); const digest = await crypto.subtle.digest("SHA-256", encoded); const cacheKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const durationMs = project?.scenes.reduce((total, scene) => total + Math.max(0, scene.durationMs), 0);
    const headers: Record<string, string> = { "Content-Type": "video/webm", "X-Animation-Cache-Key": cacheKey };
    if (durationMs && project?.fps) { headers["X-Animation-Duration-Ms"] = String(durationMs); headers["X-Animation-FPS"] = String(project.fps); }
    const queued = await fetch(`/api/animation-studio/projects/${encodeURIComponent(projectId)}/render-jobs`, { method: "POST", headers, body: recording });
    if (!queued.ok) { const body = await queued.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || "Không thể xếp render animation."); }
    const initial = await queued.json() as { id: string }; let job: { status: string; progress?: number; error?: string } = { status: "queued", progress: 0 }; onProgress?.(0);
    for (let attempt = 0; attempt < 900; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 1000)); job = await request<{ status: string; progress?: number; error?: string }>(`/api/animation-studio/render-jobs/${encodeURIComponent(initial.id)}`); onProgress?.(Math.max(0, Math.min(100, Number(job.progress) || 0))); if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") break; }
    if (job.status !== "completed") throw new Error(job.status === "cancelled" ? "Đã hủy xuất video." : job.error || "Render queue quá thời gian chờ."); onProgress?.(100); const response = await fetch(`/api/animation-studio/render-jobs/${encodeURIComponent(initial.id)}/video`); if (!response.ok) throw new Error("Không tải được video từ render queue."); return response.blob();
  },
  renderAnimationProjectFrameAccurate: async (project: AnimationProject, showSubtitles: boolean, onProgress?: (progress: number) => void) => {
    const cacheKey = await animationProjectRenderCacheKey(project, showSubtitles);
    const queued = await fetch(`/api/animation-studio/projects/${encodeURIComponent(project.id)}/remotion-render-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, showSubtitles, cacheKey }) });
    if (!queued.ok) { const body = await queued.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || "Không thể xếp render Remotion."); }
    const initial = await queued.json() as { id: string }; let job: { status: string; progress?: number; error?: string } = { status: "queued", progress: 0 }; onProgress?.(0);
    for (let attempt = 0; attempt < 1800; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 1000)); job = await request<{ status: string; progress?: number; error?: string }>(`/api/animation-studio/render-jobs/${encodeURIComponent(initial.id)}`); onProgress?.(Math.max(0, Math.min(100, Number(job.progress) || 0))); if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") break; }
    if (job.status !== "completed") throw new Error(job.status === "cancelled" ? "Đã hủy xuất video." : job.error || "Render Remotion quá thời gian chờ."); onProgress?.(100); const response = await fetch(`/api/animation-studio/render-jobs/${encodeURIComponent(initial.id)}/video`); if (!response.ok) throw new Error("Không tải được video Remotion."); return response.blob();
  },
  listAnimationRenderJobs: () => request<Array<{ id: string; projectId: string; engine?: "browser-recording" | "remotion" | "canvas-remotion"; cacheKey?: string; status: "queued" | "rendering" | "completed" | "failed" | "cancelled"; progress: number; cached?: boolean; error?: string; createdAt: string }>>("/api/animation-studio/render-jobs"),
  listAnimationAssets: (query = "") => request<AnimationAsset[]>(`/api/animation-studio/assets?q=${encodeURIComponent(query)}`),
  registerAnimationAsset: (asset: AnimationAsset) => request<AnimationAsset>("/api/animation-studio/assets", { method: "POST", body: JSON.stringify(asset) }),
  updateAnimationAsset: (id: string, change: Partial<Pick<AnimationAsset, "name" | "tags" | "style" | "animations">>) => request<AnimationAsset>(`/api/animation-studio/assets/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(change) }),
  generateAnimationAsset: (input: { prompt: string; name?: string; type?: AnimationAsset["type"]; tags?: string[]; style?: string; provider?: AIProvider; model?: string; generator?: 'flow-agent'; width?: number; height?: number }) => request<AnimationAsset>("/api/animation-studio/assets/generate", { method: "POST", body: JSON.stringify(input) }),
  generateAnimationNarration: (input: { project: AnimationProject; provider: AIProvider; model: string; voice: string; speed?: number }) => request<AnimationProject>("/api/animation-studio/narration", { method: "POST", body: JSON.stringify(input) }),
  retryMissingAnimationImages: (input: { project: AnimationProject; assetGeneration: AnimationAssetGeneration; provider: AIProvider; model: string }) => request<{ project: AnimationProject; repaired: number; remaining: number }>("/api/animation-studio/retry-missing-images", { method: "POST", body: JSON.stringify(input) }),
  system: () =>
    request<{
      ffmpeg: boolean;
      ffprobe: boolean;
      demucs: boolean;
      workdir: string;
    }>("/api/system"),
  cleanupTemporaryFiles: () =>
    request<{
      removedFiles: number;
      removedDirectories: number;
      freedBytes: number;
      skippedActiveJobs: number;
      skippedRecentFiles: number;
    }>("/api/system/cleanup", { method: "POST", body: "{}" }),
  listModels: (provider: AIProvider, signal?: AbortSignal) =>
    request<{ models: AIModel[]; warning?: string }>("/api/providers/models", {
      method: "POST",
      body: JSON.stringify({ provider }),
      signal,
    }),
  listVoices: (provider: AIProvider, signal?: AbortSignal) =>
    request<{
      voices: Array<{ id: string; name?: string; language?: string }>;
    }>("/api/providers/voices", {
      method: "POST",
      body: JSON.stringify({ provider }),
      signal,
    }),
  listVieneuVoiceClones: (signal?: AbortSignal) =>
    request<{ profiles: VoiceCloneProfile[]; voices: AIVoice[] }>(
      "/api/voice-clones/vieneu",
      { signal },
    ),
  createVieneuVoiceClone: async (
    name: string,
    file: File,
    consent: boolean,
    signal?: AbortSignal,
    startSeconds = 0,
  ) => {
    const form = new FormData();
    form.append("name", name);
    form.append("consent", String(consent));
    form.append("startSeconds", String(startSeconds));
    form.append("file", file, file.name);
    const response = await fetch(
      `${MEDIA_BACKEND_ORIGIN}/api/voice-clones/vieneu`,
      { method: "POST", body: form, signal },
    );
    if (!response.ok) await readError(response, "Không thể tạo giọng clone.");
    return response.json() as Promise<{
      profile: VoiceCloneProfile;
      voice: AIVoice;
    }>;
  },
  deleteVieneuVoiceClone: async (id: string) => {
    const response = await fetch(
      `${MEDIA_BACKEND_ORIGIN}/api/voice-clones/vieneu/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 404)
      await readError(response, "Không thể xóa giọng clone.");
  },
  testProvider: (provider: AIProvider) =>
    request<{ ok: boolean; warning?: string }>("/api/providers/test", {
      method: "POST",
      body: JSON.stringify({ provider }),
    }),
  warmupVieneu: () =>
    request<{ ok: boolean }>("/api/dubbing/vieneu-warmup", {
      method: "POST",
      body: "{}",
    }),
  testModel: (
    provider: AIProvider,
    model: string,
    signal?: AbortSignal,
    capability: Capability = "translation",
  ) =>
    request<{ ok: boolean; model: string; latencyMs: number; output: string }>(
      "/api/providers/test-model",
      {
        method: "POST",
        body: JSON.stringify({ provider, model, capability }),
        signal,
      },
    ),
  translate: (
    provider: AIProvider,
    model: string | undefined,
    cues: SubtitleCue[],
    sourceLanguage: string,
    targetLanguage: string,
    style: string,
    customPrompt: string,
    glossary: GlossaryEntry[],
    signal?: AbortSignal,
    contextCues: SubtitleCue[] = cues,
    translationMemory: TranslationMemoryItem[] = [],
    translationGuide = '',
  ) => {
    const contextIndices = new Map<string, number>();
    contextCues.forEach((cue, index) => {
      if (!contextIndices.has(cue.id)) contextIndices.set(cue.id, index);
    });
    return request<{ items: Array<{ id: string; translation: string }>; pendingCueIds?: string[]; warning?: string }>(
      "/api/translate",
      {
        method: "POST",
        body: JSON.stringify({
          provider,
          model,
          items: cues.map((cue) => {
            const durationMs = Math.max(cue.endMs - cue.startMs, 50);
            const contextIndex = contextIndices.get(cue.id) ?? -1;
            const contextBefore = contextIndex < 0
              ? []
              : contextCues.slice(Math.max(0, contextIndex - 2), contextIndex).map((candidate) => candidate.originalText).filter(Boolean);
            const contextAfter = contextIndex < 0
              ? []
              : contextCues.slice(contextIndex + 1, contextIndex + 3).map((candidate) => candidate.originalText).filter(Boolean);
            return {
              id: cue.id,
              text: cue.originalText,
              durationMs,
              targetDurationMs: durationMs,
              contextBefore,
              contextAfter,
            };
          }),
          sourceLanguage,
          targetLanguage,
          style,
          customPrompt,
          glossary,
          translationMemory: translationMemory.slice(-24),
          translationGuide,
        }),
        signal,
      },
    );
  },
  createTranslationJob: async (
    provider: AIProvider,
    model: string | undefined,
    cues: SubtitleCue[],
    sourceLanguage: string,
    targetLanguage: string,
    style: string,
    customPrompt: string,
    glossary: GlossaryEntry[],
    contextCues: SubtitleCue[] = cues,
    translationMemory: TranslationMemoryItem[] = [],
    translationGuide = '',
    signal?: AbortSignal,
  ) => {
    const contextIndices = new Map<string, number>();
    contextCues.forEach((cue, index) => {
      if (!contextIndices.has(cue.id)) contextIndices.set(cue.id, index);
    });
    const jobId = `translation-${crypto.randomUUID()}`;
    const body = JSON.stringify({
      jobId,
      provider,
      model,
      items: cues.map((cue) => {
        const durationMs = Math.max(cue.endMs - cue.startMs, 50);
        const contextIndex = contextIndices.get(cue.id) ?? -1;
        const contextBefore = contextIndex < 0 ? [] : contextCues.slice(Math.max(0, contextIndex - 2), contextIndex).map((candidate) => candidate.originalText).filter(Boolean);
        const contextAfter = contextIndex < 0 ? [] : contextCues.slice(contextIndex + 1, contextIndex + 3).map((candidate) => candidate.originalText).filter(Boolean);
        return { id: cue.id, text: cue.originalText, durationMs, targetDurationMs: durationMs, contextBefore, contextAfter };
      }),
      sourceLanguage,
      targetLanguage,
      style,
      customPrompt,
      glossary,
      translationMemory: translationMemory.slice(-24),
      translationGuide,
    });
    while (true) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      try {
        return await request<{ id: string; status: string; stage: string }>(
          "/api/translate/jobs",
          { method: "POST", body, signal },
        );
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        if (error && typeof error === "object" && "status" in error && Number((error as { status?: unknown }).status)) throw error;
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, 700);
          const onAbort = () => {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(new DOMException("Cancelled", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
  },
  getTranslationJob: (id: string, signal?: AbortSignal) =>
    request<{
      id: string;
      status: "queued" | "running" | "completed" | "failed" | "cancelled";
      stage: string;
      error?: string;
      result?: { items: Array<{ id: string; translation: string }>; pendingCueIds: string[]; warning?: string };
    }>(`/api/translate/jobs/${encodeURIComponent(id)}`, { signal }),
  cancelTranslationJob: (id: string) =>
    request<{ id: string; status: string; stage: string }>(`/api/translate/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  translationGuide: (
    provider: AIProvider,
    model: string | undefined,
    cues: SubtitleCue[],
    sourceLanguage: string,
    targetLanguage: string,
    style: string,
    customPrompt: string,
    glossary: GlossaryEntry[],
    signal?: AbortSignal,
  ) =>
    request<{ guide: string }>(
      "/api/translate/guide",
      {
        method: "POST",
        body: JSON.stringify({
          provider,
          model,
          items: cues.map((cue) => ({ id: cue.id, text: cue.originalText })),
          sourceLanguage,
          targetLanguage,
          style,
          customPrompt,
          glossary,
        }),
        signal,
      },
    ),
  uploadMedia: async (file: File, signal?: AbortSignal) => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/uploads`, {
      method: "POST",
      body: form,
      signal,
    });
    if (!response.ok) await readError(response, "Không thể lưu file lên máy.");
    return response.json() as Promise<StoredMediaResult>;
  },
  importLocalMedia: async (
    kind: "video" | "audio" | "media",
    signal?: AbortSignal,
  ) => {
    const response = await fetch(
      `${MEDIA_BACKEND_ORIGIN}/api/uploads/import-local`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
        signal,
      },
    );
    if (!response.ok) await readError(response, "Không thể mở file local.");
    return response.json() as Promise<StoredMediaResult | { cancelled: true }>;
  },
  deleteUpload: async (uploadId: string) => {
    const response = await fetch(
      `${MEDIA_BACKEND_ORIGIN}/api/uploads/${encodeURIComponent(uploadId)}`,
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 404)
      await readError(response, "Không thể dọn file tạm.");
  },
  extractStt: async (
    uploadId: string,
    provider: AIProvider,
    model: string,
    language: string,
    signal?: AbortSignal,
    progressId: string = crypto.randomUUID(),
  ) => {
    const cancel = () => { void request(`/api/extract/progress/${encodeURIComponent(progressId)}/cancel`, { method: 'POST' }).catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true });
    return request<{
      cues: SubtitleCue[];
      audioName: string;
      uploadId: string;
      timestampRefinement?: {
        enabled: boolean;
        method: string;
        alignmentMethod?: string;
        alignmentConfidence?: number;
        timestampSource?: string;
        refinedCount: number;
        fallbackCount: number;
        analysisMs: number;
        speechRegions?: Array<{ startMs: number; endMs: number }>;
      };
      textAudioAlignment?: {
        entries: Array<{
          text: string;
          providerStartMs: number;
          providerEndMs: number;
          alignedStartMs: number;
          alignedEndMs: number;
          confidence: number;
          alignmentMethod: string;
          timestampSource: string;
        }>;
        metadata: {
          alignmentMethod: string;
          alignmentConfidence: number;
          timestampSource: string;
        };
      };
    }>("/api/extract/stt", {
      method: "POST",
      body: JSON.stringify({ uploadId, provider, model, language, progressId }),
      signal,
    }).finally(() => signal?.removeEventListener('abort', cancel));
  },
  extractOcr: async (
    uploadId: string,
    provider: AIProvider,
    model: string,
    roi: { x: number; y: number; w: number; h: number },
    samplingFps: number,
    filterWatermark: boolean,
    signal?: AbortSignal,
    progressId?: string,
    language?: string,
    textScope: "subtitles" | "all" = "subtitles",
  ) =>
    request<{ cues: SubtitleCue[]; uploadId: string }>("/api/extract/ocr", {
      method: "POST",
      body: JSON.stringify({
        uploadId,
        provider,
        model,
        roi,
        samplingFps,
        filterWatermark,
        textScope,
        progressId,
        language,
      }),
      signal,
    }),
  getExtractionProgress: (progressId: string, signal?: AbortSignal) =>
    request<{
      percent: number;
      stage: string;
      status: "running" | "completed" | "failed" | "cancelled";
      processed?: number;
      total?: number;
      error?: string;
    }>(`/api/extract/progress/${encodeURIComponent(progressId)}`, { signal }),
  generateDubTrack: async (
    cues: Array<{
      id: string;
      startMs: number;
      endMs: number;
      originalText: string;
      translatedText: string;
      text: string;
      previousText: string;
      nextText: string;
      provider: AIProvider;
      model: string;
      voice: string;
      speed: number;
      volume: number;
    }>,
    signal?: AbortSignal,
  ) => {
    const created = await request<{ jobId: string }>("/api/dubbing/jobs", {
      method: "POST",
      body: JSON.stringify({ cues, timingMode: "natural" }),
      signal,
    });
    await request(
      `/api/dubbing/jobs/${encodeURIComponent(created.jobId)}/start`,
      { method: "POST", signal },
    );
    return {
      blob: new Blob(),
      warnings: [`Dubbing job ${created.jobId} đang chạy.`],
      metadata: [] as DubbingMetadata[],
    };
  },
  createDubbingJob: async (
    cues: Array<{
      id: string;
      index?: number;
      startMs: number;
      endMs: number;
      originalText: string;
      translatedText: string;
      text: string;
      previousText: string;
      nextText: string;
      provider: AIProvider;
      model: string;
      voice: string;
      speed: number;
      volume: number;
    }>,
    options?: {
      videoId?: string;
      timingMode?: "natural" | "strict";
      batchSize?: number;
      ttsConcurrency?: number;
      llmConcurrency?: number;
      maxRetries?: number;
      slowVideoToMatchSpeech?: boolean;
      audioMix?: {
        mode: import("../types").OriginalAudioMode;
        keepOriginal: boolean;
        originalVolume: number;
        separateVocals?: boolean;
      };
      rewrite?: { provider: AIProvider; model: string };
    },
    signal?: AbortSignal,
  ) =>
    request<{ jobId: string; status: string; totalCues: number }>(
      "/api/dubbing/jobs",
      { method: "POST", body: JSON.stringify({ cues, ...options }), signal },
    ),
  startDubbingJob: (id: string, signal?: AbortSignal) =>
    request<DubbingJobStatus>(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/start`,
      { method: "POST", signal },
    ),
  getDubbingJobStatus: (id: string, signal?: AbortSignal) =>
    request<DubbingJobStatus>(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/status`,
      { signal },
    ),
  getLatestDubbingJobForVideo: (videoId: string, signal?: AbortSignal) =>
    request<{ job?: DubbingJobStatus }>(
      `/api/dubbing/jobs/latest-for-video?videoId=${encodeURIComponent(videoId)}`,
      { signal },
    ),
  pauseDubbingJob: (id: string) =>
    request<DubbingJobStatus>(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/pause`,
      { method: "POST" },
    ),
  resumeDubbingJob: (id: string) =>
    request<DubbingJobStatus>(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/resume`,
      { method: "POST" },
    ),
  cancelDubbingJob: (id: string) =>
    request<DubbingJobStatus>(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),
  retryFailedDubbingJob: (
    id: string,
    cues: Array<Pick<SubtitleCue, "id" | "startMs" | "endMs" | "originalText" | "translatedText"> & { text: string; previousText?: string; nextText?: string }> = [],
  ) =>
    request<DubbingJobStatus>(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/retry-failed`,
      { method: "POST", ...(cues.length ? { body: JSON.stringify({ cues }) } : {}) },
    ),
  rebuildDubbingJobResult: (id: string) =>
    request<DubbingJobStatus>(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/rebuild`,
      { method: "POST" },
    ),
  regenerateDubbingCue: (
    id: string,
    cue: Pick<
      SubtitleCue,
      "id" | "startMs" | "endMs" | "originalText" | "translatedText"
    > & { text: string; previousText?: string; nextText?: string },
  ) =>
    request<DubbingJobStatus>(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/cues/${encodeURIComponent(cue.id)}/regenerate`,
      {
        method: "POST",
        body: JSON.stringify({
          startMs: cue.startMs,
          endMs: cue.endMs,
          originalText: cue.originalText,
          translatedText: cue.translatedText,
          text: cue.text,
          previousText: cue.previousText || "",
          nextText: cue.nextText || "",
        }),
      },
    ),
  getDubbingResult: (id: string) =>
    request<{
      job: DubbingJobStatus;
      metadata: DubbingMetadata[];
      audioUrl: string;
    }>(`/api/dubbing/jobs/${encodeURIComponent(id)}/result`),
  downloadDubbingAudio: async (id: string) => {
    const response = await fetch(
      `/api/dubbing/jobs/${encodeURIComponent(id)}/result/audio`,
    );
    if (!response.ok) await readError(response, "Không thể tải dub track.");
    return response.blob();
  },
  testVoice: async (
    provider: AIProvider,
    model: string,
    voice: string,
    speed: number,
    text?: string,
  ) => {
    const response = await fetch("/api/dubbing/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, voice, speed, text }),
    });
    if (!response.ok) await readError(response, "Không thể test voice.");
    return response.blob();
  },
  // Rendering a video can take minutes. Bypass Vite's dev proxy for this
  // long-lived media request so the proxy cannot reset the socket mid-render.
  exportVideo: async (
    file: File | undefined,
    cues: SubtitleCue[],
    style: SubtitleStyle,
    options: {
      exportId: string;
      uploadId?: string;
      resolution: "original" | "1080" | "720";
      crf: number;
      keepAudio: boolean;
      originalVolume: number;
      dubVolume?: number;
      burnSubtitles: boolean;
      separateVocals: boolean;
      blurRegions?: BlurRegion[];
      logo?: LogoOverlay;
      dubTrack?: Blob;
      dubbingJobId?: string;
      fontFile?: File;
      fontFamilyAlias?: string;
      logoFontFile?: File;
      videoEdit?: import("../types").VideoEditState;
    },
    signal?: AbortSignal,
  ) => {
    const form = new FormData();
    form.append("exportId", options.exportId);
    if (options.uploadId) form.append("uploadId", options.uploadId);
    else if (file) form.append("file", file);
    else throw new Error("Video chưa được upload lên máy.");
    form.append("ass", cuesToAss(cues, style));
    form.append(
      "options",
      JSON.stringify({
        resolution: options.resolution,
        crf: options.crf,
        keepAudio: options.keepAudio,
        originalVolume: options.originalVolume,
        dubVolume: options.dubVolume,
        burnSubtitles: options.burnSubtitles,
        separateVocals: options.separateVocals,
        blurRegions: options.blurRegions || [],
        dubbingJobId: options.dubbingJobId,
        videoEdit: options.videoEdit,
        logo: options.logo
          ? {
              enabled: options.logo.enabled,
              kind: options.logo.kind,
              text: options.logo.text,
              fontFamily: options.logo.fontFamily,
              fontSize: options.logo.fontSize,
              textColor: options.logo.textColor,
              outlineColor: options.logo.outlineColor,
              xPercent: options.logo.xPercent,
              yPercent: options.logo.yPercent,
              widthPercent: options.logo.widthPercent,
              opacity: options.logo.opacity,
            }
          : undefined,
      }),
    );
    if (options.dubTrack && !options.dubbingJobId)
      form.append("dubTrack", options.dubTrack, "dub-track.wav");
    if (options.fontFile)
      form.append("fontFile", options.fontFile, options.fontFile.name);
    if (options.fontFile && options.fontFamilyAlias)
      form.append("fontFamilyAlias", options.fontFamilyAlias);
    if (options.logo?.enabled !== false && options.logo?.kind === "image" && options.logo.file)
      form.append("logoFile", options.logo.file, options.logo.file.name);
    else if (
      options.logo?.enabled !== false &&
      options.logo?.kind === "image" &&
      options.logo.url?.startsWith("data:")
    )
      form.append(
        "logoFile",
        await dataUrlToBlob(options.logo.url),
        options.logo.name || "logo.png",
      );
    if (options.logo?.enabled !== false && options.logo?.kind === "text" && options.logoFontFile)
      form.append("logoFontFile", options.logoFontFile, options.logoFontFile.name);
    const waitForDurableExport = async () => {
      while (true) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        let progress: {
          percent: number;
          stage: string;
          status: "running" | "queued" | "completed" | "failed" | "cancelled";
          error?: string;
        } | undefined;
        try {
          progress = await request<{
            percent: number;
            stage: string;
            status: "running" | "queued" | "completed" | "failed" | "cancelled";
            error?: string;
          }>(`/api/export/progress/${encodeURIComponent(options.exportId)}`, { signal });
        } catch (error) {
          if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
          // Backend có thể đang khởi động lại; job export vẫn nằm trên disk.
        }
        if (progress) {
          if (progress.status === "completed") {
            const result = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/export/result/${encodeURIComponent(options.exportId)}`, { signal });
            if (!result.ok) await readError(result, "Không thể lấy video đã render.", "export");
            return result.blob();
          }
          if (progress.status === "failed") throw new Error(progress.error || "Video export thất bại.");
          if (progress.status === "cancelled") throw new DOMException("Cancelled", "AbortError");
        }
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, 800);
          const onAbort = () => {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(new DOMException("Cancelled", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
    };
    try {
      const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/export/video`, {
        method: "POST",
        body: form,
        signal,
      });
      if (!response.ok) await readError(response, "Không thể xuất video.", "export");
      return response.blob();
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if ((error as ApiError)?.code === 'EXPORT_CANCELLED') throw new DOMException('Cancelled', 'AbortError');
      // A definitive backend render error is not a lost connection. Preserve
      // its diagnostics instead of silently waiting for a failed job again.
      if ((error as ApiError)?.context === 'export') throw error;
      return waitForDurableExport();
    }
  },
  exportAudio: async (
    options: {
      uploadId?: string;
      dubbingJobId?: string;
      trimStartMs?: number;
      trimEndMs?: number;
      audioSource?: "dub" | "original" | "original-retimed";
    },
    signal?: AbortSignal,
  ) => {
    const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/export/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
      signal,
    });
    if (!response.ok) await readError(response, "Không thể xuất audio.", "export");
    return response.blob();
  },
  exportStemAudio: async (
    options: {
      uploadId: string;
      stem: "vocals" | "background";
      trimStartMs?: number;
      trimEndMs?: number;
    },
    signal?: AbortSignal,
  ) => {
    const response = await fetch(`${MEDIA_BACKEND_ORIGIN}/api/export/stem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
      signal,
    });
    if (!response.ok) await readError(response, "KhĂ´ng thá»ƒ tĂ¡ch audio.", "export");
    return response.blob();
  },
  getExportProgress: (id: string, signal?: AbortSignal) =>
    request<{
      percent: number;
      stage: string;
      status: "queued" | "running" | "completed" | "failed" | "cancelled";
      error?: string;
    }>(`/api/export/progress/${encodeURIComponent(id)}`, { signal }),
  cancelExport: (id: string) =>
    request<{ status: string; stage: string }>(`/api/export/cancel/${encodeURIComponent(id)}`, { method: "POST" }),
  createReviewJob: (
    input: {
      uploadId: string;
      sourceLanguage: string;
      movieTitle?: string;
      characterGuide?: string;
      targetDurationSeconds: number;
      tone: string;
      customPrompt?: string;
      aspectRatio: ReviewAspectRatio;
      burnSubtitles: boolean;
      stt: { provider: AIProvider; model: string };
      vision?: { provider: AIProvider; model: string };
      script: { provider: AIProvider; model: string };
      tts: {
        provider: AIProvider;
        model: string;
        voice: string;
        speed: number;
      };
    },
    signal?: AbortSignal,
    retryJobId?: string,
  ) =>
    request<ReviewJobStatus>(retryJobId ? `/api/review/jobs/${encodeURIComponent(retryJobId)}/retry` : "/api/review/jobs", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  createProductAdJob: (
    input: {
      imageUploadIds: string[];
      productName: string;
      productDescription: string;
      targetAudience?: string;
      offer?: string;
      callToAction?: string;
      platform: ProductAdPlatform;
      outputMode: ProductAdOutputMode;
      targetDurationSeconds: number;
      tone: string;
      creativeMode?: 'professional' | 'everyday' | 'ugc' | 'direct-response';
      customPrompt?: string;
      burnSubtitles: boolean;
      subtitleStyle?: { fontSize: number; positionPercent: number; textColor: string; backgroundColor: string; backgroundOpacity: number; outlineWidth: number; maxCharsPerLine: number; textAlign: 'left' | 'center' | 'right'; bold: boolean };
      useFlowAgentVisuals?: boolean;
      useFlowAgentMotion?: boolean;
      vision?: { provider: AIProvider; model: string };
      script: { provider: AIProvider; model: string };
      tts?: { provider: AIProvider; model: string; voice: string; speed: number };
    },
    signal?: AbortSignal,
  ) => request<ProductAdJobStatus>("/api/product-ads/jobs", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  }),
  getProductAdJob: (id: string, signal?: AbortSignal) =>
    request<ProductAdJobStatus>(`/api/product-ads/jobs/${encodeURIComponent(id)}`, { signal }),
  cancelProductAdJob: (id: string) =>
    request<ProductAdJobStatus>(`/api/product-ads/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  createProductAdFlowPreview: (id: string) =>
    request<ProductAdJobStatus>(`/api/product-ads/jobs/${encodeURIComponent(id)}/flow-preview`, { method: "POST" }),
  rerenderProductAdSubtitles: (id: string, burnSubtitles: boolean, subtitleStyle: { fontSize: number; positionPercent: number; textColor: string; backgroundColor: string; backgroundOpacity: number; outlineWidth: number; maxCharsPerLine: number; textAlign: 'left' | 'center' | 'right'; bold: boolean }, subtitleTexts?: string[]) =>
    request<ProductAdJobStatus>(`/api/product-ads/jobs/${encodeURIComponent(id)}/subtitles`, { method: 'POST', body: JSON.stringify({ burnSubtitles, subtitleStyle, subtitleTexts }) }),
  getAiVideoAdapters: () => request<Array<{ id: string; label: string; models: string[] }>>('/api/ai-video/video-adapters'),
  configureFilmReviewer: (id: string, vision?: { provider: AIProvider; model: string }) => request<{ ok: boolean }>(`/api/ai-video/jobs/${encodeURIComponent(id)}/reviewer`, { method: 'POST', body: JSON.stringify({ vision }) }),
  createAiVideoJob: (input: { brief: string; durationSeconds: number; model: FilmVideoModel; imageModel?: string; aspectRatio: '9:16' | '16:9'; directionMode?: 'cinematic' | 'documentary' | 'commercial' | 'social-realism'; workflowMode?: 'review-first' | 'direct'; automationMode?: 'automatic' | 'manual'; characterReferenceUploadId?: string; script: { provider: AIProvider; model: string } }) => request<AiVideoJobStatus>('/api/ai-video/jobs', { method: 'POST', body: JSON.stringify(input) }),
  flowAgentStatus: () => request<{ installed: boolean; connected: boolean; extensionConnected: boolean; hasFlowKey: boolean; status: string; transport: string; url: string; error?: string; imagePool?: { workerAccounts?: number; authenticatedAccounts?: number; active?: number; cap?: number } }>('/api/ai-video/flow-agent/status'),
  ima2GptImageStatus: () => request<{ installed: boolean; running: boolean; connected: boolean; authStatus: string; models: string[]; modelChoices?: string[]; version?: string }>('/api/gpt-image/status'),
  startIma2GptLogin: () => request<{ alreadyConnected?: boolean; status?: string; sessionId?: string; userCode?: string; verificationUrl?: string; expiresIn?: number }>('/api/gpt-image/connect', { method: 'POST', body: '{}' }),
  pollIma2GptLogin: (sessionId: string) => request<{ status: 'pending' | 'complete' | 'ready' | 'expired' | 'error'; authStatus?: string; error?: string }>(`/api/gpt-image/connect/${encodeURIComponent(sessionId)}`),
  refreshFlowAgent: () => request<{ installed: boolean; connected: boolean; extensionConnected: boolean; hasFlowKey: boolean; status: string; transport: string; url: string; error?: string; imagePool?: { workerAccounts?: number; authenticatedAccounts?: number; active?: number; cap?: number } }>('/api/ai-video/flow-agent/refresh', { method: 'POST' }),
  openFlowAgent: () => request<{ installed: boolean; connected: boolean; extensionConnected: boolean; hasFlowKey: boolean; status: string; transport: string; url: string; error?: string; imagePool?: { workerAccounts?: number; authenticatedAccounts?: number; active?: number; cap?: number } }>('/api/ai-video/flow-agent/open', { method: 'POST' }),
  getAiVideoJob: (id: string, signal?: AbortSignal) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}`, { signal }),
  cancelAiVideoJob: (id: string) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }),
  composeAiVideoJob: (id: string) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}/compose`, { method: 'POST', body: '{}' }),
  approveAiVideoJob: (id: string) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  updateAiVideoPreproduction: (id: string, input: { productionBible?: string; scene?: Partial<AiVideoScene> & { index: number }; imageModel?: string; model?: FilmVideoModel }) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}/preproduction`, { method: 'PATCH', body: JSON.stringify(input) }),
  regenerateAiVideoDesign: (id: string, input: { kind: 'character-sheet' | 'storyboard'; sceneIndex?: number; characterIndex?: number }) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}/preproduction/regenerate`, { method: 'POST', body: JSON.stringify(input) }),
  regenerateAiVideoShot: (id: string, sceneIndex: number) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}/shots/${sceneIndex}/regenerate`, { method: 'POST', body: '{}' }),
  acceptAiVideoClipCandidate: (id: string, sceneIndex: number) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}/shots/${sceneIndex}/accept-candidate`, { method: 'POST', body: '{}' }),
  resumeAiVideoJob: (id: string, model: FilmVideoModel, script?: { provider: AIProvider; model: string }) => request<AiVideoJobStatus>(`/api/ai-video/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST', body: JSON.stringify({ model, script }) }),
  getReviewJob: (id: string, signal?: AbortSignal) =>
    request<ReviewJobStatus>(`/api/review/jobs/${encodeURIComponent(id)}`, {
      signal,
    }),
  cancelReviewJob: (id: string) =>
    request<ReviewJobStatus>(
      `/api/review/jobs/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),
  youtubeStatus: () =>
    request<{
      connected: boolean;
      channelId?: string;
      channelTitle?: string;
      error?: string;
    }>("/api/review/youtube/status"),
  connectYouTube: (clientId: string, clientSecret: string) =>
    request<{ authUrl: string }>("/api/review/youtube/connect", {
      method: "POST",
      body: JSON.stringify({ clientId, clientSecret }),
    }),
  disconnectYouTube: async () => {
    const response = await fetch("/api/review/youtube/connection", {
      method: "DELETE",
    });
    if (!response.ok)
      await readError(response, "Không thể ngắt kết nối YouTube.");
  },
  uploadReviewToYouTube: (id: string) =>
    request<ReviewJobStatus>(
      `/api/review/jobs/${encodeURIComponent(id)}/youtube-upload`,
      { method: "POST" },
    ),
  refreshReviewYouTube: (id: string) =>
    request<ReviewJobStatus>(
      `/api/review/jobs/${encodeURIComponent(id)}/youtube-refresh`,
      { method: "POST" },
    ),
  markReviewYouTube: (id: string, decision: "passed" | "claimed") =>
    request<ReviewJobStatus>(
      `/api/review/jobs/${encodeURIComponent(id)}/youtube-decision`,
      { method: "POST", body: JSON.stringify({ decision }) },
    ),
  parseDouyinUrls: (
    textOrUrls: string | string[],
    resolve = false,
    signal?: AbortSignal,
  ) =>
    request<{
      urls: string[];
      count: number;
      items?: Array<{
        success: boolean;
        info?: {
          url: string;
          videoId: string;
          title: string;
          author: string;
          coverUrl?: string;
          duration?: number;
          downloadUrl: string;
        };
        error?: string;
      }>;
    }>("/api/douyin/parse", {
      method: "POST",
      body: JSON.stringify(
        typeof textOrUrls === "string"
          ? { text: textOrUrls, resolve }
          : { urls: textOrUrls, resolve },
      ),
      signal,
    }),
  startDouyinBatch: (
    urlsOrText: string[] | string,
    bilibiliQuality: 64 | 16 = 64,
    signal?: AbortSignal,
  ) =>
    request<DouyinBatchJob>("/api/douyin/batch", {
      method: "POST",
      body: JSON.stringify(
        Array.isArray(urlsOrText)
          ? { urls: urlsOrText, bilibiliQuality }
          : { text: urlsOrText, bilibiliQuality },
      ),
      signal,
    }),
  getDouyinBatchStatus: (id: string, signal?: AbortSignal) =>
    request<DouyinBatchJob>(`/api/douyin/batch/${encodeURIComponent(id)}`, {
      signal,
    }),
  appendDouyinBatch: (id: string, urls: string[], bilibiliQuality: 64 | 16 = 64) =>
    request<DouyinBatchJob>(`/api/douyin/batch/${encodeURIComponent(id)}/items`, {
      method: "POST",
      body: JSON.stringify({ urls, bilibiliQuality }),
    }),
  cancelDouyinBatchItem: (batchId: string, itemId: string) =>
    request<{ ok: boolean; batchId: string; itemId: string }>(
      `/api/douyin/batch/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/cancel`,
      { method: "POST" },
    ),
  cancelDouyinBatch: (id: string) =>
    request<{ ok: boolean; batchId: string }>(
      `/api/douyin/batch/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    ),
};
