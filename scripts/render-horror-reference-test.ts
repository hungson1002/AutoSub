import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import { compileSimpleHorrorStaging } from '../server/services/canvasAnimationDirector';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { run } from '../server/services/ffmpeg';

const now = new Date().toISOString();
const stableIds={minh:'actor:minh',panh:'actor:panh',fire:'prop:fire-main',door:'prop:door-main',ghost:'prop:ghost-main'};
const actor=(label:string,key:string,slot:string,color:string,extra:any={})=>({
  id:(stableIds as any)[key]||`actor:${key}`,kind:'character',label,characterKey:key,archetype:key==='minh'?'worker':'villager',
  hair:key==='minh'?'short':'hat',role:'focal',slot,depth:'midground',sizeClass:'large',
  pose:'idle',expression:'neutral',facing:slot.includes('left')?'right':'left',
  x:640,y:360,width:210,height:380,scale:1,rotation:0,opacity:1,color,secondaryColor:'#4b5050',
  accent:'#272421',zIndex:30,motion:'none',delayMs:0,motionDurationMs:500,motionCurve:'smooth',motionIntensity:1,
  visualStyle:'horror',...extra
});
const prop=(variant:string,label:string,slot:string,sizeClass='medium',extra:any={})=>({
  id:(stableIds as any)[variant]||`prop:${variant}`,kind:'prop',variant,assetRef:'prop:'+variant,label,role:'focal',slot,depth:'midground',sizeClass,
  x:640,y:360,width:180,height:180,scale:1,rotation:0,opacity:1,color:'#7c654e',secondaryColor:'#4f443a',
  accent:'#272421',zIndex:25,motion:'none',delayMs:0,motionDurationMs:500,motionCurve:'smooth',motionIntensity:1,...extra
});
const scene=(name:string,durationMs:number,template:string,background:string,backgroundRef:string,objects:any[],camera:any,narration:string,effects:any[]=[]):any=>({
  id:randomUUID(),name,durationMs,template,background,backgroundRef,
  narration,dialogue:[],visualBrief:'truyện ma kinh dị Ma Xó, tối giản, im lặng, căng thẳng, giữ continuity không gian',
  camera,effects,animationBeats:[],objects
});
const roomCast=()=>[
  actor('Minh','minh','hero-left','#596d78'),
  actor('Ông Panh','panh','hero-right','#7a604e'),
  prop('fire','Bếp lửa','mid-center','medium',{role:'support'}),
];
const project:any={
  version:1,id:randomUUID(),name:'Horror spatial continuity test',width:1280,height:720,fps:30,
  createdAt:now,updatedAt:now,sourcePrompt:'truyện ma kinh dị trong cùng một nhà sàn, ưu tiên spatial continuity và vị trí nhân vật nhất quán',
  scenes:[
    scene('Hai người bên bếp',4200,'two-shot','room','bg:room-stilt-house',roomCast(),
      {shot:'medium',motion:'none',zoom:1,keyframes:[{atMs:0,zoom:1},{atMs:4200,zoom:1.025,easing:'ease-in-out'}]},
      'Minh đứng bên trái bếp, ông Panh ở bên phải. Căn phòng giữ nguyên bố cục.',
      [{id:randomUUID(),type:'vignette',intensity:.7}]
    ),
    scene('Thêm chiếc đèn',4200,'two-shot','room','bg:room-stilt-house',[
      ...roomCast(),
      prop('lantern','Đèn dầu','support-left','small',{role:'support'}),
    ],{shot:'medium',motion:'none',zoom:1.08,keyframes:[{atMs:0,zoom:1.08},{atMs:4200,zoom:1.1,easing:'ease-in-out'}]},
      'Một chiếc đèn dầu được đặt thêm trong căn phòng. Minh, ông Panh và bếp vẫn giữ nguyên vị trí.',
      [{id:randomUUID(),type:'vignette',intensity:.72}]
    ),
    scene('Có thêm người bước vào',4200,'two-shot','room','bg:room-stilt-house',[
      ...roomCast(),
      prop('lantern','Đèn dầu','support-left','small',{role:'support'}),
      actor('Bà Lý','ly','background-right','#665748',{role:'support',sizeClass:'small'}),
    ],{shot:'wide',motion:'none',zoom:.98,keyframes:[{atMs:0,zoom:.98},{atMs:4200,zoom:1.01,easing:'ease-in-out'}]},
      'Bà Lý xuất hiện ở phía sau. Hai người cũ và bếp không được nhảy vị trí chỉ vì có thêm nhân vật.',
      [{id:randomUUID(),type:'vignette',intensity:.74}]
    ),
    scene('Minh nhìn về cửa',4600,'foreground-pov','room','bg:room-stilt-house',[
      actor('Minh','minh','foreground-left','#596d78',{role:'support',sizeClass:'large',expression:'afraid'}),
      prop('door','Cửa tối','mid-center','hero',{role:'focal',doorOpen:.16}),
    ],{shot:'pov',motion:'none',zoom:1.02,keyframes:[{atMs:0,zoom:1.02},{atMs:4600,zoom:1.07,easing:'ease-in-out'}]},
      'Bây giờ câu chuyện thật sự cắt sang cánh cửa tối, nên đổi góc máy là có chủ đích.',
      [{id:randomUUID(),type:'vignette',intensity:.84}]
    ),
    scene('Bóng dưới sàn',5000,'close-reaction','room','bg:room-underfloor',[
      actor('Minh','minh','hero-left','#596d78',{expression:'afraid'}),
      prop('ghost','Bóng người','background-center','large',{role:'support',opacity:.74,color:'#151718',accent:'#151718'}),
    ],{shot:'medium',motion:'none',zoom:1.02,keyframes:[{atMs:0,zoom:1.02},{atMs:5000,zoom:1.065,easing:'ease-in-out'}]},
      'Cảnh mới thật sự ở gầm nhà sàn, nên đổi không gian là hợp lý.',
      [{id:randomUUID(),type:'vignette',intensity:.9}]
    )
  ]
};
const stagedProject=compileSimpleHorrorStaging(compileCanvasProjectLayout(compileSimpleHorrorStaging(project)));
let lastProgressBucket=-1;
const result=await renderCanvasAnimationProject(stagedProject,undefined,p=>{
  const bucket=Math.floor(Math.max(0,Math.min(1,p))*10);
  if(bucket!==lastProgressBucket){lastProgressBucket=bucket;console.log('progress',bucket*10);}
});
const qaDir=path.resolve('workdir/qa-tests');
await mkdir(qaDir,{recursive:true});
const out=path.join(qaDir,'horror-continuity-test-v17.mp4');
await copyFile(result.path,out);
const contact=path.join(qaDir,'horror-reference-contact.jpg');
await run('ffmpeg',['-y','-i',out,'-vf','fps=1/5,scale=320:-1,tile=3x2:padding=4:margin=4','-frames:v','1',contact]);
console.log(JSON.stringify({out,contact,source:result.path,size:result.size,cached:result.cached,projectId:project.id},null,2));
