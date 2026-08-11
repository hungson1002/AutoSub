import { useEffect, useRef, useState } from 'react';
import type { BlurRegion, VideoAsset } from '../types';
import { Modal } from '../components/Modal';
import { Plus, Trash2 } from '../components/Icons';
import { RangeInput } from '../components/RangeInput';

type DragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type Drag = { kind: DragKind; startX: number; startY: number; origin: BlurRegion };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function patchRect(origin: BlurRegion, kind: DragKind, dx: number, dy: number): BlurRegion {
  if (kind === 'move') {
    return {
      ...origin,
      xPercent: clamp(origin.xPercent + dx, 0, 100 - origin.widthPercent),
      yPercent: clamp(origin.yPercent + dy, 0, 100 - origin.heightPercent),
    };
  }
  if (kind === 'nw') {
    const x = clamp(origin.xPercent + dx, 0, origin.xPercent + origin.widthPercent - 5);
    const y = clamp(origin.yPercent + dy, 0, origin.yPercent + origin.heightPercent - 5);
    return {
      ...origin,
      xPercent: x,
      yPercent: y,
      widthPercent: origin.xPercent + origin.widthPercent - x,
      heightPercent: origin.yPercent + origin.heightPercent - y,
    };
  }
  if (kind === 'ne') {
    const y = clamp(origin.yPercent + dy, 0, origin.yPercent + origin.heightPercent - 5);
    return {
      ...origin,
      yPercent: y,
      widthPercent: clamp(origin.widthPercent + dx, 5, 100 - origin.xPercent),
      heightPercent: origin.yPercent + origin.heightPercent - y,
    };
  }
  if (kind === 'sw') {
    const x = clamp(origin.xPercent + dx, 0, origin.xPercent + origin.widthPercent - 5);
    return {
      ...origin,
      xPercent: x,
      widthPercent: origin.xPercent + origin.widthPercent - x,
      heightPercent: clamp(origin.heightPercent + dy, 5, 100 - origin.yPercent),
    };
  }
  return {
    ...origin,
    widthPercent: clamp(origin.widthPercent + dx, 5, 100 - origin.xPercent),
    heightPercent: clamp(origin.heightPercent + dy, 5, 100 - origin.yPercent),
  };
}

function blurPreviewStyle(region: BlurRegion) {
  const strength = Math.min(36, Math.max(8, Number(region.blurStrength) || 24));
  return {
    left: `${region.xPercent}%`,
    top: `${region.yPercent}%`,
    width: `${region.widthPercent}%`,
    height: `${region.heightPercent}%`,
    borderRadius: `${Math.max(0, Math.min(40, region.borderRadius ?? 0))}px`,
    backdropFilter: `blur(${strength}px)`,
    WebkitBackdropFilter: `blur(${strength}px)`,
  };
}

type BlurEditorProps = {
  open: boolean;
  regions: BlurRegion[];
  asset?: VideoAsset;
  currentTimeMs?: number;
  onClose: () => void;
  onChange: (regions: BlurRegion[]) => void;
};

export function BlurEditor({
  open,
  regions,
  asset,
  currentTimeMs = 0,
  onClose,
  onChange,
}: BlurEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selected, setSelected] = useState('');
  const [drag, setDrag] = useState<Drag>();

  useEffect(() => {
    if (selected && !regions.some((region) => region.id === selected)) setSelected('');
  }, [regions, selected]);

  useEffect(() => {
    if (open && videoRef.current && currentTimeMs > 0) {
      videoRef.current.currentTime = currentTimeMs / 1000;
    }
  }, [open, currentTimeMs]);

  const add = () => {
    const region: BlurRegion = {
      id: crypto.randomUUID(),
      // Source subtitles commonly occupy two lines at the very bottom of a
      // video.  The old 70–85% preset stopped at the first line, leaving the
      // line below it completely readable in the exported file.
      xPercent: 8,
      yPercent: 77,
      widthPercent: 84,
      heightPercent: 18,
      startMs: 0,
      endMs: 999999,
      wholeVideo: true,
      mode: 'blur',
      blurStrength: 24,
      borderRadius: 0,
      expandTop: 0,
      expandBottom: 0,
    };
    onChange([...regions, region]);
    setSelected(region.id);
  };

  const current = regions.find((region) => region.id === selected);
  const patch = (value: Partial<BlurRegion>) => {
    onChange(regions.map((region) => region.id === selected ? { ...region, ...value } : region));
  };
  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    region: BlurRegion,
    kind: DragKind,
  ) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSelected(region.id);
    setDrag({ kind, startX: event.clientX, startY: event.clientY, origin: region });
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - drag.startX) / rect.width) * 100;
    const dy = ((event.clientY - drag.startY) / rect.height) * 100;
    const next = patchRect(drag.origin, drag.kind, dx, dy);
    onChange(regions.map((region) => region.id === drag.origin.id ? next : region));
  };
  const previewRegion = (region: BlurRegion, index: number) => (
    <div
      key={region.id}
      className={`blur-preview-region ${selected === region.id ? 'selected' : 'selectable'}`}
      style={blurPreviewStyle(region)}
      onPointerDown={(event) => beginDrag(event, region, 'move')}
    >
      {selected === region.id && <span>{`BLUR ${index + 1}`}</span>}
      {selected === region.id && <>
        <i className="roi-handle nw" onPointerDown={(event) => beginDrag(event, region, 'nw')} />
        <i className="roi-handle ne" onPointerDown={(event) => beginDrag(event, region, 'ne')} />
        <i className="roi-handle sw" onPointerDown={(event) => beginDrag(event, region, 'sw')} />
        <i className="roi-handle se" onPointerDown={(event) => beginDrag(event, region, 'se')} />
      </>}
    </div>
  );

  return <Modal
    open={open}
    title="Làm mờ subtitle cũ"
    eyebrow="BLUR REGION"
    onClose={onClose}
    wide
    className="blur-modal"
  >
    <div className="blur-toolbar">
      <div>
        <strong>Chọn trực tiếp trên video</strong>
        <small>Kéo vùng để di chuyển, kéo góc để thay đổi kích thước.</small>
      </div>
      <button className="button small ghost" onClick={add}><Plus size={14} /> Thêm vùng</button>
    </div>
    <div className="blur-layout">
      <div className="blur-preview">
        <div
          className="blur-video-frame"
          onPointerMove={move}
          onPointerUp={() => setDrag(undefined)}
          onPointerCancel={() => setDrag(undefined)}
        >
          {asset
            ? <video ref={videoRef} src={asset.url} muted playsInline controls />
            : <div className="fake-frame"><div className="fake-subtitle">Chọn video để xem preview thật</div></div>}
          {regions.map(previewRegion)}
        </div>
        <small className="blur-help">Preview hiển thị trực tiếp độ mờ và bo góc trên video đang mở.</small>
      </div>
      <div className="blur-options">
        <div className="section-title"><span>VÙNG ĐANG CHỌN</span><b>{regions.length}</b></div>
        {regions.length === 0
          ? <div className="empty-box">
            Chưa có vùng blur.
            <button className="button secondary" onClick={add}>Tạo vùng đầu tiên</button>
          </div>
          : <div className="region-list">{regions.map((region, index) => (
            <button
              key={region.id}
              className={`region-row ${selected === region.id ? 'active' : ''}`}
              onClick={() => setSelected(region.id)}
            >
              <span><i /> Vùng {index + 1}</span>
              <small>{region.mode === 'blur' ? 'Xóa chữ' : 'Mờ nền mạnh'}</small>
              <Trash2
                size={14}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(regions.filter((item) => item.id !== region.id));
                }}
              />
            </button>
          ))}</div>}
        {current && <div className="blur-control-stack">
          <div className="field">
            <span>Chế độ</span>
            <div className="segmented">
              <button type="button" className={current.mode === 'blur' ? 'active' : ''} onClick={() => patch({ mode: 'blur' })}>Xóa chữ</button>
              <button type="button" className={current.mode === 'neighbor' ? 'active' : ''} onClick={() => patch({ mode: 'neighbor' })}>Mờ nền mạnh</button>
            </div>
          </div>
          <div className="two-fields">
            <label className="field">
              <span>Start (ms)</span>
              <input type="number" value={current.startMs} onChange={(event) => patch({ startMs: Math.max(0, Number(event.target.value)) })} />
            </label>
            <label className="field">
              <span>End (ms)</span>
              <input type="number" value={current.endMs} onChange={(event) => patch({ endMs: Math.max(current.startMs + 1, Number(event.target.value)) })} />
            </label>
          </div>
          <div className="field">
            <span>Độ nhòe <b className="value-badge">{current.blurStrength}</b></span>
            <RangeInput min={2} max={60} value={current.blurStrength} onChange={(event) => patch({ blurStrength: Number(event.target.value) })} />
          </div>
          <div className="field">
            <span>Bo góc <b className="value-badge">{current.borderRadius ?? 0}px</b></span>
            <RangeInput min={0} max={40} value={current.borderRadius ?? 0} onChange={(event) => patch({ borderRadius: Number(event.target.value) })} />
          </div>
          <label className="toggle-row">
            <span>Áp dụng toàn video</span>
            <input
              type="checkbox"
              checked={current.wholeVideo}
              onChange={(event) => patch({
                wholeVideo: event.target.checked,
                startMs: event.target.checked ? 0 : current.startMs,
                endMs: event.target.checked ? 999999 : current.endMs,
              })}
            />
            <i />
          </label>
        </div>}
      </div>
    </div>
    <div className="modal-actions">
      <button className="button ghost" onClick={onClose}>Đóng</button>
      <button className="button primary" onClick={onClose}>Lưu vùng blur</button>
    </div>
  </Modal>;
}
