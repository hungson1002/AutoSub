import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVectorPlan} from './canvasVectorDirector';
import {illustratedPlace} from './canvasVectorIllustratedPlace';
import {compileVectorProject,evaluateVectorPart,vectorTrackTiming} from '../../shared/canvasVectorScene';
import type {VectorStory} from './canvasVectorStory';
import {vectorWorldMatrix,vectorPoint} from '../../shared/canvasVectorTransform';

test('an illustrator walk without a cue follows its unique screenplay travel after revoicing',()=>{
  const cue='the guard walks',narration='The quiet market is empty, then the guard walks towards the house.';
  const story:VectorStory={name:'Cue regression',premise:'Market',stakes:'Arrival',turn:'Move',ending:'Stop',cast:[{id:'person',role:'guard',design:'compact'}],shots:[{
    id:'one',name:'Walk',durationMs:10000,narration,purpose:'Approach',location:'village',visibleCast:['person'],
    shot:{size:'wide',focus:'person',include:[],framing:'context'},
    beats:[{cue,kind:'travel',targets:['person'],motionTargets:['person'],before:'At road',after:'At house'}],
  }]};
  const raw={vectorAssets:{hero:{rig:'simple-puppet',finish:'handdrawn'}},vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',cast:{person:'hero'}}},
    scenes:[{id:'one',durationMs:10000,narration,vectorScene:{stage:'village',walks:[{actor:'person',to:'house-mid',gap:80,start:0,end:.3}]}}]};
  const p=parseVectorPlan(JSON.stringify(raw),'test',{width:1280,height:720},undefined,story);
  p.scenes[0]!.dialogue=[{id:'voice',speaker:'narrator',text:narration,atMs:1000,durationMs:8000}];
  const s=compileVectorProject(p).scenes[0]!,track=s.vectorScene!.tracks.find(t=>t.target==='person')!;
  assert.equal(track.cue,cue);
  const {start,end}=vectorTrackTiming(track,s);
  assert.ok(start>4000,'does not start at the old scene fraction');
  assert.equal(evaluateVectorPart('person',s,start-1).dx,0);
  assert.ok(Math.abs(evaluateVectorPart('person',s,(start+end)/2).dx)>10);
});

test('elevated native village uses roof planes and broad ground while the approved puppet stays small',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',hair:'side-part',outfit:'robe'}},
    vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',cast:{person:'hero'}}},
    scenes:[{durationMs:4000,narration:'He enters the village.',vectorScene:{stage:'village'}}]}),'village',{width:1280,height:720});
  const s=p.scenes[0]!,d=s.vectorScene!,node=d.nodes.find(n=>n.id==='person')!,world=d.nodes.find(n=>n.id==='illustrated-world')!;
  assert.ok(node.height!*world.scaleY!/720>=.12&&node.height!*world.scaleY!/720<=.2);
  assert.equal(world.scaleX,world.scaleY);
  assert.ok(d.nodes.some(n=>n.id==='village-path-branch'));
  assert.ok(d.nodes.some(n=>n.id==='house-near-left'));
  assert.notEqual(d.nodes.find(n=>n.id==='house-mid-roof')!.d,illustratedPlace({place:'village'},{width:1280,height:720}).stage.nodes.find(n=>n.id==='house-mid-roof')!.d);
  const horizon=vectorPoint(vectorWorldMatrix('illustrated-world',s,0,p.vectorAssets),0,421);
  assert.ok(horizon.y<720*.2,'most of the picture must show ground, not a front-facing sky wall');
  assert.deepEqual(compileVectorProject(p),p);
  assert.throws(()=>illustratedPlace({place:'forest',view:'elevated'}),/elevated view/);
});

test('wide-context-close-wide cuts focus on the arrived actor without enlarging or resetting the actor/world/prop',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet'},lantern:{rig:'lantern'}},
    vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',cast:{person:'hero'}}},
    scenes:['wide','reaction','reaction','wide'].map((size,i)=>({durationMs:4000,narration:'He stops at the house.',vectorScene:{stage:'village',
      nodes:[{id:'held-lamp',type:'instance',asset:'lantern',width:35,height:58}],carries:[{actor:'person',arm:'r',prop:'held-lamp',hang:true}],
      walks:[{actor:'person',to:'house-mid',gap:90,followDepth:true,...(i?{hold:true}:{start:0,end:.5})}]}}))}),'village',{width:1280,height:720});
  for(const [i,s]of p.scenes.entries())s.vectorDirection={purpose:i===2?'Read a discovery in his face':'Keep the setting',location:'village',visibleCast:['person'],
    heldProps:[{actor:'person',arm:'r',prop:'held-lamp',hang:true}],shot:{size:i===0||i===3?'wide':'reaction',focus:'person',include:['held-lamp'],framing:i===2?'close':'context'},beats:[]};
  const framed=compileVectorProject(p),zoom=framed.scenes.map(s=>evaluateVectorPart('camera-world',s,0).scaleX);
  assert.equal(zoom[0],1);assert.equal(zoom[3],1);assert.ok(zoom[2]!>zoom[1]!);
  assert.ok(evaluateVectorPart('person',framed.scenes[0]!,3999).dy< -100,'followDepth follows the diagonal road to its destination plane');
  for(const [i,s]of framed.scenes.entries()){
    const original=p.scenes[i]!.vectorScene!;
    for(const id of ['person','house-mid','house-mid-roof','held-lamp']){
      const {opacity:_a,...actual}=s.vectorScene!.nodes.find(n=>n.id===id)!;
      const {opacity:_b,...expected}=original.nodes.find(n=>n.id===id)!;
      assert.deepEqual(actual,expected);
    }
    assert.deepEqual(evaluateVectorPart('camera-world',s,0),evaluateVectorPart('camera-world',s,3999));
    const unframed={...s,vectorScene:{...s.vectorScene!,tracks:s.vectorScene!.tracks.filter(t=>!t.target.startsWith('camera-world'))}};
    if(i)assert.deepEqual(vectorWorldMatrix('person',unframed,0,framed.vectorAssets),vectorWorldMatrix('person',unframed,3999,framed.vectorAssets));
    const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,2000,framed.vectorAssets),0,0),lamp=vectorPoint(vectorWorldMatrix('held-lamp',s,2000,framed.vectorAssets),30,6);
    assert.ok(Math.hypot(hand.x-lamp.x,hand.y-lamp.y)<1e-6);
  }
  const close=framed.scenes[2]!,face=vectorPoint(vectorWorldMatrix('person/head-group',close,0,framed.vectorAssets),0,0);
  assert.ok(face.x>1280*.2&&face.x<1280*.8,'close cut follows the actual actor, not a centered tableau');
  assert.ok(face.y>720*.19&&face.y<720*.65);
  assert.deepEqual(compileVectorProject(framed),framed);
});
