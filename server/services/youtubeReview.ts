import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReviewYouTubeStatus } from '../types';
import { workdir } from './ffmpeg';
import { getReviewJob, getReviewResult, updateReviewYouTubeStatus } from './reviewJobs';

type StoredYouTubeAuth = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken?: string;
  expiryDate: number;
  scope?: string;
};

type PendingAuth = { clientId: string; clientSecret: string; redirectUri: string; expiresAt: number };
type YouTubeVideoResource = {
  id?: string;
  status?: { uploadStatus?: string; rejectionReason?: string; privacyStatus?: string };
  processingDetails?: { processingStatus?: string; processingFailureReason?: string };
  contentDetails?: { regionRestriction?: { blocked?: string[]; allowed?: string[] } };
};

const authDirectory = path.join(workdir, 'secrets');
const authFile = path.join(authDirectory, 'youtube-oauth.json');
const pendingAuth = new Map<string, PendingAuth>();
const activeUploads = new Set<string>();
const oauthScopes = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  try {
    await rename(temporary, file);
  } catch (error) {
    await rm(file, { force: true });
    await rename(temporary, file).catch(() => { throw error; });
  }
}

async function readAuth() {
  return JSON.parse(await readFile(authFile, 'utf8')) as StoredYouTubeAuth;
}

async function tokenRequest(parameters: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== 'string') {
    const message = typeof data.error_description === 'string' ? data.error_description : typeof data.error === 'string' ? data.error : `Google OAuth HTTP ${response.status}`;
    throw new Error(`Không thể lấy YouTube access token: ${message}`);
  }
  return data;
}

async function accessToken() {
  const auth = await readAuth().catch(() => undefined);
  if (!auth) throw new Error('YouTube chưa được kết nối.');
  if (auth.accessToken && auth.expiryDate > Date.now() + 60_000) return auth.accessToken;
  if (!auth.refreshToken) throw new Error('YouTube OAuth không có refresh token. Hãy kết nối lại.');
  const data = await tokenRequest({ client_id: auth.clientId, client_secret: auth.clientSecret, refresh_token: auth.refreshToken, grant_type: 'refresh_token' });
  const next: StoredYouTubeAuth = {
    ...auth,
    accessToken: String(data.access_token),
    expiryDate: Date.now() + Math.max(60, Number(data.expires_in) || 3_600) * 1000,
    scope: typeof data.scope === 'string' ? data.scope : auth.scope,
  };
  await writeJsonAtomic(authFile, next);
  return next.accessToken;
}

export function beginYouTubeConnection(clientId: string, clientSecret: string, redirectUri: string) {
  if (!clientId.trim() || !clientSecret.trim()) throw new Error('Thiếu Google OAuth Client ID hoặc Client Secret.');
  const state = randomUUID();
  pendingAuth.set(state, { clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri, expiresAt: Date.now() + 10 * 60_000 });
  const query = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: oauthScopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

export async function finishYouTubeConnection(code: string, state: string) {
  const pending = pendingAuth.get(state);
  pendingAuth.delete(state);
  if (!pending || pending.expiresAt < Date.now()) throw new Error('Phiên kết nối YouTube đã hết hạn. Hãy thử lại.');
  const data = await tokenRequest({ code, client_id: pending.clientId, client_secret: pending.clientSecret, redirect_uri: pending.redirectUri, grant_type: 'authorization_code' });
  const record: StoredYouTubeAuth = {
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    accessToken: String(data.access_token),
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expiryDate: Date.now() + Math.max(60, Number(data.expires_in) || 3_600) * 1000,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
  };
  await writeJsonAtomic(authFile, record);
}

export async function disconnectYouTube() {
  await rm(authFile, { force: true });
}

async function youtubeJson(url: string, init?: RequestInit) {
  const token = await accessToken();
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const googleMessage = ((data.error as { message?: unknown } | undefined)?.message);
    throw new Error(typeof googleMessage === 'string' ? googleMessage : `YouTube API HTTP ${response.status}`);
  }
  return data;
}

export async function youtubeConnectionStatus() {
  const exists = await stat(authFile).then((value) => value.isFile()).catch(() => false);
  if (!exists) return { connected: false as const };
  try {
    const data = await youtubeJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true');
    const channel = Array.isArray(data.items) ? data.items[0] as { id?: unknown; snippet?: { title?: unknown } } | undefined : undefined;
    return { connected: true as const, channelId: typeof channel?.id === 'string' ? channel.id : undefined, channelTitle: typeof channel?.snippet?.title === 'string' ? channel.snippet.title : undefined };
  } catch (error) {
    return { connected: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

async function initiateUpload(file: string, title: string, description: string) {
  const token = await accessToken();
  const info = await stat(file);
  const query = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status', notifySubscribers: 'false' });
  const response = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?${query}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(info.size),
    },
    body: JSON.stringify({
      snippet: { title: title.slice(0, 100), description: description.slice(0, 5_000), categoryId: '24', defaultLanguage: 'vi' },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    }),
  });
  if (!response.ok) throw new Error(`Không thể khởi tạo YouTube upload: HTTP ${response.status} ${await response.text()}`);
  const location = response.headers.get('location');
  if (!location) throw new Error('YouTube không trả về resumable upload URL.');
  return { location, size: info.size, token };
}

async function uploadPrivateVideo(file: string, title: string, description: string) {
  const session = await initiateUpload(file, title, description);
  const response = await fetch(session.location, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(session.size) },
    body: createReadStream(file) as never,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const data = await response.json().catch(() => ({})) as YouTubeVideoResource & { error?: { message?: string } };
  if (!response.ok || !data.id) throw new Error(data.error?.message || `YouTube upload thất bại: HTTP ${response.status}`);
  return data.id;
}

async function getYouTubeVideo(videoId: string) {
  const data = await youtubeJson(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails,contentDetails&id=${encodeURIComponent(videoId)}`);
  const video = Array.isArray(data.items) ? data.items[0] as YouTubeVideoResource | undefined : undefined;
  if (!video) throw new Error('YouTube không còn trả về video test này.');
  return video;
}

export function classifyYouTubeVideoStatus(videoId: string, video: YouTubeVideoResource): ReviewYouTubeStatus {
  const uploadStatus = video.status?.uploadStatus;
  const rejectionReason = video.status?.rejectionReason || video.processingDetails?.processingFailureReason;
  const common = {
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    studioUrl: `https://studio.youtube.com/video/${videoId}/edit`,
    uploadStatus,
    rejectionReason,
    blockedRegions: video.contentDetails?.regionRestriction?.blocked,
    lastCheckedAt: new Date().toISOString(),
  };
  if (uploadStatus === 'rejected' || uploadStatus === 'failed' || video.processingDetails?.processingStatus === 'failed') return { ...common, state: 'rejected' };
  if (uploadStatus === 'processed' || video.processingDetails?.processingStatus === 'succeeded') return { ...common, state: 'manual_check_required' };
  return { ...common, state: 'processing' };
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function executeYouTubeUpload(jobId: string) {
  try {
    const result = await getReviewResult(jobId);
    await updateReviewYouTubeStatus(jobId, { state: 'uploading', lastCheckedAt: nowIso() });
    const videoId = await uploadPrivateVideo(result.path, result.job.plan?.title || 'AutoSub review test', result.job.plan?.description || 'Private copyright check upload from AutoSub.');
    await updateReviewYouTubeStatus(jobId, { state: 'processing', videoId, watchUrl: `https://www.youtube.com/watch?v=${videoId}`, studioUrl: `https://studio.youtube.com/video/${videoId}/edit`, lastCheckedAt: nowIso() });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const classified = classifyYouTubeVideoStatus(videoId, await getYouTubeVideo(videoId));
      await updateReviewYouTubeStatus(jobId, classified);
      if (classified.state !== 'processing') return;
      await delay(5_000);
    }
  } catch (error) {
    const current = await getReviewJob(jobId).catch(() => undefined);
    await updateReviewYouTubeStatus(jobId, { ...current?.youtube, state: 'failed', error: error instanceof Error ? error.message : String(error), lastCheckedAt: nowIso() });
  } finally {
    activeUploads.delete(jobId);
  }
}

const nowIso = () => new Date().toISOString();

export async function startReviewYouTubeUpload(jobId: string) {
  const job = await getReviewJob(jobId);
  if (job.status !== 'completed' || !job.result) throw new Error('Video review chưa dựng xong.');
  if (activeUploads.has(jobId) || ['uploading', 'processing'].includes(job.youtube.state)) return job;
  await accessToken();
  activeUploads.add(jobId);
  void executeYouTubeUpload(jobId);
  return updateReviewYouTubeStatus(jobId, { state: 'uploading', lastCheckedAt: nowIso() });
}

export async function refreshReviewYouTubeStatus(jobId: string) {
  const job = await getReviewJob(jobId);
  if (!job.youtube.videoId) throw new Error('Job chưa có YouTube video để kiểm tra.');
  if (job.youtube.state === 'passed' || job.youtube.state === 'claimed') return job;
  const next = classifyYouTubeVideoStatus(job.youtube.videoId, await getYouTubeVideo(job.youtube.videoId));
  return updateReviewYouTubeStatus(jobId, next);
}

export async function markReviewYouTubeDecision(jobId: string, decision: 'passed' | 'claimed') {
  const job = await getReviewJob(jobId);
  if (!job.youtube.videoId) throw new Error('Job chưa có YouTube video để xác nhận.');
  return updateReviewYouTubeStatus(jobId, { ...job.youtube, state: decision, lastCheckedAt: nowIso(), error: undefined });
}
