import type { SubtitleSegment } from '../types';

const finiteTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Remove only segments that Whisper itself marks as both silence and low confidence. */
export function filterLowConfidenceWhisperSegments(segments: SubtitleSegment[]) {
  return segments.filter((segment) => {
    const noSpeech = segment.no_speech_prob;
    const logProbability = segment.avg_logprob;
    if (!finiteTimestamp(noSpeech) || !finiteTimestamp(logProbability)) return true;
    return !(noSpeech > 0.6 && logProbability < -1);
  });
}

/** Add a chunk's absolute offset without deriving timestamps from adjacent speech. */
export function offsetSubtitleSegments(segments: SubtitleSegment[], offsetSeconds: number) {
  const offset = finiteTimestamp(offsetSeconds) ? offsetSeconds : 0;
  return segments.map((segment) => ({
    ...segment,
    ...(finiteTimestamp(segment.start) ? { start: segment.start + offset } : {}),
    ...(finiteTimestamp(segment.end) ? { end: segment.end + offset } : {}),
    ...(Array.isArray(segment.words) ? {
      words: segment.words.map((word) => ({
        ...word,
        ...(finiteTimestamp(word.start) ? { start: word.start + offset } : {}),
        ...(finiteTimestamp(word.end) ? { end: word.end + offset } : {}),
        ...(finiteTimestamp(word.startMs) ? { startMs: word.startMs + offset * 1000 } : {}),
        ...(finiteTimestamp(word.endMs) ? { endMs: word.endMs + offset * 1000 } : {}),
      })),
    } : {}),
  }));
}

/**
 * Repair overlaps without touching intentional gaps. A later cue that crosses
 * the previous end is shifted forward; a cue fully nested in the previous cue
 * keeps its own provider timestamps and clips the previous cue at its start.
 */
export function normalizeCueTimeline<T extends { startMs: number; endMs: number }>(cues: T[]) {
  const normalized: T[] = [];
  for (const cue of cues) {
    const previous = normalized.at(-1);
    if (!previous || cue.startMs >= previous.endMs) {
      normalized.push({ ...cue });
      continue;
    }
    if (cue.endMs > previous.endMs) {
      normalized.push({ ...cue, startMs: previous.endMs });
      continue;
    }
    if (cue.startMs > previous.startMs && cue.endMs > cue.startMs) {
      previous.endMs = cue.startMs;
      normalized.push({ ...cue });
    } else {
      // Keep malformed/out-of-order entries intact so cue indexes and
      // alignment metadata remain one-to-one; the editor resolves ties by
      // choosing the latest-starting active cue.
      normalized.push({ ...cue });
    }
  }
  return normalized;
}

export function segmentsToCues(segments: SubtitleSegment[]) {
  const cues = segments
    .filter((segment) => typeof segment.text === 'string' && segment.text.trim())
    .map((segment, index) => {
      const start = finiteTimestamp(segment.start) ? segment.start : 0;
      const end = finiteTimestamp(segment.end) ? segment.end : start + 2;
      return {
        id: `stt-${index + 1}-${Date.now()}`,
        index: index + 1,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        originalText: segment.text?.trim() || '',
        translatedText: '',
        voiceGroup: 'G1' as const,
        enabled: true,
        ...(Array.isArray(segment.words) && segment.words.length ? { words: segment.words } : {}),
      };
    });
  return normalizeCueTimeline(cues);
}
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
const similarity = (a: string, b: string) => { if (a === b) return 1; const aa = new Set(a.split('')); const bb = new Set(b.split('')); const intersection = [...aa].filter((char) => bb.has(char)).length; return intersection / Math.max(aa.size, bb.size, 1); };

function parseOcrJsonPayload(value: string): unknown {
  let source = value.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^json\s*(?=[\[{])/i, '')
    .trim();
  if (!source) return undefined;
  const attempts = [source];
  const arrayStart = source.indexOf('[');
  const arrayEnd = source.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) attempts.push(source.slice(arrayStart, arrayEnd + 1));
  const objectStart = source.indexOf('{');
  const objectEnd = source.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) attempts.push(source.slice(objectStart, objectEnd + 1));
  for (const attempt of attempts) {
    try { return JSON.parse(attempt) as unknown; } catch { /* Try the next provider wrapper. */ }
  }
  const lineObjects = source.split(/\r?\n/).flatMap((line) => {
    const cleaned = line.trim().replace(/^,|,$/g, '');
    if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) return [];
    try { return [JSON.parse(cleaned) as unknown]; } catch { return []; }
  });
  return lineObjects.length ? lineObjects : undefined;
}

function ocrPayloadItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  const record = parsed as Record<string, unknown>;
  const nested = record.blocks || record.regions || record.texts || record.lines;
  return Array.isArray(nested) ? nested : [record];
}

export function parseOcrTextBlocks(value: string) {
  const source = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').replace(/^json\s*(?=[\[{])/i, '').trim();
  if (!source || source === '""' || source === "''") return [];
  const parsed = parseOcrJsonPayload(source);
  const parsedItems = ocrPayloadItems(parsed);
  const recoveredJsonTexts = [...source.matchAll(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/g)].flatMap((match) => {
    try { return [JSON.parse(`"${match[1]}"`) as string]; } catch { return [match[1]]; }
  });
  const candidates: unknown = parsedItems.length ? parsedItems : recoveredJsonTexts.length ? recoveredJsonTexts : source;
  const values = Array.isArray(candidates)
    ? candidates.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, unknown>).text || '') : '')
    : String(candidates).split(/\r?\n/);
  const seen = new Set<string>();
  return values
    .map((line) => line.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '').trim())
    .filter((line) => !/^```|^json$/i.test(line) && !/^\s*[\[{].*"(?:text|kind|xPercent|yPercent)"/i.test(line))
    .filter((line) => {
      const key = normalize(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

type OcrTextBlock = { text: string; kind: 'subtitle' | 'onscreen-text'; screenPosition?: { xPercent: number; yPercent: number } };
function parseOcrBlocks(value: string): OcrTextBlock[] {
  const texts = parseOcrTextBlocks(value);
  const metadata = new Map<string, Omit<OcrTextBlock, 'text'>>();
  const items = ocrPayloadItems(parseOcrJsonPayload(value));
  if (items.length) {
    items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const record = item as Record<string, unknown>;
      const key = normalize(String(record.text || ''));
      const rawKind = String(record.kind || record.type || record.category || '').toLowerCase();
      const xPercent = Number(record.xPercent ?? record.x ?? record.centerX);
      const yPercent = Number(record.yPercent ?? record.y ?? record.centerY);
      if (key) metadata.set(key, {
        kind: ['onscreen-text', 'onscreen_text', 'title', 'label', 'logo'].includes(rawKind) ? 'onscreen-text' : 'subtitle',
        ...(Number.isFinite(xPercent) && Number.isFinite(yPercent) ? { screenPosition: { xPercent: Math.max(0, Math.min(100, xPercent)), yPercent: Math.max(0, Math.min(100, yPercent)) } } : {}),
      });
    });
  }
  return texts.map((text) => ({ text, kind: 'subtitle', ...(metadata.get(normalize(text)) || {}) }));
}

export function groupOcrResults(
  results: Array<{ text: string; timestampMs: number }>,
  filterWatermark: boolean,
  frameIntervalMs = 500,
  roi: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 100, h: 100 },
) {
  const frames = results
    .map((item) => ({
      timestampMs: item.timestampMs,
      blocks: parseOcrBlocks(item.text).map((block) => {
        if (!block.screenPosition) return block;
        const screenPosition = {
          xPercent: Math.max(0, Math.min(100, roi.x + block.screenPosition.xPercent * roi.w / 100)),
          yPercent: Math.max(0, Math.min(100, roi.y + block.screenPosition.yPercent * roi.h / 100)),
        };
        // Vision models sometimes alternate the same top/side title between
        // "subtitle" and "onscreen-text" on consecutive frames. Only the
        // conventional lower-centre caption band is allowed to override an
        // onscreen classification; this keeps one visual object on one track.
        const insideSubtitleBand = screenPosition.yPercent >= 68
          && screenPosition.xPercent >= 15
          && screenPosition.xPercent <= 85;
        return {
          ...block,
          kind: block.kind === 'subtitle' && !insideSubtitleBand ? 'onscreen-text' as const : block.kind,
          screenPosition,
        };
      }),
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const appearances = new Map<string, { count: number; firstMs: number; lastMs: number }>();
  frames.forEach((frame) => {
    frame.blocks.forEach(({ text }) => {
      const key = normalize(text);
      const current = appearances.get(key);
      appearances.set(key, current
        ? { count: current.count + 1, firstMs: current.firstMs, lastMs: frame.timestampMs }
        : { count: 1, firstMs: frame.timestampMs, lastMs: frame.timestampMs });
    });
  });
  const timelineSpan = Math.max(frameIntervalMs, (frames.at(-1)?.timestampMs || 0) - (frames[0]?.timestampMs || 0) + frameIntervalMs);
  const isWatermark = (text: string) => {
    const key = normalize(text);
    if (!filterWatermark || !key || frames.length < 10) return false;
    const appearance = appearances.get(key);
    return Boolean(appearance
      && appearance.count / frames.length >= 0.8
      && appearance.lastMs - appearance.firstMs >= Math.max(3000, timelineSpan * 0.7));
  };
  type Group = { text: string; kind: OcrTextBlock['kind']; screenPosition?: OcrTextBlock['screenPosition']; startMs: number; endMs: number; order: number; candidates: Map<string, { text: string; count: number }> };
  const groups: Group[] = [];
  let active: Group[] = [];
  for (const frame of frames) {
    const blocks = frame.blocks.filter((block) => !isWatermark(block.text));
    const matched = new Set<Group>();
    for (const [order, block] of blocks.entries()) {
      const { text, kind, screenPosition } = block;
      const normalized = normalize(text);
      const match = active
        .filter((group) => {
          if (matched.has(group) || group.kind !== kind) return false;
          const graceMs = kind === 'onscreen-text' ? Math.max(5000, frameIntervalMs * 10) : 3000;
          if (frame.timestampMs - group.endMs >= graceMs) return false;
          if (!screenPosition || !group.screenPosition) return true;
          return Math.hypot(
            screenPosition.xPercent - group.screenPosition.xPercent,
            screenPosition.yPercent - group.screenPosition.yPercent,
          ) <= 12;
        })
        .map((group) => ({ group, score: similarity(normalize(group.text), normalized) }))
        .filter((candidate) => candidate.score > .82)
        .sort((left, right) => right.score - left.score)[0]?.group;
      if (match) {
        match.endMs = frame.timestampMs;
        if (kind === 'subtitle') match.kind = 'subtitle';
        if (screenPosition) match.screenPosition = screenPosition;
        matched.add(match);
        const candidate = match.candidates.get(normalized);
        match.candidates.set(normalized, candidate ? { ...candidate, count: candidate.count + 1 } : { text, count: 1 });
        const best = [...match.candidates.values()].sort((left, right) => right.count - left.count || right.text.length - left.text.length)[0];
        if (best) match.text = best.text;
      } else {

        const group: Group = { text, kind, screenPosition, startMs: frame.timestampMs, endMs: frame.timestampMs, order, candidates: new Map([[normalized, { text, count: 1 }]]) };
        groups.push(group);
        active.push(group);
        matched.add(group);
      }
    }
    active = active.filter((group) => {
      if (matched.has(group)) return true;
      if (group.kind === 'onscreen-text' && frame.timestampMs - group.endMs < Math.max(5000, frameIntervalMs * 10)) return true;
      if (group.kind === 'subtitle') group.endMs = Math.max(group.endMs, frame.timestampMs - frameIntervalMs);
      return false;
    });
  }
  return groups
    .sort((left, right) => left.startMs - right.startMs || left.order - right.order)
    .map((group, index) => ({ id: `ocr-${index + 1}-${Date.now()}`, index: index + 1, startMs: group.startMs, endMs: Math.max(group.startMs + frameIntervalMs, group.endMs + frameIntervalMs), originalText: group.text, translatedText: '', voiceGroup: 'G1' as const, enabled: true, sourceKind: group.kind, ...(group.kind === 'onscreen-text' ? { textOrigin: 'ocr' as const } : {}), ...(group.screenPosition ? { screenPosition: group.screenPosition } : {}) }));
}
export function hasSignificantFrameChange(previous: Buffer | undefined, current: Buffer, threshold = 0.08) { if (!previous) return true; const samples = 512; let changed = 0; for (let index = 0; index < samples; index += 1) { const currentIndex = Math.floor((index / samples) * current.length); const previousIndex = Math.floor((index / samples) * previous.length); if (Math.abs((current[currentIndex] || 0) - (previous[previousIndex] || 0)) > 14) changed += 1; } return changed / samples >= threshold; }
