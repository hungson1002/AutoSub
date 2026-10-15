import test from 'node:test';import assert from 'node:assert/strict';
import art from '../assets/vector-styles/folk-horror/upright-courtyard/drawing.json';
import originalArt from '../assets/vector-styles/folk-horror/approved-courtyard/drawing.json';
import {approvedCourtyard} from './canvasVectorApprovedCourtyard';import {vectorCourtyard} from './canvasVectorCourtyard';
import {parseVectorPlan} from './canvasVectorDirector';import {FOLK_INK_STYLE} from '../../shared/canvasVectorInk';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';import {evaluateVectorPart} from '../../shared/canvasVectorScene';
const frame={width:1280,height:720};
function parsed(light='day',extra={}){
 return parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard',light}},scenes:[{durationMs:2000,narration:'The courtyard is quiet.',vectorScene:{stage:'yard',...extra}}]}),'[folk-horror]',frame);
}
test('folk-ink production expansion uses accepted paint instead of the old courtyard illustrator',()=>{
 const p=parsed(),nodes=p.scenes[0]!.vectorScene!.nodes;
 assert.ok(nodes.some(n=>n.id==='approved-courtyard-svg-v1'));
 assert.ok(nodes.some(n=>n.id.startsWith('approved-straw-')));
 assert.ok(nodes.some(n=>n.id.startsWith('approved-fence-')));
 assert.ok(!nodes.some(n=>n.id==='wall-plank--161'),'old house paint is not mixed into the approved world');
 const source=Object.entries(art.parts).filter(([part])=>part!=='sky').flatMap(([,nodes])=>nodes);
 assert.ok(source.length>200&&nodes.length<512);
 for(const node of source)assert.equal(nodes.find(n=>n.id===node.id)?.d,node.d,'no second hand-ink deformation: '+node.id);
});
test('night readability preserves native black filled ink and dark doorway in a horror brief',()=>{
 for(const light of ['day','dusk','night']){
  const p=parsed(light),nodes=p.scenes[0]!.vectorScene!.nodes;
  const ink=Object.values(art.parts).flat().filter(n=>n.fill==='#17120f');
  for(const node of ink)assert.equal(nodes.find(n=>n.id===node.id)!.fill,'#17120f',light+' ink must not turn gray');
  assert.equal(nodes.find(n=>n.id==='approved-door-opening-0')!.fill,'#39291f');
 }
});
test('day, dusk and night keep the same geometry while changing only declared native lighting',()=>{
 const day=approvedCourtyard(frame,'day'),night=approvedCourtyard(frame,'night');
 for(const n of day.stage.nodes.filter(n=>n.type==='path'))assert.equal(night.stage.nodes.find(a=>a.id===n.id)!.d,n.d);
 assert.equal(day.stage.nodes.find(n=>n.id==='lamp')!.opacity,0);
 assert.equal(night.stage.nodes.find(n=>n.id==='lamp')!.opacity,1);
 assert.deepEqual(approvedCourtyard(frame,'day'),day,'repeat generation does not wobble or redraw the scene');
});
test('door hardware follows its native leaf and retains the local contact anchor through a hinge',()=>{
 const p=parsed('day',{hinges:[{target:'door',open:true,start:0,end:1}]}),s={...p.scenes[0]!,vectorAssetLibrary:p.vectorAssets} as any;
 const door=s.vectorScene.nodes.find((n:any)=>n.id==='door');
 assert.deepEqual(door.groundAnchor,{x:70,y:370});
 const here=vectorPoint(vectorWorldMatrix('door',s,0),70,370);
 assert.ok(Math.abs(here.y-521)<.1,'leaf is grounded at its authored threshold, not snapped into the foreground');
 assert.equal(s.vectorScene.nodes.find((n:any)=>n.id==='ring').parent,'door');
 assert.equal(s.vectorScene.nodes.find((n:any)=>n.id==='approved-paint-door-leaf').parent,'door');
 assert.notEqual(vectorPoint(vectorWorldMatrix('ring',s,0),0,0).x,vectorPoint(vectorWorldMatrix('ring',s,1999),0,0).x);
 assert.deepEqual(vectorPoint(vectorWorldMatrix('door',s,0),102,370),vectorPoint(vectorWorldMatrix('door',s,1999),102,370),'actual door hinge stays fixed while the leaf opens');
 assert.ok(evaluateVectorPart('door',s,1999).scaleX<1);
});
test('accepted courtyard paths stay within the existing parser budget without dropping detail',()=>{
 for(const frame of [{width:1280,height:720},{width:720,height:1280}]){
  const s=vectorCourtyard(frame,{artStyle:FOLK_INK_STYLE,light:'day'}).stage;
  assert.ok(s.nodes.length<512);
  for(const n of s.nodes)if(n.type==='path')assert.ok(n.d!.length<=8000,n.id);
  assert.equal(s.nodes.find(n=>n.id==='courtyard-world')!.scaleX,s.nodes.find(n=>n.id==='courtyard-world')!.scaleY);
 }
 const legacy=vectorCourtyard(frame);
 assert.ok(legacy.stage.nodes.some(n=>n.id==='wall-plank--161'));
 assert.ok(!legacy.stage.nodes.some(n=>n.id==='approved-courtyard-svg-v1'),'legacy saved/native paths remain available');
});

test('the original expanded paint remains available while new folk courtyards use upright construction',()=>{
 const old=approvedCourtyard(frame,'day','original').stage.nodes;
 for(const node of Object.entries(originalArt.parts).filter(([part])=>part!=='sky').flatMap(([,nodes])=>nodes))assert.equal(old.find(n=>n.id===node.id)!.d,node.d);
 const fresh=vectorCourtyard(frame,{artStyle:FOLK_INK_STYLE,light:'day'}).stage.nodes;
 assert.notEqual(fresh.find(n=>n.id==='approved-house-0')!.d,old.find(n=>n.id==='approved-house-0')!.d,'new house construction must not reuse leaning wall geometry');
});
