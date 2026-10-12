import { strict as assert } from 'node:assert';
import test from 'node:test';
import { allowedLocalSttModels, assertLocalSttAllowed } from './localSttPolicy';
import { QWEN3_ASR_MODELS, ensureQwen3AsrRuntime } from './qwen3Asr';
import { FUNASR_MODELS, ensureFunAsrRuntime } from './funAsr';

test('removed engines cannot reinstall their runtime via connection checks', async () => {
  const previous = process.env.AUTOSUB_STT_DISABLED_MODELS;
  try {
    process.env.AUTOSUB_STT_DISABLED_MODELS = [...QWEN3_ASR_MODELS, ...FUNASR_MODELS].map(model => model.id).join(',');
    await assert.rejects(ensureQwen3AsrRuntime(), /không tự cài lại/);
    await assert.rejects(ensureFunAsrRuntime(), /không tự cài lại/);
    assert.equal(allowedLocalSttModels([...QWEN3_ASR_MODELS, ...FUNASR_MODELS]).length, 0);
  } finally {
    if (previous === undefined) delete process.env.AUTOSUB_STT_DISABLED_MODELS;
    else process.env.AUTOSUB_STT_DISABLED_MODELS = previous;
  }
});

test('disabled heavy models are hidden and cannot be automatically downloaded again', () => {
  const previous = process.env.AUTOSUB_STT_DISABLED_MODELS;
  try {
    process.env.AUTOSUB_STT_DISABLED_MODELS = 'qwen3-asr-1.7b, funasr-nano-2512';
    assert.deepEqual(allowedLocalSttModels([{ id: 'qwen3-asr-1.7b' }, { id: 'faster-small-int8' }]), [{ id: 'faster-small-int8' }]);
    assert.throws(() => assertLocalSttAllowed('funasr-nano-2512'), /đã được tắt/);
    assert.doesNotThrow(() => assertLocalSttAllowed('faster-small-int8'));
  } finally {
    if (previous === undefined) delete process.env.AUTOSUB_STT_DISABLED_MODELS;
    else process.env.AUTOSUB_STT_DISABLED_MODELS = previous;
  }
});
