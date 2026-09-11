// Endpoint/protocol reference: SnailDev/douyin-hot-hub, douyin.py.
// This is a topic heat chart, not a ranked list of video view counts.
const endpoint = 'https://aweme.snssdk.com/aweme/v1/hot/search/list/?device_platform=android&version_name=13.2.0&version_code=130200&aid=1128';
export function normalizeDouyinTrends(raw: unknown) {
  const data = raw as { status_code?: number; data?: { word_list?: unknown } };
  if (data?.status_code !== 0 || !Array.isArray(data.data?.word_list)) throw new Error('Douyin chưa trả bảng xu hướng hợp lệ.');
  const seen = new Set<string>();
  return data.data.word_list.slice(0, 100).flatMap((raw: unknown) => {
    const row = raw as { word?: unknown; hot_value?: unknown; position?: unknown };
    if (!row || typeof row.word !== 'string' || !row.word.trim() || row.word.length > 100 || seen.has(row.word)) return [];
    seen.add(row.word);
    return [{ topic: row.word, rank: Number.isInteger(row.position) && Number(row.position) > 0 ? Number(row.position) : seen.size, heat: typeof row.hot_value === 'number' && Number.isFinite(row.hot_value) && row.hot_value >= 0 ? row.hot_value : null }];
  }).slice(0, 50);
}
type Trends = { items: ReturnType<typeof normalizeDouyinTrends>; fetchedAt: string };
let cached: Trends | undefined;
let pending: Promise<Trends> | undefined;
export async function getDouyinTrends(): Promise<Trends> {
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 300_000) return cached;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch(endpoint, { headers: { 'user-agent': 'okhttp3' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Không lấy được xu hướng Douyin. Thử lại sau.');
    const items = normalizeDouyinTrends(await response.json());
    if (!items.length) throw new Error('Bảng xu hướng hiện không có dữ liệu.');
    cached = { items, fetchedAt: new Date().toISOString() };
    return cached;
  })();
  try { return await pending; } finally { pending = undefined; }
}
