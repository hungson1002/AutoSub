import assert from 'node:assert/strict';
import test from 'node:test';
import {FASTER_WHISPER_MODELS,parseFasterWhisperJson} from './fasterWhisper';
import {withWhisperQueue} from './whisperCpp';
import {filterLowConfidenceWhisperSegments,segmentsToCues} from './subtitles';
import {alignTranscriptToAudio} from './textAudioAlignment';

test('new model choices coexist with Q5 and preserve word timing and confidence through cue alignment',async()=>{
  assert.deepEqual(FASTER_WHISPER_MODELS.map(m=>m.id),['faster-small-int8','faster-medium-int8']);
  const result=parseFasterWhisperJson({segments:[{start:2,end:4,text:' Xin chào.',no_speech_prob:.01,avg_logprob:-.15,compression_ratio:1.1,
    words:[{word:' Xin',start:2.13,end:2.55,probability:.94},{word:' chào.',start:2.8,end:3.4,probability:.96}]}]});
  assert.equal(result.segments[0]!.words![1]!.probability,.96);
  const cues=segmentsToCues(result.segments);
  const aligned=await alignTranscriptToAudio({audioPath:'no-audio-needed-for-native-words',cues,language:'vi'});
  assert.equal(aligned.metadata.timestampSource,'provider-word');
  assert.equal(aligned.cues[0]!.startMs,2130);assert.equal(aligned.cues[0]!.endMs,3400);
  assert.equal(result.segments[0]!.avg_logprob,-.15);
});
test('silence low confidence survives parsing so the existing filter can remove it',()=>{
  const result=parseFasterWhisperJson({segments:[{start:1,end:2,text:'invented',no_speech_prob:.9,avg_logprob:-2}]});
  assert.equal(filterLowConfidenceWhisperSegments(result.segments).length,0);
});
test('empty audio returns no fake subtitle and invalid word times are rejected',()=>{
  assert.deepEqual(parseFasterWhisperJson({segments:[]}),{text:'',segments:[]});
  assert.throws(()=>parseFasterWhisperJson({text:'missing segments'}));
  const result=parseFasterWhisperJson({segments:[{start:1,end:3,text:'real',words:[{word:'bad',start:NaN,end:2},{word:'negative',start:-1,end:1},{word:'backwards',start:2,end:1}]}]});
  assert.equal(result.segments[0]!.words,undefined);
});
test('cancelled queued STT never starts or blocks the next engine',async()=>{
  const events:string[]=[];let release!:()=>void;
  const first=withWhisperQueue(async()=>{events.push('first');await new Promise<void>(r=>{release=r;});});
  await new Promise(r=>setImmediate(r));
  const controller=new AbortController();
  const second=withWhisperQueue(async()=>{events.push('cancelled');},controller.signal);
  controller.abort();await assert.rejects(second);
  const third=withWhisperQueue(async()=>{events.push('third');});
  release();await Promise.all([first,third]);assert.deepEqual(events,['first','third']);
});
