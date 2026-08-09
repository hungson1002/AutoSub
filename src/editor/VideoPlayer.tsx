import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import type { BlurRegion, LogoOverlay, SubtitleCue, SubtitleStyle, VideoAsset } from '../types';
import { defaultStyle } from '../types';
import { Maximize, Pause, Play, Volume2 } from '../components/Icons';
import { formatClock } from '../lib/subtitles';
import { announceDropdownOpen, listenForOtherDropdowns, type DropdownId } from '../lib/dropdowns';
import { RangeInput } from '../components/RangeInput';

type Roi = { x: number; y: number; w: number; h: number };
type DragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type RoiDrag = { kind: DragKind; startX: number; startY: number; origin: Roi };
type BlurDrag = { kind: DragKind; startX: number; startY: number; origin: BlurRegion };
type SubtitleDrag = { startX: number; startY: number; originX: number; originY: number };
type SubtitlePosition = { x: number; y: number };
type LogoDrag = { startX: number; startY: number; originX: number; originY: number; widthPercent: number; stageWidth: number; stageHeight: number; pendingX?: number; pendingY?: number; frame?: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const audioRefTime = (audio: HTMLAudioElement) => Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

function blurRegionPreviewStyle(region: BlurRegion): CSSProperties {
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
  dubAudioUrl?: string;
  audioMode?: 'original' | 'dubbed';
  dubAudioMix?: { keepOriginal: boolean; originalVolume: number; separateVocals?: boolean };
  seekRequest?: { id: number; timeMs: number };
  onTime?: (ms: number) => void;
  roi?: Roi;
  onRoiChange?: (roi: Roi) => void;
  onBlurRegionsChange?: (regions: BlurRegion[]) => void;
  onStyleChange?: (patch: Partial<SubtitleStyle>) => void;
  onLogoChange?: (patch: Partial<LogoOverlay>) => void;
  blurEditMode?: boolean;
};

export function VideoPlayer({ asset, cues, style = defaultStyle, blurRegions = [], logo, currentTimeMs, dubAudioUrl, audioMode = 'original', dubAudioMix, seekRequest, onTime, roi, onRoiChange, onBlurRegionsChange, onStyleChange, onLogoChange, blurEditMode = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dubAudioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const volumeDropdownId = useRef<DropdownId>({});
  const [stageWidth, setStageWidth] = useState(960);
  const [roiDrag, setRoiDrag] = useState<RoiDrag>();
  const [blurDrag, setBlurDrag] = useState<BlurDrag>();
  const [subtitleDrag, setSubtitleDrag] = useState<SubtitleDrag>();
  const [draftSubtitlePosition, setDraftSubtitlePosition] = useState<SubtitlePosition>();
  const [logoDrag, setLogoDrag] = useState<LogoDrag>();
  const logoDragRef = useRef<LogoDrag | undefined>(undefined);
  const lastReportedTimeMsRef = useRef<number | undefined>(undefined);
  const subtitleFrameRef = useRef<number | undefined>(undefined);
  const pendingSubtitlePositionRef = useRef<SubtitlePosition | undefined>(undefined);
  const [draftBlurRegion, setDraftBlurRegion] = useState<BlurRegion>();
  const blurFrameRef = useRef<number | undefined>(undefined);
  const pendingBlurRegionRef = useRef<BlurRegion | undefined>(undefined);
  const [activeBlurId, setActiveBlurId] = useState<string>();
  const activeCue = cues.reduce<SubtitleCue | undefined>((current, cue) => {
    if (!cue.enabled || time < cue.startMs || time >= cue.endMs) return current;
    return !current || cue.startMs > current.startMs || (cue.startMs === current.startMs && cue.index > current.index) ? cue : current;
  }, undefined);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const originalMixVolume = dubAudioMix?.keepOriginal && !dubAudioMix.separateVocals ? dubAudioMix.originalVolume : 0;
    video.volume = audioMode === 'dubbed' && dubAudioUrl ? Math.min(1, volume * originalMixVolume) : volume;
  }, [volume, audioMode, dubAudioUrl, dubAudioMix]);
  useEffect(() => {
    const video = videoRef.current;
    const audio = dubAudioRef.current;
    if (!video || !audio) return;
    audio.pause();
    if (audioMode !== 'dubbed' || !dubAudioUrl) return;
    audio.currentTime = video.currentTime;
    if (!video.paused) void audio.play().catch(() => undefined);
  }, [audioMode, dubAudioUrl]);
  useEffect(() => {
    if (dubAudioRef.current) dubAudioRef.current.volume = volume;
  }, [dubAudioUrl, volume]);
  useEffect(() => { const stage = stageRef.current; if (!stage) return; const observer = new ResizeObserver(([entry]) => setStageWidth(entry?.contentRect.width || stage.clientWidth || 960)); observer.observe(stage); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!blurEditMode) setActiveBlurId(undefined); }, [blurEditMode]);
  useEffect(() => listenForOtherDropdowns(volumeDropdownId.current, () => setVolumeOpen(false)), []);
  useEffect(() => {
    const close = (event: globalThis.PointerEvent) => {
      if (!volumeControlRef.current?.contains(event.target as Node)) setVolumeOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => {
    if (!blurEditMode) return;
    const clearSelectionOutsideRegion = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.video-stage .blur-overlay-selectable, .video-stage .blur-overlay-editable')) setActiveBlurId(undefined);
    };
    document.addEventListener('pointerdown', clearSelectionOutsideRegion, true);
    return () => document.removeEventListener('pointerdown', clearSelectionOutsideRegion, true);
  }, [blurEditMode]);
  useEffect(() => () => {
    if (subtitleFrameRef.current !== undefined) cancelAnimationFrame(subtitleFrameRef.current);
    if (blurFrameRef.current !== undefined) cancelAnimationFrame(blurFrameRef.current);
  }, []);
  useEffect(() => {
    if (!videoRef.current || typeof currentTimeMs !== 'number') return;
    if (lastReportedTimeMsRef.current === currentTimeMs) {
      lastReportedTimeMsRef.current = undefined;
      return;
    }
    const next = currentTimeMs / 1000;
    setTime(currentTimeMs);
    if (Math.abs(videoRef.current.currentTime - next) > 0.06) videoRef.current.currentTime = next;
    if (audioMode === 'dubbed' && dubAudioUrl && dubAudioRef.current && Math.abs(audioRefTime(dubAudioRef.current) - next) > 0.06) dubAudioRef.current.currentTime = next;
  }, [currentTimeMs, audioMode, dubAudioUrl]);
  useEffect(() => {
    if (!videoRef.current || !seekRequest) return;
    const next = seekRequest.timeMs / 1000;
    lastReportedTimeMsRef.current = seekRequest.timeMs;
    setTime(seekRequest.timeMs);
    if (Math.abs(videoRef.current.currentTime - next) > 0.001) videoRef.current.currentTime = next;
    if (audioMode === 'dubbed' && dubAudioUrl && dubAudioRef.current) dubAudioRef.current.currentTime = next;
  }, [seekRequest?.id, audioMode, dubAudioUrl]);

  const toggle = () => { if (!videoRef.current) return; const video = videoRef.current; const audio = dubAudioRef.current; if (video.paused) { video.currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0; if (audioMode === 'dubbed' && dubAudioUrl && audio) { audio.currentTime = video.currentTime; void audio.play().catch(() => undefined); } void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); } else { video.pause(); audio?.pause(); setPlaying(false); } };
  const reportTime = (next: number) => { lastReportedTimeMsRef.current = next; setTime(next); if (audioMode === 'dubbed' && dubAudioUrl && dubAudioRef.current && !dubAudioRef.current.paused && Math.abs(audioRefTime(dubAudioRef.current) - next / 1000) > 0.18) dubAudioRef.current.currentTime = next / 1000; onTime?.(next); };
  const seek = (next: number) => { if (!videoRef.current) return; videoRef.current.currentTime = next / 1000; if (audioMode === 'dubbed' && dubAudioUrl && dubAudioRef.current) dubAudioRef.current.currentTime = next / 1000; reportTime(next); };
  const beginRoiDrag = (event: PointerEvent<HTMLElement>, kind: DragKind) => { if (!roi || !onRoiChange) return; event.preventDefault(); event.stopPropagation(); stageRef.current?.setPointerCapture?.(event.pointerId); setRoiDrag({ kind, startX: event.clientX, startY: event.clientY, origin: roi }); };
  const beginBlurDrag = (event: PointerEvent<HTMLElement>, region: BlurRegion, kind: DragKind) => {
    if (!blurEditMode || !onBlurRegionsChange) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveBlurId(region.id);
    if (activeBlurId !== region.id) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setBlurDrag({ kind, startX: event.clientX, startY: event.clientY, origin: region });
  };
  const beginSubtitleDrag = (event: PointerEvent<HTMLElement>) => { if (style.position !== 'custom' || !onStyleChange) return; event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); setSubtitleDrag({ startX: event.clientX, startY: event.clientY, originX: style.customX ?? 50, originY: style.customY ?? 82 }); };
  const clearBlurSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (!blurEditMode) return;
    const target = event.target as Element;
    if (!target.closest?.('.blur-overlay-selectable, .blur-overlay-editable, .subtitle-overlay')) setActiveBlurId(undefined);
  };
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
    if (blurDrag) {
      const dx = ((event.clientX - blurDrag.startX) / rect.width) * 100;
      const dy = ((event.clientY - blurDrag.startY) / rect.height) * 100;
      const next = patchRect({ x: blurDrag.origin.xPercent, y: blurDrag.origin.yPercent, w: blurDrag.origin.widthPercent, h: blurDrag.origin.heightPercent }, blurDrag.kind, dx, dy);
      const nextRegion = { ...blurDrag.origin, xPercent: next.x, yPercent: next.y, widthPercent: next.w, heightPercent: next.h };
      pendingBlurRegionRef.current = nextRegion;
      if (blurFrameRef.current === undefined) {
        blurFrameRef.current = requestAnimationFrame(() => {
          blurFrameRef.current = undefined;
          if (pendingBlurRegionRef.current) setDraftBlurRegion(pendingBlurRegionRef.current);
        });
      }
    }
    if (subtitleDrag) {
      const dx = ((event.clientX - subtitleDrag.startX) / rect.width) * 100;
      const dy = ((event.clientY - subtitleDrag.startY) / rect.height) * 100;
      const nextPosition = { x: clamp(subtitleDrag.originX + dx, 5, 95), y: clamp(subtitleDrag.originY + dy, 5, 95) };
      pendingSubtitlePositionRef.current = nextPosition;
      if (subtitleFrameRef.current === undefined) {
        subtitleFrameRef.current = requestAnimationFrame(() => {
          subtitleFrameRef.current = undefined;
          if (pendingSubtitlePositionRef.current) setDraftSubtitlePosition(pendingSubtitlePositionRef.current);
        });
      }
    }
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
    if (blurFrameRef.current !== undefined) { cancelAnimationFrame(blurFrameRef.current); blurFrameRef.current = undefined; }
    const finalBlurRegion = pendingBlurRegionRef.current || draftBlurRegion;
    if (onBlurRegionsChange && blurDrag && finalBlurRegion) onBlurRegionsChange(blurRegions.map((region) => region.id === finalBlurRegion.id ? finalBlurRegion : region));
    pendingBlurRegionRef.current = undefined;
    setDraftBlurRegion(undefined);
    if (subtitleFrameRef.current !== undefined) { cancelAnimationFrame(subtitleFrameRef.current); subtitleFrameRef.current = undefined; }
    const finalSubtitlePosition = pendingSubtitlePositionRef.current || draftSubtitlePosition;
    if (onStyleChange && subtitleDrag && finalSubtitlePosition) onStyleChange({ customX: finalSubtitlePosition.x, customY: finalSubtitlePosition.y });
    pendingSubtitlePositionRef.current = undefined;
    setDraftSubtitlePosition(undefined);
    const drag = logoDragRef.current;
    if (drag) {
      if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
      if (onLogoChange && typeof drag.pendingX === 'number' && typeof drag.pendingY === 'number') onLogoChange({ xPercent: drag.pendingX, yPercent: drag.pendingY });
    }
    logoDragRef.current = undefined;
    setRoiDrag(undefined); setBlurDrag(undefined); setSubtitleDrag(undefined); setLogoDrag(undefined);
  };
  const previewScale = stageWidth / 1920;
  const previewStyle = draftSubtitlePosition && style.position === 'custom' ? { ...style, customX: draftSubtitlePosition.x, customY: draftSubtitlePosition.y } : style;
  const outlineWidth = previewStyle.background === 'outline' ? Math.max(0, (previewStyle.outlineWidth ?? 2) * previewScale) : 0;
  const boxColor = previewStyle.backgroundColor ?? previewStyle.outlineColor;
  const subtitleStyle: CSSProperties = {
    fontFamily: previewStyle.fontFamily,
    fontSize: `${Math.max(previewStyle.fontSize * previewScale, 10)}px`,
    color: previewStyle.textColor,
    fontWeight: previewStyle.bold ? 700 : 400,
    fontStyle: previewStyle.italic ? 'italic' : 'normal',
    WebkitTextFillColor: previewStyle.textColor,
    WebkitTextStroke: outlineWidth > 0 ? `${outlineWidth}px ${previewStyle.outlineColor}` : '0 transparent',
    paintOrder: 'stroke fill',
    background: previewStyle.background === 'box' ? `${boxColor}${Math.round(previewStyle.backgroundOpacity * 255).toString(16).padStart(2, '0')}` : 'transparent',
    ...(previewStyle.position === 'custom' ? { left: `${previewStyle.customX ?? 50}%`, top: `${previewStyle.customY ?? 82}%`, right: 'auto', bottom: 'auto', width: '84%', maxWidth: '84%', boxSizing: 'border-box', transform: 'translate(-50%, -50%)', pointerEvents: 'auto', cursor: subtitleDrag ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none' } : {}),
  };

  return <div className="video-player">{dubAudioUrl && <audio ref={dubAudioRef} className="preview-dub-audio" src={dubAudioUrl} preload="auto" aria-hidden="true" />}<div ref={stageRef} className={`video-stage ${blurEditMode ? 'blur-edit-stage' : ''}`} onPointerDown={clearBlurSelection} onPointerMove={move} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
    {asset ? <video ref={videoRef} src={asset.url} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration * 1000)} onTimeUpdate={(event) => { reportTime(event.currentTarget.currentTime * 1000); }} onEnded={() => { dubAudioRef.current?.pause(); setPlaying(false); }} /> : <div className="video-empty"><div className="reel-icon">✦</div><span>Chưa có video preview</span><small>Thêm video ở Trích xuất hoặc Editor</small></div>}
    {asset && logo?.enabled && <>{logo.kind === 'image' && logo.url ? <img className="logo-overlay" src={logo.url} alt={logo.name} draggable={false} onPointerDown={beginLogoDrag} style={{ left: `${logo.xPercent}%`, top: `${logo.yPercent}%`, width: `${logo.widthPercent}%`, opacity: logo.opacity, pointerEvents: 'auto', cursor: logoDrag ? 'grabbing' : 'grab' }} /> : logo.kind === 'text' && <div className="logo-overlay logo-text-overlay" onPointerDown={beginLogoDrag} style={{ left: `${logo.xPercent}%`, top: `${logo.yPercent}%`, width: `${logo.widthPercent}%`, opacity: logo.opacity, color: logo.textColor, fontFamily: logo.fontFamily, fontSize: `${logo.fontSize}px`, textShadow: `1px 1px 0 ${logo.outlineColor}, -1px -1px 0 ${logo.outlineColor}`, pointerEvents: 'auto', cursor: logoDrag ? 'grabbing' : 'grab' }}>{logo.text}</div>}</>}
    {asset && activeCue && style.visible && <div className={`subtitle-overlay ${style.position}`} onPointerDown={beginSubtitleDrag} style={subtitleStyle}>{style.content === 'original' ? activeCue.originalText : style.content === 'both' ? <><span>{activeCue.originalText}</span><br /><span>{activeCue.translatedText}</span></> : activeCue.translatedText || activeCue.originalText}</div>}
    {blurRegions.map((region, index) => { const previewRegion = draftBlurRegion?.id === region.id ? draftBlurRegion : region; const selectedBlur = activeBlurId === region.id; return <div key={region.id} className={`blur-overlay ${blurEditMode ? selectedBlur ? 'blur-overlay-editable selected' : 'blur-overlay-selectable' : ''}`} style={blurRegionPreviewStyle(previewRegion)} onPointerDown={(event) => beginBlurDrag(event, previewRegion, 'move')}><span>{selectedBlur ? `BLUR ${index + 1}` : ''}</span>{selectedBlur && <><i className="roi-handle nw" onPointerDown={(event) => beginBlurDrag(event, previewRegion, 'nw')} /><i className="roi-handle ne" onPointerDown={(event) => beginBlurDrag(event, previewRegion, 'ne')} /><i className="roi-handle sw" onPointerDown={(event) => beginBlurDrag(event, previewRegion, 'sw')} /><i className="roi-handle se" onPointerDown={(event) => beginBlurDrag(event, previewRegion, 'se')} /></>}</div>; })}
    {roi && <div className="roi-box" style={{ left: `${roi.x}%`, top: `${roi.y}%`, width: `${roi.w}%`, height: `${roi.h}%` }} onPointerDown={(event) => beginRoiDrag(event, 'move')}><span>OCR REGION</span><i className="roi-handle nw" onPointerDown={(event) => beginRoiDrag(event, 'nw')} /><i className="roi-handle ne" onPointerDown={(event) => beginRoiDrag(event, 'ne')} /><i className="roi-handle sw" onPointerDown={(event) => beginRoiDrag(event, 'sw')} /><i className="roi-handle se" onPointerDown={(event) => beginRoiDrag(event, 'se')} /></div>}
  </div><div className="video-controls"><button className="play-button" onClick={toggle} disabled={!asset}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button><span className="timecode">{formatClock(time)}</span><RangeInput className="seekbar" min={0} max={duration || 1} value={time} onChange={(event) => seek(Number(event.target.value))} /><span className="timecode muted">{formatClock(duration)}</span><div className="volume-control" ref={volumeControlRef}><button className="volume-button" onClick={() => { if (!volumeOpen) announceDropdownOpen(volumeDropdownId.current); setVolumeOpen((value) => !value); }} aria-label="Điều chỉnh âm lượng"><Volume2 size={15} /></button>{volumeOpen && <div className="volume-popover"><div className="volume-popover-head"><span>Âm lượng</span><b>{Math.round(volume * 100)}%</b></div><RangeInput className="volume-popover-range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></div>}</div><button className="icon-button" onClick={() => void videoRef.current?.requestFullscreen?.()} aria-label="Toàn màn hình"><Maximize size={15} /></button></div></div>;
}
