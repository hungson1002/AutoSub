import test from 'node:test';
import assert from 'node:assert/strict';
import {vectorPuppetRig} from './canvasVectorPuppet';
const base={rig:'simple-puppet',hair:'side-part',outfit:'tunic',palette:{skin:'#ecd4b8',shirt:'#766454',hair:'#382d2c',accent:'#bd9878',trim:'#d8bb95',inner:'#e8d9c6'}};
test('same-style cast variants alter real face geometry without changing anchors',()=>{
  const old=vectorPuppetRig(base),young=vectorPuppetRig({...base,faceShape:'round',eyeStyle:'wide'});
  const elder=vectorPuppetRig({...base,faceShape:'oval',eyeStyle:'tired'}),villager=vectorPuppetRig({...base,faceShape:'broad',eyeStyle:'sharp'});
  const by=(rig:ReturnType<typeof vectorPuppetRig>,name:string)=>rig.nodes.find(n=>n.id===name)!;
  assert.equal(by(old,'face').rx,56);assert.equal(by(old,'face').ry,60);
  assert.equal(by(old,'eye-l').rx,6);assert.equal(by(old,'eye-l').ry,8);
  assert.equal(by(young,'eye-l').ry,10);
  assert.equal(by(elder,'face').rx,49);assert.equal(by(elder,'face').ry,68);
  assert.equal(by(villager,'face').rx,61);
  assert.notEqual(by(villager,'brow-l').d,by(old,'brow-l').d);
  for(const rig of [young,elder,villager]){
    assert.equal(rig.width,180);assert.equal(rig.height,280);
    assert.deepEqual(by(rig,'upper-body'),by(old,'upper-body'),'shared body motion skeleton must remain');
    assert.ok(rig.nodes.length<=160);
  }
});
test('unknown face styles fail instead of silently rendering mismatched cast',()=>{
 assert.throws(()=>vectorPuppetRig({...base,faceShape:'square-head'}),/face\/eye design/);
 assert.throws(()=>vectorPuppetRig({...base,eyeStyle:'anime-giant'}),/face\/eye design/);
});

test('optional hats and beard create distinct silhouettes without replacing the approved default model',()=>{
 const old=vectorPuppetRig(base),plain=vectorPuppetRig({...base,headwear:'none',facialHair:'none'});
 const by=(rig:ReturnType<typeof vectorPuppetRig>,id:string)=>rig.nodes.find(n=>n.id===id)!;
 assert.deepEqual(plain,old);
 for(const headwear of ['headscarf','conical']){
   const rig=vectorPuppetRig({...base,headwear,facialHair:'beard'});
   assert.ok(rig.nodes.some(n=>n.id==='headwear'));
   assert.ok(rig.nodes.some(n=>n.id==='beard'));
   for(const part of ['upper-body','hand-l','hand-r','head-group'])assert.deepEqual(by(rig,part),by(old,part),'contact and motion skeleton remains stable');
 }
 assert.throws(()=>vectorPuppetRig({...base,headwear:'unknown'}),/headwear/);
});
