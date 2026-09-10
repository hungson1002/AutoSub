import { useEffect, useState } from 'react';

type Tunnel = { tunnelId: string; hasKey: boolean; phase: string; message: string };
async function tunnelRequest<T>(suffix = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/mcp-settings/tunnel${suffix}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-AutoSub-Settings': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Không kết nối được backend AutoSub.');
  return result as T;
}
const labels: Record<string, string> = { stopped: 'Chưa kết nối', installing: 'Đang tải tunnel-client chính thức…', starting: 'Đang kết nối…', ready: 'Tunnel sẵn sàng', error: 'Kết nối thất bại' };
export function McpTunnelPanel({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<Tunnel>();
  const [tunnelId, setTunnelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let initialized = false;
    const poll = async () => {
      try {
        const next = await tunnelRequest<Tunnel>();
        if (active) { setState(next); if (!initialized) { setTunnelId(next.tunnelId); initialized = true; } }
      } catch { if (active) setError('Không đọc được trạng thái tunnel. Kiểm tra backend; ứng dụng sẽ thử lại.'); }
      finally { if (active) timer = setTimeout(() => void poll(), 3000); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  const running = state && ['starting', 'installing', 'ready'].includes(state.phase);
  async function connect() {
    setBusy(true); setError('');
    try {
      await tunnelRequest('/connect', { tunnelId: tunnelId.trim(), apiKey: apiKey.trim() });
      setApiKey(''); setState(await tunnelRequest<Tunnel>());
    } catch (err) { setError(err instanceof Error ? err.message : 'Không kết nối được tunnel.'); }
    finally { setBusy(false); }
  }
  return <div className="mcp-tunnel">
    <h3>ChatGPT · Secure MCP Tunnel</h3>
    <p>Nhập thông tin rồi kết nối ngay tại đây. Lần đầu AutoSub tải tunnel-client chính thức từ OpenAI/GitHub và kiểm tra SHA-256. Không mở công khai backend của bạn.</p>
    <p><a href="https://platform.openai.com/settings/organization/tunnels" target="_blank" rel="noreferrer">Lấy Tunnel ID</a> · <a href="https://platform.openai.com/settings/organization/api-keys" target="_blank" rel="noreferrer">Tạo Runtime API key</a></p>
    <label>Tunnel ID<input value={tunnelId} disabled={busy || !!running} onChange={(event) => setTunnelId(event.target.value)} placeholder="tunnel_0123456789abcdef0123456789abcdef" spellCheck={false} autoComplete="off" /></label>
    <label>OpenAI Runtime API key<input type="password" value={apiKey} disabled={busy || !!running} onChange={(event) => setApiKey(event.target.value)} placeholder={state?.hasKey ? 'Đã lưu khóa mã hóa — để trống để dùng lại' : 'sk-…'} autoComplete="off" spellCheck={false} /></label>
    <p>Khóa được mã hóa bằng tài khoản Windows hiện tại, không ghi vào .env hoặc trả lại trình duyệt. Cần quyền Tunnels Read + Use; không dùng Admin key.</p>
    {!enabled && <p>Bật và bấm “Lưu MCP” ở trên trước khi kết nối.</p>}
    <div className="mcp-actions">
      <button className="button primary" disabled={busy || !!running || !enabled || !state || !tunnelId.trim() || (!apiKey.trim() && !state.hasKey)} onClick={() => void connect()}>{busy ? 'Đang xử lý…' : 'Lưu & kết nối tunnel'}</button>
      <button className="button ghost" disabled={busy || !running} onClick={() => { setBusy(true); setError(''); void tunnelRequest<Tunnel>('/disconnect', {}).then(setState).catch(() => setError('Không ngắt được tunnel. Kiểm tra backend.')).finally(() => setBusy(false)); }}>Ngắt kết nối</button>
    </div>
    <p role="status">{state ? labels[state.phase] || 'Đang kiểm tra' : 'Đang đọc cấu hình…'}{state?.message && ` — ${state.message}`}</p>
    {error && <p role="alert">{error}</p>}
    <p>Khi báo sẵn sàng: trong ChatGPT chọn kết nối <strong>Tunnel</strong>, chọn đúng Tunnel ID này. Tunnel phải thuộc đúng tổ chức/workspace. Giữ AutoSub chạy; sau khi khởi động lại, bấm kết nối để dùng lại khóa đã lưu.</p>
  </div>;
}
