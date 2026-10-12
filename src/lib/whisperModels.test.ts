import test from 'node:test';
import assert from 'node:assert/strict';
import {createWhisperLocalProvider,ensureBuiltInProviders} from './providers';
test('existing local STT settings gain new models without resetting saved choices or custom entries',()=>{
  const provider=createWhisperLocalProvider();provider.enabled=false;provider.name='My STT';
  provider.models=[{id:'small-q5_1',name:'saved Q5'},{id:'custom-local',name:'custom'}];
  const updated=ensureBuiltInProviders([provider]).find(p=>p.id===provider.id)!;
  assert.equal(updated.enabled,false);assert.equal(updated.name,'My STT');
  assert.equal(updated.models[0]!.name,'saved Q5');assert.ok(updated.models.some(m=>m.id==='custom-local'));
  assert.ok(updated.models.some(m=>m.id==='faster-small-int8'));
  assert.equal(ensureBuiltInProviders([updated]).find(p=>p.id===provider.id),updated);
  assert.equal(provider.models.length,2);
});
