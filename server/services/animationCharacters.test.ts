import assert from 'node:assert/strict';
import test from 'node:test';
import { characterFrame, createProceduralCharacter } from './animationCharacters';

test('procedural actor has stable identity and five complete sprite clips', () => {
  const design = { name: 'R-7', kind: 'robot' as const, color: '#54d8c2' };
  const asset = createProceduralCharacter(design);
  assert.equal(asset.id, createProceduralCharacter(design).id);
  assert.equal(asset.sprite?.frameCount, 60);
  assert.equal(asset.sprite?.clips.run.fps, 18);
  assert.equal(asset.sprite?.clips.talk.to, 59);
  assert.match(asset.uri, /^data:image\/svg\+xml;base64,/);
  assert.notEqual(characterFrame(design, 'walk', 0), characterFrame(design, 'walk', 3));
  assert.notEqual(characterFrame(design, 'point', 0), characterFrame(design, 'idle', 0));
});

test('invalid rig and injected colors cannot become executable SVG', () => {
  assert.throws(() => createProceduralCharacter({ name: 'x', kind: 'dinosaur' as 'robot' }));
  const asset = createProceduralCharacter({ name: '<script>alert(1)</script>', kind: 'stick', color: '"><script>alert(1)</script>' });
  const svg = Buffer.from(asset.uri.split(',')[1], 'base64').toString();
  assert.doesNotMatch(svg, /<script|alert\(/);
});
