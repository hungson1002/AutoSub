import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasObject, createCanvasProject, type CanvasStudioScene } from '../../shared/canvasAnimationStudio';
import { compileCanvasFolkHorror } from '../../shared/canvasFolkHorror';
import { evaluateCanvasVisualQuality } from '../../shared/canvasVisualQuality';
import { compileCanvasProjectLayout } from '../../shared/canvasLayoutCompiler';
import { parsePlan, compileSimpleHorrorStaging } from '../../server/services/canvasAnimationDirector';
import { folkLimbGeometry, folkWorldPoint, resolveFolkGrip, folkContactIssues } from './folkHorrorContact';
import { evaluateCanvasObject, evaluateCanvasCamera } from './runtime';
import { folkActingState, hideFolkBackgroundSpirit } from './folkHorrorRenderer';
import { evaluateCanvasActionCoverage } from '../../shared/canvasActionCoverage';
import { canvasCoverageScenes } from '../../server/services/canvasNarrativeCoverage';
import { canvasCaptionAt } from './captions';

const ghost = createCanvasObject('character', { id: 'ghost', characterKey: 'ghost', appearance: 'long-limbed-spirit',
  visualStyle: 'folk-horror', x: 220, y: 540, width: 150, height: 240, motion: 'none' });
const victim = createCanvasObject('character', { id: 'victim', characterKey: 'victim', visualStyle: 'folk-horror',
  x: 520, y: 960, width: 90, height: 150, motion: 'none', facing: 'left' });
const scene: CanvasStudioScene = { id: 'contact', name: 'Quấn rồi kéo ngã', durationMs: 10000, background: 'night',
  backgroundRef: 'bg:folk-night-field', objects: [ghost, victim], animationBeats: [
    { id: 'grab', action: 'grab', targetIds: ['ghost'], focusTargetId: 'victim', atMs: 1000, durationMs: 2000 },
    { id: 'pull', action: 'pull', targetIds: ['ghost'], focusTargetId: 'victim', atMs: 3000, durationMs: 2000 },
    { id: 'release', action: 'release', targetIds: ['ghost'], focusTargetId: 'victim', atMs: 7000, durationMs: 1000 },
  ] };

test('limbs extend continuously, then stay at the moving and rotating neck throughout pull', () => {
  assert.equal(resolveFolkGrip(scene, ghost, 999), undefined);
  assert.equal(resolveFolkGrip(scene, ghost, 1000)?.progress, 0);
  const sourceFrame = evaluateCanvasObject(ghost, scene, 2000);
  const victimFrame = evaluateCanvasObject(victim, scene, 2000);
  const halfway = folkLimbGeometry(ghost, sourceFrame, victim, victimFrame, resolveFolkGrip(scene, ghost, 2000)!.progress, 1);
  assert.ok(halfway.end.x < halfway.contact.x && halfway.end.x > sourceFrame.x);
  for (const time of [3000, 3500, 4000, 5000, 6999]) {
    const grip = resolveFolkGrip(scene, ghost, time)!;
    assert.equal(grip.progress, 1);
    assert.equal(grip.wrapped, true);
    const current = evaluateCanvasObject(victim, scene, time);
    const limb = folkLimbGeometry(ghost, evaluateCanvasObject(ghost, scene, time), victim, current, grip.progress, 1);
    assert.deepEqual(limb.end, folkWorldPoint(victim, current, 3, -19));
  }
  assert.equal(evaluateCanvasObject(victim, scene, 3000).rotation, 0);
  assert.ok(evaluateCanvasObject(victim, scene, 4000).rotation < -30);
  assert.ok(evaluateCanvasObject(victim, scene, 5000).x < victim.x);
});

test('release retracts smoothly and the victim stays fallen after both actions finish', () => {
  assert.equal(resolveFolkGrip(scene, ghost, 7000)?.progress, 1);
  assert.equal(resolveFolkGrip(scene, ghost, 7500)?.progress, .5);
  assert.equal(resolveFolkGrip(scene, ghost, 8000)?.progress, 0);
  assert.deepEqual(evaluateCanvasObject(victim, scene, 5000), evaluateCanvasObject(victim, scene, 9500));
  assert.equal(evaluateCanvasObject(victim, scene, 9500).opacity, 1);
});

test('contact follows authored target tracks instead of its resting layout position', () => {
  const moving = { ...victim, keyframes: [{ atMs: 0, dx: 0, dy: 0 }, { atMs: 8000, dx: 70, dy: -40, rotation: 15 }] };
  const s = { ...scene, objects: [ghost, moving] };
  const frame = evaluateCanvasObject(moving, s, 6000);
  const limb = folkLimbGeometry(ghost, evaluateCanvasObject(ghost, s, 6000), moving, frame, 1, -1);
  assert.deepEqual(limb.end, folkWorldPoint(moving, frame, -3, -19));
  assert.notEqual(limb.end.x, moving.x);
});

test('production parsing retains the long-limb rig, perch and complete ordered action sequence', () => {
  const p = parsePlan(JSON.stringify({ scenes: [{ name: 'Quấn cổ', durationMs: 9000, background: 'night', template: 'two-shot', narration:'Con ma quấn rồi kéo người đi đường ngã.',
    objects: [ { kind: 'prop', label: 'Cây', variant: 'tree' },
      { kind: 'character', label: 'Ma', characterKey: 'ghost', appearance: 'long-limbed-spirit', perchedOn: 'Cây' },
      { kind: 'character', label: 'Người', characterKey: 'victim' } ],
    animationBeats: scene.animationBeats!.map(beat => ({...beat, targets:['ghost'], targetIds:undefined,focusTargetId:'victim'})) }] }), '[folk-horror] truyện ma', {width:720,height:1280});
  const s = p.scenes[0]!, spirit = s.objects.find(o=>o.characterKey==='ghost')!, tree = s.objects.find(o=>o.variant==='tree')!;
  assert.equal(spirit.appearance,'long-limbed-spirit');
  assert.equal(spirit.perchedOn,tree.id);
  assert.equal(spirit.visualStyle,'folk-horror');
  assert.equal(s.backgroundRef,'bg:folk-night-field');
  assert.deepEqual(s.animationBeats?.map(b=>b.action),['grab','pull','release']);
  assert.deepEqual(folkContactIssues(s),[]);
  const prepared = compileCanvasProjectLayout(p);
  assert.equal(prepared.scenes[0]!.objects.find(o=>o.id===spirit.id)!.perchedOn,tree.id);
  assert.deepEqual(compileCanvasFolkHorror(prepared),prepared,'reapplying staging must not alter existing cues or assets');
});

test('horror staging and parsing preserve a supplied character image and acting repertoire', () => {
  const clip = { frameWidth:128, frameHeight:256, columns:4, from:0, to:3, fps:12 };
  for (const prompt of ['truyện ma', '[folk-horror] truyện ma']) {
    const p = parsePlan(JSON.stringify({scenes:[{durationMs:5000,background:'room',template:'two-shot',narration:'Nhân vật đứng yên trong căn phòng.',
      objects:[{kind:'character',label:'Nhân vật',characterKey:'actor',imageUrl:'/custom.png',sprite:clip,
        spriteActs:[{...clip,action:'grab',imageUrl:'/grab.png'}]}]}]}),prompt);
    const actor = compileSimpleHorrorStaging(p).scenes[0]!.objects.find(o=>o.characterKey==='actor')!;
    assert.equal(actor.imageUrl,'/custom.png');
    assert.deepEqual(actor.sprite,clip);
    assert.equal(actor.spriteActs?.[0]?.imageUrl,'/grab.png');
    assert.ok(!evaluateCanvasVisualQuality(p).issues.some(issue=>issue.code==='mixed-character-style'));
  }
});

test('QC rejects dangling neck targets and pulling before contact is complete', () => {
  const bad = { ...scene, animationBeats: scene.animationBeats!.map(beat => beat.action === 'pull' ? {...beat,atMs:1500} : beat) };
  assert.ok(folkContactIssues(bad).some(message=>message.includes('quấn xong')));
  const missing = { ...scene, objects:[ghost] };
  const p = compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror] truyện ma',scenes:[missing]});
  const qc = evaluateCanvasVisualQuality(p);
  assert.equal(qc.pass,false);
  assert.ok(qc.issues.some(issue=>issue.code==='invalid-physical-attachment'&&issue.severity==='error'));
});

test('post-speech preparation completes contact before a closer pull cue without moving the cue', () => {
  const timed = {...scene,animationBeats:scene.animationBeats!.map(beat=>beat.action==='pull'?{...beat,atMs:2400}:beat)};
  const p = compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[timed]});
  assert.equal(p.scenes[0]!.animationBeats!.find(beat=>beat.action==='grab')!.durationMs,1400);
  assert.equal(p.scenes[0]!.animationBeats!.find(beat=>beat.action==='pull')!.atMs,2400);
  assert.deepEqual(folkContactIssues(p.scenes[0]!),[]);
});

test('an explicitly nocturnal field stays dark while daylight and river locations are retained', () => {
  const p = compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[
    {...scene,background:'field',backgroundRef:'bg:field-open',atmosphere:{timeOfDay:'night'}},
    {...scene,id:'day',background:'field',backgroundRef:'bg:field-open',atmosphere:{timeOfDay:'day'}},
    {...scene,id:'river',background:'night',backgroundRef:'bg:night-river'},
  ]});
  assert.equal(p.scenes[0]!.background,'night');
  assert.equal(p.scenes[0]!.backgroundRef,'bg:folk-night-field');
  assert.equal(p.scenes[1]!.backgroundRef,'bg:folk-day-field');
  assert.equal(p.scenes[2]!.backgroundRef,'bg:night-river');
});

test('a narrated neck grab and ground fall are covered without inventing water descent', () => {
  const s = {...scene,narration:'Hai dải quấn chặt lấy cổ người đi đường rồi kéo ngã nhào xuống vệ cỏ lạnh buốt.',
    animationBeats:scene.animationBeats!.map(beat=>({...beat,speechCue:beat.action==='grab'?'quấn chặt lấy cổ':'kéo ngã nhào xuống vệ cỏ lạnh buốt'}))};
  const p = {...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[s]};
  assert.deepEqual(evaluateCanvasActionCoverage(p),[]);
  assert.ok(evaluateCanvasActionCoverage({...p,scenes:[{...s,animationBeats:[]}]})
    .some(issue=>issue.message.includes('pull')),'a missing real fall must still fail coverage');
});

test('semantic reviewer receives evaluated contact and fallen body rather than only a standing rest pose', () => {
  const p = {...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[scene]};
  const payload = canvasCoverageScenes(p)[0]!;
  const pull = payload.resolvedContacts!.find(contact=>contact.action==='pull')!;
  assert.equal(pull.samples[0]!.victimTransform.rotation,0);
  assert.ok(pull.samples[2]!.victimTransform.rotation < -80);
  assert.deepEqual(pull.samples[2]!.limbEnd,pull.samples[2]!.neckAnchor);
});

test('supplied fall tracks remain authoritative and do not get a duplicate procedural fall', () => {
  const tracked = {...victim,keyframes:[{atMs:0,dx:0,dy:0,rotation:0},{atMs:5000,dx:-50,dy:60,rotation:-88}]};
  const s = {...scene,objects:[ghost,tracked]};
  const frame = evaluateCanvasObject(tracked,s,6000);
  assert.equal(frame.x,victim.x-50);
  assert.equal(frame.y,victim.y+60);
  assert.equal(frame.rotation,-88);
});

test('constant placement offsets and completed walking tracks do not suppress the later pull', () => {
  const tracked = {...victim,keyframes:[{atMs:0,dx:-40,dy:10},{atMs:1000,dx:20,dy:10},{atMs:9000,dx:20,dy:10}]};
  const s = {...scene,objects:[ghost,tracked]};
  const before = evaluateCanvasObject(tracked,s,3000), fallen = evaluateCanvasObject(tracked,s,6000);
  assert.ok(fallen.x < before.x,'placement and completed walking must retain the pull translation');
  assert.ok(fallen.y > before.y,'a constant dy offset is placement, not an authored fall');
  assert.equal(fallen.rotation,-88);
});

test('flat-field staging puts the traveler on grass and the pulled body lands on that ground', () => {
  const p = compileCanvasFolkHorror({...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror]',scenes:[scene]});
  const s = p.scenes[0]!, traveler = s.objects.find(object=>object.id==='victim')!;
  const scale = Math.min(traveler.width/56,traveler.height/100);
  assert.equal(traveler.y+scale*39,1280*.8);
  const fallen = evaluateCanvasObject(traveler,s,6000);
  assert.ok(Math.abs(fallen.y+scale*22-traveler.groundY!)<.001);
});

test('a lying victim in the following shot stays horizontal even with a zero rotation placement key', () => {
  const lying={...victim,pose:'lie-down' as const,keyframes:[{atMs:0,rotation:0,dy:20,pose:'lie-down' as const,easing:'hold' as const}]};
  const p=compileCanvasFolkHorror({...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror]',scenes:[
    {...scene,objects:[lying],animationBeats:[]},
  ]});
  const s=p.scenes[0]!,actor=s.objects[0]!;
  assert.ok(Math.abs(evaluateCanvasObject(actor,s,0).rotation)>=80);
  assert.equal(evaluateCanvasObject(actor,s,0).rotation,evaluateCanvasObject(actor,s,9000).rotation);
  assert.deepEqual(compileCanvasFolkHorror(p),p,'lying staging must remain idempotent');
});

test('folk horror can hold a stable set without a decorative template quota', () => {
  const p=compileCanvasProjectLayout({...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror] truyện ma',scenes:
    Array.from({length:6},(_,i)=>({...scene,id:`hold-${i}`,template:'two-shot' as const}))});
  assert.ok(!evaluateCanvasVisualQuality(p).issues.some(issue=>issue.code==='low-template-variety'));
  const regular={...p,sourcePrompt:'Hoạt hình kể chuyện lịch sử'};
  assert.ok(evaluateCanvasVisualQuality(regular).issues.some(issue=>issue.code==='low-template-variety'));
});

test('an authored reclining angle and supplied portrait are retained', () => {
  for(const object of [{...victim,pose:'lie-down' as const,rotation:88},
    {...victim,pose:'lie-down' as const,imageUrl:'/own-lying.png'}]){
    const p=compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[{...scene,objects:[object],animationBeats:[]}]});
    const actor=p.scenes[0]!.objects[0]!;
    assert.equal(actor.rotation,object.rotation);
    assert.equal(actor.imageUrl,object.imageUrl);
  }
});

test('an 18-second uninterrupted contact shot is retained in a one-minute folk story', () => {
  const p=parsePlan(JSON.stringify({scenes:[{durationMs:18000,background:'night',template:'two-shot',
    narration:'Con ma quấn cổ, kéo ngã rồi thu hai dải lại.',objects:[
      {kind:'character',label:'Ma',characterKey:'ghost',appearance:'long-limbed-spirit'},
      {kind:'character',label:'Người',characterKey:'victim'}],
    animationBeats:scene.animationBeats!.map(beat=>({...beat,targets:['ghost'],focusTargetId:'victim'}))}]}),'[folk-horror] truyện ma');
  assert.equal(p.scenes[0]!.durationMs,18000);
});

test('a mild reaction tilt cannot cover or suppress the full pulled fall', () => {
  const reacting={...victim,keyframes:[{atMs:0,dx:-20,dy:0,rotation:0},
    {atMs:4500,dx:-10,dy:30,rotation:-15},{atMs:8000,dx:-10,dy:35,rotation:-15}]};
  const p=compileCanvasFolkHorror({...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror]',
    scenes:[{...scene,objects:[ghost,reacting]}]});
  const s=p.scenes[0]!,actor=s.objects.find(object=>object.id==='victim')!;
  const end=evaluateCanvasObject(actor,s,6500),hold=evaluateCanvasObject(actor,s,9500);
  assert.ok(Math.abs(end.rotation)>=80,'15-degree fear sway is not a lying body');
  assert.equal(end.rotation,hold.rotation,'late reaction keys must not undo the fall');
  assert.ok(end.x<victim.x-10,'reaction travel must not cancel the physical pull');
  const scale=Math.min(actor.width/56,actor.height/100);
  assert.ok(Math.abs(hold.y+22*scale-actor.groundY!)<.001);
});

test('the pull finishes before an earlier measured release cue, without moving either cue', () => {
  const timed={...scene,animationBeats:scene.animationBeats!.map(beat=>beat.action==='release'?{...beat,atMs:4400}:beat)};
  const p=compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[timed]});
  const pull=p.scenes[0]!.animationBeats!.find(beat=>beat.action==='pull')!;
  assert.equal(pull.atMs,3000);
  assert.equal(pull.durationMs,1400);
  assert.equal(p.scenes[0]!.animationBeats!.find(beat=>beat.action==='release')!.atMs,4400);
});

test('folk captions use the measured sentence start instead of a clip-length estimate', () => {
  const first='Một hai ba bốn năm sáu bảy tám chín.';
  const second='Mười rồi đến những từ khác trong câu sau.';
  const s={...scene,dialogue:[{id:'voice',speaker:'Người kể',text:`${first} ${second}`,atMs:0,durationMs:9000,
    speechWindows:[{startMs:0,endMs:2000},{startMs:5000,endMs:7000}]}]};
  assert.equal(canvasCaptionAt(s,4500),first);
  assert.equal(canvasCaptionAt(s,5000),second);
  assert.equal(canvasCaptionAt(s,9000),'');
});

test('folk caption chunks exclude trailing silence and retain the last words through a pause', () => {
  const first='Một hai ba bốn năm sáu bảy tám chín';
  const second='mười rồi đến những từ khác trong câu sau';
  const s={...scene,dialogue:[{id:'voice',speaker:'Người kể',text:`${first} ${second}`,atMs:0,durationMs:9000,
    speechWindows:[{startMs:0,endMs:2000},{startMs:4000,endMs:6000}]}]};
  assert.equal(canvasCaptionAt(s,3500),first);
  assert.equal(canvasCaptionAt(s,4250),second);
});

test('the following lying shot retains the direction of the preceding pulled fall', () => {
  const p=compileCanvasFolkHorror({...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror]',scenes:[scene,
    {...scene,id:'after',objects:[{...victim,pose:'lie-down',rotation:0,keyframes:[{atMs:0,rotation:0}]}],animationBeats:[]}]});
  assert.equal(p.scenes[1]!.objects[0]!.rotation,-88);
  assert.deepEqual(compileCanvasFolkHorror(p),p);
});

test('fall continuity uses the staged tree perch and can refresh its own inferred angle', () => {
  const tree=createCanvasObject('prop',{id:'tree',variant:'tree',x:100,y:740,width:240,height:340});
  const perched={...ghost,x:700,perchedOn:'tree'};
  const input={...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror]',scenes:[
    {...scene,objects:[tree,perched,victim]},
    {...scene,id:'after',objects:[{...victim,pose:'lie-down' as const,rotation:0}],animationBeats:[]}]};
  const p=compileCanvasFolkHorror(input);
  assert.equal(p.scenes[1]!.objects[0]!.rotation,-88);
  const moved={...p,scenes:p.scenes.map((s,i)=>i? s:{...s,objects:s.objects.map(o=>o.id==='tree'?{...o,x:700}:o)})};
  const refreshed=compileCanvasFolkHorror(moved);
  assert.equal(refreshed.scenes[1]!.objects[0]!.rotation,88);
});

test('a manual rotation edit takes precedence over a previously inferred reclining angle', () => {
  const actor={...victim,pose:'lie-down' as const,rotation:42,folkReclineAngle:88};
  const p=compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[{...scene,objects:[actor],animationBeats:[]}]});
  assert.equal(p.scenes[0]!.objects[0]!.rotation,42);
});

test('a folk face insert frames the head and leaves room for top captions', () => {
  const actor={...ghost,x:360,y:640,width:330,height:870,role:'focal' as const,
    keyframes:[{atMs:0,dy:-30,scale:1.2}]};
  const s={...scene,template:'close-reaction' as const,objects:[actor],animationBeats:[],
    camera:{shot:'extreme-close-up' as const,motion:'none' as const,focusX:360,focusY:640,zoom:1.35}};
  const camera=evaluateCanvasCamera(s,0,720,1280),frame=evaluateCanvasObject(actor,s,0);
  const projectPoint=(x:number,y:number)=>({x:camera.offsetX+camera.focusX+(x-camera.focusX)*camera.scale,
    y:camera.offsetY+camera.focusY+(y-camera.focusY)*camera.scale});
  const head=projectPoint(frame.x,frame.y-35*Math.min(actor.width/56,actor.height/100)*frame.scale);
  const headWidth=36*Math.min(actor.width/56,actor.height/100)*frame.scale*camera.scale;
  assert.ok(headWidth>=720*.65,'the skull and hair must occupy a portrait, not a full-body shot');
  assert.ok(head.y>1280*.25&&head.y<1280*.8);
});

test('the complete folk contact and fall stay in frame with a stable camera', () => {
  const tree=createCanvasObject('prop',{id:'tree',variant:'tree',x:216,y:755,width:245,height:343});
  const p=compileCanvasFolkHorror({...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror]',scenes:[
    {...scene,template:'two-shot',objects:[tree,{...ghost,perchedOn:'tree'},victim],camera:{shot:'wide',motion:'none',focusX:360,focusY:640,zoom:1}}]});
  const s=p.scenes[0]!,camera=evaluateCanvasCamera(s,0,720,1280);
  assert.deepEqual(evaluateCanvasCamera(s,5000,720,1280),camera);
  for(const time of [0,3000,3500,4100,9500]) for(const actor of s.objects.filter(o=>o.kind==='character')){
    const f=evaluateCanvasObject(actor,s,time),scale=Math.min(actor.width/56,actor.height/100)*f.scale;
    for(const point of [folkWorldPoint(actor,f,0,-50),folkWorldPoint(actor,f,0,actor.appearance==='long-limbed-spirit'?85:39)]){
      const x=camera.offsetX+camera.focusX+(point.x-camera.focusX)*camera.scale;
      const y=camera.offsetY+camera.focusY+(point.y-camera.focusY)*camera.scale;
      assert.ok(x>=0&&x<=720&&y>=1280*.15&&y<=1280,`${time}: visible contact at ${x},${y}, scale ${scale}`);
    }
  }
});

test('a spoken pull finishes as a short jerk and holds while the phrase continues', () => {
  const frame=evaluateCanvasObject(victim,scene,4100);
  assert.equal(frame.rotation,-88);
  assert.deepEqual(frame,evaluateCanvasObject(victim,scene,6000));
});

test('folk walking follows real travel and stops on a held track or neck grip', () => {
  const traveler={...victim,keyframes:[{atMs:0,dx:60},{atMs:2000,dx:0},{atMs:9000,dx:0}]};
  const s={...scene,objects:[ghost,traveler]};
  assert.equal(folkActingState(traveler,s,500).walking,true);
  assert.equal(folkActingState(traveler,s,2900).walking,false);
  assert.equal(folkActingState(traveler,s,3000).gripped,true);
  assert.equal(folkActingState(traveler,s,6000).fallen,true);
});

test('a fallen victim insert stays close even when a supporting ghost remains on the set', () => {
  const lying={...victim,role:'focal' as const,pose:'lie-down' as const,rotation:-88};
  const s={...scene,template:'close-reaction' as const,objects:[{...ghost,role:'support' as const},lying],animationBeats:[],
    camera:{shot:'wide' as const,motion:'none' as const,focusX:360,focusY:640,zoom:1}};
  const camera=evaluateCanvasCamera(s,0,720,1280);
  assert.deepEqual(camera,evaluateCanvasCamera({...s,objects:[lying]},0,720,1280));
  assert.ok(camera.scale>2,'a distant supporting spirit must not reduce the ground insert to a whole-set shot');
});

test('a unique authored neck action recovers its missing exact spoken cue without regenerating the plan', () => {
  const s={...scene,narration:'Ma vươn hai dải trắng quấn chặt lấy cổ người đi đường, rồi kéo giật mạnh hất ông ngã, sau đó thu hai dải lại.'};
  const p=compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[s]});
  const beats=p.scenes[0]!.animationBeats!;
  assert.equal(beats[0]!.speechCue,'vươn hai dải trắng quấn chặt lấy cổ');
  assert.equal(beats[1]!.speechCue,'kéo giật mạnh hất ông ngã');
  assert.equal(beats[2]!.speechCue,'thu hai dải lại');
  assert.deepEqual(beats.map(b=>b.atMs),s.animationBeats!.map(b=>b.atMs));
  assert.deepEqual(evaluateCanvasActionCoverage(p),[]);
  assert.deepEqual(compileCanvasFolkHorror(p),p);
});

test('cue recovery preserves authored cues and refuses ambiguous or negated phrases', () => {
  for(const narration of ['Nó quấn cổ người này, rồi quấn cổ người kia.','Nó không quấn cổ người đi đường.']){
    const p=compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[{...scene,narration}]});
    assert.equal(p.scenes[0]!.animationBeats![0]!.speechCue,undefined);
  }
  const s={...scene,narration:'Ma quấn chặt cổ người đi đường.',animationBeats:scene.animationBeats!.map(b=>({...b,speechCue:'giữ cue người dùng'}))};
  const p=compileCanvasFolkHorror({...createCanvasProject(),sourcePrompt:'[folk-horror]',scenes:[s]});
  assert.ok(p.scenes[0]!.animationBeats!.every(b=>b.speechCue==='giữ cue người dùng'));
});

test('folk framing still responds to edited zoom and an authored camera rotation', () => {
  const s={...scene,objects:[{...ghost,width:330,height:870,role:'focal' as const}],animationBeats:[],
    camera:{shot:'extreme-close-up' as const,motion:'none' as const,focusX:360,focusY:640,zoom:1}};
  const initial=evaluateCanvasCamera(s,0,720,1280);
  const edited=evaluateCanvasCamera({...s,camera:{...s.camera,zoom:1.2}},0,720,1280);
  assert.ok(edited.scale>initial.scale);
  assert.equal(evaluateCanvasCamera({...s,camera:{...s.camera,keyframes:[{atMs:0,rotation:3}]}},0,720,1280).rotation,3);
});

test('horror QC counts changes rather than static frame-zero placement and pose', () => {
  const tree=createCanvasObject('prop',{id:'static-tree',variant:'tree',x:360,y:700,width:620,height:980,motion:'none',
    keyframes:[{atMs:0,dx:30,opacity:.8},{atMs:9000,dx:30,opacity:.8}]});
  const s={...scene,durationMs:9000,objects:[tree,{...ghost,pose:'sit' as const,
    keyframes:[{atMs:0,pose:'sit' as const,expression:'neutral' as const,opacity:1}]}],animationBeats:[]};
  const p=compileCanvasFolkHorror({...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror]',scenes:[s]});
  assert.ok(!evaluateCanvasVisualQuality(p).issues.some(i=>i.code==='motion-overload'));
  for(const change of [{dx:70},{opacity:.2}]){
    const moved={...p,scenes:p.scenes.map(s=>({...s,objects:s.objects.map(o=>o.id===tree.id
      ?{...o,keyframes:[o.keyframes![0]!,{atMs:9000,...change}]}:o)}))};
    assert.ok(evaluateCanvasVisualQuality(moved).issues.some(i=>i.code==='motion-overload'&&i.severity==='error'),
      'a real full-set movement or fade must still be rejected');
  }
});

test('an actual folk pull is a physical action rather than an overloaded quiet hold', () => {
  const largeGhost={...ghost,width:400,height:800},largeVictim={...victim,width:250,height:500};
  const p={...createCanvasProject(),width:720,height:1280,sourcePrompt:'[folk-horror]',scenes:[
    {...scene,objects:[largeGhost,largeVictim]}]};
  assert.ok(!evaluateCanvasVisualQuality(p).issues.some(i=>i.code==='motion-overload'));
});

test('a ground insert removes only the procedural supporting ghost, including its detached limbs', () => {
  const backgroundGhost={...ghost,role:'support' as const};
  const s={...scene,objects:[backgroundGhost,{...victim,role:'focal' as const,pose:'lie-down' as const,rotation:-88}],animationBeats:[]};
  assert.equal(hideFolkBackgroundSpirit(s,backgroundGhost),true);
  assert.equal(hideFolkBackgroundSpirit(s,victim),false);
  assert.equal(hideFolkBackgroundSpirit(s,{...backgroundGhost,imageUrl:'/user-art.png'}),false);
  assert.equal(hideFolkBackgroundSpirit(s,{...backgroundGhost,role:'focal'}),false);
  assert.equal(hideFolkBackgroundSpirit({...s,animationBeats:scene.animationBeats},backgroundGhost),false);
});
