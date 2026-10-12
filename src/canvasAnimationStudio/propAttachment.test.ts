import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasObject,type CanvasStudioScene} from '../../shared/canvasAnimationStudio';
import {evaluateAttachedProp} from './propAttachment';
import {canvasLanternUsesHandlePivot,canvasPropBottomRatio,canvasPropSupportSurfaceRatio} from '../../shared/canvasSpatialRelations';

const scene=(objects:any[]):CanvasStudioScene=>({
  id:'s',name:'s',durationMs:4000,background:'room',backgroundRef:'bg:room-simple-night',
  template:'hero-left',narration:'',dialogue:[],objects,
});

test('tabletop resting prop follows the authored support surface instead of an absolute y',()=>{
  const table=createCanvasObject('prop',{id:'table',variant:'table',label:'Bàn',x:500,y:400,width:240,height:180,scale:1,motion:'none'});
  const lamp=createCanvasObject('prop',{id:'lamp',variant:'lantern',label:'Đèn',x:50,y:50,width:70,height:100,scale:1,motion:'none',restingOn:'table',restingOffsetX:.16});
  const shot=scene([table,lamp]);
  const out=evaluateAttachedProp(lamp,shot,0);
  const surface=canvasPropSupportSurfaceRatio(table)!;
  const bottom=canvasPropBottomRatio(lamp)!;
  assert.equal(surface,-.10);
  assert.equal(bottom,.40);
  assert.ok(Math.abs(out.x-(500+.16*240*.5))<1e-9);
  assert.ok(Math.abs(out.y-(400+surface*180-bottom*100))<1e-9);
});

test('moving the support moves a resting prop without changing the child plan',()=>{
  const table=createCanvasObject('prop',{id:'table',variant:'table',label:'Bàn',x:500,y:400,width:240,height:180,scale:1,motion:'none',keyframes:[{atMs:1000,dx:80,dy:30}]});
  const lamp=createCanvasObject('prop',{id:'lamp',variant:'lantern',label:'Đèn',x:50,y:50,width:70,height:100,scale:1,motion:'none',restingOn:'table'});
  const shot=scene([table,lamp]);
  const before=evaluateAttachedProp(lamp,shot,0);
  const after=evaluateAttachedProp(lamp,shot,1000);
  assert.ok(after.x>before.x+70);
  assert.ok(after.y>before.y+20);
});

test('lantern pivot distinguishes held or suspended lamps from tabletop lamps',()=>{
  const held=createCanvasObject('prop',{variant:'lantern',heldBy:'actor'});
  const hanging=createCanvasObject('prop',{variant:'lantern',designNotes:'treo dưới mái hiên'});
  const table=createCanvasObject('prop',{variant:'lantern',restingOn:'table'});
  const floor=createCanvasObject('prop',{variant:'lantern',designNotes:'đặt trên sàn'});
  assert.equal(canvasLanternUsesHandlePivot(held),true);
  assert.equal(canvasLanternUsesHandlePivot(hanging),true);
  assert.equal(canvasLanternUsesHandlePivot(table),false);
  assert.equal(canvasLanternUsesHandlePivot(floor),false);
});
