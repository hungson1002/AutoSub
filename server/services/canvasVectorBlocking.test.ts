import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVectorPlan} from './canvasVectorDirector';
import {normalizeVectorStory,vectorDirectionIssues,type VectorStory} from './canvasVectorStory';
import {compileVectorProject,evaluateVectorPart,vectorTrackTiming} from '../../shared/canvasVectorScene';
import {vectorShotVisibility} from '../../shared/canvasVectorFraming';

function story():VectorStory{
  return {name:'Arrival',premise:'A visitor',stakes:'Find someone',turn:'An empty house',ending:'He waits',cast:[{id:'person',role:'traveler',design:'compact'}],shots:[
    {id:'arrive',name:'Approach',durationMs:5000,narration:'At the village market he walks towards the house and stops by its doorway.',purpose:'Approach a visible destination',location:'village',visibleCast:['person'],shot:{size:'wide',focus:'person',include:['house-mid']},beats:[{cue:'he walks',kind:'travel',targets:['person','house-mid'],motionTargets:['person'],before:'On the road',after:'Beside the house',travel:{actor:'person',to:'house-mid',gap:80,followDepth:true}}]},
    {id:'wait',name:'Wait',durationMs:5000,narration:'The doorway is silent and he waits outside the old house without moving.',purpose:'Hold the resulting arrival',location:'village',visibleCast:['person'],shot:{size:'action',focus:'person',include:['house-mid']},beats:[{cue:'he waits',kind:'hold',targets:['person','house-mid'],motionTargets:[],before:'Waiting',after:'Waiting'}]},
  ]};
}
test('new compact travel needs an executable destination; retained plans remain compatible',()=>{
  const raw=story();delete raw.shots[0]!.beats[0]!.travel;
  assert.throws(()=>normalizeVectorStory(raw,10,{compactCast:true,requireTravelPlan:true}),/must declare travel/);
  assert.doesNotThrow(()=>normalizeVectorStory(raw,10));
  raw.shots[0]!.beats[0]!.travel={actor:'person',to:'house-mid',gap:80,followDepth:true};
  assert.deepEqual(normalizeVectorStory(raw,10,{compactCast:true,requireTravelPlan:true}).shots[0]!.beats[0]!.travel,raw.shots[0]!.beats[0]!.travel);
  raw.shots[0]!.beats[0]!.cue='stops by its doorway';
  assert.throws(()=>normalizeVectorStory(raw,10,{compactCast:true,requireTravelPlan:true}),/names the stop/);
});
test('locked destination generates a real walk without illustrator tracks and retains arrival after voice timing and cuts',()=>{
  const plan=story(),raw={vectorAssets:{hero:{rig:'simple-puppet',finish:'handdrawn'}},vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',cast:{person:'hero'}}},scenes:plan.shots.map(s=>({id:s.id,durationMs:s.durationMs,narration:s.narration,vectorScene:{stage:'village'}}))};
  const p=parseVectorPlan(JSON.stringify(raw),'test',{width:1280,height:720},10,plan);
  for(const s of p.scenes)s.dialogue=[{id:'voice',speaker:'narrator',text:s.narration!,atMs:0,durationMs:4500}];
  const fixed=compileVectorProject(p),first=fixed.scenes[0]!,next=fixed.scenes[1]!;
  const root=first.vectorScene!.tracks.find(t=>t.target==='person'&&t.cue==='he walks')!,timing=vectorTrackTiming(root,first);
  assert.ok(timing.start>0&&timing.end>timing.start);
  const start=evaluateVectorPart('person',first,timing.start),end=evaluateVectorPart('person',first,first.durationMs);
  assert.ok(Math.hypot(end.dx-start.dx,end.dy-start.dy)>100);
  assert.deepEqual(evaluateVectorPart('person',next,0),end);
  assert.deepEqual(compileVectorProject(fixed),fixed);
});
test('shot review detects a tiny narrated clue and a cropped required subject despite valid scene IDs',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet'},clue:{width:100,height:100,nodes:[{id:'shape',type:'rect',width:100,height:100,fill:'#eeeeaa'}]}},scenes:[{durationMs:5000,narration:'A tiny object waits.',vectorScene:{width:1280,height:720,nodes:[{id:'person',type:'instance',asset:'hero',x:500,y:400,width:100,height:156},{id:'clue',type:'instance',asset:'clue',x:650,y:450,width:12,height:12}],tracks:[]}}]}),'test',{width:1280,height:720});
  p.scenes[0]!.vectorDirection={purpose:'Discover the object',location:'yard',shot:{size:'wide',focus:'clue',include:['person']},beats:[{cue:'object waits',kind:'hold',targets:['clue'],motionTargets:[],before:'Present',after:'Present'}]};
  const fixed=compileVectorProject(p);
  assert.ok(vectorDirectionIssues(fixed).some(i=>i.problem==='Story focus clue is too small to read'));
  const cropped=structuredClone(fixed),s=cropped.scenes[0]!;
  s.vectorScene!.tracks=s.vectorScene!.tracks.map(t=>t.target==='camera-world'?{...t,frames:[{t:0,dx:-10000,dy:0,scaleX:1,scaleY:1}]}:t);
  assert.ok(vectorDirectionIssues(cropped).some(i=>i.problem==='Shot crops required subject clue'));
  assert.equal(vectorShotVisibility(s,cropped.vectorAssets!,'clue',1000).missing,undefined);
});

test('native locations retain story-specific static objects across cuts without allowing native ID replacement or stage camera actions',()=>{
  const raw={vectorAssets:{hero:{rig:'simple-puppet'}},vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',cast:{person:'hero'},nodes:[{id:'story-counter',type:'group',x:300,y:800,width:120,height:80,nodes:[{id:'counter-top',type:'rect',width:120,height:80,fill:'#886644'}]}]}},scenes:['first','second'].map(id=>({id,durationMs:5000,narration:'He waits beside the counter.',vectorScene:{stage:'village'}}))};
  const before=structuredClone(raw),p=parseVectorPlan(JSON.stringify(raw),'test',{width:1280,height:720});
  assert.deepEqual(raw,before);
  for(const s of p.scenes){
    assert.equal(s.vectorScene!.nodes.filter(n=>n.id==='story-counter').length,1);
    assert.equal(s.vectorScene!.nodes.find(n=>n.id==='story-counter')!.parent,'illustrated-world');
    assert.ok(s.vectorScene!.nodes.some(n=>n.id==='counter-top'));
  }
  const collision=structuredClone(raw);collision.vectorStages.village.nodes[0]!.id='house-mid';
  assert.throws(()=>parseVectorPlan(JSON.stringify(collision),'test',{width:1280,height:720}),/duplicate|identity/i);
  assert.throws(()=>parseVectorPlan(JSON.stringify({...raw,vectorStages:{village:{...raw.vectorStages.village,camera:[]}}}),'test',{width:1280,height:720}),/individual shots/);
});
