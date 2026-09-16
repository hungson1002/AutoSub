import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SubtitleCue, SubtitleStyle } from "../types";
import { ChevronLeft, ChevronRight, Copy, Magnet, Maximize2, Minus, Plus, Redo2, Scissors, Trash2, Type, Undo2 } from "../components/Icons";
import { formatClock } from "../lib/subtitles";
import {
  copyCueProperties,
  editTimelineCue,
  layoutTimelineCues,
  pasteCueProperties,
  selectCuePropertyGroups,
  timelineTickSeconds,
  type CuePropertyClipboard,
  type CuePropertyGroup,
  type TimelineCueEditMode,
} from "../lib/subtitleTimeline";

type CueRange = Pick<SubtitleCue, "startMs" | "endMs" | "timelineLane">;
type DragState = CueRange & { cueId: string; mode: TimelineCueEditMode; pointerX: number; pointerY: number; originLane: number };
type HistoryEntry = { cueId: string; before: CueRange; after: CueRange };
type Marquee = { startX: number; startY: number; x: number; y: number };

type Props = {
  cues: SubtitleCue[];
  timeMs: number;
  durationMs: number;
  activeCueId?: string;
  selectedCueId?: string;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<SubtitleCue>) => void;
  onSeek: (timeMs: number) => void;
  onAddText?: (timeMs: number) => void;
  onSplit?: (timeMs: number) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onDeleteMany?: (ids: string[]) => void;
  baseStyle: SubtitleStyle;
};

type CueMenu = { x: number; y: number; cueId: string; view: "root" | "copy" | "paste" };
const COPY_GROUPS: Array<{ id: Exclude<CuePropertyGroup, "all">; label: string; detail: string }> = [
  { id: "position", label: "Vị trí", detail: "Tọa độ X / Y trên khung hình" },
  { id: "typography", label: "Font & kiểu chữ", detail: "Font, đậm và nghiêng" },
  { id: "size", label: "Cỡ chữ", detail: "Kích thước văn bản" },
  { id: "color", label: "Màu chữ", detail: "Màu phần chữ chính" },
  { id: "frame", label: "Viền, khung & padding", detail: "Nền, viền và khoảng đệm" },
];

const MIN_PIXELS_PER_SECOND = 0.02;
const MAX_PIXELS_PER_SECOND = 220;
const LANE_HEIGHT = 32;
const MAX_HISTORY = 150;
const EMPTY_TRACK_LABELS = ["TEXT", "OCR", "SUB", "SUB"];

export function SubtitleTimeline({ cues, timeMs, durationMs, activeCueId, selectedCueId, onSelect, onChange, onSeek, onAddText, onSplit, onDuplicate, onDelete, onDeleteMany, baseStyle }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<(CueRange & { cueId: string }) | undefined>(undefined);
  const cueElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const dragFrameRef = useRef<number | undefined>(undefined);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(70);
  const [drag, setDrag] = useState<DragState>();
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [history, setHistory] = useState<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const [propertyClipboard, setPropertyClipboard] = useState<CuePropertyClipboard>();
  const [cueMenu, setCueMenu] = useState<CueMenu>();
  const [copyGroups, setCopyGroups] = useState<Set<Exclude<CuePropertyGroup, "all">>>(() => new Set(COPY_GROUPS.map((group) => group.id)));
  const [pasteGroups, setPasteGroups] = useState<Set<Exclude<CuePropertyGroup, "all">>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(selectedCueId ? [selectedCueId] : []));
  const [marquee, setMarquee] = useState<Marquee>();
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const selectedCue = cues.find((cue) => cue.id === selectedCueId);
  const timelineDurationMs = cues.reduce(
    (maximum, cue) => Math.max(maximum, cue.endMs + 500),
    Math.max(1_000, durationMs),
  );
  const timelineWidth = Math.max(1, (timelineDurationMs / 1000) * pixelsPerSecond);
  const tickSeconds = timelineTickSeconds(timelineDurationMs, pixelsPerSecond);
  const ticks = useMemo(
    () => Array.from({ length: Math.floor(timelineDurationMs / 1000 / tickSeconds) + 1 }, (_, index) => index * tickSeconds),
    [timelineDurationMs, tickSeconds],
  );
  const cueIdentity = useMemo(() => cues.map((cue) => cue.id).join("\u0000"), [cues]);
  const layout = useMemo(() => layoutTimelineCues(cues), [cues]);
  const trackCount = Math.max(4, layout.laneCount);
  const trackLabels = useMemo(() => Array.from({ length: trackCount }, (_, lane) => {
    const kinds = new Set(layout.items.filter((item) => item.lane === lane).map(({ cue }) =>
      cue.sourceKind !== "onscreen-text" ? "SUB" : cue.textOrigin === "manual" ? "TEXT" : "OCR",
    ));
    return [...kinds].join("/") || EMPTY_TRACK_LABELS[lane] || "SUB";
  }), [layout.items, trackCount]);
  const laneHeight = trackCount * LANE_HEIGHT;
  const seekAfterEdit = useCallback((cueId: string, nextTimeMs: number) => {
    if (cues.find((cue) => cue.id === cueId)?.sourceKind !== "onscreen-text") onSeek(nextTimeMs);
  }, [cues, onSeek]);

  useEffect(() => {
    if (!selectedCueId) return;
    setSelectedIds((current) => current.has(selectedCueId) ? current : new Set([selectedCueId]));
  }, [selectedCueId]);

  useEffect(() => {
    setHistory({ past: [], future: [] });
  }, [cueIdentity]);

  const commitEdit = useCallback((cueId: string, before: CueRange, after: CueRange) => {
    if (before.startMs === after.startMs && before.endMs === after.endMs && before.timelineLane === after.timelineLane) return;
    onChange(cueId, after);
    onSelect(cueId);
    seekAfterEdit(cueId, after.startMs);
    setHistory((current) => ({
      past: [...current.past.slice(-(MAX_HISTORY - 1)), { cueId, before, after }],
      future: [],
    }));
  }, [onChange, onSelect, seekAfterEdit]);

  const undo = useCallback(() => {
    const entry = history.past.at(-1);
    if (!entry) return;
    onChange(entry.cueId, entry.before);
    onSelect(entry.cueId);
    seekAfterEdit(entry.cueId, entry.before.startMs);
    setHistory({ past: history.past.slice(0, -1), future: [entry, ...history.future] });
  }, [history, onChange, onSelect, seekAfterEdit]);

  const redo = useCallback(() => {
    const entry = history.future[0];
    if (!entry) return;
    onChange(entry.cueId, entry.after);
    onSelect(entry.cueId);
    seekAfterEdit(entry.cueId, entry.after.startMs);
    setHistory({ past: [...history.past, entry], future: history.future.slice(1) });
  }, [history, onChange, onSelect, seekAfterEdit]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if ((key === "delete" || key === "backspace") && selectedIds.size) {
        event.preventDefault();
        const ids = [...selectedIds];
        if (onDeleteMany) onDeleteMany(ids);
        else if (ids.length === 1) onDelete?.(ids[0]!);
        setSelectedIds(new Set());
      } else if ((event.ctrlKey || event.metaKey) && key === "a") {
        event.preventDefault();
        setSelectedIds(new Set(cues.map((cue) => cue.id)));
      } else if ((event.ctrlKey || event.metaKey) && key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        undo();
      } else if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        redo();
      } else if ((event.ctrlKey || event.metaKey) && key === "b" && selectedCue) {
        event.preventDefault();
        onSplit?.(timeMs);
      } else if ((event.ctrlKey || event.metaKey) && key === "d" && selectedCue) {
        event.preventDefault();
        onDuplicate?.(selectedCue.id);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [cues, onDelete, onDeleteMany, onDuplicate, onSplit, redo, selectedCue, selectedIds, timeMs, undo]);

  useEffect(() => {
    if (!cueMenu) return;
    const close = () => setCueMenu(undefined);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [cueMenu]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || drag) return;
    const playheadX = (timeMs / 1000) * pixelsPerSecond;
    const safeLeft = viewport.scrollLeft + 48;
    const safeRight = viewport.scrollLeft + viewport.clientWidth - 72;
    if (playheadX < safeLeft || playheadX > safeRight) {
      viewport.scrollTo({ left: Math.max(0, playheadX - viewport.clientWidth * 0.32), behavior: "auto" });
    }
  }, [drag, pixelsPerSecond, timeMs]);

  useEffect(() => {
    if (!drag) return;
    const paintDraft = (nextDraft: CueRange & { cueId: string }) => {
      if (dragFrameRef.current !== undefined) cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = undefined;
        const element = cueElementsRef.current.get(nextDraft.cueId);
        if (!element) return;
        const naturalWidth = ((nextDraft.endMs - nextDraft.startMs) / 1000) * pixelsPerSecond;
        element.style.left = `${(nextDraft.startMs / 1000) * pixelsPerSecond}px`;
        element.style.top = `${(nextDraft.timelineLane ?? drag.originLane) * LANE_HEIGHT + 5}px`;
        element.style.width = `${Math.max(pixelsPerSecond < 8 || naturalWidth < 18 ? 2 : 12, naturalWidth)}px`;
      });
    };
    const move = (event: PointerEvent) => {
      const rawDelta = ((event.clientX - drag.pointerX) / pixelsPerSecond) * 1000;
      const delta = snapEnabled && !event.shiftKey ? Math.round(rawDelta / 50) * 50 : rawDelta;
      const next = editTimelineCue(drag.startMs, drag.endMs, drag.mode, delta);
      const nextLane = drag.mode === "move"
        ? Math.max(0, Math.min(trackCount - 1, drag.originLane + Math.round((event.clientY - drag.pointerY) / LANE_HEIGHT)))
        : drag.originLane;
      const nextDraft = {
        cueId: drag.cueId,
        ...next,
        // A plain click must not turn an automatically laid-out cue into a
        // pinned-track cue. Persist a lane only after an actual vertical move.
        timelineLane: nextLane === drag.originLane ? drag.timelineLane : nextLane,
      };
      draftRef.current = nextDraft;
      paintDraft(nextDraft);
    };
    const finish = () => {
      const finalDraft = draftRef.current;
      if (finalDraft?.cueId === drag.cueId) {
        commitEdit(drag.cueId, { startMs: drag.startMs, endMs: drag.endMs, timelineLane: drag.timelineLane }, { startMs: finalDraft.startMs, endMs: finalDraft.endMs, timelineLane: finalDraft.timelineLane });
      }
      draftRef.current = undefined;
      setDrag(undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (dragFrameRef.current !== undefined) cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = undefined;
    };
  }, [commitEdit, drag, pixelsPerSecond, snapEnabled, trackCount]);

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>, cue: SubtitleCue, mode: TimelineCueEditMode) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey || event.shiftKey) && mode === "move") {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(cue.id)) next.delete(cue.id); else next.add(cue.id);
        return next;
      });
      onSelect(cue.id);
      return;
    }
    setSelectedIds((current) => current.has(cue.id) ? current : new Set([cue.id]));
    onSelect(cue.id);
    const currentLane = layout.items.find((item) => item.cue.id === cue.id)?.lane ?? 0;
    const nextDrag = { cueId: cue.id, mode, pointerX: event.clientX, pointerY: event.clientY, originLane: currentLane, startMs: cue.startMs, endMs: cue.endMs, timelineLane: cue.timelineLane };
    draftRef.current = { cueId: cue.id, startMs: cue.startMs, endMs: cue.endMs, timelineLane: cue.timelineLane };
    setDrag(nextDrag);
  }, [layout.items, onSelect]);

  const nudgeCue = useCallback((cue: SubtitleCue, deltaMs: number) => {
    const before = { startMs: cue.startMs, endMs: cue.endMs };
    commitEdit(cue.id, before, editTimelineCue(cue.startMs, cue.endMs, "move", deltaMs));
  }, [commitEdit]);

  const nudgeSelection = useCallback((deltaMs: number) => {
    const ids = selectedIds.size ? selectedIds : new Set(selectedCue ? [selectedCue.id] : []);
    cues.filter((cue) => ids.has(cue.id)).forEach((cue) => nudgeCue(cue, deltaMs));
  }, [cues, nudgeCue, selectedCue, selectedIds]);

  const fitTimeline = useCallback(() => {
    const availableWidth = Math.max(1, (viewportRef.current?.clientWidth ?? 720) - 2);
    setPixelsPerSecond(Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, availableWidth / (timelineDurationMs / 1000))));
    viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "auto" });
  }, [timelineDurationMs]);

  const copyProperties = useCallback((cue: SubtitleCue, groups: Array<Exclude<CuePropertyGroup, "all">>) => {
    if (!groups.length) return;
    setPropertyClipboard(copyCueProperties(cue, baseStyle, groups));
    setCueMenu(undefined);
  }, [baseStyle]);

  const pasteProperties = useCallback((cue: SubtitleCue, groups?: Array<Exclude<CuePropertyGroup, "all">>) => {
    if (!propertyClipboard) return;
    const clipboard = groups ? selectCuePropertyGroups(propertyClipboard, groups) : propertyClipboard;
    if (!clipboard.groups.length) return;
    const targets = selectedIds.has(cue.id) && selectedIds.size ? [...selectedIds] : [cue.id];
    targets.forEach((id) => {
      const target = cues.find((item) => item.id === id);
      if (target) onChange(id, pasteCueProperties(target, clipboard));
    });
    setCueMenu(undefined);
  }, [cues, onChange, propertyClipboard, selectedIds]);

  const deleteSelection = useCallback(() => {
    const ids = selectedIds.size ? [...selectedIds] : selectedCue ? [selectedCue.id] : [];
    if (!ids.length) return;
    if (onDeleteMany) onDeleteMany(ids);
    else if (ids.length === 1) onDelete?.(ids[0]!);
    setSelectedIds(new Set());
  }, [onDelete, onDeleteMany, selectedCue, selectedIds]);

  const beginMarquee = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const laneElement = event.currentTarget;
    const rect = laneElement.getBoundingClientRect();
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    let latest: Marquee = { startX: start.x, startY: start.y, x: start.x, y: start.y };
    setMarquee(latest);
    const move = (pointer: PointerEvent) => {
      latest = {
        ...latest,
        x: Math.max(0, Math.min(rect.width, pointer.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, pointer.clientY - rect.top)),
      };
      setMarquee(latest);
    };
    const finish = () => {
      const left = Math.min(latest.startX, latest.x);
      const right = Math.max(latest.startX, latest.x);
      const top = Math.min(latest.startY, latest.y);
      const bottom = Math.max(latest.startY, latest.y);
      if (right - left < 4 && bottom - top < 4) {
        setSelectedIds(new Set());
        onSeek(Math.max(0, Math.min(timelineDurationMs, (left / pixelsPerSecond) * 1000)));
      } else {
        const ids = layout.items
          .filter(({ cue, lane }) => {
            const cueLeft = (cue.startMs / 1000) * pixelsPerSecond;
            const cueRight = (cue.endMs / 1000) * pixelsPerSecond;
            const cueTop = lane * LANE_HEIGHT + 4;
            const cueBottom = cueTop + LANE_HEIGHT - 8;
            return cueRight >= left && cueLeft <= right && cueBottom >= top && cueTop <= bottom;
          })
          .map(({ cue }) => cue.id);
        setSelectedIds(new Set(ids));
        if (ids[0]) onSelect(ids[0]);
      }
      setMarquee(undefined);
      window.removeEventListener("pointermove", move);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }, [layout.items, onSeek, onSelect, pixelsPerSecond, timelineDurationMs]);

  // Cue DOM is memoized so playback only moves the playhead instead of rebuilding a long cue list every frame.
  const renderedCues = useMemo(() => layout.items.map(({ cue, lane }) => {
    const left = (cue.startMs / 1000) * pixelsPerSecond;
    const naturalWidth = ((cue.endMs - cue.startMs) / 1000) * pixelsPerSecond;
    const overview = pixelsPerSecond < 8 || naturalWidth < 18;
    const width = Math.max(overview ? 2 : 12, naturalWidth);
    const kindClass = cue.sourceKind !== "onscreen-text"
      ? "subtitle-object"
      : cue.textOrigin === "manual"
        ? "manual-text-object"
        : "ocr-text-object";
    return (
      <button
        type="button"
        key={cue.id}
        ref={(element) => {
          if (element) cueElementsRef.current.set(cue.id, element);
          else cueElementsRef.current.delete(cue.id);
        }}
        className={`timeline-cue ${kindClass} ${overview ? "overview" : ""} ${activeCueId === cue.id ? "active" : ""} ${selectedIds.has(cue.id) ? "selected" : ""} ${drag?.cueId === cue.id ? "dragging" : ""}`}
        style={{ left: `${left}px`, top: `${lane * LANE_HEIGHT + 5}px`, width: `${width}px`, height: `${LANE_HEIGHT - 10}px` }}
        title={`#${cue.index} · ${formatClock(cue.startMs)} → ${formatClock(cue.endMs)}\n${cue.originalText}`}
        aria-label={`Cue ${cue.index}, ${formatClock(cue.startMs)} đến ${formatClock(cue.endMs)}`}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!selectedIds.has(cue.id)) setSelectedIds(new Set([cue.id]));
          onSelect(cue.id);
          setCueMenu({
            x: Math.min(event.clientX, Math.max(8, window.innerWidth - 258)),
            y: Math.max(12, Math.min(event.clientY, window.innerHeight - 452)),
            cueId: cue.id,
            view: "root",
          });
        }}
        onPointerDown={(event) => beginDrag(event, cue, "move")}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          nudgeCue(cue, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 500 : 50));
        }}
      >
        <span className="timeline-cue-handle start" aria-hidden="true" onPointerDown={(event) => beginDrag(event, cue, "resize-start")} />
        <span className="timeline-cue-copy"><b>#{String(cue.index).padStart(2, "0")}</b><em>{cue.originalText || "Cue trống"}</em></span>
        <span className="timeline-cue-handle end" aria-hidden="true" onPointerDown={(event) => beginDrag(event, cue, "resize-end")} />
      </button>
    );
  }), [activeCueId, beginDrag, drag?.cueId, layout.items, nudgeCue, onSelect, pixelsPerSecond, selectedIds]);

  return (
    <div className="timeline-wrap" aria-label="Timeline phụ đề">
      <div className="timeline-heading">
        <div className="timeline-title">
          <span>TIMELINE</span>
          <b>{formatClock(timeMs)} <i>/</i> {formatClock(timelineDurationMs)}</b>
          <small>{selectedIds.size ? `${selectedIds.size} đã chọn` : `${cues.length} cue · ${trackCount} track`}</small>
        </div>
        <div className="timeline-tools">
          <div className="timeline-tool-group primary-actions">
            <button type="button" className="tool-with-label" onClick={() => onSplit?.(timeMs)} disabled={!onSplit || !selectedCue} title="Tách cue đang chọn tại playhead"><Scissors size={13} /><span>Tách</span></button>
            <button type="button" className="tool-with-label" onClick={() => selectedCue && onDuplicate?.(selectedCue.id)} disabled={!onDuplicate || !selectedCue} title="Nhân bản cue đang chọn"><Copy size={13} /><span>Nhân bản</span></button>
            <button type="button" className="tool-with-label" onClick={() => onAddText?.(timeMs)} title="Thêm văn bản tại playhead"><Type size={13} /><span>Văn bản</span></button>
          </div>
          <div className="timeline-tool-separator" />
          <div className="timeline-tool-group">
            <button type="button" onClick={() => nudgeSelection(-50)} disabled={!selectedCue} aria-label="Dịch cue sang trái 50 mili giây" title="Dịch trái 50 ms"><ChevronLeft size={14} /></button>
            <button type="button" onClick={() => nudgeSelection(50)} disabled={!selectedCue} aria-label="Dịch cue sang phải 50 mili giây" title="Dịch phải 50 ms"><ChevronRight size={14} /></button>
            <button type="button" className={snapEnabled ? "active" : ""} onClick={() => setSnapEnabled((value) => !value)} aria-label="Bật hoặc tắt bắt dính timeline" aria-pressed={snapEnabled} title="Bắt dính theo 50 ms; giữ Shift để kéo tự do"><Magnet size={13} /></button>
          </div>
          <button type="button" onClick={deleteSelection} aria-label="Xóa cue đã chọn" title="Xóa cue đã chọn (Delete)" disabled={!selectedIds.size && !selectedCue}><Trash2 size={13} /></button>
          <button type="button" onClick={undo} aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)" disabled={!history.past.length}><Undo2 size={13} /></button>
          <button type="button" onClick={redo} aria-label="Làm lại" title="Làm lại (Ctrl+Shift+Z)" disabled={!history.future.length}><Redo2 size={13} /></button>
          <button type="button" onClick={fitTimeline} aria-label="Thu vừa toàn bộ timeline" title="Hiện toàn bộ timeline"><Maximize2 size={13} /></button>
          <button type="button" className={timelineExpanded ? "active" : ""} onClick={() => setTimelineExpanded((value) => !value)} aria-label={timelineExpanded ? "Thu gọn chiều cao timeline" : "Mở rộng chiều cao timeline"} title={timelineExpanded ? "Thu gọn timeline để xem video" : "Mở rộng timeline"}>↕</button>
          <div className="timeline-zoom-control"><button type="button" onClick={() => setPixelsPerSecond((value) => Math.max(MIN_PIXELS_PER_SECOND, value / 1.35))} aria-label="Thu nhỏ timeline" disabled={pixelsPerSecond <= MIN_PIXELS_PER_SECOND}><Minus size={13} /></button><b>{pixelsPerSecond < 10 ? pixelsPerSecond.toFixed(1) : Math.round(pixelsPerSecond)}px/s</b><button type="button" onClick={() => setPixelsPerSecond((value) => Math.min(MAX_PIXELS_PER_SECOND, value * 1.35))} aria-label="Phóng to timeline" disabled={pixelsPerSecond >= MAX_PIXELS_PER_SECOND}><Plus size={13} /></button></div>
        </div>
      </div>
      <div className={`timeline-viewport ${timelineExpanded ? "expanded" : "compact"}`} ref={viewportRef}>
        <div className="timeline" style={{ width: `${timelineWidth}px`, minWidth: "100%", height: `${laneHeight + 27}px` }}>
          <div className="timeline-ruler" aria-hidden="true">
            {ticks.map((seconds) => <span className="timeline-tick" key={seconds} style={{ left: `${seconds * pixelsPerSecond}px` }}>{formatClock(seconds * 1000)}<i /></span>)}
          </div>
          <div
            className="timeline-lane"
            data-overlap-owner="subtitle-timeline"
            style={{ height: `${laneHeight}px` }}
            onPointerDown={beginMarquee}
          >
            <div className="timeline-track-grid" aria-hidden="true">
              {Array.from({ length: trackCount }, (_, index) => <span key={index} style={{ top: `${index * LANE_HEIGHT}px`, height: `${LANE_HEIGHT}px` }}><i>V{trackCount - index}<b>{trackLabels[index]}</b></i></span>)}
            </div>
            {renderedCues}
            {marquee && <div className="timeline-marquee" aria-hidden="true" style={{
              left: `${Math.min(marquee.startX, marquee.x)}px`,
              top: `${Math.min(marquee.startY, marquee.y)}px`,
              width: `${Math.abs(marquee.x - marquee.startX)}px`,
              height: `${Math.abs(marquee.y - marquee.startY)}px`,
            }} />}
            <button
              type="button"
              className="timeline-playhead"
              style={{ left: `${Math.max(0, Math.min(timelineWidth, (timeMs / 1000) * pixelsPerSecond))}px` }}
              aria-label={`Vị trí phát ${formatClock(timeMs)}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                const lane = event.currentTarget.parentElement;
                if (!lane) return;
                const rect = lane.getBoundingClientRect();
                const move = (pointer: PointerEvent) => onSeek(Math.max(0, Math.min(timelineDurationMs, ((pointer.clientX - rect.left) / pixelsPerSecond) * 1000)));
                move(event.nativeEvent);
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
              }}
            ><span /></button>
          </div>
        </div>
      </div>
      {cueMenu && (() => {
        const cue = cues.find((item) => item.id === cueMenu.cueId);
        if (!cue) return null;
        const allCopyGroupsSelected = copyGroups.size === COPY_GROUPS.length;
        const availablePasteGroups = COPY_GROUPS.filter((group) => propertyClipboard?.groups.includes(group.id));
        const allPasteGroupsSelected = availablePasteGroups.length > 0 && availablePasteGroups.every((group) => pasteGroups.has(group.id));
        return (
          <div
            className="timeline-cue-menu"
            role="menu"
            style={{ left: cueMenu.x, top: cueMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="timeline-cue-menu-head">
              <span>{cue.sourceKind !== "onscreen-text" ? "SUBTITLE" : cue.textOrigin === "manual" ? "TEXT" : "OCR TEXT"} #{String(cue.index).padStart(2, "0")}</span>
              <small>{cue.originalText || "Cue trống"}</small>
            </div>
            <div className="timeline-cue-menu-body">
            {cueMenu.view === "root" ? <>
              {cue.sourceKind === "onscreen-text" && <button type="button" role="menuitem" onClick={() => { onSelect(cue.id); setCueMenu(undefined); }}><b>Chỉnh văn bản</b><small>Nội dung, vị trí và giao diện</small></button>}
              <button type="button" role="menuitem" disabled={!onSplit} onClick={() => { onSelect(cue.id); onSplit?.(timeMs); setCueMenu(undefined); }}><b>Tách tại playhead</b><small>Ctrl+B · chia cue và bỏ voice cache cũ</small></button>
              <button type="button" role="menuitem" disabled={!onDuplicate} onClick={() => { onDuplicate?.(cue.id); setCueMenu(undefined); }}><b>Nhân bản cue</b><small>Ctrl+D · tạo một bản kế tiếp để chỉnh</small></button>
              <button type="button" role="menuitem" onClick={() => { setCopyGroups(new Set(COPY_GROUPS.map((group) => group.id))); setCueMenu((current) => current ? { ...current, view: "copy" } : current); }}><b>Sao chép thuộc tính…</b><small>Tích một hoặc nhiều nhóm thuộc tính</small></button>
              <button type="button" role="menuitem" disabled={!propertyClipboard} onClick={() => { if (!propertyClipboard) return; setPasteGroups(new Set(propertyClipboard.groups.filter((group): group is Exclude<CuePropertyGroup, "all"> => group !== "all"))); setCueMenu((current) => current ? { ...current, view: "paste" } : current); }}><b>Dán thuộc tính…</b><small>{propertyClipboard ? propertyClipboard.label : "Chưa có thuộc tính trong bộ nhớ"}</small></button>
              <hr />
              <button type="button" role="menuitem" className="danger" onClick={() => { deleteSelection(); setCueMenu(undefined); }}><b>Xóa cue đã chọn</b><small>Phím Delete / Backspace</small></button>
            </> : cueMenu.view === "copy" ? <>
              <button type="button" className="menu-back" onClick={() => setCueMenu((current) => current ? { ...current, view: "root" } : current)}>← Quay lại</button>
              <div className="timeline-cue-menu-section">SAO CHÉP THUỘC TÍNH</div>
              <label className="timeline-copy-option select-all"><input type="checkbox" checked={allCopyGroupsSelected} onChange={() => setCopyGroups(allCopyGroupsSelected ? new Set() : new Set(COPY_GROUPS.map((group) => group.id)))} /><span><b>Chọn tất cả</b><small>{allCopyGroupsSelected ? 'Bỏ chọn toàn bộ' : 'Vị trí và toàn bộ giao diện'}</small></span></label>
              {COPY_GROUPS.map((group) => <label className="timeline-copy-option" key={group.id}><input type="checkbox" checked={copyGroups.has(group.id)} onChange={() => setCopyGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })} /><span><b>{group.label}</b><small>{group.detail}</small></span></label>)}
            </> : <>
              <button type="button" className="menu-back" onClick={() => setCueMenu((current) => current ? { ...current, view: "root" } : current)}>← Quay lại</button>
              <div className="timeline-cue-menu-section">DÁN THUỘC TÍNH</div>
              <label className="timeline-copy-option select-all"><input type="checkbox" checked={allPasteGroupsSelected} onChange={() => setPasteGroups(allPasteGroupsSelected ? new Set() : new Set(availablePasteGroups.map((group) => group.id)))} /><span><b>Chọn tất cả</b><small>Chỉ dán các nhóm được tích</small></span></label>
              {availablePasteGroups.map((group) => <label className="timeline-copy-option" key={group.id}><input type="checkbox" checked={pasteGroups.has(group.id)} onChange={() => setPasteGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })} /><span><b>{group.label}</b><small>{group.detail}</small></span></label>)}
            </>}
            </div>
            {cueMenu.view === "copy" && <div className="timeline-copy-actions"><span>{copyGroups.size}/{COPY_GROUPS.length} nhóm</span><button type="button" disabled={!copyGroups.size} onClick={() => copyProperties(cue, COPY_GROUPS.filter((group) => copyGroups.has(group.id)).map((group) => group.id))}>Sao chép</button></div>}
            {cueMenu.view === "paste" && <div className="timeline-copy-actions"><span>{pasteGroups.size}/{availablePasteGroups.length} nhóm</span><button type="button" disabled={!pasteGroups.size} onClick={() => pasteProperties(cue, availablePasteGroups.filter((group) => pasteGroups.has(group.id)).map((group) => group.id))}>Dán</button></div>}
          </div>
        );
      })()}
    </div>
  );
}
