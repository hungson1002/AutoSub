import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCanvasProfessionalDirection} from './canvasProfessionalDirection';
import type {CanvasStudioObject,CanvasStudioProject,CanvasStudioScene} from './canvasAnimationStudio';

const baseObject=(id:string,kind:any,label:string,extra:Partial<CanvasStudioObject>={}):CanvasStudioObject=>({
  id,kind,label,x:640,y:400,width:100,height:100,scale:1,rotation:0,opacity:1,color:'#765',accent:'#222',
  zIndex:20,motion:'none',role:'support',slot:'mid-center',depth:'midground',sizeClass:'small',...extra,
});
const scene=(objects:CanvasStudioObject[],extra:Partial<CanvasStudioScene>={}):CanvasStudioScene=>({
  id:'s',name:'s',durationMs:6000,background:'room',template:'hero-left',narration:'',dialogue:[],objects,
  camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1},...extra,
});
const project=(s:CanvasStudioScene):CanvasStudioProject=>({version:1,id:'p',name:'p',width:1280,height:720,fps:30,scenes:[s]});

test('reveal target gets minimum readable silhouette and perceptual opacity',()=>{
  const ghost=baseObject('g','prop','Ghost',{variant:'ghost',width:80,height:90,x:1200,y:300,depth:'background',role:'background'});
  const s=scene([ghost],{visualBeats:[{id:'b',atMs:2000,durationMs:800,action:'reveal-layer',targetIds:['g'],opacity:.4}]});
  const out=compileCanvasProfessionalDirection(project(s)).scenes[0]!.objects[0]!;
  assert.ok(out.height>=720*.22);
  assert.ok(out.x<=1280*.86);
  assert.equal(out.keyframes?.find(f=>f.visualBeatId==='b'&&f.visualBeatPhase==='end')?.opacity,.72);
});

test('expression-change always produces a visible before/after state',()=>{
  const actor=baseObject('a','character','Linh',{expression:'afraid',role:'focal',height:360,width:180});
  const s=scene([actor],{visualBeats:[{id:'b',atMs:2000,durationMs:300,action:'expression-change',targetIds:['a'],expression:'afraid'}]});
  const out=compileCanvasProfessionalDirection(project(s)).scenes[0]!.objects[0]!;
  assert.equal(out.expression,'neutral');
});

test('an actor carrying a story acting beat cannot be demoted to an unreadable support figure',()=>{
  const actor=baseObject('a','character','Linh',{role:'support',slot:'mid-left',depth:'midground',sizeClass:'small',x:370,y:500,width:116,height:222});
  const door=baseObject('d','prop','Door',{variant:'door',role:'support',slot:'background-right',depth:'background',width:150,height:360,x:1050});
  const s=scene([actor,door],{
    template:'hero-left',
    camera:{shot:'wide',motion:'none',focusX:430,focusY:420,zoom:1},
    animationBeats:[{id:'listen',action:'nod',targetIds:['a'],focusTargetId:'d',atMs:1000,durationMs:780,speechCue:'head-up'}],
  });
  const out=compileCanvasProfessionalDirection(project(s)).scenes[0]!;
  const directed=out.objects.find(o=>o.id==='a')!;
  assert.equal(directed.role,'focal');
  assert.ok(directed.height>=720*.40);
  assert.ok(directed.width>actor.width);
  assert.equal(directed.depth,'midground');
  assert.equal(out.camera?.focusX,directed.x);
});

test('prop focus enlarges the clue and points camera at it',()=>{
  const note=baseObject('n','prop','Note',{variant:'note',role:'focal',width:120,height:80,x:790,y:410});
  const s=scene([note],{template:'prop-focus',camera:{shot:'close-up',motion:'none',focusX:640,focusY:360,zoom:1.1}});
  const out=compileCanvasProfessionalDirection(project(s)).scenes[0]!;
  assert.ok(out.objects[0]!.width>=1280*.28);
  assert.equal(out.camera?.focusX,790);
});

test('small light changes are strengthened into a readable practical-light beat',()=>{
  const lamp=baseObject('l','prop','Lamp',{variant:'lantern',lightLevel:1});
  const s=scene([lamp],{visualBeats:[{id:'b',atMs:2000,durationMs:1000,action:'light-change',targetIds:['l'],lightLevel:.85}]});
  const out=compileCanvasProfessionalDirection(project(s)).scenes[0]!.objects[0]!;
  const end=out.keyframes?.find(f=>f.visualBeatId==='b'&&f.visualBeatPhase==='end');
  assert.ok((end?.lightLevel??1)<=.66);
});
