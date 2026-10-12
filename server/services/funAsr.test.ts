import assert from 'node:assert/strict';
import test from 'node:test';
import {FUNASR_MODELS,parseFunAsrJson} from './funAsr';

test('FunASR exposes Chinese-first local models',()=>{
  assert.deepEqual(FUNASR_MODELS.map(model=>model.id),[
    'funasr-paraformer-zh',
    'funasr-sensevoice-small',
    'funasr-nano-2512',
  ]);
  assert.ok(FUNASR_MODELS.every(model=>model.capabilities?.stt));
});

test('FunASR JSON keeps sentence, character timing and speaker labels',()=>{
  const result=parseFunAsrJson({
    text:'欢迎来到北京。',
    segments:[{
      start:1.07,
      end:2.4,
      text:'欢迎来到北京。',
      speaker_id:'speaker_0',
      words:[
        {word:'欢',start:1.07,end:1.22},
        {word:'迎',start:1.22,end:1.38},
        {word:'北',start:2.01,end:2.18},
        {word:'京',start:2.18,end:2.4},
      ],
    }],
  });
  assert.equal(result.text,'欢迎来到北京。');
  assert.equal(result.segments[0]!.speaker_id,'speaker_0');
  assert.equal(result.segments[0]!.words?.[0]?.word,'欢');
  assert.equal(result.segments[0]!.words?.[3]?.end,2.4);
});

test('FunASR parser rejects malformed timing instead of poisoning subtitle timeline',()=>{
  const result=parseFunAsrJson({segments:[
    {start:2,end:1,text:'bad'},
    {start:1,end:2,text:'正常',words:[{word:'坏',start:2,end:1},{word:'正',start:1.1,end:1.4}]},
  ]});
  assert.equal(result.segments.length,1);
  assert.equal(result.segments[0]!.text,'正常');
  assert.equal(result.segments[0]!.words?.length,1);
  assert.throws(()=>parseFunAsrJson({text:'missing segments'}));
});
