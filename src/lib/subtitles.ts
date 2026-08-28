import type { SubtitleCue, SubtitleStyle } from '../types';

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

const assTime = (ms: number) => { const safe = Math.max(0, Math.round(ms)); const h = Math.floor(safe / 3600000); const m = Math.floor((safe % 3600000) / 60000); const s = Math.floor((safe % 60000) / 1000); const cs = Math.floor((safe % 1000) / 10); return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };
const assColor = (hex: string) => { const rgb = hex.replace('#', '').length === 6 ? hex.replace('#', '') : 'ffffff'; return `&H00${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toUpperCase(); };
export function cuesToAss(cues: SubtitleCue[], style: SubtitleStyle) {
  const fontFamily = style.fontFamily.split(',')[0]?.trim() || 'Arial'; const alignment = style.position === 'top' ? 8 : style.position === 'middle' || style.position === 'custom' ? 5 : 2; const borderStyle = style.background === 'box' ? 3 : 1; const backAlpha = Math.round((1 - style.backgroundOpacity) * 255).toString(16).padStart(2, '0'); const boxColor = assColor(style.backgroundColor ?? style.outlineColor).slice(4); const back = style.background === 'box' ? `&H${backAlpha}${boxColor}` : '&HFF000000';
  // Values can come back from localStorage as the strings "true"/"false".
  // ASS treats any non-zero value as enabled, so do not use truthiness here.
  const isBold = style.bold === true;
  const isItalic = style.italic === true;
  const positionTag = style.position === 'custom' ? `{\\an5\\pos(${Math.round(((style.customX ?? 50) / 100) * 1920)},${Math.round(((style.customY ?? 82) / 100) * 1080)})}` : '';
  const lines = cues.filter((cue) => cue.enabled).map((cue) => { const content = style.content === 'original' ? cue.originalText : style.content === 'both' ? `${cue.originalText}\\N${cue.translatedText || cue.originalText}` : (cue.translatedText || cue.originalText); const escaped = content.replace(/\r?\n/g, '\\N').replace(/[{}]/g, ''); return `Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Default,,0,0,0,,${positionTag}${escaped}`; });
  // This follows the preview: only the “Viền chữ” mode draws a stroke.  Box
  // subtitles have a background but no surprise outline after export.
  const outlineWidth = style.background === 'outline' ? Math.max(0, Math.round(style.outlineWidth ?? 2)) : 0;
  const marginV = style.position === 'top' ? 97 : style.position === 'bottom' ? 108 : 0;
  return `[Script Info]\nScriptType: v4.00+\nScaledBorderAndShadow: yes\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontFamily},${style.fontSize},${assColor(style.textColor)},${assColor(style.textColor)},${assColor(style.outlineColor)},${back},${isBold ? -1 : 0},${isItalic ? -1 : 0},0,0,100,100,0,0,${borderStyle},${outlineWidth},0,${alignment},154,154,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`;
}

export function subtitleStats(cue: SubtitleCue) { const seconds = Math.max((cue.endMs - cue.startMs) / 1000, 0.001); const chars = (cue.translatedText || cue.originalText).replace(/\s/g, '').length; return { cps: chars / seconds, duration: cue.endMs - cue.startMs }; }
export function validateCues(cues: SubtitleCue[]) { const errors: string[] = []; cues.forEach((cue, index) => { if (!cue.id.trim()) errors.push(`Cue ${index + 1} thiếu id.`); if (cue.endMs <= cue.startMs) errors.push(`Cue ${cue.index} có timestamp không hợp lệ.`); if (cue.startMs < 0) errors.push(`Cue ${cue.index} có start âm.`); if (!cue.originalText.trim() && !cue.translatedText.trim()) errors.push(`Cue ${cue.index} không có nội dung.`); }); return { valid: errors.length === 0, errors }; }
export function downloadText(name: string, text: string, type = 'text/plain') { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
