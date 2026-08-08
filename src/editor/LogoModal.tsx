import { useEffect, useRef, useState } from 'react';
import type { LogoOverlay, LogoPosition } from '../types';
import { Check, Upload } from '../components/Icons';
import { Modal } from '../components/Modal';
import { SelectField } from '../components/SelectField';

const positionMap: Record<Exclude<LogoPosition, 'custom'>, { x: number; y: number }> = {
  'top-left': { x: 4, y: 5 }, 'top-center': { x: 41, y: 5 }, 'top-right': { x: 78, y: 5 },
  'middle-left': { x: 4, y: 43 }, center: { x: 41, y: 43 }, 'middle-right': { x: 78, y: 43 },
  'bottom-left': { x: 4, y: 82 }, 'bottom-center': { x: 41, y: 82 }, 'bottom-right': { x: 78, y: 82 },
};

const defaultLogo: LogoOverlay = { name: '', enabled: true, kind: 'image', text: 'AutoSub', fontFamily: 'Arial', fontSize: 24, textColor: '#ffffff', outlineColor: '#10141b', position: 'top-left', xPercent: 4, yPercent: 5, widthPercent: 18, opacity: 1 };
const builtInFonts = ['Arial', 'Segoe UI', 'Tahoma', 'Verdana', 'Georgia', 'Courier New', 'Consolas'];

export function LogoModal({ open, logo, externalPosition, onClose, onChange, onPreviewChange }: { open: boolean; logo?: LogoOverlay; externalPosition?: Pick<LogoOverlay, 'position' | 'xPercent' | 'yPercent'>; onClose: () => void; onChange: (logo: LogoOverlay) => void; onPreviewChange?: (logo?: LogoOverlay) => void }) {
  const draftRef = useRef<LogoOverlay>(logo ?? defaultLogo);
  const [draft, setDraft] = useState<LogoOverlay>(draftRef.current);
  const savedRef = useRef(false);

  useEffect(() => { if (open) { savedRef.current = false; const next = logo ? { ...logo } : { ...defaultLogo }; draftRef.current = next; setDraft(next); onPreviewChange?.(next); } }, [open]);
  useEffect(() => {
    if (!open || !externalPosition) return;
    const current = draftRef.current;
    if (current.position === externalPosition.position && current.xPercent === externalPosition.xPercent && current.yPercent === externalPosition.yPercent) return;
    const next = { ...current, ...externalPosition };
    // Dragging on the video owns the coordinates. Keep the latest values in a
    // ref for Save, but do not re-render the popup for every pointer frame;
    // that feedback loop is what made the logo jump while dragging.
    draftRef.current = next;
    if (current.position !== externalPosition.position) setDraft(next);
  }, [open, externalPosition?.position, externalPosition?.xPercent, externalPosition?.yPercent]);
  const patch = (change: Partial<LogoOverlay>) => {
    const next = { ...draftRef.current, ...change };
    draftRef.current = next;
    setDraft(next);
    onPreviewChange?.(next);
  };
  const close = () => { const current = draftRef.current; if (!savedRef.current) { onPreviewChange?.(logo); if (current.url?.startsWith('blob:') && current.url !== logo?.url) URL.revokeObjectURL(current.url); } savedRef.current = false; onClose(); };
  const selectPosition = (position: LogoPosition) => { const point = position === 'custom' ? undefined : positionMap[position]; patch({ position, ...(point ? { xPercent: point.x, yPercent: point.y } : {}) }); };
  const upload = (file?: File) => { if (!file) return; const url = URL.createObjectURL(file); const current = draftRef.current; if (current.url?.startsWith('blob:') && current.url !== logo?.url) URL.revokeObjectURL(current.url); patch({ file, url, name: file.name, kind: 'image', enabled: true }); };
  const save = () => { const current = draftRef.current; if (current.kind === 'image' && !current.file && !current.url) return; savedRef.current = true; onChange(current); onPreviewChange?.(current); onClose(); };

  return <Modal open={open} title="Thiết lập Logo / Watermark" eyebrow="VIDEO BRANDING" onClose={close} className="logo-modal" backdropClassName="logo-modal-backdrop">
    <label className="logo-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /><span>Bật chèn logo/watermark vào video</span><i /></label>
    <div className="logo-type-row"><span>Loại logo:</span><label><input type="radio" checked={draft.kind === 'text'} onChange={() => patch({ kind: 'text' })} /> Chữ <small>(Text)</small></label><label><input type="radio" checked={draft.kind === 'image'} onChange={() => patch({ kind: 'image' })} /> Hình ảnh <small>(Image)</small></label></div>
    {draft.kind === 'image' ? <div className="logo-upload-field"><strong>Upload hình ảnh logo (PNG, JPG)</strong><label className="button secondary"><Upload size={14} /> {draft.name || 'Chọn file ảnh…'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => { upload(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>{draft.url && <img className="logo-upload-preview" src={draft.url} alt="Logo preview" />}</div> : <div className="field"><span>Nội dung chữ logo</span><input value={draft.text} onChange={(event) => patch({ text: event.target.value })} placeholder="Nhập nội dung logo" /></div>}
    {draft.kind === 'text' && <div className="logo-text-options"><div className="field"><span>Font chữ</span><SelectField ariaLabel="Font chữ logo" value={draft.fontFamily} onChange={(value) => patch({ fontFamily: value })} options={builtInFonts.map((font) => ({ value: font, label: font }))} /></div><label className="field"><span>Cỡ chữ <b className="value-badge">{draft.fontSize}px</b></span><input type="range" min={12} max={96} value={draft.fontSize} onChange={(event) => patch({ fontSize: Number(event.target.value) })} /></label><label className="field"><span>Màu chữ</span><input type="color" value={draft.textColor} onChange={(event) => patch({ textColor: event.target.value })} /></label><label className="field"><span>Màu viền</span><input type="color" value={draft.outlineColor} onChange={(event) => patch({ outlineColor: event.target.value })} /></label></div>}
    <div className="field logo-position-field"><span>Vị trí hiển thị</span><SelectField ariaLabel="Vị trí logo" value={draft.position} onChange={(value) => selectPosition(value as LogoPosition)} options={[{ value: 'top-left', label: 'Góc trên - Trái' }, { value: 'top-center', label: 'Góc trên - Giữa' }, { value: 'top-right', label: 'Góc trên - Phải' }, { value: 'middle-left', label: 'Giữa - Trái' }, { value: 'center', label: 'Chính giữa' }, { value: 'middle-right', label: 'Giữa - Phải' }, { value: 'bottom-left', label: 'Góc dưới - Trái' }, { value: 'bottom-center', label: 'Góc dưới - Giữa' }, { value: 'bottom-right', label: 'Góc dưới - Phải' }, { value: 'custom', label: 'Tự chọn · kéo trên video' }]} /></div>
    <div className="two-fields logo-range-row"><label className="field"><span>Độ mờ (Opacity) <b className="value-badge">{Math.round(draft.opacity * 100)}%</b></span><input type="range" min={0.1} max={1} step={0.05} value={draft.opacity} onChange={(event) => patch({ opacity: Number(event.target.value) })} /></label><label className="field"><span>Kích thước (Scale) <b className="value-badge">{Math.round((draft.widthPercent / 18) * 100)}%</b></span><input type="range" min={6} max={60} step={1} value={draft.widthPercent} onChange={(event) => patch({ widthPercent: Number(event.target.value) })} /></label></div>
    <div className="logo-modal-preview"><span>PREVIEW</span><div>{draft.kind === 'image' && draft.url ? <img src={draft.url} alt="" style={{ opacity: draft.opacity, width: `${Math.min(draft.widthPercent * 2.2, 75)}%` }} /> : <strong style={{ color: draft.textColor, fontFamily: draft.fontFamily, fontSize: `${Math.min(draft.fontSize, 44)}px`, textShadow: `1px 1px 0 ${draft.outlineColor}, -1px -1px 0 ${draft.outlineColor}` }}>{draft.text || 'AutoSub'}</strong>}</div></div>
    <div className="modal-actions"><button className="button ghost" onClick={close}>Hủy</button><button className="button primary" disabled={(draft.kind === 'image' && !draft.url) || (draft.kind === 'text' && !draft.text.trim())} onClick={save}><Check size={15} /> Lưu logo</button></div>
  </Modal>;
}
