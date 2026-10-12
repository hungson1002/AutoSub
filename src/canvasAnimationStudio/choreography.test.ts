import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCanvasChoreographyOffset} from './choreography';
import {createCanvasObject,type CanvasStudioScene} from '../../shared/canvasAnimationStudio';

const actor=createCanvasObject('character',{id:'actor',characterKey:'actor',visualStyle:'horror',motion:'none'});
const scene=(action:'react'|'brace',durationMs=900):CanvasStudioScene=>({
  id:'scene',name:'scene',durationMs:3000,background:'room',backgroundRef:'bg:room-simple-night',
  objects:[actor],animationBeats:[{id:'beat',action,targetIds:['actor'],atMs:1000,durationMs,intensity:.5}],
});

test('react uses one anticipation-recoil-hold-settle envelope with no loop',()=>{
  const s=scene('react',700);
  const before=evaluateCanvasChoreographyOffset(actor,s,999);
  const anticipation=evaluateCanvasChoreographyOffset(actor,s,1060);
  const peak=evaluateCanvasChoreographyOffset(actor,s,1320);
  const hold=evaluateCanvasChoreographyOffset(actor,s,1400);
  const after=evaluateCanvasChoreographyOffset(actor,s,1701);
  assert.deepEqual(before,{x:0,y:0,scale:1,rotation:0,opacity:1});
  assert.ok(anticipation.x>-.8,'reaction begins with restrained pre-tension, not an instant jump');
  assert.ok(peak.x< -1&&peak.rotation<0&&peak.scale>1,'reaction must read as one clear recoil pose');
  assert.ok(hold.x<0&&hold.rotation<0,'recoil holds instead of crossing to the opposite side');
  assert.deepEqual(after,{x:0,y:0,scale:1,rotation:0,opacity:1},'reaction settles exactly to the original stage transform');
});

test('brace holds a defensive offset then returns cleanly',()=>{
  const s=scene('brace',900);
  const mid=evaluateCanvasChoreographyOffset(actor,s,1450);
  const after=evaluateCanvasChoreographyOffset(actor,s,1901);
  assert.ok(mid.x<0&&mid.rotation<0);
  assert.deepEqual(after,{x:0,y:0,scale:1,rotation:0,opacity:1});
});
