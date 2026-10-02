export type ThumbnailScoreSet = {
  titleComplementarity: number;
  visualSimplicity: number;
  mobileReadability: number;
  curiosityGap: number;
  semanticAccuracy: number;
  emotionalClarity: number;
  contrastStrength: number;
  clickability: number;
};

export type ThumbnailVariant = 'face' | 'action' | 'confrontation' | 'mystery';

export type ThumbnailConceptCandidate = {
  title?: string;
  /** Legacy single-block text. Used only when hook/context are absent. */
  text?: string;
  hookText?: string;
  contextText?: string;
  prompt?: string;
  angle?: string;
  variant?: ThumbnailVariant | string;
  scores?: Partial<ThumbnailScoreSet>;
};

export type RankedThumbnailConcept = {
  title: string;
  text: string;
  hookText: string;
  contextText: string;
  prompt: string;
  angle: string;
  variant: ThumbnailVariant;
  scores: ThumbnailScoreSet;
  totalScore: number;
};

export const thumbnailPackagingRules = [
  'Treat title + thumbnail as one packaging unit: the title carries searchable topic/context while the thumbnail adds payoff, emotion, consequence, conflict or curiosity.',
  'Generate four meaningfully different packaging families: face, action, confrontation and mystery.',
  'Use one dominant focal point and a simple composition that remains understandable around 120 px wide.',
  'Use strong foreground/background separation and high local contrast; remove decorative clutter and tiny objects.',
  'Use two intentional text lines when language-safe: line 1 is a 2-3 word power hook; line 2 is a 5-8 word context line that answers what/who/why without merely repeating line 1 or the full video title.',
  'Keep the main face/subject large enough for mobile viewing; for face variants, the face should occupy roughly 40-50% of the frame and show an unmistakable non-neutral emotion.',
  'Prefer concrete visual proof: result, threat, scale contrast, surprising mechanism, reaction or consequence.',
  'Every concept must remain semantically accurate to the video and must not promise a result the video does not support.',
  'Four final concepts must be genuine A/B alternatives rather than cosmetic variants.',
  'After generation, review the ACTUAL rendered thumbnail for text accuracy, subject size, emotion, contrast, curiosity and semantic accuracy; weak variants must be regenerated rather than accepted because their prompt plan looked good.',
].join(' ');

const clamp = (value: unknown, fallback = 5) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : fallback;
};

const normalizedTokens = (value: string) => String(value || '')
  .toLocaleLowerCase('vi')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9$€£¥₫%]+/g, ' ')
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const stopWords = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'from', 'this', 'that',
  'why', 'what', 'how', 'when', 'where', 'who', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'on', 'at', 'by', 'your', 'you',
  'va', 'la', 'cua', 'cho', 'voi', 'tu', 'tai', 'sao', 'nhu', 'mot', 'nhung',
]);

function meaningfulTokens(value: string) {
  return normalizedTokens(value).filter((token) => !stopWords.has(token));
}

function titleOverlap(title: string, text: string) {
  const titleTokens = new Set(meaningfulTokens(title));
  const textTokens = meaningfulTokens(text);
  if (!textTokens.length || !titleTokens.size) return 0;
  const overlap = textTokens.filter((token) => titleTokens.has(token)).length;
  return overlap / textTokens.length;
}

function sanitizeLine(value: string, minWords: number, maxWords: number, maxLength: number) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const words = raw.split(/\s+/).slice(0, maxWords);
  let text = words.join(' ');
  if (text.length > maxLength) {
    const within = words.filter((_word, index) => words.slice(0, index + 1).join(' ').length <= maxLength);
    text = within.join(' ');
  }
  if (text.split(/\s+/).filter(Boolean).length < minWords && raw.split(/\s+/).length >= minWords) {
    return raw.split(/\s+/).slice(0, minWords).join(' ').slice(0, maxLength).trim();
  }
  return text;
}

function normalizeVariant(value: unknown, index: number): ThumbnailVariant {
  const raw = String(value || '').trim().toLocaleLowerCase('en');
  if (raw === 'face' || raw === 'action' || raw === 'confrontation' || raw === 'mystery') return raw;
  return (['face', 'action', 'confrontation', 'mystery'] as ThumbnailVariant[])[index % 4];
}

export function rankThumbnailConcept(title: string, candidate: ThumbnailConceptCandidate, index = 0): RankedThumbnailConcept {
  const legacy = String(candidate.text || '').trim();
  const rawHook = String(candidate.hookText || legacy).replace(/\s+/g, ' ').trim();
  const rawContext = String(candidate.contextText || '').replace(/\s+/g, ' ').trim();
  const hookText = sanitizeLine(rawHook, 2, 3, 28);
  const contextText = sanitizeLine(rawContext, 0, 8, 64);
  const combinedText = [hookText, contextText].filter(Boolean).join(' ');
  const overlap = titleOverlap(title, combinedText);
  const rawHookWords = rawHook.split(/\s+/).filter(Boolean).length;
  const rawContextWords = rawContext.split(/\s+/).filter(Boolean).length;
  const hookReadable = !rawHook || (rawHookWords >= 2 && rawHookWords <= 3 && rawHook.length <= 28);
  const contextReadable = !rawContext || (rawContextWords >= 5 && rawContextWords <= 8 && rawContext.length <= 64);
  const localMobile = hookReadable && contextReadable ? 10 : rawHookWords <= 4 && rawContextWords <= 9 ? 5 : 2;
  const localComplement = !combinedText ? 8 : overlap >= .8 ? 1 : overlap >= .55 ? 4 : overlap >= .34 ? 7 : 10;
  const variant = normalizeVariant(candidate.variant || candidate.angle, index);

  const supplied = candidate.scores || {};
  const scores: ThumbnailScoreSet = {
    titleComplementarity: Math.min(clamp(supplied.titleComplementarity, 8), localComplement),
    visualSimplicity: clamp(supplied.visualSimplicity, 8),
    mobileReadability: Math.min(clamp(supplied.mobileReadability, 8), localMobile),
    curiosityGap: clamp(supplied.curiosityGap, 7),
    semanticAccuracy: clamp(supplied.semanticAccuracy, 8),
    emotionalClarity: clamp(supplied.emotionalClarity, variant === 'face' ? 9 : 8),
    contrastStrength: clamp(supplied.contrastStrength, 8),
    clickability: clamp(supplied.clickability, 8),
  };
  const totalScore = Number((
    scores.titleComplementarity * .16 +
    scores.visualSimplicity * .12 +
    scores.mobileReadability * .16 +
    scores.curiosityGap * .14 +
    scores.semanticAccuracy * .16 +
    scores.emotionalClarity * .10 +
    scores.contrastStrength * .08 +
    scores.clickability * .08
  ).toFixed(2));

  return {
    title: String(candidate.title || `Concept ${index + 1}`).trim().slice(0, 80),
    text: hookText,
    hookText,
    contextText,
    prompt: String(candidate.prompt || '').trim().slice(0, 2400),
    angle: String(candidate.angle || variant).trim().toLocaleLowerCase('vi').slice(0, 40),
    variant,
    scores,
    totalScore,
  };
}

export function selectThumbnailConcepts(title: string, candidates: ThumbnailConceptCandidate[], count = 4) {
  const ranked = candidates
    .map((candidate, index) => rankThumbnailConcept(title, candidate, index))
    .filter((candidate) => candidate.prompt.length >= 24)
    .sort((a, b) => b.totalScore - a.totalScore);

  const selected: RankedThumbnailConcept[] = [];
  const requiredVariants: ThumbnailVariant[] = ['face', 'action', 'confrontation', 'mystery'];
  for (const variant of requiredVariants) {
    const candidate = ranked.find((item) => item.variant === variant && !selected.includes(item));
    if (candidate) selected.push(candidate);
    if (selected.length >= count) return selected.slice(0, count);
  }
  for (const candidate of ranked) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= count) break;
  }
  return selected.slice(0, count);
}
