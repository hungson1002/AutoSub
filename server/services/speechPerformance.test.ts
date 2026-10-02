import assert from 'node:assert/strict';
import test from 'node:test';
import { planSpeech } from '../../shared/speech';
import { renderSpeechPerformance } from './speechPerformance';

function tone():Buffer {
  const data=Buffer.alloc(44+24000*2*.2);
  data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);
  data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(24000,24);data.writeUInt32LE(48000,28);
  data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);
  for(let i=0;i<4800;i++)data.writeInt16LE(Math.round(Math.sin(i*Math.PI*2*220/24000)*6000),44+i*2);
  return data;
}
test('unmarked speech returns the original provider buffer without FFmpeg or extra TTS calls',async()=>{
  const original=tone();let calls=0;
  assert.equal(await renderSpeechPerformance(planSpeech('Chào cháu.'),async()=>{calls++;return original;}),original);
  assert.equal(calls,1);
});
test('real FFmpeg inserts the exact authored pause and keeps both spoken phrases',async()=>{
  const texts:string[]=[];
  const audio=await renderSpeechPerformance(planSpeech('Chào [pause 350ms] cháu.'),async text=>{texts.push(text);return tone();});
  assert.deepEqual(texts,['Chào','cháu.']);
  const dataOffset=audio.indexOf(Buffer.from('data'))+8;
  assert.equal(audio.readUInt32LE(dataOffset-4),.75*48000*4);
  const silent=audio.subarray(dataOffset+.21*48000*4,dataOffset+.54*48000*4);
  assert.ok(silent.every(value=>value===0));
  assert.ok(audio.subarray(dataOffset+.56*48000*4).some(value=>value!==0));
});
test('cancellation stops before dispatching another phrase',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(()=>renderSpeechPerformance(planSpeech('Chào [pause] cháu.'),async()=>{calls++;controller.abort();return tone();},controller.signal),/abort/i);
  assert.equal(calls,1);
});
