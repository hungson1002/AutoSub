import { stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';

const DOUYIN_PAGE_ORIGIN = 'https://www.douyin.com';
const METADATA_ATTEMPTS = 2;
const METADATA_WAIT_MS = 8_000;
const MAX_BROWSER_CONTEXTS = 2;
const CACHE_TTL_MS = 5 * 60_000;

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

export interface DouyinDetail {
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
  backupUrls?: string[];
  expectedBytes?: number;
  isNote: boolean;
}

const mediaCache = new Map<string, { expiresAt: number; media: ExtractedDouyinMedia }>();
let browserPromise: Promise<Browser> | undefined;
let browserPathPromise: Promise<string> | undefined;
let activeContexts = 0;
const contextWaiters: Array<() => void> = [];

let cachedTtwid = '';
let ttwidExpiresAt = 0;

async function getTtwidToken(signal?: AbortSignal): Promise<string> {
  if (cachedTtwid && Date.now() < ttwidExpiresAt) {
    return cachedTtwid;
  }

  // Strategy A: Register token with ByteDance Union Service
  try {
    const res = await fetch('https://ttwid.bytedance.com/ttwid/union/register/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region: 'cn',
        aid: 1768,
        needFid: '0',
        service: 'www.ixigua.com',
        migrate_info: { ticket: '', src: 'uc' },
        cbUrlProtocol: 'https',
        union: true,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
    });
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/ttwid=[^;]+/);
    if (match) {
      cachedTtwid = match[0];
      ttwidExpiresAt = Date.now() + 60 * 60 * 1000;
      return cachedTtwid;
    }
  } catch {
    // Continue to next strategy
  }

  // Strategy B: Acquire cookies directly from douyin.com
  try {
    const res = await fetch('https://www.douyin.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
    });
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/ttwid=[^;]+/);
    if (match) {
      cachedTtwid = match[0];
      ttwidExpiresAt = Date.now() + 60 * 60 * 1000;
      return cachedTtwid;
    }
  } catch {
    // Return empty if cookie fetch fails
  }

  return cachedTtwid || '';
}

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
  throw new Error('Không tìm thấy Chrome hoặc Microsoft Edge để xác thực link Douyin.');
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
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
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

function cleanPlayUrl(rawUrl?: string): string {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return '';
  // Remove watermark redirect flag if present
  return rawUrl.replace(/playwm\/?/gi, 'play/');
}

function firstUrl(value?: { url_list?: string[] }) {
  const list = value?.url_list || [];
  for (const u of list) {
    const cleaned = cleanPlayUrl(u);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function allValidUrls(value?: { url_list?: string[] }): string[] {
  const list = value?.url_list || [];
  const results: string[] = [];
  for (const u of list) {
    const cleaned = cleanPlayUrl(u);
    if (cleaned && !results.includes(cleaned)) {
      results.push(cleaned);
    }
  }
  return results;
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
  const primaryUrl = firstUrl(selected) || firstUrl(video?.play_addr_h264) || firstUrl(video?.play_addr) || '';

  const backupCandidates = new Set<string>();
  for (const u of allValidUrls(selected)) backupCandidates.add(u);
  for (const u of allValidUrls(video?.play_addr_h264)) backupCandidates.add(u);
  for (const u of allValidUrls(video?.play_addr)) backupCandidates.add(u);
  for (const rate of playableRates) {
    for (const u of allValidUrls(rate.play_addr)) backupCandidates.add(u);
  }
  backupCandidates.delete(primaryUrl);

  const isNote = Boolean(detail.images?.length && !primaryUrl);
  if (!primaryUrl && !isNote) {
    throw new Error('Douyin không trả về luồng video có thể tải. Video có thể đã bị xóa, đặt riêng tư hoặc giới hạn khu vực.');
  }

  return {
    videoId,
    title: (detail.desc || `Douyin_${videoId}`).trim(),
    author: detail.author?.nickname || 'Douyin Creator',
    authorAvatar: firstUrl(detail.author?.avatar_thumb),
    coverUrl: firstUrl(video?.cover) || firstUrl(video?.origin_cover) || firstUrl(detail.images?.[0]),
    duration: detail.duration ? Math.round(detail.duration / 1000) : undefined,
    downloadUrl: primaryUrl,
    backupUrls: Array.from(backupCandidates),
    expectedBytes: selected?.data_size || video?.play_addr?.data_size,
    isNote,
  };
}

/**
 * Strategy 1: High-Speed Web API using authenticated ttwid token
 */
async function fetchViaWebApi(videoId: string, signal?: AbortSignal): Promise<DouyinDetail | undefined> {
  const ttwid = await getTtwidToken(signal);
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383&device_platform=webapp&channel=channel_pc_web&pc_client_type=1&version_code=190500&version_name=19.5.0`;

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://www.douyin.com/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (ttwid) headers['Cookie'] = ttwid;

  const res = await fetch(apiUrl, {
    method: 'GET',
    headers,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
  });

  if (!res.ok) return undefined;
  const data = await res.json().catch(() => null) as { aweme_detail?: DouyinDetail } | null;
  if (data?.aweme_detail && (data.aweme_detail.aweme_id === videoId || data.aweme_detail.desc || data.aweme_detail.video)) {
    return data.aweme_detail;
  }
  return undefined;
}

/**
 * Strategy 2: Mobile Iesdouyin API
 */
async function fetchViaIesApi(videoId: string, signal?: AbortSignal): Promise<DouyinDetail | undefined> {
  const apiUrl = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${videoId}`;
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Referer': 'https://www.iesdouyin.com/',
      'Accept': 'application/json',
    },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
  });

  if (!res.ok) return undefined;
  const data = await res.json().catch(() => null) as { item_list?: DouyinDetail[] } | null;
  if (data?.item_list && data.item_list.length > 0) {
    return data.item_list[0];
  }
  return undefined;
}

/**
 * Strategy 3: Direct SSR HTML Scraping (extracts embedded JSON from scripts)
 */
async function fetchViaHtmlScraping(videoId: string, isNote: boolean, signal?: AbortSignal): Promise<DouyinDetail | undefined> {
  const urls = [
    `https://www.iesdouyin.com/share/video/${videoId}`,
    `https://www.douyin.com/video/${videoId}`,
    `https://www.douyin.com/note/${videoId}`,
  ];

  for (const targetUrl of urls) {
    if (signal?.aborted) return undefined;
    try {
      const res = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
      });

      const html = await res.text();
      // Try parsing RENDER_DATA / _ROUTER_DATA / _SSR_DATA / __UNIVERSAL_DATA_FOR_REHYDRATION__
      const renderMatch = html.match(/<script id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/i);
      if (renderMatch) {
        const decoded = decodeURIComponent(renderMatch[1].trim());
        const json = JSON.parse(decoded);
        const item = json?.appContext?.appContext?.awemeDetail || json?.awemeDetail || Object.values(json || {}).find((v: any) => v?.aweme_id === videoId);
        if (item) return item as DouyinDetail;
      }

      const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
      if (universalMatch) {
        const json = JSON.parse(universalMatch[1].trim());
        const defaultScope = json?.__DEFAULT_SCOPE__;
        const detail = defaultScope?.[`aweme.detail`] || defaultScope?.[`awemeDetail`] || defaultScope?.aweme?.detail;
        if (detail?.aweme_id === videoId || detail?.video) return detail as DouyinDetail;
      }

      const routerMatch = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i);
      if (routerMatch) {
        const json = JSON.parse(routerMatch[1]);
        const loaderData = json?.loaderData;
        if (loaderData) {
          for (const key of Object.keys(loaderData)) {
            const entry = loaderData[key];
            if (entry?.videoInfoRes?.item_list?.[0]) return entry.videoInfoRes.item_list[0];
            if (entry?.aweme_detail) return entry.aweme_detail;
          }
        }
      }
    } catch {
      // Continue to next URL
    }
  }
  return undefined;
}

/**
 * Strategy 4: Deep Playwright Browser Automation with DOM inspection & network sniffing
 */
async function discoverDetailViaBrowser(videoId: string, isNote: boolean, signal?: AbortSignal): Promise<DouyinDetail> {
  return withContextSlot(async () => {
    if (signal?.aborted) throw new Error('Đã hủy tải video Douyin.');
    const browser = await sharedBrowser();
    const context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1280, height: 720 },
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
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
          if (payload.aweme_detail?.aweme_id === videoId || payload.aweme_detail?.video) {
            detail = payload.aweme_detail;
            notifyDetail?.();
          }
        } catch {
          // Ignore parse errors from challenges
        }
      });

      const target = `${DOUYIN_PAGE_ORIGIN}/${isNote ? 'note' : 'video'}/${videoId}`;
      for (let attempt = 0; attempt < METADATA_ATTEMPTS && !detail; attempt += 1) {
        if (signal?.aborted) throw new Error('Đã hủy tải video Douyin.');
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((error) => {
          if (signal?.aborted) throw new Error('Đã hủy tải video Douyin.');
          if (attempt === METADATA_ATTEMPTS - 1 && !detail) throw error;
        });

        if (!detail) {
          await Promise.race([detailReady, page.waitForTimeout(METADATA_WAIT_MS)]);
        }

        // Try inspecting page DOM directly
        if (!detail) {
          const domDetail = await page.evaluate((vId) => {
            try {
              const domDocument = (globalThis as any).document;
              const renderTag = domDocument.querySelector('#RENDER_DATA');
              if (renderTag?.textContent) {
                const decoded = decodeURIComponent(renderTag.textContent.trim());
                const json = JSON.parse(decoded);
                const item = json?.appContext?.appContext?.awemeDetail || json?.awemeDetail;
                if (item) return item;
              }
              const universalTag = domDocument.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
              if (universalTag?.textContent) {
                const json = JSON.parse(universalTag.textContent.trim());
                const scope = json?.__DEFAULT_SCOPE__;
                const d = scope?.[`aweme.detail`] || scope?.[`awemeDetail`];
                if (d) return d;
              }
              const win = (globalThis as any).window;
              if (win._ROUTER_DATA?.loaderData) {
                for (const k of Object.keys(win._ROUTER_DATA.loaderData)) {
                  const entry = win._ROUTER_DATA.loaderData[k];
                  if (entry?.videoInfoRes?.item_list?.[0]) return entry.videoInfoRes.item_list[0];
                  if (entry?.aweme_detail) return entry.aweme_detail;
                }
              }
              const videoEl = domDocument.querySelector('video');
              const src = videoEl?.src || videoEl?.querySelector('source')?.getAttribute('src');
              if (src && /^https?:\/\//.test(src)) {
                return {
                  aweme_id: vId,
                  desc: domDocument.title || `Douyin_${vId}`,
                  video: {
                    play_addr: { url_list: [src] },
                  },
                };
              }
            } catch {}
            return null;
          }, videoId).catch(() => null);

          if (domDetail) {
            detail = domDetail as DouyinDetail;
            break;
          }
        }
      }

      if (!detail) throw new Error('Douyin chưa cho phép đọc video sau khi xác thực. Hãy thử lại sau ít phút hoặc kiểm tra video có đang công khai hay không.');
      return detail;
    } finally {
      signal?.removeEventListener('abort', closeOnAbort);
      await context.close().catch(() => undefined);
    }
  });
}

export async function extractDouyinMedia(videoId: string, isNote = false, signal?: AbortSignal): Promise<ExtractedDouyinMedia> {
  const cached = mediaCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.media;

  let detail: DouyinDetail | undefined;

  // Tier 1: Fast Web API with dynamic token (instant, <500ms)
  try {
    detail = await fetchViaWebApi(videoId, signal);
  } catch {
    // Continue to next tier
  }

  // Tier 2: Mobile Iesdouyin API
  if (!detail && !signal?.aborted) {
    try {
      detail = await fetchViaIesApi(videoId, signal);
    } catch {
      // Continue to next tier
    }
  }

  // Tier 3: Direct SSR HTML Scraping
  if (!detail && !signal?.aborted) {
    try {
      detail = await fetchViaHtmlScraping(videoId, isNote, signal);
    } catch {
      // Continue to next tier
    }
  }

  // Tier 4: Stealth Browser Automation
  if (!detail && !signal?.aborted) {
    detail = await discoverDetailViaBrowser(videoId, isNote, signal);
  }

  if (!detail) {
    throw new Error('Không thể lấy thông tin video Douyin. Hãy kiểm tra lại đường dẫn hoặc thử lại sau.');
  }

  const media = douyinMediaFromDetail(videoId, detail);
  mediaCache.set(videoId, { expiresAt: Date.now() + CACHE_TTL_MS, media });
  return media;
}

export async function closeDouyinExtractor() {
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending) await pending.then((browser) => browser.close()).catch(() => undefined);
}
