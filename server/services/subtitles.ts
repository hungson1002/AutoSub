import type { SubtitleSegment } from '../types';

type OcrSymbolLanguage = 'vi' | 'en' | 'zh' | 'ko';
const ocrSymbolWords: Record<OcrSymbolLanguage, Record<string, string>> = {
  vi: { '±': 'cộng hoặc trừ', '≠': 'không bằng', '≤': 'nhỏ hơn hoặc bằng', '≥': 'lớn hơn hoặc bằng', '+': 'cộng', '-': 'trừ', '=': 'bằng', '×': 'nhân', '÷': 'chia', '%': 'phần trăm', '→': 'dẫn đến' },
  en: { '±': 'plus or minus', '≠': 'not equal to', '≤': 'less than or equal to', '≥': 'greater than or equal to', '+': 'plus', '-': 'minus', '=': 'equals', '×': 'times', '÷': 'divided by', '%': 'percent', '→': 'leads to' },
  zh: { '±': '正负', '≠': '不等于', '≤': '小于等于', '≥': '大于等于', '+': '加', '-': '减', '=': '等于', '×': '乘以', '÷': '除以', '%': '百分比', '→': '得到' },
  ko: { '±': '플러스 마이너스', '≠': '같지 않음', '≤': '작거나 같음', '≥': '크거나 같음', '+': '더하기', '-': '빼기', '=': '같음', '×': '곱하기', '÷': '나누기', '%': '퍼센트', '→': '결과는' },
};

const ocrSymbolLanguage = (language: string, text: string): OcrSymbolLanguage => {
  const normalized = language.trim().toLocaleLowerCase();
  if (normalized === 'vi' || normalized.includes('việt')) return 'vi';
  if (normalized === 'zh' || normalized.includes('中文') || normalized.includes('chinese')) return 'zh';
  if (normalized === 'ko' || normalized.includes('한국') || normalized.includes('korean')) return 'ko';
  if (normalized === 'en' || normalized.includes('english')) return 'en';
  if (/\p{Script=Hangul}/u.test(text)) return 'ko';
  if (/\p{Script=Han}/u.test(text)) return 'zh';
  if (/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu.test(text)) return 'vi';
  return 'en';
};

const viDigits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function vietnameseTriple(value: number, includeHundreds: boolean) {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const units = value % 10;
  const words: string[] = [];
  if (hundreds || includeHundreds) words.push(viDigits[hundreds], 'trăm');
  if (tens > 1) words.push(viDigits[tens], 'mươi');
  else if (tens === 1) words.push('mười');
  else if (units && (hundreds || includeHundreds)) words.push('lẻ');
  if (units) {
    if (units === 1 && tens > 1) words.push('mốt');
    else if (units === 4 && tens > 1) words.push('tư');
    else if (units === 5 && tens >= 1) words.push('lăm');
    else words.push(viDigits[units]);
  }
  return words.join(' ');
}

function vietnameseInteger(raw: string) {
  const digits = raw.replace(/^0+(?=\d)/, '');
  if (digits.length > 15) return digits.split('').map((digit) => viDigits[Number(digit)]).join(' ');
  const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const groups: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(Number(digits.slice(Math.max(0, end - 3), end)));
  const highest = groups.findIndex((group) => group > 0);
  if (highest < 0) return viDigits[0];
  return groups.flatMap((group, index) => {
    if (!group) return [];
    const scaleIndex = groups.length - index - 1;
    return [vietnameseTriple(group, index > highest && group < 100), scales[scaleIndex]].filter(Boolean);
  }).join(' ');
}

function verbalizeNumbers(text: string, language: OcrSymbolLanguage) {
  const digitWords = language === 'zh'
    ? ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
    : language === 'ko'
      ? ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
      : ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  return text.replace(/(?<![\p{L}\p{N}_])(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(?![\p{L}\p{N}_])/gu, (token) => {
    const grouped = /^\d{1,3}(?:[.,]\d{3})+$/.test(token);
    const normalized = grouped ? token.replace(/[.,]/g, '') : token;
    const decimal = grouped ? undefined : /^([0-9]+)[.,]([0-9]+)$/.exec(normalized);
    const integer = decimal?.[1] || normalized;
    const integerWords = language === 'vi'
      ? vietnameseInteger(integer)
      : integer.split('').map((digit) => digitWords[Number(digit)]).join(' ');
    if (!decimal) return integerWords;
    const separator = language === 'vi' ? 'phẩy' : language === 'zh' ? '点' : language === 'ko' ? '점' : 'point';
    return `${integerWords} ${separator} ${decimal[2].split('').map((digit) => language === 'vi' ? viDigits[Number(digit)] : digitWords[Number(digit)]).join(' ')}`;
  });
}

/** Verbalize semantic OCR operators while leaving punctuation untouched. */
export function verbalizeOcrSymbols(text: string, language = 'Auto Detect') {
  const resolvedLanguage = ocrSymbolLanguage(language, text);
  const words = ocrSymbolWords[resolvedLanguage];
  // OCR commonly returns ASCII x, *, / and - instead of their mathematical
  // Unicode forms. Convert them only when they are standalone or beside a
  // number so ordinary words, punctuation and hyphenated prose stay intact.
  const replaceNumericOperator = (value: string, operators: string, word: string) => value.replace(
    new RegExp(`(^|[\\d)\\]])\\s*[${operators}]\\s*(?=[\\d(\\[]|$)`, 'gu'),
    (_match, left: string) => `${left} ${word} `,
  );
  let normalized = replaceNumericOperator(text, 'xX*', words['×']);
  normalized = replaceNumericOperator(normalized, '\\-\u2212', words['-']);
  normalized = replaceNumericOperator(normalized, '\\/', words['÷']);
  return verbalizeNumbers(normalized, resolvedLanguage)
    .replace(/−/gu, ` ${words['-']} `)
    .replace(/[±≠≤≥+=×÷%→]/gu, (symbol) => ` ${words[symbol]} `)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/\s+([.,!?;:…])/gu, '$1').trim())
    .join('\n');
}

const finiteTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const wordSpeaker = (word: NonNullable<SubtitleSegment['words']>[number]) => String(word.speaker_id || word.speakerId || '').trim();

/** Convert diarized word output into readable speaker turns without losing timestamps. */
export function diarizedWordsToSegments(words: NonNullable<SubtitleSegment['words']>) {
  const segments: SubtitleSegment[] = [];
  let current: SubtitleSegment | undefined;
  for (const word of words) {
    const text = String(word.text ?? word.word ?? '');
    if (!text || word.type === 'audio_event') continue;
    const speakerId = wordSpeaker(word) || 'speaker_0';
    const start = finiteTimestamp(word.start) ? word.start : current?.end ?? 0;
    const end = finiteTimestamp(word.end) ? word.end : start;
    const split = !current || current.speakerId !== speakerId || start - (current.end || 0) > 0.9 || /[.!?。！？]\s*$/u.test(current.text || '');
    if (split) {
      current = { start, end, text, words: [word], speakerId };
      segments.push(current);
    } else {
      const active = current!;
      active.text = `${active.text || ''}${text}`;
      active.end = Math.max(active.end || end, end);
      active.words?.push(word);
    }
  }
  return segments.filter((segment) => segment.text?.trim()).map((segment) => ({ ...segment, text: segment.text?.trim() }));
}

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
  const speakers = new Map<string, 'G1' | 'G2' | 'G3'>();
  const groupFor = (speakerId: string) => {
    const existing = speakers.get(speakerId);
    if (existing) return existing;
    const group = (`G${Math.min(3, speakers.size + 1)}`) as 'G1' | 'G2' | 'G3';
    speakers.set(speakerId, group);
    return group;
  };
  const cues = segments
    .filter((segment) => typeof segment.text === 'string' && segment.text.trim())
    .map((segment, index) => {
      const start = finiteTimestamp(segment.start) ? segment.start : 0;
      const end = finiteTimestamp(segment.end) ? segment.end : start + 2;
      const speakerId = String(segment.speakerId || segment.speaker_id || segment.words?.map(wordSpeaker).find(Boolean) || '').trim();
      return {
        id: `stt-${index + 1}-${Date.now()}`,
        index: index + 1,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        originalText: segment.text?.trim() || '',
        translatedText: '',
        voiceGroup: speakerId ? groupFor(speakerId) : 'G1' as const,
        ...(speakerId ? { speakerId } : {}),
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
  language = 'Auto Detect',
) {
  const frames = results
    .map((item) => ({
      timestampMs: item.timestampMs,
      blocks: parseOcrBlocks(item.text).map((block) => {
        block = { ...block, text: verbalizeOcrSymbols(block.text, language) };
        if (!block.screenPosition) return block;
        const screenPosition = {
          xPercent: Math.max(0, Math.min(100, roi.x + block.screenPosition.xPercent * roi.w / 100)),
          yPercent: Math.max(0, Math.min(100, roi.y + block.screenPosition.yPercent * roi.h / 100)),
        };
        return {
          ...block,
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
  type Group = { text: string; kind: OcrTextBlock['kind']; kindVotes: Record<OcrTextBlock['kind'], number>; screenPosition?: OcrTextBlock['screenPosition']; startMs: number; endMs: number; order: number; candidates: Map<string, { text: string; count: number }> };
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
          if (matched.has(group)) return false;
          const graceMs = group.kind === 'onscreen-text' || kind === 'onscreen-text' ? Math.max(5000, frameIntervalMs * 10) : 3000;
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
        match.kindVotes[kind] += 1;
        match.kind = match.kindVotes.subtitle >= match.kindVotes['onscreen-text'] ? 'subtitle' : 'onscreen-text';
        if (screenPosition) match.screenPosition = screenPosition;
        matched.add(match);
        const candidate = match.candidates.get(normalized);
        match.candidates.set(normalized, candidate ? { ...candidate, count: candidate.count + 1 } : { text, count: 1 });
        const best = [...match.candidates.values()].sort((left, right) => right.count - left.count || right.text.length - left.text.length)[0];
        if (best) match.text = best.text;
      } else {

        const group: Group = { text, kind, kindVotes: { subtitle: kind === 'subtitle' ? 1 : 0, 'onscreen-text': kind === 'onscreen-text' ? 1 : 0 }, screenPosition, startMs: frame.timestampMs, endMs: frame.timestampMs, order, candidates: new Map([[normalized, { text, count: 1 }]]) };
        groups.push(group);
        active.push(group);
        matched.add(group);
      }
    }
    active = active.filter((group) => {
      if (matched.has(group)) return true;
      if (group.kind === 'onscreen-text' && frame.timestampMs - group.endMs < Math.max(5000, frameIntervalMs * 10)) return true;
      // OCR occasionally misses one sampled frame while the same subtitle is
      // still visible. Retain it briefly so the next observation extends the
      // same cue instead of producing duplicate dubbing lines.
      if (group.kind === 'subtitle' && frame.timestampMs - group.endMs <= frameIntervalMs * 2) return true;
      return false;
    });
  }
  return groups
    .sort((left, right) => left.startMs - right.startMs || left.order - right.order)
    .map((group, index) => ({ id: `ocr-${index + 1}-${Date.now()}`, index: index + 1, startMs: group.startMs, endMs: Math.max(group.startMs + frameIntervalMs, group.endMs + frameIntervalMs), originalText: group.text, translatedText: '', voiceGroup: 'G1' as const, enabled: true, sourceKind: group.kind, ...(group.kind === 'onscreen-text' ? { textOrigin: 'ocr' as const, ...(group.screenPosition ? { screenPosition: group.screenPosition } : {}) } : {}) }));
}
export function hasSignificantFrameChange(previous: Buffer | undefined, current: Buffer, threshold = 0.08) { if (!previous) return true; const samples = 512; let changed = 0; for (let index = 0; index < samples; index += 1) { const currentIndex = Math.floor((index / samples) * current.length); const previousIndex = Math.floor((index / samples) * previous.length); if (Math.abs((current[currentIndex] || 0) - (previous[previousIndex] || 0)) > 14) changed += 1; } return changed / samples >= threshold; }
