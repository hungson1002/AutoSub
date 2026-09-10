import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { douyinTools } from '../../src/lib/douyinTools';
import { douyinCookieStore } from './douyinCookie';
import { workdir } from './ffmpeg';

export function validateDouyinTool(raw: unknown) {
  const body = raw as { operation?: string; params?: Record<string, unknown>; cursor?: string; confirmed?: boolean; requestId?: string };
  const tool = douyinTools.find((item) => item.id === body?.operation);
  if (!tool) throw new Error('Chức năng Douyin không hợp lệ.');
  if (tool.write && (body.confirmed !== true || typeof body.requestId !== 'string' || !/^[\da-f-]{36}$/i.test(body.requestId))) throw new Error('Cần xác nhận riêng cho thao tác thay đổi tài khoản.');
  const params: Record<string, string> = {};
  for (const field of tool.fields) {
    const value = body.params?.[field.key];
    if (value === undefined || value === '') { if (field.optional) { params[field.key] = ''; continue; } throw new Error(`Thiếu ${field.label}.`); }
    if (typeof value !== 'string' || value.length > (field.kind === 'text' ? 2000 : 300)) throw new Error(`${field.label} không hợp lệ.`);
    let normalized = value.trim();
    if ((field.kind === 'user' || field.kind === 'video') && normalized.startsWith('https://')) {
      const url = new URL(normalized);
      const prefix = field.kind === 'user' ? '/user/' : '/video/';
      if (!['www.douyin.com', 'douyin.com'].includes(url.hostname) || url.username || url.password || url.port || !url.pathname.startsWith(prefix)) throw new Error('Chỉ nhận URL hồ sơ/video chính thức của Douyin.');
      normalized = url.pathname.slice(prefix.length).replace(/\/$/, '');
    }
    if (!normalized || ((field.kind === 'id' || field.kind === 'video') && !/^\d{1,30}$/.test(normalized)) || (field.kind === 'user' && !/^[\w-]{5,200}$/.test(normalized))) throw new Error(`${field.label} không hợp lệ.`);
    params[field.key] = normalized;
  }
  const cursor = body.cursor ?? '0';
  if (typeof cursor !== 'string' || !/^\d{1,30}$/.test(cursor)) throw new Error('Con trỏ trang không hợp lệ.');
  return { tool, operation: tool.id, params, cursor, requestId: body.requestId };
}

export function redactDouyinData(value: unknown, depth = 0): unknown {
  if (depth > 16) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactDouyinData(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/cookie|token|ticket|secret|password|session|ttwid|signature|authorization/i.test(key)).map(([key, item]) => [key, redactDouyinData(item, depth + 1)]));
  return typeof value === 'string' ? value.slice(0, 10000) : value;
}

let busy = false;
// Keep write IDs for this process lifetime. Restart requires checking external state.
const writes = new Set<string>();
export async function runDouyinTool(raw: unknown) {
  const input = validateDouyinTool(raw);
  if (busy) throw new Error('Một thao tác Douyin đang chạy. Vui lòng đợi.');
  if (input.tool.write && writes.has(input.requestId!)) throw new Error('Yêu cầu này đã được gửi. Kiểm tra Douyin trước khi thao tác lại.');
  const cookie = await douyinCookieStore.read() || process.env.DY_COOKIES;
  if (!cookie) throw new Error('Hãy lưu cookie ở mục Tìm video trước.');
  if (busy) throw new Error('Một thao tác Douyin đang chạy. Vui lòng đợi.');
  busy = true;
  if (input.tool.write) writes.add(input.requestId!);
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const python = process.env.DOUYIN_SEARCH_PYTHON || path.join(workdir, 'tools/douyin-search-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const repo = process.env.DOUYIN_SPIDER_PATH || path.join(workdir, 'tools/DouYin_Spider');
      const child = spawn(python, [fileURLToPath(new URL('../../scripts/douyin-actions.py', import.meta.url)), repo], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
      let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Quá thời gian. Trạng thái thao tác chưa xác định; kiểm tra Douyin trước khi gửi lại.')); }, 90_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (text: string) => { output += text; if (Buffer.byteLength(output) > 4_000_000) { child.kill(); reject(new Error('Dữ liệu vượt giới hạn.')); } });
      child.stderr.resume();
      child.stdin.on('error', () => undefined);
      child.once('error', () => { clearTimeout(timer); reject(new Error('Không khởi động được adapter Douyin.')); });
      child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('Adapter đã dừng. Nếu là thao tác ghi, kiểm tra Douyin trước khi gửi lại.')); });
      child.stdin.end(JSON.stringify({ operation: input.operation, params: input.params, cursor: input.cursor, cookie }));
    });
    const parsed = JSON.parse(output);
    if (parsed.error) throw new Error(parsed.error);
    return { data: redactDouyinData(parsed.data), write: !!input.tool.write };
  } finally { busy = false; }
}
