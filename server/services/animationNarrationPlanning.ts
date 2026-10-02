export type NarrationVoiceRateProfile = {
  providerId: string;
  model: string;
  voice: string;
  speed: number;
  wordsPerSecond: number;
  samples: number;
};

const profiles = new Map<string, NarrationVoiceRateProfile>();

export type NarrationSectionBudget = {
  id: 'hook' | 'promise' | 'development-a' | 'development-b' | 'payoff' | 'close';
  startMs: number;
  endMs: number;
  durationMs: number;
  targetWords: number;
};

export type NarrationPreflight = {
  estimatedMs: number;
  targetMs: number;
  deltaMs: number;
  occupancy: number;
  action: 'lock' | 'breathing-room' | 'local-repair' | 'script-enrich' | 'script-trim';
};

const normalizedWordCount = (value: string) => String(value || '')
  .replace(/\[(?:laugh|chuckle|sigh|clear\s+throat|cười|thở dài|hắng giọng)\]/giu, ' ')
  .trim()
  .split(/\s+/u)
  .filter(Boolean).length;

const profileKey = (providerId: string, model: string, voice: string, speed: number) =>
  [providerId, model, voice, Math.round(speed * 1000) / 1000].join('|');

export function observeNarrationVoiceRate(input: {
  providerId: string;
  model: string;
  voice: string;
  speed: number;
  text: string;
  durationMs: number;
}) {
  const words = normalizedWordCount(input.text);
  const seconds = Number(input.durationMs) / 1000;
  if (!words || !(seconds > .25)) return undefined;
  const key = profileKey(input.providerId, input.model, input.voice, input.speed);
  const measured = words / seconds;
  const current = profiles.get(key);
  const samples = (current?.samples || 0) + 1;
  const wordsPerSecond = current
    ? current.wordsPerSecond * .72 + measured * .28
    : measured;
  const next: NarrationVoiceRateProfile = {
    providerId: input.providerId,
    model: input.model,
    voice: input.voice,
    speed: input.speed,
    wordsPerSecond: Math.max(.8, Math.min(6, wordsPerSecond)),
    samples,
  };
  profiles.set(key, next);
  return next;
}

export function narrationVoiceRateProfile(providerId: string, model: string, voice: string, speed = 1) {
  return profiles.get(profileKey(providerId, model, voice, speed));
}

export function defaultNarrationWordsPerSecond(languageHint = '') {
  const normalized = String(languageHint || '').toLocaleLowerCase('vi');
  if (/\bvi(?:etnamese)?\b|tiếng\s*việt|tieng\s*viet/u.test(normalized)) return 3.55;
  if (/\b(?:ja|japanese|zh|chinese|ko|korean)\b/u.test(normalized)) return 3.0;
  return 2.65;
}

function resolvedWordsPerSecond(input: {
  providerId: string;
  model: string;
  voice: string;
  speed?: number;
  fallbackWordsPerSecond?: number;
  languageHint?: string;
}) {
  const speed = Math.max(.5, Math.min(2, Number(input.speed) || 1));
  const profile = narrationVoiceRateProfile(input.providerId, input.model, input.voice, speed);
  const languageFallback = defaultNarrationWordsPerSecond(input.languageHint);
  const vietnameseHint = /\bvi(?:etnamese)?\b|tiếng\s*việt|tieng\s*viet/iu.test(String(input.languageHint || ''));
  const providerFallback = vietnameseHint && /vieneu/iu.test(String(input.providerId || ''))
    ? Math.max(languageFallback, 3.9)
    : languageFallback;
  const fallback = Math.max(1.6, Math.min(4.5, Number(input.fallbackWordsPerSecond) || providerFallback));
  return { speed, wordsPerSecond: profile?.wordsPerSecond || fallback * speed };
}

export function estimatedNarrationDurationMs(input: {
  text: string;
  providerId: string;
  model: string;
  voice: string;
  speed?: number;
  fallbackWordsPerSecond?: number;
  languageHint?: string;
}) {
  const words = normalizedWordCount(input.text);
  if (!words) return 0;
  const languageHint = input.languageHint || (/[Ă-ưẠ-ỹ]/u.test(input.text) ? 'Vietnamese' : '');
  const { wordsPerSecond } = resolvedWordsPerSecond({ ...input, languageHint });
  return Math.round(words / Math.max(.8, wordsPerSecond) * 1000);
}

export function targetNarrationWords(input: {
  durationMs: number;
  providerId: string;
  model: string;
  voice: string;
  speed?: number;
  fallbackWordsPerSecond?: number;
  languageHint?: string;
  occupancy?: number;
}) {
  const { wordsPerSecond } = resolvedWordsPerSecond(input);
  const occupancy = Math.max(.82, Math.min(.995, Number(input.occupancy) || .99));
  return Math.max(1, Math.round(input.durationMs / 1000 * wordsPerSecond * occupancy));
}

export function narrationTimingDecision(measuredMs: number, targetMs: number) {
  const deltaMs = measuredMs - targetMs;
  const absMs = Math.abs(deltaMs);
  const safeTargetMs = Math.max(1, targetMs);
  const lockThresholdMs = Math.min(3000, Math.max(1200, safeTargetMs * .01));
  const breathingThresholdMs = Math.min(5000, Math.max(2000, safeTargetMs * .015));
  const localRepairThresholdMs = Math.min(15000, Math.max(5000, safeTargetMs * .05));
  if (absMs <= lockThresholdMs) return { action: 'lock' as const, deltaMs };
  if (deltaMs < 0 && absMs <= breathingThresholdMs) return { action: 'breathing-room' as const, deltaMs };
  if (absMs <= localRepairThresholdMs) return { action: 'local-repair' as const, deltaMs };
  return { action: deltaMs < 0 ? 'script-enrich' as const : 'script-trim' as const, deltaMs };
}

export function allocateNarrationWordBudget(input: {
  sceneDurationsMs: number[];
  providerId: string;
  model: string;
  voice: string;
  speed?: number;
  fallbackWordsPerSecond?: number;
  languageHint?: string;
}) {
  return input.sceneDurationsMs.map((durationMs, index) => ({
    sceneIndex: index,
    durationMs,
    targetWords: targetNarrationWords({
      durationMs,
      providerId: input.providerId,
      model: input.model,
      voice: input.voice,
      speed: input.speed,
      fallbackWordsPerSecond: input.fallbackWordsPerSecond,
      languageHint: input.languageHint,
      occupancy: .99,
    }),
  }));
}

export function buildNarrationSectionBudget(input: {
  targetDurationMs: number;
  providerId: string;
  model: string;
  voice: string;
  speed?: number;
  languageHint?: string;
  fallbackWordsPerSecond?: number;
}) {
  const target = Math.max(30_000, Math.round(input.targetDurationMs));
  const shares: Array<[NarrationSectionBudget['id'], number]> = [
    ['hook', .04],
    ['promise', .06],
    ['development-a', .28],
    ['development-b', .30],
    ['payoff', .22],
    ['close', .10],
  ];
  let cursor = 0;
  return shares.map(([id, share], index) => {
    const endMs = index === shares.length - 1 ? target : Math.round(target * (shares.slice(0, index + 1).reduce((sum, item) => sum + item[1], 0)));
    const durationMs = endMs - cursor;
    const section: NarrationSectionBudget = {
      id,
      startMs: cursor,
      endMs,
      durationMs,
      targetWords: targetNarrationWords({
        durationMs,
        providerId: input.providerId,
        model: input.model,
        voice: input.voice,
        speed: input.speed,
        languageHint: input.languageHint,
        fallbackWordsPerSecond: input.fallbackWordsPerSecond,
        occupancy: .99,
      }),
    };
    cursor = endMs;
    return section;
  });
}

export function preflightNarration(input: {
  texts: string[];
  targetDurationMs: number;
  providerId: string;
  model: string;
  voice: string;
  speed?: number;
  languageHint?: string;
  fallbackWordsPerSecond?: number;
}): NarrationPreflight {
  const estimatedMs = input.texts.reduce((sum, text) => sum + estimatedNarrationDurationMs({
    text,
    providerId: input.providerId,
    model: input.model,
    voice: input.voice,
    speed: input.speed,
    languageHint: input.languageHint,
    fallbackWordsPerSecond: input.fallbackWordsPerSecond,
  }), 0);
  const decision = narrationTimingDecision(estimatedMs, input.targetDurationMs);
  return {
    estimatedMs,
    targetMs: input.targetDurationMs,
    deltaMs: decision.deltaMs,
    occupancy: input.targetDurationMs > 0 ? estimatedMs / input.targetDurationMs : 1,
    action: decision.action,
  };
}

export function selectNarrationRepairScenes(input: {
  measuredDurationsMs: number[];
  targetDurationsMs: number[];
  maxScenes?: number;
}) {
  const count = Math.min(input.measuredDurationsMs.length, input.targetDurationsMs.length);
  const maxScenes = Math.max(1, Math.min(count || 1, input.maxScenes || Math.max(2, Math.ceil(count * .35))));
  return Array.from({ length: count }, (_, index) => {
    const measuredMs = Math.max(1, Number(input.measuredDurationsMs[index]) || 1);
    const targetMs = Math.max(1, Number(input.targetDurationsMs[index]) || 1);
    const deltaMs = measuredMs - targetMs;
    return { sceneIndex: index, measuredMs, targetMs, deltaMs, relativeError: Math.abs(deltaMs) / targetMs };
  })
    .filter((item) => Math.abs(item.deltaMs) > 1200 && item.relativeError > .05)
    .sort((a, b) => b.relativeError - a.relativeError || Math.abs(b.deltaMs) - Math.abs(a.deltaMs))
    .slice(0, maxScenes);
}
