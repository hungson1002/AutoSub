import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createCanvasObject,type CanvasStudioProject,type CanvasStudioScene,type CanvasDialogueLine} from '../shared/canvasAnimationStudio';
import {createVieneuLocalProvider} from '../src/lib/providers';

process.env.AUTOSUB_VIENEU_WORKERS='1';
process.env.AUTOSUB_ANIMATION_RENDER_CONCURRENCY='1';
const {prepareCanvasProjectAudio}=await import('../server/services/canvasAudioProduction');
const {renderCanvasAnimationProject}=await import('../server/services/animationRender');
const directory=path.resolve('tmp/new-acting-demo');
await mkdir(directory,{recursive:true});
const actor=(host=false,x=640,height=390)=>createCanvasObject('character',{
  label:host?'Bà chủ':'Minh',characterKey:host?'ba-chu':'minh-main',
  archetype:host?'villager':'worker',hair:host?'bun':'short',
  x,y:420,width:height*.64,height,scale:1,rotation:0,opacity:1,zIndex:30,
  motion:'none',pose:'idle',expression:'neutral',facing:host?'right':'left',
  color:host?'#79604f':'#66747a',secondaryColor:'#46535a',skinTone:'#d6aa84',
  assetRef:host?'character:villager':'character:worker',
  designNotes:host?'older woman angular face village clothing':'young narrow face work shirt',
});
const lantern=()=>createCanvasObject('prop',{label:'Đèn ở hiên',variant:'lantern',assetRef:'prop:lantern',x:990,y:275,width:90,height:120,zIndex:20,motion:'none',color:'#d7ad67'});
const line=(speaker:string,text:string,characterKey?:string):CanvasDialogueLine=>({id:randomUUID(),speaker,text,characterKey,voice:speaker==='Bà chủ'?'preset:ngoc-huyen':'preset:anh-khoi',emotion:speaker==='Người kể'?'storytelling':'gentle'});
const scene=(name:string,durationMs:number,objects:CanvasStudioScene['objects'],dialogue:CanvasDialogueLine[],close=false):CanvasStudioScene=>({
  id:randomUUID(),name,durationMs,background:'room',backgroundRef:'bg:room-stilt-house',
  narration:'',visualBrief:'Illustrated mountain story, calm adult proportions and natural acting.',
  camera:{shot:close?'close-up':'medium',motion:'none',focusX:640,focusY:360,zoom:1},
  effects:[],animationBeats:[],objects,dialogue,
});
const minh=actor(false,715),host=actor(true,400),pointing=actor(false,620),moving=actor(false,500),close=actor(false,640,410);
pointing.facing='right';moving.facing='right';close.facing='right';
let project:CanvasStudioProject={version:1,id:randomUUID(),name:'Chiếc đèn ở hiên — thử hoạt ảnh mới',width:1280,height:720,fps:30,
  createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sourcePrompt:'Một câu chuyện ngắn để kiểm tra đối thoại, tay chỉ, phản ứng, di chuyển và nét mặt cận cảnh.',
  scenes:[
    scene('Lời nhờ ở hiên',8000,[host,minh,lantern()],[line('Bà chủ','Minh ơi, chiếc đèn ở hiên cứ rung. Cháu xem giúp bà nhé.','ba-chu'),line('Minh','Vâng, để cháu xem thử.','minh-main')]),
    scene('Nhìn về chiếc đèn',5500,[pointing,lantern()],[line('Người kể','Minh nhìn về chiếc đèn. Một cơn gió lùa qua khe cửa.')]),
    scene('Khựng lại rồi bước tới',5000,[moving,lantern()],[line('Người kể','Tiếng cửa đập khiến Minh giật mình. Anh bước lại kiểm tra.')]),
    scene('Câu trả lời',6500,[close],[line('Minh','Chỉ là gió thôi bà ạ. Đóng cửa lại là chiếc đèn đứng yên.','minh-main')],true),
  ]};
const checkpoint=path.join(directory,'project.partial.json');
try {const saved=JSON.parse(await readFile(checkpoint,'utf8')) as CanvasStudioProject;if(saved.name===project.name)project=saved;} catch {/* first run */}
const narration={provider:createVieneuLocalProvider(),model:'vieneu-v3-turbo',voice:'preset:anh-khoi',speed:.94};
for(const [index,current] of project.scenes.entries()) {
  console.log(`AUDIO ${index+1}/${project.scenes.length}`);
  const prepared=await prepareCanvasProjectAudio({project:{...project,scenes:[current]},narration,autoSound:false});
  project.scenes[index]=prepared.scenes[0]!;
  await writeFile(checkpoint,JSON.stringify(project,null,2));
}
const targetActor=(index:number)=>project.scenes[index]!.objects.find(object=>object.kind==='character')!;
targetActor(1).facing='right';
project.scenes[1]!.animationBeats!.push({id:'demo-point',action:'point',atMs:1000,durationMs:2400,targetIds:[targetActor(1).id],intensity:.5});
project.scenes[2]!.animationBeats!.push({id:'demo-react',action:'react',atMs:300,durationMs:900,targetIds:[targetActor(2).id],intensity:.35},{id:'demo-run',action:'run',atMs:1700,durationMs:1800,targetIds:[targetActor(2).id],intensity:.4});
targetActor(2).keyframes=[{atMs:0,dx:0},{atMs:1600,dx:0},{atMs:3500,dx:170,easing:'ease-in-out'},{atMs:5000,dx:170}];
await writeFile(path.join(directory,'project.json'),JSON.stringify(project,null,2));
let previous=-1;
const result=await renderCanvasAnimationProject(project,undefined,progress=>{const percent=Math.floor(progress*10)*10;if(percent!==previous){previous=percent;console.log(`RENDER ${percent}%`);}});
const target=path.join(directory,'chiec-den-hoat-anh-moi.mp4');await copyFile(result.path,target);
console.log(`VIDEO=${target}`);process.exit(0);
