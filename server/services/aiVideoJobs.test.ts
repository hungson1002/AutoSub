import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAiVideoDirectorPrompt, buildFlowPrompt, isRetryableNoChargeFlowError, parseAiVideoPlan, parseBlurScore } from './aiVideoJobs';

test('parseBlurScore averages FFmpeg blur measurements', () => {
  assert.equal(parseBlurScore('blur mean: 4.0\nblur mean: 6.0'), 5);
});

test('parseBlurScore rejects missing or invalid measurements', () => {
  assert.equal(parseBlurScore('blur mean: unknown'), Number.POSITIVE_INFINITY);
});

test('only retries Flow failures that explicitly did not charge credit', () => {
  assert.equal(isRetryableNoChargeFlowError(new Error('Flow báo tạo video không thành công và xác nhận chưa tính phí.')), true);
  assert.equal(isRetryableNoChargeFlowError(new Error("Generation failed. You weren't charged.")), true);
  assert.equal(isRetryableNoChargeFlowError(new Error('Google Flow session expired or unauthorized (HTTP 401).')), false);
  assert.equal(isRetryableNoChargeFlowError(new Error('Không tải được video Flow.')), false);
});

test('director prompt plans professional coverage and respects the selected frame', () => {
  const prompt = buildAiVideoDirectorPrompt({
    brief: 'Một cô bé phát hiện người lạ đứng ngoài cổng.',
    durationSeconds: 16,
    aspectRatio: '16:9',
    sceneDurations: [8, 8],
  });
  assert.match(prompt.system, /exactly 2 connected horizontal 16:9 sequence units/i);
  assert.match(prompt.system, /2–3 timestamped shots/i);
  assert.match(prompt.system, /180-degree line/i);
  assert.match(prompt.system, /reaction, occlusion and negative space/i);
  assert.match(prompt.user, /<story_material>/);
});

test('plan parser preserves directing fields used by Flow', () => {
  const plan = parseAiVideoPlan(JSON.stringify({
    productionBible: {
      storySpine: 'A child notices a stranger, investigates, then discovers the person needs help.',
      characters: 'Mai, nine, short black hair, blue school uniform; elderly visitor in a brown raincoat.',
      worldGeography: 'Narrow kitchen behind a folding gate; the street stays screen-right.',
    },
    scenes: [{
      title: 'At the gate',
      dramaticBeat: 'Curiosity turns into concern when Mai notices the visitor does not answer.',
      shotPlan: '0.0–2.5s locked wide through gate; hard cut; 2.5–5.0s close reaction; hard cut; 5.0–8.0s insert of visitor hand.',
      blocking: 'Mai stops inside the gate, grips one bar and looks screen-right.',
      continuityIn: 'Mai enters from frame-left holding a rice bowl in her left hand.',
      continuityOut: 'Close frame of her hand opening the latch, motion beginning screen-right.',
      soundDesign: 'Ceiling fan, metal bowl set down, latch click bridges the cut.',
      narration: 'Ông có cần giúp không ạ?',
      visualPrompt: 'Naturalistic Vietnamese neighborhood drama in humid afternoon light. Frame the child through the blue folding gate, preserving layered depth and restrained performances. Use the gate as foreground obstruction, then reveal only the visitor hand while keeping the face outside frame.',
    }],
  }), 1);
  assert.match(plan.scenes[0].shotPlan || '', /locked wide/);
  assert.match(plan.scenes[0].continuityOut || '', /opening the latch/);
});

test('Flow prompt turns a plan into timed shots with a stable handoff frame', () => {
  const prompt = buildFlowPrompt('characters: same child\nworldGeography: kitchen behind gate', {
    index: 2,
    title: 'Reaction',
    dramaticBeat: 'She recognizes danger.',
    shotPlan: '0.0–3.0s medium profile; hard cut; 3.0–8.0s close reaction.',
    blocking: 'She freezes and looks screen-right.',
    continuityIn: 'Her left hand is already on the latch.',
    continuityOut: 'She remains still in close-up, eyes fixed screen-right.',
    soundDesign: 'The latch click drops into silence.',
    narration: '',
    visualPrompt: 'A restrained close reaction framed through the gate, with shallow depth and natural daylight.',
    status: 'pending',
  }, 2, 8);
  assert.match(prompt, /START FRAME IS LAW/);
  assert.match(prompt, /TIMED SHOT PLAN/);
  assert.match(prompt, /No spoken dialogue/);
  assert.match(prompt, /Hold the final readable composition/);
  assert.match(prompt, /No slideshow, dissolve, morph, teleport/);
});
