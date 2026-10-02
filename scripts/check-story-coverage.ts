import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderStill} from '@remotion/renderer';
import sharp from 'sharp';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
const root=path.resolve('tmp/chiec-den-cuoi-ban-v2'),directory=path.join(root,'frames');await mkdir(directory,{recursive:true});
const project=JSON.parse(await readFile(path.join(root,'project.json'),'utf8')) as CanvasStudioProject;
const silent={...project,scenes:project.scenes.map(scene=>({...scene,audioUrl:undefined}))};
const serveUrl=await bundle(path.resolve('src/remotion/index.tsx'),undefined,{rootDir:process.cwd(),publicDir:null});
const browser=await openBrowser('chrome',{browserExecutable:'C:/Program Files/Google/Chrome/Application/chrome.exe',logLevel:'warn'});
try {
  const inputProps={project:silent,assetOrigin:'http://127.0.0.1:8787'};
  const composition=await selectComposition({serveUrl,id:'AutoSubCanvasAnimation',inputProps,puppeteerInstance:browser,logLevel:'warn'});
  let cursor=0;
  for(const [index,scene] of project.scenes.entries()) {
    const frames=Math.round(scene.durationMs*30/1000),frame=cursor+Math.floor(frames*.55);
    const file=path.join(directory,`${String(index).padStart(2,'0')}.jpg`);
    await renderStill({serveUrl,composition,inputProps,frame,output:file,imageFormat:'jpeg',puppeteerInstance:browser,logLevel:'warn'});
    cursor+=frames;if(index%10===0)console.log(`COVERAGE ${index+1}/${project.scenes.length}`);
  }
  for(let group=0;group<Math.ceil(project.scenes.length/10);group++) {
    const layers=[];
    for(let cell=0;cell<10&&group*10+cell<project.scenes.length;cell++) {
      const index=group*10+cell;
      const input=await sharp(path.join(directory,`${String(index).padStart(2,'0')}.jpg`)).resize(640,360).toBuffer();
      layers.push({input,left:(cell%5)*640,top:Math.floor(cell/5)*385});
      const label=`${index+1}. ${project.scenes[index]!.name.replace(/[&<>]/g,'')}`;
      layers.push({input:Buffer.from(`<svg width="640" height="25"><rect width="640" height="25" fill="#172129"/><text x="12" y="18" fill="#ffffff" font-family="Arial" font-size="15">${label}</text></svg>`),left:(cell%5)*640,top:Math.floor(cell/5)*385+360});
    }
    await sharp({create:{width:3200,height:770,channels:3,background:'#172129'}}).composite(layers).jpeg({quality:85}).toFile(path.join(root,`coverage-${group+1}.jpg`));
  }
} finally {await browser.close({silent:true});}
process.exit(0);
