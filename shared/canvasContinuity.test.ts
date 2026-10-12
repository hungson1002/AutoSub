import test from 'node:test';
import assert from 'node:assert/strict';
import {stabilizeCanvasSceneContinuity,canvasScenesShareStage} from './canvasContinuity';
import type {CanvasStudioProject,CanvasStudioScene} from './canvasAnimationStudio';

const actor=(id:string,key:string,x:number,slot:any='hero-left'):any=>({
  id,kind:'character',label:key,characterKey:key,x,y:430,width:180,height:320,scale:1,rotation:0,opacity:1,
  color:'#555',accent:'#222',zIndex:30,motion:'none',slot,depth:'midground',sizeClass:'large',role:'focal',pose:'idle'
});
const prop=(id:string,variant:string,x:number,role:any='support'):any=>({
  id,kind:'prop',label:variant,variant,x,y:440,width:120,height:100,scale:1,rotation:0,opacity:1,
  color:'#654',accent:'#222',zIndex:20,motion:'none',slot:'mid-center',depth:'midground',sizeClass:'medium',role
});
const scene=(id:string,objects:any[],extra:Partial<CanvasStudioScene>={}):CanvasStudioScene=>({
  id,name:id,durationMs:4000,background:'room',backgroundRef:'bg:room-study',template:'two-shot',
  narration:'',dialogue:[],objects,camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1},...extra
});
const project=(scenes:CanvasStudioScene[]):CanvasStudioProject=>({
  version:1,id:'p',name:'continuity',width:1280,height:720,fps:30,scenes
});

test('adding a support prop does not restage an existing actor or camera',()=>{
  const a=scene('a',[actor('a1','minh',330)]);
  const b=scene('b',[actor('a2','minh',640),prop('lamp','lantern',820)],{
    template:'hero-right',camera:{shot:'wide',motion:'none',focusX:780,focusY:330,zoom:1.12}
  });
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  const next=out.scenes[1]!,minh=next.objects.find(o=>o.characterKey==='minh')!;
  assert.equal(minh.x,330);
  assert.equal(minh.slot,'hero-left');
  assert.equal(next.template,'two-shot');
  assert.equal(next.camera?.shot,'medium');
  assert.equal(next.camera?.focusX,640);
  assert.equal(next.camera?.zoom,1);
  assert.deepEqual(next.continuityCameraCharacterKeys,['minh']);
  const lantern=next.objects.find(o=>o.variant==='lantern')!;
  assert.ok(lantern,'new prop remains in the shot');
  assert.equal(lantern.keyframes?.[0]?.opacity,0,'new support prop eases in without transitioning the whole stage');
  assert.equal(lantern.keyframes?.at(-1)?.opacity,1);
  assert.equal(canvasScenesShareStage(a,b),true);
});

test('arbitrary support asset churn does not cut or restage a recurring subject',()=>{
  const a=scene('a',[
    actor('a1','minh',300),
    prop('p1','lantern',700),prop('p2','chair',820),prop('p3','table',920),
  ]);
  const b=scene('b',[
    actor('b1','minh',610),
    prop('n1','box',720),prop('n2','rope',790),prop('n3','note',860),prop('n4','bowl',930),
  ],{template:'hero-right',camera:{shot:'wide',motion:'none',focusX:810,focusY:330,zoom:1.14}});
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  const next=out.scenes[1]!,minh=next.objects.find(o=>o.characterKey==='minh')!;
  assert.equal(minh.x,300,'recurring actor keeps the old stage anchor despite many asset changes');
  assert.equal(next.template,'two-shot','support churn cannot manufacture a new scene layout');
  assert.equal(next.camera?.shot,'medium');
  assert.equal(next.camera?.focusX,640);
  assert.equal(next.camera?.zoom,1);
  for(const object of next.objects.filter(o=>o.kind==='prop'))assert.equal(object.keyframes?.[0]?.opacity,0);
});

test('adding a second actor preserves the established actor anchor',()=>{
  const a=scene('a',[actor('a1','minh',300)]);
  const added=actor('b2','panh',900,'hero-right');added.role='support';
  const b=scene('b',[actor('a2','minh',520),added]);
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  const minh=out.scenes[1]!.objects.find(o=>o.characterKey==='minh')!;
  const panh=out.scenes[1]!.objects.find(o=>o.characterKey==='panh')!;
  assert.equal(minh.x,300);
  assert.equal(panh.x,900);
  assert.equal(panh.keyframes?.[0]?.opacity,0,'new supporting actor enters locally instead of causing a stage cut');
});

test('adding a focal actor in a medium shot does not recenter the established stage',()=>{
  const a=scene('a',[actor('a1','minh',310)],{camera:{shot:'medium',motion:'none',focusX:620,focusY:360,zoom:1}});
  const newcomer=actor('b2','panh',900,'hero-right');newcomer.role='focal';
  const b=scene('b',[actor('a2','minh',560),newcomer],{
    template:'hero-right',camera:{shot:'medium',motion:'none',focusX:820,focusY:350,zoom:1.08}
  });
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  const next=out.scenes[1]!,minh=next.objects.find(o=>o.characterKey==='minh')!,panh=next.objects.find(o=>o.characterKey==='panh')!;
  assert.equal(minh.x,310);
  assert.equal(next.template,'two-shot');
  assert.equal(next.camera?.focusX,620);
  assert.equal(next.camera?.zoom,1);
  assert.equal(panh.keyframes?.[0]?.opacity,0,'new focal actor enters locally in a continuing medium stage');
});

test('a real close insert may reframe but cannot flip a recurring actor across the screen axis',()=>{
  const base=actor('a1','minh',300,'hero-left');base.facing='right';
  const a=scene('a',[base]);
  const close=actor('b1','minh',920,'hero-right');close.facing='left';
  const b=scene('b',[close],{
    template:'close-reaction',camera:{shot:'close-up',motion:'none',focusX:920,focusY:350,zoom:1.22}
  });
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  const minh=out.scenes[1]!.objects[0]!;
  assert.ok(minh.x<640,'recurring actor remains on the established screen side');
  assert.equal(minh.slot,'hero-left');
  assert.equal(minh.facing,a.objects[0]!.facing,'facing remains stable without authored travel');
  assert.equal(out.scenes[1]!.camera?.shot,'close-up','the intentional close-up itself is still allowed');
});

test('same-stage additive scenes continue the previous camera track without a boundary jump',()=>{
  const a=scene('a',[actor('a1','minh',330)],{
    camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1,keyframes:[{atMs:0,zoom:1,dx:0},{atMs:4000,zoom:1.04,dx:12}]}
  });
  const b=scene('b',[actor('a2','minh',620),prop('lamp','lantern',820)],{
    camera:{shot:'wide',motion:'none',focusX:760,focusY:330,zoom:1.08,keyframes:[{atMs:0,zoom:1.08,dx:-20},{atMs:4000,zoom:1.12,dx:10}]}
  });
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  const next=out.scenes[1]!;
  assert.equal(next.camera?.shot,'medium');
  assert.equal(next.camera?.focusX,640);
  assert.equal(next.camera?.keyframes?.[0]?.atMs,0);
  assert.ok(Math.abs((next.camera?.keyframes?.[0]?.zoom||0)-1.04)<1e-6);
  assert.ok(Math.abs((next.camera?.keyframes?.[0]?.dx||0)-12)<1e-6);
  assert.ok(Math.abs((next.camera?.keyframes?.at(-1)?.zoom||0)-1.08)<1e-6,'new creep keeps its relative 0.04 zoom change');
  assert.ok(Math.abs((next.camera?.keyframes?.at(-1)?.dx||0)-42)<1e-6,'new pan keeps its relative 30px travel');
});

test('an explicit close reaction is a real cut even with the same recurring actor',()=>{
  const a=scene('a',[actor('a1','minh',330)]);
  const b=scene('b',[actor('b1','minh',620)],{
    template:'close-reaction',camera:{shot:'close-up',motion:'none',focusX:620,focusY:350,zoom:1.22}
  });
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  assert.equal(out.scenes[1]!.template,'close-reaction');
  assert.equal(out.scenes[1]!.camera?.shot,'close-up');
  assert.equal(out.scenes[1]!.objects.find(o=>o.characterKey==='minh')!.x,620);
  assert.equal(canvasScenesShareStage(a,b),false);
});

test('a genuine new focal insert is allowed to reframe',()=>{
  const a=scene('a',[actor('a1','minh',330)]);
  const b=scene('b',[actor('a2','minh',620),prop('clue','bowl',760,'focal')],{
    template:'prop-focus',camera:{shot:'close-up',motion:'none',focusX:760,focusY:410,zoom:1.24}
  });
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  assert.equal(out.scenes[1]!.template,'prop-focus');
  assert.equal(out.scenes[1]!.camera?.shot,'close-up');
  assert.equal(out.scenes[1]!.objects.find(o=>o.characterKey==='minh')!.x,620);
});

test('authored travel is not frozen by continuity',()=>{
  const a=scene('a',[actor('a1','minh',300)]);
  const moving=actor('a1','minh',520);
  moving.keyframes=[{atMs:0,dx:0},{atMs:3000,dx:140}];
  const b=scene('b',[moving]);
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  assert.equal(out.scenes[1]!.objects[0]!.x,520);
});

test('stageId preserves a physical set across authored background variants and keeps ambience phase continuous',()=>{
  const a=scene('a',[actor('a1','minh',320),prop('table-a','table',650)],{
    stageId:'main-house-room',
    backgroundRef:'bg:room-stilt-house',
    atmosphere:{timeOfDay:'night',filmGrain:.2},
  });
  const b=scene('b',[actor('b1','minh',760),prop('table-b','table',900)],{
    stageId:'main-house-room',
    backgroundRef:'bg:room-stilt-day',
    atmosphere:{timeOfDay:'day',filmGrain:.15},
  });
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  const next=out.scenes[1]!,minh=next.objects.find(o=>o.characterKey==='minh')!,table=next.objects.find(o=>o.variant==='table')!;
  assert.equal(minh.x,320,'same stageId keeps the recurring actor anchor despite a background variant change');
  assert.equal(table.x,650,'same physical furnishing keeps its stage anchor');
  assert.equal(next.atmosphere?.timeOffsetMs,a.durationMs,'ambient phase continues instead of restarting at the cut');
  assert.equal(canvasScenesShareStage(a,b),true);
});

test('same stageId still permits a real close insert to hard cut',()=>{
  const a=scene('a',[actor('a1','minh',320)],{stageId:'main-house-room'});
  const b=scene('b',[actor('b1','minh',760),prop('clue','note',640,'focal')],{
    stageId:'main-house-room',
    template:'prop-focus',
    camera:{shot:'close-up',motion:'none',focusX:640,focusY:390,zoom:1.2},
  });
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  assert.equal(out.scenes[1]!.camera?.shot,'close-up');
  assert.equal(canvasScenesShareStage(a,b),false,'editorial clue insert is a deliberate cut even inside the same physical set');
});

test('stage registry restores persistent furnishings after intervening cuts but never remembers clues or threats',()=>{
  const roomA=scene('room-a',[
    actor('a1','minh',320),
    prop('table-a','table',650),
    prop('lamp-a','lantern',720),
    prop('door-a','door',1040),
    prop('phone-a','phone',830),
    prop('ghost-a','ghost',980),
  ],{stageId:'room-7',backgroundRef:'bg:room-simple-night'});
  const hall=scene('hall',[actor('h1','minh',360)],{stageId:'hall',background:'city',backgroundRef:'bg:city-hallway'});
  const roomB=scene('room-b',[actor('b1','minh',390)],{
    stageId:'room-7',
    backgroundRef:'bg:room-simple-night',
    template:'close-reaction',
    camera:{shot:'close-up',motion:'none',focusX:390,focusY:360,zoom:1.12},
  });
  const out=stabilizeCanvasSceneContinuity(project([roomA,hall,roomB]));
  const variants=out.scenes[2]!.objects.filter(o=>o.kind==='prop').map(o=>o.variant);
  assert.ok(variants.includes('table'));
  assert.ok(variants.includes('lantern'));
  assert.ok(variants.includes('door'));
  assert.equal(variants.includes('phone'),false,'story clue/hand prop is not permanent furniture');
  assert.equal(variants.includes('ghost'),false,'a threat is never remembered as set dressing');
});

test('clean clue inserts do not inherit or redefine persistent stage furniture',()=>{
  const roomA=scene('room-a',[
    actor('a1','minh',320),
    prop('table-a','table',650),
    prop('lamp-a','lantern',720),
    prop('door-a','door',1030),
  ],{stageId:'room-7',backgroundRef:'bg:room-simple-night'});
  const insertDoor=prop('door-insert','door',350);
  insertDoor.slot='support-left';
  const insert=scene('insert',[prop('note','note',640,'focal'),insertDoor],{
    stageId:'room-7',
    backgroundRef:'bg:room-simple-night',
    template:'prop-focus',
    camera:{shot:'close-up',motion:'none',focusX:640,focusY:390,zoom:1.2},
  });
  const roomB=scene('room-b',[actor('b1','minh',390)],{
    stageId:'room-7',
    backgroundRef:'bg:room-simple-night',
    template:'close-reaction',
    camera:{shot:'close-up',motion:'none',focusX:390,focusY:360,zoom:1.12},
  });
  const out=stabilizeCanvasSceneContinuity(project([roomA,insert,roomB]));
  const insertVariants=out.scenes[1]!.objects.filter(o=>o.kind==='prop').map(o=>o.variant);
  assert.deepEqual(insertVariants,['note','door'],'the insert keeps only what it explicitly authored');
  const restoredDoor=out.scenes[2]!.objects.find(o=>o.variant==='door')!;
  assert.equal(restoredDoor.x,1030,'insert composition cannot overwrite the remembered set door');
  assert.ok(out.scenes[2]!.objects.some(o=>o.variant==='table'));
  assert.ok(out.scenes[2]!.objects.some(o=>o.variant==='lantern'));
});

test('different locations never share stage anchors',()=>{
  const a=scene('a',[actor('a1','minh',300)]);
  const b=scene('b',[actor('a2','minh',780)],{backgroundRef:'bg:city-street',background:'street' as any});
  const out=stabilizeCanvasSceneContinuity(project([a,b]));
  assert.equal(out.scenes[1]!.objects[0]!.x,780);
  assert.equal(canvasScenesShareStage(a,b),false);
});
