import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Pause, Play, Scissors } from '../components/Icons';
import { Modal } from '../components/Modal';
import { formatClock } from '../lib/subtitles';
import type { VideoAsset, VideoEditState } from '../types';

const MIN_TRIM_MS = 250;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type TrimRange = { startMs: number; endMs: number };

function normalizeRange(durationMs: number, startMs: number, endMs: number): TrimRange {
  const safeDuration = Math.max(MIN_TRIM_MS, Math.round(durationMs));
  const start = clamp(Math.round(startMs), 0, safeDuration - MIN_TRIM_MS);
  const end = clamp(Math.round(endMs), start + MIN_TRIM_MS, safeDuration);
  return { startMs: start, endMs: end };
}

type Props = {
  open: boolean;
  asset?: VideoAsset;
  durationMs: number;
  value: VideoEditState;
  onClose: () => void;
  onApply: (trim: Pick<VideoEditState, 'trimStartMs' | 'trimEndMs'>) => void;
};

export function VideoTrimModal({ open, asset, durationMs, value, onClose, onApply }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [knownDuration, setKnownDuration] = useState(durationMs || asset?.durationMs || 0);
  const [range, setRange] = useState<TrimRange>({ startMs: 0, endMs: Math.max(MIN_TRIM_MS, durationMs || asset?.durationMs || MIN_TRIM_MS) });
  const [dragging, setDragging] = useState<'start' | 'end'>();
  const [previewTime, setPreviewTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const safeDuration = Math.max(MIN_TRIM_MS, knownDuration || durationMs || asset?.durationMs || MIN_TRIM_MS);
  const startPercent = (range.startMs / safeDuration) * 100;
  const endPercent = (range.endMs / safeDuration) * 100;
  const selectedDuration = Math.max(0, range.endMs - range.startMs);
  const removedDuration = Math.max(0, safeDuration - selectedDuration);

  useEffect(() => {
    if (!open) return;
    const nextDuration = Math.max(MIN_TRIM_MS, durationMs || asset?.durationMs || knownDuration || MIN_TRIM_MS);
    setKnownDuration(nextDuration);
    const next = normalizeRange(nextDuration, value.trimStartMs, value.trimEndMs ?? nextDuration);
    setRange(next);
    setPreviewTime(next.startMs);
    setPlaying(false);
  }, [open, asset?.url, asset?.durationMs, durationMs, value.trimStartMs, value.trimEndMs]);

  useEffect(() => {
    if (!open) videoRef.current?.pause();
  }, [open]);

  const seekPreview = (timeMs: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = timeMs / 1000;
    setPreviewTime(timeMs);
  };

  const updateHandle = (kind: 'start' | 'end', rawMs: number) => {
    setRange((current) => {
      const next = kind === 'start'
        ? { startMs: clamp(Math.round(rawMs), 0, current.endMs - MIN_TRIM_MS), endMs: current.endMs }
        : { startMs: current.startMs, endMs: clamp(Math.round(rawMs), current.startMs + MIN_TRIM_MS, safeDuration) };
      const previewAt = kind === 'start' ? next.startMs : next.endMs;
      seekPreview(previewAt);
      return next;
    });
  };

  const timeFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp(((clientX - rect.left) / Math.max(rect.width, 1)) * safeDuration, 0, safeDuration);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      updateHandle(dragging, timeFromPointer(event.clientX));
    };
    const stop = () => setDragging(undefined);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', stop, { once: true });
    document.addEventListener('pointercancel', stop, { once: true });
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };
  }, [dragging, safeDuration, range.startMs, range.endMs]);

  const beginHandleDrag = (event: ReactPointerEvent<HTMLButtonElement>, kind: 'start' | 'end') => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(kind);
    seekPreview(kind === 'start' ? range.startMs : range.endMs);
  };

  const beginTrackDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const at = timeFromPointer(event.clientX);
    const kind = Math.abs(at - range.startMs) <= Math.abs(at - range.endMs) ? 'start' : 'end';
    updateHandle(kind, at);
    setDragging(kind);
  };

  const togglePreview = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      setPlaying(false);
      return;
    }
    if (video.currentTime * 1000 < range.startMs || video.currentTime * 1000 >= range.endMs - 30) {
      video.currentTime = range.startMs / 1000;
      setPreviewTime(range.startMs);
    }
    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const apply = () => {
    const fullStart = range.startMs <= 10;
    const fullEnd = range.endMs >= safeDuration - 10;
    onApply({ trimStartMs: fullStart ? 0 : range.startMs, trimEndMs: fullEnd ? undefined : range.endMs });
  };

  return <Modal open={open} title="Cắt video" eyebrow="TRIM / NON-DESTRUCTIVE" onClose={onClose} wide className="video-trim-modal">
    <p className="video-trim-intro">Kéo hai tay nắm để giữ lại phần video cần dùng. Đưa tay nắm về hai đầu để dùng lại toàn bộ video.</p>
    <div className="video-trim-preview">
      {asset ? <video
        ref={videoRef}
        src={asset.url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const nextDuration = Math.max(MIN_TRIM_MS, event.currentTarget.duration * 1000);
          setKnownDuration(nextDuration);
          setRange((current) => normalizeRange(nextDuration, current.startMs, value.trimEndMs ?? nextDuration));
          event.currentTarget.currentTime = range.startMs / 1000;
        }}
        onTimeUpdate={(event) => {
          const next = event.currentTarget.currentTime * 1000;
          setPreviewTime(next);
          if (next >= range.endMs) {
            event.currentTarget.pause();
            event.currentTarget.currentTime = range.startMs / 1000;
            setPreviewTime(range.startMs);
            setPlaying(false);
          }
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      /> : <div className="video-trim-empty">Không có video để cắt.</div>}
      <button className="video-trim-play" onClick={togglePreview} disabled={!asset} aria-label={playing ? 'Tạm dừng xem trước' : 'Phát đoạn đã chọn'}>
        {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
      </button>
      <span className="video-trim-preview-time">{formatClock(previewTime)}</span>
    </div>

    <div className="video-trim-workbench">
      <div className="video-trim-ruler" aria-hidden="true"><span>00:00</span><span>{formatClock(safeDuration / 2)}</span><span>{formatClock(safeDuration)}</span></div>
      <div ref={trackRef} className={`video-trim-track ${dragging ? 'is-dragging' : ''}`} onPointerDown={beginTrackDrag}>
        <div className="video-trim-film" aria-hidden="true" />
        <div className="video-trim-shade before" style={{ width: `${startPercent}%` }} />
        <div className="video-trim-shade after" style={{ left: `${endPercent}%` }} />
        <div className="video-trim-selection" style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}>
          <span><Scissors size={12} /> {formatClock(selectedDuration)}</span>
        </div>
        <button className="video-trim-handle start" style={{ left: `${startPercent}%` }} onPointerDown={(event) => beginHandleDrag(event, 'start')} aria-label="Kéo điểm bắt đầu"><i /><i /><i /></button>
        <button className="video-trim-handle end" style={{ left: `${endPercent}%` }} onPointerDown={(event) => beginHandleDrag(event, 'end')} aria-label="Kéo điểm kết thúc"><i /><i /><i /></button>
      </div>
    </div>

    <div className="video-trim-values">
      <label><span>Bắt đầu</span><div><input type="number" min={0} max={Math.max(0, range.endMs - MIN_TRIM_MS)} step={10} value={range.startMs} onChange={(event) => updateHandle('start', Number(event.target.value))} /><small>ms</small></div><b>{formatClock(range.startMs)}</b></label>
      <div className="video-trim-duration"><span>Đoạn được giữ</span><strong>{formatClock(selectedDuration)}</strong><small>Loại {formatClock(removedDuration)}</small></div>
      <label><span>Kết thúc</span><div><input type="number" min={range.startMs + MIN_TRIM_MS} max={safeDuration} step={10} value={range.endMs} onChange={(event) => updateHandle('end', Number(event.target.value))} /><small>ms</small></div><b>{formatClock(range.endMs)}</b></label>
    </div>

    <div className="modal-actions video-trim-actions"><button className="button ghost" onClick={onClose}>Hủy</button><button className="button primary" onClick={apply} disabled={!asset || safeDuration <= MIN_TRIM_MS}><Scissors size={15} /> Áp dụng đoạn cắt</button></div>
  </Modal>;
}
