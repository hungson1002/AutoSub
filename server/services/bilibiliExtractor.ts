const BILIBILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.bilibili.com/',
};

const BILIBILI_HOSTS = new Set([
  'bilibili.com',
  'www.bilibili.com',
  'm.bilibili.com',
  'b23.tv',
  'www.b23.tv',
]);

interface BilibiliPage {
  cid: number;
  page?: number;
  part?: string;
  duration?: number;
}

interface BilibiliViewData {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  pic?: string;
  duration?: number;
  owner?: { name?: string; face?: string };
  pages?: BilibiliPage[];
}

interface BilibiliDurl {
  url?: string;
  backup_url?: string[];
  size?: number;
  length?: number;
}

export interface BilibiliVideoInfo {
  platform: 'bilibili';
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
  isNote: false;
  referer: string;
}

export type BilibiliQuality = 64 | 16;

function httpsUrl(value?: string) {
  if (!value) return undefined;
  if (value.startsWith('//')) return `https:${value}`;
  return value.replace(/^http:\/\//i, 'https://');
}

export function isBilibiliUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl.trim());
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && BILIBILI_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

class BilibiliHttpError extends Error {
  constructor(public status: number) { super(`Bilibili trả về mã HTTP ${status}.`); }
}

export function readBilibiliPageMetadata(html: string): BilibiliViewData {
  // Read embedded JSON only. Never execute scripts from a remote page.
  const marker = /window\.__INITIAL_STATE__\s*=\s*/g.exec(html);
  if (!marker) throw new Error('Trang Bilibili không chứa thông tin video công khai.');
  const start = marker.index + marker[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < Math.min(html.length, start + 3_000_000); i++) {
    const char = html[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      const state = JSON.parse(html.slice(start, i + 1));
      const video = state.videoData;
      if (!video || typeof video.bvid !== 'string' || !Number.isSafeInteger(video.cid) || video.cid <= 0 || typeof video.title !== 'string') break;
      return video;
    }
  }
  throw new Error('Không đọc được thông tin video trên trang Bilibili.');
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: BILIBILI_HEADERS,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new BilibiliHttpError(response.status);
  return response.json() as Promise<T>;
}

export async function resolveBilibiliUrl(rawUrl: string, signal?: AbortSignal, quality: BilibiliQuality = 64): Promise<BilibiliVideoInfo> {
  const targetUrl = rawUrl.trim();
  if (!isBilibiliUrl(targetUrl)) {
    throw new Error(`Đường dẫn không thuộc Bilibili: ${rawUrl}`);
  }

  let finalUrl = targetUrl;
  const parsedTarget = new URL(targetUrl);
  if (parsedTarget.hostname.toLowerCase().endsWith('b23.tv')) {
    try {
      const response = await fetch(targetUrl, {
        redirect: 'follow',
        headers: BILIBILI_HEADERS,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      });
      finalUrl = response.url || targetUrl;
    } catch (error) {
      if (signal?.aborted) throw new Error('Đã hủy tải video Bilibili.');
      throw new Error(`Không thể mở link rút gọn Bilibili: ${error instanceof Error ? error.message : 'lỗi mạng'}`);
    }
  }

  const parsedFinal = new URL(finalUrl);
  if (!BILIBILI_HOSTS.has(parsedFinal.hostname.toLowerCase())) {
    throw new Error('Link rút gọn Bilibili chuyển hướng đến trang không được hỗ trợ.');
  }

  const idMatch = parsedFinal.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)
    || parsedFinal.pathname.match(/\/video\/av(\d+)/i);
  if (!idMatch?.[1]) throw new Error(`Không tìm thấy mã video Bilibili từ đường dẫn: ${rawUrl}`);

  const isBvid = /^BV/i.test(idMatch[1]);
  const lookup = isBvid ? `bvid=${encodeURIComponent(idMatch[1])}` : `aid=${encodeURIComponent(idMatch[1])}`;
  let view: { code: number; message?: string; data?: BilibiliViewData };
  try {
    view = await getJson<typeof view>(`https://api.bilibili.com/x/web-interface/view?${lookup}`, signal);
  } catch (error) {
    if (!(error instanceof BilibiliHttpError) || error.status !== 412) throw error;
    const publicUrl = `https://www.bilibili.com/video/${isBvid ? idMatch[1] : `av${idMatch[1]}`}/`;
    const response = await fetch(publicUrl, { headers: BILIBILI_HEADERS, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Bilibili từ chối cả trang công khai (HTTP ${response.status}). Hãy kiểm tra video trên trình duyệt rồi thử lại sau.`);
    const data = readBilibiliPageMetadata(await response.text());
    if (isBvid ? data.bvid !== idMatch[1] : String(data.aid) !== idMatch[1]) throw new Error('Thông tin trang Bilibili không khớp video yêu cầu.');
    view = { code: 0, data };
  }
  if (view.code !== 0 || !view.data) {
    throw new Error(view.message || 'Không thể đọc thông tin video Bilibili.');
  }

  const requestedPage = Math.max(1, Number(parsedFinal.searchParams.get('p')) || 1);
  const page = view.data.pages?.[requestedPage - 1]
    || view.data.pages?.[0]
    || { cid: view.data.cid, duration: view.data.duration };
  if (!page.cid) throw new Error('Bilibili không trả về mã nội dung của video.');

  const play = await getJson<{
    code: number;
    message?: string;
    data?: { durl?: BilibiliDurl[]; timelength?: number; quality?: number; accept_quality?: number[] };
  }>(
    // Do not send platform=html5: for some long public videos Bilibili then
    // returns only a truncated Akamai URL and omits the working backup CDN.
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(view.data.bvid)}&cid=${page.cid}&qn=${quality}&fnval=0&fnver=0&fourk=0&high_quality=1`,
    signal,
  );
  const stream = play.data?.durl?.[0];
  const downloadUrl = httpsUrl(stream?.url);
  if (play.code !== 0 || !downloadUrl) {
    throw new Error(play.message || 'Bilibili không trả về luồng MP4 công khai.');
  }
  if (play.data?.quality && play.data.quality < quality) {
    throw new Error(`Bilibili chỉ trả về chất lượng ${play.data.quality === 16 ? '360p' : `mã ${play.data.quality}`} thay vì ${quality === 64 ? '720p' : '360p'}. Hãy đăng nhập Bilibili hoặc chọn chất lượng thấp hơn.`);
  }

  const fullDurationMs = (page.duration || view.data.duration || 0) * 1000;
  const availableDurationMs = play.data?.timelength || stream?.length || 0;
  if (fullDurationMs > 0 && availableDurationMs > 0 && availableDurationMs < fullDurationMs - 5_000) {
    const availableMinutes = Math.max(1, Math.round(availableDurationMs / 60_000));
    throw new Error(`Video Bilibili này bị giới hạn hoặc yêu cầu trả phí. Máy chủ chỉ cho phép xem thử khoảng ${availableMinutes} phút nên AutoSub không thể tải bản đầy đủ.`);
  }

  const titleSuffix = requestedPage > 1 && page.part ? ` - ${page.part}` : '';
  const videoId = view.data.bvid || `av${view.data.aid}`;
  return {
    platform: 'bilibili',
    url: rawUrl,
    videoId,
    title: `${view.data.title}${titleSuffix}`.trim(),
    author: view.data.owner?.name || 'Bilibili Creator',
    authorAvatar: httpsUrl(view.data.owner?.face),
    coverUrl: httpsUrl(view.data.pic),
    duration: page.duration || view.data.duration,
    downloadUrl,
    backupUrls: (stream?.backup_url || []).map(httpsUrl).filter((url): url is string => Boolean(url)),
    expectedBytes: stream?.size,
    isNote: false,
    referer: `https://www.bilibili.com/video/${videoId}`,
  };
}
