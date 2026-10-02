import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasSpeechActivity,canvasSpeechEnvelope} from './canvasSpeechActivity';
import {synthesizeCanvasFoley} from './canvasFoley';
test('PCM analysis finds real internal pauses and preserves silence',()=>{
  const wav=synthesizeCanvasFoley('wind',1000),rate=wav.readUInt32LE(24);
  for(let i=0;i<rate;i++)for(let c=0;c<2;c++)wav.writeInt16LE(i<rate*.3||i>=rate*.5&&i<rate*.8?6000:0,44+(i*2+c)*2);
  assert.deepEqual(canvasSpeechActivity(wav),[{startMs:0,endMs:320},{startMs:480,endMs:820}]);
  wav.fill(0,44);assert.deepEqual(canvasSpeechActivity(wav),[]);
  assert.equal(canvasSpeechActivity(Buffer.from('mp3')),undefined);
});
test('measured voice envelope changes with energy and closes in genuine silence',()=>{
  const wav=synthesizeCanvasFoley('wind',1000),rate=wav.readUInt32LE(24);
  for(let i=0;i<rate;i++)for(let c=0;c<2;c++)wav.writeInt16LE(i<rate*.3?2000:i<rate*.5?0:8000,44+(i*2+c)*2);
  const samples=canvasSpeechEnvelope(wav)!;
  assert.ok(samples.find(s=>s.atMs===100)!.level<samples.find(s=>s.atMs===700)!.level);
  assert.equal(samples.find(s=>s.atMs===420)!.level,0);
  assert.ok(samples.length<30);
  assert.equal(canvasSpeechEnvelope(Buffer.from('mp3')),undefined);
});
