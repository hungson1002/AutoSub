import { REFERENCE_FILM_PROFILE } from './referenceFilmProfile';

export type ReferenceFilmPreflightSegment = {
  title?: string;
  narration?: string;
  visualBeats: Array<{ onScreenText?: string; purpose?: string; visual?: string }>;
};

export type ReferenceFilmCreativePreflight = {
  errors: string[];
  warnings: string[];
  metrics: {
    durationMs: number;
    targetDurationMs?: number;
    visualCount: number;
    expectedVisualMin: number;
    expectedVisualMax: number;
    openingVisualCount: number;
    textVisualCount: number;
    textRatio: number;
  };
};

export function expectedReferenceFilmVisualCount(durationSeconds: number) {
  const seconds = Math.max(1, Number(durationSeconds) || 1);
  const openingSeconds = Math.min(60, seconds);
  const bodySeconds = Math.max(0, seconds - openingSeconds);
  return Math.round(
    openingSeconds / REFERENCE_FILM_PROFILE.openingCadenceSeconds.target
    + bodySeconds / REFERENCE_FILM_PROFILE.bodyCadenceSeconds.target,
  );
}

export function referenceFilmVisualCountEnvelope(durationSeconds: number) {
  const seconds = Math.max(1, Number(durationSeconds) || 1);
  const openingSeconds = Math.min(60, seconds);
  const bodySeconds = Math.max(0, seconds - openingSeconds);

  // Hard validation uses the full measured cadence envelope, not a narrow
  // percentage around the average target. A 3.6s body hold is valid even when
  // it yields materially more cuts than the 4.3s target.
  const min = Math.max(
    1,
    Math.ceil(openingSeconds / REFERENCE_FILM_PROFILE.openingCadenceSeconds.max)
      + Math.ceil(bodySeconds / REFERENCE_FILM_PROFILE.bodyCadenceSeconds.max),
  );
  const max = Math.max(
    min,
    Math.floor(openingSeconds / REFERENCE_FILM_PROFILE.openingCadenceSeconds.min)
      + Math.floor(bodySeconds / REFERENCE_FILM_PROFILE.bodyCadenceSeconds.min),
  );
  return { min, max };
}

export function referenceFilmCreativePreflight(input: {
  segments: ReferenceFilmPreflightSegment[];
  sceneDurationsMs: number[];
  targetDurationMs?: number;
}): ReferenceFilmCreativePreflight {
  const errors: string[] = [];
  const warnings: string[] = [];
  const durationMs = input.sceneDurationsMs.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const durationSeconds = durationMs / 1000;
  const expected = expectedReferenceFilmVisualCount(durationSeconds);
  const envelope = referenceFilmVisualCountEnvelope(durationSeconds);
  const expectedVisualMin = Math.max(input.segments.length, envelope.min);
  const expectedVisualMax = Math.max(expectedVisualMin, envelope.max);
  const visualCount = input.segments.reduce((sum, segment) => sum + segment.visualBeats.length, 0);
  const textVisualCount = input.segments.reduce((sum, segment) => sum + segment.visualBeats.filter((beat) => Boolean(String(beat.onScreenText || '').trim())).length, 0);
  const textRatio = visualCount ? textVisualCount / visualCount : 0;

  if (input.targetDurationMs) {
    const allowed = Math.max(4_000, input.targetDurationMs * 0.03);
    const delta = durationMs - input.targetDurationMs;
    if (Math.abs(delta) > allowed) {
      errors.push(`Final measured timeline differs from target by ${Math.round(delta / 100) / 10}s; repair narration before image generation.`);
    }
  }

  if (visualCount < expectedVisualMin || visualCount > expectedVisualMax) {
    // Cadence is a creative-quality target, not a production invariant. A
    // storyboard that is a few beats denser/sparser is still perfectly
    // renderable and must not kill a long-running video job before image
    // generation. Surface it for review, but keep the pipeline moving.
    warnings.push(`Reference-film cadence suggests about ${expectedVisualMin}-${expectedVisualMax} visuals for ${durationSeconds.toFixed(1)}s (target around ${expected}); storyboard has ${visualCount}.`);
  }

  let cursorMs = 0;
  let openingVisualCount = 0;
  input.segments.forEach((segment, index) => {
    const duration = Math.max(0, Number(input.sceneDurationsMs[index]) || 0);
    const start = cursorMs;
    const end = cursorMs + duration;
    cursorMs = end;
    if (start < 60_000) {
      const overlap = Math.max(0, Math.min(end, 60_000) - start);
      const share = duration > 0 ? Math.min(1, overlap / duration) : 0;
      openingVisualCount += Math.round(segment.visualBeats.length * share);
    }
    const averageHold = segment.visualBeats.length ? duration / segment.visualBeats.length : duration;
    if (duration > 8_000 && segment.visualBeats.length === 1 && averageHold > 8_000) {
      warnings.push(`Scene ${index + 1} holds one visual for ${(averageHold / 1000).toFixed(1)}s; review for a meaningful detail/POV/reaction split.`);
    }
  });

  if (durationMs >= 55_000) {
    const openingSeconds = Math.min(60, durationSeconds);
    const expectedOpening = Math.round(openingSeconds / REFERENCE_FILM_PROFILE.openingCadenceSeconds.target);
    const openingTolerance = 3;
    if (openingVisualCount < expectedOpening - openingTolerance) {
      // Opening density is also stylistic guidance. Never throw away/resume a
      // production job solely because the edit rhythm is slower than the
      // reference film.
      warnings.push(`Opening cadence is slower than the reference: about ${openingVisualCount} visuals in the first ${openingSeconds.toFixed(0)}s; target is about ${expectedOpening}.`);
    }
  }

  if (visualCount >= 20) {
    if (textRatio > 0.38) warnings.push(`On-image text is dense at ${Math.round(textRatio * 100)}%; reference style usually stays around 20-30%.`);
    if (textRatio < 0.08) warnings.push(`On-image text is sparse at ${Math.round(textRatio * 100)}%; use short labels/numbers only where they materially help comprehension.`);
  }

  return {
    errors,
    warnings,
    metrics: {
      durationMs,
      targetDurationMs: input.targetDurationMs,
      visualCount,
      expectedVisualMin,
      expectedVisualMax,
      openingVisualCount,
      textVisualCount,
      textRatio,
    },
  };
}
