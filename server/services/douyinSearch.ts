import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workdir } from './ffmpeg';
import { douyinCookieStore } from './douyinCookie';

export interface DouyinSearchInput { keyword: string; sort: string; publishTime: string; cookie?: string; offset?: number; count?: number; searchId?: string; filterDuration?: string; searchRange?: string }
export interface DouyinSearchItem { id: string; title: string; author: string; url: string; coverUrl?: string; duration: number; likes: number }
export function validateDouyinSearch(value: unknown): DouyinSearchInput {
  const body = value as Partial<DouyinSearchInput> | undefined;
  if (!body || typeof body.keyword !== 'string' || !body.keyword.trim() || body.keyword.length > 100) throw new Error('Nhập từ khóa từ 1 đến 100 ký tự.');
  const sort = body.sort ?? '0', publishTime = body.publishTime ?? '0';
  if (!['0', '1', '2'].includes(sort) || !['0', '1', '7', '180'].includes(publishTime)) throw new Error('Bộ lọc tìm kiếm không hợp lệ.');
  if (body.cookie !== undefined && (typeof body.cookie !== 'string' || body.cookie.length > 20000 || /[\r\n]/.test(body.cookie))) throw new Error('Cookie không hợp lệ; dùng một dòng Cookie từ trình duyệt.');
  if (!Number.isInteger(body.offset ?? 0) || (body.offset ?? 0) < 0 || (body.offset ?? 0) > 10000 || ![10, 20, 25].includes(body.count ?? 20)
    || !['', '0-1', '1-5', '5-10000'].includes(body.filterDuration ?? '') || !['0', '1', '2', '3'].includes(body.searchRange ?? '0')
    || (body.searchId !== undefined && (typeof body.searchId !== 'string' || !/^[\w-]{0,200}$/.test(body.searchId)))) throw new Error('Bộ lọc hoặc phân trang không hợp lệ.');
  return { keyword: body.keyword.trim(), sort, publishTime, cookie: body.cookie, offset: body.offset ?? 0, count: body.count ?? 20, searchId: body.searchId ?? '', filterDuration: body.filterDuration ?? '', searchRange: body.searchRange ?? '0' };
}

export function normalizeDouyinSearch(raw: unknown): DouyinSearchItem[] {
  const rows = (raw as { data?: unknown[] })?.data;
  if (!Array.isArray(rows)) throw new Error('Douyin trả dữ liệu tìm kiếm không hợp lệ.');
  const seen = new Set<string>();
  return rows.slice(0, 150).flatMap((row: any) => {
    const item = row?.aweme_info || row;
    const id = String(item?.aweme_id || '');
    if (!/^\d{5,30}$/.test(id) || seen.has(id) || !item?.video || item.images?.length) return [];
    seen.add(id);
    const covers = item.video.cover?.url_list;
    const cover = Array.isArray(covers) ? covers.find((raw: unknown) => {
      if (typeof raw !== 'string') return false;
      try {
        const url = new URL(raw);
        return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && ['douyinpic.com', 'byteimg.com', 'pstatp.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
      } catch { return false; }
    }) : undefined;
    const number = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    return [{ id, title: String(item.desc || 'Video Douyin').slice(0, 1000), author: String(item.author?.nickname || '').slice(0, 150), url: `https://www.douyin.com/video/${id}`, coverUrl: cover, duration: number(item.video.duration ?? item.duration) / 1000, likes: number(item.statistics?.digg_count) }];
  });
}

let busy = false;
export async function searchDouyinVideos(value: unknown) {
  const input = validateDouyinSearch(value);
  if (!input.cookie?.trim()) input.cookie = await douyinCookieStore.read() || process.env.DY_COOKIES;
  const repo = path.resolve(process.env.DOUYIN_SPIDER_PATH || path.join(workdir, 'tools', 'DouYin_Spider'));
  const python = process.env.DOUYIN_SEARCH_PYTHON || path.join(workdir, 'tools', 'douyin-search-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(path.join(repo, 'dy_apis', 'douyin_api.py')) || !existsSync(python)) throw new Error('Chưa cài Douyin Search. Xem docs/DOUYIN_SEARCH.md để cài repo và Python.');
  if (!input.cookie?.trim() && !process.env.DY_COOKIES?.trim()) throw new Error('Cần cookie Douyin đã đăng nhập. Nhập cookie trong mục tìm kiếm.');
  if (busy) throw new Error('Đang tìm kiếm Douyin. Đợi yêu cầu hiện tại hoàn tất rồi thử lại.');
  busy = true;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(python, [fileURLToPath(new URL('../../scripts/douyin-search.py', import.meta.url)), repo], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
      let output = '', size = 0;
      const timer = setTimeout(() => { child.kill(); reject(new Error('Tìm kiếm quá 90 giây. Kiểm tra Douyin rồi thử lại.')); }, 90_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { size += Buffer.byteLength(chunk); if (size > 2_000_000) { child.kill(); reject(new Error('Kết quả Douyin vượt giới hạn.')); } else output += chunk; });
      child.stderr.resume();
      child.stdin.on('error', () => undefined);
      child.once('error', () => { clearTimeout(timer); reject(new Error('Không khởi động được Python tìm kiếm Douyin.')); });
      child.once('close', (code) => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error('Tiến trình tìm kiếm Douyin đã dừng. Kiểm tra cài đặt Python.')); });
      child.stdin.end(JSON.stringify(input));
    });
    let parsed: { error?: string; data?: unknown[]; hasMore?: boolean; searchId?: string; nextOffset?: number; warning?: string };
    try { parsed = JSON.parse(raw); } catch { throw new Error('Adapter Douyin trả dữ liệu không hợp lệ.'); }
    if (parsed.error) throw new Error(parsed.error);
    const nextOffset = parsed.nextOffset;
    if (!Number.isInteger(nextOffset) || nextOffset! <= (input.offset ?? 0)) throw new Error('Douyin trả phân trang không hợp lệ.');
    const warnings: Record<string, string> = {
      partial_error: 'Một trang tiếp theo gặp lỗi. Đã giữ video nhận được; bạn có thể bấm Tải thêm để thử tiếp.',
      time_limit: 'Đã dừng trong giới hạn thời gian và giữ kết quả. Bấm Tải thêm để tiếp tục.',
      page_limit: 'Đã quét 6 trang nhưng chưa đủ video hợp lệ. Bấm Tải thêm để tiếp tục.',
    };
    return { items: normalizeDouyinSearch(parsed), warning: warnings[parsed.warning || ''] || '', hasMore: parsed.hasMore === true && nextOffset! <= 10000, nextOffset: nextOffset!, searchId: typeof parsed.searchId === 'string' && /^[\w-]{0,200}$/.test(parsed.searchId) ? parsed.searchId : '' };
  } finally { busy = false; }
}
