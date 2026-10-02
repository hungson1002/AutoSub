import test from 'node:test';
import assert from 'node:assert/strict';
import { applySupportingCastStyleReferences } from './animationAssets';

const base = {
  prompt: '',
  generator: 'flow-agent' as const,
  model: 'narwhal',
  referenceUploadId: 'mascot-upload',
  supportingCastReferenceUploadIds: ['support-a', 'support-b'],
  tags: ['storyboard'],
  style: 'hand-drawn story explainer',
};

test('one-off supporting humans use supporting style refs and drop the mascot identity ref', () => {
  const result = applySupportingCastStyleReferences({
    ...base,
    prompt: 'SHOT CONTENT: A woman scientist with short hair checks a clipboard.\nNON-NEGOTIABLE EDITORIAL SHOT DIRECTION: medium shot.',
  });
  assert.equal(result.referenceUploadId, undefined);
  assert.deepEqual(result.referenceUploadIds, ['support-a', 'support-b']);
});

test('mascot shots keep the mascot identity reference and do not inherit supporting humans', () => {
  const result = applySupportingCastStyleReferences({
    ...base,
    prompt: 'SHOT CONTENT: The presenter mascot points at a battery icon.\nNON-NEGOTIABLE EDITORIAL SHOT DIRECTION: medium shot.',
  });
  assert.equal(result.referenceUploadId, 'mascot-upload');
  assert.equal(result.referenceUploadIds, undefined);
});

test('without uploaded supporting refs, non-mascot humans still stop inheriting the mascot identity', () => {
  const result = applySupportingCastStyleReferences({
    ...base,
    supportingCastReferenceUploadIds: [],
    prompt: 'SHOT CONTENT: A male scientist walks through the laboratory.\nNON-NEGOTIABLE EDITORIAL SHOT DIRECTION: action shot.',
  });
  assert.equal(result.referenceUploadId, undefined);
  assert.equal(result.referenceUploadIds, undefined);
  assert.match(result.prompt, /SUPPORTING-HUMAN GRAMMAR LOCK/);
  assert.match(result.prompt, /one-stroke arms and legs/);
  assert.match(result.prompt, /same artist|same construction system/i);
  assert.match(result.prompt, /do not solve identity separation/i);
  assert.doesNotMatch(result.prompt, /SUPPORTING-CAST STYLE REFERENCE RULE/);
});

test('recurring CAST shots use their exact CAST asset instead of generic supporting uploads', () => {
  const result = applySupportingCastStyleReferences({
    ...base,
    referenceAssetIds: ['cast-01-reference'],
    prompt: 'SHOT CONTENT: CAST_01, the same young man, walks through a doorway.\nNON-NEGOTIABLE EDITORIAL SHOT DIRECTION: action shot.',
  });
  assert.equal(result.referenceUploadId, undefined);
  assert.equal(result.referenceUploadIds, undefined);
  assert.deepEqual(result.referenceAssetIds, ['cast-01-reference']);
});

test('story-cast identity generation learns drawing grammar from uploaded supporting references', () => {
  const result = applySupportingCastStyleReferences({
    ...base,
    tags: ['story-cast-reference'],
    prompt: 'Create one full-body CAST_01 identity sheet.',
  });
  assert.equal(result.referenceUploadId, undefined);
  assert.deepEqual(result.referenceUploadIds, ['support-a', 'support-b']);
});
