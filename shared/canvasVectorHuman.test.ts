import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart} from './canvasVectorScene';
import {vectorSubjectCamera} from './canvasVectorFraming';
import {createCanvasProject} from './canvasAnimationStudio';

test('human scaffold has shoulder/elbow/hand chains, paired eyes and canonical asset reuse',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-human',palette:{shirt:'#554433'}}});
  const rig=assets.person!,part=(id:string)=>rig.nodes.find(n=>n.id===id)!;
  assert.equal(part('arm-l').parent,'upper-body');assert.equal(part('arm-l').x,80);
  assert.equal(part('arm-r').x,160);assert.equal(part('arm-r').y,190);
  assert.equal(part('forearm-r').parent,'arm-r');assert.equal(part('hand-r').parent,'forearm-r');
  assert.equal(part('eye-l').parent,'eyes');assert.equal(part('eye-r').parent,'eyes');
  assert.equal(part('torso').fill,'#554433');
  assert.equal(part('tunic-hem').parent,'upper-body');
  assert.equal(part('knee-r').parent,'leg-r');assert.equal(part('foot-r').parent,'knee-r');
  assert.equal(part('face').rx,46);assert.equal(part('face').ry,50);
  for(const side of ['l','r'])for(const id of ['sleeve','cuff','thigh','shin']){
    assert.equal(part(`${id}-${side}`).stroke,'#080808');
    assert.ok(!/z/i.test(part(`${id}-${side}`).d!),'outline stays open at the elbow/knee');
  }
  assert.deepEqual(normalizeVectorAssets(assets),assets);
  assert.throws(()=>normalizeVectorAssets({person:{rig:'simple-human',palette:{shirt:'url(bad)'}}}));
});

test('subject framing computes a fixed close-up from the nested actor without moving its support',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-human'}});
  const base=normalizeVectorScene({width:720,height:1280,nodes:[
    {id:'boat-world',type:'group',x:35,y:850},
    {id:'boat',type:'rect',parent:'boat-world',x:0,y:40,width:640,height:150,fill:'#654'},
    {id:'traveler',type:'instance',parent:'boat-world',asset:'person',x:110,y:-265,width:180,height:360}],tracks:[]},assets);
  const before=structuredClone(base),camera=vectorSubjectCamera(base,assets,{target:'traveler',height:.45});
  assert.equal(camera[0]!.zoom,1.6);assert.equal(camera[0]!.x,235);assert.equal(camera[0]!.y,765);
  assert.deepEqual(base,before);
  const framed=normalizeVectorScene({...base,shot:{target:'traveler',height:.45}},assets);
  const scene={...createCanvasProject().scenes[0]!,durationMs:8000,vectorScene:framed};
  assert.deepEqual(evaluateVectorPart('camera-world',scene,0),evaluateVectorPart('camera-world',scene,7999));
  assert.equal(framed.nodes.find(n=>n.id==='boat')!.parent,'boat-world');
  const tiny={...base,nodes:base.nodes.map(n=>n.id==='traveler'?{...n,height:60}:n)};
  assert.throws(()=>vectorSubjectCamera(tiny,assets,{target:'traveler'}),/too small/);
});
