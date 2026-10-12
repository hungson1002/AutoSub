import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasObject,type CanvasStudioProject,type CanvasAnimationAction} from './canvasAnimationStudio';
import {evaluateCanvasActionCoverage,canvasSpokenTranscript} from './canvasActionCoverage';
import {evaluateCanvasVisualQuality} from './canvasVisualQuality';

const plan=(action:CanvasAnimationAction='point'):CanvasStudioProject=>({version:1,id:'manual',name:'Manual work',width:1280,height:720,fps:30,createdAt:'',updatedAt:'',sourcePrompt:'horror',scenes:[{
  id:'lamp',name:'Lamp',background:'room',backgroundRef:'bg:room-stilt-house',template:'two-shot',durationMs:4500,
  narration:'Minh lau lại kính đèn.',objects:[createCanvasObject('character',{id:'minh',label:'Minh',characterKey:'minh',pose:'idle',role:'focal'}),
    createCanvasObject('prop',{id:'lamp',label:'Đèn',variant:'lantern',role:'support'})],
  animationBeats:[{id:'action',action,targetIds:['minh'],speechCue:'lau lại kính',focusTargetId:'lamp',atMs:300,durationMs:1800}],
}]});

test('restlessness is not a literal sitting event while real sitting remains required',()=>{
 const p=plan('wipe');p.scenes[0]!.narration='Ông không thể ngồi yên, chạy ra ngoài tìm người.';
 assert.ok(!evaluateCanvasActionCoverage(p).some(i=>i.cue==='ngồi'));
 p.scenes[0]!.narration='Ông ngồi yên trên ghế.';
 assert.ok(evaluateCanvasActionCoverage(p).some(i=>i.cue==='ngồi'));
});

test('physical contact is allowed to overlap, but unrelated body collisions remain reported by name',()=>{
 const p=plan('wipe');const scene=p.scenes[0]!;
 scene.template='hero-left';scene.objects[0]!.slot='hero-left';scene.objects[1]!.slot='hero-left';
 assert.ok(!evaluateCanvasVisualQuality(p).issues.some(i=>i.code==='large-overlap'));
 scene.animationBeats=[];scene.narration='Minh đứng cạnh Nam.';
 scene.objects[1]=createCanvasObject('character',{id:'nam',label:'Nam',slot:'hero-left',role:'support'});
 const collision=evaluateCanvasVisualQuality(p).issues.find(i=>i.code==='large-overlap');
 assert.ok(collision);assert.match(collision.message,/Minh|minh/);assert.match(collision.message,/Nam/);
});

test('standing/pointing is rejected for lamp cleaning but wiping its actual target passes',()=>{
  const incomplete=plan(),complete=plan('wipe');
  assert.equal(evaluateCanvasActionCoverage(incomplete).length,1);
  assert.ok(evaluateCanvasVisualQuality(incomplete).issues.some(i=>i.code==='missing-action-coverage'));
  assert.equal(evaluateCanvasActionCoverage(complete).length,0);
  assert.equal(canvasSpokenTranscript(incomplete),canvasSpokenTranscript(complete));
  assert.equal(complete.scenes[0]!.animationBeats![0]!.action,'wipe');
});

test('future plans, negations and spoken commands do not fabricate physical actions',()=>{
  const p=plan();p.scenes[0]!.dialogue=[{id:'n',speaker:'Người kể',text:'Minh định lau kính đèn. Anh sẽ buộc dây. Anh không dìu ai.'},
    {id:'m',speaker:'Minh',characterKey:'minh',text:'Bác cứ ngồi ở đây.'}];
  assert.equal(evaluateCanvasActionCoverage(p).length,0);
});

test('multiple narrated manual actions must each have the corresponding interaction',()=>{
  const p=plan();p.scenes[0]!.dialogue=[{id:'n',speaker:'Người kể',text:'Minh buộc dây, kiểm tra chân và dìu bác về. Sau đó anh ghi các nhịp sáng vào một tờ giấy mới.'}];
  assert.equal(evaluateCanvasActionCoverage(p).length,4);
});

test('named sitting is not covered by a standing actor',()=>{
  const p=plan();p.scenes[0]!.dialogue=[{id:'n',speaker:'Người kể',text:'Minh ngồi bên chiếc hộp gỗ.'}];
  assert.equal(evaluateCanvasActionCoverage(p).length,1);
  p.scenes[0]!.objects[0]!.pose='sit';assert.equal(evaluateCanvasActionCoverage(p).length,0);
});

test('Vietnamese accents distinguish a house and calming wind from sitting and assisted walking',()=>{
  const p=plan();p.scenes[0]!.dialogue=[{id:'n',speaker:'Người kể',text:'Ngôi nhà bên suối, tiếng gió đã dịu xuống.'}];
  assert.equal(evaluateCanvasActionCoverage(p).length,0);
});
