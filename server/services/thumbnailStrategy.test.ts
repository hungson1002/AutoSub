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

test('Flowkit-style thumbnail strategy keeps four fixed variant families and two-line text budgets', () => {
  const selected = selectThumbnailConcepts('Vì sao con người lại sợ bóng tối?', [
    { title: 'Face', variant: 'face', angle: 'emotion', hookText: 'SỢ BÓNG TỐI?', contextText: 'Não bạn đang báo động quá sớm', prompt: 'Huge frightened recurring character face with one dark doorway behind.', scores: { titleComplementarity: 9, visualSimplicity: 10, mobileReadability: 10, curiosityGap: 9, semanticAccuracy: 10 } },
    { title: 'Action', variant: 'action', angle: 'stakes', hookText: 'CÓ GÌ ĐÓ?', contextText: 'Một tiếng động khiến não bật cảnh báo', prompt: 'Character freezes while reaching for a lamp as a kitchen sound comes from off-screen.', scores: { titleComplementarity: 9, visualSimplicity: 9, mobileReadability: 10, curiosityGap: 9, semanticAccuracy: 10 } },
    { title: 'Confrontation', variant: 'confrontation', angle: 'contrast', hookText: 'NGUY HIỂM?', contextText: 'Bóng tối đối đầu căn phòng an toàn', prompt: 'Split conflict between dark ambiguous hallway and the same hallway after lights turn on.', scores: { titleComplementarity: 9, visualSimplicity: 9, mobileReadability: 10, curiosityGap: 8, semanticAccuracy: 10 } },
    { title: 'Mystery', variant: 'mystery', angle: 'curiosity', hookText: 'AI Ở ĐÓ?', contextText: 'Não tự điền phần bạn không thấy', prompt: 'Character staring toward a partly hidden kitchen corner with the cause kept off-screen.', scores: { titleComplementarity: 10, visualSimplicity: 9, mobileReadability: 10, curiosityGap: 10, semanticAccuracy: 10 } },
  ], 4);
  assert.deepEqual(selected.map((item) => item.variant), ['face', 'action', 'confrontation', 'mystery']);
  selected.forEach((item) => {
    assert.ok(item.hookText.split(/\s+/).length <= 3);
    assert.ok(item.contextText.split(/\s+/).length <= 8);
  });
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
