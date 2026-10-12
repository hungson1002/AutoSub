import test from 'node:test';
import assert from 'node:assert/strict';
import {illustratedPlace,type IllustratedPlace} from './canvasVectorIllustratedPlace';
import {parseVectorPlan} from './canvasVectorDirector';
import {vectorWorldMatrix,vectorPoint} from '../../shared/canvasVectorTransform';
import {groundVectorDrawing} from '../../shared/canvasVectorPhysical';
import {vectorPuppetRig} from '../../shared/canvasVectorPuppet';

const places:IllustratedPlace[]=['village','forest','waterside','street','corridor','rural-interior'];
const kinds:Record<IllustratedPlace,string[]>={
 village:['house-back-wall','house-mid-roof','village-tree-canopy','village-street'],
 forest:['big-tree-left-canopy','far-tree-a-trunk','forest-path','ferns-0'],
 waterside:['water-plane','dock','wave-0','house-mid-wall'],
 street:['block-0','window-1-0-0','shopfront-2','street-lamp-light'],
 corridor:['door-panel-0','door-knob-1','floor-tile-1','room-ceiling'],
 'rural-interior':['interior-room-back','interior-plank-joins','interior-door-leaf','interior-shelf-boards','interior-low-table','interior-oil-lamp'],
};
const cast={rig:'simple-puppet',outfit:'robe',hair:'long',palette:{skin:'#efd7b9',shirt:'#647565',hair:'#332e2d',accent:'#a38b73',inner:'#efdfc5',trim:'#c6b191'}};

test('native market establishes the whole square with small people at distinct depths, not a row of heads',()=>{
  const frame={width:1280,height:720};
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',design:'village'}},
    vectorStages:{market:{template:'illustrated-place',place:'village',setting:'market',finish:'handdrawn',light:'day',cast:{person:'hero'},
      extras:Array.from({length:8},(_,i)=>({id:'extra-'+i,asset:'hero'}))}},
    scenes:[{durationMs:3000,narration:'The villagers gather in the square.',vectorScene:{stage:'market'}},
      {durationMs:3000,narration:'One villager notices something.',vectorScene:{stage:'market',shot:{target:'person',height:.28,include:['market-sign']}}}]}),'community',frame);
  const s=p.scenes[0]!,d=s.vectorScene!,a=p.vectorAssets!.hero!;
  const actors=d.nodes.filter(n=>n.type==='instance'&&n.asset==='hero');
  assert.equal(actors.length,9);
  const feet:number[]=[];
  for(const actor of actors){
    const m=vectorWorldMatrix(actor.id,s,0,p.vectorAssets),top=vectorPoint(m,0,0),foot=vectorPoint(m,a.width,a.height);
    assert.ok((foot.y-top.y)/frame.height>=.05&&(foot.y-top.y)/frame.height<.18,'people remain small within the establishing frame');
    assert.ok(top.x>=0&&foot.x<=frame.width&&top.y>=0&&foot.y<=frame.height,'all nine people stay within the wide frame');
    feet.push(foot.y);
  }
  assert.ok(Math.max(...feet)-Math.min(...feet)>frame.height*.3,'crowd spans foreground, middle and background');
  assert.deepEqual(feet,[...feet].sort((a,b)=>a-b),'farther people paint behind nearer people');
  assert.ok(d.nodes.length<160,'native square leaves room for props and a camera');
  assert.ok(d.nodes.findIndex(n=>n.id==='market-square')<d.nodes.findIndex(n=>n.id==='house-mid'),'ground cannot paint over architecture');
  for(const id of ['market-stall','market-stall-right','market-thatch-stall','market-sign','house-mid']){
    const wide=d.nodes.find(n=>n.id===id)!,close=p.scenes[1]!.vectorScene!.nodes.find(n=>n.id===id)!;
    assert.deepEqual(close,wide,'close cut retains the same native world');
  }
  assert.equal(p.scenes[1]!.vectorScene!.nodes.find(n=>n.id==='person')!.height,d.nodes.find(n=>n.id==='person')!.height,'camera cut cannot enlarge the actor in the world');
  const signMatrix=vectorWorldMatrix('market-sign',p.scenes[1]!,0,p.vectorAssets);
  assert.ok(vectorPoint(signMatrix,0,0).y>0&&vectorPoint(signMatrix,269,252).y<frame.height,'contextual cut keeps the included market architecture readable');
  const legacy=illustratedPlace({place:'village',setting:'market',finish:'handdrawn',view:'eye-level'},frame);
  assert.equal(legacy.stage.ground.y,980,'explicit eye-level views remain available');
  assert.equal(legacy.stage.nodes.some(n=>n.id==='market-square'),false);
});

test('wide market auto placement does not replace explicit actor coordinates or allow unknown locations',()=>{
  const make=(place='village',view?:string)=>JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',design:'village'}},
    vectorStages:{market:{template:'illustrated-place',place,setting:'market',finish:'handdrawn',view,cast:{person:'hero'},
      extras:[{id:'extra',asset:'hero',x:150,footY:1070,height:120}]}},scenes:[{durationMs:3000,narration:'A villager waits.',vectorScene:{stage:'market'}}]});
  const p=parseVectorPlan(make(),'community',{width:1280,height:720});
  const e=p.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='extra')!;
  assert.equal(e.x,150);assert.equal(e.height,120);assert.equal(e.groundOffsetY,1070-1160);
  assert.throws(()=>parseVectorPlan(make('forest'),'community',{width:1280,height:720}),/market setting/);
});

test('handdrawn elevated cast fits native architecture instead of standing taller than the eaves',()=>{
  const handdrawn=illustratedPlace({place:'village',view:'elevated',finish:'handdrawn'});
  const person=handdrawn.stage.nodes.find(n=>n.id==='person')!,house=handdrawn.stage.nodes.find(n=>n.id==='house-mid')!;
  assert.ok(person.height!<house.height!*.7,'default person must fit the native house doorway');
  assert.equal(illustratedPlace({place:'village',view:'elevated'}).stage.nodes.find(n=>n.id==='person')!.height,190,'legacy clean scenery is unchanged');
  assert.equal(illustratedPlace({place:'village',finish:'handdrawn'}).stage.nodes.find(n=>n.id==='person')!.height,285,'eye-level casting is unchanged');
});

test('moon stays fully inside landscape frames and scenic planes leave room for eight actors plus a held lamp',()=>{
  const frame={width:1280,height:720};
  for(const place of ['village','forest','waterside'] as const){
    const raw=JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',design:'village'},light:{rig:'lantern'}},
      vectorStages:{setting:{template:'illustrated-place',place,light:'night',finish:'handdrawn',view:'eye-level',cast:{person:'hero'},
        extras:Array.from({length:8},(_,i)=>({id:'extra-'+i,asset:'hero',x:50+i*70,footY:850,height:110}))}},
      scenes:[{narration:'A quiet moonlit location.',durationMs:2000,vectorScene:{stage:'setting',nodes:[{id:'held',type:'instance',asset:'light',width:35,height:58}],carries:[{actor:'person',arm:'r',prop:'held',hang:true}]}}]});
    const p=parseVectorPlan(raw,'night',frame),s=p.scenes[0]!,moon=s.vectorScene!.nodes.find(n=>n.id==='moon')!;
    const m=vectorWorldMatrix('moon',s,0,p.vectorAssets),center=vectorPoint(m,0,0),top=vectorPoint(m,0,-moon.ry!),bottom=vectorPoint(m,0,moon.ry!);
    assert.ok(top.y>10&&bottom.y<frame.height*.3,'moon must not be clipped above the landscape frame');
    assert.ok(center.x>0&&center.x<frame.width);
    assert.ok(s.vectorScene!.nodes.length<=160,'native scenery must leave the existing node budget for story cast and props');
    assert.equal(s.vectorScene!.nodes.filter(n=>n.id.startsWith('extra-')).length,8);
    const base=illustratedPlace({place,light:'night',finish:'handdrawn'},frame);
    assert.equal(base.stage.nodes.find(n=>n.id==='ground-edge')!.strokeWidth,0,'no artificial black seam across the actor floor');
    const house=base.stage.nodes.findIndex(n=>n.id==='house-mid-wall');
    if(house>=0)assert.ok(base.stage.nodes.findIndex(n=>n.id==='house-mid-contact-shadow')<house,'contact shadow paints behind architecture');
  }
  const forest=illustratedPlace({place:'forest',finish:'handdrawn'},frame);
  for(const side of ['left','right'])assert.ok(forest.stage.nodes.some(n=>n.id==='landscape-tree-'+side));
});

for(const place of places)for(const frame of [{width:720,height:1280},{width:1280,height:720}]){
 test(`illustrated ${place} scene ${frame.width}x${frame.height} is stable, detailed, actor-compatible`,()=>{
  const one=illustratedPlace({place,light:'night',seed:9},frame);
  const two=illustratedPlace({place,light:'night',seed:9},frame);
  assert.deepEqual(one,two,'same location must survive camera cuts without flicker');
  assert.ok(one.stage.nodes.length>=48,'enough designed features for a complete scene');
  assert.ok(one.stage.nodes.length<=155,'leave room for camera and clues');
  assert.ok(one.stage.nodes.findIndex(n=>n.id==='physical-ground-plane')<one.stage.nodes.findIndex(n=>n.id==='person'), 'ground must be painted before cast');
  for(const id of kinds[place])assert.ok(one.stage.nodes.some(n=>n.id===id),id);
  const model=JSON.stringify({vectorAssets:{hero:cast},vectorStages:{location:{template:'illustrated-place',place,light:'night',seed:9,cast:{person:'hero'}}},
    scenes:[{durationMs:2500,narration:'Người khách nhìn quanh.',vectorScene:{stage:'location',shot:{target:'person',height:.45}}}]});
  const project=parseVectorPlan(model, 'Test bối cảnh hoạt hình',frame,2.5);
  const scene=project.scenes[0]!;
  assert.equal(scene.vectorScene!.width,frame.width);
  assert.equal(scene.vectorScene!.height,frame.height);
  assert.equal(scene.vectorScene!.nodes.find(n=>n.id==='person')!.asset,'hero');
  assert.ok(scene.vectorScene!.nodes.some(n=>n.id==='house-back-wall')===(place==='village'||place==='waterside'));
  assert.ok(!project.vectorAssets!.hero!.nodes.some(n=>n.id==='knee-l'),'cast shape survives environment');
  if(place==='waterside')assert.ok(scene.vectorScene!.tracks.some(t=>t.target==='wave-0'),'water lives within one scene');
  const center=vectorPoint(vectorWorldMatrix('person',scene,0,project.vectorAssets),90,250);
  assert.ok(Number.isFinite(center.x)&&Number.isFinite(center.y),'actor contact matrix');
 });
}
test('traditional night room has warm dark timber while daytime and older styles remain unchanged',()=>{
 const night=illustratedPlace({place:'rural-interior',light:'night',finish:'handdrawn'});
 const day=illustratedPlace({place:'rural-interior',light:'day',finish:'handdrawn'});
 const legacy=illustratedPlace({place:'rural-interior',light:'night'});
 const wall=(scene:ReturnType<typeof illustratedPlace>)=>scene.stage.nodes.find(n=>n.id==='interior-room-back')!.fill;
 assert.equal(wall(night),'#6b544a');
 assert.notEqual(wall(night),wall(day));
 assert.notEqual(wall(night),wall(legacy));
 assert.ok(night.stage.nodes.findIndex(n=>n.id==='interior-wall-shadow')<
   night.stage.nodes.findIndex(n=>n.id==='interior-low-table'),'room shadow must not paint over furniture');
 assert.ok(night.stage.nodes.some(n=>n.id==='interior-oil-light'),'warm light source retained');
});
test('rural interior door can be included in a reaction shot without hiding it or changing the actor',()=>{
 const cast={rig:'simple-puppet',finish:'handdrawn',hair:'bun',outfit:'robe'};
 const input=JSON.stringify({vectorAssets:{hero:cast},vectorStages:{room:{
  template:'illustrated-place',place:'rural-interior',finish:'handdrawn',cast:{person:'hero'}}},
  scenes:[{durationMs:2400,narration:'Tiếng động vang lên sau cánh cửa.',vectorScene:{stage:'room',
   shot:{target:'person',height:.42,include:['interior-door']},
   reactions:[{actor:'person',kind:'startle',toward:'interior-door',start:.12,end:.6}]}}]});
 const film=parseVectorPlan(input,'Nhà gỗ bên bờ núi',{width:1280,height:720},2.4);
 const scene=film.scenes[0]!.vectorScene!;
 const door=scene.nodes.find(n=>n.id==='interior-door')!;
 assert.ok(door.width!>160&&door.height!>450&&door.groundAnchor);
 assert.equal(scene.nodes.find(n=>n.id==='person')?.asset,'hero');
 assert.ok(scene.tracks.some(t=>t.target==='person/brow-l'),'face reaction is visible');
});
test('fallback floor is painted behind grass, paths and actor, never covering authored scenery',()=>{
  const assets={hero:vectorPuppetRig(cast)};
  const drawing={width:720,height:1280,nodes:[
    {id:'sky',type:'rect',x:0,y:0,width:720,height:1280,fill:'#657885'},
    {id:'soil-grass',type:'path',d:'M 70 1070 Q 91 1022 112 1070',stroke:'#72946d'},
    {id:'person',type:'instance',asset:'hero',x:220,width:180,height:285},
  ]} as Parameters<typeof groundVectorDrawing>[0];
  const grounded=groundVectorDrawing(drawing,assets,{y:980,targets:[{target:'person'}]});
  const index=(id:string)=>grounded.nodes.findIndex(n=>n.id===id);
  assert.ok(index('sky')<index('physical-ground-plane'));
  assert.ok(index('physical-ground-plane')<index('soil-grass'),'fallback soil must not occlude artwork');
  assert.ok(index('soil-grass')<index('person'));
});

test('landscape village fills the horizon with a real ground plane and flanking scenery without stretching actors',()=>{
  const frame={width:1280,height:720},one=illustratedPlace({place:'village',light:'dusk'},frame);
  const world=one.stage.nodes.find(n=>n.id==='illustrated-world')!,band=one.stage.nodes.find(n=>n.id==='mountains-back')!;
  const left=world.x!+band.x!*world.scaleX!,right=left+720*band.scaleX!*world.scaleX!;
  assert.ok(Math.abs(left)<1e-6&&Math.abs(right-frame.width)<1e-6);
  for(const id of ['middle-ground','landscape-house-left','landscape-house-right','landscape-tree-left','landscape-tree-right'])assert.ok(one.stage.nodes.some(n=>n.id===id));
  assert.equal(world.scaleX,world.scaleY);
  const actor=one.stage.nodes.find(n=>n.id==='person')!;
  assert.equal(actor.width,180);assert.equal(actor.height,285);
  assert.equal(actor.scaleX,undefined);
});
test('place grammar does not assume a particular village, monster or actor outfit',()=>{
 for(const place of places){
  const day=illustratedPlace({place,light:'day',seed:2});
  const night=illustratedPlace({place,light:'night',seed:2});
  assert.notEqual(day.stage.nodes.find(n=>n.id==='paint-sky')?.fill,night.stage.nodes.find(n=>n.id==='paint-sky')?.fill);
 }
 assert.throws(()=>parseVectorPlan(JSON.stringify({vectorStages:{x:{template:'illustrated-place',place:'forest'}},
  scenes:[{durationMs:1000,narration:'A',vectorScene:{stage:'x'}}]}),'forest',{width:720,height:1280}),/cast binding/);
});
