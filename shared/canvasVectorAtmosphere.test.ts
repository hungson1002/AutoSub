import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeVectorAtmosphere,vectorAtmospherePuffs} from './canvasVectorAtmosphere';
import {normalizeVectorScene} from './canvasVectorScene';
const bounds={x:0,y:200,width:1280,height:330};
test('atmosphere is deterministic when frames are rendered in any order',()=>{
 for(const kind of ['fog','smoke'] as const){
  const effect=normalizeVectorAtmosphere({kind,seed:483,density:.7}),a=vectorAtmospherePuffs(effect,bounds,1200);
  vectorAtmospherePuffs(effect,bounds,99000);
  assert.deepEqual(a,vectorAtmospherePuffs(effect,bounds,1200));
  assert.notDeepEqual(a,vectorAtmospherePuffs(effect,bounds,1300));
  assert.deepEqual(vectorAtmospherePuffs({...effect,speed:0},bounds,0),vectorAtmospherePuffs({...effect,speed:0},bounds,5000));
 }
});
test('fog drifts smoothly and smoke fades at birth and death instead of popping on loop boundaries',()=>{
 for(const kind of ['fog','smoke'] as const){
  const effect=normalizeVectorAtmosphere({kind,density:.8});
  for(let t=0;t<14000;t+=33){
   const a=vectorAtmospherePuffs(effect,bounds,t),b=vectorAtmospherePuffs(effect,bounds,t+33);
   for(let i=0;i<a.length;i++){
    const p=a[i]!,q=b[i]!;
    assert.ok(p.opacity>=0&&p.opacity<=(kind==='fog'?.33:.25));
    if(Math.hypot(p.x-q.x,p.y-q.y)>10)assert.ok(p.opacity<.01&&q.opacity<.01,'wrapped smoke particles must be invisible');
    else assert.ok(Math.abs(p.opacity-q.opacity)<.02);
   }
  }
 }
});
test('only bounded, validated atmosphere survives SVG normalization',()=>{
 const effect={kind:'fog',density:.3,seed:17,speed:.7};
 const drawing={width:1280,height:720,nodes:[{id:'mist',type:'group',bounds,atmosphere:effect}],tracks:[]};
 assert.deepEqual(normalizeVectorScene(drawing,{}).nodes[0]!.atmosphere,effect);
 for(const bad of [{kind:'script'},{kind:'fog',density:2},{kind:'fog',seed:.5},{kind:'smoke',speed:Infinity}])assert.throws(()=>normalizeVectorAtmosphere(bad),/Vector:/);
 assert.throws(()=>normalizeVectorScene({...drawing,nodes:[{id:'mist',type:'group',atmosphere:effect}]},{}),/bounded group/);
});
