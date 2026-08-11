import assert from 'node:assert/strict';
import test from 'node:test';
import { subtitlePresets } from './subtitlePresets';

test('subtitle presets provide distinct, usable style patches', () => {
  assert.ok(subtitlePresets.length >= 5);
  assert.equal(new Set(subtitlePresets.map((preset) => preset.id)).size, subtitlePresets.length);
  subtitlePresets.forEach((preset) => {
    assert.ok(preset.name.trim());
    assert.ok(preset.style.fontSize && preset.style.fontSize >= 18);
    assert.ok(preset.style.textColor?.startsWith('#'));
  });
});
