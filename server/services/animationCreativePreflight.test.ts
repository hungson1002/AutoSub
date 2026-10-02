import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedReferenceFilmVisualCount, referenceFilmCreativePreflight, referenceFilmVisualCountEnvelope } from './animationCreativePreflight';

test('reference-film visual expectations match the measured benchmark scale', () => {
  assert.equal(expectedReferenceFilmVisualCount(120), 38);
  assert.ok(expectedReferenceFilmVisualCount(300) >= 79 && expectedReferenceFilmVisualCount(300) <= 81);
  const envelope = referenceFilmVisualCountEnvelope(268.2);
  assert.ok(envelope.min <= 60);
  assert.ok(envelope.max >= 85);
});

test('creative preflight accepts 81 visuals across a 268.2s measured timeline', () => {
  const segments = Array.from({ length: 12 }, (_, index) => ({
    title: String(index + 1),
    visualBeats: Array.from({ length: index < 3 ? 8 : index < 6 ? 7 : 6 }, () => ({ visual: 'frame' })),
  }));
  // 3*8 + 3*7 + 6*6 = 81; the first minute still carries reference-like density.
  const sceneDurationsMs = [22_000,22_000,22_000,22_000,22_000,22_000,22_000,22_000,22_000,23_400,23_400,23_400];
  const result = referenceFilmCreativePreflight({ segments, sceneDurationsMs });
  assert.equal(result.metrics.visualCount, 81);
  assert.ok(result.metrics.expectedVisualMin <= 81);
  assert.ok(result.metrics.expectedVisualMax >= 81);
  assert.equal(result.errors.some((item) => /visual|cadence/i.test(item)), false);
});

test('creative cadence deviations warn but do not block renderable storyboards', () => {
  const segments = Array.from({ length: 10 }, (_, index) => ({
    title: String(index),
    visualBeats: Array.from({ length: index < 4 ? 2 : 4 }, () => ({ visual: 'frame' })),
  }));
  const result = referenceFilmCreativePreflight({
    segments,
    sceneDurationsMs: [15_000, 15_000, 15_000, 15_000, 10_000, 10_000, 10_000, 10_000, 5_000, 5_000],
  });
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((item) => /cadence|visual/i.test(item)));
});

test('54.6s storyboard with 25 visuals is allowed and only warns about cadence', () => {
  const segments = Array.from({ length: 5 }, (_, index) => ({
    title: String(index + 1),
    visualBeats: Array.from({ length: 5 }, () => ({ visual: 'frame' })),
  }));
  const result = referenceFilmCreativePreflight({
    segments,
    sceneDurationsMs: [10_920, 10_920, 10_920, 10_920, 10_920],
    targetDurationMs: 54_600,
  });
  assert.equal(result.metrics.visualCount, 25);
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((item) => /cadence/i.test(item)));
});

test('creative preflight accepts a two-minute plan near reference cadence', () => {
  const segments = [
    { visualBeats: Array.from({ length: 6 }, () => ({ visual: 'frame' })) },
    { visualBeats: Array.from({ length: 6 }, () => ({ visual: 'frame' })) },
    { visualBeats: Array.from({ length: 6 }, () => ({ visual: 'frame' })) },
    { visualBeats: Array.from({ length: 6 }, () => ({ visual: 'frame' })) },
    { visualBeats: Array.from({ length: 4 }, () => ({ visual: 'frame' })) },
    { visualBeats: Array.from({ length: 4 }, () => ({ visual: 'frame' })) },
    { visualBeats: Array.from({ length: 3 }, () => ({ visual: 'frame' })) },
    { visualBeats: Array.from({ length: 3 }, () => ({ visual: 'frame' })) },
  ];
  const result = referenceFilmCreativePreflight({
    segments,
    sceneDurationsMs: [15_000,15_000,15_000,15_000,15_000,15_000,15_000,15_000],
    targetDurationMs: 120_000,
  });
  assert.equal(result.metrics.visualCount, 38);
  assert.equal(result.errors.length, 0);
});
