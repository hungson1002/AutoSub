import { useState, type ReactNode } from 'react';
import { ArrowDownToLine, AudioLines, Captions, Clapperboard, Film, HardDrive, Layers3, Megaphone, PanelLeftClose, PanelLeftOpen, Settings2, Video, Volume2, WandSparkles, Zap } from './Icons';
export type Page = 'pipeline' | 'translate' | 'extract' | 'editor' | 'review' | 'product-ads' | 'ai-video' | 'animation-studio' | 'voice-clone' | 'douyin' | 'storage' | 'settings';
const nav = [
  { id: 'extract' as const, label: 'Trích xuất phụ đề', caption: 'OCR / âm thanh', icon: Clapperboard },
  { id: 'translate' as const, label: 'Dịch phụ đề', caption: 'SRT / VTT → bản dịch', icon: Captions },
  { id: 'editor' as const, label: 'Lồng tiếng video', caption: 'Dựng, style, xuất file', icon: AudioLines },
  { id: 'pipeline' as const, label: 'Pipeline 1 chạm', caption: 'Trích xuất → dịch → lồng tiếng', icon: WandSparkles },
  { id: 'voice-clone' as const, label: 'Clone giọng', caption: 'Tạo voice TTS cục bộ', icon: Volume2 },
  { id: 'douyin' as const, label: 'Tải Douyin/Bilibili', caption: 'Tải video công khai hàng loạt', icon: ArrowDownToLine },
  { id: 'review' as const, label: 'Review tự động', caption: 'Script · voice · YouTube', icon: Film },
  { id: 'product-ads' as const, label: 'Quảng cáo sản phẩm', caption: 'Ảnh · script · video ngắn', icon: Megaphone },
  { id: 'ai-video' as const, label: 'AI Video Studio', caption: 'Kịch bản → Flow → MP4', icon: Video },
  { id: 'animation-studio' as const, label: 'Animation Studio', caption: 'Layer · motion · timeline', icon: Layers3 },
  { id: 'storage' as const, label: 'Tệp & dung lượng', caption: 'Xem và dọn file đã lưu', icon: HardDrive },
  { id: 'settings' as const, label: 'Cài đặt', caption: 'Provider & hệ thống', icon: Settings2 },
];

const sidebarStorageKey = 'autosub.sidebar-collapsed';

export function Layout({ page, setPage, children, cueCount, providerCount }: { page: Page; setPage: (page: Page) => void; children: ReactNode; cueCount: number; providerCount: number }) {
  const [tooltip, setTooltip] = useState<{ label: string; left: number; top: number }>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(sidebarStorageKey) === 'true'; }
    catch { return false; }
  });

  const toggleSidebar = () => {
    setTooltip(undefined);
    setSidebarCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem(sidebarStorageKey, String(next)); }
      catch { /* Storage may be unavailable in private/restricted contexts. */ }
      return next;
    });
  };

  const showTooltip = (label: string, target: HTMLButtonElement) => {
    if (!sidebarCollapsed || !window.matchMedia('(min-width: 701px)').matches) return;
    const bounds = target.getBoundingClientRect();
    setTooltip({ label, left: bounds.right + 10, top: bounds.top + bounds.height / 2 });
  };
  const hideTooltip = () => setTooltip(undefined);

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <button className="sidebar-toggle" type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? 'Mở thanh điều hướng' : 'Thu gọn thanh điều hướng'} aria-expanded={!sidebarCollapsed} onMouseEnter={(event) => showTooltip('Mở thanh điều hướng', event.currentTarget)} onMouseLeave={hideTooltip} onFocus={(event) => showTooltip('Mở thanh điều hướng', event.currentTarget)} onBlur={hideTooltip}>
        {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
      <div className="brand"><div className="brand-mark"><Zap size={16} fill="currentColor" /></div><div><strong>AutoSub</strong><span>STUDIO / LOCAL</span></div></div>
      <div className="side-label">WORKSPACE</div>
      <nav onScroll={hideTooltip}>{nav.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { hideTooltip(); setPage(item.id); }} aria-label={sidebarCollapsed ? item.label : undefined} onMouseEnter={(event) => showTooltip(item.label, event.currentTarget)} onMouseLeave={hideTooltip} onFocus={(event) => showTooltip(item.label, event.currentTarget)} onBlur={hideTooltip}>
          <Icon size={18} strokeWidth={1.8} /><span><b>{item.label}</b><small>{item.caption}</small></span>
          {item.id === 'editor' && cueCount > 0 && <em>{cueCount}</em>}
          {item.id === 'settings' && providerCount > 0 && <em className="green-dot" />}
        </button>;
      })}</nav>
    </aside>
    {tooltip && <div className="sidebar-floating-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.label}</div>}
    <main className="main-content">{children}</main>
  </div>;
}
