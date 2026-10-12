// Technical preview of the actual Studio character factory and SVG renderer.
// This is a cast acceptance sheet, not an AI-authored film.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import sharp from 'sharp';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createCanvasProject} from '../shared/canvasAnimationStudio';
import {normalizeVectorAssets,normalizeVectorScene,compileVectorProject} from '../shared/canvasVectorScene';
import {VectorSceneFrame} from '../src/remotion/VectorSceneFrame';
Object.assign(globalThis,{React});
const cast=[
  {gender:'male',hair:'side-part',outfit:'tunic',palette:{shirt:'#294e76'}},
  {gender:'female',hair:'bun',outfit:'ao-dai',palette:{shirt:'#ce787c'}},
  {gender:'male',hair:'wavy',outfit:'robe',expression:'neutral',palette:{shirt:'#75533c',skin:'#d2a177'}},
  {gender:'female',hair:'braid',outfit:'ao-dai',palette:{shirt:'#c59b4b',skirt:'#493344'}},
  {age:'child',gender:'male',hair:'short',outfit:'tunic',palette:{shirt:'#36757a'}},
  {age:'child',gender:'female',hair:'double-bun',outfit:'ao-dai',palette:{shirt:'#b9727a'}},
  {age:'elder',gender:'male',hair:'tied',outfit:'tunic',facialHair:'beard',palette:{shirt:'#666348'}},
  {age:'elder',gender:'female',hair:'bun',outfit:'ao-dai',palette:{shirt:'#65515c'}},
  {gender:'male',hair:'short',outfit:'tunic',headwear:'headwrap',expression:'worried',palette:{shirt:'#294e76'}},
  {gender:'female',hair:'tied',outfit:'shawl',palette:{shirt:'#a2a17e',accent:'#9b9c77',skirt:'#926451'}},
  {gender:'male',hair:'tied',outfit:'vest',glasses:true,palette:{shirt:'#eee1c4',accent:'#eee1c4'}},
  {gender:'male',hair:'cropped',outfit:'tunic',palette:{shirt:'#945443',skin:'#d6a078'}},
  {age:'elder',gender:'male',hair:'none',outfit:'robe',headwear:'headwrap',facialHair:'moustache',palette:{shirt:'#6d3e4c',hair:'#343137'}},
  {gender:'female',hair:'bob',outfit:'ao-dai',palette:{shirt:'#a48aac'}},
  {gender:'male',hair:'wavy',outfit:'tunic',expression:'surprised',palette:{shirt:'#717657'}},
  {age:'elder',gender:'female',hair:'bun',outfit:'ao-dai',headwear:'conical',palette:{shirt:'#3e7077',accent:'#c3a47a'}},
];
const output=path.resolve('tmp/vector-village-cast');await mkdir(output,{recursive:true});
const p=createCanvasProject();p.width=1120;p.height=1400;
p.vectorAssets=normalizeVectorAssets(Object.fromEntries(cast.map((s,i)=>['cast-'+i,{rig:'simple-puppet',design:'village',finish:'handdrawn',age:'adult',expression:'soft',...s}])));
const nodes=[{id:'background',type:'rect',width:p.width,height:p.height,fill:'#f5efdc'},
  ...cast.map((s,i)=>({id:'person-'+i,type:'instance',asset:'cast-'+i,x:37+i%4*280,y:25+Math.floor(i/4)*340+(s.headwear==='conical'?18:0),width:207,height:322}))];
p.scenes=[{...p.scenes[0]!,durationMs:4000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:p.width,height:p.height,nodes,
  turns:cast.flatMap((_,i)=>i%4===1?[{actor:'person-'+i,to:'left',hold:true}]:[]),
},p.vectorAssets)}];
const project=compileVectorProject(p);
await writeFile(path.join(output,'project.json'),JSON.stringify(project,null,2));
const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:project.scenes[0]!,timeMs:0,width:p.width,height:p.height}));
const svg=html.match(/<svg[\s\S]*?<\/svg>/)![0];await writeFile(path.join(output,'cast.svg'),svg);
const image=path.join(output,'AutoSub_NhanVat_MiengTheoCanh_Tool.png');await sharp(Buffer.from(svg)).png().toFile(image);
const destination=path.join(process.env.USERPROFILE!,'Downloads',path.basename(image));await copyFile(image,destination);
console.log(destination);

// A deterministic multi-person acceptance scene, rendered by the production
// SVG component. Dialogue timings are a test fixture; no AI film or audio.
const demo=createCanvasProject();demo.width=760;demo.height=370;
demo.vectorAssets=normalizeVectorAssets(Object.fromEntries([0,1,4,6].map((i,j)=>['demo-'+j,{rig:'simple-puppet',design:'village',finish:'handdrawn',age:'adult',...cast[i]}])));
demo.scenes=[{...demo.scenes[0]!,durationMs:4000,narration:'',objects:[],dialogue:[
  {id:'narrator',speaker:'Narrator',text:'The village is quiet.',atMs:0,durationMs:800},
  {id:'line-a',speaker:'An',characterKey:'an',text:'Did you hear that?',atMs:1000,durationMs:900,speechWindows:[{startMs:0,endMs:600}]},
  {id:'line-b',speaker:'Lan',characterKey:'lan',text:'There is someone outside.',atMs:2100,durationMs:900,speechWindows:[{startMs:0,endMs:700}]},
],vectorScene:normalizeVectorScene({width:760,height:370,nodes:[
  {id:'backdrop',type:'rect',width:760,height:370,fill:'#f5efdc'},
  {id:'ground',type:'rect',x:0,y:305,width:760,height:65,fill:'#ded6bd'},
  ...[0,1,2,3].map(i=>({id:'actor-'+i,type:'instance',asset:'demo-'+i,characterKey:['an','lan','child','elder'][i],x:40+i*180,y:60,width:153,height:238})),
],turns:[{actor:'actor-1',to:'left',hold:true}],reactions:[{actor:'actor-0',kind:'fear',start:.8,end:.98}]},demo.vectorAssets)}];
const scene=compileVectorProject(demo).scenes[0]!;
const phases=[{time:200,label:'Narration: everyone listens'}, {time:1150,label:'An speaks; the others listen'},
  {time:2400,label:'Lan speaks; the others listen'}, {time:3500,label:'Silent fear: mouth and sweat express emotion'}];
const panels=await Promise.all(phases.map(async phase=>{
  const markup=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:phase.time,width:760,height:370}));
  const frame=await sharp(Buffer.from(markup.match(/<svg[\s\S]*?<\/svg>/)![0])).png().toBuffer();
  const title=Buffer.from(`<svg width="760" height="40"><rect width="760" height="40" fill="#f5efdc"/><text x="20" y="27" font-family="Arial" font-size="20" fill="#262222">${phase.label}</text></svg>`);
  return sharp({create:{width:760,height:410,channels:4,background:'#f5efdc'}}).composite([{input:title,top:0,left:0},{input:frame,top:40,left:0}]).png().toBuffer();
}));
const demoImage=path.join(output,'AutoSub_NhieuNguoi_Noi_ImLang_Tool.png');
await sharp({create:{width:1520,height:820,channels:4,background:'#f5efdc'}}).composite(panels.map((input,i)=>({input,left:i%2*760,top:Math.floor(i/2)*410}))).png().toFile(demoImage);
const demoDestination=path.join(process.env.USERPROFILE!,'Downloads',path.basename(demoImage));await copyFile(demoImage,demoDestination);console.log(demoDestination);
