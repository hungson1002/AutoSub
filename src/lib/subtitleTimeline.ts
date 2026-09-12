import type { SubtitleCue, SubtitleStyle } from "../types";

export type TimelineCueEditMode = "move" | "resize-start" | "resize-end";

export type CuePropertyGroup = "all" | "position" | "typography" | "size" | "color" | "frame";

export type CuePropertyClipboard = {
  groups: CuePropertyGroup[];
  label: string;
  screenPosition?: SubtitleCue["screenPosition"];
  styleOverrides?: Partial<SubtitleStyle>;
};

const GROUP_LABELS: Record<CuePropertyGroup, string> = {
  all: "Tất cả thuộc tính",
  position: "Vị trí",
  typography: "Font & kiểu chữ",
  size: "Cỡ chữ",
  color: "Màu chữ",
  frame: "Viền, khung & padding",
};

const STYLE_KEYS: Record<Exclude<CuePropertyGroup, "all" | "position">, Array<keyof SubtitleStyle>> = {
  typography: ["fontFamily", "bold", "italic"],
  size: ["fontSize"],
  color: ["textColor"],
  frame: ["background", "outlineColor", "outlineWidth", "backgroundColor", "backgroundOpacity", "boxPaddingX", "boxPaddingY", "boxBorderColor", "boxBorderWidth"],
};

function pickStyle(style: Partial<SubtitleStyle>, keys: Array<keyof SubtitleStyle>) {
  const result: Partial<SubtitleStyle> = {};
  for (const key of keys) {
    const value = style[key];
    if (value !== undefined) Object.assign(result, { [key]: value });
  }
  return result;
}

/** Builds a visual-property clipboard from the cue's resolved style. */
export function copyCueProperties(cue: SubtitleCue, baseStyle: SubtitleStyle, selection: CuePropertyGroup | CuePropertyGroup[]): CuePropertyClipboard {
  const requested = Array.isArray(selection) ? selection : [selection];
  const groups: CuePropertyGroup[] = requested.includes("all")
    ? ["position", "typography", "size", "color", "frame"]
    : [...new Set(requested)];
  const resolved = { ...baseStyle, ...cue.styleOverrides };
  const styleOverrides = groups.reduce<Partial<SubtitleStyle>>((result, group) => {
    if (group === "position" || group === "all") return result;
    return { ...result, ...pickStyle(resolved, STYLE_KEYS[group]) };
  }, {});
  return {
    groups,
    label: groups.length === 5 ? GROUP_LABELS.all : groups.map((group) => GROUP_LABELS[group]).join(", "),
    screenPosition: groups.includes("position")
      ? { ...(cue.screenPosition ?? { xPercent: resolved.customX ?? 50, yPercent: resolved.customY ?? 82 }) }
      : undefined,
    styleOverrides: Object.keys(styleOverrides).length ? styleOverrides : undefined,
  };
}

/** Applies only the property group that was copied; unrelated target styling is preserved. */
export function pasteCueProperties(cue: SubtitleCue, clipboard: CuePropertyClipboard): Partial<SubtitleCue> {
  return {
    ...(clipboard.screenPosition ? { screenPosition: { ...clipboard.screenPosition } } : {}),
    ...(clipboard.styleOverrides
      ? { styleOverrides: { ...cue.styleOverrides, ...clipboard.styleOverrides } }
      : {}),
  };
}

/** Keeps only the checked groups when the user confirms CapCut-style paste. */
export function selectCuePropertyGroups(
  clipboard: CuePropertyClipboard,
  selection: CuePropertyGroup[],
): CuePropertyClipboard {
  const groups = clipboard.groups.filter((group) => selection.includes(group));
  const styleOverrides = groups.reduce<Partial<SubtitleStyle>>((result, group) => {
    if (group === "position" || group === "all" || !clipboard.styleOverrides) return result;
    return { ...result, ...pickStyle(clipboard.styleOverrides, STYLE_KEYS[group]) };
  }, {});
  return {
    groups,
    label: groups.length === 5 ? GROUP_LABELS.all : groups.map((group) => GROUP_LABELS[group]).join(", "),
    screenPosition: groups.includes("position") && clipboard.screenPosition
      ? { ...clipboard.screenPosition }
      : undefined,
    styleOverrides: Object.keys(styleOverrides).length ? styleOverrides : undefined,
  };
}

export type TimelineInterval = {
  id: string;
  startMs: number;
  endMs: number;
  timelineLane?: number;
  sourceKind?: SubtitleCue["sourceKind"];
  textOrigin?: SubtitleCue["textOrigin"];
};

export type TimelineLaneItem<T extends TimelineInterval> = {
  cue: T;
  lane: number;
};

const MIN_CUE_DURATION_MS = 100;

export function editTimelineCue(
  startMs: number,
  endMs: number,
  mode: TimelineCueEditMode,
  deltaMs: number,
) {
  const safeStart = Math.max(0, Math.round(startMs));
  const safeEnd = Math.max(safeStart + MIN_CUE_DURATION_MS, Math.round(endMs));
  const delta = Math.round(deltaMs / 10) * 10;

  if (mode === "move") {
    const duration = safeEnd - safeStart;
    const nextStart = Math.max(0, safeStart + delta);
    return { startMs: nextStart, endMs: nextStart + duration };
  }
  if (mode === "resize-start") {
    return {
      startMs: Math.max(0, Math.min(safeEnd - MIN_CUE_DURATION_MS, safeStart + delta)),
      endMs: safeEnd,
    };
  }
  return {
    startMs: safeStart,
    endMs: Math.max(safeStart + MIN_CUE_DURATION_MS, safeEnd + delta),
  };
}

export function timelineTickSeconds(durationMs: number, pixelsPerSecond: number) {
  const durationSeconds = Math.max(1, durationMs / 1000);
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1_800, 3_600, 7_200];
  return candidates.find((seconds) => seconds * pixelsPerSecond >= 72 && durationSeconds / seconds <= 240)
    ?? 7_200;
}

function timelineCategory(cue: TimelineInterval) {
  if (cue.sourceKind !== "onscreen-text") return 0; // captions stay closest to the video track
  return cue.textOrigin === "manual" ? 2 : 1; // OCR above captions, authored text on top
}

/**
 * Packs each semantic cue type into compact, stable rows. Captions use one
 * continuous base row, OCR and authored text get rows above it, and another
 * row is created only when clips of the same type actually overlap.
 * Explicitly dragged cues keep their requested absolute track.
 */
export function layoutTimelineCues<T extends TimelineInterval>(cues: T[]) {
  const sorted = [...cues].sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs || left.id.localeCompare(right.id),
  );
  const automatic = sorted.filter((cue) => !Number.isFinite(cue.timelineLane));
  const bottomLanes = new Map<string, number>();
  let automaticLaneCount = 0;

  for (const category of [0, 1, 2]) {
    const laneEnds: number[] = [];
    for (const cue of automatic.filter((item) => timelineCategory(item) === category)) {
      let localLane = 0;
      while ((laneEnds[localLane] ?? -1) > cue.startMs) localLane += 1;
      laneEnds[localLane] = cue.endMs;
      bottomLanes.set(cue.id, automaticLaneCount + localLane);
    }
    automaticLaneCount += laneEnds.length;
  }

  const assigned = new Map<string, number>();
  for (const cue of automatic) {
    assigned.set(cue.id, automaticLaneCount - 1 - (bottomLanes.get(cue.id) ?? 0));
  }

  let laneCount = automaticLaneCount;
  const overlapsLane = (cue: T, lane: number) => sorted.some((other) =>
    other.id !== cue.id
    && assigned.get(other.id) === lane
    && other.startMs < cue.endMs
    && other.endMs > cue.startMs,
  );
  for (const cue of sorted.filter((item) => Number.isFinite(item.timelineLane))) {
    let lane = Math.max(0, Math.round(cue.timelineLane!));
    while (overlapsLane(cue, lane)) lane += 1;
    assigned.set(cue.id, lane);
    laneCount = Math.max(laneCount, lane + 1);
  }

  return {
    items: sorted.map((cue) => ({ cue, lane: assigned.get(cue.id) ?? 0 })),
    laneCount,
  };
}
