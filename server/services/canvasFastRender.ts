import {bundle} from '@remotion/bundler';
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {CanvasStudioProject} from '../../shared/canvasAnimationStudio';
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

export function canvasFramePlan(project:CanvasStudioProject){
  return project.scenes.map(scene=>Math.max(1,Math.round(Math.max(1,scene.durationMs)/1000*project.fps)));
}

/** Identical Canvas renderer, lossless PNG transport, fixed authored frame time.
 * Batches are bounded to four frames and FFmpeg backpressure limits memory. */
export async function renderCanvasFast(project:CanvasStudioProject,output:string,options:{signature:string;executable:string;assetOrigin:string;preset:string;onProgress?:(n:number)=>void}){
  const folder=await renderBundle(options.signature);
  const browser=await chromium.launch({executablePath:options.executable,headless:true});
  const silent=output+'.silent.mp4';
  let encoder:ReturnType<typeof spawn>|undefined;
  let completion:Promise<void>|undefined;
  let encoderError:Error|undefined;
  try{
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
    encoder=spawn(await resolveMediaCommand('ffmpeg'),['-hide_banner','-loglevel','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(project.fps),'-i','pipe:0','-an','-c:v','libx264','-preset',options.preset,'-crf','21','-pix_fmt','yuv420p','-threads','2','-movflags','+faststart',silent],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let stderr='';encoder.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8000);});
    encoder.stdin?.on('error',error=>{encoderError=error;});
    completion=new Promise((resolve,reject)=>{
      encoder!.on('error',reject);encoder!.on('close',code=>code===0?resolve():reject(new Error(`Canvas encoder failed (${code}): ${stderr}`)));
    });
    // Handle early process rejection while frames are still being drawn.
    void completion.catch(error=>{encoderError=error;});
    const frames=canvasFramePlan(project),total=frames.reduce((a,b)=>a+b,0);let done=0;
    for(let scene=0;scene<frames.length;scene++)for(let start=0;start<frames[scene]!;start+=4){
      if(encoderError)throw encoderError;
      const count=Math.min(4,frames[scene]!-start);
      const batch=await page.evaluate(({scene,start,count})=>(globalThis as any).autosubCanvasRender.frames(scene,start,count) as string[],{scene,start,count});
      for(const png of batch){
        if(encoderError)throw encoderError;
        if(!encoder.stdin!.write(Buffer.from(png,'base64')))await once(encoder.stdin!,'drain');
      }
      done+=count;options.onProgress?.(done/total*.93);
    }
    encoder.stdin!.end();await completion;
    if(project.scenes.some(s=>s.audioUrl)){
      const inputs:string[]=[],filters:string[]=[];
      for(let i=0;i<project.scenes.length;i++){
        const scene=project.scenes[i]!,duration=frames[i]!/project.fps;
        const id=scene.audioUrl?.match(/^\/api\/animation-studio\/assets\/([a-f0-9-]{36})\/file$/i)?.[1];
        if(scene.audioUrl&&!id)throw new Error('Direct Canvas render requires retained local audio assets.');
        if(id)inputs.push('-i',(await getAnimationAssetFile(id)).path);
        else inputs.push('-f','lavfi','-t',String(duration),'-i','anullsrc=r=48000:cl=stereo');
        filters.push(`[${i+1}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);
      }
      filters.push(`${frames.map((_,i)=>`[a${i}]`).join('')}concat=n=${frames.length}:v=0:a=1[audio]`);
      await run('ffmpeg',['-v','error','-y','-i',silent,...inputs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(total/project.fps),'-movflags','+faststart',output]);
    }else{
      await run('ffmpeg',['-v','error','-y','-i',silent,'-c','copy','-movflags','+faststart',output]);
    }
    options.onProgress?.(1);
  }finally{
    encoder?.stdin?.destroy();if(encoder&&encoder.exitCode===null)encoder.kill();
    await completion?.catch(()=>undefined);await browser.close();await rm(silent,{force:true});
  }
}
