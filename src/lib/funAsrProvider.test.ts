import assert from 'node:assert/strict';
import test from 'node:test';
import {createFunAsrLocalProvider,ensureBuiltInProviders,presetAuth,presetBaseUrl,presetCapabilities} from './providers';

test('FunASR local provider is built in and requires no API key',()=>{
  const provider=createFunAsrLocalProvider();
  assert.equal(provider.id,'funasr-local');
  assert.equal(provider.providerType,'funasr-local');
  assert.equal(provider.baseUrl,'local://funasr');
  assert.deepEqual(provider.capabilities,{stt:true});
  assert.equal(presetAuth('funasr-local').authType,'none');
  assert.deepEqual(presetCapabilities('funasr-local'),{stt:true});
  assert.equal(presetBaseUrl('funasr-local'),'local://funasr');
  assert.equal(provider.models[0]?.id,'funasr-paraformer-zh');
});

test('existing FunASR settings gain new built-in models without resetting user state',()=>{
  const provider=createFunAsrLocalProvider();
  provider.enabled=false;
  provider.name='Chinese STT';
  provider.models=[{id:'funasr-paraformer-zh',name:'saved name'},{id:'custom-funasr',name:'custom'}];
  const updated=ensureBuiltInProviders([provider]).find(item=>item.id==='funasr-local')!;
  assert.equal(updated.enabled,false);
  assert.equal(updated.name,'Chinese STT');
  assert.equal(updated.models[0]?.name,'saved name');
  assert.ok(updated.models.some(model=>model.id==='custom-funasr'));
  assert.ok(updated.models.some(model=>model.id==='funasr-sensevoice-small'));
  assert.ok(updated.models.some(model=>model.id==='funasr-nano-2512'));
});
