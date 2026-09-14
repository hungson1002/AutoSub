import { useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronDown, Search, Upload } from '../components/Icons';
import type { UploadedSubtitleFont } from '../lib/fontLibrary';
import { subtitleFonts } from './subtitleFonts';

const storageKey = 'autosub.font-bookmarks';

const initialBookmarks = () => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};

const safeFontName = (name: string) => name
  .replace(/\.[^.]+$/, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim() || 'Uploaded Font';

type Props = {
  value: string;
  onChange: (family: string) => void;
  uploadedFonts?: UploadedSubtitleFont[];
  onFontUpload?: (file: File, family: string) => Promise<void> | void;
  label?: string;
};

export function FontLibraryPicker({ value, onChange, uploadedFonts = [], onFontUpload, label = 'Font chữ' }: Props) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bookmarks, setBookmarks] = useState<string[]>(initialBookmarks);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const options = [
    ...subtitleFonts.map((font) => ({ value: font, label: font, description: 'Có sẵn' })),
    ...uploadedFonts.map((font) => ({ value: font.family, label: font.name, description: 'Font đã tải' })),
    ...value && !subtitleFonts.includes(value as typeof subtitleFonts[number]) && !uploadedFonts.some((font) => font.family === value)
      ? [{ value, label: value, description: 'Font hiện tại' }]
      : [],
  ].sort((left, right) => Number(bookmarks.includes(right.value)) - Number(bookmarks.includes(left.value)));
  const filtered = options.filter((font) => `${font.label} ${font.value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = options.find((font) => font.value === value);

  const toggleBookmark = (family: string) => {
    setBookmarks((current) => {
      const next = current.includes(family) ? current.filter((item) => item !== family) : [...current, family];
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the session preference. */ }
      return next;
    });
  };
  const upload = async (file?: File) => {
    if (!file) return;
    const family = `AutoSub ${safeFontName(file.name)}`;
    try {
      await onFontUpload?.(file, family);
      onChange(family);
    } catch { /* Invalid font files keep the current selection unchanged. */ }
  };

  return <div className="field"><span>{label}</span><div className="font-picker-row"><div className="voice-picker font-library-picker" ref={pickerRef}><button type="button" className={`voice-picker-trigger ${open ? 'active' : ''}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className="voice-picker-selected"><strong style={{ fontFamily: value }}>{selected?.label || value}</strong><small>{bookmarks.includes(value) ? 'Đã bookmark · luôn ở đầu' : selected?.description || 'Font chữ'}</small></span><ChevronDown size={15} className={open ? 'rotated' : ''} /></button>{open && <div className="voice-picker-menu"><label className="voice-picker-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm font chữ..." /></label><div className="voice-picker-meta">{filtered.length} font · bookmark được xếp lên đầu</div><div className="voice-picker-list">{filtered.length ? filtered.map((font) => <div className={`voice-picker-option ${font.value === value ? 'selected' : ''}`} key={font.value}><button type="button" className={`voice-picker-bookmark ${bookmarks.includes(font.value) ? 'active' : ''}`} aria-label={`${bookmarks.includes(font.value) ? 'Bỏ bookmark' : 'Bookmark'} ${font.label}`} aria-pressed={bookmarks.includes(font.value)} onClick={() => toggleBookmark(font.value)}><Bookmark size={15} fill={bookmarks.includes(font.value) ? 'currentColor' : 'none'} /></button><button type="button" className="voice-picker-option-main font-picker-option-main" style={{ fontFamily: font.value }} onClick={() => { onChange(font.value); setOpen(false); }}><span><strong>{font.label}</strong><small>{font.description || font.value}</small></span></button></div>) : <div className="voice-picker-empty">Không tìm thấy font phù hợp.</div>}</div></div>}</div><label className="font-upload-button" title="Tải font TTF, OTF, WOFF hoặc WOFF2"><Upload size={14} /><input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ''; }} />Tải font</label></div></div>;
}
