import { stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';

const DOUYIN_PAGE_ORIGIN = 'https://www.douyin.com';
const METADATA_ATTEMPTS = 3;
const METADATA_WAIT_MS = 12_000;
const MAX_BROWSER_CONTEXTS = 2;
const CACHE_TTL_MS = 2 * 60_000;

interface DouyinUrlList {
  url_list?: string[];
  data_size?: number;
  width?: number;
  height?: number;
}

interface DouyinBitRate {
  bit_rate?: number;
  format?: string;
  gear_name?: string;
  play_addr?: DouyinUrlList;
}

interface DouyinDetail {
  aweme_id?: string;
  desc?: string;
  duration?: number;
  images?: Array<{ url_list?: string[] }>;
  author?: {
    nickname?: string;
    avatar_thumb?: { url_list?: string[] };
  };
  video?: {
    bit_rate?: DouyinBitRate[];
    play_addr?: DouyinUrlList;
    play_addr_h264?: DouyinUrlList;
    cover?: { url_list?: string[] };
    origin_cover?: { url_list?: string[] };
  };
}

export interface ExtractedDouyinMedia {
  videoId: string;
  title: string;
  author: string;
  authorAvatar?: string;
  coverUrl?: string;
  duration?: number;
  downloadUrl: string;
  expectedBytes?: number;
  isNote: boolean;
}

const mediaCache = new Map<string, { expiresAt: number; media: ExtractedDouyinMedia }>();
let browserPromise: Promise<Browser> | undefined;
let browserPathPromise: Promise<string> | undefined;
let activeContexts = 0;
const contextWaiters: Array<() => void> = [];

async function fileExists(filePath: string | undefined) {
  if (!filePath) return false;
  return Boolean((await stat(filePath).catch(() => undefined))?.isFile());
}

async function findBrowserExecutable() {
  const explicit = process.env.AUTOSUB_BROWSER_PATH?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (await fileExists(resolved)) return resolved;
    throw new Error('AUTOSUB_BROWSER_PATH không trỏ tới Chrome hoặc Edge hợp lệ.');
  }

  const candidates = process.platform === 'win32'
    ? [
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/microsoft-edge',
          '/usr/bin/microsoft-edge-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate as string;
  }
  throw new Error('Không tìm thấy Chrome hoặc Microsoft Edge để xác thực link Douyin. Hãy cài một trong hai trình duyệt, hoặc đặt AUTOSUB_BROWSER_PATH.');
}

async function browserExecutable() {
  browserPathPromise ||= findBrowserExecutable();
  return browserPathPromise;
}

async function sharedBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      executablePath: await browserExecutable(),
      args: ['--disable-blink-features=AutomationControlled'],
    }).then((browser) => {
      browser.once('disconnected', () => { browserPromise = undefined; });
      return browser;
    }).catch((error) => {
      browserPromise = undefined;
      throw error;
    });
  }
  return browserPromise;
}

async function withContextSlot<T>(task: () => Promise<T>) {
  if (activeContexts >= MAX_BROWSER_CONTEXTS) {
    await new Promise<void>((resolve) => contextWaiters.push(resolve));
  }
  activeContexts += 1;
  try {
    return await task();
  } finally {
    activeContexts -= 1;
    contextWaiters.shift()?.();
  }
}

function firstUrl(value?: { url_list?: string[] }) {
  return value?.url_list?.find((url) => /^https?:\/\//i.test(url));
}

export function douyinMediaFromDetail(videoId: string, detail: DouyinDetail): ExtractedDouyinMedia {
  const video = detail.video;
  const playableRates = (video?.bit_rate || [])
    .filter((item) => firstUrl(item.play_addr))
    .sort((left, right) => {
      const leftMp4 = left.format?.toLowerCase() === 'mp4' ? 1 : 0;
      const rightMp4 = right.format?.toLowerCase() === 'mp4' ? 1 : 0;
      if (leftMp4 !== rightMp4) return rightMp4 - leftMp4;
      return (right.play_addr?.data_size || right.bit_rate || 0) - (left.play_addr?.data_size || left.bit_rate || 0);
    });
  const selected = playableRates[0]?.play_addr;
  const downloadUrl = firstUrl(selected) || firstUrl(video?.play_addr_h264) || firstUrl(video?.play_addr) || '';
  const isNote = Boolean(detail.images?.length && !downloadUrl);
  if (!downloadUrl && !isNote) throw new Error('Douyin không trả về luồng video có thể tải. Video có thể đã bị xóa, đặt riêng tư hoặc giới hạn khu vực.');

  return {
    videoId,
    title: (detail.desc || `Douyin_${videoId}`).trim(),
    author: detail.author?.nickname || 'Douyin Creator',
    authorAvatar: firstUrl(detail.author?.avatar_thumb),
    coverUrl: firstUrl(video?.cover) || firstUrl(video?.origin_cover) || firstUrl(detail.images?.[0]),
    duration: detail.duration ? Math.round(detail.duration / 1000) : undefined,
    downloadUrl,
    expectedBytes: selected?.data_size,
    isNote,
  };
}

async function discoverDetail(videoId: string, isNote: boolean, signal?: AbortSignal) {
  return withContextSlot(async () => {
    if (signal?.aborted) throw new Error('Đã hủy tải video Douyin.');
    const browser = await sharedBrowser();
    const context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1280, height: 720 },
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7' },
    });
    const page = await context.newPage();
    const closeOnAbort = () => { void page.close(); };
    signal?.addEventListener('abort', closeOnAbort, { once: true });

    try {
      await page.route('**/*', async (route) => {
        const resourceType = route.request().resourceType();
        if (resourceType === 'media' || resourceType === 'font') await route.abort();
        else await route.continue();
      });

      let detail: DouyinDetail | undefined;
      let notifyDetail: (() => void) | undefined;
      const detailReady = new Promise<void>((resolve) => { notifyDetail = resolve; });
      page.on('response', async (response) => {
        if (detail || !response.url().includes('/aweme/v1/web/aweme/detail/')) return;
        try {
          const payload = await response.json() as { aweme_detail?: DouyinDetail };
          if (payload.aweme_detail?.aweme_id === videoId) {
            detail = payload.aweme_detail;
            notifyDetail?.();
          }
        } catch {
          // The first unsigned request commonly returns an empty 403. Reloading
          // with the fresh challenge cookies allows the signed request to pass.
        }
      });

      const target = `${DOUYIN_PAGE_ORIGIN}/${isNote ? 'note' : 'video'}/${videoId}`;
      for (let attempt = 0; attempt < METADATA_ATTEMPTS && !detail; attempt += 1) {
        if (signal?.aborted) throw new Error('Đã hủy tải video Douyin.');
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((error) => {
          if (signal?.aborted) throw new Error('Đã hủy tải video Douyin.');
          if (attempt === METADATA_ATTEMPTS - 1) throw error;
        });
        if (!detail) await Promise.race([detailReady, page.waitForTimeout(METADATA_WAIT_MS)]);
      }

      if (!detail) throw new Error('Douyin chưa cho phép đọc video sau khi xác thực. Hãy thử lại sau ít phút hoặc kiểm tra video có đang công khai hay không.');
      return detail;
    } finally {
      signal?.removeEventListener('abort', closeOnAbort);
      await context.close().catch(() => undefined);
    }
  });
}

export async function extractDouyinMedia(videoId: string, isNote = false, signal?: AbortSignal) {
  const cached = mediaCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.media;
  const detail = await discoverDetail(videoId, isNote, signal);
  const media = douyinMediaFromDetail(videoId, detail);
  mediaCache.set(videoId, { expiresAt: Date.now() + CACHE_TTL_MS, media });
  return media;
}

export async function closeDouyinExtractor() {
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending) await pending.then((browser) => browser.close()).catch(() => undefined);
}
