import assert from 'node:assert/strict';
import test from 'node:test';
import { synthesize } from './index';
import { normalizeSpokenText, planSpeech, resolveSpeech } from '../../shared/speech';
import type { AIProvider } from '../types';

test('shared TTS prepares pronunciation without altering the subtitle or timing options', async () => {
  const provider: AIProvider = { id:'test', name:'Test', baseUrl:'http://provider.test/v1', enabled:true,
    models:[], providerType:'openai-compatible', authType:'none', capabilities:{tts:true} };
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  const controller = new AbortController();
  const options = { speed:1.1, format:'wav', signal:controller.signal };
  const caption = 'Năm 1288, quân ta chiến thắng.';
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    assert.equal(init?.signal, controller.signal);
    return new Response(new Uint8Array([1,2,3]));
  }) as typeof fetch;
  try {
    await synthesize(provider, 'model', 'voice', caption, options);
    assert.equal(requests[0]?.input, 'năm một nghìn hai trăm tám mươi tám, quân ta chiến thắng.');
    assert.equal(requests[0]?.speed, 1.1);
    assert.equal(requests[0]?.voice, 'voice');
    await synthesize(provider, 'model', 'voice', caption, { ...options, speech:{spokenText:'YouTube Studio', emotion:'gentle', cue:'sigh'} });
    assert.equal(requests[1]?.input, 'YouTube Studio', 'VieNeu tags must not reach other providers');
    assert.equal(requests[1]?.speed, 1.034);
    assert.equal(caption, 'Năm 1288, quân ta chiến thắng.');
    assert.equal(options.speed, 1.1);
  } finally { globalThis.fetch = originalFetch; }
});

test('shared preparation is idempotent, keeps punctuation and leaves other languages/dates intact', () => {
  const text = normalizeSpokenText('  Năm 2005… Đợi đã!  ');
  assert.equal(normalizeSpokenText(text), text);
  assert.equal(normalizeSpokenText('In 2005, wait! 01/10/2026, 12.5'), 'In 2005, wait! 01/10/2026, 12.5');
  const delivered = resolveSpeech({text:'Chào cháu.', emotion:'tense', cue:'sigh'}, 1, true);
  assert.equal(delivered.text, '[thở dài] Chào cháu.');
  assert.equal(resolveSpeech({text:delivered.text, cue:'sigh'}, 1, true).text, delivered.text);
});

test('paragraph pacing, pronunciation overrides and supported reactions survive preparation',()=>{
  assert.equal(normalizeSpokenText('YT là [[YouTube]].\r\n\r\n Đợi đã… [thở dài]'),'YT là YouTube.\n\nĐợi đã… [thở dài]');
  assert.deepEqual(planSpeech('Đợi đã… [pause 500ms] Đừng mở cửa!'),[{text:'Đợi đã…'},{pauseMs:500},{text:'Đừng mở cửa!'}]);
  assert.deepEqual(planSpeech('Chào [pause] [pause 0.5s] cháu.'),[{text:'Chào'},{pauseMs:850},{text:'cháu.'}]);
  assert.throws(()=>planSpeech('Chào [pause -1s]'),/Khoảng nghỉ/);
  assert.throws(()=>planSpeech('Chào [pause 11s]'),/tối đa/);
  assert.throws(()=>planSpeech('Chào [pause 8s] cháu [pause 8s]'),/tối đa/);
  assert.throws(()=>planSpeech('[pause]'),/trống/);
  assert.throws(()=>planSpeech('chào [pause] '.repeat(17)),/16 đoạn/);
});
