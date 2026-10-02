import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasScene} from './canvasAnimationStudio';
import {synchronizeCanvasPerformance} from './canvasPerformance';

test('phrase cue aligns after TTS across a silent gap and is idempotent',()=>{
  const scene=createCanvasScene(0);scene.durationMs=6000;
  scene.dialogue=[{id:'line',speaker:'Minh',text:'Minh nhìn chiếc đèn',atMs:1000,durationMs:3000,audioUrl:'existing.wav',
    speechWindows:[{startMs:200,endMs:1000},{startMs:2000,endMs:2800}]}];
  scene.animationBeats=[{id:'point',action:'point',atMs:0,durationMs:700,targetIds:['actor'],speechCue:'chiếc đèn',dialogueId:'line'}];
  synchronizeCanvasPerformance(scene);
  const at=scene.animationBeats[0]!.atMs;assert.ok(at>=3000&&at<3800);
  const once=structuredClone(scene);synchronizeCanvasPerformance(scene);assert.deepEqual(scene,once);
  assert.equal(scene.dialogue[0]!.audioUrl,'existing.wav');
});

test('unmatched, partial-word and punctuation-only cues preserve authored timing',()=>{
  const scene=createCanvasScene(0);scene.dialogue=[{id:'a',speaker:'A',text:'đèn sáng',durationMs:1000}];
  scene.animationBeats=['không có','sán','...'].map((speechCue,index)=>({id:String(index),action:'point',atMs:350,durationMs:500,targetIds:['a'],speechCue}));
  synchronizeCanvasPerformance(scene);assert.ok(scene.animationBeats.every(beat=>beat.atMs===350));
});
