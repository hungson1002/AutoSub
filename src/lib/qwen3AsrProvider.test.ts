import assert from 'node:assert/strict';
import test from 'node:test';
import {createQwen3AsrLocalProvider,ensureBuiltInProviders,presetAuth,presetBaseUrl,presetCapabilities} from './providers';

test('saved provider list gains Qwen once while preserving existing credentials and models',()=>{
  const saved=ensureBuiltInProviders([]).filter(provider=>provider.providerType!=='qwen3-asr-local');
  const original=saved[0];
  assert.ok(original);
  original.name='My saved provider';
  original.apiKey='test-only-saved-key';
  original.enabled=false;
  const snapshot=structuredClone(saved);
  const migrated=ensureBuiltInProviders(saved);
  assert.deepEqual(saved,snapshot);
  assert.deepEqual(migrated.find(provider=>provider.id===original.id),original);
  assert.equal(migrated.filter(provider=>provider.providerType==='qwen3-asr-local').length,1);
  assert.equal(migrated.find(provider=>provider.providerType==='qwen3-asr-local')?.models.length,2);
  assert.deepEqual(ensureBuiltInProviders(migrated),migrated);
});

test('Qwen3 ASR local provider is built in and requires no API key',()=>{
  const provider=createQwen3AsrLocalProvider();
  assert.equal(provider.id,'qwen3-asr-local');
  assert.equal(provider.providerType,'qwen3-asr-local');
  assert.equal(provider.baseUrl,'local://qwen3-asr');
  assert.deepEqual(provider.capabilities,{stt:true});
  assert.equal(presetAuth('qwen3-asr-local').authType,'none');
  assert.deepEqual(presetCapabilities('qwen3-asr-local'),{stt:true});
  assert.equal(presetBaseUrl('qwen3-asr-local'),'local://qwen3-asr');
  assert.equal(provider.models[0]?.id,'qwen3-asr-0.6b');
  assert.equal(provider.models[1]?.id,'qwen3-asr-1.7b');
});

test('existing Qwen3 settings gain built-in models without resetting user state',()=>{
  const provider=createQwen3AsrLocalProvider();
  provider.enabled=false;
  provider.name='Qwen Chinese';
  provider.models=[{id:'qwen3-asr-0.6b',name:'saved name'},{id:'custom-qwen',name:'custom'}];
  const updated=ensureBuiltInProviders([provider]).find(item=>item.id==='qwen3-asr-local')!;
  assert.equal(updated.enabled,false);
  assert.equal(updated.name,'Qwen Chinese');
  assert.equal(updated.models[0]?.name,'saved name');
  assert.ok(updated.models.some(model=>model.id==='custom-qwen'));
  assert.ok(updated.models.some(model=>model.id==='qwen3-asr-1.7b'));
});
