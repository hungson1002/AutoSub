import { useEffect, useRef, useState } from 'react';
import type { SubtitleStyle } from '../types';
import { Upload } from '../components/Icons';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { subtitleFonts } from './subtitleFonts';
import { subtitlePresets } from './subtitlePresets';

type UploadedFont = { family: string; name: string; url: string };
type ColorKey = 'textColor' | 'outlineColor' | 'backgroundColor' | 'boxBorderColor';

const safeFontName = (name: string) => name
  .replace(/\.[^.]+$/, '')
  .replace(/[^a-zA-Z0-9]+/g, ' ')
  .trim() || 'Uploaded Font';

type SubtitleStylePanelProps = {
  style: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
  onFontUpload?: (file: File, family: string) => void;
  mode?: "subtitle" | "text";
};

export function SubtitleStylePanel({ style, onChange, onFontUpload, mode = "subtitle" }: SubtitleStylePanelProps) {
  const textMode = mode === "text";
  const fileRef = useRef<HTMLInputElement>(null);
  const colorTimerRef = useRef<number | undefined>(undefined);
  const pendingColorPatchRef = useRef<Partial<SubtitleStyle>>({});
  const onChangeRef = useRef(onChange);
  const [uploadedFonts, setUploadedFonts] = useState<UploadedFont[]>([]);
  const [colorDraft, setColorDraft] = useState<Record<ColorKey, string>>({ textColor: style.textColor, outlineColor: style.outlineColor, backgroundColor: style.backgroundColor ?? '#10141b', boxBorderColor: style.boxBorderColor ?? '#ffffff' });
  const outlineWidth = style.outlineWidth ?? 2;
  const backgroundColor = style.backgroundColor ?? '#10141b';
  const backgroundOpacity = style.backgroundOpacity ?? 0.72;
  const boxPaddingX = style.boxPaddingX ?? 10;
  const boxPaddingY = style.boxPaddingY ?? 4;
  const boxBorderWidth = style.boxBorderWidth ?? 0;

  useEffect(() => {
    setColorDraft({ textColor: style.textColor, outlineColor: style.outlineColor, backgroundColor: style.backgroundColor ?? '#10141b', boxBorderColor: style.boxBorderColor ?? '#ffffff' });
  }, [style.textColor, style.outlineColor, style.backgroundColor, style.boxBorderColor]);
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
      onFontUpload?.(file, family);
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
    <div className="subtitle-presets" aria-label="Preset subtitle style">
      <div className="subtitle-presets-heading"><span>{textMode ? "PRESET KIỂU VĂN BẢN" : "PRESET KIỂU PHỤ ĐỀ"}</span><small>{textMode ? "Chỉ áp dụng cho văn bản đang chọn" : "Áp dụng đồng nhất cho toàn bộ phụ đề"}</small></div>
      <div className="subtitle-preset-grid">
        {subtitlePresets.map((preset) => <button type="button" key={preset.id} className="subtitle-preset" onClick={() => onChange(preset.style)} title={preset.description}>
          <strong>{preset.name}</strong><small>{preset.description}</small>
        </button>)}
      </div>
    </div>
    <div className="style-panel-intro"><span>LIVE TYPE CONTROL</span><p>Thay đổi sẽ cập nhật ngay trên frame video.</p></div>
    <label className="toggle-row"><span>{textMode ? "Hiện văn bản trên video" : "Hiện phụ đề trên video"}</span><input type="checkbox" checked={style.visible} onChange={(event) => onChange({ visible: event.target.checked })} /><i /></label>
    {!textMode && <div className="field"><span>Nội dung</span><SelectField ariaLabel="Nội dung phụ đề" value={style.content} onChange={(value) => onChange({ content: value as SubtitleStyle['content'] })} options={[{ value: 'original', label: 'Bản gốc' }, { value: 'translated', label: 'Bản dịch' }, { value: 'both', label: 'Cả hai', description: 'Bản gốc và bản dịch' }]} /></div>}
    <div className="field"><span>Font chữ</span><div className="font-picker-row"><SelectField ariaLabel="Font chữ phụ đề" value={style.fontFamily} onChange={(value) => onChange({ fontFamily: value })} options={fontOptions} /><label className="font-upload-button" title="Tải font TTF, OTF, WOFF hoặc WOFF2"><Upload size={14} /><input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(event) => { void uploadFont(event.target.files?.[0]); event.currentTarget.value = ''; }} />Tải font</label></div></div>
    <div className="field"><span>Cỡ chữ <b className="value-badge">{style.fontSize}px</b></span><RangeInput min={18} max={96} value={style.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })} /></div>
    <div className="field"><span>Kích thước viền <b className="value-badge">{outlineWidth}px</b></span><RangeInput min={0} max={8} step={1} value={outlineWidth} onChange={(event) => onChange({ outlineWidth: Number(event.target.value) })} /></div>
    <div className="two-fields"><label className="field"><span>Màu chữ</span><input type="color" value={colorDraft.textColor} onInput={(event) => changeColor('textColor', event.currentTarget.value)} onChange={(event) => changeColor('textColor', event.currentTarget.value)} /></label><label className="field"><span>Màu viền</span><input type="color" value={colorDraft.outlineColor} onInput={(event) => changeColor('outlineColor', event.currentTarget.value)} onChange={(event) => changeColor('outlineColor', event.currentTarget.value)} /></label></div>
    <div className="field"><span>Kiểu nền</span><div className="segmented"><button type="button" className={style.background === 'outline' ? 'active' : ''} onClick={() => onChange({ background: 'outline' })}>Viền chữ</button><button type="button" className={style.background === 'box' ? 'active' : ''} onClick={() => onChange({ background: 'box' })}>Hộp đục</button><button type="button" className={style.background === 'none' ? 'active' : ''} onClick={() => onChange({ background: 'none' })}>Không nền</button></div></div>
    {style.background === 'box' && <div className="subtitle-box-controls">
      <div className="subtitle-box-heading"><span>KHUNG CHỮ</span><small>Màu, độ đục và khoảng thở quanh chữ</small></div>
      <div className="subtitle-box-presets" aria-label="Mẫu kích thước khung chữ">
        <button type="button" className={boxPaddingX === 6 && boxPaddingY === 2 ? 'active' : ''} onClick={() => onChange({ boxPaddingX: 6, boxPaddingY: 2 })}>Sát chữ</button>
        <button type="button" className={boxPaddingX === 12 && boxPaddingY === 5 ? 'active' : ''} onClick={() => onChange({ boxPaddingX: 12, boxPaddingY: 5 })}>Cân bằng</button>
        <button type="button" className={boxPaddingX === 24 && boxPaddingY === 9 ? 'active' : ''} onClick={() => onChange({ boxPaddingX: 24, boxPaddingY: 9 })}>Rộng</button>
      </div>
      <div className="two-fields"><label className="field"><span>Màu hộp đục</span><input type="color" value={colorDraft.backgroundColor} onInput={(event) => changeColor('backgroundColor', event.currentTarget.value)} onChange={(event) => changeColor('backgroundColor', event.currentTarget.value)} /></label><div className="field"><span>Độ đục</span><div className="range-number-control"><RangeInput min={0} max={1} step={0.01} value={backgroundOpacity} onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })} /><input aria-label="Độ đục hộp chữ" type="number" min={0} max={100} value={Math.round(backgroundOpacity * 100)} onChange={(event) => onChange({ backgroundOpacity: Math.max(0, Math.min(100, Number(event.target.value) || 0)) / 100 })} /><b>%</b></div></div></div>
      <div className="two-fields">
        <div className="field"><span>Đệm ngang</span><div className="range-number-control"><RangeInput min={0} max={120} step={1} value={boxPaddingX} onChange={(event) => onChange({ boxPaddingX: Number(event.target.value) })} /><input aria-label="Đệm ngang hộp chữ" type="number" min={0} max={120} value={boxPaddingX} onChange={(event) => onChange({ boxPaddingX: Math.max(0, Math.min(120, Number(event.target.value) || 0)) })} /><b>px</b></div></div>
        <div className="field"><span>Đệm dọc</span><div className="range-number-control"><RangeInput min={0} max={80} step={1} value={boxPaddingY} onChange={(event) => onChange({ boxPaddingY: Number(event.target.value) })} /><input aria-label="Đệm dọc hộp chữ" type="number" min={0} max={80} value={boxPaddingY} onChange={(event) => onChange({ boxPaddingY: Math.max(0, Math.min(80, Number(event.target.value) || 0)) })} /><b>px</b></div></div>
      </div>
      <div className="two-fields subtitle-box-border-row">
        <label className="field"><span>Màu border</span><input type="color" value={colorDraft.boxBorderColor} onInput={(event) => changeColor('boxBorderColor', event.currentTarget.value)} onChange={(event) => changeColor('boxBorderColor', event.currentTarget.value)} /></label>
        <div className="field"><span>Độ dày border</span><div className="range-number-control"><RangeInput min={0} max={12} step={1} value={boxBorderWidth} onChange={(event) => onChange({ boxBorderWidth: Number(event.target.value) })} /><input aria-label="Độ dày border hộp chữ" type="number" min={0} max={12} value={boxBorderWidth} onChange={(event) => onChange({ boxBorderWidth: Math.max(0, Math.min(12, Number(event.target.value) || 0)) })} /><b>px</b></div></div>
      </div>
    </div>}
    <div className="two-fields"><label className="toggle-row compact"><span><b>B</b> Đậm</span><input type="checkbox" checked={style.bold} onChange={(event) => onChange({ bold: event.target.checked })} /><i /></label><label className="toggle-row compact"><span><b><i>I</i></b> Nghiêng</span><input type="checkbox" checked={style.italic} onChange={(event) => onChange({ italic: event.target.checked })} /><i /></label></div>
    {!textMode && <div className="field"><span>Vị trí</span><div className="segmented position-segmented"><button type="button" className={style.position === 'top' ? 'active' : ''} onClick={() => onChange({ position: 'top' })}>Trên</button><button type="button" className={style.position === 'middle' ? 'active' : ''} onClick={() => onChange({ position: 'middle' })}>Giữa</button><button type="button" className={style.position === 'bottom' ? 'active' : ''} onClick={() => onChange({ position: 'bottom' })}>Dưới</button><button type="button" className={style.position === 'custom' ? 'active' : ''} onClick={() => onChange({ position: 'custom', customX: style.customX ?? 50, customY: style.customY ?? 82 })}>Tùy chỉnh</button></div>{style.position === 'custom' && <small className="custom-position-hint">Kéo phụ đề trực tiếp trên video để đặt vị trí.</small>}</div>}
  </div>;
}
