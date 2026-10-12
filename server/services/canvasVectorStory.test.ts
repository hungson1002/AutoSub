import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVectorStory,assertVectorStoryFilm,vectorDirectionIssues} from './canvasVectorStory';
import {parseVectorPlan,applyVectorRepairs,vectorReviewFrameIndices} from './canvasVectorDirector';
import {evaluateVectorPart,compileVectorProject,vectorTrackTiming} from '../../shared/canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';

test('new compact screenplays lock visible trembling and sweating; legacy plans retain compatibility',()=>{
  const raw=screenplay() as Record<string,any>,beat=raw.shots[0].beats[0];
  Object.assign(beat,{kind:'motion',motionTargets:['old/upper-body'],after:'Run bần bật và đổ mồ hôi vì sợ'});
  assert.throws(()=>normalizeVectorStory(raw,14,{compactCast:true,requireFearPlan:true}),/must declare fear/);
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14,{compactCast:true}));
  beat.fear={actor:'old',level:'terrified'};
  assert.deepEqual(normalizeVectorStory(raw,14).shots[0]!.beats[0]!.fear,beat.fear);
  beat.fear.level='wild';assert.throws(()=>normalizeVectorStory(raw,14),/uneasy\/terrified/);
});

test('locked fear executes when omitted in artwork, follows speech, settles and survives repair replay',()=>{
  const narration='She listens. She trembles in fear. The bell stops.';
  const story={name:'Fear',premise:'A bell',stakes:'Someone outside',turn:'No one there',ending:'Silence',cast:[{id:'person',role:'traveler',design:'compact'}],
    shots:['fear','after'].map((id,i)=>({id,name:id,durationMs:5000,narration:i?'She waits beside the quiet gate.':narration,purpose:'React to the bell',location:'yard',
      visibleCast:['person'],heldProps:[{actor:'person',arm:'r',prop:'torch',hang:true}],shot:{size:'wide',focus:'person',include:[]},
      beats:[i?{cue:'She waits',kind:'hold',targets:['person'],motionTargets:[],before:'waiting',after:'waiting'}:
        {cue:'She trembles in fear.',kind:'motion',targets:['person'],motionTargets:['person/upper-body'],before:'calm',after:'afraid',fear:{actor:'person',level:'terrified'}}]}))} as any;
  const raw={vectorAssets:{hero:{rig:'simple-puppet',design:'village',finish:'handdrawn'},torch:{rig:'lantern'}},vectorStages:{yard:{template:'folk-courtyard',cast:{person:'hero'}}},
    scenes:story.shots.map((s:any,i:number)=>({id:s.id,narration:s.narration,durationMs:s.durationMs,vectorScene:{stage:'yard',nodes:[{id:'torch',type:'instance',asset:'torch',width:42,height:70}],
      tracks:i?[]:[{target:'person/upper-body',start:0,end:.1,cue:'She listens.',frames:[{t:0,rotation:0},{t:.5,rotation:2},{t:1,rotation:0}]}]}}))};
  const p=parseVectorPlan(JSON.stringify(raw),'fear',{width:1280,height:720},undefined,story);
  const oldArt=p.vectorAssets!.hero!.nodes.filter(n=>!n.id.startsWith('sweat-')&&!n.id.startsWith('fear-'));
  p.vectorAssets!.hero={...p.vectorAssets!.hero!,nodes:oldArt};
  const before=structuredClone(p);
  p.scenes[0]!.dialogue=[{id:'voice',speaker:'narrator',text:narration,atMs:100,durationMs:4000,speechWindows:[{startMs:0,endMs:4000}]}];
  const fixed=compileVectorProject(p),s=fixed.scenes[0]!;
  assert.deepEqual(fixed.vectorAssets!.hero!.nodes.filter(n=>!n.id.startsWith('sweat-')&&!n.id.startsWith('fear-')),oldArt,'retained character art is never replaced');
  assert.equal(p.vectorAssets!.hero!.nodes.some(n=>n.id==='fear-effects'),false,'input checkpoint remains untouched');
  const track=s.vectorScene!.tracks.find(t=>t.target==='person/upper-body'&&t.cue==='She trembles in fear.')!;
  assert.ok(s.vectorScene!.tracks.some(t=>t.cue==='She listens.'&&t.target==='person/upper-body'&&t.frames.some(f=>f.rotation===2)),'a preceding look is preserved');
  assert.equal(vectorTrackTiming(track,s).start,1140);
  assert.equal(vectorTrackTiming(track,s).end,3540);
  assert.equal(evaluateVectorPart('person/sweat-l',s,1100,0).opacity,0);
  assert.ok(evaluateVectorPart('person/sweat-l',s,1800,0).opacity>.8);
  assert.equal(evaluateVectorPart('person/sweat-l',fixed.scenes[1]!,0,0).opacity,0);
  assert.deepEqual(compileVectorProject(fixed),fixed);
  assert.equal(vectorDirectionIssues(fixed).filter(i=>i.problem.includes('No evaluated motion on person/upper-body')).length,0,'native small fear shivers must not trigger exaggerated corrective motion');
  const frozen=structuredClone(fixed);
  frozen.scenes[0]!.vectorScene!.tracks=frozen.scenes[0]!.vectorScene!.tracks.filter(t=>t.target!=='person/upper-body');
  assert.ok(vectorDirectionIssues(frozen).some(i=>i.problem.includes('No evaluated motion on person/upper-body')),'a frozen body still fails despite the animated face and sweat');
  const patched=applyVectorRepairs(fixed,JSON.stringify({newAssets:{},scenes:[{id:s.id,vectorScenePatch:{tracks:[{target:'person/upper-body',start:0,end:1,frames:[{t:0,dx:0},{t:1,dx:50}]}]}}]}),new Set([s.id]));
  assert.deepEqual(patched.scenes[0]!.vectorScene!.tracks.filter(t=>t.target==='person/upper-body'),s.vectorScene!.tracks.filter(t=>t.target==='person/upper-body'));
  assert.deepEqual(before.scenes[0]!.narration,s.narration);
});

test('new compact screenplays lock a whole-body turn before illustration; legacy plans stay readable',()=>{
  const raw=screenplay() as Record<string,any>;
  const beat=raw.shots[0].beats[0];
  Object.assign(beat,{kind:'motion',motionTargets:['old/upper-body'],after:'Quay cả người để lộ lưng'});
  assert.throws(()=>normalizeVectorStory(raw,14,{compactCast:true,requireTurnPlan:true}),/must declare turn/);
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14,{compactCast:true}),'retained narration is not reinterpreted');
  beat.turn={actor:'old',from:'front',to:'back'};
  const story=normalizeVectorStory(raw,14,{compactCast:true,requireTurnPlan:true});
  assert.deepEqual(story.shots[0]!.beats[0]!.turn,beat.turn);
  beat.turn.to='rear';assert.throws(()=>normalizeVectorStory(raw,14),/distinct front\/back/);
  beat.turn.to='back';beat.turn.actor='missing';assert.throws(()=>normalizeVectorStory(raw,14),/cast actor/);
});

test('locked turns execute despite omitted or wrong illustration and survive voice timing, cuts and repairs',()=>{
  const cast=[{id:'person',role:'traveler',design:'compact handdrawn'}];
  const shots=[
    {id:'back',narration:'She hears a voice, then turns away.',turn:{actor:'person',from:'front',to:'back'}},
    {id:'listen',narration:'The gate is empty. She listens.'},
    {id:'front',narration:'Still frightened, she turns back.',turn:{actor:'person',from:'back',to:'front'}},
  ].map(s=>({...s,name:s.id,durationMs:5000,purpose:'Look toward the voice',location:'yard',visibleCast:['person'],
    heldProps:[{actor:'person',arm:'r',prop:'torch',hang:true}],shot:{size:'wide',focus:'person',include:[]},
    beats:[{cue:s.turn?s.narration.slice(s.narration.indexOf('turns')):s.narration,kind:s.turn?'motion':'hold',
      targets:['person'],motionTargets:s.turn?['person/upper-body','person/head-group']:[],
      before:'held starting pose',after:s.turn?'changed facing':'held starting pose',...(s.turn?{turn:s.turn}:{})}]}));
  const story={name:'Turn',premise:'Voice',stakes:'Fear',turn:'Empty gate',ending:'Look back',cast,shots} as any;
  const raw={vectorAssets:{hero:{rig:'simple-puppet',finish:'handdrawn',hair:'bun'},torch:{rig:'lantern'}},
    vectorStages:{yard:{template:'folk-courtyard',cast:{person:'hero'}}},
    scenes:shots.map((s,i)=>({id:s.id,durationMs:s.durationMs,narration:s.narration,vectorScene:{stage:'yard',
      ...(i===0?{nodes:[{id:'torch',type:'instance',asset:'torch',width:44,height:74}],
        turns:[{actor:'person',from:'front',to:'left',start:.2,end:.6,cue:s.beats[0]!.cue}]}:{})}}))};
  const p=parseVectorPlan(JSON.stringify(raw),'night',{width:1280,height:720},15,story);
  p.scenes.forEach(s=>{s.durationMs=4000;s.dialogue=[{id:'voice',speaker:'narrator',text:s.narration!,atMs:0,durationMs:4000}];});
  const fixed=compileVectorProject(p),first=fixed.scenes[0]!,last=fixed.scenes[2]!;
  const track=first.vectorScene!.tracks.find(t=>t.target==='person/upper-body'&&t.frames.some(f=>f.scaleX!==undefined))!;
  const timing=vectorTrackTiming(track,first);
  assert.ok(timing.start>2000,'turn follows the spoken phrase, not an old fraction');
  assert.ok(Math.abs(timing.end-timing.start-300)<1e-6,'voice retiming retains a short 300ms turn');
  assert.equal(evaluateVectorPart('person/rear-head',first,timing.end,0).opacity,1,'wrong front mirror is replaced');
  assert.equal(evaluateVectorPart('person/rear-head',fixed.scenes[1]!,0,0).opacity,1,'a cut retains the back');
  assert.equal(evaluateVectorPart('person/rear-head',last,0,0).opacity,1,'return does not happen before its cue');
  assert.equal(evaluateVectorPart('person/rear-head',last,last.durationMs,0).opacity,0);
  assert.deepEqual(vectorDirectionIssues(fixed),[]);
  for(const s of fixed.scenes)for(let at=0;at<s.durationMs;at+=1000/30){
    assert.equal(s.vectorScene!.nodes.find(n=>n.id==='torch')!.attachTo,'person/hand-r');
    const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,at,fixed.vectorAssets),0,0);
    const grip=vectorPoint(vectorWorldMatrix('torch',s,at,fixed.vectorAssets),30,6);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-6);
  }
  assert.deepEqual(compileVectorProject(fixed),fixed,'checkpoint recompilation is idempotent');
  const repaired=applyVectorRepairs(fixed,JSON.stringify({scenes:[{id:first.id,vectorScenePatch:{tracks:[
    {target:'person/rear-head',start:0,end:1,frames:[{t:0,opacity:0}]},
    {target:'person/blink',start:0,end:1,frames:[{t:0,opacity:1}]},
  ]}}]}),new Set([first.id]));
  assert.equal(evaluateVectorPart('person/rear-head',repaired.scenes[0]!,4000,0).opacity,1,'repair cannot undo the planned view');
});

test('two planned turns in one AI shot have separate fallback times and follow their measured cues',()=>{
  const narration='She turns away to inspect the empty gate. After listening, she turns back toward the old woman.';
  const beats=[{cue:'turns away',from:'front',to:'back'},{cue:'turns back',from:'back',to:'front'}].map(b=>({
    cue:b.cue,kind:'motion',targets:['person'],motionTargets:['person/upper-body'],
    before:b.from,after:b.to,turn:{actor:'person',from:b.from,to:b.to},
  }));
  const story={name:'Two turns',premise:'Voice',stakes:'Fear',turn:'Empty gate',ending:'Face the witness',
    cast:[{id:'person',role:'traveler',design:'compact'}],shots:[{id:'one',name:'Turn twice',durationMs:8000,narration,
      purpose:'Investigate then return',location:'yard',visibleCast:['person'],shot:{size:'wide',focus:'person',include:[]},beats}]} as any;
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',finish:'handdrawn'}},
    vectorStages:{yard:{template:'folk-courtyard',cast:{person:'hero'}}},
    scenes:[{id:'one',durationMs:8000,narration,vectorScene:{stage:'yard'}}]}),'night',{width:1280,height:720},undefined,story);
  p.scenes[0]!.dialogue=[{id:'voice',speaker:'narrator',text:narration,atMs:0,durationMs:8000}];
  const fixed=compileVectorProject(p),s=fixed.scenes[0]!,tracks=s.vectorScene!.tracks.filter(t=>t.target==='person/rear-head');
  assert.equal(tracks.length,2);
  assert.ok(tracks[0]!.end<tracks[1]!.start,'fallback intervals do not all start at zero');
  const first=vectorTrackTiming(tracks[0]!,s),last=vectorTrackTiming(tracks[1]!,s);
  assert.equal(evaluateVectorPart('person/rear-head',s,first.end,0).opacity,1);
  assert.equal(evaluateVectorPart('person/rear-head',s,last.start-1,0).opacity,1);
  assert.equal(evaluateVectorPart('person/rear-head',s,last.end,0).opacity,0);
  assert.ok(Math.abs(first.end-first.start-300)<1e-6);
  assert.ok(Math.abs(last.end-last.start-300)<1e-6);
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('screenplay preserves an explicit motivated close cut and rejects invented framing modes',()=>{
  const raw=screenplay();Object.assign(raw.shots[0]!.shot,{framing:'close'});
  assert.equal(normalizeVectorStory(raw,14).shots[0]!.shot.framing,'close');
  Object.assign(raw.shots[0]!.shot,{framing:'giant'});
  assert.throws(()=>normalizeVectorStory(raw,14),/context or close/);
});

test('locked wide shots ignore redundant invalid close framing from the illustrator',()=>{
  const script=screenplay();script.shots[0]!.shot.size='wide';
  const plan=drawing() as Record<string,any>;
  plan.scenes[0].vectorScene.shot={target:'old',height:.18};
  const p=parseVectorPlan(JSON.stringify(plan),'test',{width:720,height:1280},14,normalizeVectorStory(script,14));
  const camera=p.scenes[0]!.vectorScene!.tracks.find(t=>t.target==='camera-world')!;
  assert.equal(camera.frames[0]!.scaleY,1);
  assert.equal(p.scenes[0]!.narration,script.shots[0]!.narration);
});

test('locked action framing ignores illustrator copies of screenplay shot metadata',()=>{
  const script=normalizeVectorStory(screenplay(),14),plan=drawing() as Record<string,any>;
  plan.scenes.forEach((s:any,i:number)=>{
    s.vectorScene.shot={...script.shots[i]!.shot};
    delete s.vectorScene.camera;
  });
  assert.throws(()=>parseVectorPlan(JSON.stringify(plan),'test',{width:720,height:1280},14),/subject shot needs an existing actor instance/);
  const p=parseVectorPlan(JSON.stringify(plan),'test',{width:720,height:1280},14,script);
  p.scenes.forEach((s,i)=>{
    assert.deepEqual(s.vectorDirection!.shot,script.shots[i]!.shot);
    assert.equal(s.narration,script.shots[i]!.narration);
    assert.equal(s.vectorScene!.tracks.find(t=>t.target==='camera-world')!.frames.length,1);
  });
  assert.deepEqual(compileVectorProject(p),p);
});

test('selected compact cast rejects invented feet before drawing and resolves supported part aliases',()=>{
  const raw=screenplay(),beat=raw.shots[0]!.beats[0]!;
  Object.assign(beat,{motionTargets:['old/head','old/arm-r']});
  const story=normalizeVectorStory(raw,14,{compactCast:true});
  assert.deepEqual(story.shots[0]!.beats[0]!.motionTargets,['old/head-group','old/hand-r']);
  Object.assign(beat,{motionTargets:['old/leg-l']});
  assert.throws(()=>normalizeVectorStory(raw,14,{compactCast:true}),/no visible legs or feet/);
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14),'articulated checkpoints retain their supported anatomy');
  assert.throws(()=>normalizeVectorStory(raw,14,{nativePerson:true}),/actor ID person/);
  Object.assign(beat,{motionTargets:['pig/leg-fl','pig/knee-fr']});
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14,{compactCast:true}),'animal anatomy is not a human leg alias');
});

test('new screenplays declare view cast, keep an empty exterior and retain old checkpoints',()=>{
  const raw=screenplay();
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14));
  assert.throws(()=>normalizeVectorStory(raw,14,{requireVisibleCast:true}),/must declare visibleCast/);
  const staged={...raw,shots:raw.shots.map(s=>({...s,visibleCast:['old','lam']}))};
  const story=normalizeVectorStory(staged,14,{requireVisibleCast:true});
  const p=parseVectorPlan(JSON.stringify(drawing()),'test',{width:720,height:1280},14,story);
  assert.deepEqual(p.scenes[0]!.vectorDirection!.visibleCast,['old','lam']);
  staged.shots[1]!.visibleCast=[];
  assert.deepEqual(normalizeVectorStory(staged,14,{requireVisibleCast:true}).shots[1]!.visibleCast,[]);
  staged.shots[1]!.visibleCast=['unknown'];
  assert.throws(()=>normalizeVectorStory(staged,14),/registered cast/);
});

test('view visibility overrides stale exterior actors without dropping their held inventory',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet'},torch:{rig:'lantern'}},
    vectorStages:{yard:{template:'folk-courtyard',cast:{person:'hero'}},room:{template:'folk-room',cast:{person:'hero'}}},
    scenes:['yard','room','yard','room'].map(stage=>({durationMs:4000,narration:'She listens.',vectorScene:{stage,
      nodes:[{id:'torch',type:'instance',asset:'torch',width:44,height:74}],carries:[{actor:'person',arm:'l',prop:'torch',hang:true}],
      tracks:[{target:'person',start:0,end:1,frames:[{t:0,opacity:1}]}]}})),
  }),'night',{width:1280,height:720});
  p.scenes.forEach((s,i)=>s.vectorDirection={purpose:'Listen from this side of the door',location:s.vectorStageId!,visibleCast:i===2?[]:['person'],
    heldProps:i===0?[{actor:'person',arm:'l',prop:'torch',hang:true}]:[],shot:{size:i===2?'wide':'action',focus:i===2?'house':'person',include:[]},
    beats:[{cue:'She listens.',kind:'hold',targets:['door'],motionTargets:[],before:'listening',after:'listening'}]});
  const fixed=compileVectorProject(p);
  assert.equal(evaluateVectorPart('person',fixed.scenes[2]!,0,fixed.scenes[2]!.vectorScene!.nodes.find(n=>n.id==='person')!.opacity).opacity,0);
  assert.equal(evaluateVectorPart('person',fixed.scenes[3]!,0,fixed.scenes[3]!.vectorScene!.nodes.find(n=>n.id==='person')!.opacity).opacity,1);
  for(const s of fixed.scenes){
    assert.equal(s.vectorScene!.nodes.find(n=>n.id==='torch')!.attachTo,'person/hand-l');
    assert.equal(s.vectorDirection!.heldProps![0]!.prop,'torch');
    const hand=vectorPoint(vectorWorldMatrix('person/hand-l',s,2000,fixed.vectorAssets),0,0);
    const grip=vectorPoint(vectorWorldMatrix('torch',s,2000,fixed.vectorAssets),30,6);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-6);
  }
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('face-overlap QC measures visible puppets and ignores hidden actors or a brief crossing',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{human:{rig:'simple-puppet'}},scenes:[{durationMs:5000,narration:'They listen.',vectorScene:{width:1280,height:720,nodes:[
    {id:'background',type:'rect',width:1280,height:720,fill:'#777766'},
    {id:'one',type:'instance',asset:'human',x:400,y:240},
    {id:'two',type:'instance',asset:'human',x:405,y:240},
  ]}}]}),'test',{width:1280,height:720});
  const s=p.scenes[0]!;s.vectorDirection={purpose:'Two people listen',location:'yard',visibleCast:['one','two'],shot:{size:'action',focus:'one',include:['two']},
    beats:[{cue:'They listen.',kind:'hold',targets:['one','two'],motionTargets:[],before:'listening',after:'listening'}]};
  assert.ok(vectorDirectionIssues(p).some(i=>i.problem.includes('faces one and two overlap')));
  s.vectorScene!.nodes.find(n=>n.id==='two')!.x=650;
  assert.deepEqual(vectorDirectionIssues(p),[]);
  s.vectorScene!.nodes.find(n=>n.id==='two')!.x=405;s.vectorScene!.nodes.find(n=>n.id==='two')!.opacity=0;
  assert.deepEqual(vectorDirectionIssues(p),[]);
  s.vectorScene!.nodes.find(n=>n.id==='two')!.opacity=1;
  s.vectorScene!.tracks.push({target:'two',start:0,end:1,frames:[{t:0,dx:-300},{t:1,dx:300}]});
  assert.deepEqual(vectorDirectionIssues(p),[]);
  // The live film's late retreat merged faces only for its final second.
  // It must be rejected even though most of the shot remains separated.
  s.vectorScene!.tracks=[{target:'two',start:.75,end:.9,frames:[{t:0,dx:200},{t:1,dx:0}]}];
  assert.ok(vectorDirectionIssues(p).some(i=>i.problem.includes('settled final pose')));
  s.vectorScene!.tracks=[{target:'two',start:.75,end:.9,frames:[{t:0,dx:200},{t:1,dx:170}]}];
  assert.deepEqual(vectorDirectionIssues(p),[],'a small late retreat keeps both faces readable');
});

test('a directed native puppet look passes without demanding exaggerated head swings',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard'}},scenes:[{
    durationMs:4000,narration:'She looks.',vectorScene:{stage:'yard',reactions:[{actor:'person',toward:'door',kind:'look',start:0,end:.4,cue:'She looks.'}]},
  }]}),'night',{width:720,height:1280});
  const s=p.scenes[0]!;s.vectorDirection={purpose:'Notice the door',location:'yard',shot:{size:'reaction',focus:'person',include:['door']},beats:[
    {cue:'She looks.',kind:'motion',targets:['person','door'],motionTargets:['person/head-group','person/eyes'],before:'looking ahead',after:'looking at the door'},
  ]};
  assert.deepEqual(vectorDirectionIssues(p),[]);
  // A barely changing pose still cannot stand in for a directed look.
  for(const t of s.vectorScene!.tracks)for(const f of t.frames){if(f.rotation!==undefined)f.rotation*=.01;if(f.dx!==undefined)f.dx*=.01;}
  assert.ok(vectorDirectionIssues(p).some(i=>i.problem.includes('No evaluated motion')));
});

test('root travel moves the puppet head and a self-moving ring needs no invented arm',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard'}},scenes:[{
    durationMs:5000,narration:'She retreats. The ring knocks.',vectorScene:{stage:'yard',
      walks:[{actor:'person',to:'door',backstep:60,cue:'She retreats',start:0,end:.3}],
      tracks:[{target:'ring',cue:'The ring knocks',start:.4,end:.7,frames:[{t:0,rotation:0},{t:.5,rotation:25},{t:1,rotation:0}]}]},
  }]}),'night horror',{width:720,height:1280});
  p.scenes[0]!.vectorDirection={purpose:'Retreat',location:'yard',shot:{size:'reaction',focus:'person',include:['ring']},beats:[
    {cue:'She retreats',kind:'travel',targets:['person'],motionTargets:['person','person/head-group'],before:'near the door',after:'away from the door'},
    {cue:'The ring knocks',kind:'strike',targets:['ring'],motionTargets:['ring'],before:'resting',after:'swinging'},
  ]};
  assert.deepEqual(vectorDirectionIssues(p),[]);
});

test('puppet contact QC rejects a chest wobble and accepts native hand-to-object contact',()=>{
  const cue='chạm vòng cửa';
  const raw={vectorAssets:{human:{rig:'simple-puppet'},ring:{width:30,height:40,nodes:[{id:'ring',type:'ellipse',x:15,y:20,rx:12,ry:18,fill:'#998855'}]}},scenes:[{
    durationMs:5000,narration:cue,vectorScene:{width:720,height:1280,nodes:[
      {id:'person',type:'instance',asset:'human',x:100,y:500},
      {id:'ring',type:'instance',asset:'ring',x:300,y:610},
    ],tracks:[{target:'person/hand-r',cue,start:0,end:.5,frames:[{t:0,dx:0},{t:1,dx:12}]},
      {target:'ring',cue,start:0,end:.5,frames:[{t:0,rotation:0},{t:1,rotation:10}]}]},
  }]};
  const bad=parseVectorPlan(JSON.stringify(raw),'night horror',{width:720,height:1280});
  const direction={purpose:'Contact',location:'yard',shot:{size:'action' as const,focus:'person',include:['ring']},beats:[
    {cue,kind:'motion' as const,targets:['person','ring'],motionTargets:['person/hand-r','ring'],before:'hand beside body',after:'hand touches ring'},
  ]};
  bad.scenes[0]!.vectorDirection=direction;
  assert.ok(vectorDirectionIssues(bad).some(i=>i.problem.includes('never touches ring')));
  const good=structuredClone(raw);
  (good.scenes[0]!.vectorScene as any).reaches=[{actor:'person',arm:'r',target:'ring',cue,start:0,end:.5}];
  const p=parseVectorPlan(JSON.stringify(good),'night horror',{width:720,height:1280});p.scenes[0]!.vectorDirection=direction;
  assert.deepEqual(vectorDirectionIssues(p),[]);
});

test('travel QC follows a carried lamp through the actual hand hierarchy without requiring detached local motion',()=>{
  const cue='walks with the lamp';
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{human:{rig:'simple-human'},light:{rig:'lantern'}},scenes:[{
    narration:cue,durationMs:8000,vectorScene:{width:720,height:1280,nodes:[
      {id:'person',type:'instance',asset:'human',x:100,y:400,width:200,height:400},
      {id:'lamp',type:'instance',asset:'light',width:45,height:75},
      {id:'door',type:'rect',x:480,y:500,width:60,height:300,fill:'#543'},
    ],carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],walks:[{actor:'person',to:'door',gap:70,carry:'r',cue,start:0,end:1}]},
  }]}),'test',{width:720,height:1280});
  p.scenes[0]!.vectorDirection={purpose:'Travel',location:'room',shot:{size:'action',focus:'person',include:['door']},heldProps:[{actor:'person',arm:'r',prop:'lamp',hang:true}],beats:[
    {cue,kind:'travel',targets:['person','lamp'],motionTargets:['person','person/leg-l','person/leg-r','lamp'],before:'here',after:'at the door'},
  ]};
  assert.deepEqual(vectorDirectionIssues(p),[]);
  const still=structuredClone(p);still.scenes[0]!.vectorScene!.tracks=still.scenes[0]!.vectorScene!.tracks.filter(t=>!t.target.startsWith('person'));
  assert.ok(vectorDirectionIssues(still).some(issue=>issue.problem.includes('No evaluated travel on lamp')));
});

test('lighting repairs keep the case visible and animate the flame without erasing a narrated event',()=>{
  const cue='Ngọn lửa bùng sáng';
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{light:{rig:'lantern'},human:{rig:'simple-human'}},scenes:[{narration:cue,durationMs:6000,vectorScene:{width:720,height:1280,nodes:[
    {id:'person',type:'instance',asset:'human',x:150,y:500,width:200,height:400},
    {id:'lamp',type:'instance',asset:'light',x:300,y:700},
  ],tracks:[{target:'lamp',start:.2,end:.5,cue,frames:[{t:0,opacity:0},{t:1,opacity:1}]}]}}]}),'test',{width:720,height:1280});
  const s=p.scenes[0]!;
  s.vectorDirection={purpose:'Light',location:'room',shot:{size:'detail',focus:'lamp',include:[]},beats:[
    {cue,kind:'reveal',targets:['lamp'],motionTargets:['lamp'],before:'unlit',after:'lit'},
  ]};
  const patch={scenes:[{id:s.id,vectorScenePatch:{carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],tracks:[
    {target:'lamp',start:0,end:1,frames:[{t:0,opacity:1}]},
    {target:'lamp/flame',start:.2,end:.5,cue,frames:[{t:0,opacity:0},{t:1,opacity:1}]},
  ]}}]};
  const after=applyVectorRepairs(p,JSON.stringify(patch),new Set([s.id]));
  assert.equal(evaluateVectorPart('lamp',after.scenes[0]!,0).opacity,1);
  assert.equal(evaluateVectorPart('lamp/flame',after.scenes[0]!,0).opacity,0);
  assert.ok(!vectorDirectionIssues(after).some(issue=>issue.problem.includes('No evaluated reveal')));
  patch.scenes[0]!.vectorScenePatch.tracks.pop();
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify(patch),new Set([s.id])),/erased narrated action/);
});

test('a physical release can remain opaque, and a component reveal need not fade the entire creature',()=>{
  const drop='nhả mẩu xương rơi xuống',claws='móng vuốt xuất hiện';
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{dog:{width:100,height:100,nodes:[
    {id:'paw',type:'ellipse',rx:10,ry:10,fill:'#333'},
  ]},bone:{width:20,height:20,nodes:[{id:'shape',type:'rect',width:20,height:20,fill:'#ccc'}]}},scenes:[{
    narration:drop+' '+claws,durationMs:6000,vectorScene:{width:720,height:1280,nodes:[
      {id:'dog',type:'instance',asset:'dog',x:400,y:600},{id:'bone',type:'instance',asset:'bone',x:420,y:640},
    ],tracks:[
      {target:'bone',start:.1,end:.4,cue:drop,frames:[{t:0,opacity:0},{t:1,opacity:1}]},
      {target:'dog',start:.5,end:.8,cue:claws,frames:[{t:0,opacity:0},{t:1,opacity:1}]},
    ]},
  }]}),'test',{width:720,height:1280});
  const s=p.scenes[0]!;
  s.vectorDirection={purpose:'Act',location:'room',shot:{size:'detail',focus:'dog',include:[]},beats:[
    {cue:drop,kind:'reveal',targets:['bone'],motionTargets:['bone'],before:'in mouth',after:'falls'},
    {cue:claws,kind:'reveal',targets:['dog'],motionTargets:['dog/paw'],before:'hidden',after:'claws visible'},
  ]};
  const patch={scenes:[{id:s.id,vectorScenePatch:{tracks:[
    {target:'bone',start:0,end:1,frames:[{t:0,opacity:1}]},
    {target:'bone',start:.1,end:.4,cue:drop,frames:[{t:0,dy:0},{t:1,dy:100}]},
    {target:'dog',start:0,end:1,frames:[{t:0,opacity:1}]},
    {target:'dog/paw',start:.5,end:.8,cue:claws,frames:[{t:0,opacity:0},{t:1,opacity:1}]},
  ]}}]};
  const after=applyVectorRepairs(p,JSON.stringify(patch),new Set([s.id]));
  assert.deepEqual(vectorDirectionIssues(after),[]);
  patch.scenes[0]!.vectorScenePatch.tracks.splice(1,1);
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify(patch),new Set([s.id])),/erased narrated action/);
});

function screenplay(){return {
  name:'Tiếng chuông',premise:'Khách qua sông đêm',stakes:'Nguy cơ bị kéo xuống nước',turn:'Tiếng chuông làm dấu chân dừng lại',ending:'Dấu chân biến mất trước mắt khách',
  cast:[{id:'old',role:'Người lái đò',design:'Áo chàm'},{id:'lam',role:'Khách',design:'Áo nâu'}],shots:[
    {id:'shot-1',name:'Chèo',durationMs:7000,narration:'Ông lái đò khua mái chèo qua làn nước lạnh, còn người khách nhìn ngọn đèn vàng trước mặt.',purpose:'Bình thường trước khi nguy hiểm',location:'river',shot:{size:'action',focus:'old',include:['lam']},
      beats:[{cue:'khua mái chèo',kind:'row',targets:['old','old/oar'],motionTargets:['old/arm-r','old/forearm-r'],before:'Tay cầm chèo',after:'Hoàn tất hai nhịp chèo'}]},
    {id:'shot-2',name:'Chuông',durationMs:7000,narration:'Ông giơ tay gõ chuông đồng rồi buông xuống. Người khách nín thở, chờ tiếng động cuối cùng tan vào màn đêm.',purpose:'Hành động bảo vệ và kết quả',location:'river',shot:{size:'action',focus:'old',include:['lam','bell']},
      beats:[{cue:'gõ chuông đồng',kind:'strike',targets:['old','bell'],motionTargets:['old/arm-l','bell'],before:'Tay buông',after:'Chạm chuông rồi rút tay'}]},
  ]};}
const story=()=>normalizeVectorStory(screenplay(),14);

test('new compact turns reject equivalent front/right views before drawing',()=>{
  const raw=screenplay() as any,beat=raw.shots[0].beats[0];
  Object.assign(beat,{kind:'motion',targets:['old'],motionTargets:['old/upper-body'],turn:{actor:'old',from:'front',to:'right'}});
  assert.throws(()=>normalizeVectorStory(raw,14,{compactCast:true,requireTurnPlan:true}),/same view/);
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14),'retained projects remain readable');
  beat.turn.to='left';assert.doesNotThrow(()=>normalizeVectorStory(raw,14,{compactCast:true,requireTurnPlan:true}));
});

test('a named actor action cannot be replaced by villagers looking at them',()=>{
  const raw=screenplay() as any;
  raw.cast[0].role='Thuận - traveler';
  raw.shots.forEach((s:any)=>{s.visibleCast=['old','lam'];s.heldProps=[];});
  raw.shots[0].narration='Thuận quay đầu nhìn lại, người khách đang nhìn.';
  raw.shots[0].beats=[{cue:'Thuận quay đầu nhìn lại,',kind:'motion',targets:['lam'],motionTargets:['lam/head-group'],before:'waiting',after:'looks at traveler'}];
  assert.throws(()=>normalizeVectorStory(raw,14,{requireVisibleCast:true}),/animate that actor/);
  raw.shots[0].beats[0].targets=['old'];raw.shots[0].beats[0].motionTargets=['old/head-group'];
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14,{requireVisibleCast:true}));
});

test('busy market screenplay needs staggered secondary actions, not one late passing extra',()=>{
  const raw=screenplay() as any;
  raw.cast.push({id:'seller',role:'vendor',design:'compact'},{id:'buyer',role:'buyer',design:'compact'});
  raw.shots.forEach((s:any)=>{s.visibleCast=['old','lam','seller','buyer'];s.heldProps=[];});
  const s=raw.shots[0];s.shot={size:'wide',focus:'old',include:[]};
  s.narration='Phiên chợ có người mua kẻ bán qua lại lặng lẽ, người bán đứng bên quầy hàng, còn người khách chờ phía trước.';
  s.beats=[{cue:'người mua kẻ bán qua lại',kind:'travel',targets:['buyer'],motionTargets:['buyer'],before:'at edge',after:'at stall'}];
  assert.throws(()=>normalizeVectorStory(raw,14,{compactCast:true,requireVisibleCast:true}),/two active background actors/);
  s.beats.push({cue:'người bán đứng bên quầy hàng',kind:'motion',targets:['seller'],motionTargets:['seller/head-group'],before:'looking down',after:'looks toward buyer'});
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14,{compactCast:true,requireVisibleCast:true}));
  s.purpose='Quiet waiting';s.narration=s.narration.replace('người mua kẻ bán qua lại','mọi người cùng đứng yên');
  s.beats=[{cue:'mọi người cùng đứng yên',kind:'hold',targets:['old'],motionTargets:[],before:'waiting',after:'waiting'}];
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14,{compactCast:true,requireVisibleCast:true}),'deliberate stillness stays valid');
});
function drawing(actions=true){return {name:'Tiếng chuông',vectorStages:{river:{template:'folk-river-boat'}},scenes:story().shots.map((s,i)=>({id:s.id,name:s.name,durationMs:s.durationMs,narration:s.narration,vectorScene:{stage:'river',camera:[{t:0,x:360,y:640,zoom:1}],
  ...(actions?i===0?{rows:[{actor:'old',arm:'r',prop:'old/oar',cycles:2,start:0,end:.8,cue:'khua mái chèo'}]}:{strikes:[{actor:'old',arm:'l',target:'bell',start:0,end:.6,cue:'gõ chuông đồng'}]}:{}),
}}))};}

test('portable screenplay rejects missing ending, unspoken action cues and excess speech before SVG/TTS',()=>{
  assert.equal(story().shots.length,2);
  assert.throws(()=>normalizeVectorStory({...screenplay(),ending:''},14),/ending/);
  const bad=screenplay();bad.shots[0]!.beats[0]!.cue='không hề được kể';assert.throws(()=>normalizeVectorStory(bad,14),/not spoken/);
  assert.throws(()=>normalizeVectorStory(screenplay(),60),/words|runtime/);
  assert.throws(()=>normalizeVectorStory({...screenplay(),shots:[screenplay().shots[0]]},14),/ending/);
});

test('screenplay hand ownership drives actual grips even when the illustrator leaves the lamp in world coordinates',()=>{
  const script=screenplay() as Record<string,any>;
  script.shots[0].heldProps=[{actor:'old',arm:'l',prop:'carried-lamp',hang:true}];
  const plan=drawing() as Record<string,any>;
  plan.vectorAssets={'portable-lamp':{rig:'lantern'}};
  plan.scenes[0].vectorScene.nodes=[{id:'carried-lamp',type:'instance',asset:'portable-lamp',x:110,y:600,width:48,height:80}];
  const p=parseVectorPlan(JSON.stringify(plan),'test',{width:720,height:1280},14,normalizeVectorStory(script,14));
  const s=p.scenes[0]!,a=p.vectorAssets!;
  assert.equal(s.vectorScene!.nodes.find(n=>n.id==='carried-lamp')!.attachTo,'old/hand-l');
  for(let t=0;t<=s.durationMs;t+=100){
    const grip=vectorPoint(vectorWorldMatrix('carried-lamp',s,t,a),30,6),hand=vectorPoint(vectorWorldMatrix('old/hand-l',s,t,a),0,0);
    assert.ok(Math.hypot(grip.x-hand.x,grip.y-hand.y)<1e-7);
  }
  assert.ok(!vectorDirectionIssues(p).some(i=>i.problem.includes('Held prop')));
  s.vectorScene!.nodes.find(n=>n.id==='carried-lamp')!.attachTo='old/forearm-l';
  assert.ok(vectorDirectionIssues(p).some(i=>i.problem.includes('not attached')));
});

test('screenplay rejects double-booked hands, repeated narration and an ending made only of reflection',()=>{
  const duplicateHand=screenplay() as Record<string,any>;
  duplicateHand.shots[0].heldProps=[{actor:'old',arm:'r',prop:'lamp'},{actor:'old',arm:'r',prop:'knife'}];
  assert.throws(()=>normalizeVectorStory(duplicateHand,14),/one prop/);
  const repeat=screenplay();repeat.shots[1]!.narration=repeat.shots[0]!.narration;repeat.shots[1]!.beats=repeat.shots[0]!.beats;
  assert.throws(()=>normalizeVectorStory(repeat,14),/repeats adjacent/);
  const reflection=screenplay();for(const s of reflection.shots)for(const b of s.beats)b.kind='hold';
  assert.throws(()=>normalizeVectorStory(reflection,14),/observable event/);
});

test('screenplay omissions retain inventory and releases require an observable prop beat at spoken words',()=>{
  const raw=screenplay() as Record<string,any>;
  raw.shots[0].heldProps=[{actor:'old',arm:'l',prop:'portable-lamp',hang:true}];
  raw.shots[1].heldProps=[];
  const inherited=normalizeVectorStory(raw,14);
  assert.deepEqual(inherited.shots[1]!.heldProps,raw.shots[0].heldProps);
  raw.shots[1].propEvents=[{prop:'portable-lamp',action:'release',cue:raw.shots[1].beats[0].cue}];
  assert.throws(()=>normalizeVectorStory(raw,14),/observable beat/);
  raw.shots[1].beats[0].targets.push('portable-lamp');
  assert.deepEqual(normalizeVectorStory(raw,14).shots[1]!.heldProps,[]);
  raw.shots[1].propEvents[0].cue='not spoken';
  assert.throws(()=>normalizeVectorStory(raw,14),/exact spoken cue/);
});

test('review catches an undeclared carryable left floating beside an actor',()=>{
  const plan=drawing() as Record<string,any>;
  plan.vectorAssets={knife:{width:40,height:90,nodes:[{id:'handle',type:'rect',x:16,y:52,width:6,height:28,fill:'#321'}]}};
  plan.scenes[0].vectorScene.nodes=[{id:'knife',type:'instance',asset:'knife',x:160,y:720,width:28,height:70}];
  const p=parseVectorPlan(JSON.stringify(plan),'test',{width:720,height:1280},14,story());
  assert.ok(vectorDirectionIssues(p).some(i=>i.problem.includes('knife floats')));
  p.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='knife')!.opacity=0;
  assert.ok(!vectorDirectionIssues(p).some(i=>i.problem.includes('knife floats')));
});

test('a provider purpose-only hold preserves its exact description without inventing an action',()=>{
  const s=screenplay() as Record<string,any>,b=s.shots[0].beats[0];
  b.kind='hold';b.purpose='Listen to the sound without changing pose';delete b.before;delete b.after;
  const result=normalizeVectorStory(s,14).shots[0]!.beats[0]!;
  assert.equal(result.before,b.purpose);assert.equal(result.after,b.purpose);
  b.kind='motion';assert.throws(()=>normalizeVectorStory(s,14),/before state/);
});

test('fresh screenplays must specify occupied hands while existing checkpoints remain compatible',()=>{
  const raw=screenplay() as Record<string,any>;
  assert.throws(()=>normalizeVectorStory(raw,14,{requireHandPlan:true}),/must declare heldProps/);
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14));
  for(const shot of raw.shots)shot.heldProps=[];
  assert.doesNotThrow(()=>normalizeVectorStory(raw,14,{requireHandPlan:true}));
});

test('a two-actor walk can name twelve real moving parts and conventional actor/root addresses without rewriting narration',()=>{
  const raw=screenplay(),s=raw.shots[0]!,beat=s.beats[0]!;
  beat.kind='travel';beat.targets=['old/root','lam/root'];
  beat.motionTargets=['old/root','old/leg-l','old/leg-r','old/knee-l','old/knee-r','old/foot-l','old/foot-r',
    'lam/root','lam/leg-l','lam/leg-r','lam/knee-l','lam/knee-r'];
  const story=normalizeVectorStory(raw,14);
  assert.deepEqual(story.shots[0]!.beats[0]!.targets,['old','lam']);
  assert.equal(story.shots[0]!.beats[0]!.motionTargets.length,12);
  assert.equal(story.shots[0]!.beats[0]!.motionTargets[0],'old');
  assert.equal(story.shots[0]!.narration,s.narration);
  assert.equal(beat.targets[0],'old/root','source response remains untouched');
  const film=parseVectorPlan(JSON.stringify(drawing(false)),'test',{width:720,height:1280},14,story);
  assert.equal(film.scenes[0]!.vectorBeats![0]!.targets.length,12,'combined participant/joint addresses survive the artwork parser too');
});

test('drawing cannot quietly omit the final scene, change narration or substitute a different location',()=>{
  assertVectorStoryFilm(drawing(),story());
  assert.throws(()=>assertVectorStoryFilm({...drawing(),scenes:drawing().scenes.slice(0,1)},story()),/EVERY/);
  const edited=drawing();edited.scenes[1]!.narration='Kết thúc khác.';assert.throws(()=>assertVectorStoryFilm(edited,story()),/changed screenplay/);
  const relocated=drawing();relocated.scenes[1]!.vectorScene.stage='other';assert.throws(()=>parseVectorPlan(JSON.stringify(relocated),'test',{width:720,height:1280},14,story()),/location/);
});

test('static ferryman plus blinks, flame and moving water never pass a declared rowing beat',()=>{
  const p=parseVectorPlan(JSON.stringify(drawing(false)),'test',{width:720,height:1280},14,story());
  for(const s of p.scenes)s.vectorScene!.tracks=s.vectorScene!.tracks.filter(t=>!t.cue);
  assert.ok(p.scenes[0]!.vectorScene!.tracks.length>0,'template already has living ambience');
  const issues=vectorDirectionIssues(p);
  assert.ok(issues.some(i=>i.sceneId===p.scenes[0]!.id&&i.problem.includes('rowing')||i.problem.includes('Rowing')));
  assert.ok(issues.some(i=>i.sceneId===p.scenes[1]!.id&&i.problem.includes('withdraw')));
  assert.deepEqual(p.scenes[0]!.vectorBeats!.map(b=>b.cue),['khua mái chèo'],'beats come from the screenplay even when model omits them');
});

test('native strokes preserve grip/feet, strike reaches the actual bell then withdraws, and required partner fits the shot',()=>{
  const p=parseVectorPlan(JSON.stringify(drawing()),'test',{width:720,height:1280},14,story());
  assert.deepEqual(vectorDirectionIssues(p),[]);
  const row=p.scenes[0]!,strike=p.scenes[1]!,a=p.vectorAssets!;
  const foot=vectorPoint(vectorWorldMatrix('old/foot-r',row,0,a),0,0);
  for(let i=0;i<=32;i++){
    const t=row.durationMs*i/32,grip=vectorPoint(vectorWorldMatrix('old/oar',row,t,a),0,0),hand=vectorPoint(vectorWorldMatrix('old/hand-r',row,t,a),0,0);
    assert.ok(Math.hypot(grip.x-hand.x,grip.y-hand.y)<1e-8);
    const planted=vectorPoint(vectorWorldMatrix('old/foot-r',row,t,a),0,0);assert.ok(Math.hypot(foot.x-planted.x,foot.y-planted.y)<1e-8);
  }
  const contactTime=strike.durationMs*.6*.38;
  const hand=vectorPoint(vectorWorldMatrix('old/hand-l',strike,contactTime,a),0,0),bell=a['folk-bell']!;
  const contact=vectorPoint(vectorWorldMatrix('bell',strike,contactTime,a),bell.width/2,bell.height*.55);
  assert.ok(Math.hypot(hand.x-contact.x,hand.y-contact.y)<1e-7,'physical hand contact is solved, not guessed');
  assert.equal(evaluateVectorPart('old/arm-l',strike,strike.durationMs).rotation,0);
  for(const s of p.scenes)for(const actor of ['lam','old']){
    const node=s.vectorScene!.nodes.find(n=>n.id===actor)!,asset=a[node.asset!]!,m=vectorWorldMatrix(actor,s,0,a);
    const left=vectorPoint(m,40,60),right=vectorPoint(m,200,465);
    assert.ok(left.x>=25&&right.x<=695,'included partner remains visible');
  }
  assert.deepEqual(compileVectorProject(p),p,'canonical direction, geometry and cuts survive resume');
});

test('exact missing-acting repair reuses narration, audio, timing and world, without mutating checkpoint',()=>{
  const p=parseVectorPlan(JSON.stringify(drawing(false)),'test',{width:720,height:1280},14,story());
  p.scenes[0]!.vectorScene!.tracks=p.scenes[0]!.vectorScene!.tracks.filter(t=>t.cue!=='khua mái chèo');
  p.scenes[0]!.audioUrl='/retained.wav';p.scenes[0]!.dialogue![0]!.audioUrl='/retained-voice.wav';
  const before=structuredClone(p),s=p.scenes[0]!;
  const repaired=applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{rows:[{actor:'old',arm:'r',prop:'old/oar',cycles:2,start:0,end:.8,cue:'khua mái chèo'}]}}]}),new Set([s.id]));
  assert.ok(!vectorDirectionIssues(repaired).some(i=>i.sceneId===s.id));
  assert.deepEqual(repaired.scenes[0]!.vectorDirection,s.vectorDirection);
  assert.equal(repaired.scenes[0]!.audioUrl,s.audioUrl);assert.deepEqual(repaired.scenes[0]!.dialogue,s.dialogue);
  assert.equal(repaired.scenes[0]!.durationMs,s.durationMs);assert.equal(repaired.scenes[0]!.narration,s.narration);
  assert.deepEqual(repaired.vectorStages,p.vectorStages);assert.deepEqual(repaired.scenes[1],p.scenes[1]);assert.deepEqual(p,before);
});

test('a weak illustrator omitting action commands still gets screenplay rowing and real bell contact automatically',()=>{
  const p=parseVectorPlan(JSON.stringify(drawing(false)),'test',{width:720,height:1280},14,story());
  assert.deepEqual(vectorDirectionIssues(p),[]);
  assert.ok(p.scenes[0]!.vectorScene!.tracks.some(t=>t.target==='old/arm-r'&&t.cue==='khua mái chèo'));
  assert.ok(p.scenes[1]!.vectorScene!.tracks.some(t=>t.target==='bell'&&t.cue==='gõ chuông đồng'));
});

test('a released implement strike preserves its trajectory instead of solving the bare hand to its distant resting position',()=>{
  const script=screenplay() as Record<string,any>,last=script.shots[1];
  last.narration='Mũi dao cắm phập xuống đất sát bên cọc gỗ. Ông buông tay rồi lùi lại, nhìn lưỡi dao còn rung trong ánh trăng lạnh.';
  last.beats=[{cue:'cắm phập xuống đất',kind:'strike',targets:['old','knife'],motionTargets:['old/arm-l','knife'],before:'Dao lao xuống',after:'Dao cắm xuống đất và tay buông'}];
  const plan=drawing(false) as Record<string,any>;
  plan.vectorAssets={knife:{width:60,height:100,grip:{x:10,y:70},nodes:[{id:'blade',type:'rect',width:20,height:60,fill:'#aaa'},{id:'handle',type:'rect',x:5,y:60,width:10,height:30,fill:'#432'}]}};
  const scene=plan.scenes[1];scene.narration=last.narration;
  scene.vectorScene.nodes=[{id:'knife',type:'instance',asset:'knife',x:1100,y:800,width:60,height:100}];
  scene.vectorScene.tracks=[{target:'knife',start:.1,end:.4,frames:[{t:0,dy:-100},{t:1,dy:20}]},
    {target:'old/arm-l',start:.1,end:.4,cue:'cắm phập xuống đất',frames:[{t:0,rotation:-60},{t:1,rotation:25}]}];
  const p=parseVectorPlan(JSON.stringify(plan),'test',{width:720,height:1280},14,normalizeVectorStory(script,14));
  assert.deepEqual(p.scenes[1]!.vectorScene!.tracks.find(t=>t.target==='knife')!.frames.map(({t,dy})=>({t,dy})),scene.vectorScene.tracks[0].frames);
  assert.ok(!p.scenes[1]!.vectorScene!.tracks.some(t=>t.target==='old/forearm-l'&&t.cue==='cắm phập xuống đất'));
});

test('native rowing flows through intermediate keys and delayed strikes retain contact with torso anticipation and follow-through',()=>{
  const p=parseVectorPlan(JSON.stringify(drawing()),'test',{width:720,height:1280},14,story());
  const row=p.scenes[0]!,strike=p.scenes[1]!,assets=p.vectorAssets!;
  const shoulder=row.vectorScene!.tracks.find(t=>t.target==='old/arm-r')!;
  const timing=vectorTrackTiming(shoulder,row),span=timing.end-timing.start;
  const crossing=timing.start+span*.25;
  const speed=(at:number)=>evaluateVectorPart('old/arm-r',row,at+1).rotation-evaluateVectorPart('old/arm-r',row,at-1).rotation;
  assert.ok(Math.abs(speed(crossing))>.03,'a stroke must not brake to zero at every intermediate key');
  assert.ok(Math.abs(speed(crossing-2)-speed(crossing+2))<.005,'intermediate velocity stays continuous');
  assert.ok(row.vectorScene!.tracks.some(t=>t.target==='old/upper-body'&&t.frames.some(f=>Math.abs(f.rotation||0)>3)));
  assert.ok(row.vectorScene!.tracks.some(t=>t.target==='old/tunic-hem'&&t.frames.some(f=>Math.abs(f.rotation||0)>2)));
  assert.ok(row.vectorScene!.tracks.every(t=>t.frames.length<=32));
  strike.dialogue![0]!.atMs=1200;strike.dialogue![0]!.durationMs=3000;
  const arm=strike.vectorScene!.tracks.find(t=>t.target==='old/arm-l')!;
  const body=strike.vectorScene!.tracks.find(t=>t.target==='old/upper-body'&&t.cue===arm.cue)!;
  assert.deepEqual(vectorTrackTiming(body,strike),vectorTrackTiming(arm,strike),'cue must move the complete action, not only its hand');
  const action=vectorTrackTiming(arm,strike),contactTime=action.start+(action.end-action.start)*.38;
  const hand=vectorPoint(vectorWorldMatrix('old/hand-l',strike,contactTime,assets),0,0),bell=assets['folk-bell']!;
  const hit=vectorPoint(vectorWorldMatrix('bell',strike,contactTime,assets),bell.width/2,bell.height*.55);
  assert.ok(Math.hypot(hand.x-hit.x,hand.y-hit.y)<1e-7,'measured narration must not break physical contact');
  assert.ok(body.frames.some(f=>f.t<.38&&f.rotation!==0)&&body.frames.some(f=>f.t>.38&&f.rotation!==0));
});

test('common scene-group address mistakes are recovered in the small screenplay, not by regenerating voice or artwork',()=>{
  const d=screenplay();d.shots[0]!.location='folk-river-boat';d.shots[0]!.beats[0]!.motionTargets=['boat-world/root','deck/wet-footprints'];
  const normalized=normalizeVectorStory(d,14);
  assert.deepEqual(normalized.shots[0]!.beats[0]!.motionTargets,['boat-world','wet-footprints']);
  assert.deepEqual(d.shots[0]!.beats[0]!.motionTargets,['boat-world/root','deck/wet-footprints']);
});

test('deck retreat articulates planted legs without inventing a land floor or replacing shared boat geometry',()=>{
  const d=drawing(false),s=d.scenes[0]!;
  const raw={...d,scenes:[{...s,vectorScene:{...s.vectorScene,walks:[{actor:'lam',to:'old',backstep:35,start:0,end:.35,cue:'khua mái chèo'}]}}]};
  const p=parseVectorPlan(JSON.stringify(raw),'test',{width:720,height:1280});
  const scene=p.scenes[0]!;
  assert.equal(evaluateVectorPart('lam',scene,scene.durationMs).dx,-35);
  assert.ok(scene.vectorScene!.tracks.some(t=>t.target==='lam/knee-r'&&t.frames.length>2));
  assert.ok(!scene.vectorScene!.nodes.some(n=>n.id==='physical-ground-plane'));
  assert.ok(scene.vectorScene!.nodes.some(n=>n.id==='deck-surface'));
});

test('a screenplay clue drawn as a unique reusable part resolves its exact address without rewriting story or duplicating art',()=>{
  const s=story(),last=s.shots[1]!;last.beats=[{cue:'Người khách nín thở',kind:'reveal',targets:['mark'],motionTargets:['mark'],before:'Cọc trống',after:'Dấu tay hiện'}];
  const d=drawing(false) as Record<string,any>;
  d.vectorAssets={post:{width:40,height:100,nodes:[{id:'mark',type:'ellipse',x:20,y:30,rx:10,ry:15,fill:'#738878'}]}};
  d.scenes[1].vectorScene.nodes=[{id:'post',type:'instance',asset:'post',x:150,y:900,width:40,height:100}];
  d.scenes[1].vectorScene.tracks=[{target:'post/mark',start:.2,end:.3,cue:'Người khách nín thở',frames:[{t:0,opacity:0},{t:1,opacity:1}]}];
  const p=parseVectorPlan(JSON.stringify(d),'test',{width:720,height:1280},14,s);
  assert.deepEqual(p.scenes[1]!.vectorDirection!.beats[0]!.motionTargets,['post/mark']);
  assert.deepEqual(s.shots[1]!.beats[0]!.motionTargets,['mark']);assert.deepEqual(vectorDirectionIssues(p),[]);
  d.scenes[1].vectorScene.nodes.push({id:'second-post',type:'instance',asset:'post',x:450,y:900,width:40,height:100});
  assert.throws(()=>parseVectorPlan(JSON.stringify(d),'test',{width:720,height:1280},14,s),/missing=mark/,'ambiguous clues remain errors, not guessed aliases');
});

test('review samples retain both ends and the contact moment instead of trusting only the sheet midpoint',()=>{
  const p=parseVectorPlan(JSON.stringify(drawing()),'test',{width:720,height:1280},14,story());
  const s=p.scenes[1]!,times=[0,500,1000,1596,3000,4500,5500,6200,6966];
  const indices=vectorReviewFrameIndices(times,s);
  assert.ok(indices.includes(0)&&indices.includes(8)&&indices.includes(3));assert.ok(indices.length<=5);
});
