import { useEffect, useRef, useState } from 'react';
import type { SubtitleStyle } from '../types';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { subtitlePresets } from './subtitlePresets';
import type { UploadedSubtitleFont } from '../lib/fontLibrary';
import { FontLibraryPicker } from './FontLibraryPicker';

type ColorKey = 'textColor' | 'outlineColor' | 'backgroundColor' | 'boxBorderColor';
type SubtitleStylePanelProps = {
  style: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
  uploadedFonts?: UploadedSubtitleFont[];
  onFontUpload?: (file: File, family: string) => Promise<void> | void;
  mode?: 'subtitle' | 'text';
};

const colorLooks = [
  { name: 'Trắng đen', textColor: '#ffffff', outlineColor: '#10141b' },
  { name: 'Vàng nổi', textColor: '#ffd51f', outlineColor: '#16110a' },
  { name: 'Xanh sáng', textColor: '#8ee7ff', outlineColor: '#10202b' },
  { name: 'Đỏ trắng', textColor: '#ffffff', outlineColor: '#c92f2f' },
  { name: 'Hồng đậm', textColor: '#ff8fb8', outlineColor: '#32101f' },
] as const;

export function SubtitleStylePanel({ style, onChange, uploadedFonts = [], onFontUpload, mode = 'subtitle' }: SubtitleStylePanelProps) {
  const textMode = mode === 'text';
  const colorTimerRef = useRef<number | undefined>(undefined);
  const pendingColorPatchRef = useRef<Partial<SubtitleStyle>>({});
  const onChangeRef = useRef(onChange);
  const [colorDraft, setColorDraft] = useState<Record<ColorKey, string>>({
    textColor: style.textColor,
    outlineColor: style.outlineColor,
    backgroundColor: style.backgroundColor ?? '#10141b',
    boxBorderColor: style.boxBorderColor ?? '#ffffff',
  });
  const outlineWidth = style.outlineWidth ?? 2;
  const backgroundOpacity = style.backgroundOpacity ?? 0.72;
  const boxPaddingX = style.boxPaddingX ?? 10;
  const boxPaddingY = style.boxPaddingY ?? 4;
  const boxBorderWidth = style.boxBorderWidth ?? 0;
  const boxBorderRadius = style.boxBorderRadius ?? 0;
  const letterSpacing = style.letterSpacing ?? 0;
  const activePreset = subtitlePresets.find((preset) =>
    Object.entries(preset.style).every(([key, value]) => style[key as keyof SubtitleStyle] === value),
  )?.id;

  useEffect(() => {
    setColorDraft({
      textColor: style.textColor,
      outlineColor: style.outlineColor,
      backgroundColor: style.backgroundColor ?? '#10141b',
      boxBorderColor: style.boxBorderColor ?? '#ffffff',
    });
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

  return <div className="style-panel font-style-editor">
    <section className="type-preset-section" aria-labelledby="type-preset-title">
      <div className="style-section-heading">
        <div><span id="type-preset-title">Kiểu chữ mẫu</span><small>{textMode ? 'Áp dụng cho chữ đang chọn' : 'Áp dụng cho toàn bộ phụ đề'}</small></div>
        <label className="visibility-switch"><span>Hiển thị</span><input type="checkbox" checked={style.visible} onChange={(event) => onChange({ visible: event.target.checked })} /><i /></label>
      </div>
      <div className="subtitle-preset-grid">
        {subtitlePresets.map((preset) => <button type="button" key={preset.id} className={`subtitle-preset visual ${activePreset === preset.id ? 'active' : ''}`} aria-pressed={activePreset === preset.id} onClick={() => onChange(preset.style)} title={preset.description}>
          <span className="preset-type-sample" style={{ color: preset.style.textColor, fontFamily: preset.style.fontFamily, fontWeight: preset.style.bold ? 700 : 400, fontStyle: preset.style.italic ? 'italic' : 'normal', WebkitTextStroke: preset.style.background === 'outline' ? `${Math.max(1, (preset.style.outlineWidth ?? 0) / 2)}px ${preset.style.outlineColor}` : '0 transparent', background: preset.style.background === 'box' ? preset.style.backgroundColor : 'transparent' }}>Aa</span>
          <strong>{preset.name}</strong>
        </button>)}
      </div>
    </section>

    <section className="style-section" aria-labelledby="type-basic-title">
      <div className="style-section-heading compact"><div><span id="type-basic-title">Chữ</span><small>Font, kích thước và định dạng</small></div></div>
      {!textMode && <div className="field compact-field"><span>Nội dung hiển thị</span><SelectField ariaLabel="Nội dung phụ đề" value={style.content} onChange={(value) => onChange({ content: value as SubtitleStyle['content'] })} options={[{ value: 'original', label: 'Bản gốc' }, { value: 'translated', label: 'Bản dịch' }, { value: 'both', label: 'Cả hai', description: 'Bản gốc và bản dịch' }]} /></div>}
      <FontLibraryPicker value={style.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} uploadedFonts={uploadedFonts} onFontUpload={onFontUpload} />
      <div className="type-toolbar" role="group" aria-label="Định dạng chữ">
        <button type="button" className={style.bold ? 'active' : ''} aria-pressed={style.bold} onClick={() => onChange({ bold: !style.bold })}><b>B</b><span>Đậm</span></button>
        <button type="button" className={style.italic ? 'active' : ''} aria-pressed={style.italic} onClick={() => onChange({ italic: !style.italic })}><i>I</i><span>Nghiêng</span></button>
        <button type="button" className={style.underline ? 'active' : ''} aria-pressed={style.underline === true} onClick={() => onChange({ underline: !style.underline })}><u>U</u><span>Gạch chân</span></button>
      </div>
      <div className="style-control-grid">
        <div className="field"><span>Cỡ chữ</span><div className="range-number-control"><RangeInput min={12} max={128} value={style.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })} /><input aria-label="Cỡ chữ" type="number" min={12} max={128} value={style.fontSize} onChange={(event) => onChange({ fontSize: Math.max(12, Math.min(128, Number(event.target.value) || 12)) })} /><b>px</b></div></div>
        <div className="field"><span>Khoảng cách chữ</span><div className="range-number-control"><RangeInput min={-4} max={20} step={0.5} value={letterSpacing} onChange={(event) => onChange({ letterSpacing: Number(event.target.value) })} /><input aria-label="Khoảng cách chữ" type="number" min={-4} max={20} step={0.5} value={letterSpacing} onChange={(event) => onChange({ letterSpacing: Math.max(-4, Math.min(20, Number(event.target.value) || 0)) })} /><b>px</b></div></div>
      </div>
    </section>

    <section className="style-section" aria-labelledby="type-color-title">
      <div className="style-section-heading compact"><div><span id="type-color-title">Màu sắc</span><small>Chọn nhanh hoặc dùng màu tùy chỉnh</small></div></div>
      <div className="type-color-looks" aria-label="Bảng màu chữ nhanh">
        {colorLooks.map((look) => <button key={look.name} type="button" title={look.name} aria-label={look.name} className={style.textColor.toLowerCase() === look.textColor && style.outlineColor.toLowerCase() === look.outlineColor ? 'active' : ''} onClick={() => onChange({ textColor: look.textColor, outlineColor: look.outlineColor })} style={{ color: look.textColor, WebkitTextStroke: `1px ${look.outlineColor}` }}>Aa</button>)}
      </div>
      <div className="two-fields type-color-fields">
        <label className="field color-field"><span>Màu chữ</span><span className="color-input-shell"><input aria-label="Màu chữ" type="color" value={colorDraft.textColor} onInput={(event) => changeColor('textColor', event.currentTarget.value)} onChange={(event) => changeColor('textColor', event.currentTarget.value)} /><b>{colorDraft.textColor.toUpperCase()}</b></span></label>
        <label className="field color-field"><span>Màu viền</span><span className="color-input-shell"><input aria-label="Màu viền" type="color" value={colorDraft.outlineColor} onInput={(event) => changeColor('outlineColor', event.currentTarget.value)} onChange={(event) => changeColor('outlineColor', event.currentTarget.value)} /><b>{colorDraft.outlineColor.toUpperCase()}</b></span></label>
      </div>
    </section>

    <section className="style-section" aria-labelledby="type-edge-title">
      <div className="style-section-heading compact"><div><span id="type-edge-title">Viền và nền</span><small>Tăng độ rõ trên cảnh sáng hoặc phức tạp</small></div></div>
      <div className="field compact-field"><span>Kiểu hiển thị</span><div className="segmented"><button type="button" className={style.background === 'outline' ? 'active' : ''} onClick={() => onChange({ background: 'outline' })}>Viền chữ</button><button type="button" className={style.background === 'box' ? 'active' : ''} onClick={() => onChange({ background: 'box' })}>Khung nền</button><button type="button" className={style.background === 'none' ? 'active' : ''} onClick={() => onChange({ background: 'none' })}>Không nền</button></div></div>
      {style.background === 'outline' && <div className="field"><span>Độ dày viền</span><div className="range-number-control"><RangeInput min={0} max={12} step={0.5} value={outlineWidth} onChange={(event) => onChange({ outlineWidth: Number(event.target.value) })} /><input aria-label="Độ dày viền chữ" type="number" min={0} max={12} step={0.5} value={outlineWidth} onChange={(event) => onChange({ outlineWidth: Math.max(0, Math.min(12, Number(event.target.value) || 0)) })} /><b>px</b></div></div>}
      {style.background === 'box' && <div className="subtitle-box-controls">
        <div className="subtitle-box-presets" aria-label="Mẫu kích thước khung chữ"><button type="button" className={boxPaddingX === 6 && boxPaddingY === 2 ? 'active' : ''} onClick={() => onChange({ boxPaddingX: 6, boxPaddingY: 2 })}>Gọn</button><button type="button" className={boxPaddingX === 12 && boxPaddingY === 5 ? 'active' : ''} onClick={() => onChange({ boxPaddingX: 12, boxPaddingY: 5 })}>Vừa</button><button type="button" className={boxPaddingX === 24 && boxPaddingY === 9 ? 'active' : ''} onClick={() => onChange({ boxPaddingX: 24, boxPaddingY: 9 })}>Rộng</button></div>
        <div className="two-fields"><label className="field color-field"><span>Màu nền</span><span className="color-input-shell"><input aria-label="Màu nền" type="color" value={colorDraft.backgroundColor} onInput={(event) => changeColor('backgroundColor', event.currentTarget.value)} onChange={(event) => changeColor('backgroundColor', event.currentTarget.value)} /><b>{colorDraft.backgroundColor.toUpperCase()}</b></span></label><div className="field"><span>Độ đục</span><div className="range-number-control"><RangeInput min={0} max={1} step={0.01} value={backgroundOpacity} onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) })} /><input aria-label="Độ đục khung nền" type="number" min={0} max={100} value={Math.round(backgroundOpacity * 100)} onChange={(event) => onChange({ backgroundOpacity: Math.max(0, Math.min(100, Number(event.target.value) || 0)) / 100 })} /><b>%</b></div></div></div>
        <div className="two-fields"><div className="field"><span>Đệm ngang</span><div className="range-number-control"><RangeInput min={0} max={120} value={boxPaddingX} onChange={(event) => onChange({ boxPaddingX: Number(event.target.value) })} /><input aria-label="Đệm ngang khung chữ" type="number" min={0} max={120} value={boxPaddingX} onChange={(event) => onChange({ boxPaddingX: Math.max(0, Math.min(120, Number(event.target.value) || 0)) })} /><b>px</b></div></div><div className="field"><span>Đệm dọc</span><div className="range-number-control"><RangeInput min={0} max={80} value={boxPaddingY} onChange={(event) => onChange({ boxPaddingY: Number(event.target.value) })} /><input aria-label="Đệm dọc khung chữ" type="number" min={0} max={80} value={boxPaddingY} onChange={(event) => onChange({ boxPaddingY: Math.max(0, Math.min(80, Number(event.target.value) || 0)) })} /><b>px</b></div></div></div>
        <div className="two-fields subtitle-box-border-row"><label className="field color-field"><span>Màu đường khung</span><span className="color-input-shell"><input aria-label="Màu đường khung" type="color" value={colorDraft.boxBorderColor} onInput={(event) => changeColor('boxBorderColor', event.currentTarget.value)} onChange={(event) => changeColor('boxBorderColor', event.currentTarget.value)} /><b>{colorDraft.boxBorderColor.toUpperCase()}</b></span></label><div className="field"><span>Độ dày khung</span><div className="range-number-control"><RangeInput min={0} max={12} value={boxBorderWidth} onChange={(event) => onChange({ boxBorderWidth: Number(event.target.value) })} /><input aria-label="Độ dày đường khung" type="number" min={0} max={12} value={boxBorderWidth} onChange={(event) => onChange({ boxBorderWidth: Math.max(0, Math.min(12, Number(event.target.value) || 0)) })} /><b>px</b></div></div></div>
        <div className="field"><span>Bo góc khung</span><div className="range-number-control"><RangeInput min={0} max={80} value={boxBorderRadius} onChange={(event) => onChange({ boxBorderRadius: Number(event.target.value) })} /><input aria-label="Bo góc khung chữ" type="number" min={0} max={80} value={boxBorderRadius} onChange={(event) => onChange({ boxBorderRadius: Math.max(0, Math.min(80, Number(event.target.value) || 0)) })} /><b>px</b></div></div>
      </div>}
    </section>

    {!textMode && <section className="style-section" aria-labelledby="type-position-title"><div className="style-section-heading compact"><div><span id="type-position-title">Vị trí</span><small>Đặt nhanh hoặc kéo trực tiếp trên preview</small></div></div><div className="segmented position-segmented"><button type="button" className={style.position === 'top' ? 'active' : ''} onClick={() => onChange({ position: 'top' })}>Trên</button><button type="button" className={style.position === 'middle' ? 'active' : ''} onClick={() => onChange({ position: 'middle' })}>Giữa</button><button type="button" className={style.position === 'bottom' ? 'active' : ''} onClick={() => onChange({ position: 'bottom' })}>Dưới</button><button type="button" className={style.position === 'custom' ? 'active' : ''} onClick={() => onChange({ position: 'custom', customX: style.customX ?? 50, customY: style.customY ?? 82 })}>Tùy chỉnh</button></div>{style.position === 'custom' && <small className="custom-position-hint">Kéo phụ đề trực tiếp trên video để đặt vị trí.</small>}</section>}
  </div>;
}
