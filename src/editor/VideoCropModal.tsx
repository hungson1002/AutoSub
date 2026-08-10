import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Modal } from '../components/Modal';
import { Crop, RotateCcw } from '../components/Icons';
import type { VideoAspectRatio, VideoAsset, VideoCropRegion, VideoEditState } from '../types';
import { aspectRatioValue, centeredCropForAspect, isFullCrop, normalizeCropRegion } from '../lib/videoCrop';

type CropDragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type CropDrag = { kind: CropDragKind; startX: number; startY: number; origin: VideoCropRegion };
type Size = { width: number; height: number };

const MIN_CROP_PERCENT = 8;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rounded = (value: number) => Math.round(value * 1000) / 1000;

function resizeCrop(origin: VideoCropRegion, kind: Exclude<CropDragKind, 'move'>, pointerX: number, pointerY: number, percentRatio: number) {
  const left = origin.xPercent;
  const top = origin.yPercent;
  const right = left + origin.widthPercent;
  const bottom = top + origin.heightPercent;
  const anchorX = kind === 'nw' || kind === 'sw' ? right : left;
  const anchorY = kind === 'nw' || kind === 'ne' ? bottom : top;
  const directionX = kind === 'nw' || kind === 'sw' ? -1 : 1;
  const directionY = kind === 'nw' || kind === 'ne' ? -1 : 1;
  const rawWidth = Math.abs(pointerX - anchorX);
  const rawHeight = Math.abs(pointerY - anchorY);
  const maxWidth = directionX > 0 ? 100 - anchorX : anchorX;
  const maxHeight = directionY > 0 ? 100 - anchorY : anchorY;
  const upperWidth = Math.max(MIN_CROP_PERCENT, Math.min(maxWidth, maxHeight * percentRatio));
  const widthPercent = clamp(Math.max(rawWidth, rawHeight * percentRatio), MIN_CROP_PERCENT, upperWidth);
  const heightPercent = widthPercent / percentRatio;
  return normalizeCropRegion({
    xPercent: directionX > 0 ? anchorX : anchorX - widthPercent,
    yPercent: directionY > 0 ? anchorY : anchorY - heightPercent,
    widthPercent,
    heightPercent,
  });
}

export function VideoCropModal({ open, asset, currentTimeMs = 0, value, onClose, onApply }: {
  open: boolean;
  asset?: VideoAsset;
  currentTimeMs?: number;
  value: VideoEditState;
  onClose: () => void;
  onApply: (next: Pick<VideoEditState, 'aspectRatio' | 'crop'>) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceSize, setSourceSize] = useState<Size>({ width: 16, height: 9 });
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(value.aspectRatio);
  const [crop, setCrop] = useState<VideoCropRegion>(value.crop || { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 });
  const [drag, setDrag] = useState<CropDrag>();

  useEffect(() => {
    setSourceSize({ width: 16, height: 9 });
  }, [asset?.url]);

  useEffect(() => {
    if (!open) return;
    setAspectRatio(value.aspectRatio);
    setCrop(value.crop ? normalizeCropRegion(value.crop) : centeredCropForAspect(value.aspectRatio, sourceSize.width, sourceSize.height));
    setDrag(undefined);
  }, [open, value.aspectRatio, value.crop, sourceSize.width, sourceSize.height]);

  useEffect(() => {
    if (!open || !videoRef.current) return;
    const video = videoRef.current;
    const seek = () => { video.currentTime = Math.min(Math.max(0, currentTimeMs / 1000), Number.isFinite(video.duration) ? video.duration : currentTimeMs / 1000); };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [open, asset?.url, currentTimeMs]);

  const chooseAspect = (next: VideoAspectRatio) => {
    setAspectRatio(next);
    setCrop(centeredCropForAspect(next, sourceSize.width, sourceSize.height));
  };

  const beginDrag = (event: PointerEvent<HTMLElement>, kind: CropDragKind) => {
    event.preventDefault();
    event.stopPropagation();
    stageRef.current?.setPointerCapture?.(event.pointerId);
    setDrag({ kind, startX: event.clientX, startY: event.clientY, origin: crop });
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = ((event.clientX - drag.startX) / rect.width) * 100;
    const dy = ((event.clientY - drag.startY) / rect.height) * 100;
    if (drag.kind === 'move') {
      setCrop({
        ...drag.origin,
        xPercent: clamp(drag.origin.xPercent + dx, 0, 100 - drag.origin.widthPercent),
        yPercent: clamp(drag.origin.yPercent + dy, 0, 100 - drag.origin.heightPercent),
      });
      return;
    }
    const pointerX = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    const pointerY = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
    const sourceRatio = sourceSize.width / sourceSize.height;
    const targetRatio = aspectRatioValue(aspectRatio, sourceSize.width, sourceSize.height);
    setCrop(resizeCrop(drag.origin, drag.kind, pointerX, pointerY, targetRatio / sourceRatio));
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
    setDrag(undefined);
  };

  const apply = () => {
    const normalized = normalizeCropRegion(crop);
    onApply({
      aspectRatio,
      crop: isFullCrop(normalized) ? undefined : {
        xPercent: rounded(normalized.xPercent),
        yPercent: rounded(normalized.yPercent),
        widthPercent: rounded(normalized.widthPercent),
        heightPercent: rounded(normalized.heightPercent),
      },
    });
  };

  const cropStyle = { left: `${crop.xPercent}%`, top: `${crop.yPercent}%`, width: `${crop.widthPercent}%`, height: `${crop.heightPercent}%` };
  const cropDescription = `${crop.xPercent.toFixed(1)}% × ${crop.yPercent.toFixed(1)}% · ${crop.widthPercent.toFixed(1)}% × ${crop.heightPercent.toFixed(1)}%`;

  return <Modal open={open} title="Crop khung hình" eyebrow="FRAME / CROP" onClose={onClose} wide className="video-crop-modal">
    <div className="video-crop-layout">
      <div className="video-crop-preview-shell">
        <div ref={stageRef} className={`video-crop-stage ${drag ? 'is-dragging' : ''}`} style={{ aspectRatio: `${sourceSize.width} / ${sourceSize.height}` }} onPointerMove={move} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          {asset ? <video ref={videoRef} src={asset.url} muted playsInline preload="metadata" onLoadedMetadata={(event) => {
            const width = event.currentTarget.videoWidth || 16;
            const height = event.currentTarget.videoHeight || 9;
            setSourceSize({ width, height });
            if (!value.crop) setCrop(centeredCropForAspect(aspectRatio, width, height));
          }} /> : <div className="video-crop-empty">Chưa có video để crop</div>}
          <div className="video-crop-shade top" style={{ height: `${crop.yPercent}%` }} />
          <div className="video-crop-shade bottom" style={{ top: `${crop.yPercent + crop.heightPercent}%` }} />
          <div className="video-crop-shade left" style={{ top: `${crop.yPercent}%`, width: `${crop.xPercent}%`, height: `${crop.heightPercent}%` }} />
          <div className="video-crop-shade right" style={{ top: `${crop.yPercent}%`, left: `${crop.xPercent + crop.widthPercent}%`, height: `${crop.heightPercent}%` }} />
          <div className="video-crop-frame" style={cropStyle} onPointerDown={(event) => beginDrag(event, 'move')}>
            <div className="video-crop-grid" />
            {(['nw', 'ne', 'sw', 'se'] as const).map((kind) => <button key={kind} className={`video-crop-handle ${kind}`} onPointerDown={(event) => beginDrag(event, kind)} aria-label={`Kéo góc ${kind}`} />)}
          </div>
        </div>
        <div className="video-crop-readout"><span>VÙNG GIỮ LẠI</span><strong>{cropDescription}</strong></div>
      </div>

      <aside className="video-crop-controls">
        <div><span className="video-crop-label">TỶ LỆ ĐẦU RA</span><div className="video-crop-ratios">{(['original', '16:9', '9:16', '1:1', '4:5'] as VideoAspectRatio[]).map((ratio) => <button key={ratio} className={aspectRatio === ratio ? 'active' : ''} onClick={() => chooseAspect(ratio)}>{ratio === 'original' ? 'Gốc' : ratio}</button>)}</div></div>
        <div className="video-crop-help"><Crop size={16} /><div><strong>Kéo khung để chọn phần cần giữ</strong><span>Kéo bốn góc để thay đổi kích thước. Tỷ lệ đang chọn luôn được giữ chính xác khi xuất.</span></div></div>
        <button className="video-crop-reset" onClick={() => setCrop(centeredCropForAspect(aspectRatio, sourceSize.width, sourceSize.height))}><RotateCcw size={14} /> Căn lại vùng crop</button>
      </aside>
    </div>
    <div className="modal-actions video-crop-actions"><button className="button ghost" onClick={onClose}>Hủy</button><button className="button primary" onClick={apply} disabled={!asset}><Crop size={15} /> Áp dụng crop</button></div>
  </Modal>;
}
