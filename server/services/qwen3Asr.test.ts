import assert from 'node:assert/strict';
import test from 'node:test';
import {parseQwen3AsrJson,QWEN3_ASR_MODELS} from './qwen3Asr';

test('Qwen3-ASR exposes default and quality local models',()=>{
  assert.deepEqual(QWEN3_ASR_MODELS.map(model=>model.id),[
    'qwen3-asr-0.6b',
    'qwen3-asr-1.7b',
  ]);
  assert.ok(QWEN3_ASR_MODELS.every(model=>model.capabilities?.stt));
});

test('Qwen3-ASR parser preserves forced-aligner word timestamps',()=>{
  const result=parseQwen3AsrJson({
    text:'欢迎来到北京。',
    segments:[{
      start:0.22,
      end:1.94,
      text:'欢迎来到北京。',
      words:[
        {word:'欢',start:0.22,end:0.41},
        {word:'迎',start:0.41,end:0.59},
        {word:'北',start:1.46,end:1.67},
        {word:'京',start:1.67,end:1.94},
      ],
    }],
  });
  assert.equal(result.text,'欢迎来到北京。');
  assert.equal(result.segments[0]?.start,0.22);
  assert.equal(result.segments[0]?.words?.[0]?.word,'欢');
  assert.equal(result.segments[0]?.words?.[3]?.end,1.94);
  assert.ok(result.segments.some(segment=>segment.words?.length));
});

test('Qwen3-ASR parser drops malformed timestamps',()=>{
  const result=parseQwen3AsrJson({segments:[
    {start:2,end:1,text:'bad'},
    {start:1,end:2,text:'正常',words:[{word:'坏',start:2,end:1},{word:'正',start:1.1,end:1.4}]},
  ]});
  assert.equal(result.segments.length,1);
  assert.equal(result.segments[0]?.text,'正常');
  assert.equal(result.segments[0]?.words?.length,1);
  assert.throws(()=>parseQwen3AsrJson({text:'missing segments'}));
});
