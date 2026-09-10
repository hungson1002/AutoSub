import { useEffect, useState } from 'react';
import { McpTunnelPanel } from './McpTunnelPanel';

type Settings = { enabled: boolean; allowWrites: boolean; hasToken: boolean; endpoint: string; desktopConfig: unknown };
async function request<T>(suffix = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/mcp-settings${suffix}`, { method, headers: { 'Content-Type': 'application/json', 'X-AutoSub-Settings': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error('Không kết nối được cấu hình MCP. Kiểm tra backend AutoSub.');
  return response.json() as Promise<T>;
}
export function McpSettingsPanel() {
  const [settings, setSettings] = useState<Settings>();
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  useEffect(() => { let active = true; void request<Settings>().then((value) => { if (active) { setSettings(value); setSavedEnabled(value.enabled); } }).catch((err: Error) => { if (active) setError(err.message); }); return () => { active = false; }; }, []);
  async function action(run: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await run(); } catch (err) { setError(err instanceof Error ? err.message : 'Thao tác thất bại.'); } finally { setBusy(false); }
  }
  return <section className="settings-section mcp-settings">
    <div className="settings-heading"><div><h2>MCP · Kết nối trợ lý AI</h2><p>Cho ứng dụng hỗ trợ MCP đọc, chỉnh sửa và render project AutoSub trên máy này.</p></div><span>{settings ? savedEnabled ? 'Đang bật' : 'Đang tắt' : 'Chưa kết nối'}</span></div>
    <p>Bản đầu: danh sách project, đọc/tạo/lưu animation, render MP4 và xem tiến độ. Chưa gọi tạo ảnh/video AI, chưa dùng credit Flow.</p>
    {settings && <>
      <div className="mcp-options">
        <label><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /> Bật MCP server</label>
        <label><input type="checkbox" checked={settings.allowWrites} disabled={busy} onChange={(event) => setSettings({ ...settings, allowWrites: event.target.checked })} /> Cho phép tạo, sửa project và render (dùng CPU máy)</label>
      </div>
      <p>Quyền chỉnh sửa áp dụng cho toàn bộ project animation đã lưu. Mặc định chỉ đọc. Bấm Lưu để áp dụng.</p>
      <div className="mcp-actions"><button className="button primary" disabled={busy} onClick={() => void action(async () => { const value = await request<Settings>('', 'PUT', { enabled: settings.enabled, allowWrites: settings.allowWrites }); setSettings(value); setSavedEnabled(value.enabled); setMessage('Đã lưu cấu hình MCP.'); })}>{busy ? 'Đang xử lý…' : 'Lưu MCP'}</button>
      <button className="button ghost" disabled={busy} onClick={() => void action(async () => { const value = await request<Settings>(); setSettings(value); setSavedEnabled(value.enabled); setMessage('Đã tải trạng thái từ backend.'); })}>Tải lại trạng thái</button></div>
      <McpTunnelPanel enabled={savedEnabled} />
      <details><summary>Kết nối ứng dụng desktop qua stdio</summary>
        <p>Giữ AutoSub đang chạy. Sao chép cấu hình dưới vào ứng dụng MCP hỗ trợ stdio rồi khởi động lại kết nối. Cầu nối tự đọc khóa mới từ máy, không cần dán token.</p>
        <textarea aria-label="Cấu hình MCP desktop" readOnly rows={12} value={JSON.stringify(settings.desktopConfig, null, 2)} />
        <button className="button ghost" disabled={busy} onClick={() => void action(async () => { await navigator.clipboard.writeText(JSON.stringify(settings.desktopConfig, null, 2)); setMessage('Đã sao chép cấu hình desktop.'); })}>Sao chép cấu hình</button>
      </details>
      <details><summary>Streamable HTTP / kết nối từ xa</summary>
        <label>Endpoint cục bộ<input readOnly value={settings.endpoint} /></label>
        <p>Client HTTP cần header Authorization: Bearer &lt;token&gt;. ChatGPT/Claude trên web không truy cập trực tiếp localhost: cần HTTPS hoặc cầu nối/tunnel được client hỗ trợ. Không đưa toàn bộ backend AutoSub ra Internet; chỉ proxy đường dẫn /api/mcp. Bản này chưa cung cấp OAuth hoặc tự tạo tunnel.</p>
        <button className="button ghost" disabled={busy} onClick={() => { if (window.confirm('Đổi khóa sẽ vô hiệu khóa HTTP cũ. Cầu nối desktop tự nhận khóa mới. Tiếp tục?')) void action(async () => { const value = await request<Settings & { token: string }>('/rotate-token', 'POST'); setToken(value.token); setSettings(value); setMessage('Đã đổi khóa. Chỉ sao chép vào client tin cậy.'); }); }}>Tạo / đổi khóa HTTP</button>
        {token && <label>Khóa mới (ẩn sau khi rời trang)<input type="password" readOnly value={token} autoComplete="off" /><button className="button ghost" disabled={busy} onClick={() => void action(async () => { await navigator.clipboard.writeText(token); setMessage('Đã sao chép khóa. Không chia sẻ khóa trong hội thoại.'); })}>Sao chép khóa</button></label>}
      </details>
    </>}
    {error && <p role="alert">{error} <button className="button ghost" disabled={busy} onClick={() => void action(async () => { setSettings(await request<Settings>()); })}>Thử lại</button></p>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
