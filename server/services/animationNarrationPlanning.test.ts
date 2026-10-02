import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateNarrationWordBudget,
  buildNarrationSectionBudget,
  defaultNarrationWordsPerSecond,
  estimatedNarrationDurationMs,
  narrationTimingDecision,
  narrationVoiceRateProfile,
  observeNarrationVoiceRate,
  preflightNarration,
  selectNarrationRepairScenes,
  targetNarrationWords,
} from './animationNarrationPlanning';

test('voice-rate calibration learns from measured TTS and reuses it for planning', () => {
  const providerId = 'test-provider';
  const model = 'voice-model';
  const voice = 'voice-a';
  const profile = observeNarrationVoiceRate({
    providerId,
    model,
    voice,
    speed: 1,
    text: 'một hai ba bốn năm sáu bảy tám chín mười',
    durationMs: 4000,
  });
  assert.ok(profile);
  assert.equal(Math.round((profile?.wordsPerSecond || 0) * 100) / 100, 2.5);
  assert.equal(narrationVoiceRateProfile(providerId, model, voice, 1)?.samples, 1);
  assert.equal(estimatedNarrationDurationMs({ text: 'một hai ba bốn năm', providerId, model, voice, speed: 1 }), 2000);
});

test('time-first narration budget converts scene seconds to target words before TTS', () => {
  const plan = allocateNarrationWordBudget({
    sceneDurationsMs: [12_000, 18_000, 30_000],
    providerId: 'fresh-provider',
    model: 'm',
    voice: 'v',
    speed: 1,
    fallbackWordsPerSecond: 2.5,
  });
  assert.deepEqual(plan.map((item) => item.targetWords), [30, 45, 74]);
  assert.equal(targetNarrationWords({ durationMs: 10_000, providerId: 'new', model: 'm', voice: 'v', fallbackWordsPerSecond: 2.5 }), 25);
});

test('timing decision prevents repeated whole-script TTS fitting', () => {
  assert.equal(narrationTimingDecision(299_000, 300_000).action, 'lock');
  assert.equal(narrationTimingDecision(296_000, 300_000).action, 'breathing-room');
  assert.equal(narrationTimingDecision(294_000, 300_000).action, 'local-repair');
  assert.equal(narrationTimingDecision(288_000, 300_000).action, 'local-repair');
  assert.equal(narrationTimingDecision(252_000, 300_000).action, 'script-enrich');
  assert.equal(narrationTimingDecision(326_000, 300_000).action, 'script-trim');
  assert.equal(narrationTimingDecision(55_500, 60_000).action, 'local-repair');
  assert.equal(narrationTimingDecision(52_000, 60_000).action, 'script-enrich');
});

test('Vietnamese first-pass planning uses a faster baseline than English', () => {
  assert.equal(defaultNarrationWordsPerSecond('Vietnamese'), 3.55);
  assert.equal(defaultNarrationWordsPerSecond('vi'), 3.55);
  assert.ok(defaultNarrationWordsPerSecond('Vietnamese') > defaultNarrationWordsPerSecond('English'));
});

test('five-minute section planning locks hook, promise, development and payoff before prose', () => {
  const sections = buildNarrationSectionBudget({
    targetDurationMs: 300_000,
    providerId: 'vieneu-local',
    model: 'm',
    voice: 'v',
    languageHint: 'Vietnamese',
  });
  assert.deepEqual(sections.map((item) => item.id), ['hook', 'promise', 'development-a', 'development-b', 'payoff', 'close']);
  assert.equal(sections[0].startMs, 0);
  assert.equal(sections[0].endMs, 12_000);
  assert.equal(sections[1].endMs, 30_000);
  assert.equal(sections.at(-1)?.endMs, 300_000);
  const totalWords = sections.reduce((sum, item) => sum + item.targetWords, 0);
  assert.ok(totalWords >= 1150 && totalWords <= 1170, 'Vietnamese 5-minute draft should budget close to the measured VieNeu 1.00x rate instead of underfilling by ~30 seconds');
});

test('preflight catches the 252s-in-a-300s failure before full TTS search loops', () => {
  const words = Array.from({ length: 794 }, (_, index) => `t${index}`).join(' ');
  const result = preflightNarration({
    texts: [words],
    targetDurationMs: 300_000,
    providerId: 'new-vi-preflight',
    model: 'm',
    voice: 'v',
    languageHint: 'Vietnamese',
  });
  assert.equal(result.action, 'script-enrich');
  assert.ok(result.estimatedMs < 270_000);
});

test('five-minute Vietnamese preflight rejects the old ~4m29 underfill before TTS', () => {
  const words = Array.from({ length: 1050 }, (_, index) => `t${index}`).join(' ');
  const result = preflightNarration({
    texts: [words],
    targetDurationMs: 300_000,
    providerId: 'fresh-vi-429-regression',
    model: 'm',
    voice: 'v',
    speed: 1,
    languageHint: 'Vietnamese',
  });
  assert.equal(result.action, 'script-enrich');
  assert.ok(result.estimatedMs >= 268_000 && result.estimatedMs <= 271_000);
});

test('local repair selects only scenes with the largest meaningful timing misses', () => {
  const selected = selectNarrationRepairScenes({
    measuredDurationsMs: [10_000, 8_000, 19_000, 10_200, 6_000, 10_000],
    targetDurationsMs: [10_000, 10_000, 10_000, 10_000, 10_000, 10_000],
    maxScenes: 2,
  });
  assert.deepEqual(selected.map((item) => item.sceneIndex), [2, 4]);
});
