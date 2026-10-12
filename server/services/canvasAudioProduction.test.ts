import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import {resolveCanvasSpeech} from '../../shared/canvasSpeech';
import { createCanvasProject,createCanvasScene,createCanvasObject } from '../../shared/canvasAnimationStudio';
import { synthesizeCanvasFoley } from './canvasFoley';
import { planCanvasSoundCues,normalizeCanvasSoundCues,canvasHorrorScoreCues } from '../../shared/canvasSoundDesign';
import { isCanvasActorSpeaking } from '../../shared/canvasDialogue';
import {canvasSpeechActivity,trimCanvasNarrationEdges} from './canvasSpeechActivity';

const directory=await mkdtemp(path.join(os.tmpdir(),'autosub-canvas-audio-'));
process.env.AUTOSUB_WORKDIR=directory;
const {prepareCanvasProjectAudio,selectCanvasRoleVoice,canvasAudioQueue,paceCanvasConversation}=await import('./canvasAudioProduction');
const {registerAnimationAsset,getAnimationAssetFile,normalizeNarrationAudio}=await import('./animationAssets');
const {run}=await import('./ffmpeg');
after(async()=>{
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
  assert.ok(path.basename(directory).startsWith('autosub-canvas-audio-'));
  await rm(directory,{recursive:true,force:true});
});

test('quiet dialogue distributes spare time across turns without frozen scene tails or audio regeneration',()=>{
  const scene=createCanvasScene();scene.dialogueLayout=true;scene.durationMs=20000;
  scene.dialogue=[0,1,2].map(index=>({id:`line-${index}`,speaker:'Minh',text:'Hello',atMs:index*5000,durationMs:5000,audioUrl:`retained-${index}.wav`}));
  scene.animationBeats=[{id:'authored',action:'gesture',dialogueId:'line-1',targetIds:['minh'],atMs:5300,durationMs:900}];
  paceCanvasConversation(scene,()=>200);
  assert.deepEqual(scene.dialogue.map(line=>line.atMs),[0,6100,12200]);
  assert.equal(scene.durationMs,17900);assert.equal(scene.animationBeats[0]!.atMs,6400);
  assert.equal(scene.dialogue[1]!.audioUrl,'retained-1.wav');
  const once=structuredClone(scene);paceCanvasConversation(scene,()=>200);assert.deepEqual(scene,once);
  scene.dialogueLayout=false;scene.durationMs=20000;const physical=structuredClone(scene);
  paceCanvasConversation(scene,()=>200);assert.deepEqual(scene,physical);
});

test('vector narration trims only edge silence, retimes cuts and reuses the resulting audio idempotently',async()=>{
  const wav=synthesizeCanvasFoley('wind',4000),rate=wav.readUInt32LE(24);
  for(let i=0;i<rate*4;i++)for(let c=0;c<2;c++)wav.writeInt16LE(i>=rate*.5&&i<rate*2.6&&!(i>=rate*1.2&&i<rate*1.6)?Math.round(9000*Math.sin(i*2*Math.PI*180/rate)):0,44+(i*2+c)*2);
  const trimmed=trimCanvasNarrationEdges(wav)!;
  assert.ok(trimmed.durationMs<2400&&trimmed.durationMs>2200);
  const windows=canvasSpeechActivity(trimmed.wav)!;
  assert.ok(windows[1]!.startMs-windows[0]!.endMs>=300,'internal natural pause remains');
  const project=createCanvasProject(),s=project.scenes[0]!;s.durationMs=6000;
  s.vectorScene={width:720,height:1280,nodes:[],tracks:[]};s.soundEffects=[];
  const id=randomUUID(),uri=`/api/animation-studio/assets/${id}/file`;
  await mkdir(path.join(directory,'animation-assets','files'),{recursive:true});
  await writeFile(path.join(directory,'animation-assets','files',`${id}.wav`),wav);
  await registerAnimationAsset({id,name:'Retained narration with long tail',type:'audio',uri,tags:[],createdAt:new Date().toISOString()});
  s.dialogue=[{id:'narrator',speaker:'narrator',text:'A continuous narrated scene.',audioUrl:uri,durationMs:4000,atMs:0,audioKey:'old-duration-dependent-key'}];
  const narration={provider:{id:'edge',name:'Edge',providerType:'edge-tts' as const,baseUrl:'local://edge-tts',enabled:true,models:[],authType:'none' as const,capabilities:{tts:true}},model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1};
  const first=await prepareCanvasProjectAudio({project,narration,autoSound:false,reuseNarration:true});
  const scene=first.scenes[0]!,line=scene.dialogue![0]!;
  assert.ok(scene.durationMs<2400);
  assert.ok(scene.durationMs-line.speechWindows!.at(-1)!.endMs<=194,'cut follows the last word without a multi-second tail');
  const second=await prepareCanvasProjectAudio({project:first,narration,autoSound:false});
  assert.equal(second.scenes[0]!.audioUrl,scene.audioUrl);
  assert.equal(second.scenes[0]!.durationMs,scene.durationMs);
  assert.equal(s.durationMs,6000,'original checkpoint is unchanged');
});

test('production aligns acting to retained speech and a second pass reuses audio without duplicate voice beats',async()=>{
  const project=createCanvasProject(),scene=project.scenes[0]!;scene.durationMs=2500;
  const actor=createCanvasObject('character',{characterKey:'minh'});scene.objects=[actor];
  const id=randomUUID(),uri=`/api/animation-studio/assets/${id}/file`;
  await mkdir(path.join(directory,'animation-assets','files'),{recursive:true});
  await writeFile(path.join(directory,'animation-assets','files',`${id}.wav`),synthesizeCanvasFoley('wind',1500));
  await registerAnimationAsset({id,name:'Speech checkpoint',type:'audio',uri,tags:[],createdAt:new Date().toISOString()});
  const narration={provider:{id:'edge',name:'Edge',providerType:'edge-tts' as const,baseUrl:'local://edge-tts',enabled:true,models:[],authType:'none' as const,capabilities:{tts:true}},model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1};
  const line={id:'line',speaker:'Minh',characterKey:'minh',text:'Nhìn chiếc đèn',voice:narration.voice,atMs:200,durationMs:1500,audioUrl:uri,speechWindows:[{startMs:100,endMs:1400}]};
  const delivery=resolveCanvasSpeech(line,1,false);
  const audioKey=createHash('sha256').update(JSON.stringify({text:delivery.text,voice:narration.voice,provider:'edge',model:'edge-tts',speed:delivery.speed,prosody:'natural-pauses-v1'})).digest('hex');
  scene.dialogue=[{...line,audioKey}];scene.soundEffects=[];
  scene.animationBeats=[{id:'point',action:'point',atMs:0,durationMs:700,targetIds:[actor.id],speechCue:'chiếc đèn'}];
  const first=await prepareCanvasProjectAudio({project,narration,autoSound:false});
  assert.ok(first.scenes[0]!.animationBeats!.find(b=>b.id==='point')!.atMs>300);
  assert.equal(first.scenes[0]!.dialogue![0]!.audioUrl,uri);
  const second=await prepareCanvasProjectAudio({project:first,narration,autoSound:false});
  assert.equal(second.scenes[0]!.audioUrl,first.scenes[0]!.audioUrl);
  assert.equal(second.scenes[0]!.animationBeats!.filter(b=>b.id==='voice-line').length,1);
  assert.deepEqual(second.scenes[0]!.animationBeats,first.scenes[0]!.animationBeats);
  assert.equal(scene.animationBeats[0]!.atMs,0,'input checkpoint remains intact');
});

test('foley has deterministic valid PCM, distinct textures and bounded peaks',()=>{
  const a=synthesizeCanvasFoley('knock',1000,123),b=synthesizeCanvasFoley('knock',1000,123);
  assert.deepEqual(a,b);assert.equal(a.toString('ascii',0,4),'RIFF');assert.equal(a.readUInt32LE(24),24000);
  assert.equal(a.length,44+24000*4);
  let peak=0;for(let i=44;i<a.length;i+=2)peak=Math.max(peak,Math.abs(a.readInt16LE(i)));
  assert.ok(peak>2000&&peak<32767);
  assert.notDeepEqual(a,synthesizeCanvasFoley('scratch',1000,123));
});

test('dog howl is an audible bounded deterministic cue with a quiet attack and release',()=>{
  const wav=synthesizeCanvasFoley('dog-howl',1000,7);
  assert.deepEqual(wav,synthesizeCanvasFoley('dog-howl',1000,7));
  assert.notDeepEqual(wav,synthesizeCanvasFoley('wind',1000,7));
  let peak=0;
  for(let i=44;i<wav.length;i+=4)peak=Math.max(peak,Math.abs(wav.readInt16LE(i)));
  assert.ok(peak>5000&&peak<32767);
  assert.equal(wav.readInt16LE(44),0);
  assert.ok(Math.abs(wav.readInt16LE(wav.length-4))<10);
  assert.equal(normalizeCanvasSoundCues([{preset:'dog-howl',atMs:200,durationMs:800,volume:.6}],2000)[0]!.preset,'dog-howl');
});

test('river ambience and splashes follow visible rowing and surfacing instead of a spoken warning',()=>{
  const scene=createCanvasScene();scene.background='river';scene.durationMs=5000;
  const actor=createCanvasObject('character');scene.objects=[actor];
  scene.animationBeats=[{id:'row',action:'row',targetIds:[actor.id],atMs:1000,durationMs:3000}];
  const cues=planCanvasSoundCues(scene);
  assert.equal(cues.filter(c=>c.preset==='water').length,1);
  const splashes=cues.filter(c=>c.preset==='splash');assert.equal(splashes.length,3);
  assert.ok(splashes.every(c=>c.atMs>=1000&&c.atMs+c.durationMs<=4000));
  assert.notDeepEqual(synthesizeCanvasFoley('water',1000,7),synthesizeCanvasFoley('splash',1000,7));
  scene.animationBeats=[];scene.narration='Do not jump into the water.';
  assert.ok(!planCanvasSoundCues(scene).some(c=>c.preset==='splash'));
  scene.background='room';scene.backgroundRef='bg:night-stilt-house';
  assert.ok(!planCanvasSoundCues(scene).some(c=>c.preset==='water'));
});

test('expressive normalization preserves an internal dramatic pause instead of cutting it',async()=>{
  const wav=synthesizeCanvasFoley('wind',1500),rate=wav.readUInt32LE(24);
  for(let i=0;i<rate*1.5;i++)for(let c=0;c<2;c++)wav.writeInt16LE(i>rate*.05&&(i<rate*.5||i>rate*.9)?Math.round(9000*Math.sin(i*2*Math.PI*180/rate)):0,44+(i*2+c)*2);
  const natural=await normalizeNarrationAudio(wav),compact=await normalizeNarrationAudio(wav,false);
  const dataBytes=(output:Buffer)=>{const start=output.indexOf(Buffer.from('data'));return output.readUInt32LE(start+4);};
  assert.ok(dataBytes(natural)-dataBytes(compact)>48000*4*.2,'at least 200ms of the authored pause must survive');
});

test('cue planning places cloth at the blanket action and does not fabricate knocking in a warning scene',()=>{
  const scene=createCanvasScene(0);scene.name='Không trả lời';scene.narration='Tôi kéo chăn';scene.durationMs=3000;
  scene.objects=[createCanvasObject('character',{keyframes:[{atMs:700,pose:'cover-face'}]})];
  assert.equal(planCanvasSoundCues(scene).find(c=>c.preset==='cloth')?.atMs,700);
  scene.name='Lời dặn';scene.narration='Nếu nghe tiếng gõ thì đừng trả lời';
  assert.ok(!planCanvasSoundCues(scene).some(c=>c.preset==='knock'));
  scene.name='Cào mặt ván';scene.narration='Tiếng gõ im bặt. Rồi tiếng cào nổi lên.';
  assert.ok(!planCanvasSoundCues(scene).some(c=>c.preset==='knock'));
  assert.ok(planCanvasSoundCues(scene).some(c=>c.preset==='scratch'));
  assert.deepEqual(normalizeCanvasSoundCues([{preset:'constructor'}],3000),[]);
});

test('automatic foley follows walking beats and hinged door movement with quiet bounded cues',()=>{
  const scene=createCanvasScene(0);scene.name='Room';scene.narration='';scene.durationMs=4000;
  const actor=createCanvasObject('character');
  const door=createCanvasObject('prop',{variant:'door',doorOpen:1,keyframes:[{atMs:0,doorOpen:1},{atMs:2000,doorOpen:1},{atMs:2600,doorOpen:0}]});
  scene.objects=[actor,door];scene.animationBeats=[{id:'walk',action:'run',targetIds:[actor.id],atMs:1000,durationMs:1500}];
  const cues=planCanvasSoundCues(scene),steps=cues.filter(cue=>cue.preset==='footstep');
  assert.equal(steps.length,3);assert.ok(steps.every(cue=>cue.atMs>=1000&&cue.atMs+cue.durationMs<=2500&&cue.volume<.2));
  assert.equal(cues.find(cue=>cue.preset==='door-creak')?.atMs,2000);
});

test('role selection respects Vietnamese gender metadata, explicit mapping and resetting to automatic',()=>{
  const project=createCanvasProject();const voices=[{id:'man',name:'Nam',language:'vi-VN'},{id:'woman',name:'Nữ',language:'vi-VN'},{id:'english',name:'Female',language:'en-US'}];
  const line={id:'l',speaker:'Bà chủ',text:'Chào cháu'};
  assert.equal(selectCanvasRoleVoice(line,project,voices,'man'),'woman');
  project.castVoices={'Bà chủ':'man'};assert.equal(selectCanvasRoleVoice(line,project,voices,'man'),'man');
  project.castVoices={'Bà chủ':''};assert.equal(selectCanvasRoleVoice({...line,voice:'man'},project,voices,'man'),'woman');
});

test('a male actor with a bun keeps a male voice and new roles use available matching voices',()=>{
  const project=createCanvasProject();project.scenes[0]!.objects=[createCanvasObject('character',{characterKey:'duy',hair:'bun',voiceGender:'male'})];
  const voices=[{id:'male-one',name:'Male narrator',language:'vi-VN'},{id:'male-two',name:'Male character',language:'vi-VN'},{id:'female-one',name:'Female',language:'vi-VN'}];
  project.castVoices={'Người kể':'male-one'};
  assert.equal(selectCanvasRoleVoice({id:'duy',speaker:'Bác Duy',characterKey:'duy',text:'Chào'},project,voices,'male-one'),'male-two');
  assert.equal(selectCanvasRoleVoice({id:'n',speaker:'Người kể',text:'Bác Duy kể'},project,voices,'male-one'),'male-one');
});

test('audio queue bounds parallel work and waits for in-flight work before reporting failure',async()=>{
  let active=0,peak=0,finished=0;
  const tasks=Array.from({length:6},()=>async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;finished++;});
  await canvasAudioQueue(tasks,2);assert.equal(peak,2);assert.equal(finished,6);assert.equal(active,0);
  await assert.rejects(canvasAudioQueue([async()=>{throw new Error('failed');},async()=>{active++;await new Promise(r=>setTimeout(r,10));active--;}],2),/failed/);
  assert.equal(active,0,'caller may safely resume after a failed queue');
});

test('only the speaking actor moves their mouth, including off-screen dialogue and silence',()=>{
  const scene=createCanvasScene(0),actor=createCanvasObject('character',{characterKey:'minh'}),other=createCanvasObject('character',{characterKey:'host'});
  scene.dialogue=[{id:'l',speaker:'Minh',characterKey:'minh',text:'Chào',atMs:500,durationMs:700}];
  assert.equal(isCanvasActorSpeaking(scene,actor,600),true);assert.equal(isCanvasActorSpeaking(scene,other,600),false);
  assert.equal(isCanvasActorSpeaking(scene,actor,1300),false);
  scene.dialogue[0]!.characterKey='offscreen';assert.equal(isCanvasActorSpeaking(scene,actor,600),false);
});

test('real FFmpeg mix retains narration, caches sound design and never mixes the previous mix again',async()=>{
  const project=createCanvasProject(),scene=project.scenes[0]!;scene.durationMs=1500;
  const id=randomUUID(),file=path.join(directory,'animation-assets','files',`${id}.wav`);
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,synthesizeCanvasFoley('wind',1500,41));
  const uri=`/api/animation-studio/assets/${id}/file`;
  await registerAnimationAsset({id,name:'Retained narration',type:'audio',uri,tags:[],createdAt:new Date().toISOString()});
  scene.audioUrl=uri;scene.soundEffects=[{id:'knock',preset:'knock',atMs:400,durationMs:900,volume:.3,pan:-.4},{id:'wind',preset:'wind',atMs:0,durationMs:1500,volume:.09}];
  const narration={provider:{id:'edge',name:'Edge',providerType:'edge-tts' as const,baseUrl:'local://edge-tts',enabled:true,models:[],authType:'none' as const,capabilities:{tts:true}},model:'edge-tts',voice:'vi-VN-NamMinhNeural'};
  const first=await prepareCanvasProjectAudio({project,narration});
  assert.equal(scene.audioUrl,uri,'input must remain unchanged');
  assert.equal(first.scenes[0]!.sourceAudioUrl,uri);assert.notEqual(first.scenes[0]!.audioUrl,uri);
  const reused=await prepareCanvasProjectAudio({project:first,narration});
  assert.equal(reused.scenes[0]!.audioUrl,first.scenes[0]!.audioUrl);
  const output=await readFile((await getAnimationAssetFile(first.scenes[0]!.audioUrl!.split('/')[4]!)).path);
  const data=output.indexOf(Buffer.from('data'));
  assert.ok(data>0);assert.equal(output.readUInt32LE(data+4),1500/1000*48000*4);
  first.scenes[0]!.soundEffects![0]!.volume=.6;
  const changed=await prepareCanvasProjectAudio({project:first,narration});
  assert.notEqual(changed.scenes[0]!.audioUrl,reused.scenes[0]!.audioUrl);assert.equal(changed.scenes[0]!.sourceAudioUrl,uri);
});


test('horror score is automatic, bounded and never duplicated on resume',()=>{
  const scene=createCanvasScene();scene.durationMs=45000;
  const cues=canvasHorrorScoreCues(scene,'folk-horror');
  assert.equal(cues.length,2);assert.equal(cues[1]!.durationMs,15000);
  scene.soundEffects=cues;assert.deepEqual(canvasHorrorScoreCues(scene,'folk-horror'),[]);
  assert.deepEqual(canvasHorrorScoreCues(createCanvasScene(),'happy history'),[]);
  const wav=synthesizeCanvasFoley('horror-score',1000,1,7.5);
  assert.deepEqual(wav,synthesizeCanvasFoley('horror-score',1000,1,7.5));
  assert.notDeepEqual(wav,synthesizeCanvasFoley('horror-score',1000,1,0));
  assert.ok(Array.from({length:(wav.length-44)/4},(_,i)=>Math.abs(wav.readInt16LE(44+i*4))).some(v=>v>1000));
  assert.notDeepEqual(synthesizeCanvasFoley('bell',1000,1),synthesizeCanvasFoley('knock',1000,1));
});

test('real mix keeps horror music audible on small speakers and wet steps above the bed during narration',async()=>{
  const project=createCanvasProject(),scene=project.scenes[0]!;scene.durationMs=2000;
  const id=randomUUID(),file=path.join(directory,'animation-assets','files',`${id}.wav`);
  const voice=synthesizeCanvasFoley('wind',2000),rate=voice.readUInt32LE(24);
  for(let i=0;i<(voice.length-44)/4;i++)for(let c=0;c<2;c++)
    voice.writeInt16LE(Math.round(.2*32767*Math.sin(2*Math.PI*650*i/rate)),44+i*4+c*2);
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,voice);
  const uri=`/api/animation-studio/assets/${id}/file`;
  await registerAnimationAsset({id,name:'Retained speech',type:'audio',uri,tags:[],createdAt:new Date().toISOString()});
  scene.sourceAudioUrl=uri;scene.soundEffects=[
    {id:'score',preset:'horror-score',atMs:0,durationMs:2000,volume:.3},
    {id:'wet',preset:'water',atMs:700,durationMs:220,volume:.65},
    {id:'knock',preset:'knock',atMs:1200,durationMs:180,volume:.85},
  ];
  const narration={provider:{id:'edge',name:'Edge',providerType:'edge-tts' as const,baseUrl:'local://edge-tts',enabled:true,models:[],authType:'none' as const,capabilities:{tts:true}},model:'edge-tts',voice:'vi-VN-NamMinhNeural'};
  const mixed=await prepareCanvasProjectAudio({project,narration,autoSound:false});
  const output=(await getAnimationAssetFile(mixed.scenes[0]!.audioUrl!.split('/')[4]!)).path;
  const stem=path.join(directory,'effects-small-speaker.f32');
  await run('ffmpeg',['-v','error','-y','-i',output,'-i',file,'-filter_complex',
    '[1:a]volume=-0.7071067811865476[voice];[0:a][voice]amix=inputs=2:normalize=0,highpass=f=180,lowpass=f=5000[effects]',
    '-map','[effects]','-ar','48000','-ac','1','-f','f32le',stem]);
  const pcm=await readFile(stem);
  const rms=(start:number,end:number)=>{
    let energy=0,count=0;
    for(let i=Math.round(start*48000);i<Math.round(end*48000);i++){energy+=pcm.readFloatLE(i*4)**2;count++;}
    return Math.sqrt(energy/count);
  };
  const bed=rms(.15,.5),wet=rms(.72,.9),knock=rms(1.21,1.3);
  assert.ok(bed>.01,`music survives a small-speaker bandpass: ${20*Math.log10(bed)} dBFS`);
  assert.ok(bed<.04,'music stays below narration');
  assert.ok(wet>bed*2,'short wet steps must not be ducked as continuous water ambience');
  assert.ok(knock>bed*2,'foreground knocks remain distinct under speech');
  assert.equal(mixed.scenes[0]!.sourceAudioUrl,uri,'reuse the original narration');
  assert.deepEqual(scene.soundEffects.map(c=>c.atMs),[0,700,1200],'cue timing is preserved');
  const reused=await prepareCanvasProjectAudio({project:mixed,narration,autoSound:false});
  assert.equal(reused.scenes[0]!.audioUrl,mixed.scenes[0]!.audioUrl,'resume reuses the new mix');
});
