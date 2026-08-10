import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SubtitleCue } from '../types';
import { formatClock } from '../lib/subtitles';

const MIN_ZOOM = 1;
const MAX_ZOOM = 32;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function tickStep(durationMs: number, zoom: number) {
  const visibleMs = durationMs / Math.max(zoom, 1);
  if (visibleMs <= 10_000) return 1_000;
  if (visibleMs <= 30_000) return 2_000;
  if (visibleMs <= 90_000) return 5_000;
  if (visibleMs <= 5 * 60_000) return 15_000;
  if (visibleMs <= 15 * 60_000) return 30_000;
  return 60_000;
}

export const SubtitleTimeline = memo(function SubtitleTimeline({ cues, currentTime, selectedId, onSelect }: { cues: SubtitleCue[]; currentTime: number; selectedId?: string; onSelect: (id: string) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(800);
  const duration = Math.max(cues.at(-1)?.endMs || 10_000, currentTime || 10_000);
  const trackWidth = Math.max(viewportWidth, Math.round(viewportWidth * zoom));
  const step = tickStep(duration, zoom);
  const ticks = useMemo(() => Array.from({ length: Math.ceil(duration / step) + 1 }, (_value, index) => index * step).filter((value) => value <= duration), [duration, step]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(Math.max(1, entry?.contentRect.width || viewport.clientWidth || 800)));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || zoom <= 1) return;
    const playheadX = (currentTime / duration) * trackWidth;
    const safeLeft = viewport.scrollLeft + viewport.clientWidth * 0.12;
    const safeRight = viewport.scrollLeft + viewport.clientWidth * 0.88;
    if (playheadX < safeLeft || playheadX > safeRight) viewport.scrollTo({ left: Math.max(0, playheadX - viewport.clientWidth * 0.35), behavior: 'smooth' });
  }, [currentTime, duration, trackWidth, zoom]);

  const setAnchoredZoom = useCallback((nextZoom: number, anchorClientX?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounded = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const rect = viewport.getBoundingClientRect();
    const anchor = clamp((anchorClientX ?? rect.left + rect.width / 2) - rect.left, 0, rect.width);
    const timelineRatio = (viewport.scrollLeft + anchor) / Math.max(trackWidth, 1);
    setZoom(bounded);
    requestAnimationFrame(() => {
      const nextWidth = Math.max(viewport.clientWidth, viewport.clientWidth * bounded);
      viewport.scrollLeft = Math.max(0, timelineRatio * nextWidth - anchor);
    });
  }, [trackWidth]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const factor = event.deltaY < 0 ? 1.22 : 1 / 1.22;
      setAnchoredZoom(zoom * factor, event.clientX);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [setAnchoredZoom, zoom]);

  return <div className="timeline-wrap">
    <div className="timeline-heading">
      <span>TIMELINE <i>Ctrl + lăn chuột để zoom</i></span>
      <div className="timeline-tools"><span>{formatClock(currentTime)} / {formatClock(duration)}</span><button type="button" onClick={() => setAnchoredZoom(zoom / 1.35)} aria-label="Thu nhỏ timeline">−</button><b>{Math.round(zoom * 100)}%</b><button type="button" onClick={() => setAnchoredZoom(zoom * 1.35)} aria-label="Phóng to timeline">+</button></div>
    </div>
    <div ref={viewportRef} className="timeline-viewport">
      <div className="timeline" style={{ width: `${trackWidth}px` }}>
        <div className="timeline-ruler">{ticks.map((tick) => <span key={tick} className="timeline-tick" style={{ left: `${(tick / duration) * 100}%` }}><i />{formatClock(tick)}</span>)}</div>
        <div className="timeline-lane">
          <div className="playhead" style={{ left: `${(currentTime / duration) * 100}%` }} />
          {cues.map((cue) => <button key={cue.id} className={`timeline-cue ${selectedId === cue.id ? 'active' : ''}`} style={{ left: `${(cue.startMs / duration) * 100}%`, width: `${Math.max(((cue.endMs - cue.startMs) / duration) * 100, (12 / trackWidth) * 100)}%` }} onClick={() => onSelect(cue.id)} title={`Cue ${cue.index} · ${formatClock(cue.startMs)} → ${formatClock(cue.endMs)}`}><span>{cue.index}</span></button>)}
        </div>
      </div>
    </div>
  </div>;
});
