import assert from 'node:assert/strict';
import test from 'node:test';
import { createKokoroLocalProvider, createVieneuLocalProvider } from './providers';
import { KOKORO_VOICE_PREVIEW_TEXT } from '../../shared/kokoroVoices';
import { VI_VOICE_PREVIEW_TEXT, voicePreviewTextFor } from './voicePreview';

test('voice preview uses matching speech language and honors custom text', () => {
  const kokoro = createKokoroLocalProvider();
  const vieneu = createVieneuLocalProvider();
  assert.equal(voicePreviewTextFor(kokoro, 'af_sarah'), KOKORO_VOICE_PREVIEW_TEXT);
  assert.equal(voicePreviewTextFor(vieneu, 'preset:adam-bua'), VI_VOICE_PREVIEW_TEXT);
  assert.equal(voicePreviewTextFor(kokoro, 'af_sarah', 'Custom preview.'), 'Custom preview.');
});
