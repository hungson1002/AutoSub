import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createCanvasProject } from '../../shared/canvasAnimationStudio';
import { compileCanvasProjectLayout } from '../../shared/canvasLayoutCompiler';
import { synchronizeCanvasPerformance } from '../../shared/canvasPerformance';
import { animationRenderSourceSignature } from './animationRenderSource';

test('a validated Canvas cache completes a queued job without waiting for browser memory', {timeout:15000}, async () => {
  const cacheWorkdir=path.resolve('tmp',`canvas-cache-regression-${randomUUID()}`);
  const priorWorkdir=process.env.AUTOSUB_WORKDIR,priorMemory=process.env.AUTOSUB_RENDER_MIN_FREE_MB;
  await mkdir(cacheWorkdir,{recursive:true});
  process.env.AUTOSUB_WORKDIR=cacheWorkdir;
  // Deliberately unattainable: a cache hit must finish before this gate.
  process.env.AUTOSUB_RENDER_MIN_FREE_MB='999999';
  try {
    const {run}=await import('./ffmpeg');
    const {findCachedCanvasAnimationRender,enqueueCanvasAnimationProjectRender,getAnimationRenderJob}=await import('./animationRender');
    const project={...createCanvasProject(),width:320,height:180,fps:24,sourcePrompt:'',
      scenes:[{id:randomUUID(),name:'Still',durationMs:1000,background:'paper' as const,objects:[]}]};
    const prepared=compileCanvasProjectLayout(structuredClone(project));
    prepared.scenes.forEach(synchronizeCanvasPerformance);
    const sourceSignature=await animationRenderSourceSignature(process.cwd());
    const normalized={...prepared,createdAt:'',updatedAt:''};
    const hash=createHash('sha256').update(JSON.stringify({project:normalized,engine:'canvas-direct-v17-cinematic',sourceSignature})).digest('hex');
    const directory=path.join(cacheWorkdir,'animation-render-cache');
    await mkdir(directory,{recursive:true});
    const cached=path.join(directory,`${hash}.mp4`);
    await run('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=black:s=320x180:r=24:d=1','-c:v','libx264','-pix_fmt','yuv420p',cached]);
    assert.equal((await findCachedCanvasAnimationRender(project))?.path,cached);
    assert.equal(await findCachedCanvasAnimationRender({...project,name:'Changed story'}),undefined,'changed content must not reuse the old cache');
    const job=await enqueueCanvasAnimationProjectRender(project.id,project);
    let status=getAnimationRenderJob(job.id);
    for(let n=0;n<100&&status.status==='queued';n++){
      await new Promise(resolve=>setTimeout(resolve,25));status=getAnimationRenderJob(job.id);
    }
    assert.equal(status.status,'completed');
    assert.equal(status.progress,100);
    assert.equal(status.cached,true);
    assert.equal(status.result?.path,cached);
    const saved=JSON.parse(await readFile(path.join(cacheWorkdir,'animation-render-jobs',job.id,'job.json'),'utf8'));
    assert.equal(saved.status,'completed');
  } finally {
    if(priorWorkdir===undefined)delete process.env.AUTOSUB_WORKDIR;else process.env.AUTOSUB_WORKDIR=priorWorkdir;
    if(priorMemory===undefined)delete process.env.AUTOSUB_RENDER_MIN_FREE_MB;else process.env.AUTOSUB_RENDER_MIN_FREE_MB=priorMemory;
    assert.ok(cacheWorkdir.startsWith(path.resolve('tmp')+path.sep));
    await rm(cacheWorkdir,{recursive:true,force:true});
  }
});
