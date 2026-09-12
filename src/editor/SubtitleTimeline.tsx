import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SubtitleCue, SubtitleStyle } from "../types";
import { Maximize2, Minus, Plus, Redo2, Trash2, Type, Undo2 } from "../components/Icons";
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

export function SubtitleTimeline({ cues, timeMs, durationMs, activeCueId, selectedCueId, onSelect, onChange, onSeek, onAddText, onDelete, onDeleteMany, baseStyle }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<(CueRange & { cueId: string }) | undefined>(undefined);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(70);
  const [drag, setDrag] = useState<DragState>();
  const [draft, setDraft] = useState<(CueRange & { cueId: string })>();
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
  const trackCount = Math.max(1, layout.laneCount);
  const trackLabels = useMemo(() => Array.from({ length: trackCount }, (_, lane) => {
    const kinds = new Set(layout.items.filter((item) => item.lane === lane).map(({ cue }) =>
      cue.sourceKind !== "onscreen-text" ? "SUB" : cue.textOrigin === "manual" ? "TEXT" : "OCR",
    ));
    return [...kinds].join("/") || "TEXT";
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
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [cues, onDelete, onDeleteMany, redo, selectedIds, undo]);

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
    const move = (event: PointerEvent) => {
      const next = editTimelineCue(drag.startMs, drag.endMs, drag.mode, ((event.clientX - drag.pointerX) / pixelsPerSecond) * 1000);
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
      setDraft(nextDraft);
    };
    const finish = () => {
      const finalDraft = draftRef.current;
      if (finalDraft?.cueId === drag.cueId) {
        commitEdit(drag.cueId, { startMs: drag.startMs, endMs: drag.endMs, timelineLane: drag.timelineLane }, { startMs: finalDraft.startMs, endMs: finalDraft.endMs, timelineLane: finalDraft.timelineLane });
      }
      draftRef.current = undefined;
      setDraft(undefined);
      setDrag(undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [commitEdit, drag, pixelsPerSecond, trackCount]);

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
    setDraft(draftRef.current);
    setDrag(nextDrag);
  }, [layout.items, onSelect]);

  const nudgeCue = useCallback((cue: SubtitleCue, deltaMs: number) => {
    const before = { startMs: cue.startMs, endMs: cue.endMs };
    commitEdit(cue.id, before, editTimelineCue(cue.startMs, cue.endMs, "move", deltaMs));
  }, [commitEdit]);

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
    const current = draft?.cueId === cue.id ? draft : cue;
    const currentLane = draft?.cueId === cue.id ? (draft.timelineLane ?? lane) : lane;
    const left = (current.startMs / 1000) * pixelsPerSecond;
    const naturalWidth = ((current.endMs - current.startMs) / 1000) * pixelsPerSecond;
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
        className={`timeline-cue ${kindClass} ${overview ? "overview" : ""} ${activeCueId === cue.id ? "active" : ""} ${selectedIds.has(cue.id) ? "selected" : ""} ${drag?.cueId === cue.id ? "dragging" : ""}`}
        style={{ left: `${left}px`, top: `${currentLane * LANE_HEIGHT + 5}px`, width: `${width}px`, height: `${LANE_HEIGHT - 10}px` }}
        title={`#${cue.index} · ${formatClock(current.startMs)} → ${formatClock(current.endMs)}\n${cue.originalText}`}
        aria-label={`Cue ${cue.index}, ${formatClock(current.startMs)} đến ${formatClock(current.endMs)}`}
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
  }), [activeCueId, beginDrag, draft, drag?.cueId, layout.items, nudgeCue, onSelect, pixelsPerSecond, selectedIds]);

  return (
    <div className="timeline-wrap" aria-label="Timeline phụ đề">
      <div className="timeline-heading">
          <span>EDITOR TIMELINE<i>Track trên ưu tiên hiển thị · kéo ngang để đổi thời gian · kéo dọc để đổi track</i></span>
        <div className="timeline-tools">
          <div className="timeline-legend" aria-label="Màu loại cue"><i className="subtitle" />Phụ đề<i className="ocr" />OCR<i className="manual" />Text</div>
          <span>{selectedIds.size ? `${selectedIds.size} đã chọn` : `${cues.length} cue · ${trackCount} track`}</span>
          <button type="button" onClick={() => onAddText?.(timeMs)} aria-label="Thêm văn bản tại đầu phát" title="Thêm văn bản tại vị trí đầu phát"><Type size={13} /></button>
          <button type="button" onClick={deleteSelection} aria-label="Xóa cue đã chọn" title="Xóa cue đã chọn (Delete)" disabled={!selectedIds.size && !selectedCue}><Trash2 size={13} /></button>
          <button type="button" onClick={undo} aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)" disabled={!history.past.length}><Undo2 size={13} /></button>
          <button type="button" onClick={redo} aria-label="Làm lại" title="Làm lại (Ctrl+Shift+Z)" disabled={!history.future.length}><Redo2 size={13} /></button>
          <button type="button" onClick={fitTimeline} aria-label="Thu vừa toàn bộ timeline" title="Hiện toàn bộ timeline"><Maximize2 size={13} /></button>
          <button type="button" className={timelineExpanded ? "active" : ""} onClick={() => setTimelineExpanded((value) => !value)} aria-label={timelineExpanded ? "Thu gọn chiều cao timeline" : "Mở rộng chiều cao timeline"} title={timelineExpanded ? "Thu gọn timeline để xem video" : "Mở rộng timeline"}>↕</button>
          <button type="button" onClick={() => setPixelsPerSecond((value) => Math.max(MIN_PIXELS_PER_SECOND, value / 1.35))} aria-label="Thu nhỏ timeline" disabled={pixelsPerSecond <= MIN_PIXELS_PER_SECOND}><Minus size={13} /></button>
          <b>{pixelsPerSecond < 10 ? pixelsPerSecond.toFixed(1) : Math.round(pixelsPerSecond)}px/s</b>
          <button type="button" onClick={() => setPixelsPerSecond((value) => Math.min(MAX_PIXELS_PER_SECOND, value * 1.35))} aria-label="Phóng to timeline" disabled={pixelsPerSecond >= MAX_PIXELS_PER_SECOND}><Plus size={13} /></button>
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
