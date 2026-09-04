import { createWriteStream } from 'node:fs';
import { open, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createUploadSession, safeUploadName } from './uploads';
import { extractDouyinMedia } from './douyinExtractor';
import { isBilibiliUrl, resolveBilibiliUrl, type BilibiliQuality } from './bilibiliExtractor';
import { run } from './ffmpeg';

export function extractDouyinUrls(text: string): string[] {
  if (!text) return [];
  const regex = /https?:\/\/(?:v\.douyin\.com\/[A-Za-z0-9_-]+\/?|(?:www\.|ies\.|m\.)?douyin\.com\/(?:video|note|share\/video)\/\d+|(?:www\.|ies\.|m\.)?douyin\.com\/[^\s]*[?&](?:modal_id|item_ids)=\d+|(?:www\.)?b23\.tv\/[A-Za-z0-9_-]+\/?|(?:(?:www|m)\.)?bilibili\.com\/video\/(?:BV[0-9A-Za-z]+|av\d+))[^\s]*/gi;
  const matches = text.match(regex) || [];
  const cleaned = matches.map((url) => url.replace(/[),;。，！？\s]+$/, ''));
  return Array.from(new Set(cleaned));
}

export interface DouyinVideoInfo {
  platform: 'douyin' | 'bilibili';
  url: string;
  videoId: string;
  title: string;
  author: string;
  authorAvatar?: string;
  coverUrl?: string;
  duration?: number;
  downloadUrl: string;
  backupUrls?: string[];
  expectedBytes?: number;
  isNote?: boolean;
  referer?: string;
}

export async function resolveDouyinUrl(rawUrl: string, signal?: AbortSignal): Promise<DouyinVideoInfo> {
  const targetUrl = rawUrl.trim();
  let finalUrl = targetUrl;

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    throw new Error(`Đường dẫn Douyin không hợp lệ: ${rawUrl}`);
  }
  const allowedHosts = new Set(['v.douyin.com', 'douyin.com', 'www.douyin.com', 'iesdouyin.com', 'www.iesdouyin.com', 'm.douyin.com', 'live.douyin.com']);
  if (parsedTarget.protocol !== 'https:' && parsedTarget.protocol !== 'http:') {
    throw new Error(`Đường dẫn không hợp lệ: ${rawUrl}`);
  }
  if (!allowedHosts.has(parsedTarget.hostname.toLowerCase())) {
    throw new Error(`Đường dẫn không thuộc Douyin: ${rawUrl}`);
  }

  // Short links contain no item id. Follow redirect to obtain canonical URL.
  if (parsedTarget.hostname.toLowerCase() === 'v.douyin.com') {
    try {
      const redirectRes = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: browserHeaders,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      });
      finalUrl = redirectRes.url || targetUrl;
    } catch (error) {
      if (signal?.aborted) throw new Error('Đã hủy tải video Douyin.');
      throw new Error(`Không thể mở link rút gọn Douyin: ${error instanceof Error ? error.message : 'lỗi mạng'}`);
    }
  }

  // Extract ID from final or raw URL
  let videoId = '';
  const idMatch = finalUrl.match(/(?:video|note|share\/video)\/(\d+)/) ||
    finalUrl.match(/modal_id=(\d+)/) ||
    finalUrl.match(/item_ids=(\d+)/) ||
    targetUrl.match(/(?:video|note|share\/video)\/(\d+)/) ||
    targetUrl.match(/modal_id=(\d+)/) ||
    targetUrl.match(/item_ids=(\d+)/);

  if (idMatch && idMatch[1]) {
    videoId = idMatch[1];
  } else {
    throw new Error(`Không tìm thấy ID video Douyin từ đường dẫn: ${rawUrl}`);
  }

  const media = await extractDouyinMedia(videoId, /\/note\//i.test(finalUrl) || /\/note\//i.test(targetUrl), signal);
  return {
    platform: 'douyin',
    url: rawUrl,
    videoId,
    title: media.title,
    author: media.author,
    authorAvatar: media.authorAvatar,
    coverUrl: media.coverUrl,
    duration: media.duration,
    downloadUrl: media.downloadUrl,
    backupUrls: media.backupUrls,
    expectedBytes: media.expectedBytes,
    isNote: media.isNote,
    referer: 'https://www.douyin.com/',
  };
}

export async function resolveSupportedVideoUrl(rawUrl: string, signal?: AbortSignal, bilibiliQuality: BilibiliQuality = 64): Promise<DouyinVideoInfo> {
  if (isBilibiliUrl(rawUrl)) return resolveBilibiliUrl(rawUrl, signal, bilibiliQuality);
  return resolveDouyinUrl(rawUrl, signal);
}

export function douyinResponseProblem(response: Pick<Response, 'ok' | 'status' | 'headers' | 'body'>) {
  if (!response.ok || !response.body) return `Tải video thất bại (Mã HTTP: ${response.status}).`;
  const rawLength = response.headers.get('content-length');
  const declaredLength = rawLength === null ? undefined : Number(rawLength);
  if (declaredLength === 0) return 'Douyin trả về luồng video rỗng (0 byte).';
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (contentType.includes('text/html') || contentType.includes('application/json') || contentType.includes('text/plain')) {
    return `Douyin trả về ${contentType.split(';')[0]} thay vì video.`;
  }
  return undefined;
}

export function isLikelyMp4Header(header: Uint8Array) {
  if (header.length < 8) return false;
  // Standard MP4 ftyp box at offset 4
  if (header.length >= 12 && Buffer.from(header.subarray(4, 8)).toString('ascii') === 'ftyp') return true;
  // Scan first 32 bytes for 'ftyp' or 'moov'
  const hex = Buffer.from(header.subarray(0, Math.min(header.length, 32))).toString('ascii');
  return hex.includes('ftyp') || hex.includes('moov');
}

async function validateDownloadedVideo(filePath: string, downloadedBytes: number, _expectedBytes: number) {
  if (downloadedBytes < 1024) throw new Error(`Video tải về không hợp lệ (${downloadedBytes} byte).`);
  const file = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(32);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (!isLikelyMp4Header(header.subarray(0, bytesRead))) {
      throw new Error('File tải về không có chữ ký MP4 hợp lệ.');
    }
  } finally {
    await file.close();
  }
  const stored = await stat(filePath);
  if (stored.size !== downloadedBytes) {
    throw new Error('Dung lượng video trên đĩa không khớp dữ liệu đã tải.');
  }
}

export async function convertHevcToH264IfNeeded(filePath: string, signal?: AbortSignal): Promise<boolean> {
  const probe = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', filePath,
  ], signal);
  if (!['hevc', 'h265'].includes(probe.stdout.trim().toLowerCase())) return false;

  const convertedPath = `${filePath}.h264.mp4`;
  try {
    await run('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', filePath,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', convertedPath,
    ], signal);
    await rm(filePath, { force: true });
    await rename(convertedPath, filePath);
    return true;
  } finally {
    await rm(convertedPath, { force: true }).catch(() => undefined);
  }
}

async function downloadWithFfmpegReconnect(
  url: string,
  targetFilePath: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  onProgress: (downloaded: number) => void,
) {
  const extraHeaders = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() !== 'user-agent')
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('');
  let progressBuffer = '';
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostats',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_on_http_error', '4xx,5xx',
    '-reconnect_max_retries', '20',
    '-reconnect_delay_max', '10',
    '-reconnect_delay_total_max', '180',
    '-user_agent', headers['User-Agent'] || 'Mozilla/5.0',
    ...(extraHeaders ? ['-headers', extraHeaders] : []),
    '-i', url,
    '-map', '0', '-c', 'copy',
    '-progress', 'pipe:2',
    targetFilePath,
  ], signal, (chunk) => {
    progressBuffer = (progressBuffer + chunk).slice(-4096);
    for (const match of progressBuffer.matchAll(/total_size=(\d+)/g)) onProgress(Number(match[1]));
  });
  return (await stat(targetFilePath)).size;
}

export type DouyinItemState = 'pending' | 'resolving' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DouyinBatchItem {
  id: string;
  originalUrl: string;
  platform?: 'douyin' | 'bilibili';
  bilibiliQuality?: BilibiliQuality;
  videoId?: string;
  title?: string;
  author?: string;
  authorAvatar?: string;
  coverUrl?: string;
  duration?: number;
  status: DouyinItemState;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadSpeedBytesPerSecond?: number;
  etaSeconds?: number;
  error?: string;
  uploadId?: string;
  storedPath?: string;
  filename?: string;
  fileSize?: number;
}

export interface DouyinBatchJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  createdAt: string;
  updatedAt: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  items: DouyinBatchItem[];
}

const batchJobs = new Map<string, DouyinBatchJob>();
const activeControllers = new Map<string, AbortController>();
const activeItemControllers = new Map<string, AbortController>();

const MAX_BATCH_CONCURRENCY = 3;
const PARALLEL_CHUNKS_PER_FILE = 6;
const RANGE_REQUEST_BYTES = 8 * 1024 * 1024;
const BILIBILI_RANGE_REQUEST_BYTES = 64 * 1024 * 1024;

function updateBatchSummary(job: DouyinBatchJob) {
  job.completedItems = job.items.filter((item) => item.status === 'completed').length;
  job.failedItems = job.items.filter((item) => item.status === 'failed').length;
  const hasActiveItems = job.items.some((item) => item.status === 'pending' || item.status === 'resolving' || item.status === 'downloading');
  if (hasActiveItems) job.status = 'running';
  else if (job.failedItems > 0 && job.completedItems > 0) job.status = 'completed_with_errors';
  else if (job.failedItems > 0) job.status = 'failed';
  else job.status = 'completed';
  job.updatedAt = new Date().toISOString();
}

function startAddedItemImmediately(job: DouyinBatchJob, item: DouyinBatchItem) {
  const itemController = new AbortController();
  activeItemControllers.set(item.id, itemController);
  const batchSignal = activeControllers.get(job.id)?.signal;
  const signal = batchSignal ? AbortSignal.any([batchSignal, itemController.signal]) : itemController.signal;
  job.status = 'running';
  void (async () => {
    try {
      await processDownloadItem(item, signal);
    } catch (error) {
      if (item.status !== 'cancelled') {
        item.status = 'failed';
        item.error = error instanceof Error ? error.message : 'Lỗi tải video.';
      }
    } finally {
      activeItemControllers.delete(item.id);
      updateBatchSummary(job);
    }
  })();
}

export function recommendedBilibiliConnections(totalBytes: number) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 6;
  if (totalBytes < 32 * 1024 * 1024) return 4;
  if (totalBytes < 1536 * 1024 * 1024) return 8;
  if (totalBytes < 4 * 1024 * 1024 * 1024) return 6;
  return 4;
}

export function createBatchJob(urls: string[], options: { autoStart?: boolean; bilibiliQuality?: BilibiliQuality } = {}): DouyinBatchJob {
  const batchId = randomUUID();
  const items: DouyinBatchItem[] = urls.map((url) => ({
    id: randomUUID(),
    originalUrl: url.trim(),
    bilibiliQuality: options.bilibiliQuality || 64,
    status: 'pending',
    progressPercent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  }));

  const job: DouyinBatchJob = {
    id: batchId,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalItems: items.length,
    completedItems: 0,
    failedItems: 0,
    items,
  };

  batchJobs.set(batchId, job);
  if (options.autoStart !== false) startBatchProcessing(batchId);
  return job;
}

export function getBatchJob(batchId: string): DouyinBatchJob | undefined {
  return batchJobs.get(batchId);
}

export function appendToBatchJob(batchId: string, urls: string[], bilibiliQuality: BilibiliQuality = 64): DouyinBatchJob | undefined {
  const job = batchJobs.get(batchId);
  if (!job || job.status === 'cancelled') return undefined;
  const items = urls
    .map((url): DouyinBatchItem => ({
      id: randomUUID(), originalUrl: url.trim(), bilibiliQuality,
      status: 'pending', progressPercent: 0, downloadedBytes: 0, totalBytes: 0,
    }));
  job.items.push(...items);
  job.totalItems = job.items.length;
  job.updatedAt = new Date().toISOString();
  if (job.status !== 'queued') items.forEach((item) => startAddedItemImmediately(job, item));
  return job;
}

export function cancelBatchJob(batchId: string): boolean {
  const job = batchJobs.get(batchId);
  if (!job) return false;
  const controller = activeControllers.get(batchId);
  if (controller) {
    controller.abort();
    activeControllers.delete(batchId);
  }
  job.status = 'cancelled';
  job.updatedAt = new Date().toISOString();
  for (const item of job.items) {
    if (item.status === 'pending' || item.status === 'resolving' || item.status === 'downloading') {
      item.status = 'cancelled';
    }
  }
  return true;
}

export function cancelBatchItem(batchId: string, itemId: string): boolean {
  const job = batchJobs.get(batchId);
  const item = job?.items.find((entry) => entry.id === itemId);
  if (!job || !item || item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') return false;
  item.status = 'cancelled';
  item.error = undefined;
  item.progressPercent = 0;
  activeItemControllers.get(itemId)?.abort();
  activeItemControllers.delete(itemId);
  job.updatedAt = new Date().toISOString();
  return true;
}

async function startBatchProcessing(batchId: string) {
  const job = batchJobs.get(batchId);
  if (!job || job.status === 'cancelled') return;

  const controller = new AbortController();
  activeControllers.set(batchId, controller);
  job.status = 'running';
  job.updatedAt = new Date().toISOString();

  let activeCount = 0;
  let currentIndex = 0;

  const runNext = async (): Promise<void> => {
    if (controller.signal.aborted || job.status === 'cancelled') return;

    if (currentIndex >= job.items.length) {
      if (activeCount === 0) {
        updateBatchSummary(job);
        activeControllers.delete(batchId);
      }
      return;
    }

    const itemIndex = currentIndex++;
    const item = job.items[itemIndex];
    if (item.status !== 'pending') {
      void runNext();
      return;
    }
    activeCount++;
    const itemController = new AbortController();
    activeItemControllers.set(item.id, itemController);

    try {
      await processDownloadItem(item, AbortSignal.any([controller.signal, itemController.signal]));
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : 'Lỗi tải video.';
    } finally {
      activeItemControllers.delete(item.id);
      activeCount--;
      updateBatchSummary(job);
      if (!controller.signal.aborted && (job.status as DouyinBatchJob['status']) !== 'cancelled') {
        void runNext();
      }
    }
  };

  const pool = [];
  const concurrency = Math.min(MAX_BATCH_CONCURRENCY, job.items.length);
  for (let i = 0; i < concurrency; i++) {
    pool.push(runNext());
  }
}

/**
 * High-Speed Multi-Threaded Chunk Stream Downloader
 */
export async function downloadTurboStream(
  url: string,
  targetFilePath: string,
  totalBytes: number,
  headers: Record<string, string>,
  signal: AbortSignal,
  onProgress: (downloaded: number) => void,
  maxConcurrency = PARALLEL_CHUNKS_PER_FILE,
  rangeRequestBytes = RANGE_REQUEST_BYTES,
): Promise<number> {
  const concurrency = Math.min(maxConcurrency, Math.max(1, Math.floor(totalBytes / (2 * 1024 * 1024))));

  const downloadSingleStream = async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new Error('Đã hủy tải video.');
      try {
        const res = await fetch(url, { method: 'GET', headers, signal });
        const problem = douyinResponseProblem(res);
        if (problem) throw new Error(problem);

        let downloadedBytes = 0;
        const progressLimiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            downloadedBytes += chunk.length;
            onProgress(downloadedBytes);
            callback(null, chunk);
          },
        });

        const nodeReadable = Readable.fromWeb(res.body as any);
        await pipeline(nodeReadable, progressLimiter, createWriteStream(targetFilePath));
        return downloadedBytes;
      } catch (error) {
        if (signal.aborted) throw new Error('Đã hủy tải video.');
        lastError = error;
        await rm(targetFilePath, { force: true }).catch(() => undefined);
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1_000));
      }
    }
    const detail = lastError instanceof Error ? lastError.message : 'kết nối bị đóng';
    throw new Error(`Kết nối CDN bị ngắt khi đang tải. Đã tự thử lại 3 lần: ${detail}`);
  };

  if (totalBytes <= 0 || totalBytes < 4 * 1024 * 1024) {
    return downloadSingleStream();
  }

  let supportsRanges = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const probe = await fetch(url, {
      method: 'GET',
      headers: { ...headers, Range: 'bytes=0-0' },
      signal,
    });
    supportsRanges = probe.status === 206;
    await probe.body?.cancel().catch(() => undefined);
    if (supportsRanges) break;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!supportsRanges) {
    return downloadSingleStream();
  }

  const fileHandle = await open(targetFilePath, 'w+');
  try {
    // Parallel multi-part download
    await fileHandle.truncate(totalBytes);
    const chunkSize = Math.ceil(totalBytes / concurrency);
    let totalDownloaded = 0;

    const workerTasks = [];
    for (let i = 0; i < concurrency; i++) {
      const start = i * chunkSize;
      const end = Math.min(totalBytes - 1, (i + 1) * chunkSize - 1);
      if (start > end) break;

      workerTasks.push((async () => {
        let chunkOffset = start;
        let retryCount = 0;

        while (chunkOffset <= end) {
          if (signal.aborted) throw new Error('Đã hủy tải video.');
          const requestEnd = Math.min(end, chunkOffset + rangeRequestBytes - 1);
          const requestStart = chunkOffset;
          try {
            const res = await fetch(url, {
              method: 'GET',
              headers: {
                ...headers,
                Range: `bytes=${chunkOffset}-${requestEnd}`,
              },
              signal,
            });

            if (res.status !== 206 || !res.body) {
              await res.body?.cancel().catch(() => undefined);
              throw new Error(`Máy chủ không hỗ trợ tải tiếp theo từng phần (${res.status}).`);
            }

            const reader = res.body.getReader();
            while (chunkOffset <= requestEnd) {
              if (signal.aborted) throw new Error('Đã hủy tải video.');
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.length > 0) {
                const length = Math.min(value.length, requestEnd - chunkOffset + 1);
                await fileHandle.write(value, 0, length, chunkOffset);
                chunkOffset += length;
                totalDownloaded += length;
                onProgress(totalDownloaded);
              }
            }

            if (chunkOffset <= requestEnd) throw new Error('Kết nối tải kết thúc sớm.');
            retryCount = 0;
          } catch (error) {
            if (signal.aborted) throw new Error('Đã hủy tải video.');
            // Some Bilibili CDNs repeatedly close a valid range response after
            // only a few hundred KiB. Continue from the bytes already written;
            // count only attempts that made no forward progress as failures.
            retryCount = chunkOffset > requestStart ? 0 : retryCount + 1;
            if (retryCount >= 6) {
              const message = error instanceof Error ? error.message : 'kết nối bị ngắt';
              throw new Error(`Kết nối CDN bị ngắt nhiều lần: ${message}`);
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(4_000, retryCount * 750)));
          }
        }
      })());
    }

    const results = await Promise.allSettled(workerTasks);
    const failedResult = results.find((result) => result.status === 'rejected');
    if (failedResult) {
      await fileHandle.close().catch(() => undefined);
      return downloadSingleStream();
    }
    return totalDownloaded;
  } finally {
    await fileHandle.close().catch(() => undefined);
  }
}

async function processDownloadItem(item: DouyinBatchItem, signal: AbortSignal) {
  if (signal.aborted) {
    item.status = 'cancelled';
    return;
  }

  // Step 1: Resolve source video information
  item.status = 'resolving';
  item.progressPercent = 5;

  let info: DouyinVideoInfo;
  try {
    info = await resolveSupportedVideoUrl(item.originalUrl, signal, item.bilibiliQuality || 64);
    item.platform = info.platform;
    item.videoId = info.videoId;
    item.title = info.title;
    item.author = info.author;
    item.authorAvatar = info.authorAvatar;
    item.coverUrl = info.coverUrl;
    item.duration = info.duration;
  } catch (error) {
    if (signal.aborted) {
      item.status = 'cancelled';
      return;
    }
    item.status = 'failed';
    item.error = error instanceof Error ? error.message : 'Không thể lấy thông tin video.';
    return;
  }

  if (signal.aborted) {
    item.status = 'cancelled';
    return;
  }

  if (info.isNote) {
    item.status = 'failed';
    item.error = 'Đường dẫn này là bài viết ảnh (Note), không phải video.';
    return;
  }

  // Step 2: Download Video Stream with high-speed parallel chunks & candidate fallback
  item.status = 'downloading';
  item.progressPercent = 10;

  const downloadHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': info.referer || 'https://www.douyin.com/',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };

  const candidateUrls = [info.downloadUrl, ...(info.backupUrls || [])].filter(Boolean);
  const sessionDir = await createUploadSession();
  const uploadId = path.basename(sessionDir);

  const sourcePrefix = info.platform === 'bilibili' ? 'bilibili' : 'douyin';
  const cleanTitle = (info.title || `${sourcePrefix}_${info.videoId}`).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 80).trim();
  const safeFilename = safeUploadName(`${cleanTitle}.mp4`, `${sourcePrefix}_${info.videoId}.mp4`);
  const storedName = `source-${safeFilename}`;
  const targetFilePath = path.join(sessionDir, storedName);

  let downloadedBytes = 0;
  let downloadSuccess = false;
  let lastError: string | undefined;

  for (const url of candidateUrls) {
    if (signal.aborted) break;

    try {
      const downloadStartedAt = Date.now();
      // Check content-length via fast probe
      let targetBytes = info.expectedBytes || 0;
      if (!targetBytes) {
        const probeRes = await fetch(url, {
          method: 'HEAD',
          headers: downloadHeaders,
          signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        }).catch(() => null);

        if (probeRes?.ok) {
          const cl = probeRes.headers.get('content-length');
          if (cl) targetBytes = parseInt(cl, 10);
        }
      }

      item.totalBytes = targetBytes;

      downloadedBytes = await downloadTurboStream(
        url,
        targetFilePath,
        targetBytes,
        downloadHeaders,
        signal,
        (current) => {
          item.downloadedBytes = current;
          const elapsedSeconds = Math.max(0.5, (Date.now() - downloadStartedAt) / 1000);
          item.downloadSpeedBytesPerSecond = Math.round(current / elapsedSeconds);
          item.etaSeconds = item.totalBytes > current && item.downloadSpeedBytesPerSecond > 0
            ? Math.round((item.totalBytes - current) / item.downloadSpeedBytesPerSecond)
            : undefined;
          if (item.totalBytes > 0) {
            item.progressPercent = Math.min(98, 10 + Math.round((current / item.totalBytes) * 88));
          } else {
            item.progressPercent = Math.min(95, 10 + Math.round(Math.log10(current + 1) * 12));
          }
        },
        info.platform === 'bilibili'
          ? recommendedBilibiliConnections(targetBytes)
          : PARALLEL_CHUNKS_PER_FILE,
        info.platform === 'bilibili' ? BILIBILI_RANGE_REQUEST_BYTES : RANGE_REQUEST_BYTES,
      );

      await validateDownloadedVideo(targetFilePath, downloadedBytes, item.totalBytes);
      downloadSuccess = true;
      break;
    } catch (err) {
      await rm(targetFilePath, { force: true }).catch(() => undefined);
      if (!signal.aborted) {
        try {
          downloadedBytes = await downloadWithFfmpegReconnect(
            url, targetFilePath, downloadHeaders, signal,
            (current) => {
              item.downloadedBytes = current;
              if (item.totalBytes > 0) item.progressPercent = Math.min(98, 10 + Math.round((current / item.totalBytes) * 88));
            },
          );
          await validateDownloadedVideo(targetFilePath, downloadedBytes, item.totalBytes);
          downloadSuccess = true;
          break;
        } catch (fallbackError) {
          lastError = fallbackError instanceof Error ? fallbackError.message : 'Lỗi kết nối máy chủ video.';
          await rm(targetFilePath, { force: true }).catch(() => undefined);
        }
      } else {
        lastError = err instanceof Error ? err.message : 'Đã hủy tải video.';
      }
    }
  }

  if (signal.aborted) {
    await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
    item.status = 'cancelled';
    return;
  }

  if (!downloadSuccess) {
    await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
    item.status = 'failed';
    item.error = lastError || `Không thể tải video từ máy chủ ${info.platform === 'bilibili' ? 'Bilibili' : 'Douyin'}.`;
    return;
  }

  try {
    if (info.platform === 'douyin') {
      await convertHevcToH264IfNeeded(targetFilePath, signal);
      downloadedBytes = (await stat(targetFilePath)).size;
      item.downloadedBytes = downloadedBytes;
      item.totalBytes = downloadedBytes;
    }

    // Step 3: Write upload.json metadata to integrate seamlessly with AutoSub
    const record = {
      uploadId,
      filename: safeFilename,
      contentType: 'video/mp4',
      size: downloadedBytes,
      storedPath: path.posix.join('uploads', uploadId, storedName),
      sourceMode: 'copied',
    };

    await writeFile(path.join(sessionDir, 'upload.json'), JSON.stringify(record, null, 2), 'utf8');

    item.status = 'completed';
    item.progressPercent = 100;
    item.etaSeconds = 0;
    item.uploadId = uploadId;
    item.storedPath = record.storedPath;
    item.filename = safeFilename;
    item.fileSize = downloadedBytes;
  } catch (error) {
    await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
    item.status = 'failed';
    item.error = error instanceof Error ? error.message : 'Lỗi khi lưu thông tin video.';
  }
}
