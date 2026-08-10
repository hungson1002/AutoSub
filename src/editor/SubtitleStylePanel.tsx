import { useEffect, useRef, useState } from 'react';
import type { SubtitleStyle } from '../types';
import { Upload } from '../components/Icons';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { subtitleFonts } from './subtitleFonts';

type UploadedFont = { family: string; name: string; url: string };
type ColorKey = 'textColor' | 'outlineColor' | 'backgroundColor';

const safeFontName = (name: string) => name
  .replace(/\.[^.]+$/, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim() || 'Uploaded Font';

type SubtitleStylePanelProps = {
  style: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
  onFontUpload?: (file: File) => void;
};

export function SubtitleStylePanel({ style, onChange, onFontUpload }: SubtitleStylePanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const colorTimerRef = useRef<number | undefined>(undefined);
  const pendingColorPatchRef = useRef<Partial<SubtitleStyle>>({});
  const onChangeRef = useRef(onChange);
  const [uploadedFonts, setUploadedFonts] = useState<UploadedFont[]>([]);
  const [colorDraft, setColorDraft] = useState<Record<ColorKey, string>>({ textColor: style.textColor, outlineColor: style.outlineColor, backgroundColor: style.backgroundColor ?? '#10141b' });
  const outlineWidth = style.outlineWidth ?? 2;
  const backgroundColor = style.backgroundColor ?? '#10141b';
  const backgroundOpacity = style.backgroundOpacity ?? 0.72;

  useEffect(() => {
    setColorDraft({ textColor: style.textColor, outlineColor: style.outlineColor, backgroundColor: style.backgroundColor ?? '#10141b' });
  }, [style.textColor, style.outlineColor, style.backgroundColor]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const scheduleColorChange = (patch: Partial<SubtitleStyle>) => {
    pendingColorPatchRef.current = { ...pendingColorPatchRef.current, ...patch };
    if (colorTimerRef.current !== undefined) return;
    colorTimerRef.current = window.setTimeout(() => {
      colorTimerRef.current = undefined;
      const nextPatch = pendingColorPatchRef.current;
      pendingColorPatchRef.current = {};
      onChangeRef.current(nextPatch);
    }, 32);
  };

  const changeColor = (key: ColorKey, value: string) => {
    setColorDraft((current) => ({ ...current, [key]: value }));
    scheduleColorChange({ [key]: value });
  };

  useEffect(() => () => {
    if (colorTimerRef.current !== undefined) window.clearTimeout(colorTimerRef.current);
    colorTimerRef.current = undefined;
    pendingColorPatchRef.current = {};
  }, []);

  const uploadFont = async (file?: File) => {
    if (!file) return;
    const family = `AutoSub ${safeFontName(file.name)}`;
    const url = URL.createObjectURL(file);
    try {
      const face = new FontFace(family, `url(${url})`);
      await face.load();
      document.fonts.add(face);
      setUploadedFonts((fonts) => fonts.some((font) => font.family === family)
        ? fonts
        : [...fonts, { family, name: file.name, url }]);
      onChange({ fontFamily: family });
      onFontUpload?.(file);
    } catch {
      URL.revokeObjectURL(url);
    }
  };

  const fontOptions = [
    ...subtitleFonts.map((font) => ({ value: font, label: font })),
    ...uploadedFonts.map((font) => ({
      value: font.family,
      label: font.name,
      description: 'Font đã tải',
    })),
    ...style.fontFamily
      && !subtitleFonts.includes(style.fontFamily as typeof subtitleFonts[number])
      && !uploadedFonts.some((font) => font.family === style.fontFamily)
      ? [{ value: style.fontFamily, label: style.fontFamily }]
      : [],
  ];

  return <div className="style-panel">
    <div className="style-panel-intro"><span>LIVE TYPE CONTROL</span><p>Thay đổi sẽ cập nhật ngay trên frame video.</p></div>
    <label className="toggle-row"><span>Hiện phụ đề trên video</span><input type="checkbox" checked={style.visible} onChange={(event) => onChange({ visible: event.target.checked })} /><i /></label>
    <div className="field"><span>Nội dung</span><SelectField ariaLabel="Nội dung phụ đề" value={style.content} onChange={(value) => onChange({ content: value as SubtitleStyle['content'] })} options={[{ value: 'original', label: 'Bản gốc' }, { value: 'translated', label: 'Bản dịch' }, { value: 'both', label: 'Cả hai', description: 'Bản gốc và bản dịch' }]} /></div>
    <div className="field"><span>Font chữ</span><div className="font-picker-row"><SelectField ariaLabel="Font chữ phụ đề" value={style.fontFamily} onChange={(value) => onChange({ fontFamily: value })} options={fontOptions} /><label className="font-upload-button" title="Tải font TTF, OTF, WOFF hoặc WOFF2"><Upload size={14} /><input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(event) => { void uploadFont(event.target.files?.[0]); event.currentTarget.value = ''; }} />Tải font</label></div></div>
    <div className="field"><span>Cỡ chữ <b className="value-badge">{style.fontSize}px</b></span><RangeInput min={18} max={96} value={style.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })} /></div>
    <div className="field"><span>Kích thước viền <b className="value-badge">{outlineWidth}px</b></span><RangeInput min={0} max={8} step={1} value={outlineWidth} onChange={(event) => onChange({ outlineWidth: Number(event.target.value) })} /></div>
    <div className="two-fields"><label className="field"><span>Màu chữ</span><input type="color" value={colorDraft.textColor} onInput={(event) => changeColor('textColor', event.currentTarget.value)} onChange={(event) => changeColor('textColor', event.currentTarget.value)} /></label><label className="field"><span>Màu viền</span><input type="color" value={colorDraft.outlineColor} onInput={(event) => changeColor('outlineColor', event.currentTarget.value)} onChange={(event) => changeColor('outlineColor', event.currentTarget.value)} /></label></div>
    <div className="field"><span>Kiểu nền</span><div className="segmented"><button type="button" className={style.background === 'outline' ? 'active' : ''} onClick={() => onChange({ background: 'outline' })}>Viền chữ</button><button type="button" className={style.background === 'box' ? 'active' : ''} onClick={() => onChange({ background: 'box' })}>Hộp đục</button><button type="button" className={style.background === 'none' ? 'active' : ''} onClick={() => onChange({ background: 'none' })}>Không nền</button></div></div>
    {style.background === 'box' && <div className="two-fields"><label className="field"><span>Màu hộp đục</span><input type="color" value={colorDraft.backgroundColor} onInput={(event) => changeColor('backgroundColor', event.currentTarget.value)} onChange={(event) => changeColor('backgroundColor', event.currentTarget.value)} /></label><div className="field"><span>Độ đục <b className="value-badge">{Math.round(backgroundOpacity * 100)}%</b></span><RangeInput min={0.1} max={1} step={0.05} value={backgroundOpacity} onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })} /></div></div>}
    <div className="two-fields"><label className="toggle-row compact"><span><b>B</b> Đậm</span><input type="checkbox" checked={style.bold} onChange={(event) => onChange({ bold: event.target.checked })} /><i /></label><label className="toggle-row compact"><span><b><i>I</i></b> Nghiêng</span><input type="checkbox" checked={style.italic} onChange={(event) => onChange({ italic: event.target.checked })} /><i /></label></div>
    <div className="field"><span>Vị trí</span><div className="segmented position-segmented"><button type="button" className={style.position === 'top' ? 'active' : ''} onClick={() => onChange({ position: 'top' })}>Trên</button><button type="button" className={style.position === 'middle' ? 'active' : ''} onClick={() => onChange({ position: 'middle' })}>Giữa</button><button type="button" className={style.position === 'bottom' ? 'active' : ''} onClick={() => onChange({ position: 'bottom' })}>Dưới</button><button type="button" className={style.position === 'custom' ? 'active' : ''} onClick={() => onChange({ position: 'custom', customX: style.customX ?? 50, customY: style.customY ?? 82 })}>Tùy chỉnh</button></div>{style.position === 'custom' && <small className="custom-position-hint">Kéo phụ đề trực tiếp trên video để đặt vị trí.</small>}</div>
  </div>;
}
