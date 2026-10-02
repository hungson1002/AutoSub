import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_FILM_PROFILE, referenceFilmCharacterCohesionContract, referenceFilmProductionContract, referenceFilmVisualQcContract, visualLikelyContainsHuman } from './referenceFilmProfile';

test('reference film profile keeps one source of truth for pacing, text and character grammar', () => {
  assert.equal(REFERENCE_FILM_PROFILE.openingCadenceSeconds.target, 2.5);
  assert.equal(REFERENCE_FILM_PROFILE.bodyCadenceSeconds.target, 4.3);
  assert.equal(REFERENCE_FILM_PROFILE.exceptionalHoldSeconds, 8);
  assert.equal(REFERENCE_FILM_PROFILE.textVisualRatio.target, 0.25);
  assert.match(referenceFilmProductionContract(), /same artist|same construction system/i);
  assert.match(referenceFilmCharacterCohesionContract('hand-drawn story explainer'), /one-stroke arms and legs/i);
  assert.match(referenceFilmCharacterCohesionContract('hand-drawn story explainer'), /do not solve identity separation/i);
  assert.match(referenceFilmVisualQcContract('hand-drawn story explainer'), /limbGrammarMatch=false/i);
  assert.doesNotMatch(referenceFilmCharacterCohesionContract('cinematic 3D animation'), /one-stroke arms and legs/i);
  assert.equal(visualLikelyContainsHuman('A woman scientist stands beside CAST_01'), true);
  assert.equal(visualLikelyContainsHuman('Close-up of a battery on an empty table'), false);
});
