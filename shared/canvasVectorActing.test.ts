import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasProject,type CanvasVectorDirection} from './canvasAnimationStudio';
import {compileVectorProject,normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart,type VectorTrack} from './canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from './canvasVectorTransform';
import {vectorPigWalkTracks} from './canvasVectorPig';

const assets=normalizeVectorAssets({animal:{rig:'simple-pig',toes:5},person:{rig:'simple-human'}});
function shot(actor:string,asset:string,tracks:VectorTrack[],direction:CanvasVectorDirection){
  const p=createCanvasProject();return {...p.scenes[0]!,id:crypto.randomUUID(),durationMs:6000,audioUrl:'/retained.wav',narration:'đứng dậy rồi chạm vào mõm',vectorStageId:'yard',vectorDirection:direction,
    vectorScene:normalizeVectorScene({width:720,height:1280,nodes:[{id:'sky',type:'rect',width:720,height:1280,fill:'#101820'},
      {id:actor,type:'instance',asset,x:160,y:600,width:asset==='animal'?340:220,height:asset==='animal'?230:440}],
      ground:{y:980,targets:[{target:actor}]},tracks,camera:[{t:0,x:360,y:640,zoom:1}]},assets)};
}
function direction(focus:string,beats:CanvasVectorDirection['beats'],size:CanvasVectorDirection['shot']['size']='action'):CanvasVectorDirection {
  return {purpose:'Physical action',location:'yard',shot:{size,focus,include:[]},beats};
}
function project(scenes:ReturnType<typeof shot>[]){const p=createCanvasProject();return {...p,width:720,height:1280,vectorAssets:assets,scenes};}
test('rearing rotates the native trunk while both hind hooves stay planted throughout the action',()=>{
  const s=shot('creature','animal',[{target:'creature',start:0,end:1,frames:[{t:0,rotation:0,dy:0},{t:1,rotation:-65,dy:-110}]}],direction('creature',[]));
  const p=compileVectorProject(project([s])),fixed=p.scenes[0]!;
  for(let i=0;i<=40;i++)for(const side of ['hl','hr']){
    const hoof=vectorPoint(vectorWorldMatrix('creature/hoof-'+side,fixed,i/40*6000,p.vectorAssets),0,0);
    const floor=vectorPoint(vectorWorldMatrix('camera-world',fixed,i/40*6000,p.vectorAssets),0,980);
    assert.ok(Math.abs(hoof.y-floor.y)<1e-7,'rear hooves cannot levitate');
  }
  assert.equal(evaluateVectorPart('creature/body-pose',fixed,6000).rotation,-65);
  assert.equal(evaluateVectorPart('creature',fixed,6000).rotation,0);
  assert.equal(fixed.audioUrl,s.audioUrl);assert.equal(fixed.durationMs,s.durationMs);assert.equal(fixed.narration,s.narration);
  assert.deepEqual(compileVectorProject(p),p);
});
test('an explicitly falling animal is not silently changed into a rearing action',()=>{
  const root:VectorTrack={target:'creature',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:-70}]};
  const s=shot('creature','animal',[root],direction('creature',[{cue:'ngã',kind:'motion',targets:['creature'],motionTargets:['creature'],before:'đứng',after:'ngã xuống'}]));
  const fixed=compileVectorProject(project([s])).scenes[0]!;
  assert.equal(evaluateVectorPart('creature',fixed,6000).rotation,-70);
  assert.ok(!fixed.vectorScene!.tracks.some(t=>t.target==='creature/body-pose'));
});
test('a reclining actor bends its hips and knees, supports the body with its palms, and can stand in the following shot',()=>{
  const lie=shot('walker','person',[{target:'walker/upper-body',start:.2,end:.8,cue:'ngả lưng xuống chiếu',frames:[{t:0,rotation:0},{t:1,rotation:45,dy:60}]}],
    direction('walker',[{cue:'ngả lưng xuống chiếu',kind:'motion',targets:['walker'],motionTargets:['walker/upper-body'],before:'đứng',after:'nằm nghiêng'}]));
  lie.narration='ngả lưng xuống chiếu';
  const stand=shot('walker','person',[],direction('walker',[{cue:'',kind:'motion',targets:['walker'],motionTargets:['walker/arm-r'],before:'đứng',after:'tay xách đèn'}]));
  const p=compileVectorProject(project([lie,stand]));
  const rest=p.scenes[0]!,upright=p.scenes[1]!;
  const floor=vectorPoint(vectorWorldMatrix('camera-world',rest,6000,p.vectorAssets),0,980);
  for(const side of ['l','r']){
    const palm=vectorPoint(vectorWorldMatrix('walker/hand-'+side,rest,6000,p.vectorAssets),0,0);
    assert.ok(Math.abs(palm.y-floor.y)<3,'palms support the actor instead of penetrating the floor');
    assert.ok(evaluateVectorPart('walker/knee-'+side,rest,6000).rotation>0);
  }
  assert.equal(evaluateVectorPart('walker/upper-body',upright,6000).rotation,0);
  assert.equal(evaluateVectorPart('walker',upright,6000).dy,0);
  assert.deepEqual(compileVectorProject(p),p);
});
test('a translated forehoof is solved through the connected leg to the snout and the detail camera shows that action',()=>{
  const beats=[{cue:'chạm vào mõm',kind:'motion' as const,targets:['creature'],motionTargets:['creature/hoof-fl','creature/snout'],before:'raised',after:'contact'}];
  const s=shot('creature','animal',[
    {target:'creature',start:0,end:1,frames:[{t:0,rotation:-65,dy:-110}]},
    {target:'creature/hoof-fl',start:.2,end:.8,cue:'chạm vào mõm',frames:[{t:0,dx:0,dy:0},{t:1,dx:35,dy:-52}]},
  ],direction('creature',beats,'detail'));
  const source=project([s]),before=structuredClone(source),p=compileVectorProject(source),fixed=p.scenes[0]!;
  const hoof=vectorPoint(vectorWorldMatrix('creature/hoof-fl',fixed,6000,p.vectorAssets),0,-10);
  const snout=vectorPoint(vectorWorldMatrix('creature/snout',fixed,6000,p.vectorAssets),0,0);
  assert.ok(Math.hypot(hoof.x-snout.x,hoof.y-snout.y)<1e-6);
  assert.ok(snout.x>60&&snout.x<660&&snout.y>200&&snout.y<1100);
  assert.ok(fixed.vectorScene!.tracks.filter(t=>t.target==='creature/hoof-fl').every(t=>t.frames.every(f=>f.dx===undefined&&f.dy===undefined)));
  assert.ok(evaluateVectorPart('creature/knee-fl',fixed,6000).rotation<0);
  assert.deepEqual(compileVectorProject(p),p);assert.deepEqual(source,before);
});
test('a biped pig walks on alternating hind legs without resetting the raised trunk or head',()=>{
  const s=shot('creature','animal',[],direction('creature',[])),node=s.vectorScene!.nodes.find(n=>n.id==='creature')!;
  s.vectorScene!.tracks=[{target:'creature/body-pose',start:0,end:1,frames:[{t:0,rotation:-65}]},
    ...vectorPigWalkTracks(node,assets.animal!,80,{start:0,end:1,biped:true})];
  const walk=s.vectorScene!.tracks.find(t=>t.target==='creature')!;
  for(const frame of walk.frames){
    if(frame.t<.08||frame.t>.92)continue;
    const ys=['hl','hr'].map(side=>vectorPoint(vectorWorldMatrix('creature/hoof-'+side,s,frame.t*6000,assets),0,0).y);
    assert.ok(Math.abs(Math.max(...ys)-980)<1e-6,'at least one hind hoof stays on the support at each stride key');
  }
  assert.ok(!s.vectorScene!.tracks.some(t=>t.target==='creature/head-group'||t.target==='creature/leg-fl'));
});
test('an upright hand action cannot carry a stale reclining torso and disconnected limb offsets into the next cut',()=>{
  const s=shot('walker','person',[
    {target:'walker/upper-body',start:0,end:1,frames:[{t:0,rotation:45,dy:60}]},
    {target:'walker/leg-l',start:0,end:1,frames:[{t:0,rotation:-30}]},
    {target:'walker/hand-r',start:0,end:1,frames:[{t:0,dx:30,dy:-20}]},
  ],direction('walker',[{cue:'',kind:'motion',targets:['walker'],motionTargets:['walker/arm-r'],before:'đứng với tay',after:'tay xách đèn'}]));
  const p=compileVectorProject(project([s])),fixed=p.scenes[0]!;
  assert.equal(evaluateVectorPart('walker/upper-body',fixed,6000).rotation,0);
  assert.equal(evaluateVectorPart('walker/upper-body',fixed,6000).dy,0);
  assert.equal(evaluateVectorPart('walker/leg-l',fixed,6000).rotation,0);
  assert.equal(evaluateVectorPart('walker/hand-r',fixed,6000).dx,0);
  assert.deepEqual(compileVectorProject(p),p);
});
test('a fall into open space keeps the head visible instead of hiding it behind a neighbouring animal',()=>{
  const s=shot('walker','person',[{target:'walker',start:.15,end:.5,cue:'ngã lăn xuống vệ cỏ',frames:[{t:0,dx:0,dy:0,rotation:0},{t:1,dx:60,dy:80,rotation:70}]}],
    direction('walker',[{cue:'ngã lăn xuống vệ cỏ',kind:'travel',targets:['walker'],motionTargets:['walker','walker/upper-body'],before:'đang chạy',after:'ngã chúi đầu xuống cỏ'}]));
  s.narration='ngã lăn xuống vệ cỏ';
  s.vectorScene!.nodes.push({id:'neighbour',type:'instance',parent:'camera-world',asset:'animal',x:410,y:980-214*200/240,width:300,height:200,groundAnchor:{x:180,y:214}});
  const p=compileVectorProject(project([s])),fixed=p.scenes[0]!;
  assert.equal(evaluateVectorPart('walker/upper-body',fixed,6000).rotation,-88);
  const head=vectorPoint(vectorWorldMatrix('walker/head-group',fixed,6000,p.vectorAssets),0,0);
  const neighbour=vectorPoint(vectorWorldMatrix('neighbour',fixed,6000,p.vectorAssets),0,0);
  assert.ok(head.x>40&&head.x<neighbour.x-40,'the head remains in the open side of the frame');
  assert.deepEqual(compileVectorProject(p),p);
});
