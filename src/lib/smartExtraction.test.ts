import assert from 'node:assert/strict';
import test from 'node:test';
import type { SubtitleCue } from '../types';
import { mergeSmartExtractionCues } from './smartExtraction';

const cue = (id: string, text: string, startMs: number, endMs: number, sourceKind: SubtitleCue['sourceKind'] = 'subtitle'): SubtitleCue => ({ id, index: 1, startMs, endMs, originalText: text, translatedText: '', voiceGroup: 'G1', enabled: true, sourceKind });

test('smart extraction keeps STT timing and removes matching OCR subtitle', () => {
  const result = mergeSmartExtractionCues([cue('stt', 'Xin chào bạn', 0, 1500)], [cue('ocr', 'Xin chào bạn!', 100, 1400)]);
  assert.deepEqual(result.map((item) => item.id), ['stt']);
});

test('smart extraction retains distinct screen text and missed dialogue', () => {
  const result = mergeSmartExtractionCues([cue('stt', 'Lời thoại', 1000, 2000)], [cue('logo', 'Tên chương trình', 0, 5000, 'onscreen-text'), cue('missed', 'Câu bị bỏ sót', 2100, 2800)]);
  assert.deepEqual(result.map((item) => item.id), ['logo', 'stt', 'missed']);
  assert.deepEqual(result.map((item) => item.index), [1, 2, 3]);
});
