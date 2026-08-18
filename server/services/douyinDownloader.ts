import { createWriteStream } from 'node:fs';
import { open, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createUploadSession, safeUploadName } from './uploads';
import { extractDouyinMedia } from './douyinExtractor';

export function extractDouyinUrls(text: string): string[] {
  if (!text) return [];
  // Match patterns like:
  // https://v.douyin.com/iABC123/
  // https://www.douyin.com/video/7391234567890123456
  // https://www.douyin.com/note/7391234567890123456
  // https://www.iesdouyin.com/share/video/7391234567890123456
  const regex = /https?:\/\/(?:v\.douyin\.com\/[A-Za-z0-9_-]+|(?:www\.|ies\.)?douyin\.com\/(?:video|note|share\/video)\/\d+)[^\s]*/gi;
  const matches = text.match(regex) || [];
  const cleaned = matches.map((url) => url.replace(/[),;。，！？\s]+$/, ''));
  return Array.from(new Set(cleaned));
}

export interface DouyinVideoInfo {
  url: string;
  videoId: string;
  title: string;
  author: string;
  authorAvatar?: string;
  coverUrl?: string;
  duration?: number;
  downloadUrl: string;
  expectedBytes?: number;
  isNote?: boolean;
}

export async function resolveDouyinUrl(rawUrl: string, signal?: AbortSignal): Promise<DouyinVideoInfo> {
  const targetUrl = rawUrl.trim();
  let finalUrl = targetUrl;

  const mobileHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    throw new Error(`Đường dẫn Douyin không hợp lệ: ${rawUrl}`);
  }
  const allowedHosts = new Set(['v.douyin.com', 'douyin.com', 'www.douyin.com', 'iesdouyin.com', 'www.iesdouyin.com']);
  if (parsedTarget.protocol !== 'https:' || !allowedHosts.has(parsedTarget.hostname.toLowerCase())) {
    throw new Error(`Đường dẫn không thuộc Douyin: ${rawUrl}`);
  }

  // Short links contain no item id. Follow only the allow-listed Douyin URL,
  // then navigate the canonical long URL in an isolated browser context.
  if (parsedTarget.hostname.toLowerCase() === 'v.douyin.com') {
    try {
      const redirectRes = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: mobileHeaders,
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
    targetUrl.match(/(?:video|note|share\/video)\/(\d+)/);

  if (idMatch && idMatch[1]) {
    videoId = idMatch[1];
  } else {
    throw new Error(`Không tìm thấy ID video Douyin từ đường dẫn: ${rawUrl}`);
  }

  const media = await extractDouyinMedia(videoId, /\/note\//i.test(finalUrl) || /\/note\//i.test(targetUrl), signal);
  return {
    url: rawUrl,
    videoId,
    title: media.title,
    author: media.author,
    authorAvatar: media.authorAvatar,
    coverUrl: media.coverUrl,
    duration: media.duration,
    downloadUrl: media.downloadUrl,
    expectedBytes: media.expectedBytes,
    isNote: media.isNote,
  };
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
  return header.length >= 12 && Buffer.from(header.subarray(4, 8)).toString('ascii') === 'ftyp';
}

async function validateDownloadedVideo(filePath: string, downloadedBytes: number, expectedBytes: number) {
  if (downloadedBytes < 1024) throw new Error(`Video tải về không hợp lệ (${downloadedBytes} byte).`);
  if (expectedBytes > 0 && downloadedBytes !== expectedBytes) {
    throw new Error(`Video tải chưa đủ (${downloadedBytes}/${expectedBytes} byte).`);
  }
  const file = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (!isLikelyMp4Header(header.subarray(0, bytesRead))) throw new Error('File tải về không có chữ ký MP4 hợp lệ.');
  } finally {
    await file.close();
  }
  const stored = await stat(filePath);
  if (stored.size !== downloadedBytes) throw new Error('Dung lượng video trên đĩa không khớp dữ liệu đã tải.');
}

export type DouyinItemState = 'pending' | 'resolving' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DouyinBatchItem {
  id: string;
  originalUrl: string;
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

const MAX_BATCH_CONCURRENCY = 2;

export function createBatchJob(urls: string[], options: { autoStart?: boolean } = {}): DouyinBatchJob {
  const batchId = randomUUID();
  const items: DouyinBatchItem[] = urls.map((url) => ({
    id: randomUUID(),
    originalUrl: url.trim(),
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
        job.status = job.failedItems > 0 && job.completedItems > 0
          ? 'completed_with_errors'
          : job.failedItems === job.totalItems
            ? 'failed'
            : 'completed';
        job.updatedAt = new Date().toISOString();
        activeControllers.delete(batchId);
      }
      return;
    }

    const itemIndex = currentIndex++;
    const item = job.items[itemIndex];
    activeCount++;

    try {
      await processDownloadItem(item, controller.signal);
      if (item.status === 'completed') job.completedItems++;
      else if (item.status === 'failed') job.failedItems++;
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : 'Lỗi tải video.';
      job.failedItems++;
    } finally {
      activeCount--;
      job.updatedAt = new Date().toISOString();
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

async function processDownloadItem(item: DouyinBatchItem, signal: AbortSignal) {
  if (signal.aborted) {
    item.status = 'cancelled';
    return;
  }

  // Step 1: Resolve Douyin Video Information
  item.status = 'resolving';
  item.progressPercent = 5;

  let info: DouyinVideoInfo;
  try {
    info = await resolveDouyinUrl(item.originalUrl, signal);
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
    item.error = error instanceof Error ? error.message : 'Không thể lấy thông tin video Douyin.';
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

  // Step 2: Download Video Stream
  item.status = 'downloading';
  item.progressPercent = 10;

  const downloadHeaders = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    'Referer': 'https://www.douyin.com/',
    'Accept': '*/*',
  };

  let response: Response;
  try {
    response = await fetch(info.downloadUrl, {
      method: 'GET',
      headers: downloadHeaders,
      redirect: 'follow',
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      item.status = 'cancelled';
      return;
    }
    item.status = 'failed';
    item.error = error instanceof Error ? error.message : 'Không thể kết nối máy chủ tải video.';
    return;
  }

  const responseProblem = douyinResponseProblem(response);
  if (responseProblem) {
    item.status = 'failed';
    item.error = responseProblem;
    return;
  }

  const contentLength = response.headers.get('content-length');
  const declaredBytes = contentLength ? parseInt(contentLength, 10) : 0;
  item.totalBytes = Number.isFinite(declaredBytes) && declaredBytes > 0 ? declaredBytes : info.expectedBytes || 0;

  // Step 3: Stream write to AutoSub uploads directory
  const sessionDir = await createUploadSession();
  const uploadId = path.basename(sessionDir);

  const cleanTitle = (info.title || `douyin_${info.videoId}`).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 80).trim();
  const safeFilename = safeUploadName(`${cleanTitle}.mp4`, `douyin_${info.videoId}.mp4`);
  const storedName = `source-${safeFilename}`;
  const targetFilePath = path.join(sessionDir, storedName);

  let downloadedBytes = 0;
  const progressLimiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.length;
      item.downloadedBytes = downloadedBytes;
      if (item.totalBytes > 0) {
        item.progressPercent = Math.min(98, 10 + Math.round((downloadedBytes / item.totalBytes) * 88));
      } else {
        item.progressPercent = Math.min(95, 10 + Math.round(Math.log10(downloadedBytes + 1) * 12));
      }
      callback(null, chunk);
    },
  });

  try {
    const nodeReadable = Readable.fromWeb(response.body as any);
    await pipeline(nodeReadable, progressLimiter, createWriteStream(targetFilePath));

    if (signal.aborted) {
      await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
      item.status = 'cancelled';
      return;
    }

    await validateDownloadedVideo(targetFilePath, downloadedBytes, item.totalBytes);

    // Step 4: Write upload.json metadata to integrate seamlessly with AutoSub
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
    item.uploadId = uploadId;
    item.storedPath = record.storedPath;
    item.filename = safeFilename;
    item.fileSize = downloadedBytes;
  } catch (error) {
    await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
    if (signal.aborted) {
      item.status = 'cancelled';
      return;
    }
    item.status = 'failed';
    item.error = error instanceof Error ? error.message : 'Lỗi khi lưu file video.';
  }
}
