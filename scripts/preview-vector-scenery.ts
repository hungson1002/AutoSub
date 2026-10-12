// Inspect the reusable scene components through the production parser/renderer.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {parseVectorPlan} from '../server/services/canvasVectorDirector';
import {VectorSceneFrame} from '../src/remotion/VectorSceneFrame';
Object.assign(globalThis,{React});
const out=process.argv[2]||'tmp/vector-scenery/after';await mkdir(out,{recursive:true});
const images:Buffer[]=[];
for(const place of ['village','forest','waterside','rural-interior']){
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',design:'village',hair:'side-part',outfit:'tunic'}},
    vectorStages:{location:{template:'illustrated-place',place,light:'night',finish:'handdrawn',seed:17,
      ...(place==='village'?{view:'elevated'}:{}),cast:{person:'hero'}}},
    scenes:[{narration:'Kiểm tra bố cục cảnh.',durationMs:2000,vectorScene:{stage:'location'}}]}),'truyện ma ban đêm',{width:1280,height:720});
  const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:p.scenes[0]!,timeMs:0,width:1280,height:720}));
  const png=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).png().toBuffer();
  await writeFile(`${out}/${place}.png`,png);await writeFile(`${out}/${place}.json`,JSON.stringify(p,null,2));
  images.push(await sharp(png).resize(640,360).png().toBuffer());
}
await sharp({create:{width:1280,height:720,channels:4,background:'#fff'}}).composite(images.map((input,i)=>({input,left:i%2*640,top:Math.floor(i/2)*360}))).png().toFile(out+'/overview.png');
console.log(out+'/overview.png');
