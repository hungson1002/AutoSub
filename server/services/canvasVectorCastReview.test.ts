import test from 'node:test';import assert from 'node:assert/strict';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';
import {normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart} from '../../shared/canvasVectorScene';
import {lockFolkInkAsset} from '../../shared/canvasVectorStyleLock';
import {buildVectorCastReview} from './canvasVectorCastReview';
import {buildVectorReviewContent} from './canvasVectorDirector';

function fixture(){
  const p=createCanvasProject();p.vectorAssets=normalizeVectorAssets(Object.fromEntries(Array.from({length:9},(_,i)=>['person-'+i,
    lockFolkInkAsset({rig:'simple-puppet',hair:i===2?'wavy':'short',headwear:'none',eyeShape:i%2?'half-lidded':'round'})])));
  p.scenes=[{...p.scenes[0]!,durationMs:3000,narration:'The villagers wait.',audioUrl:'/api/kept.wav',vectorAssetLibrary:p.vectorAssets,
    vectorScene:normalizeVectorScene({width:1280,height:720,nodes:Array.from({length:8},(_,i)=>({id:'actor-'+i,type:'instance',asset:'person-'+i,x:100+i*100,y:500,width:40,height:60}))},p.vectorAssets)}];
  return p;
}

test('crowd review enlarges only used immutable assets, preserving mirrored identity and the original film',()=>{
  const p=fixture(),before=structuredClone(p),atlas=buildVectorCastReview(p)!;
  assert.equal(atlas.pages.length,2);assert.equal(atlas.pages[0]!.assetIds.length,8);
  assert.equal(atlas.pages[0]!.assetIds.includes('person-8'),false,'unused library defaults are not cast');
  assert.equal(atlas.project.vectorAssets,p.vectorAssets,'do not redraw or substitute the generated assets');
  for(const s of atlas.project.scenes){
    assert.equal(s.narration,'');assert.equal(s.audioUrl,undefined);
    assert.ok(s.vectorScene!.nodes.filter(n=>n.type==='instance').every(n=>n.height===280),'render readable native profiles instead of magnifying tiny film pixels');
  }
  assert.equal(evaluateVectorPart('cast-0/front-head',atlas.project.scenes[1]!,0).opacity,1);
  assert.equal(evaluateVectorPart('cast-0/upper-body',atlas.project.scenes[1]!,0).scaleX,-1);
  assert.equal(evaluateVectorPart('cast-0/rear-head',atlas.project.scenes[1]!,0,0).opacity,0);
  assert.deepEqual(p,before,'inspection cannot alter assets, TTS, actor placement, duration or scene IDs');
});

test('enlarged cast evidence is separate from film shots and maps cells back to real actor identities',()=>{
  const p=fixture(),atlas=buildVectorCastReview(p)!,page=atlas.pages[0]!;
  const result=buildVectorReviewContent(p,[{sceneId:p.scenes[0]!.id,times:[0],imageUrl:'FILM'}],'cast proof',undefined,
    [{view:page.view,assetIds:page.assetIds,imageUrl:'CAST'}]);
  assert.deepEqual(result.scenes,p.scenes,'inspection sheets must not create new editable film shots');
  const evidence=result.content.find(c=>c.type==='text'&&String(c.text).includes('ACTUAL CAST DETAIL SHEET'))!;
  const cells=JSON.parse(String(evidence.text)).cells;
  assert.deepEqual(cells[0].instances,[{sceneId:p.scenes[0]!.id,actorId:'actor-0'}]);
  assert.ok(result.content.some(c=>(c.image_url as any)?.url==='CAST'));
  assert.ok(JSON.stringify(result.content).includes('FILM'),'placement still uses actual chronological frames');
});
