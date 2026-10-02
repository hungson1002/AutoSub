import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThumbnailPrompt, flowkitVariantDirection } from './animationThumbnail';
import { rankThumbnailConcept } from './thumbnailStrategy';

const project = {
  styleProfile: { name: 'Hand-drawn story explainer', style: 'simple hand-drawn editorial explainer illustration' },
} as any;

test('Flowkit thumbnail prompt keeps two Vietnamese lines and mobile packaging rules', () => {
  const concept = rankThumbnailConcept('Vì sao con người lại sợ bóng tối?', {
    title: 'Face',
    variant: 'face',
    hookText: 'SỢ BÓNG TỐI?',
    contextText: 'Não bạn đang báo động quá sớm',
    prompt: 'Huge frightened recurring character face with one dark doorway behind.',
    scores: { semanticAccuracy: 10, mobileReadability: 10 },
  });
  const prompt = buildThumbnailPrompt(project, concept, 'Vietnamese');
  assert.match(prompt, /bold yellow text in Vietnamese clearly “SỢ BÓNG TỐI\?”/i);
  assert.match(prompt, /smaller white text in Vietnamese clearly “Não bạn đang báo động quá sớm”/i);
  assert.match(prompt, /40-50% of the frame/i);
  assert.match(prompt, /ONLY readable text/i);
  assert.match(prompt, /1280x720/i);
});

test('Flowkit thumbnail families have materially different composition intents', () => {
  assert.match(flowkitVariantDirection('face'), /face HUGE/i);
  assert.match(flowkitVariantDirection('action'), /high-stakes action/i);
  assert.match(flowkitVariantDirection('confrontation'), /two sides or two states/i);
  assert.match(flowkitVariantDirection('mystery'), /partly hidden or off-screen/i);
});
