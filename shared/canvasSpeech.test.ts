import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCanvasSpokenText,resolveCanvasSpeech} from './canvasSpeech';
import {isCanvasActorSpeaking} from './canvasDialogue';
import {createCanvasObject,createCanvasScene} from './canvasAnimationStudio';

test('pronunciation normalizes years without changing dates, decimals or captions',()=>{
  assert.equal(normalizeCanvasSpokenText('Năm 1288, quân ta chiến thắng.'),'năm một nghìn hai trăm tám mươi tám, quân ta chiến thắng.');
  assert.equal(normalizeCanvasSpokenText('năm 2005'),'năm hai nghìn không trăm linh năm');
  assert.equal(normalizeCanvasSpokenText('12.5 mét, 01/10/2026'),'12.5 mét, 01/10/2026');
  const line={id:'x',speaker:'Narrator',text:'YT Studio',spokenText:'YouTube Studio'};
  assert.equal(resolveCanvasSpeech(line).text,'YouTube Studio');assert.equal(line.text,'YT Studio');
});
test('prosody is bounded and native nonverbal cues are opt-in and provider-specific',()=>{
  const line={id:'x',speaker:'Bà chủ',text:'Đừng nhìn xuống',emotion:'tense' as const};
  assert.equal(resolveCanvasSpeech(line).speed,.9);assert.equal(resolveCanvasSpeech(line).text,line.text);
  assert.equal(resolveCanvasSpeech({...line,cue:'sigh'},1,true).text,'[thở dài] Đừng nhìn xuống');
  assert.equal(resolveCanvasSpeech({...line,cue:'sigh'},1,false).text,line.text);
  assert.equal(resolveCanvasSpeech({...line,emotion:'firm'}).text,'Đừng nhìn xuống!');
  assert.equal(resolveCanvasSpeech(line,10).speed,2);
});
test('measured silence closes a speaking actor mouth while preserving legacy line timing',()=>{
  const scene=createCanvasScene(0),actor=createCanvasObject('character',{characterKey:'host'});
  scene.dialogue=[{id:'x',speaker:'Bà chủ',characterKey:'host',text:'Chào cháu',atMs:200,durationMs:1200,speechWindows:[{startMs:0,endMs:300},{startMs:700,endMs:1000}]}];
  assert.equal(isCanvasActorSpeaking(scene,actor,400),true);
  assert.equal(isCanvasActorSpeaking(scene,actor,700),false);
  assert.equal(isCanvasActorSpeaking(scene,actor,1000),true);
  scene.dialogue[0]!.speechWindows=undefined;
  assert.equal(isCanvasActorSpeaking(scene,actor,700),true);
});
