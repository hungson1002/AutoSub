import assert from 'node:assert/strict';
import test from 'node:test';
import { cuesToAss } from './subtitles';
import { defaultStyle, type SubtitleCue } from '../types';

const cue: SubtitleCue = {
  id: 'cue-1',
  index: 1,
  startMs: 0,
  endMs: 1000,
  originalText: 'Original',
  translatedText: 'Bản dịch',
  enabled: true,
  voiceGroup: 'G1',
};

test('ASS export only applies the text outline in outline mode', () => {
  const boxed = cuesToAss([cue], { ...defaultStyle, background: 'box', outlineWidth: 8 });
  const outlined = cuesToAss([cue], { ...defaultStyle, background: 'outline', outlineWidth: 8 });

  assert.match(boxed, /,3,0,0,2,154,154,108,1/);
  assert.match(outlined, /,1,8,0,2,154,154,108,1/);
});

test('ASS export does not enable bold or italic for persisted string flags', () => {
  const ass = cuesToAss([cue], {
    ...defaultStyle,
    bold: 'false' as unknown as boolean,
    italic: 'false' as unknown as boolean,
  });

  assert.match(ass, /,0,0,0,0,100,100,0,0,1,2,0,2,154/);
});
