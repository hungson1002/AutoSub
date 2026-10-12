// Native scenery/cast capability preview, using the production parser and SVG
// renderer. This is a deterministic scene preview, not an AI-generation test.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {parseVectorPlan} from '../server/services/canvasVectorDirector';
import {VectorSceneFrame} from '../src/remotion/VectorSceneFrame';
Object.assign(globalThis,{React});
const out=path.resolve('tmp/vector-wide-crowd');await mkdir(out,{recursive:true});
const cast:Record<string,unknown>={};
const variations=[
  {hair:'side-part',outfit:'tunic',gender:'male',shirt:'#395f7c',accent:'#aa8355'},
  {hair:'short',outfit:'robe',gender:'male',age:'elder',facialHair:'beard',shirt:'#82704b',accent:'#b09b69',hairColor:'#b8b5aa'},
  {hair:'bun',outfit:'ao-dai',gender:'female',shirt:'#9b657b',accent:'#d8b991'},
  {hair:'cropped',outfit:'vest',gender:'male',headwear:'conical',shirt:'#657750',accent:'#968761'},
  {hair:'tied',outfit:'shawl',gender:'female',age:'elder',shirt:'#73658b',accent:'#a88b9c',hairColor:'#b3b0a7'},
  {hair:'wavy',outfit:'vest',gender:'male',facialHair:'moustache',shirt:'#695f51',accent:'#756d54'},
  {hair:'long',outfit:'ao-dai',gender:'female',shirt:'#4d7b76',accent:'#b5a772'},
  {hair:'double-bun',outfit:'tunic',gender:'female',age:'child',shirt:'#b8874e',accent:'#e0b677'},
  {hair:'bob',outfit:'shawl',gender:'female',shirt:'#a06c58',accent:'#d3aa78'},
];
variations.forEach((v,i)=>{const {shirt,accent,hairColor,...design}=v;
  cast['villager-'+i]={rig:'simple-puppet',design:'village',finish:'handdrawn',...design,
    palette:{shirt,accent,hair:hairColor||'#29292c',skin:i===3?'#cba980':'#efd2af',ink:'#171717',inner:'#e7d6b8',trim:'#cfb482'}};
});
const request={name:'Village market crowd preview',vectorAssets:cast,
  vectorStages:{market:{template:'illustrated-place',place:'village',setting:'market',light:'day',finish:'handdrawn',seed:17,
    cast:{person:'villager-0'},extras:Array.from({length:8},(_,i)=>({id:'extra-'+i,asset:'villager-'+(i+1)}))}},
  scenes:[{name:'Nine villagers at the market',narration:'Villagers gather at the market.',durationMs:3000,vectorScene:{stage:'market'}},
    {name:'Contextual action cut on the same market',narration:'One villager notices something.',durationMs:3000,vectorScene:{stage:'market',shot:{target:'person',height:.28,include:['market-sign']}}}]};
const project=parseVectorPlan(JSON.stringify(request),'Village crowd preview',{width:1280,height:720});
const scene=project.scenes[0]!;
const actors=scene.vectorScene!.nodes.filter(n=>n.type==='instance'&&project.vectorAssets?.[n.asset!]?.nodes.some(p=>p.id==='puppet-root'));
if(actors.length!==9)throw new Error('Expected nine distinct villagers');
const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:400,width:1280,height:720}));
const png=path.join(out,'AutoSub_CanhChoLang_ToanCanh_9Nguoi.png');
await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).png().toFile(png);
await writeFile(path.join(out,'project.json'),JSON.stringify(project,null,2));
await writeFile(path.join(out,'request.json'),JSON.stringify(request,null,2));
const destination=path.join(process.env.USERPROFILE!,'Downloads',path.basename(png));await copyFile(png,destination);
const closeHtml=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:project.scenes[1]!,timeMs:400,width:1280,height:720}));
await sharp(Buffer.from(closeHtml.match(/<svg[\s\S]*?<\/svg>/)![0])).png().toFile(path.join(out,'closer-same-market.png'));
console.log(JSON.stringify({people:actors.length,nodes:scene.vectorScene!.nodes.length,image:destination}));
