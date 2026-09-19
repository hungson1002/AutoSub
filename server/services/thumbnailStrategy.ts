export type ThumbnailScoreSet = {
  titleComplementarity: number;
  visualSimplicity: number;
  mobileReadability: number;
  curiosityGap: number;
  semanticAccuracy: number;
};

export type ThumbnailConceptCandidate = {
  title?: string;
  text?: string;
  prompt?: string;
  angle?: string;
  scores?: Partial<ThumbnailScoreSet>;
};

export type RankedThumbnailConcept = {
  title: string;
  text: string;
  prompt: string;
  angle: string;
  scores: ThumbnailScoreSet;
  totalScore: number;
};

export const thumbnailPackagingRules = [
  'Treat title + thumbnail as one packaging unit: the title carries searchable topic/context while the thumbnail adds payoff, emotion, consequence, contrast or curiosity.',
  'Use one dominant focal point and a simple composition that remains understandable around 120 px wide.',
  'Use strong foreground/background separation and contrast; remove decorative clutter and tiny objects.',
  'Thumbnail text is optional. When used, keep it to 0-4 words, one text block, and never restate or paraphrase the full title.',
  'Prefer concrete visual proof: result, before/after, scale contrast, surprising mechanism, reaction or consequence.',
  'Every concept must remain semantically accurate to the video and must not promise a result the video does not support.',
  'Three final concepts must use meaningfully different hooks/layouts so they are useful A/B-test alternatives rather than cosmetic variants.',
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

function sanitizeShortText(value: string) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const words = raw.split(/\s+/).slice(0, 4);
  let text = words.join(' ');
  if (text.length > 24) {
    const within = words.filter((_word, index) => words.slice(0, index + 1).join(' ').length <= 24);
    text = within.join(' ');
  }
  return text;
}

export function rankThumbnailConcept(title: string, candidate: ThumbnailConceptCandidate, index = 0): RankedThumbnailConcept {
  const text = sanitizeShortText(String(candidate.text || ''));
  const overlap = titleOverlap(title, text);
  const originalWordCount = String(candidate.text || '').trim().split(/\s+/).filter(Boolean).length;
  const originalLength = String(candidate.text || '').trim().length;
  const localMobile = !text ? 9 : originalWordCount <= 4 && originalLength <= 24 ? 10 : originalWordCount <= 5 ? 5 : 2;
  const localComplement = !text ? 9 : overlap >= .8 ? 1 : overlap >= .55 ? 4 : overlap >= .34 ? 7 : 10;

  const supplied = candidate.scores || {};
  const scores: ThumbnailScoreSet = {
    titleComplementarity: Math.min(clamp(supplied.titleComplementarity, 8), localComplement),
    visualSimplicity: clamp(supplied.visualSimplicity, 8),
    mobileReadability: Math.min(clamp(supplied.mobileReadability, 8), localMobile),
    curiosityGap: clamp(supplied.curiosityGap, 7),
    semanticAccuracy: clamp(supplied.semanticAccuracy, 8),
  };
  const totalScore = Number((
    scores.titleComplementarity * .27 +
    scores.visualSimplicity * .19 +
    scores.mobileReadability * .19 +
    scores.curiosityGap * .16 +
    scores.semanticAccuracy * .19
  ).toFixed(2));

  return {
    title: String(candidate.title || `Concept ${index + 1}`).trim().slice(0, 80),
    text,
    prompt: String(candidate.prompt || '').trim().slice(0, 2400),
    angle: String(candidate.angle || `angle-${index + 1}`).trim().toLocaleLowerCase('vi').slice(0, 40),
    scores,
    totalScore,
  };
}

export function selectThumbnailConcepts(title: string, candidates: ThumbnailConceptCandidate[], count = 3) {
  const ranked = candidates
    .map((candidate, index) => rankThumbnailConcept(title, candidate, index))
    .filter((candidate) => candidate.prompt.length >= 24)
    .sort((a, b) => b.totalScore - a.totalScore);

  const selected: RankedThumbnailConcept[] = [];
  const angles = new Set<string>();
  for (const candidate of ranked) {
    if (angles.has(candidate.angle)) continue;
    selected.push(candidate);
    angles.add(candidate.angle);
    if (selected.length >= count) return selected;
  }
  for (const candidate of ranked) {
    if (selected.some((item) => item.title === candidate.title && item.prompt === candidate.prompt)) continue;
    selected.push(candidate);
    if (selected.length >= count) break;
  }
  return selected.slice(0, count);
}
