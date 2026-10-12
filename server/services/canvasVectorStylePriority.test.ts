import test from 'node:test';
import assert from 'node:assert/strict';
import {VECTOR_DIRECTOR_CONTRACT,parseVectorPlan} from './canvasVectorDirector';
import {vectorRiverbank} from './canvasVectorRiverbank';

test('new films cannot default everyone to the unrequested brown-robed v2 chibi',()=>{
  assert.match(VECTOR_DIRECTOR_CONTRACT,/CHARACTER ART-STYLE PRIORITY/);
  assert.match(VECTOR_DIRECTOR_CONTRACT,/The default for a NEW person is NOT folk-chibi-v2/);
  assert.doesNotMatch(VECTOR_DIRECTOR_CONTRACT,/DEFAULT HUMAN STYLE FOR NEW FILMS: default to/);
  const fallback=vectorRiverbank().assets['folk-riverbank-person'];
  assert.equal(fallback.rig,'simple-puppet');
  assert.equal('style' in fallback,false,'a stage placeholder must not impose a universal makeover');
});

test('folk riverbank honors the user-approved compact puppet without adding visible stick legs',()=>{
  const userCast={rig:'simple-puppet',outfit:'tunic',hair:'short',palette:{
    shirt:'#496777',skin:'#e2c5a5',accent:'#ccb77c',hair:'#352924',inner:'#f1e3cd',trim:'#bda073'}};
  const film=parseVectorPlan(JSON.stringify({vectorAssets:{hero:userCast},
    vectorStages:{shore:{template:'folk-riverbank',cast:{person:'hero'}}},
    scenes:[{durationMs:3000,narration:'Người khách nghe tiếng nước.',
      vectorScene:{stage:'shore',reactions:[{actor:'person',toward:'mooring-stake',kind:'look',start:0,end:.3}]}}]}),
    'truyện ma, đúng phong cách nhân vật người dùng đã chọn',{width:720,height:1280},3);
  const actor=film.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='person');
  assert.equal(actor?.asset,'hero');
  assert.ok(film.vectorAssets!.hero!.nodes.some(n=>n.id==='puppet-root'));
  assert.ok(!film.vectorAssets!.hero!.nodes.some(n=>n.id==='knee-l'),'no forced doll rig');
  assert.ok(!film.vectorAssets!.hero!.nodes.some(n=>n.id==='folk-art-v2'),'no unrequested art makeover');
});
