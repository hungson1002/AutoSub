import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasProceduralAssetIdentity,
  compileCanvasProceduralAssetForge,
  resolveCanvasProceduralAssetProfile,
} from './canvasProceduralAssetForge';
import type {CanvasStudioObject,CanvasStudioProject,CanvasStudioScene} from './canvasAnimationStudio';

const prop=(id:string,variant:any,label:string,extra:Partial<CanvasStudioObject>={}):CanvasStudioObject=>({
  id,kind:'prop',variant,label,x:640,y:400,width:160,height:140,scale:1,rotation:0,opacity:1,
  color:'#7a5b43',secondaryColor:'#a98260',accent:'#302a26',zIndex:20,motion:'none',
  role:'support',slot:'mid-center',depth:'midground',sizeClass:'medium',...extra,
});
const scene=(id:string,stageId:string,objects:CanvasStudioObject[],extra:Partial<CanvasStudioScene>={}):CanvasStudioScene=>({
  id,name:id,stageId,durationMs:4000,background:'room',backgroundRef:'bg:room-simple-night',
  template:'hero-left',narration:'',dialogue:[],objects,camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1},...extra,
});
const project=(scenes:CanvasStudioScene[]):CanvasStudioProject=>({
  version:1,id:'p',name:'forge',width:1280,height:720,fps:30,scenes,
});

test('same physical stage furnishing receives one stable procedural identity',()=>{
  const a=scene('a','room-7',[prop('a','door','Cửa')]);
  const b=scene('b','room-7',[prop('b','door','Cửa')]);
  const out=compileCanvasProceduralAssetForge(project([a,b]));
  assert.equal(out.scenes[0]!.objects[0]!.assetKey,out.scenes[1]!.objects[0]!.assetKey);
  assert.match(out.scenes[0]!.objects[0]!.designNotes||'',/panel construction|timber/i);
});

test('renaming the only furnishing of a variant does not change its stage identity',()=>{
  const a=scene('a','room-7',[prop('a','box','Cabinet')]);
  const b=scene('b','room-7',[prop('b','box','Dark cabinet')]);
  const out=compileCanvasProceduralAssetForge(project([a,b]));
  assert.equal(out.scenes[0]!.objects[0]!.assetKey,out.scenes[1]!.objects[0]!.assetKey);
});

test('Vietnamese Đ is preserved semantically in stable asset keys',()=>{
  const lamp=prop('lamp','lantern','Đèn bàn');
  const s=scene('s','room-7',[lamp]);
  assert.match(canvasProceduralAssetIdentity(lamp,s),/den-ban$/);
});

test('same label in a different stage gets a different asset identity',()=>{
  const a=prop('a','table','Bàn');
  const b=prop('b','table','Bàn');
  assert.notEqual(canvasProceduralAssetIdentity(a,scene('sa','room-a',[a])),canvasProceduralAssetIdentity(b,scene('sb','room-b',[b])));
});

test('focal close asset receives more forge detail than background support',()=>{
  const support=prop('s','note','Mảnh giấy',{role:'support',sizeClass:'small'});
  const focal=prop('f','note','Mảnh giấy',{role:'focal',sizeClass:'hero'});
  const wide=scene('wide','room',[support],{camera:{shot:'wide',motion:'none',focusX:640,focusY:360,zoom:1}});
  const close=scene('close','room',[focal],{template:'prop-focus',camera:{shot:'close-up',motion:'none',focusX:640,focusY:360,zoom:1.15}});
  assert.ok(resolveCanvasProceduralAssetProfile(focal,close).detail>resolveCanvasProceduralAssetProfile(support,wide).detail);
});

test('horror/old semantic cues increase deterministic wear without frame randomness',()=>{
  const door=prop('d','door','Cửa cũ',{designNotes:'old abandoned scratched timber door'});
  const s=scene('s','room',[door],{name:'Phòng trọ bỏ hoang'});
  const one=resolveCanvasProceduralAssetProfile(door,s);
  const two=resolveCanvasProceduralAssetProfile(door,s);
  assert.equal(one.seed,two.seed);
  assert.equal(one.wear,two.wear);
  assert.ok(one.wear>.6);
  assert.equal(one.material,'wood');
});
