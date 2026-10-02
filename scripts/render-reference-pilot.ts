import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createCanvasProject,createCanvasScene,createCanvasObject} from '../shared/canvasAnimationStudio';
import {compileCanvasProjectLayout} from '../shared/canvasLayoutCompiler';
import {professionalizeCanvasProject} from '../server/services/canvasProfessionalAssets';
import {animateProfessionalCanvasActors} from '../server/services/canvasProfessionalSprites';
import {renderCanvasAnimationProject,validateAnimationOutput} from '../server/services/animationRender';
import {run,workdir} from '../server/services/ffmpeg';
const dir=path.join(workdir,'reference-pilot');await mkdir(dir,{recursive:true});
const state=async(stage:string,extra:object={})=>{await writeFile(path.join(dir,'state.json'),JSON.stringify({stage,updatedAt:new Date().toISOString(),...extra},null,2));console.log(stage);};
const config={enabled:true,quality:'professional' as const,generator:'flow-agent' as const,model:'narwhal'};
try {
 let project;try{project=JSON.parse(await readFile(path.join(dir,'acted.json'),'utf8'));}catch{
 let visual;try{visual=JSON.parse(await readFile(path.join(dir,'visual.json'),'utf8'));}catch{
 const p=createCanvasProject();p.name='Bạch Đằng — bản kiểm tra diễn xuất';p.scenes=[];
 const actor=createCanvasObject('character',{id:'narrator',label:'Người dẫn',characterKey:'reference-narrator',assetRef:'character:narrator',archetype:'narrator',hair:'bun',pose:'talk',expression:'happy',slot:'hero-left',depth:'midground',sizeClass:'hero',motion:'none',color:'#cf773b',designNotes:'Vietnamese chibi narrator, huge head about 45 percent of total height, very short body and legs, round expressive eyes, black topknot, dusty orange traditional robe, fan in right hand, bold organic dark ink contour, flat muted earthy color.'});
 const s=createCanvasScene();s.durationMs=4000;s.name='01 Câu hỏi trên bờ';s.template='hero-left';s.background='river';s.backgroundRef='bg:river-establishing';s.visualBrief='Chibi historical Vietnamese river bank, foreground solid sandy bank occupies lower half for narrator feet, a gently curving blue-gray river in distant right, layered sage hills, warm off-white sky, flat earthy colors, strong organic dark ink lines, no people or boats painted into background. Left foreground reserved for a large narrator, ground visible under his feet.';s.objects=[actor];s.effects=[];s.camera={shot:'medium',motion:'push-in',focusX:420,focusY:400,zoom:1};s.animationBeats=[{id:'talk1',action:'talk',targetIds:['narrator'],atMs:300,durationMs:3000}];
 const ship=createCanvasObject('ship',{id:'ship',label:'Thuyền chiến',assetRef:'ship:historical-warship',slot:'mid-right',depth:'midground',sizeClass:'hero',motion:'drift-left',motionDurationMs:3000,designNotes:'Side view ancient Vietnamese wooden warship, broad curved brown plank hull, square dusty-red sail, bamboo mast, thick black hand-drawn contours, simple chibi proportions, readable silhouette. No crew, no background or sea.'});
 const stake=createCanvasObject('stake',{id:'stake',label:'Cọc gỗ',assetRef:'stake:timber',slot:'foreground-left',depth:'foreground',sizeClass:'large',motion:'pop',delayMs:1000,designNotes:'Single rough sharpened dark brown timber stake, diagonal pointed tip, visible natural grain, bold ink contour, muted flat color.'});
 const t=createCanvasScene(1);t.durationMs=4000;t.name='02 Thuyền và bãi cọc';t.template='foreground-pov';t.background='river';t.backgroundRef='bg:river-establishing';t.visualBrief='Low view across Bạch Đằng river, blue-gray flat water dominates lower two thirds, distant sage shoreline, muted off-white sky, strong organic ink contours; no ships or stakes baked into the background. Free center and right for one large ship and foreground left for sharpened stakes.';t.objects=[ship,stake];t.camera={shot:'wide',motion:'none',focusX:640,focusY:360,zoom:1};t.animationBeats=[{id:'stake-reveal',action:'reveal',targetIds:['stake'],atMs:1200,durationMs:900},{id:'collision',action:'impact',targetIds:['ship'],atMs:2600,durationMs:800}];t.effects=[{id:'splash',type:'splash',x:650,y:520,scale:1.2,intensity:1,startMs:2600,durationMs:900,zIndex:30}];p.scenes=[s,t];
 await state('generating-art');visual=await professionalizeCanvasProject(compileCanvasProjectLayout(p),'Chibi Vietnamese historical explainer, big heads short bodies thick organic contours muted earthy flat colors.',config);
 await writeFile(path.join(dir,'visual.json'),JSON.stringify(visual,null,2));
 }
 await state('generating-acting');project=await animateProfessionalCanvasActors(visual,config);await writeFile(path.join(dir,'acted.json'),JSON.stringify(project,null,2));}
 await state('rendering');const result=await renderCanvasAnimationProject(project);const metadata=await validateAnimationOutput(result.path);const sheet=path.join(dir,'contact.jpg');await run('ffmpeg',['-y','-i',result.path,'-vf','fps=2,scale=320:180,tile=4x4','-frames:v','1',sheet]);await state('completed',{result,metadata,sheet});
}catch(e){await state('failed',{error:e instanceof Error?e.stack:String(e)});process.exitCode=1;}
