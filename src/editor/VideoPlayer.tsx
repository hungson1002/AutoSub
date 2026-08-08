import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import type { BlurRegion, LogoOverlay, SubtitleCue, SubtitleStyle, VideoAsset } from '../types';
import { defaultStyle } from '../types';
import { Maximize, Pause, Play, Volume2 } from '../components/Icons';
import { cssOutlineShadow, formatClock } from '../lib/subtitles';

type Roi = { x: number; y: number; w: number; h: number };
type DragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type RoiDrag = { kind: DragKind; startX: number; startY: number; origin: Roi };
type BlurDrag = { kind: DragKind; startX: number; startY: number; origin: BlurRegion };
type SubtitleDrag = { startX: number; startY: number; originX: number; originY: number };
type LogoDrag = { startX: number; startY: number; originX: number; originY: number; widthPercent: number; stageWidth: number; stageHeight: number; pendingX?: number; pendingY?: number; frame?: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function patchRect(origin: Roi, kind: DragKind, dx: number, dy: number): Roi {
  if (kind === 'move') return { ...origin, x: clamp(origin.x + dx, 0, 100 - origin.w), y: clamp(origin.y + dy, 0, 100 - origin.h) };
  if (kind === 'nw') { const x = clamp(origin.x + dx, 0, origin.x + origin.w - 5); const y = clamp(origin.y + dy, 0, origin.y + origin.h - 5); return { x, y, w: origin.x + origin.w - x, h: origin.y + origin.h - y }; }
  if (kind === 'ne') { const y = clamp(origin.y + dy, 0, origin.y + origin.h - 5); return { x: origin.x, y, w: clamp(origin.w + dx, 5, 100 - origin.x), h: origin.y + origin.h - y }; }
  if (kind === 'sw') { const x = clamp(origin.x + dx, 0, origin.x + origin.w - 5); return { x, y: origin.y, w: origin.x + origin.w - x, h: clamp(origin.h + dy, 5, 100 - origin.y) }; }
  return { x: origin.x, y: origin.y, w: clamp(origin.w + dx, 5, 100 - origin.x), h: clamp(origin.h + dy, 5, 100 - origin.y) };
}

type Props = {
  asset?: VideoAsset;
  cues: SubtitleCue[];
  style?: SubtitleStyle;
  blurRegions?: BlurRegion[];
  logo?: LogoOverlay;
  currentTimeMs?: number;
  onTime?: (ms: number) => void;
  roi?: Roi;
  onRoiChange?: (roi: Roi) => void;
  onBlurRegionsChange?: (regions: BlurRegion[]) => void;
  onStyleChange?: (patch: Partial<SubtitleStyle>) => void;
  onLogoChange?: (patch: Partial<LogoOverlay>) => void;
  blurEditMode?: boolean;
};

export function VideoPlayer({ asset, cues, style = defaultStyle, blurRegions = [], logo, currentTimeMs, onTime, roi, onRoiChange, onBlurRegionsChange, onStyleChange, onLogoChange, blurEditMode = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [stageWidth, setStageWidth] = useState(960);
  const [roiDrag, setRoiDrag] = useState<RoiDrag>();
  const [blurDrag, setBlurDrag] = useState<BlurDrag>();
  const [subtitleDrag, setSubtitleDrag] = useState<SubtitleDrag>();
  const [logoDrag, setLogoDrag] = useState<LogoDrag>();
  const logoDragRef = useRef<LogoDrag | undefined>(undefined);
  const [activeBlurId, setActiveBlurId] = useState<string>();
  const activeCue = cues.find((cue) => time >= cue.startMs && time <= cue.endMs && cue.enabled);

  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
  useEffect(() => { const stage = stageRef.current; if (!stage) return; const observer = new ResizeObserver(([entry]) => setStageWidth(entry?.contentRect.width || stage.clientWidth || 960)); observer.observe(stage); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!videoRef.current || typeof currentTimeMs !== 'number') return; const next = currentTimeMs / 1000; setTime(currentTimeMs); if (Math.abs(videoRef.current.currentTime - next) > 0.06) videoRef.current.currentTime = next; }, [currentTimeMs]);

  const toggle = () => { if (!videoRef.current) return; if (videoRef.current.paused) { void videoRef.current.play(); setPlaying(true); } else { videoRef.current.pause(); setPlaying(false); } };
  const seek = (next: number) => { if (!videoRef.current) return; videoRef.current.currentTime = next / 1000; setTime(next); onTime?.(next); };
  const beginRoiDrag = (event: PointerEvent<HTMLElement>, kind: DragKind) => { if (!roi || !onRoiChange) return; event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); setRoiDrag({ kind, startX: event.clientX, startY: event.clientY, origin: roi }); };
  const beginBlurDrag = (event: PointerEvent<HTMLElement>, region: BlurRegion, kind: DragKind) => { if (!blurEditMode || !onBlurRegionsChange) return; event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); setActiveBlurId(region.id); setBlurDrag({ kind, startX: event.clientX, startY: event.clientY, origin: region }); };
  const beginSubtitleDrag = (event: PointerEvent<HTMLElement>) => { if (style.position !== 'custom' || !onStyleChange) return; event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); setSubtitleDrag({ startX: event.clientX, startY: event.clientY, originX: style.customX ?? 50, originY: style.customY ?? 82 }); };
  const beginLogoDrag = (event: PointerEvent<HTMLElement>) => {
    if (!logo?.enabled || !onLogoChange || !stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (logo.position !== 'custom') onLogoChange({ position: 'custom' });
    const rect = stageRef.current.getBoundingClientRect();
    stageRef.current.setPointerCapture?.(event.pointerId);
    const drag = { startX: event.clientX, startY: event.clientY, originX: logo.xPercent, originY: logo.yPercent, widthPercent: logo.widthPercent, stageWidth: rect.width, stageHeight: rect.height };
    logoDragRef.current = drag;
    setLogoDrag(drag);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (roi && onRoiChange && roiDrag) { const dx = ((event.clientX - roiDrag.startX) / rect.width) * 100; const dy = ((event.clientY - roiDrag.startY) / rect.height) * 100; onRoiChange(patchRect(roiDrag.origin, roiDrag.kind, dx, dy)); }
    if (onBlurRegionsChange && blurDrag) { const dx = ((event.clientX - blurDrag.startX) / rect.width) * 100; const dy = ((event.clientY - blurDrag.startY) / rect.height) * 100; const next = patchRect({ x: blurDrag.origin.xPercent, y: blurDrag.origin.yPercent, w: blurDrag.origin.widthPercent, h: blurDrag.origin.heightPercent }, blurDrag.kind, dx, dy); onBlurRegionsChange(blurRegions.map((region) => region.id === blurDrag.origin.id ? { ...region, xPercent: next.x, yPercent: next.y, widthPercent: next.w, heightPercent: next.h } : region)); }
    if (onStyleChange && subtitleDrag) { const dx = ((event.clientX - subtitleDrag.startX) / rect.width) * 100; const dy = ((event.clientY - subtitleDrag.startY) / rect.height) * 100; onStyleChange({ customX: clamp(subtitleDrag.originX + dx, 5, 95), customY: clamp(subtitleDrag.originY + dy, 5, 95) }); }
    const activeLogoDrag = logoDragRef.current;
    if (onLogoChange && activeLogoDrag) {
      const dx = ((event.clientX - activeLogoDrag.startX) / activeLogoDrag.stageWidth) * 100;
      const dy = ((event.clientY - activeLogoDrag.startY) / activeLogoDrag.stageHeight) * 100;
      activeLogoDrag.pendingX = clamp(activeLogoDrag.originX + dx, 0, 100 - activeLogoDrag.widthPercent);
      activeLogoDrag.pendingY = clamp(activeLogoDrag.originY + dy, 0, 95);
      if (activeLogoDrag.frame === undefined) {
        activeLogoDrag.frame = requestAnimationFrame(() => {
          const drag = logoDragRef.current;
          if (!drag) return;
          drag.frame = undefined;
          if (typeof drag.pendingX === 'number' && typeof drag.pendingY === 'number') {
            onLogoChange({ xPercent: drag.pendingX, yPercent: drag.pendingY });
            drag.pendingX = undefined;
            drag.pendingY = undefined;
          }
        });
      }
    }
  };
  const stopDrag = (event?: PointerEvent<HTMLDivElement>) => {
    if (event && stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
    const drag = logoDragRef.current;
    if (drag) {
      if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
      if (onLogoChange && typeof drag.pendingX === 'number' && typeof drag.pendingY === 'number') onLogoChange({ xPercent: drag.pendingX, yPercent: drag.pendingY });
    }
    logoDragRef.current = undefined;
    setRoiDrag(undefined); setBlurDrag(undefined); setSubtitleDrag(undefined); setLogoDrag(undefined);
  };
  const previewScale = stageWidth / 1920;
  const textShadow = style.background === 'outline' ? cssOutlineShadow(style.outlineColor, (style.outlineWidth ?? 2) * previewScale) : 'none';
  const boxColor = style.backgroundColor ?? style.outlineColor;
  const subtitleStyle: CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: `${Math.max(style.fontSize * previewScale, 10)}px`,
    color: style.textColor,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textShadow,
    background: style.background === 'box' ? `${boxColor}${Math.round(style.backgroundOpacity * 255).toString(16).padStart(2, '0')}` : 'transparent',
    ...(style.position === 'custom' ? { left: `${style.customX ?? 50}%`, top: `${style.customY ?? 82}%`, right: 'auto', bottom: 'auto', width: '84%', maxWidth: '84%', boxSizing: 'border-box', transform: 'translate(-50%, -50%)', pointerEvents: 'auto', cursor: subtitleDrag ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none' } : {}),
  };

  return <div className="video-player"><div ref={stageRef} className={`video-stage ${blurEditMode ? 'blur-edit-stage' : ''}`} onPointerMove={move} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
    {asset ? <video ref={videoRef} src={asset.url} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration * 1000)} onTimeUpdate={(event) => { const ms = event.currentTarget.currentTime * 1000; setTime(ms); onTime?.(ms); }} onEnded={() => setPlaying(false)} /> : <div className="video-empty"><div className="reel-icon">✦</div><span>Chưa có video preview</span><small>Thêm video ở Trích xuất hoặc Editor</small></div>}
    {asset && logo?.enabled && <>{logo.kind === 'image' && logo.url ? <img className="logo-overlay" src={logo.url} alt={logo.name} draggable={false} onPointerDown={beginLogoDrag} style={{ left: `${logo.xPercent}%`, top: `${logo.yPercent}%`, width: `${logo.widthPercent}%`, opacity: logo.opacity, pointerEvents: 'auto', cursor: logoDrag ? 'grabbing' : 'grab' }} /> : logo.kind === 'text' && <div className="logo-overlay logo-text-overlay" onPointerDown={beginLogoDrag} style={{ left: `${logo.xPercent}%`, top: `${logo.yPercent}%`, width: `${logo.widthPercent}%`, opacity: logo.opacity, color: logo.textColor, fontFamily: logo.fontFamily, fontSize: `${logo.fontSize}px`, textShadow: `1px 1px 0 ${logo.outlineColor}, -1px -1px 0 ${logo.outlineColor}`, pointerEvents: 'auto', cursor: logoDrag ? 'grabbing' : 'grab' }}>{logo.text}</div>}</>}
    {asset && activeCue && style.visible && <div className={`subtitle-overlay ${style.position}`} onPointerDown={beginSubtitleDrag} style={subtitleStyle}>{style.content === 'original' ? activeCue.originalText : style.content === 'both' ? <><span>{activeCue.originalText}</span><br /><span>{activeCue.translatedText}</span></> : activeCue.translatedText || activeCue.originalText}</div>}
    {blurRegions.map((region, index) => <div key={region.id} className={`blur-overlay ${blurEditMode ? 'blur-overlay-editable' : ''} ${activeBlurId === region.id ? 'selected' : ''}`} style={{ left: `${region.xPercent}%`, top: `${region.yPercent}%`, width: `${region.widthPercent}%`, height: `${region.heightPercent}%`, backdropFilter: region.mode === 'blur' ? `blur(${Math.max(3, region.blurStrength)}px)` : 'none', WebkitBackdropFilter: region.mode === 'blur' ? `blur(${Math.max(3, region.blurStrength)}px)` : 'none' }} onPointerDown={(event) => beginBlurDrag(event, region, 'move')}><span>{blurEditMode ? `BLUR ${index + 1}` : ''}</span>{blurEditMode && <><i className="roi-handle nw" onPointerDown={(event) => beginBlurDrag(event, region, 'nw')} /><i className="roi-handle ne" onPointerDown={(event) => beginBlurDrag(event, region, 'ne')} /><i className="roi-handle sw" onPointerDown={(event) => beginBlurDrag(event, region, 'sw')} /><i className="roi-handle se" onPointerDown={(event) => beginBlurDrag(event, region, 'se')} /></>}</div>)}
    {roi && <div className="roi-box" style={{ left: `${roi.x}%`, top: `${roi.y}%`, width: `${roi.w}%`, height: `${roi.h}%` }} onPointerDown={(event) => beginRoiDrag(event, 'move')}><span>OCR REGION</span><i className="roi-handle nw" onPointerDown={(event) => beginRoiDrag(event, 'nw')} /><i className="roi-handle ne" onPointerDown={(event) => beginRoiDrag(event, 'ne')} /><i className="roi-handle sw" onPointerDown={(event) => beginRoiDrag(event, 'sw')} /><i className="roi-handle se" onPointerDown={(event) => beginRoiDrag(event, 'se')} /></div>}
  </div><div className="video-controls"><button className="play-button" onClick={toggle} disabled={!asset}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><span className="timecode">{formatClock(time)}</span><input className="seekbar" type="range" min={0} max={duration || 1} value={time} onChange={(event) => seek(Number(event.target.value))} /><span className="timecode muted">{formatClock(duration)}</span><div className="volume-control"><button className="volume-button" onClick={() => setVolumeOpen((value) => !value)} aria-label="Điều chỉnh âm lượng"><Volume2 size={15} /></button>{volumeOpen && <div className="volume-popover"><div className="volume-popover-head"><span>Âm lượng</span><b>{Math.round(volume * 100)}%</b></div><input className="volume-popover-range" type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></div>}</div><button className="icon-button" onClick={() => void videoRef.current?.requestFullscreen?.()} aria-label="Toàn màn hình"><Maximize size={15} /></button></div></div>;
}
