import test from 'node:test';
import assert from 'node:assert/strict';
import {vectorHumanRig} from '../../shared/canvasVectorHuman';
import {expandVectorStageLibrary} from './canvasVectorStageLibrary';
import {parseVectorPlan} from './canvasVectorDirector';
import {vectorWorldMatrix,vectorPoint} from '../../shared/canvasVectorTransform';

const cast={rig:'simple-human',style:'folk-chibi',outfit:'ao-dai',hair:'side-part',palette:{
  skin:'#e7cfb1',shirt:'#6a6258',pants:'#504b43',hair:'#282929',accent:'#a77d60',trim:'#dfc3a5',
}};

test('illustrated folk chibi retains mechanically sound native limb chains',()=>{
  const rig=vectorHumanRig(cast);
  for(const id of ['head-group','folk-collar','folk-sash','hair-front','cheek-l','arm-l','forearm-l','hand-l','arm-r','forearm-r','hand-r','leg-l','knee-l','foot-l','leg-r','knee-r','foot-r'])
    assert.ok(rig.nodes.some(n=>n.id===id),id);
  assert.equal(rig.nodes.find(n=>n.id==='forearm-r')?.parent,'arm-r');
  assert.deepEqual(rig.nodes.find(n=>n.id==='forearm-r')?.joint,{min:-145,max:145});
  assert.deepEqual(rig.nodes.find(n=>n.id==='knee-l')?.joint,{min:0,max:145});
  const bare=vectorHumanRig({});
  assert.equal(bare.nodes.some(n=>n.id==='folk-sash'),false,'legacy rigs must not change');
  assert.ok(rig.nodes.length<=160,'valid bounded SVG asset');
});

test('illustrated folk chibi v2 improves silhouettes without changing native contacts or old styles',()=>{
  const modern=vectorHumanRig({...cast,style:'folk-chibi-v2'});
  const old=vectorHumanRig(cast);
  for(const id of ['folk-art-v2','folk-ground-shadow','folk-sleeve-fold-l','folk-wrist-band-r','folk-robe-shade','folk-nose','folk-hair-strands']){
    assert.ok(modern.nodes.some(n=>n.id===id),id);
    assert.equal(old.nodes.some(n=>n.id===id),false,'v1 must remain unchanged: '+id);
  }
  for(const id of ['arm-l','arm-r','forearm-l','forearm-r','hand-l','hand-r','leg-l','leg-r','knee-l','knee-r','foot-l','foot-r']){
    const a=old.nodes.find(n=>n.id===id)!;
    const b=modern.nodes.find(n=>n.id===id)!;
    assert.equal(b.parent,a.parent,id+' parent');
    assert.equal(b.x,a.x,id+' x');
    assert.equal(b.y,a.y,id+' y');
    assert.deepEqual(b.joint,a.joint,id+' joint');
  }
  assert.ok(modern.nodes.length<160,'renderer asset cap');
  assert.ok(modern.nodes.find(n=>n.id==='sleeve-l')!.d!.includes('Q'),'curved sleeve');
  assert.ok(modern.nodes.find(n=>n.id==='torso')!.d!.includes('Q'),'curved torso');
});
for(const frame of [{width:720,height:1280},{width:1280,height:720}]){
  test(`native folk riverbank stays grounded and reusable at ${frame.width}x${frame.height}`,()=>{
    const expanded=expandVectorStageLibrary({vectorStages:{shore:{template:'folk-riverbank',cast:{person:'hero'}}},vectorAssets:{hero:cast}},frame);
    const shore=(expanded.vectorStages as Record<string,{nodes:Array<{id:string;parent?:string;asset?:string}>;ground:{parent?:string}}>)['shore']!;
    assert.equal(shore.nodes.find(n=>n.id==='person')?.asset,'hero');
    assert.ok(shore.nodes.some(n=>n.id==='river-water'),'water layer');
    assert.ok(shore.nodes.some(n=>n.id==='foreground-earth'),'near ground');
    assert.ok(shore.nodes.some(n=>n.id==='mountain-back'),'far hills');
    assert.ok(shore.nodes.some(n=>n.id==='mooring-stake'),'usable actor-contact object');
    assert.equal(shore.ground.parent,frame.width>frame.height?'riverbank-world':undefined);
    assert.ok(shore.nodes.length<=160);
    const project=parseVectorPlan(JSON.stringify({vectorAssets:{hero:cast},
      vectorStages:{shore:{template:'folk-riverbank',cast:{person:'hero'}}},
      scenes:[{durationMs:5000,narration:'Người ấy bước trên bờ sông.',vectorScene:{
        stage:'shore',shot:{target:'person',height:.5,include:['mooring-stake']},
        walks:[{actor:'person',to:'mooring-stake',start:0,end:.65}]}},
      ]}),'Riverbank reusable staging',frame,5);
    const scene=project.scenes[0]!;
    assert.equal(scene.vectorScene?.width,frame.width);
    assert.equal(scene.vectorScene?.height,frame.height);
    const tracks=scene.vectorScene!.tracks;
    assert.ok(tracks.some(t=>t.target==='person'&&t.frames.some(f=>f.dx!==undefined)),'actual root travel');
    assert.ok(tracks.some(t=>t.target==='person/eyes'&&t.frames.some(f=>f.scaleY!==undefined)),'native synchronized chibi blink');
    assert.ok(tracks.some(t=>t.target.startsWith('person/leg-')||t.target.startsWith('person/knee-')),'articulated planted walk');
    // The new art rig adds actual connected upper-body counterbalance, never
    // body-only translation in place of native foot planting.
    const styled=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{...cast,style:'folk-chibi-v2'}},
      vectorStages:{shore:{template:'folk-riverbank',cast:{person:'hero'}}},
      scenes:[{durationMs:4000,narration:'Người khách bước đến bến rồi giật mình.',
        vectorScene:{stage:'shore',walks:[{actor:'person',to:'mooring-stake',start:0,end:.5}],
          reactions:[{actor:'person',kind:'startle',toward:'mooring-stake',start:.6,end:.85}]}}]}),
      'Folk art motion smoke',frame,4);
    const v2Tracks=styled.scenes[0]!.vectorScene!.tracks;
    assert.ok(v2Tracks.some(t=>t.target==='person/upper-body'&&t.start===0&&t.frames.some(f=>Math.abs(f.rotation??0)>1)),'walking spine counterbalance');
    assert.ok(v2Tracks.some(t=>t.target==='person/arm-r'&&t.start>=.6),'defensive reaction raises a connected arm');
    assert.ok(v2Tracks.some(t=>t.target==='person/brow-l'&&t.frames.some(f=>(f.dy??0)<-2)),'facial startle expression');

    const actor=scene.vectorScene!.nodes.find(n=>n.id==='person')!;
    const foot=vectorPoint(vectorWorldMatrix('person/foot-r',scene,1000,project.vectorAssets),0,0);
    assert.ok(Number.isFinite(foot.x)&&Number.isFinite(foot.y));
    assert.equal(actor.groundAnchor?.y,457);
  });
}
