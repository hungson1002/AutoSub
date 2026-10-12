import {bundle} from '@remotion/bundler';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {vectorTrackTiming} from '../../shared/canvasVectorScene';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {CanvasStudioProject} from '../../shared/canvasAnimationStudio';
import {canvasExportFramePlan} from '../../shared/canvasAnimationStudio';
import {getAnimationAssetFile} from './animationAssets';
import {resolveMediaCommand,run} from './ffmpeg';

let bundleCache:{signature:string;promise:Promise<string>}|undefined;
function renderBundle(signature:string){
  if(bundleCache?.signature===signature)return bundleCache.promise;
  const root=fileURLToPath(new URL('../..',import.meta.url));
  const promise=bundle({entryPoint:path.join(root,'src/canvasAnimationStudio/renderEntry.ts'),rootDir:root,publicDir:null,ignoreRegisterRootWarning:true});
  bundleCache={signature,promise};promise.catch(()=>{if(bundleCache?.promise===promise)bundleCache=undefined;});
  return promise;
}

/** Sample the actual export renderer; review includes endpoints and acting changes. */
export async function renderCanvasPreviewFrames(project:CanvasStudioProject,directory:string,options:{signature:string;executable:string;assetOrigin:string;labelFrames?:boolean;saveFrames?:boolean}){
  const folder=await renderBundle(options.signature);
  await mkdir(directory,{recursive:true});
  const browser=await chromium.launch({executablePath:options.executable,headless:true,args:['--disable-background-networking','--renderer-process-limit=1','--no-first-run']});
  try{
    const page=await browser.newPage({viewport:{width:project.width,height:project.height}});
    await page.route(options.assetOrigin+'/__canvas_render__/**',async route=>{
      const relative=new URL(route.request().url()).pathname.replace('/__canvas_render__/','')||'index.html';
      const file=path.resolve(folder,relative);
      if(!file.startsWith(path.resolve(folder)+path.sep)){await route.abort();return;}
      await route.fulfill({body:await readFile(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'application/octet-stream'});
    });
    await page.goto(options.assetOrigin+'/__canvas_render__/index.html');
    await page.waitForFunction(()=>Boolean((globalThis as any).autosubCanvasRender),{},{timeout:120000});
    await page.evaluate(async({project,origin})=>{await (globalThis as any).autosubCanvasRender.setup(project,origin);},{project,origin:options.assetOrigin});
    const sheets:Array<{sceneId:string;file:string;times:number[];frameFiles?:string[]}>=[];
    const thumbWidth=240,thumbHeight=Math.round(thumbWidth*project.height/project.width);
    const gutter=options.labelFrames?12:0,labelHeight=options.labelFrames?22:0,cellWidth=thumbWidth+gutter,cellHeight=thumbHeight+gutter+labelHeight;
    for(const [index,scene] of project.scenes.entries()){
      const beatTimes=(scene.vectorBeats||[]).flatMap(beat=>{
        const {start}=vectorTrackTiming({target:'',start:0,end:1,cue:beat.cue,frames:[]},scene);
        return [start,Math.min(scene.durationMs,start+Math.min(700,scene.durationMs*.1))];
      });
      const candidates=[0,scene.durationMs*.92,...beatTimes,...(scene.vectorScene?.tracks||[]).flatMap(track=>{
        const {start,end}=vectorTrackTiming(track,scene);
        return track.frames.map(key=>start+(end-start)*key.t);
      })].map(t=>Math.max(0,Math.min(scene.durationMs-1000/project.fps,t))).sort((a,b)=>a-b);
      const unique=[...new Set(candidates.map(t=>Math.round(t/1000*project.fps)))];
      const priority=[...new Set([0,...beatTimes].map(t=>Math.max(0,Math.min(Math.round((scene.durationMs-1000/project.fps)/1000*project.fps),Math.round(t/1000*project.fps)))))];
      const selected=new Set(priority.length<=8?priority:Array.from({length:8},(_,i)=>priority[Math.round(i*(priority.length-1)/7)]!));
      selected.add(unique.at(-1)!);
      const slots=9-selected.size;
      for(let i=0;i<slots;i++)selected.add(unique[Math.round((i+1)*(unique.length-1)/(slots+1))]!);
      const frames=unique.length<=9?unique:[...selected].sort((a,b)=>a-b);
      const images:Array<{input:Buffer;left:number;top:number}>=[];
      const frameFiles:string[]=[];
      for(const [i,frame] of frames.entries()){
        let png:Buffer;
        if(scene.vectorScene){
          await page.evaluate(({index,frame})=>(globalThis as any).autosubCanvasRender.nativeFrame(index,frame),{index,frame});
          png=await page.screenshot({type:'png'});
        }else{
          const frames=await page.evaluate(({index,frame})=>(globalThis as any).autosubCanvasRender.frames(index,frame,1) as string[],{index,frame});
          png=Buffer.from(frames[0]!,'base64');
        }
        if(options.saveFrames){const file=path.join(directory,scene.id+`-frame-${i}.png`);await writeFile(file,png);frameFiles.push(file);}
        const input=await sharp(png).resize(thumbWidth,thumbHeight).png().toBuffer();
        const left=(i%3)*cellWidth,top=Math.floor(i/3)*cellHeight;
        images.push({input,left,top:top+labelHeight});
        if(labelHeight)images.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="22"><rect width="240" height="22" fill="#e6e9ed"/><text x="8" y="16" font-family="Arial" font-size="13" fill="#111">FRAME ${i+1} | ${(frame/project.fps).toFixed(2)} s</text></svg>`),left,top});
      }
      const file=path.join(directory,scene.id+'.png');
      await sharp({create:{width:cellWidth*3,height:cellHeight*Math.ceil(frames.length/3),channels:3,background:options.labelFrames?'#a7adb5':'#151922'}}).composite(images).png().toFile(file);
      sheets.push({sceneId:scene.id,file,times:frames.map(frame=>frame/project.fps*1000),...(options.saveFrames?{frameFiles}:{})});
    }
    await writeFile(path.join(directory,'samples.json'),JSON.stringify(sheets,null,2));
    return sheets;
  }finally{await browser.close();}
}

export function canvasFramePlan(project:CanvasStudioProject){
  return canvasExportFramePlan(project);
}

/** Identical Canvas renderer, lossless PNG transport, fixed authored frame time.
 * One-frame streaming plus FFmpeg backpressure keeps long renders memory-bounded. */
export async function renderCanvasFast(project:CanvasStudioProject,output:string,options:{signature:string;executable:string;assetOrigin:string;preset:string;onProgress?:(n:number)=>void;signal?:AbortSignal}){
  options.signal?.throwIfAborted();
  const folder=await renderBundle(options.signature);
  options.signal?.throwIfAborted();
  const browser=await chromium.launch({
    executablePath:options.executable,
    headless:true,
    args:[
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-dev-shm-usage',
      '--renderer-process-limit=1',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const silent=output+'.silent.mp4';
  let encoder:ReturnType<typeof spawn>|undefined;
  let completion:Promise<void>|undefined;
  let encoderError:Error|undefined;
  const abort=()=>{encoder?.kill();void browser.close().catch(()=>undefined);};
  options.signal?.addEventListener('abort',abort,{once:true});
  try{
    options.signal?.throwIfAborted();
    const page=await browser.newPage({viewport:{width:project.width,height:project.height}});
    // One ephemeral headless renderer; no user profiles, tabs or accounts.
    await page.route(options.assetOrigin+'/__canvas_render__/**',async route=>{
      const relative=new URL(route.request().url()).pathname.replace('/__canvas_render__/','')||'index.html';
      const file=path.resolve(folder,relative);
      if(!file.startsWith(path.resolve(folder)+path.sep)){await route.abort();return;}
      await route.fulfill({body:await readFile(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'application/octet-stream'});
    });
    await page.goto(options.assetOrigin+'/__canvas_render__/index.html');
    await page.waitForFunction(()=>Boolean((globalThis as any).autosubCanvasRender),{},{timeout:120000});
    await page.evaluate(async({project,origin})=>{await (globalThis as any).autosubCanvasRender.setup(project,origin);},{project,origin:options.assetOrigin});
    encoder=spawn(await resolveMediaCommand('ffmpeg'),['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(project.fps),'-i','pipe:0','-an','-c:v','libx264','-preset',options.preset,'-crf','21','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',silent],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let stderr='';encoder.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8000);});
    encoder.stdin?.on('error',error=>{encoderError=error;});
    completion=new Promise((resolve,reject)=>{
      encoder!.on('error',reject);encoder!.on('close',code=>code===0?resolve():reject(new Error(`Canvas encoder failed (${code}): ${stderr}`)));
    });
    // Handle early process rejection while frames are still being drawn.
    void completion.catch(error=>{encoderError=error;});
    const frames=canvasFramePlan(project),total=frames.reduce((a,b)=>a+b,0);let done=0;
    for(let scene=0;scene<frames.length;scene++)for(let start=0;start<frames[scene]!;start+=1){
      options.signal?.throwIfAborted();
      if(encoderError)throw encoderError;
      const count=1;
      const sourceFrames=Math.max(1,Math.round(project.scenes[scene]!.durationMs/1000*project.fps));
      const batch=await page.evaluate(({scene,start,count})=>(globalThis as any).autosubCanvasRender.frames(scene,start,count) as string[],{scene,start:start*sourceFrames/frames[scene]!,count});
      for(const png of batch){
        if(encoderError)throw encoderError;
        if(!encoder.stdin!.write(Buffer.from(png,'base64')))await once(encoder.stdin!,'drain');
      }
      done+=count;options.onProgress?.(done/total*.93);
    }
    encoder.stdin!.end();await completion;
    await page.evaluate(()=>{ try{(globalThis as any).autosubCanvasRender?.cleanup?.();}catch{} });
    await page.close();
    await browser.close();
    if(project.scenes.some(s=>s.audioUrl)){
      const inputs:string[]=[],filters:string[]=[];
      for(let i=0;i<project.scenes.length;i++){
        const scene=project.scenes[i]!,duration=frames[i]!/project.fps;
        const id=scene.audioUrl?.match(/^\/api\/animation-studio\/assets\/([a-f0-9-]{36})\/file$/i)?.[1];
        if(scene.audioUrl&&!id)throw new Error('Direct Canvas render requires retained local audio assets.');
        if(id)inputs.push('-i',(await getAnimationAssetFile(id)).path);
        else inputs.push('-f','lavfi','-t',String(duration),'-i','anullsrc=r=48000:cl=stereo');
        const rate=Math.max(1,Math.round(scene.durationMs/1000*project.fps))/frames[i]!;
        filters.push(`[${i+1}:a]aresample=48000,aformat=channel_layouts=stereo,atempo=${rate},apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);
      }
      filters.push(`${frames.map((_,i)=>`[a${i}]`).join('')}concat=n=${frames.length}:v=0:a=1[audio]`);
      await run('ffmpeg',['-v','error','-y','-i',silent,...inputs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(total/project.fps),'-movflags','+faststart',output],options.signal);
    }else{
      await run('ffmpeg',['-v','error','-y','-i',silent,'-c','copy','-movflags','+faststart',output],options.signal);
    }
    options.onProgress?.(1);
  }finally{
    options.signal?.removeEventListener('abort',abort);
    encoder?.stdin?.destroy();if(encoder&&encoder.exitCode===null)encoder.kill();
    await completion?.catch(()=>undefined);await browser.close();await rm(silent,{force:true});
  }
}
