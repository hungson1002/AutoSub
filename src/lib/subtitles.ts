import type { DubbingMetadata, SubtitleCue, SubtitleStyle } from '../types';
import { layoutTimelineCues } from './subtitleTimeline';

const parseTime = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length < 2 || parts.length > 3) return 0;
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0;
  return hours * 3600000 + minutes * 60000 + seconds * 1000;
};

export const formatTime = (ms: number) => {
  const safe = Math.max(0, Math.round(ms)); const h = Math.floor(safe / 3600000); const m = Math.floor((safe % 3600000) / 60000); const s = Math.floor((safe % 60000) / 1000); const rest = safe % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`;
};
export const formatClock = (ms: number) => { const safe = Math.max(0, Math.round(ms)); const m = Math.floor(safe / 60000); const s = Math.floor((safe % 60000) / 1000); const rest = Math.floor((safe % 1000) / 10); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rest).padStart(2, '0')}`; };

export function parseSubtitle(text: string, fileName = ''): SubtitleCue[] {
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/).filter(Boolean); const cues: SubtitleCue[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block.split('\n').map((line) => line.trimEnd()); const timeLineIndex = lines.findIndex((line) => line.includes('-->')); if (timeLineIndex < 0) continue;
    const parts = lines[timeLineIndex]?.split('-->').map((part) => part.trim().split(/\s+/)[0]); const start = parts?.[0]; const end = parts?.[1]; if (!start || !end) continue;
    const value = lines.slice(timeLineIndex + 1).join('\n').replace(/<[^>]*>/g, '').replace(/\{[^}]+\}/g, '').trim(); if (!value) continue;
    cues.push({ id: `${fileName || 'cue'}-${blockIndex + 1}-${crypto.randomUUID?.() ?? Date.now()}`, index: cues.length + 1, startMs: parseTime(start ?? ''), endMs: parseTime(end ?? ''), originalText: value, translatedText: '', voiceGroup: 'G1', enabled: true });
  }
  return cues;
}

export function cuesToSrt(cues: SubtitleCue[], translated = false) {
  const enabled = cues.filter((cue) => cue.enabled);
  return enabled.map((cue, index) => {
    const next = enabled[index + 1];
    const endMs = next && cue.endMs > next.startMs ? Math.max(cue.startMs, next.startMs) : cue.endMs;
    return `${index + 1}\n${formatTime(cue.startMs)} --> ${formatTime(endMs)}\n${translated ? (cue.translatedText || cue.originalText) : cue.originalText}\n`;
  }).join('\n');
}

export function cuesForDubbingTimeline(cues: SubtitleCue[], enabled: boolean) {
  if (!enabled) return cues;
  return cues.map((cue) => {
    const startMs = cue.dubbing?.timelineStartMs;
    const endMs = cue.dubbing?.timelineEndMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return cue;
    return { ...cue, startMs: startMs as number, endMs: Math.max((startMs as number) + 1, endMs as number) };
  });
}

export function isDubbableSubtitleCue(cue: SubtitleCue) {
  return cue.sourceKind !== 'onscreen-text' && cue.enabled && Boolean((cue.translatedText || cue.originalText).trim());
}

export function cuesWithDubbingTimelineMetadata(cues: SubtitleCue[], metadata: DubbingMetadata[]) {
  const byId = new Map(metadata.map((item) => [item.cueId, item]));
  const sameLength = metadata.length === cues.length;
  return cues.map((cue, index) => ({ ...cue, dubbing: byId.get(cue.id) || (sameLength ? metadata[index] : undefined) || cue.dubbing }));
}

/** Repair only the persisted OCR shape produced by the runaway-end regression. */
export function repairRunawayOcrCueEnds(cues: SubtitleCue[]) {
  const repeatedEnds = new Map<number, number>();
  for (const cue of cues) {
    if (!cue.id.startsWith('ocr-') || cue.sourceKind === 'onscreen-text' || cue.endMs - cue.startMs < 5_000) continue;
    repeatedEnds.set(cue.endMs, (repeatedEnds.get(cue.endMs) || 0) + 1);
  }
  const runawayEnds = new Set([...repeatedEnds].filter(([, count]) => count >= 3).map(([endMs]) => endMs));
  if (!runawayEnds.size) return cues;
  let changed = false;
  const repaired = cues.map((cue, index) => {
    if (!cue.id.startsWith('ocr-') || cue.sourceKind === 'onscreen-text' || !runawayEnds.has(cue.endMs)) return cue;
    const nextStart = cues.slice(index + 1).find((next) => next.startMs > cue.startMs)?.startMs;
    if (!Number.isFinite(nextStart) || (nextStart as number) >= cue.endMs) return cue;
    changed = true;
    return { ...cue, endMs: Math.max(cue.startMs + 1, nextStart as number), dubbing: undefined };
  });
  return changed ? repaired : cues;
}

const assTime = (ms: number) => { const safe = Math.max(0, Math.round(ms)); const h = Math.floor(safe / 3600000); const m = Math.floor((safe % 3600000) / 60000); const s = Math.floor((safe % 60000) / 1000); const cs = Math.floor((safe % 1000) / 10); return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };
const assColor = (hex: string) => { const rgb = hex.replace('#', '').length === 6 ? hex.replace('#', '') : 'ffffff'; return `&H00${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toUpperCase(); };
const assAlpha = (opacity: number) =>
  `&H${Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255).toString(16).padStart(2, '0').toUpperCase()}&`;
// CSS renders the editor's font controls in 96-DPI pixels, while libass uses
// typographic 72-DPI script units. Convert once so the same UI value occupies
// the same visible height in preview and in the burned video.
export const ASS_CSS_PIXEL_SCALE = 96 / 72;
const assPixels = (value: number) => Math.round(value * ASS_CSS_PIXEL_SCALE * 10) / 10;

const measureSubtitleLine = (line: string, style: SubtitleStyle) => {
  if (typeof document !== 'undefined') {
    const context = document.createElement('canvas').getContext('2d');
    if (context) {
      const family = style.fontFamily.replace(/"/g, '');
      context.font = `${style.italic === true ? 'italic ' : ''}${style.bold === true ? '700 ' : '400 '}${style.fontSize}px "${family}", sans-serif`;
      return context.measureText(line).width;
    }
  }
  return Array.from(line).reduce((width, character) => width + (character === ' ' ? .32 : .58) * style.fontSize, 0);
};

const roundedRectDrawing = (width: number, height: number, radius: number) => {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const r = Math.max(0, Math.min(Math.round(radius), Math.floor(w / 2), Math.floor(h / 2)));
  if (!r) return `m 0 0 l ${w} 0 l ${w} ${h} l 0 ${h}`;
  const k = Math.round(r * .5523);
  return [
    `m ${r} 0`, `l ${w - r} 0`, `b ${w - r + k} 0 ${w} ${r - k} ${w} ${r}`,
    `l ${w} ${h - r}`, `b ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h}`,
    `l ${r} ${h}`, `b ${r - k} ${h} 0 ${h - r + k} 0 ${h - r}`,
    `l 0 ${r}`, `b 0 ${r - k} ${r - k} 0 ${r} 0`,
  ].join(' ');
};

const subtitleBoxLayers = (content: string, effective: SubtitleStyle, xPercent: number, yPercent: number, startMs: number, endMs: number, layer: number) => {
  if (effective.background !== 'box') return [];
  const lines = content.split(/\r?\n/);
  const textWidth = Math.max(1, ...lines.map((line) => measureSubtitleLine(line, effective)));
  const textHeight = Math.max(1, lines.length * effective.fontSize * 1.18);
  const paddingX = Math.max(0, effective.boxPaddingX ?? 10);
  const paddingY = Math.max(0, effective.boxPaddingY ?? 4);
  const borderWidth = Math.max(0, effective.boxBorderWidth ?? 0);
  const width = textWidth + paddingX * 2 + borderWidth * 2;
  const height = textHeight + paddingY * 2 + borderWidth * 2;
  const centerX = (xPercent / 100) * 1920;
  const centerY = (yPercent / 100) * 1080;
  const left = xPercent <= 1 ? centerX : xPercent >= 99 ? centerX - width : centerX - width / 2;
  const top = yPercent <= 1 ? centerY : yPercent >= 99 ? centerY - height : centerY - height / 2;
  const radius = Math.max(0, effective.boxBorderRadius ?? 0);
  const drawing = (drawLayer: number, x: number, y: number, w: number, h: number, r: number, color: string, opacity: number) =>
    `Dialogue: ${drawLayer},${assTime(startMs)},${assTime(endMs)},None,,0,0,0,,{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\p1\\bord0\\shad0\\1c${assColor(color)}\\1a${assAlpha(opacity)}}${roundedRectDrawing(w, h, r)}{\\p0}`;
  const background = drawing(layer + 1, left, top, width, height, radius, effective.backgroundColor ?? effective.outlineColor, effective.backgroundOpacity ?? .72);
  if (borderWidth <= 0) return [background];
  const border = drawing(layer, left, top, width, height, radius, effective.boxBorderColor ?? '#ffffff', 1);
  const inner = drawing(layer + 1, left + borderWidth, top + borderWidth, width - borderWidth * 2, height - borderWidth * 2, Math.max(0, radius - borderWidth), effective.backgroundColor ?? effective.outlineColor, effective.backgroundOpacity ?? .72);
  return [border, inner];
};
export function cuesToAss(cues: SubtitleCue[], style: SubtitleStyle) {
  const fontFamily = style.fontFamily.split(',')[0]?.trim() || 'Arial';
  const alignment = style.position === 'top' ? 8 : style.position === 'middle' || style.position === 'custom' ? 5 : 2;
  // Values can come back from localStorage as the strings "true"/"false".
  // ASS treats any non-zero value as enabled, so do not use truthiness here.
  const isBold = style.bold === true;
  const isItalic = style.italic === true;
  const defaultX = style.position === 'custom' ? (style.customX ?? 50) : 50;
  const defaultY = style.position === 'top' ? 12 : style.position === 'middle' ? 50 : style.position === 'custom' ? (style.customY ?? 82) : 82;
  const defaultPositionTag = `{\\an5\\pos(${Math.round((defaultX / 100) * 1920)},${Math.round((defaultY / 100) * 1080)})}`;
  const cueStyleTag = (effective: SubtitleStyle) => {
    const font = effective.fontFamily.split(',')[0]?.trim() || 'Arial';
    const outline = effective.background === 'outline' ? Math.max(0, assPixels(effective.outlineWidth ?? 2)) : 0;
    const edgeColor = assColor(effective.outlineColor);
    return `{\\fn${font}\\fs${assPixels(effective.fontSize)}\\c${assColor(effective.textColor)}\\3c${edgeColor}\\b${effective.bold === true ? 1 : 0}\\i${effective.italic === true ? 1 : 0}\\bord${outline}}`;
  };
  const enabledCues = cues.filter((cue) => cue.enabled);
  const defaultStyleTag = cueStyleTag(style);
  const layerLayout = layoutTimelineCues(enabledCues);
  const layers = new Map(layerLayout.items.map(({ cue, lane }) => [cue.id, layerLayout.laneCount - lane]));
  const lines = enabledCues.flatMap((cue) => {
    const individualStyle = cue.sourceKind === 'onscreen-text' ? cue.styleOverrides : undefined;
    const effective = individualStyle ? { ...style, ...individualStyle } : style;
    const effectiveStyleTag = individualStyle ? cueStyleTag(effective) : defaultStyleTag;
    const translated = cue.translatedText || cue.originalText;
    const content = effective.content === 'original' ? cue.originalText : effective.content === 'both' && cue.originalText.trim() !== translated.trim() ? `${cue.originalText}\\N${translated}` : translated;
    const escaped = content.replace(/\r?\n/g, '\\N').replace(/[{}]/g, '');
    const xPercent = cue.sourceKind === 'onscreen-text' && cue.screenPosition ? cue.screenPosition.xPercent : defaultX;
    const yPercent = cue.sourceKind === 'onscreen-text' && cue.screenPosition ? cue.screenPosition.yPercent : defaultY;
    const positionTag = cue.sourceKind === 'onscreen-text' && cue.screenPosition ? `{\\an5\\pos(${Math.round((xPercent / 100) * 1920)},${Math.round((yPercent / 100) * 1080)})}` : defaultPositionTag;
    const styleName = effective.background === 'box' ? 'Box' : effective.background === 'none' ? 'None' : 'Outline';
    const renderLayer = (layers.get(cue.id) ?? 0) * 4;
    const dialogue = (layer: number, tags: string) => `Dialogue: ${layer},${assTime(cue.startMs)},${assTime(cue.endMs)},${styleName},,0,0,0,,${positionTag}${effectiveStyleTag}${tags}${escaped}`;
    const boxes = subtitleBoxLayers(content.replace(/\\N/g, '\n'), effective, xPercent, yPercent, cue.startMs, cue.endMs, renderLayer);
    return [...boxes, dialogue(renderLayer + 3, '')];
  });
  const outlineWidth = style.background === 'outline' ? Math.max(0, assPixels(style.outlineWidth ?? 2)) : 0;
  const marginV = style.position === 'top' ? 97 : style.position === 'bottom' ? 108 : 0;
  const common = `${fontFamily},${assPixels(style.fontSize)},${assColor(style.textColor)},${assColor(style.textColor)}`;
  const flags = `${isBold ? -1 : 0},${isItalic ? -1 : 0},0,0,100,100,0,0`;
  return `[Script Info]\nScriptType: v4.00+\nScaledBorderAndShadow: yes\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Outline,${common},${assColor(style.outlineColor)},&HFF000000,${flags},1,${outlineWidth},0,${alignment},154,154,${marginV},1\nStyle: Box,${common},${assColor(style.outlineColor)},&HFF000000,${flags},1,0,0,${alignment},154,154,${marginV},1\nStyle: None,${common},&HFF000000,&HFF000000,${flags},1,0,0,${alignment},154,154,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`;
}

export function subtitleStats(cue: SubtitleCue) { const seconds = Math.max((cue.endMs - cue.startMs) / 1000, 0.001); const chars = (cue.translatedText || cue.originalText).replace(/\s/g, '').length; return { cps: chars / seconds, duration: cue.endMs - cue.startMs }; }
export function validateCues(cues: SubtitleCue[]) { const errors: string[] = []; cues.forEach((cue, index) => { if (!cue.id.trim()) errors.push(`Cue ${index + 1} thiếu id.`); if (cue.endMs <= cue.startMs) errors.push(`Cue ${cue.index} có timestamp không hợp lệ.`); if (cue.startMs < 0) errors.push(`Cue ${cue.index} có start âm.`); if (!cue.originalText.trim() && !cue.translatedText.trim()) errors.push(`Cue ${cue.index} không có nội dung.`); }); return { valid: errors.length === 0, errors }; }
export function downloadText(name: string, text: string, type = 'text/plain') { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
