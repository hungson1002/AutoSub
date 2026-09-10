import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, friendlyErrorMessage } from '../lib/api';
import './DouyinSearch.css';
import { Search, ShieldCheck, Download, Film } from 'lucide-react';

type Item = Awaited<ReturnType<typeof api.searchDouyin>>['items'][number];
export function DouyinSearch({ onAdd }: { onAdd: (urls: string[]) => void }) {
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState('0');
  const [publishTime, setPublishTime] = useState('0');
  const [filterDuration, setFilterDuration] = useState('');
  const [searchRange, setSearchRange] = useState('0');
  const [count, setCount] = useState(20);
  const [page, setPage] = useState<{ hasMore: boolean; nextOffset: number; searchId: string } | null>(null);
  const [applied, setApplied] = useState('');
  const [cookie, setCookie] = useState('');
  const [credential, setCredential] = useState({ saved: false, environment: false });
  const [cookieBusy, setCookieBusy] = useState(false);
  const [cookieNotice, setCookieNotice] = useState('');
  const [cookieRevision, setCookieRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState('');
  const [warning, setWarning] = useState('');
  const searchLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { void api.douyinCookieStatus().then((status) => { if (mounted.current) setCredential(status); }).catch(() => { if (mounted.current) setCookieNotice('Chưa đọc được trạng thái cookie.'); }); }, []);
  const manageCookie = async (remove = false) => {
    setCookieBusy(true); setCookieNotice('');
    try {
      const status = await (remove ? api.deleteDouyinCookie() : api.saveDouyinCookie(cookie.trim()));
      if (!mounted.current) return;
      setCredential(status); setCookie(''); setCookieRevision((n) => n + 1);
      setCookieNotice(remove ? 'Đã xóa cookie lưu trên máy.' : 'Đã lưu mã hóa. Lần sau không cần nhập lại.');
    } catch (cause) { if (mounted.current) setCookieNotice(friendlyErrorMessage(cause, 'Không lưu được cookie.')); }
    finally { if (mounted.current) setCookieBusy(false); }
  };
  const exportLinks = () => {
    const url = URL.createObjectURL(new Blob([items.filter((item) => selected.has(item.id)).map((item) => item.url).join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'douyin-links.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const queryKey = JSON.stringify([keyword.trim(), sort, publishTime, filterDuration, searchRange, count, cookie, cookieRevision]);
  const search = async (event?: FormEvent, more = false) => {
    event?.preventDefault();
    if (searchLock.current || busy || cookieBusy || !keyword.trim()) return;
    if (more && (!page?.hasMore || applied !== queryKey)) return;
    searchLock.current = true;
    setBusy(true); setError(''); setWarning('');
    try {
      const result = await api.searchDouyin({ keyword: keyword.trim(), sort, publishTime, filterDuration, searchRange, count, cookie: cookie.trim() || undefined, offset: more ? page?.nextOffset : 0, searchId: more ? page?.searchId : '' });
      if (!mounted.current) return;
      const merged = [...new Map([...(more ? items : []), ...result.items].map((item) => [item.id, item])).values()];
      setItems(merged); setPage(result); setApplied(queryKey);
      setWarning(result.warning);
      if (!more) setSelected(new Set());
      setSummary(`${merged.length} video cho “${keyword.trim()}”. ${result.hasMore ? 'Có thể tải thêm kết quả bên dưới.' : 'Douyin không báo còn trang tiếp theo.'}${!merged.length ? ' Thử từ khóa khác hoặc bỏ bớt bộ lọc.' : ''}`);
    } catch (cause) { if (mounted.current) setError(friendlyErrorMessage(cause, 'Không tìm kiếm được Douyin.')); }
    finally { searchLock.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="douyin-search" aria-labelledby="douyin-search-title">
    <header className="douyin-search-heading"><div><span className="douyin-search-eyebrow">KHÁM PHÁ NỘI DUNG</span><h2 id="douyin-search-title"><Search size={26} aria-hidden="true" />Tìm video Douyin</h2><p>Tìm đúng nội dung. Chọn video. Chuyển sang tải hàng loạt.</p></div><span className="douyin-cookie-badge"><ShieldCheck size={16} aria-hidden="true" />{credential.saved ? 'Cookie đã lưu' : credential.environment ? 'Cookie từ cấu hình' : 'Chưa lưu cookie'}</span></header>
    <form onSubmit={(event) => void search(event)}>
      <div className="douyin-search-fields">
        <label>Từ khóa<input value={keyword} maxLength={100} required disabled={busy} onChange={(event) => setKeyword(event.target.value)} placeholder="Ví dụ: 美食, 动画, du lịch…" /></label>
        <label>Sắp xếp<select value={sort} disabled={busy} onChange={(event) => setSort(event.target.value)}><option value="0">Liên quan</option><option value="1">Nhiều lượt thích</option><option value="2">Mới nhất</option></select></label>
        <label>Đăng trong<select value={publishTime} disabled={busy} onChange={(event) => setPublishTime(event.target.value)}><option value="0">Mọi thời gian</option><option value="1">24 giờ</option><option value="7">7 ngày</option><option value="180">180 ngày</option></select></label>
        <button className="button primary" disabled={busy || cookieBusy || !keyword.trim()} type="submit"><Search size={17} aria-hidden="true" />{busy ? 'Đang tìm kiếm…' : 'Tìm video'}</button>
      </div>
      <div className="douyin-search-fields">
        <label>Thời lượng<select value={filterDuration} disabled={busy} onChange={(e) => setFilterDuration(e.target.value)}><option value="">Tất cả</option><option value="0-1">Dưới 1 phút</option><option value="1-5">1–5 phút</option><option value="5-10000">Trên 5 phút</option></select></label>
        <label>Phạm vi<select value={searchRange} disabled={busy} onChange={(e) => setSearchRange(e.target.value)}><option value="0">Tất cả video</option><option value="1">Đã xem</option><option value="2">Chưa xem</option><option value="3">Đang theo dõi</option></select></label>
        <label>Mục tiêu mỗi lần tìm<select value={count} disabled={busy} onChange={(e) => setCount(Number(e.target.value))}><option value={10}>10 video</option><option value={20}>20 video</option><option value={25}>25 video</option></select></label>
        <button type="button" className="button ghost" disabled={busy} onClick={() => { setSort('0'); setPublishTime('0'); setFilterDuration(''); setSearchRange('0'); }}>Đặt lại bộ lọc</button>
      </div>
      <small>Tự lấy tiếp tối đa 6 trang để đạt mục tiêu; loại kết quả trùng và không phải video. Số thực nhận phụ thuộc Douyin, không bỏ video dư ở cuối trang.</small>
      <details className="douyin-cookie-panel"><summary>Quản lý cookie đăng nhập</summary><label>Cookie mới<input type="password" autoComplete="off" maxLength={20000} value={cookie} disabled={busy || cookieBusy} onChange={(event) => setCookie(event.target.value)} placeholder={credential.saved ? 'Đã lưu — chỉ nhập nếu muốn đổi tài khoản' : 'Dán Cookie dạng Header String'} aria-describedby="douyin-cookie-help" /></label><small id="douyin-cookie-help">Lưu mã hóa bằng Windows trên máy này, không đưa cookie trở lại trình duyệt. Cookie hết hạn cần thay mới. Xóa ở đây không xóa DY_COOKIES trong cấu hình.</small><div className="douyin-search-actions"><button className="button primary" type="button" disabled={busy || cookieBusy || !cookie.trim()} onClick={() => void manageCookie()}>{cookieBusy ? 'Đang xử lý…' : 'Lưu cookie'}</button><button className="button ghost" type="button" disabled={busy || cookieBusy || !credential.saved} onClick={() => void manageCookie(true)}>Xóa cookie đã lưu</button></div><p role="status">{cookieNotice}</p></details>
    </form>
    {busy && <p role="status">Đang hỏi Douyin, tối đa khoảng 90 giây. Không cần bấm lại.</p>}
    {error && <p role="alert" className="douyin-search-error">{error}</p>}
    {warning && <p role="status">{warning}</p>}
    <p role="status">{summary}</p>
    {!page && !busy && !error && <div className="douyin-search-empty"><Film size={36} aria-hidden="true" /><h3>Bắt đầu từ một chủ đề</h3><p>Nhập từ khóa, chọn bộ lọc rồi tìm video. Từ khóa tiếng Trung thường cho kết quả sát hơn.</p></div>}
    {items.length > 0 && <>
      <div className="douyin-search-actions"><button className="button ghost" type="button" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}>{selected.size === items.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button><button className="button primary" type="button" disabled={!selected.size} onClick={() => { onAdd(items.filter((item) => selected.has(item.id)).map((item) => item.url)); setSummary(`Đã thêm ${selected.size} link vào ô tải bên dưới.`); setSelected(new Set()); }}>Thêm {selected.size} video đã chọn</button></div>
      <button className="button ghost" type="button" disabled={!selected.size} onClick={exportLinks}><Download size={16} aria-hidden="true" />Xuất link đã chọn (.txt)</button>
      <div className="douyin-search-results">{items.map((item) => <article key={item.id} className={selected.has(item.id) ? 'is-selected' : ''}>
        <label><input type="checkbox" checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} />Chọn video</label>
        {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="douyin-search-no-cover">Không có ảnh xem trước</div>}
        <h3>{item.title}</h3><p>{item.author || 'Douyin'} · {Math.round(item.duration)} giây · {item.likes.toLocaleString('vi-VN')} thích</p><a href={item.url} target="_blank" rel="noopener noreferrer">Mở trên Douyin ↗</a>
      </article>)}</div>
    </>}
    {page && <div className="douyin-search-actions">
      {page.hasMore && <button className="button primary" type="button" disabled={busy || applied !== queryKey} onClick={() => void search(undefined, true)}>{busy ? 'Đang tải…' : 'Tải thêm video'}</button>}
      {applied !== queryKey && <p role="status">Bộ lọc hoặc cookie đã đổi. Bấm Tìm video để áp dụng.</p>}
    </div>}
  </section>;
}
