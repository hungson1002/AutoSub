import { useEffect, useRef, useState } from 'react';
import { api, friendlyErrorMessage } from '../lib/api';
import { douyinTools } from '../lib/douyinTools';
import './DouyinSearch.css';

function records(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((v) => v && typeof v === 'object') as Record<string, unknown>[];
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  if (obj.data && !Array.isArray(obj.data) && typeof obj.data === 'object') return records(obj.data);
  for (const key of ['events', 'promotions', 'Comments', 'user_list', 'aweme_list', 'comments', 'followers', 'followings', 'notice_list', 'collects_list', 'data']) {
    if (Array.isArray(obj[key])) return records(obj[key]);
  }
  return [obj];
}
function headline(row: Record<string, unknown>, index: number) {
  const item = (row.user_info || row.aweme_info || row.user || row) as Record<string, unknown>;
  return String(item.nickname || item.desc || item.text || item.name || `Kết quả ${index + 1}`);
}
export function DouyinTools({ onAdd }: { onAdd: (urls: string[]) => void }) {
  const [operation, setOperation] = useState('users');
  const tool = douyinTools.find((item) => item.id === operation)!;
  const [params, setParams] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState('0');
  const [data, setData] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async () => {
    if (lock.current) return;
    if (tool.write && !window.confirm(`${tool.label}\n${tool.fields.map((field) => `${field.label}: ${params[field.key] || '(trống)'}`).join('\n')}\n\nThao tác sẽ dùng tài khoản của cookie đã lưu. Xác nhận thực hiện một lần?`)) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.runDouyinTool({ operation, params, cursor, confirmed: !!tool.write, requestId: crypto.randomUUID() });
      if (!mounted.current) return;
      setData(result.data); setNotice(result.write ? 'Douyin đã trả kết quả thao tác. Xem chi tiết bên dưới.' : 'Đã lấy dữ liệu. Có thể xem chi tiết và xuất JSON.');
    } catch (cause) { if (mounted.current) setError(friendlyErrorMessage(cause, 'Không thực hiện được.')); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `douyin-${operation}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const rows = records(data);
  const metadata = data && !Array.isArray(data) && typeof data === 'object' ? data as Record<string, unknown> : {};
  const next = metadata.max_cursor ?? metadata.cursor ?? metadata.min_time;
  const canNext = tool.paged && (metadata.has_more === 1 || metadata.has_more === true) && /^\d+$/.test(String(next)) && String(next) !== cursor;
  const videoUrls = rows.flatMap((row) => { const v = (row.aweme_info || row) as Record<string, unknown>; return /^\d{5,30}$/.test(String(v.aweme_id)) && v.video ? [`https://www.douyin.com/video/${v.aweme_id}`] : []; });
  return <section className="douyin-search">
    <header className="douyin-search-heading"><div><h2>Công cụ Douyin</h2><p>Đọc dữ liệu và tương tác qua DouYin_Spider · dùng cookie đã lưu.</p></div></header>
    <form onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <div className="douyin-search-fields"><label>Chức năng<select disabled={busy} value={operation} onChange={(e) => { setOperation(e.target.value); setParams({}); setCursor('0'); setData(undefined); setNotice(''); setError(''); }}>{[...new Set(douyinTools.map((v) => v.group))].map((group) => <optgroup key={group} label={group}>{douyinTools.filter((v) => v.group === group).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</optgroup>)}</select></label></div>
      <div className="douyin-tools-inputs">{tool.fields.map((field) => <label key={field.key}>{field.label}{field.kind === 'text' ? <textarea required={!field.optional} maxLength={2000} disabled={busy} value={params[field.key] || ''} onChange={(e) => setParams({ ...params, [field.key]: e.target.value })} /> : <input required={!field.optional} maxLength={300} disabled={busy} value={params[field.key] || ''} onChange={(e) => setParams({ ...params, [field.key]: e.target.value })} />}</label>)}</div>
      {tool.paged && <label>Con trỏ trang (0 để bắt đầu)<input value={cursor} inputMode="numeric" pattern="[0-9]+" disabled={busy} onChange={(e) => setCursor(e.target.value)} /></label>}
      {tool.write && <p className="douyin-search-error">Thay đổi tài khoản thật. Không tự thử lại khi mất kết nối; hãy kiểm tra Douyin trước khi gửi lại.</p>}
      <div className="douyin-search-actions"><button className="button primary" disabled={busy}>{busy ? 'Đang xử lý…' : tool.write ? 'Xem và xác nhận thao tác' : 'Lấy dữ liệu'}</button></div>
    </form>
    {error && <p role="alert" className="douyin-search-error">{error}</p>}<p role="status">{notice}</p>
    {data !== undefined && <><div className="douyin-search-actions"><button className="button ghost" onClick={exportData}>Xuất JSON</button>{!!videoUrls.length && <button className="button primary" onClick={() => onAdd(videoUrls)}>Chuyển {videoUrls.length} video sang tải</button>}{canNext && <button className="button ghost" disabled={busy} onClick={() => { setCursor(String(next)); setNotice('Đã chọn con trỏ tiếp theo. Bấm Lấy dữ liệu.'); }}>Chọn trang tiếp</button>}</div>
      {rows.length ? <div className="douyin-tools-records">{rows.map((row, index) => <details key={index}><summary>{headline(row, index)}</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>)}</div> : <pre className="douyin-tools-raw">{JSON.stringify(data, null, 2)}</pre>}
    </>}
  </section>;
}
