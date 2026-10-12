import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMemoryMinimumMB} from './animationRenderMemory';

test('serial portrait Canvas can render with 2 GB headroom, while heavier engines retain 3 GB',()=>{
  const canvas={width:720,height:1280};
  assert.equal(renderMemoryMinimumMB({canvas,streaming:true}),2048);
  assert.equal(renderMemoryMinimumMB({canvas,streaming:false}),3072);
  assert.equal(renderMemoryMinimumMB(),3072);
  assert.equal(renderMemoryMinimumMB({canvas:{width:1080,height:1920},streaming:true}),2048);
  assert.equal(renderMemoryMinimumMB({canvas:{width:2160,height:3840},streaming:true}),3072);
});
test('operator memory limits win and malformed geometry never receives the reduced reserve',()=>{
  assert.equal(renderMemoryMinimumMB({streaming:true,canvas:{width:720,height:1280},configured:'4096'}),4096);
  assert.equal(renderMemoryMinimumMB({configured:'100'}),512);
  assert.equal(renderMemoryMinimumMB({configured:'invalid'}),3072);
  assert.equal(renderMemoryMinimumMB({streaming:true,canvas:{width:NaN,height:1280}}),3072);
});
