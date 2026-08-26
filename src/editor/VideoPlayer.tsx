import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import type {
  BlurRegion,
  LogoOverlay,
  SubtitleCue,
  SubtitleStyle,
  VideoAspectRatio,
  VideoAsset,
  VideoEditState,
} from "../types";
import { defaultStyle } from "../types";
import {
  Crop as CropIcon,
  Maximize,
  Pause,
  Play,
  Scissors,
  Volume2,
} from "../components/Icons";
import { formatClock } from "../lib/subtitles";
import {
  announceDropdownOpen,
  listenForOtherDropdowns,
  type DropdownId,
} from "../lib/dropdowns";
import { RangeInput } from "../components/RangeInput";
import { VideoTrimModal } from "./VideoTrimModal";
import { VideoCropModal } from "./VideoCropModal";
import { cropVideoStyle } from "../lib/videoCrop";
import { buildActiveCueIndex, findActiveCue } from "../lib/activeCue";
import { dubAudioNeedsResync } from "../lib/mediaSync";

type Roi = { x: number; y: number; w: number; h: number };
type DragKind = "move" | "nw" | "ne" | "sw" | "se";
type RoiDrag = { kind: DragKind; startX: number; startY: number; origin: Roi };
type BlurDrag = {
  kind: DragKind;
  startX: number;
  startY: number;
  origin: BlurRegion;
};
type SubtitleDrag = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};
type SubtitlePosition = { x: number; y: number };
type LogoDrag = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  widthPercent: number;
  stageWidth: number;
  stageHeight: number;
  pendingX?: number;
  pendingY?: number;
  frame?: number;
};
type VideoPanDrag = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};
type AlignmentGuide = { value: number; label: string };
const VIDEO_CENTER_SNAP_PX = 14;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const audioRefTime = (audio: HTMLAudioElement) =>
  Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
const videoDurationMs = (video: HTMLVideoElement) =>
  Number.isFinite(video.duration) && video.duration > 0
    ? video.duration * 1000
    : undefined;
const nearestGuide = (
  value: number,
  targets: AlignmentGuide[],
  threshold: number,
) =>
  targets.reduce<AlignmentGuide | undefined>((best, target) => {
    if (Math.abs(target.value - value) > threshold) return best;
    return !best ||
      Math.abs(target.value - value) < Math.abs(best.value - value)
      ? target
      : best;
  }, undefined);

function blurRegionPreviewStyle(
  region: BlurRegion,
  outputScale: number,
): CSSProperties {
  // Blur values use the 1920px export coordinate space.  Scale the corner
  // radius here so preview and rendered video use the same geometry.
  const strength = Math.min(60, Math.max(3, Number(region.blurStrength) || 24));
  const borderRadius =
    Math.max(0, Math.min(40, region.borderRadius ?? 0)) * outputScale;
  return {
    left: `${region.xPercent}%`,
    top: `${region.yPercent}%`,
    width: `${region.widthPercent}%`,
    height: `${region.heightPercent}%`,
    borderRadius: `${borderRadius}px`,
    // A nearly transparent tint makes backdrop-filter reliably composite in
    // Chromium, while keeping the live preview close to the exported local
    // scene blur rather than showing a flat grey box.
    background: "rgba(12, 18, 24, 0.045)",
    backdropFilter: `blur(${Math.max(12, strength * 1.35)}px) saturate(0.92) brightness(0.975)`,
    WebkitBackdropFilter: `blur(${Math.max(12, strength * 1.35)}px) saturate(0.92) brightness(0.975)`,
    maskImage:
      "linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)",
    WebkitMaskImage:
      "linear-gradient(to bottom, transparent 0%, black 6%, black 94%, transparent 100%)",
  };
}

function patchRect(origin: Roi, kind: DragKind, dx: number, dy: number): Roi {
  if (kind === "move")
    return {
      ...origin,
      x: clamp(origin.x + dx, 0, 100 - origin.w),
      y: clamp(origin.y + dy, 0, 100 - origin.h),
    };
  if (kind === "nw") {
    const x = clamp(origin.x + dx, 0, origin.x + origin.w - 5);
    const y = clamp(origin.y + dy, 0, origin.y + origin.h - 5);
    return { x, y, w: origin.x + origin.w - x, h: origin.y + origin.h - y };
  }
  if (kind === "ne") {
    const y = clamp(origin.y + dy, 0, origin.y + origin.h - 5);
    return {
      x: origin.x,
      y,
      w: clamp(origin.w + dx, 5, 100 - origin.x),
      h: origin.y + origin.h - y,
    };
  }
  if (kind === "sw") {
    const x = clamp(origin.x + dx, 0, origin.x + origin.w - 5);
    return {
      x,
      y: origin.y,
      w: origin.x + origin.w - x,
      h: clamp(origin.h + dy, 5, 100 - origin.y),
    };
  }
  return {
    x: origin.x,
    y: origin.y,
    w: clamp(origin.w + dx, 5, 100 - origin.x),
    h: clamp(origin.h + dy, 5, 100 - origin.y),
  };
}

type Props = {
  asset?: VideoAsset;
  cues: SubtitleCue[];
  style?: SubtitleStyle;
  blurRegions?: BlurRegion[];
  logo?: LogoOverlay;
  dubAudioUrl?: string;
  audioMode?: "original" | "dubbed";
  dubAudioMix?: {
    keepOriginal: boolean;
    originalVolume: number;
    separateVocals?: boolean;
  };
  seekRequest?: { id: number; timeMs: number };
  onTime?: (ms: number) => void;
  onActiveCueChange?: (id?: string) => void;
  roi?: Roi;
  onRoiChange?: (roi: Roi) => void;
  onBlurRegionsChange?: (regions: BlurRegion[]) => void;
  onStyleChange?: (patch: Partial<SubtitleStyle>) => void;
  onLogoChange?: (patch: Partial<LogoOverlay>) => void;
  blurEditMode?: boolean;
  videoEdit?: VideoEditState;
  onVideoEditChange?: (next: VideoEditState) => void;
};

export function VideoPlayer({
  asset,
  cues,
  style = defaultStyle,
  blurRegions = [],
  logo,
  dubAudioUrl,
  audioMode = "original",
  dubAudioMix,
  seekRequest,
  onTime,
  onActiveCueChange,
  roi,
  onRoiChange,
  onBlurRegionsChange,
  onStyleChange,
  onLogoChange,
  blurEditMode = false,
  videoEdit,
  onVideoEditChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dubAudioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const volumeDropdownId = useRef<DropdownId>({});
  const [stageWidth, setStageWidth] = useState(960);
  const stageResizeTimerRef = useRef<number | undefined>(undefined);
  const [roiDrag, setRoiDrag] = useState<RoiDrag>();
  const [blurDrag, setBlurDrag] = useState<BlurDrag>();
  const [subtitleDrag, setSubtitleDrag] = useState<SubtitleDrag>();
  const [draftSubtitlePosition, setDraftSubtitlePosition] =
    useState<SubtitlePosition>();
  const [logoDrag, setLogoDrag] = useState<LogoDrag>();
  const logoDragRef = useRef<LogoDrag | undefined>(undefined);
  const subtitleFrameRef = useRef<number | undefined>(undefined);
  const pendingSubtitlePositionRef = useRef<SubtitlePosition | undefined>(
    undefined,
  );
  const [draftBlurRegion, setDraftBlurRegion] = useState<BlurRegion>();
  const blurFrameRef = useRef<number | undefined>(undefined);
  const pendingBlurRegionRef = useRef<BlurRegion | undefined>(undefined);
  const [activeBlurId, setActiveBlurId] = useState<string>();
  const [videoZoom, setVideoZoom] = useState(1);
  const [videoPan, setVideoPan] = useState({ x: 0, y: 0 });
  const [videoPanDrag, setVideoPanDrag] = useState<VideoPanDrag>();
  const videoPanDragRef = useRef<VideoPanDrag | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number }>();
  const [trimOpen, setTrimOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9 });
  const [alignmentGuides, setAlignmentGuides] = useState<{
    x?: AlignmentGuide;
    y?: AlignmentGuide;
  }>({});
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [internalVideoEdit, setInternalVideoEdit] = useState<VideoEditState>({
    aspectRatio: "original",
    trimStartMs: 0,
  });
  const effectiveVideoEdit = videoEdit || internalVideoEdit;
  const cueIndex = useMemo(() => buildActiveCueIndex(cues), [cues]);
  const [activeCueId, setActiveCueId] = useState<string>();
  const activeCue = useMemo(
    () =>
      activeCueId ? cues.find((cue) => cue.id === activeCueId) : undefined,
    [activeCueId, cues],
  );
  const playingDub = audioMode === "dubbed" && Boolean(dubAudioUrl);
  // The returned dub track is the single source of truth for preview. Playing
  // the source video's dialogue underneath it creates the exact two-speaker
  // echo users hear, especially for older jobs saved with original audio on.
  const originalMixVolume = playingDub
    ? 0
    : dubAudioMix?.keepOriginal && !dubAudioMix.separateVocals
      ? dubAudioMix.originalVolume
      : 0;
  const muteOriginal = playingDub && originalMixVolume <= 0;
  const syncActiveCue = useCallback(
    (nextTimeMs: number) => {
      const nextId = findActiveCue(cueIndex, nextTimeMs)?.id;
      setActiveCueId((current) => (current === nextId ? current : nextId));
    },
    [cueIndex],
  );

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muteOriginal;
    video.volume =
      playingDub && originalMixVolume > 0
        ? Math.min(1, volume * originalMixVolume)
        : volume;
  }, [volume, playingDub, muteOriginal, originalMixVolume]);
  useEffect(() => {
    const video = videoRef.current;
    const audio = dubAudioRef.current;
    if (!video || !audio) return;
    audio.pause();
    if (audioMode !== "dubbed" || !dubAudioUrl) return;
    audio.currentTime = video.currentTime;
    if (!video.paused) void audio.play().catch(() => undefined);
  }, [audioMode, dubAudioUrl]);
  useEffect(() => {
    if (dubAudioRef.current) dubAudioRef.current.volume = volume;
  }, [dubAudioUrl, volume]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      if (stageResizeTimerRef.current !== undefined)
        window.clearTimeout(stageResizeTimerRef.current);
      const nextWidth = entry?.contentRect.width || stage.clientWidth || 960;
      stageResizeTimerRef.current = window.setTimeout(() => {
        stageResizeTimerRef.current = undefined;
        setStageWidth(nextWidth);
      }, 90);
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      if (stageResizeTimerRef.current !== undefined)
        window.clearTimeout(stageResizeTimerRef.current);
      stageResizeTimerRef.current = undefined;
    };
  }, []);
  useEffect(() => {
    videoPanDragRef.current = undefined;
    setVideoPanDrag(undefined);
    setVideoZoom(1);
    setVideoPan({ x: 0, y: 0 });
    setVideoSize({ width: 16, height: 9 });
    setContextMenu(undefined);
  }, [asset?.url]);
  useEffect(() => {
    videoRef.current?.pause();
    dubAudioRef.current?.pause();
    setPlaying(false);
    setTime(0);
    setDuration(asset?.durationMs || 0);
    syncActiveCue(0);
  }, [asset?.url, asset?.durationMs, syncActiveCue]);
  useEffect(() => {
    // A new canvas ratio gets a predictable fitted starting view. The user can
    // then zoom and pan it again without carrying offsets from the old frame.
    videoPanDragRef.current = undefined;
    setVideoPanDrag(undefined);
    setVideoZoom(1);
    setVideoPan({ x: 0, y: 0 });
    setAlignmentGuides({});
  }, [effectiveVideoEdit.aspectRatio]);
  useEffect(() => {
    if (!blurEditMode) setActiveBlurId(undefined);
  }, [blurEditMode]);
  useEffect(
    () =>
      listenForOtherDropdowns(volumeDropdownId.current, () =>
        setVolumeOpen(false),
      ),
    [],
  );
  useEffect(() => {
    const close = (event: globalThis.PointerEvent) => {
      if (!volumeControlRef.current?.contains(event.target as Node))
        setVolumeOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    const close = (event: globalThis.PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node))
        setContextMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(undefined);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  useEffect(() => {
    if (!blurEditMode) return;
    const clearSelectionOutsideRegion = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !target.closest(
          ".video-stage .blur-overlay-selectable, .video-stage .blur-overlay-editable",
        )
      )
        setActiveBlurId(undefined);
    };
    document.addEventListener("pointerdown", clearSelectionOutsideRegion, true);
    return () =>
      document.removeEventListener(
        "pointerdown",
        clearSelectionOutsideRegion,
        true,
      );
  }, [blurEditMode]);
  useEffect(
    () => () => {
      if (subtitleFrameRef.current !== undefined)
        cancelAnimationFrame(subtitleFrameRef.current);
      if (blurFrameRef.current !== undefined)
        cancelAnimationFrame(blurFrameRef.current);
    },
    [],
  );
  useEffect(() => {
    onActiveCueChange?.(activeCueId);
  }, [activeCueId, onActiveCueChange]);
  useEffect(() => {
    syncActiveCue((videoRef.current?.currentTime || 0) * 1000);
  }, [syncActiveCue]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof video.requestVideoFrameCallback !== "function") return;
    let frameId = 0;
    let cancelled = false;
    const updateActiveCue: VideoFrameRequestCallback = (_now, metadata) => {
      syncActiveCue(metadata.mediaTime * 1000);
      const audio = dubAudioRef.current;
      if (
        playingDub &&
        audio &&
        !audio.paused &&
        dubAudioNeedsResync(metadata.mediaTime, audioRefTime(audio))
      )
        audio.currentTime = metadata.mediaTime;
      if (!cancelled)
        frameId = video.requestVideoFrameCallback(updateActiveCue);
    };
    frameId = video.requestVideoFrameCallback(updateActiveCue);
    return () => {
      cancelled = true;
      video.cancelVideoFrameCallback(frameId);
    };
  }, [asset?.url, playingDub, syncActiveCue]);
  useEffect(() => {
    if (!videoRef.current || !seekRequest) return;
    const next = seekRequest.timeMs / 1000;
    setTime(seekRequest.timeMs);
    syncActiveCue(seekRequest.timeMs);
    if (Math.abs(videoRef.current.currentTime - next) > 0.001)
      videoRef.current.currentTime = next;
    if (audioMode === "dubbed" && dubAudioUrl && dubAudioRef.current)
      dubAudioRef.current.currentTime = next;
  }, [seekRequest?.id, audioMode, dubAudioUrl, syncActiveCue]);

  const toggle = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const audio = dubAudioRef.current;
    if (video.paused) {
      if (
        !Number.isFinite(video.currentTime) ||
        video.currentTime * 1000 < effectiveVideoEdit.trimStartMs ||
        (effectiveVideoEdit.trimEndMs &&
          video.currentTime * 1000 >= effectiveVideoEdit.trimEndMs)
      )
        video.currentTime = effectiveVideoEdit.trimStartMs / 1000;
      if (audioMode === "dubbed" && dubAudioUrl && audio) {
        audio.pause();
        audio.currentTime = video.currentTime;
      }
      void video
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      video.pause();
      audio?.pause();
      setPlaying(false);
    }
  };
  const reportTime = (next: number) => {
    setTime(next);
    syncActiveCue(next);
    if (
      audioMode === "dubbed" &&
      dubAudioUrl &&
      dubAudioRef.current &&
      !dubAudioRef.current.paused &&
      dubAudioNeedsResync(next / 1000, audioRefTime(dubAudioRef.current))
    )
      dubAudioRef.current.currentTime = next / 1000;
    onTime?.(next);
  };
  const seek = (next: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = next / 1000;
    if (audioMode === "dubbed" && dubAudioUrl && dubAudioRef.current)
      dubAudioRef.current.currentTime = next / 1000;
    reportTime(next);
  };
  const syncVideoDuration = (video: HTMLVideoElement) => {
    const nextDuration = videoDurationMs(video);
    if (nextDuration === undefined) return;
    setDuration((current) =>
      Math.abs(current - nextDuration) < 0.5 ? current : nextDuration,
    );
  };
  const beginRoiDrag = (event: PointerEvent<HTMLElement>, kind: DragKind) => {
    if (!roi || !onRoiChange) return;
    event.preventDefault();
    event.stopPropagation();
    stageRef.current?.setPointerCapture?.(event.pointerId);
    setRoiDrag({
      kind,
      startX: event.clientX,
      startY: event.clientY,
      origin: roi,
    });
  };
  const beginBlurDrag = (
    event: PointerEvent<HTMLElement>,
    region: BlurRegion,
    kind: DragKind,
  ) => {
    if (!blurEditMode || !onBlurRegionsChange) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveBlurId(region.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setBlurDrag({
      kind,
      startX: event.clientX,
      startY: event.clientY,
      origin: region,
    });
  };
  const beginSubtitleDrag = (event: PointerEvent<HTMLElement>) => {
    if (!onStyleChange) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = style.position === "custom" ? (style.customX ?? 50) : 50;
    const originY =
      style.position === "top"
        ? 12
        : style.position === "middle"
          ? 50
          : style.position === "bottom"
            ? 82
            : (style.customY ?? 82);
    if (style.position !== "custom")
      onStyleChange({ position: "custom", customX: originX, customY: originY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSubtitleDrag({
      startX: event.clientX,
      startY: event.clientY,
      originX,
      originY,
    });
  };
  const clearBlurSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (!blurEditMode) return;
    const target = event.target as Element;
    if (
      !target.closest?.(
        ".blur-overlay-selectable, .blur-overlay-editable, .subtitle-overlay",
      )
    )
      setActiveBlurId(undefined);
  };
  const zoomVideo = (event: globalThis.WheelEvent) => {
    if (!asset || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawNextZoom = clamp(
      videoZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
      0.5,
      4,
    );
    const crossesOne =
      (videoZoom < 1 && rawNextZoom > 1) || (videoZoom > 1 && rawNextZoom < 1);
    const nextZoom =
      crossesOne || Math.abs(rawNextZoom - 1) <= 0.045 ? 1 : rawNextZoom;
    if (nextZoom === 1) {
      setVideoZoom(1);
      setVideoPan({ x: 0, y: 0 });
      setAlignmentGuides({});
      return;
    }
    const localX = event.clientX - rect.left - rect.width / 2;
    const localY = event.clientY - rect.top - rect.height / 2;
    const ratio = nextZoom / videoZoom;
    setVideoPan((current) => ({
      x: current.x * ratio + localX * (1 - ratio),
      y: current.y * ratio + localY * (1 - ratio),
    }));
    setVideoZoom(nextZoom);
  };
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const onWheelCapture = (event: globalThis.WheelEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        !workspace.contains(target) ||
        (!event.ctrlKey && !event.metaKey)
      )
        return;
      zoomVideo(event);
    };
    window.addEventListener("wheel", onWheelCapture, {
      passive: false,
      capture: true,
    });
    return () =>
      window.removeEventListener("wheel", onWheelCapture, { capture: true });
  }, [asset?.url, videoZoom]);
  const beginVideoPan = (event: PointerEvent<HTMLElement>) => {
    if (!asset || blurEditMode || roi || Math.abs(videoZoom - 1) < 0.01) return;
    event.preventDefault();
    event.stopPropagation();
    // Capture on the immutable stage instead of the transformed media child.
    // This keeps the gesture alive when the zoomed scene extends outside its
    // original frame or the pointer crosses an overlay.
    stageRef.current?.setPointerCapture?.(event.pointerId);
    const drag = {
      startX: event.clientX,
      startY: event.clientY,
      originX: videoPan.x,
      originY: videoPan.y,
    };
    videoPanDragRef.current = drag;
    setVideoPanDrag(drag);
  };
  const beginCanvasInteraction = (event: PointerEvent<HTMLDivElement>) => {
    clearBlurSelection(event);
    const target = event.target as Element;
    if (
      target.closest(
        ".subtitle-overlay, .blur-overlay, .roi-box, .logo-overlay, .video-context-menu",
      )
    )
      return;
    beginVideoPan(event);
  };
  const showContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!asset) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      x: clamp(event.clientX - rect.left, 8, rect.width - 224),
      y: clamp(event.clientY - rect.top, 8, rect.height - 260),
    });
  };
  const patchVideoEdit = (patch: Partial<VideoEditState>) => {
    const next = { ...effectiveVideoEdit, ...patch };
    next.trimStartMs = Math.max(0, Math.round(next.trimStartMs || 0));
    if (next.trimEndMs !== undefined)
      next.trimEndMs = Math.max(0, Math.round(next.trimEndMs));
    if (next.trimEndMs !== undefined && next.trimEndMs <= next.trimStartMs) {
      if (patch.trimStartMs !== undefined) next.trimEndMs = undefined;
      else return;
    }
    if (onVideoEditChange) onVideoEditChange(next);
    else setInternalVideoEdit(next);
  };
  const resetVideoView = () => {
    videoPanDragRef.current = undefined;
    setVideoPanDrag(undefined);
    setVideoZoom(1);
    setVideoPan({ x: 0, y: 0 });
    setAlignmentGuides({});
  };
  const openTrim = () => {
    videoRef.current?.pause();
    dubAudioRef.current?.pause();
    setPlaying(false);
    setContextMenu(undefined);
    setTrimOpen(true);
  };
  const openCrop = () => {
    videoRef.current?.pause();
    dubAudioRef.current?.pause();
    setPlaying(false);
    setContextMenu(undefined);
    setCropOpen(true);
  };
  const beginLogoDrag = (event: PointerEvent<HTMLElement>) => {
    if (!logo?.enabled || !onLogoChange || !stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (logo.position !== "custom") onLogoChange({ position: "custom" });
    const rect = stageRef.current.getBoundingClientRect();
    stageRef.current.setPointerCapture?.(event.pointerId);
    const drag = {
      startX: event.clientX,
      startY: event.clientY,
      originX: logo.xPercent,
      originY: logo.yPercent,
      widthPercent: logo.widthPercent,
      stageWidth: rect.width * videoZoom,
      stageHeight: rect.height * videoZoom,
    };
    logoDragRef.current = drag;
    setLogoDrag(drag);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const activeVideoPanDrag = videoPanDragRef.current;
    if (activeVideoPanDrag) {
      event.preventDefault();
      const rawX =
        activeVideoPanDrag.originX + event.clientX - activeVideoPanDrag.startX;
      const rawY =
        activeVideoPanDrag.originY + event.clientY - activeVideoPanDrag.startY;
      const snapX = Math.abs(rawX) <= VIDEO_CENTER_SNAP_PX;
      const snapY = Math.abs(rawY) <= VIDEO_CENTER_SNAP_PX;
      setVideoPan({ x: snapX ? 0 : rawX, y: snapY ? 0 : rawY });
      setAlignmentGuides({
        x: snapX ? { value: 50, label: "Căn giữa video" } : undefined,
        y: snapY ? { value: 50, label: "Căn giữa video" } : undefined,
      });
    }
    if (roi && onRoiChange && roiDrag) {
      const dx =
        ((event.clientX - roiDrag.startX) / (rect.width * videoZoom)) * 100;
      const dy =
        ((event.clientY - roiDrag.startY) / (rect.height * videoZoom)) * 100;
      onRoiChange(patchRect(roiDrag.origin, roiDrag.kind, dx, dy));
    }
    if (blurDrag) {
      const dx =
        ((event.clientX - blurDrag.startX) / (rect.width * videoZoom)) * 100;
      const dy =
        ((event.clientY - blurDrag.startY) / (rect.height * videoZoom)) * 100;
      const next = patchRect(
        {
          x: blurDrag.origin.xPercent,
          y: blurDrag.origin.yPercent,
          w: blurDrag.origin.widthPercent,
          h: blurDrag.origin.heightPercent,
        },
        blurDrag.kind,
        dx,
        dy,
      );
      const thresholdX = Math.max(
        0.65,
        (9 / Math.max(rect.width * videoZoom, 1)) * 100,
      );
      const thresholdY = Math.max(
        0.65,
        (9 / Math.max(rect.height * videoZoom, 1)) * 100,
      );
      const subtitleX =
        style.position === "custom" ? (style.customX ?? 50) : 50;
      const subtitleY =
        style.position === "top"
          ? 12
          : style.position === "middle"
            ? 50
            : style.position === "bottom"
              ? 82
              : (style.customY ?? 82);
      const xTargets: AlignmentGuide[] = [
        { value: 50, label: "Giữa khung" },
        { value: subtitleX, label: "Giữa phụ đề" },
        ...blurRegions
          .filter((region) => region.id !== blurDrag.origin.id)
          .map((region, index) => ({
            value: region.xPercent + region.widthPercent / 2,
            label: `Giữa blur ${index + 1}`,
          })),
      ];
      const yTargets: AlignmentGuide[] = [
        { value: 50, label: "Giữa khung" },
        { value: subtitleY, label: "Giữa phụ đề" },
        ...blurRegions
          .filter((region) => region.id !== blurDrag.origin.id)
          .map((region, index) => ({
            value: region.yPercent + region.heightPercent / 2,
            label: `Giữa blur ${index + 1}`,
          })),
      ];
      const snappedX =
        blurDrag.kind === "move"
          ? nearestGuide(next.x + next.w / 2, xTargets, thresholdX)
          : undefined;
      const snappedY =
        blurDrag.kind === "move"
          ? nearestGuide(next.y + next.h / 2, yTargets, thresholdY)
          : undefined;
      const snappedRect = {
        ...next,
        x: snappedX
          ? clamp(snappedX.value - next.w / 2, 0, 100 - next.w)
          : next.x,
        y: snappedY
          ? clamp(snappedY.value - next.h / 2, 0, 100 - next.h)
          : next.y,
      };
      if (blurDrag.kind === "move")
        setAlignmentGuides({ x: snappedX, y: snappedY });
      const nextRegion = {
        ...blurDrag.origin,
        xPercent: snappedRect.x,
        yPercent: snappedRect.y,
        widthPercent: snappedRect.w,
        heightPercent: snappedRect.h,
      };
      pendingBlurRegionRef.current = nextRegion;
      if (blurFrameRef.current === undefined) {
        blurFrameRef.current = requestAnimationFrame(() => {
          blurFrameRef.current = undefined;
          if (pendingBlurRegionRef.current)
            setDraftBlurRegion(pendingBlurRegionRef.current);
        });
      }
    }
    if (subtitleDrag) {
      const dx =
        ((event.clientX - subtitleDrag.startX) / (rect.width * videoZoom)) *
        100;
      const dy =
        ((event.clientY - subtitleDrag.startY) / (rect.height * videoZoom)) *
        100;
      const rawPosition = {
        x: clamp(subtitleDrag.originX + dx, 5, 95),
        y: clamp(subtitleDrag.originY + dy, 5, 95),
      };
      const xTargets: AlignmentGuide[] = [
        { value: 50, label: "Giữa khung" },
        ...blurRegions.map((region, index) => ({
          value: region.xPercent + region.widthPercent / 2,
          label: `Giữa blur ${index + 1}`,
        })),
      ];
      const yTargets: AlignmentGuide[] = [
        { value: 50, label: "Giữa khung" },
        ...blurRegions.map((region, index) => ({
          value: region.yPercent + region.heightPercent / 2,
          label: `Giữa blur ${index + 1}`,
        })),
      ];
      const thresholdX = Math.max(
        0.65,
        (9 / Math.max(rect.width * videoZoom, 1)) * 100,
      );
      const thresholdY = Math.max(
        0.65,
        (9 / Math.max(rect.height * videoZoom, 1)) * 100,
      );
      const snappedX = nearestGuide(rawPosition.x, xTargets, thresholdX);
      const snappedY = nearestGuide(rawPosition.y, yTargets, thresholdY);
      const nextPosition = {
        x: snappedX?.value ?? rawPosition.x,
        y: snappedY?.value ?? rawPosition.y,
      };
      setAlignmentGuides({ x: snappedX, y: snappedY });
      pendingSubtitlePositionRef.current = nextPosition;
      if (subtitleFrameRef.current === undefined) {
        subtitleFrameRef.current = requestAnimationFrame(() => {
          subtitleFrameRef.current = undefined;
          if (pendingSubtitlePositionRef.current)
            setDraftSubtitlePosition(pendingSubtitlePositionRef.current);
        });
      }
    }
    const activeLogoDrag = logoDragRef.current;
    if (onLogoChange && activeLogoDrag) {
      const dx =
        ((event.clientX - activeLogoDrag.startX) / activeLogoDrag.stageWidth) *
        100;
      const dy =
        ((event.clientY - activeLogoDrag.startY) / activeLogoDrag.stageHeight) *
        100;
      activeLogoDrag.pendingX = clamp(
        activeLogoDrag.originX + dx,
        0,
        100 - activeLogoDrag.widthPercent,
      );
      activeLogoDrag.pendingY = clamp(activeLogoDrag.originY + dy, 0, 95);
      if (activeLogoDrag.frame === undefined) {
        activeLogoDrag.frame = requestAnimationFrame(() => {
          const drag = logoDragRef.current;
          if (!drag) return;
          drag.frame = undefined;
          if (
            typeof drag.pendingX === "number" &&
            typeof drag.pendingY === "number"
          ) {
            onLogoChange({ xPercent: drag.pendingX, yPercent: drag.pendingY });
            drag.pendingX = undefined;
            drag.pendingY = undefined;
          }
        });
      }
    }
  };
  const stopDrag = (event?: PointerEvent<HTMLDivElement>) => {
    if (event && stageRef.current?.hasPointerCapture(event.pointerId))
      stageRef.current.releasePointerCapture(event.pointerId);
    if (blurFrameRef.current !== undefined) {
      cancelAnimationFrame(blurFrameRef.current);
      blurFrameRef.current = undefined;
    }
    const finalBlurRegion = pendingBlurRegionRef.current || draftBlurRegion;
    if (onBlurRegionsChange && blurDrag && finalBlurRegion)
      onBlurRegionsChange(
        blurRegions.map((region) =>
          region.id === finalBlurRegion.id ? finalBlurRegion : region,
        ),
      );
    pendingBlurRegionRef.current = undefined;
    setDraftBlurRegion(undefined);
    if (subtitleFrameRef.current !== undefined) {
      cancelAnimationFrame(subtitleFrameRef.current);
      subtitleFrameRef.current = undefined;
    }
    const finalSubtitlePosition =
      pendingSubtitlePositionRef.current || draftSubtitlePosition;
    if (onStyleChange && subtitleDrag && finalSubtitlePosition)
      onStyleChange({
        customX: finalSubtitlePosition.x,
        customY: finalSubtitlePosition.y,
      });
    pendingSubtitlePositionRef.current = undefined;
    setDraftSubtitlePosition(undefined);
    setAlignmentGuides({});
    const drag = logoDragRef.current;
    if (drag) {
      if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
      if (
        onLogoChange &&
        typeof drag.pendingX === "number" &&
        typeof drag.pendingY === "number"
      )
        onLogoChange({ xPercent: drag.pendingX, yPercent: drag.pendingY });
    }
    logoDragRef.current = undefined;
    videoPanDragRef.current = undefined;
    setRoiDrag(undefined);
    setBlurDrag(undefined);
    setSubtitleDrag(undefined);
    setLogoDrag(undefined);
    setVideoPanDrag(undefined);
  };
  const previewScale = stageWidth / 1920;
  const previewStyle =
    draftSubtitlePosition && style.position === "custom"
      ? {
          ...style,
          customX: draftSubtitlePosition.x,
          customY: draftSubtitlePosition.y,
        }
      : style;
  const outlineWidth =
    previewStyle.background === "outline"
      ? Math.max(0, (previewStyle.outlineWidth ?? 2) * previewScale)
      : 0;
  const boxColor = previewStyle.backgroundColor ?? previewStyle.outlineColor;
  const boxOpacity = previewStyle.backgroundOpacity ?? 0.72;
  const subtitleStyle: CSSProperties = {
    fontFamily: previewStyle.fontFamily,
    fontSize: `${Math.max(previewStyle.fontSize * previewScale, 10)}px`,
    color: previewStyle.textColor,
    fontWeight: previewStyle.bold === true ? 700 : 400,
    fontStyle: previewStyle.italic === true ? "italic" : "normal",
    WebkitTextFillColor: previewStyle.textColor,
    WebkitTextStroke:
      outlineWidth > 0
        ? `${outlineWidth}px ${previewStyle.outlineColor}`
        : "0 transparent",
    paintOrder: "stroke fill",
    background:
      previewStyle.background === "box"
        ? `${boxColor}${Math.round(boxOpacity * 255)
            .toString(16)
            .padStart(2, "0")}`
        : "transparent",
    ...(previewStyle.position === "custom"
      ? {
          left: `${previewStyle.customX ?? 50}%`,
          top: `${previewStyle.customY ?? 82}%`,
          right: "auto",
          bottom: "auto",
          width: "84%",
          maxWidth: "84%",
          boxSizing: "border-box",
          transform: "translate(-50%, -50%)",
          pointerEvents: "auto",
          cursor: subtitleDrag ? "grabbing" : "grab",
          userSelect: "none",
          touchAction: "none",
        }
      : {}),
  };

  const aspectRatio =
    effectiveVideoEdit.aspectRatio === "original"
      ? "16 / 9"
      : effectiveVideoEdit.aspectRatio.replace(":", " / ");
  const canvasWidth =
    effectiveVideoEdit.aspectRatio === "9:16"
      ? "min(100%, 39.375vh)"
      : effectiveVideoEdit.aspectRatio === "4:5"
        ? "min(100%, 56vh)"
        : effectiveVideoEdit.aspectRatio === "1:1"
          ? "min(100%, 70vh)"
          : "100%";
  // Changing the output aspect ratio changes the canvas only. The source is
  // letterboxed/pillarboxed until the user explicitly applies a crop.
  const displayCrop = effectiveVideoEdit.crop;
  const mediaCropStyle = cropVideoStyle(displayCrop);
  return (
    <>
      <div className="video-player">
        {dubAudioUrl && (
          <audio
            ref={dubAudioRef}
            className="preview-dub-audio"
            src={dubAudioUrl}
            preload="auto"
            aria-hidden="true"
          />
        )}
        <div ref={workspaceRef} className="video-workspace">
          <div
            ref={stageRef}
            className={`video-stage video-canvas aspect-${effectiveVideoEdit.aspectRatio.replace(":", "-")} ${blurEditMode ? "blur-edit-stage" : ""} ${Math.abs(videoZoom - 1) >= 0.01 ? "can-pan" : ""} ${videoPanDrag ? "is-panning" : ""}`}
            style={{ aspectRatio, width: canvasWidth }}
            onContextMenu={showContextMenu}
            onPointerDown={beginCanvasInteraction}
            onPointerMove={move}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          >
            <div
              className="video-scene-layer"
              style={{
                transform: `translate3d(${videoPan.x}px, ${videoPan.y}px, 0) scale(${videoZoom})`,
              }}
            >
              {asset ? (
                <div className="video-media-layer">
                  <div className="video-crop-viewport">
                    <video
                      key={asset.url}
                      ref={videoRef}
                      src={asset.url}
                      style={mediaCropStyle}
                      onLoadedMetadata={(event) => {
                        syncVideoDuration(event.currentTarget);
                        setVideoSize({
                          width: event.currentTarget.videoWidth || 16,
                          height: event.currentTarget.videoHeight || 9,
                        });
                      }}
                      onDurationChange={(event) =>
                        syncVideoDuration(event.currentTarget)
                      }
                      onTimeUpdate={(event) => {
                        syncVideoDuration(event.currentTarget);
                        const next = event.currentTarget.currentTime * 1000;
                        if (
                          effectiveVideoEdit.trimEndMs &&
                          next >= effectiveVideoEdit.trimEndMs
                        ) {
                          event.currentTarget.pause();
                          dubAudioRef.current?.pause();
                          setPlaying(false);
                          seek(effectiveVideoEdit.trimEndMs);
                          return;
                        }
                        reportTime(next);
                      }}
                      onPlaying={(event) => {
                        setPlaying(true);
                        const audio = dubAudioRef.current;
                        if (!playingDub || !audio) return;
                        audio.pause();
                        audio.currentTime = event.currentTarget.currentTime;
                        audio.playbackRate = event.currentTarget.playbackRate;
                        void audio.play().catch(() => undefined);
                      }}
                      onWaiting={() => dubAudioRef.current?.pause()}
                      onStalled={() => dubAudioRef.current?.pause()}
                      onSeeking={() => dubAudioRef.current?.pause()}
                      onSeeked={(event) => {
                        const audio = dubAudioRef.current;
                        if (!playingDub || !audio) return;
                        audio.currentTime = event.currentTarget.currentTime;
                        if (!event.currentTarget.paused)
                          void audio.play().catch(() => undefined);
                      }}
                      onRateChange={(event) => {
                        if (dubAudioRef.current)
                          dubAudioRef.current.playbackRate =
                            event.currentTarget.playbackRate;
                      }}
                      onPause={() => {
                        dubAudioRef.current?.pause();
                        setPlaying(false);
                      }}
                      onEnded={() => {
                        dubAudioRef.current?.pause();
                        setPlaying(false);
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="video-empty">
                  <div className="reel-icon">✦</div>
                  <span>Chưa có video preview</span>
                  <small>Thêm video ở Trích xuất hoặc Editor</small>
                </div>
              )}
              {asset && logo?.enabled && (
                <>
                  {logo.kind === "image" && logo.url ? (
                    <img
                      className="logo-overlay"
                      src={logo.url}
                      alt={logo.name}
                      draggable={false}
                      onPointerDown={beginLogoDrag}
                      style={{
                        left: `${logo.xPercent}%`,
                        top: `${logo.yPercent}%`,
                        width: `${logo.widthPercent}%`,
                        opacity: logo.opacity,
                        pointerEvents: "auto",
                        cursor: logoDrag ? "grabbing" : "grab",
                      }}
                    />
                  ) : (
                    logo.kind === "text" && (
                      <div
                        className="logo-overlay logo-text-overlay"
                        onPointerDown={beginLogoDrag}
                        style={{
                          left: `${logo.xPercent}%`,
                          top: `${logo.yPercent}%`,
                          width: `${logo.widthPercent}%`,
                          opacity: logo.opacity,
                          color: logo.textColor,
                          fontFamily: logo.fontFamily,
                          fontSize: `${logo.fontSize}px`,
                          textShadow: `1px 1px 0 ${logo.outlineColor}, -1px -1px 0 ${logo.outlineColor}`,
                          pointerEvents: "auto",
                          cursor: logoDrag ? "grabbing" : "grab",
                        }}
                      >
                        {logo.text}
                      </div>
                    )
                  )}
                </>
              )}
              {asset && activeCue && style.visible && (
                <div
                  className={`subtitle-overlay ${style.position}`}
                  onPointerDown={beginSubtitleDrag}
                  style={subtitleStyle}
                >
                  {style.content === "original" ? (
                    activeCue.originalText
                  ) : style.content === "both" ? (
                    <>
                      <span>{activeCue.originalText}</span>
                      <br />
                      <span>{activeCue.translatedText}</span>
                    </>
                  ) : (
                    activeCue.translatedText || activeCue.originalText
                  )}
                </div>
              )}
              {blurRegions.map((region, index) => {
                const previewRegion =
                  draftBlurRegion?.id === region.id ? draftBlurRegion : region;
                const selectedBlur = activeBlurId === region.id;
                return (
                  <div
                    key={region.id}
                    className={`blur-overlay ${blurEditMode ? (selectedBlur ? "blur-overlay-editable selected" : "blur-overlay-selectable") : ""}`}
                    style={blurRegionPreviewStyle(previewRegion, previewScale)}
                    onPointerDown={(event) =>
                      beginBlurDrag(event, previewRegion, "move")
                    }
                  >
                    <span>{selectedBlur ? `BLUR ${index + 1}` : ""}</span>
                    {selectedBlur && (
                      <>
                        <i
                          className="roi-handle nw"
                          onPointerDown={(event) =>
                            beginBlurDrag(event, previewRegion, "nw")
                          }
                        />
                        <i
                          className="roi-handle ne"
                          onPointerDown={(event) =>
                            beginBlurDrag(event, previewRegion, "ne")
                          }
                        />
                        <i
                          className="roi-handle sw"
                          onPointerDown={(event) =>
                            beginBlurDrag(event, previewRegion, "sw")
                          }
                        />
                        <i
                          className="roi-handle se"
                          onPointerDown={(event) =>
                            beginBlurDrag(event, previewRegion, "se")
                          }
                        />
                      </>
                    )}
                  </div>
                );
              })}
              {roi && (
                <div
                  className="roi-box"
                  style={{
                    left: `${roi.x}%`,
                    top: `${roi.y}%`,
                    width: `${roi.w}%`,
                    height: `${roi.h}%`,
                  }}
                  onPointerDown={(event) => beginRoiDrag(event, "move")}
                >
                  <span>OCR REGION</span>
                  <i
                    className="roi-handle nw"
                    onPointerDown={(event) => beginRoiDrag(event, "nw")}
                  />
                  <i
                    className="roi-handle ne"
                    onPointerDown={(event) => beginRoiDrag(event, "ne")}
                  />
                  <i
                    className="roi-handle sw"
                    onPointerDown={(event) => beginRoiDrag(event, "sw")}
                  />
                  <i
                    className="roi-handle se"
                    onPointerDown={(event) => beginRoiDrag(event, "se")}
                  />
                </div>
              )}
              {alignmentGuides.x && (
                <div
                  className="alignment-guide vertical"
                  style={{ left: `${alignmentGuides.x.value}%` }}
                >
                  <span>{alignmentGuides.x.label}</span>
                </div>
              )}
              {alignmentGuides.y && (
                <div
                  className="alignment-guide horizontal"
                  style={{ top: `${alignmentGuides.y.value}%` }}
                >
                  <span>{alignmentGuides.y.label}</span>
                </div>
              )}
            </div>
            {asset && (
              <div className="video-zoom-hud">
                {Math.round(videoZoom * 100)}%
              </div>
            )}
            {contextMenu && (
              <div
                ref={contextMenuRef}
                className="video-context-menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span>KHUNG HÌNH</span>
                <div className="video-context-ratios">
                  {(
                    [
                      "original",
                      "16:9",
                      "9:16",
                      "1:1",
                      "4:5",
                    ] as VideoAspectRatio[]
                  ).map((ratio) => (
                    <button
                      key={ratio}
                      className={
                        effectiveVideoEdit.aspectRatio === ratio ? "active" : ""
                      }
                      onClick={() => {
                        patchVideoEdit({ aspectRatio: ratio, crop: undefined });
                        setContextMenu(undefined);
                      }}
                    >
                      {ratio === "original" ? "Gốc" : ratio}
                    </button>
                  ))}
                </div>
                <span>CHỈNH SỬA KHÔNG PHÁ HỦY</span>
                <button className="video-context-action" onClick={openCrop}>
                  <CropIcon size={13} /> <span>Crop khung hình…</span>
                  {effectiveVideoEdit.crop && (
                    <small>
                      {effectiveVideoEdit.crop.widthPercent.toFixed(1)}% ×{" "}
                      {effectiveVideoEdit.crop.heightPercent.toFixed(1)}%
                    </small>
                  )}
                </button>
                <button className="video-context-action" onClick={openTrim}>
                  <Scissors size={13} /> <span>Cắt thời lượng…</span>
                  {(effectiveVideoEdit.trimStartMs > 0 ||
                    effectiveVideoEdit.trimEndMs !== undefined) && (
                    <small>
                      {formatClock(effectiveVideoEdit.trimStartMs)} –{" "}
                      {formatClock(effectiveVideoEdit.trimEndMs ?? duration)}
                    </small>
                  )}
                </button>
                <button
                  onClick={() => {
                    resetVideoView();
                    setContextMenu(undefined);
                  }}
                >
                  Đặt lại zoom / vị trí
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="video-controls">
          <button className="play-button" onClick={toggle} disabled={!asset}>
            {playing ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
          </button>
          <span className="timecode">{formatClock(time)}</span>
          <RangeInput
            className="seekbar"
            min={effectiveVideoEdit.trimStartMs}
            max={effectiveVideoEdit.trimEndMs || duration || 1}
            value={clamp(
              time,
              effectiveVideoEdit.trimStartMs,
              effectiveVideoEdit.trimEndMs || duration || 1,
            )}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="timecode muted">
            {formatClock(effectiveVideoEdit.trimEndMs || duration)}
          </span>
          <div className="volume-control" ref={volumeControlRef}>
            <button
              className="volume-button"
              onClick={() => {
                if (!volumeOpen) announceDropdownOpen(volumeDropdownId.current);
                setVolumeOpen((value) => !value);
              }}
              aria-label="Điều chỉnh âm lượng"
            >
              <Volume2 size={15} />
            </button>
            {volumeOpen && (
              <div className="volume-popover">
                <div className="volume-popover-head">
                  <span>Âm lượng</span>
                  <b>{Math.round(volume * 100)}%</b>
                </div>
                <RangeInput
                  className="volume-popover-range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
              </div>
            )}
          </div>
          <button
            className="icon-button"
            onClick={() => void stageRef.current?.requestFullscreen?.()}
            aria-label="Toàn màn hình"
          >
            <Maximize size={15} />
          </button>
        </div>
      </div>
      <VideoTrimModal
        open={trimOpen}
        asset={asset}
        durationMs={duration}
        value={effectiveVideoEdit}
        onClose={() => setTrimOpen(false)}
        onApply={(trim) => {
          patchVideoEdit(trim);
          if (
            time < trim.trimStartMs ||
            (trim.trimEndMs !== undefined && time > trim.trimEndMs)
          )
            seek(trim.trimStartMs);
          setTrimOpen(false);
        }}
      />
      <VideoCropModal
        open={cropOpen}
        asset={asset}
        currentTimeMs={time}
        value={effectiveVideoEdit}
        onClose={() => setCropOpen(false)}
        onApply={(next) => {
          patchVideoEdit(next);
          resetVideoView();
          setCropOpen(false);
        }}
      />
    </>
  );
}
