import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultStyle } from '../types';
import { subtitleAnchor, subtitleAnchorTransform } from './subtitleAnchor';
import { cuesToAss } from './subtitles';

test('subtitle anchors preserve the chosen edge while free screen text retains its center', () => {
  assert.equal(subtitleAnchorTransform({ ...defaultStyle, position: 'custom' }, 50, 95), 'translate(-50%, -100%)');
  assert.equal(subtitleAnchorTransform({ ...defaultStyle, position: 'custom' }, 50, 8), 'translate(-50%, 0%)');
  assert.equal(subtitleAnchorTransform({ ...defaultStyle, position: 'middle' }, 50, 50), 'translate(-50%, -50%)');
  assert.equal(subtitleAnchor({ ...defaultStyle, position: 'bottom' }, 50, 95, true).vertical, .5);
});

test('exported subtitle boxes keep the same bottom/top gap at one, two and three lines and different sizes', () => {
  for (const edge of ['top', 'bottom'] as const) for (const fontSize of [32, 64, 96]) for (const count of [1, 2, 3]) {
    const y = edge === 'bottom' ? 95 : 5;
    const ass = cuesToAss([{ id: 'test', index: 1, enabled: true, voiceGroup: 'G1', startMs: 0, endMs: 1000, originalText: Array(count).fill('Phụ đề').join('\n'), translatedText: '', sourceKind: 'subtitle' }], {
      ...defaultStyle, content: 'original', background: 'box', fontSize, position: 'custom', customY: y, boxPaddingY: 6,
    });
    const drawing = ass.split('\n').find(line => line.includes('\\p1'))!;
    const top = Number(drawing.match(/\\pos\(\d+,(-?\d+)\)/)![1]);
    const height = Number(drawing.match(/l \d+ (\d+) l 0/)![1]);
    assert.ok(Math.abs((edge === 'bottom' ? top + height : top) - y / 100 * 1080) <= 1, `${edge}, ${count} lines, ${fontSize}px`);
  }
});

test('unboxed ASS uses native edge alignment, independent of the font size and line metrics', () => {
  for (const background of ['outline', 'none'] as const) for (const size of [32, 64]) for (const count of [1, 2, 3]) {
    const ass = cuesToAss([{ id: 'edge', index: 1, enabled: true, voiceGroup: 'G1', startMs: 0, endMs: 1000, originalText: Array(count).fill('Phụ đề').join('\n'), translatedText: '' }], { ...defaultStyle, background, fontSize: size, position: 'custom', customY: 95 });
    assert.match(ass, /\\an2\\pos\(960,1026\)/);
  }
});
