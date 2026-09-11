import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, friendlyErrorMessage } from '../lib/api';
import './DouyinSearch.css';
import { Search, ShieldCheck, Download, Film } from 'lucide-react';
import { SelectField } from './SelectField';
import { DouyinVideoCard } from './DouyinVideoCard';
import type { AppSettings, AIProvider } from '../types';
import { capabilityAssignments } from '../lib/settings';

type Item = Awaited<ReturnType<typeof api.searchDouyin>>['items'][number];
export function DouyinSearch({ onAdd, settings, providers }: { onAdd: (urls: string[]) => void; settings: AppSettings; providers: AIProvider[] }) {
  const [translation, setTranslation] = useState('');
  const [trends, setTrends] = useState<Awaited<ReturnType<typeof api.douyinTrends>> | null>(null);
  const [trendsBusy, setTrendsBusy] = useState(false);
  const [trendsError, setTrendsError] = useState('');
  const trendsLock = useRef(false);
  const loadTrends = async () => {
    if (trendsLock.current) return;
    trendsLock.current = true; setTrendsBusy(true); setTrendsError('');
    try { const result = await api.douyinTrends(); if (mounted.current) setTrends(result); }
    catch (cause) { if (mounted.current) setTrendsError(friendlyErrorMessage(cause, 'Không tải được xu hướng.')); }
    finally { trendsLock.current = false; if (mounted.current) setTrendsBusy(false); }
  };
  const [translating, setTranslating] = useState(false);
  const translateController = useRef<AbortController | null>(null);
  useEffect(() => () => translateController.current?.abort(), []);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState('0');
  const [publishTime, setPublishTime] = useState('0');
  const [filterDuration, setFilterDuration] = useState('');
  const [searchRange, setSearchRange] = useState('0');
  const [count, setCount] = useState(20);
  const [exactKeyword, setExactKeyword] = useState(false);
  const [excludeKeywords, setExcludeKeywords] = useState('');
  const [resultOrder, setResultOrder] = useState('provider');
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
  const [assessing, setAssessing] = useState(false);
  const [topicResults, setTopicResults] = useState<Record<string, { verdict: string; reason: string }>>({});
  const [hideOffTopic, setHideOffTopic] = useState(false);
  const topicController = useRef<AbortController | null>(null);
  useEffect(() => () => topicController.current?.abort(), []);
  const assessTopic = async () => {
    if (topicController.current || busy || applied !== queryKey) return;
    const assignment = capabilityAssignments(settings, 'translation')[0];
    const provider = providers.find((p) => p.id === assignment?.providerId && p.enabled);
    if (!provider || !assignment?.model) { setError('Chọn model dịch trong Cài đặt để đánh giá chủ đề.'); return; }
    const controller = new AbortController(); topicController.current = controller;
    setAssessing(true); setSelected(new Set()); setError('');
    const pending = items.filter((item) => !topicResults[item.id]);
    try {
      for (let start = 0; start < pending.length; start += 20) {
        const result = await api.assessDouyinTopic({ topic: keyword.trim(), provider, model: assignment.model, items: pending.slice(start, start + 20).map(({ id, title }) => ({ id, title })) }, controller.signal);
        if (controller.signal.aborted) break;
        setTopicResults((current) => ({ ...current, ...Object.fromEntries(result.items.map((item) => [item.id, item])) }));
      }
    } catch (cause) { if (!controller.signal.aborted) setError(friendlyErrorMessage(cause, 'Đánh giá chưa hoàn tất. Kết quả đã có vẫn được giữ.')); }
    finally { topicController.current = null; if (mounted.current) setAssessing(false); }
  };
  const searchLock = useRef(false);
  const translateKeyword = async () => {
    if (translateController.current || !keyword.trim()) return;
    const assignment = capabilityAssignments(settings, 'translation')[0];
    const provider = providers.find((p) => p.id === assignment?.providerId && p.enabled);
    if (!provider || !assignment?.model) { setError('Chọn nhà cung cấp và model dịch trong Cài đặt trước.'); return; }
    const controller = new AbortController();
    translateController.current = controller;
    setTranslating(true); setTranslation(''); setError('');
    try {
      const result = await api.translate(provider, assignment.model, [{ id: 'keyword', index: 0, startMs: 0, endMs: 10000, originalText: keyword.trim(), translatedText: '', voiceGroup: 'G1', enabled: true }], 'Auto Detect', 'Tiếng Trung giản thể', 'Từ khóa tìm kiếm', 'Dịch thành một cụm từ khóa tìm kiếm Douyin ngắn gọn, giữ đúng chủ đề. Không thêm hashtag, không giải thích, không mở rộng chủ đề.', [], controller.signal);
      const value = result.items.find((item) => item.id === 'keyword')?.translation.trim();
      if (!value || value.length > 100) throw new Error('AI chưa trả từ khóa hợp lệ. Thử lại hoặc nhập trực tiếp.');
      if (!controller.signal.aborted) setTranslation(value);
    } catch (cause) { if (!controller.signal.aborted) setError(friendlyErrorMessage(cause, 'Không dịch được từ khóa.')); }
    finally { translateController.current = null; if (!controller.signal.aborted) setTranslating(false); }
  };
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
  const queryKey = JSON.stringify([keyword.trim(), sort, publishTime, filterDuration, searchRange, count, cookie, cookieRevision, exactKeyword, excludeKeywords]);
  const displayItems = items.filter((item) => !hideOffTopic || topicResults[item.id]?.verdict !== 'off-topic').sort((a, b) => resultOrder === 'likes' ? b.likes - a.likes : resultOrder === 'duration' ? b.duration - a.duration : resultOrder === 'newest' ? b.publishedAt - a.publishedAt : 0);
  const search = async (event?: FormEvent, more = false) => {
    event?.preventDefault();
    if (searchLock.current || busy || assessing || cookieBusy || !keyword.trim()) return;
    if (more && (!page?.hasMore || applied !== queryKey)) return;
    searchLock.current = true;
    setBusy(true); setError(''); setWarning('');
    try {
      const result = await api.searchDouyin({ keyword: keyword.trim(), sort, publishTime, filterDuration, searchRange, count, exactKeyword, excludeKeywords, cookie: cookie.trim() || undefined, offset: more ? page?.nextOffset : 0, searchId: more ? page?.searchId : '' });
      if (!mounted.current) return;
      const merged = [...new Map([...(more ? items : []), ...result.items].map((item) => [item.id, item])).values()];
      setItems(merged); setPage(result); setApplied(queryKey);
      setWarning(result.warning);
      if (!more) { setSelected(new Set()); setTopicResults({}); setHideOffTopic(false); }
      setSummary(`${merged.length} video cho “${keyword.trim()}”. ${result.hasMore ? 'Có thể tải thêm kết quả bên dưới.' : 'Douyin không báo còn trang tiếp theo.'}${!merged.length ? ' Thử từ khóa khác hoặc bỏ bớt bộ lọc.' : ''}`);
    } catch (cause) { if (mounted.current) setError(friendlyErrorMessage(cause, 'Không tìm kiếm được Douyin.')); }
    finally { searchLock.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="douyin-search" aria-labelledby="douyin-search-title">
    <header className="douyin-search-heading"><div><span className="douyin-search-eyebrow">KHÁM PHÁ NỘI DUNG</span><h2 id="douyin-search-title"><Search size={26} aria-hidden="true" />Tìm video Douyin</h2><p>Tìm đúng nội dung. Chọn video. Chuyển sang tải hàng loạt.</p></div><span className="douyin-cookie-badge"><ShieldCheck size={16} aria-hidden="true" />{credential.saved ? 'Cookie đã lưu' : credential.environment ? 'Cookie từ cấu hình' : 'Chưa lưu cookie'}</span></header>
    <form onSubmit={(event) => void search(event)}>
      <div className="douyin-search-fields">
        <label>Từ khóa<input value={keyword} maxLength={100} required disabled={busy} onChange={(event) => setKeyword(event.target.value)} placeholder="Ví dụ: 美食, 动画, du lịch…" /></label>
        <div className="douyin-filter-field"><span>Sắp xếp</span><SelectField ariaLabel="Sắp xếp" value={sort} disabled={busy} onChange={setSort} options={[{"value":"0","label":"Liên quan"},{"value":"1","label":"Nhiều lượt thích"},{"value":"2","label":"Mới nhất"}]} /></div>
        <div className="douyin-filter-field"><span>Đăng trong</span><SelectField ariaLabel="Đăng trong" value={publishTime} disabled={busy} onChange={setPublishTime} options={[{"value":"0","label":"Mọi thời gian"},{"value":"1","label":"24 giờ"},{"value":"7","label":"7 ngày"},{"value":"180","label":"180 ngày"}]} /></div>
        <button className="button primary" disabled={busy || assessing || cookieBusy || !keyword.trim()} type="submit"><Search size={17} aria-hidden="true" />{busy ? 'Đang tìm kiếm…' : 'Tìm video'}</button>
      </div>
      <div className="douyin-search-fields">
        <div className="douyin-filter-field"><span>Thời lượng</span><SelectField ariaLabel="Thời lượng" value={filterDuration} disabled={busy} onChange={setFilterDuration} options={[{"value":"","label":"Tất cả"},{"value":"0-1","label":"Dưới 1 phút"},{"value":"1-5","label":"1–5 phút"},{"value":"5-10000","label":"Trên 5 phút"},{"value":"60+","label":"Trên 1 giờ (lọc thời lượng thực)"}]} /></div>
        <div className="douyin-filter-field"><span>Phạm vi</span><SelectField ariaLabel="Phạm vi" value={searchRange} disabled={busy} onChange={setSearchRange} options={[{"value":"0","label":"Tất cả video"},{"value":"1","label":"Đã xem"},{"value":"2","label":"Chưa xem"},{"value":"3","label":"Đang theo dõi"}]} /></div>
        <div className="douyin-filter-field"><span>Mục tiêu mỗi lần tìm</span><SelectField ariaLabel="Mục tiêu mỗi lần tìm" value={String(count)} disabled={busy} onChange={(value) => setCount(Number(value))} options={[{"value":"10","label":"10 video"},{"value":"20","label":"20 video"},{"value":"25","label":"25 video"}]} /></div>
        <button type="button" className="button ghost" disabled={busy} onClick={() => { setSort('0'); setPublishTime('0'); setFilterDuration(''); setSearchRange('0'); setExactKeyword(false); setExcludeKeywords(''); setResultOrder('provider'); }}>Đặt lại bộ lọc</button>
      </div>
      <details className="douyin-trends"><summary>Xu hướng Douyin · chọn chủ đề để tìm video</summary>
        <button className="button ghost" type="button" disabled={trendsBusy} onClick={() => void loadTrends()}>{trendsBusy ? 'Đang lấy xu hướng…' : trends ? 'Cập nhật bảng xu hướng' : 'Tải bảng xu hướng'}</button>
        <small>Chỉ số độ nóng của chủ đề, không phải lượt xem video. Bộ nhớ đệm tối đa 5 phút.</small>
        {trendsError && <p role="alert">{trendsError}</p>}
        {trends && <><p>Lấy lúc {new Date(trends.fetchedAt).toLocaleString('vi-VN')}{trendsError ? ' · Dữ liệu lần trước, chưa cập nhật được.' : ''}</p><ol className="douyin-trends-list">{trends.items.map((trend) => <li key={trend.topic}><button className="button ghost" type="button" disabled={busy || assessing} onClick={() => { setKeyword(trend.topic); setSort('0'); setPublishTime('0'); setFilterDuration(''); setSearchRange('0'); setExactKeyword(false); setExcludeKeywords(''); }}><span>#{trend.rank} {trend.topic}</span><small>{trend.heat === null ? 'Chưa rõ độ nóng' : `Độ nóng ${trend.heat.toLocaleString('vi-VN')}`}</small></button></li>)}</ol><small>Chọn chủ đề rồi bấm Tìm video để lấy kết quả qua DouYin_Spider.</small></>}
      </details>
      <div className="douyin-search-presets" aria-label="Bộ lọc nhanh">
        <span>Tìm nhanh</span>
        <a className="button ghost" href="https://www.iesdouyin.com/share/billboard/?id=0&share_app_name=douyin" target="_blank" rel="noopener noreferrer">Mở bảng xu hướng chính thức ↗</a>
        <button type="button" className="button ghost" disabled={busy} onClick={() => { setSort('1'); setPublishTime('7'); setResultOrder('likes'); }}>Nổi bật 7 ngày</button>
        <button type="button" className="button ghost" disabled={busy} onClick={() => { setFilterDuration('60+'); setPublishTime('0'); }}>Video trên 1 giờ</button>
        <button type="button" className="button ghost" disabled={busy} onClick={() => { setSort('2'); setPublishTime('1'); setResultOrder('newest'); }}>Mới trong 24 giờ</button>
      </div>
      <small>“Nổi bật” tìm theo lượt thích và thời gian trong chủ đề bạn nhập; không phải bảng trending chính thức của toàn Douyin. Chọn bộ lọc rồi bấm Tìm video.</small>
      <details className="douyin-advanced"><summary>Lọc nội dung nâng cao{exactKeyword || excludeKeywords.trim() ? ' · Đang áp dụng' : ''}</summary>
      <div className="douyin-topic-filters">
        <label className="douyin-exact-toggle"><input type="checkbox" disabled={busy} checked={exactKeyword} onChange={(e) => setExactKeyword(e.target.checked)} />Tiêu đề/hashtag phải chứa đúng cụm từ khóa</label>
        <label>Loại trừ từ/cụm từ<input value={excludeKeywords} maxLength={300} disabled={busy} onChange={(e) => setExcludeKeywords(e.target.value)} placeholder="Ví dụ: 广告, 直播 (ngăn cách bằng dấu phẩy)" /></label>
      </div>
      <small>Lọc đúng cụm từ không tự dịch hoặc hiểu từ đồng nghĩa. Bộ lọc chặt và video dài có thể cho ít kết quả; Tải thêm sẽ tiếp tục tìm, không chèn video không khớp.</small>
      <small>Tự lấy tiếp tối đa 6 trang để đạt mục tiêu; loại kết quả trùng và không phải video. Số thực nhận phụ thuộc Douyin, không bỏ video dư ở cuối trang.</small>
      </details>
      <details className="douyin-cookie-panel"><summary>Quản lý cookie đăng nhập</summary><label>Cookie mới<input type="password" autoComplete="off" maxLength={20000} value={cookie} disabled={busy || cookieBusy} onChange={(event) => setCookie(event.target.value)} placeholder={credential.saved ? 'Đã lưu — chỉ nhập nếu muốn đổi tài khoản' : 'Dán Cookie dạng Header String'} aria-describedby="douyin-cookie-help" /></label><small id="douyin-cookie-help">Lưu mã hóa bằng Windows trên máy này, không đưa cookie trở lại trình duyệt. Cookie hết hạn cần thay mới. Xóa ở đây không xóa DY_COOKIES trong cấu hình.</small><div className="douyin-search-actions"><button className="button primary" type="button" disabled={busy || cookieBusy || !cookie.trim()} onClick={() => void manageCookie()}>{cookieBusy ? 'Đang xử lý…' : 'Lưu cookie'}</button><button className="button ghost" type="button" disabled={busy || cookieBusy || !credential.saved} onClick={() => void manageCookie(true)}>Xóa cookie đã lưu</button></div><p role="status">{cookieNotice}</p></details>
    </form>
    <div className="douyin-search-actions"><button className="button ghost" type="button" disabled={busy || translating || !keyword.trim()} onClick={() => void translateKeyword()}>{translating ? 'Đang dịch từ khóa…' : 'Dịch từ khóa sang tiếng Trung bằng AI'}</button><small>Dùng model dịch trong Cài đặt, có thể tính phí API. Không tự thay từ khóa hoặc tự tìm.</small></div>
    {translation && <div className="douyin-search-actions"><span>AI đề xuất: {translation}</span><button className="button ghost" type="button" disabled={busy || translating} onClick={() => { setKeyword(translation); setTranslation(''); }}>Dùng từ khóa này</button></div>}
    {busy && <p role="status">Đang hỏi Douyin, tối đa khoảng 90 giây. Không cần bấm lại.</p>}
    {error && <p role="alert" className="douyin-search-error">{error}</p>}
    {warning && <p role="status">{warning}</p>}
    <p role="status">{summary}</p>
    {!page && !busy && !error && <div className="douyin-search-empty"><Film size={36} aria-hidden="true" /><h3>Bắt đầu từ một chủ đề</h3><p>Nhập từ khóa, chọn bộ lọc rồi tìm video. Từ khóa tiếng Trung thường cho kết quả sát hơn.</p></div>}
    {items.length > 0 && <>
      <div className="douyin-search-actions">
        <button type="button" className="button ghost" disabled={busy || assessing || applied !== queryKey || items.every((item) => topicResults[item.id])} onClick={() => void assessTopic()}>{assessing ? 'Đang đánh giá chủ đề…' : 'AI đánh giá chủ đề các video chưa kiểm tra'}</button>
        {assessing && <button type="button" className="button ghost" onClick={() => topicController.current?.abort()}>Dừng đánh giá</button>}
        <small>Dùng model dịch, có thể tính phí. Chỉ phân tích tiêu đề/hashtag, không xem video. Đã đánh giá {Object.keys(topicResults).length}/{items.length}.</small>
        <label><input type="checkbox" checked={hideOffTopic} onChange={(e) => { setHideOffTopic(e.target.checked); setSelected(new Set()); }} />Ẩn video AI đánh giá lệch chủ đề (giữ video chưa chắc)</label>
      </div>
      <p role="status">Đang hiển thị {displayItems.length}/{items.length} video. {hideOffTopic && 'Bỏ chọn bộ lọc AI để xem lại toàn bộ.'}</p>
      <div className="douyin-search-actions"><button className="button ghost" type="button" disabled={!displayItems.length || assessing} onClick={() => setSelected(selected.size === displayItems.length ? new Set() : new Set(displayItems.map((item) => item.id)))}>{selected.size === displayItems.length && displayItems.length > 0 ? 'Bỏ chọn tất cả' : 'Chọn các video đang hiện'}</button><button className="button primary" type="button" disabled={!selected.size || assessing} onClick={() => { onAdd(displayItems.filter((item) => selected.has(item.id)).map((item) => item.url)); setSummary('Đã chuyển các video đã chọn sang tab tải.'); setSelected(new Set()); }}>Thêm {selected.size} video đã chọn</button></div>
      <button className="button ghost" type="button" disabled={!selected.size} onClick={exportLinks}><Download size={16} aria-hidden="true" />Xuất link đã chọn (.txt)</button>
      <div className="douyin-filter-field douyin-result-order"><span>Sắp xếp các video đã lấy</span><SelectField ariaLabel="Sắp xếp các video đã lấy" value={resultOrder} disabled={busy} onChange={setResultOrder} options={[{"value":"provider","label":"Thứ tự Douyin trả về"},{"value":"likes","label":"Lượt thích cao nhất"},{"value":"newest","label":"Ngày đăng mới nhất"},{"value":"duration","label":"Thời lượng dài nhất"}]} /></div>
      <div className="douyin-search-results">{displayItems.map((item) => <DouyinVideoCard key={item.id} item={item} assessment={topicResults[item.id]} selected={selected.has(item.id)} onSelect={() => setSelected((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} />)}</div>
    </>}
    {page && <div className="douyin-search-actions">
      {page.hasMore && <button className="button primary" type="button" disabled={busy || assessing || applied !== queryKey} onClick={() => void search(undefined, true)}>{busy ? 'Đang tải…' : 'Tải thêm video'}</button>}
      {applied !== queryKey && <p role="status">Bộ lọc hoặc cookie đã đổi. Bấm Tìm video để áp dụng.</p>}
    </div>}
  </section>;
}
