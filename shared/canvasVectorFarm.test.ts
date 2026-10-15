import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVectorAssets} from './canvasVectorScene';
import {vectorChickenWalkTracks} from './canvasVectorChicken';
import {vectorSnakeWalkTracks} from './canvasVectorSnake';

test('chicken rig has two attached leg chains, comb/beak/wattle and dot eye',()=>{
  const rig=normalizeVectorAssets({hen:{rig:'simple-chicken'}}).hen!;
  assert.equal(rig.width,240);assert.equal(rig.height,200);
  for(const side of ['l','r']){
    assert.equal(rig.nodes.find(n=>n.id==='knee-'+side)!.parent,'leg-'+side);
    assert.equal(rig.nodes.find(n=>n.id==='foot-'+side)!.parent,'knee-'+side);
    assert.equal(rig.nodes.filter(n=>n.parent==='foot-'+side).length,3);
  }
  assert.equal(rig.nodes.find(n=>n.id==='comb')!.parent,'head-group');
  assert.equal(rig.nodes.find(n=>n.id==='beak')!.parent,'head-group');
  assert.equal(rig.nodes.find(n=>n.id==='eye')!.parent,'eyes');
  assert.throws(()=>normalizeVectorAssets({bad:{rig:'simple-chicken',palette:{skin:'red'}}}),/palette/);
  assert.throws(()=>normalizeVectorAssets({bad:{rig:'simple-chicken',facing:'up'}}),/facing/);
  assert.deepEqual(normalizeVectorAssets({hen:rig}).hen,rig);
});

test('snake rig has five coils, head-group with tongue and dot eyes',()=>{
  const rig=normalizeVectorAssets({snake:{rig:'simple-snake'}}).snake!;
  assert.equal(rig.width,360);assert.equal(rig.height,120);
  for(let i=0;i<5;i++)assert.ok(rig.nodes.some(n=>n.id==='seg-'+i),'seg-'+i);
  assert.equal(rig.nodes.find(n=>n.id==='head')!.parent,'head-group');
  assert.equal(rig.nodes.find(n=>n.id==='tongue')!.parent,'head-group');
  assert.throws(()=>normalizeVectorAssets({bad:{rig:'simple-snake',palette:{skin:'x'}}}),/palette/);
  assert.deepEqual(normalizeVectorAssets({snake:rig}).snake,rig);
});

test('chicken walk struts with alternating legs and head counter-bob',()=>{
  const assets=normalizeVectorAssets({hen:{rig:'simple-chicken'}});
  const node={id:'hen',type:'instance' as const,asset:'hen',x:100,y:800,width:180,height:150};
  const tracks=vectorChickenWalkTracks(node,assets.hen!,80,{start:0,end:.6,cue:'Gà đi.'});
  const targets=tracks.map(t=>t.target);
  assert.ok(targets.includes('hen/leg-l')&&targets.includes('hen/leg-r'));
  assert.ok(targets.includes('hen/head-group')&&targets.includes('hen/tail'));
  const root=tracks.find(t=>t.target==='hen')!;
  assert.ok((root.frames.at(-1)!.dx??0)-(root.frames[0]!.dx??0)>70);
  assert.throws(()=>vectorChickenWalkTracks(node,assets.hen!,400,{start:0,end:.5}),/short distance/);
  assert.throws(()=>vectorChickenWalkTracks(node,assets.hen!,40,{start:.5,end:.5}),/timing/);
});

test('snake walk slithers with phase-shifted segments, never slides',()=>{
  const assets=normalizeVectorAssets({snake:{rig:'simple-snake'}});
  const node={id:'snake',type:'instance' as const,asset:'snake',x:100,y:900,width:270,height:90};
  const tracks=vectorSnakeWalkTracks(node,assets.snake!,120,{start:.1,end:.7,cue:'Rắn trườn.'});
  const targets=tracks.map(t=>t.target);
  for(let i=0;i<5;i++)assert.ok(targets.includes('snake/seg-'+i),'seg-'+i);
  assert.ok(targets.includes('snake/head-group'));
  const seg0=tracks.find(t=>t.target==='snake/seg-0')!,seg2=tracks.find(t=>t.target==='snake/seg-2')!;
  assert.notDeepEqual(seg0.frames.map(f=>f.dy),seg2.frames.map(f=>f.dy));
  const root=tracks.find(t=>t.target==='snake')!;
  assert.ok((root.frames.at(-1)!.dx??0)-(root.frames[0]!.dx??0)>100);
  assert.throws(()=>vectorSnakeWalkTracks(node,assets.snake!,500,{start:0,end:.5}),/short distance/);
});
