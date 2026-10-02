import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {compileCanvasProjectLayout} from '../shared/canvasLayoutCompiler';
import {run} from '../server/services/ffmpeg';

const dir=path.resolve('tmp/ma-da-production');await mkdir(dir,{recursive:true});
const baseline=JSON.parse(await readFile('workdir/animation-render-jobs/8daa0438-8e07-47f7-88df-a60215d650ac/job.json','utf8'));
const project=compileCanvasProjectLayout(JSON.parse(await readFile(process.env.CANVAS_QA_PROJECT||'workdir/animation-render-jobs/8daa0438-8e07-47f7-88df-a60215d650ac/project.json','utf8')));
await writeFile(path.join(dir,'project.json'),JSON.stringify(project,null,2));
const start=Date.now();
const response=await fetch(`http://127.0.0.1:8787/api/canvas-animation-studio/projects/${project.id}/render-jobs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({project})});
if(!response.ok)throw new Error(await response.text());
const initial=await response.json();console.log(`JOB=${initial.id}`);
for(let tick=0;tick<1200;tick++){
  await new Promise(r=>setTimeout(r,1000));
  const job=await(await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${initial.id}`)).json();
  if(tick%15===0)console.log(`${job.status} ${job.progress}%`);
  if(job.status==='failed')throw new Error(job.error);if(job.status!=='completed')continue;
  const output=path.join(dir,'ma-da-production.mp4');await copyFile(job.result.path,output);
  const metrics=JSON.parse(await readFile(job.result.path.replace(/\.mp4$/,'.metrics.json'),'utf8').catch(()=>'{}'));
  const duration=project.scenes.reduce((sum:number,s:any)=>sum+s.durationMs,0)/1000;
  await run('ffmpeg',['-v','error','-y','-i',output,'-vf',`fps=1/2,scale=480:270,tile=6x6`,'-frames:v','1',path.join(dir,'overview.png')]);
  await run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
  const result={jobId:job.id,cached:job.cached,elapsedMs:Date.now()-start,renderer:metrics.renderer,renderMs:metrics.elapsedMs,baselineMs:Date.parse(baseline.updatedAt)-Date.parse(baseline.createdAt),durationSeconds:duration,output};
  await writeFile(path.join(dir,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exit(0);
}
throw new Error('Render pending; retained job can be resumed.');
