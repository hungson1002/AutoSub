import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart,compileVectorProject} from './canvasVectorScene';
import {createCanvasProject} from './canvasAnimationStudio';

const assets=normalizeVectorAssets({person:{rig:'simple-human'}});
const stage={width:720,height:1280,nodes:[{id:'lam',type:'instance',asset:'person',x:180,y:500,width:180,height:360}],tracks:[]};

test('a collar reach lands the actual hand on the collar for either shoulder, without extra limbs',()=>{
  for(const side of ['l','r']){
    const drawing=normalizeVectorScene({...stage,reaches:[{actor:'lam',arm:side,point:{x:120,y:182},start:.1,end:.35}]},assets);
    const scene={...createCanvasProject().scenes[0]!,durationMs:1000,vectorScene:drawing};
    const upper=evaluateVectorPart(`lam/arm-${side}`,scene,350).rotation*Math.PI/180;
    const lower=evaluateVectorPart(`lam/forearm-${side}`,scene,350).rotation*Math.PI/180;
    const x=(side==='l'?80:160)-50*Math.sin(upper)-57*Math.sin(upper+lower);
    const y=190+50*Math.cos(upper)+57*Math.cos(upper+lower);
    assert.ok(Math.abs(x-120)<1e-6);assert.ok(Math.abs(y-182)<1e-6);
    assert.equal(evaluateVectorPart(`lam/arm-${side}`,scene,0).rotation,0);
    assert.deepEqual(normalizeVectorScene(drawing,assets),drawing);
    assert.equal(drawing.nodes.length,1);
  }
});

test('the next cut holds the solved contact immediately instead of replaying the reach',()=>{
  const drawing=normalizeVectorScene({...stage,reaches:[{actor:'lam',arm:'r',point:{x:120,y:182},hold:true}]},assets);
  const p={...createCanvasProject(),width:720,height:1280,vectorAssets:assets,scenes:[{...createCanvasProject().scenes[0]!,durationMs:1000,vectorScene:drawing}]};
  const scene=compileVectorProject(p).scenes[0]!;
  assert.deepEqual(evaluateVectorPart('lam/arm-r',scene,0),evaluateVectorPart('lam/arm-r',scene,999));
  assert.notEqual(evaluateVectorPart('lam/arm-r',scene,0).rotation,0);
});

test('unreachable contact, unknown actor and malformed cues cannot pretend to perform a reach',()=>{
  for(const reach of [
    {actor:'lam',arm:'r',point:{x:1200,y:182}},
    {actor:'lam',arm:'r',point:{x:160,y:200}},
    {actor:'missing',arm:'r',point:{x:120,y:182}},
    {actor:'lam',arm:'r',point:{x:120,y:182},start:.5,end:.2},
    {actor:'lam',arm:'r',point:{x:120,y:182},cue:'Unspoken words'},
  ])assert.throws(()=>normalizeVectorScene({...stage,reaches:[reach]},assets,'Known spoken words'));
});
