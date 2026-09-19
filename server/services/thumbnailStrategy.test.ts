import test from 'node:test';
import assert from 'node:assert/strict';
import { rankThumbnailConcept, selectThumbnailConcepts } from './thumbnailStrategy';

test('thumbnail scorer penalizes text that simply repeats the title', () => {
  const title = 'Why Subscription Businesses Make So Much Money';
  const repeated = rankThumbnailConcept(title, {
    title: 'repeat',
    angle: 'payoff',
    text: 'Subscription Business Money',
    prompt: 'One business icon with money.',
    scores: { titleComplementarity: 10, visualSimplicity: 9, mobileReadability: 9, curiosityGap: 8, semanticAccuracy: 9 },
  });
  const complementary = rankThumbnailConcept(title, {
    title: 'payoff',
    angle: 'payoff',
    text: '$10 → $1M',
    prompt: 'One person pays ten dollars and a huge recurring revenue result appears on the other side.',
    scores: { titleComplementarity: 10, visualSimplicity: 9, mobileReadability: 10, curiosityGap: 9, semanticAccuracy: 9 },
  });
  assert.ok(complementary.scores.titleComplementarity > repeated.scores.titleComplementarity);
  assert.ok(complementary.totalScore > repeated.totalScore);
});

test('thumbnail scorer enforces mobile-safe short text', () => {
  const ranked = rankThumbnailConcept('A Useful Video Title', {
    title: 'too long',
    angle: 'curiosity',
    text: 'THIS IS A VERY LONG THUMBNAIL SENTENCE',
    prompt: 'One clear focal object.',
    scores: { mobileReadability: 10 },
  });
  assert.ok(ranked.text.split(/\s+/).length <= 4);
  assert.ok(ranked.text.length <= 24);
  assert.ok(ranked.scores.mobileReadability <= 5);
});

test('thumbnail selector keeps distinct A/B concept angles', () => {
  const selected = selectThumbnailConcepts('Why Subscription Businesses Make So Much Money', [
    { title: 'A', angle: 'payoff', text: '$10 → $1M', prompt: 'Large payoff contrast.', scores: { titleComplementarity: 10, visualSimplicity: 10, mobileReadability: 10, curiosityGap: 10, semanticAccuracy: 10 } },
    { title: 'B', angle: 'payoff', text: '$5 → $500K', prompt: 'Another payoff contrast.', scores: { titleComplementarity: 10, visualSimplicity: 10, mobileReadability: 10, curiosityGap: 9, semanticAccuracy: 10 } },
    { title: 'C', angle: 'mechanism', text: 'PAID AGAIN', prompt: 'Recurring payment loop mechanism.', scores: { titleComplementarity: 9, visualSimplicity: 9, mobileReadability: 10, curiosityGap: 9, semanticAccuracy: 9 } },
    { title: 'D', angle: 'consequence', text: 'MONEY MACHINE', prompt: 'Customer input creates recurring revenue output.', scores: { titleComplementarity: 9, visualSimplicity: 9, mobileReadability: 10, curiosityGap: 8, semanticAccuracy: 9 } },
  ], 3);
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map((item) => item.angle)).size, 3);
});
