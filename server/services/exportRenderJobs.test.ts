import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {access,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {mkdtempSync} from 'node:fs';
process.env.AUTOSUB_WORKDIR=mkdtempSync(path.join(os.tmpdir(),'AutoSub-export-queue-test-'));
const {workdir}=await import('./ffmpeg');
const {createPersistentExportJob,startPersistentExportJob,getPersistentExportJob,cancelPersistentExportJob,initializePersistentExportJobs,listPersistentExportJobs}=await import('./exportRenderJobs');

test('background export listing exposes identity/progress without FFmpeg arguments or local paths',async()=>{
  const id='list-'+randomUUID();
  await createPersistentExportJob({id,args:['-i',path.join(workdir,'my-source.mp4')],stagedOutput:path.join(workdir,id+'.partial.mp4'),output:path.join(workdir,id+'.mp4'),expectedDurationSeconds:1});
  const job=(await listPersistentExportJobs()).find(job=>job.id===id)!;
  assert.equal(job.name,'my-source.mp4');assert.equal(job.status,'queued');assert.equal(job.kind,'video-export');assert.equal(job.progress,45);
  assert.equal('args' in job,false);assert.equal('output' in job,false);
  await cancelPersistentExportJob(id);
});

test('cancelling a running FFmpeg export stops it without publishing a partial video',async()=>{
  const job=await create(8);
  const runner=startPersistentExportJob(job.id);
  let started=false;
  for(let i=0;i<100;i++){
    started=await access(job.stagedOutput).then(()=>true,()=>false);
    if(started)break;
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.ok(started,'FFmpeg must start writing before cancellation');
  const at=Date.now();await cancelPersistentExportJob(job.id);
  assert.equal((await runner).status,'cancelled');
  assert.ok(Date.now()-at<3000,'cancellation must stop FFmpeg rather than wait for the eight-second input');
  assert.equal(await access(job.output).then(()=>true,()=>false),false);
});

async function create(duration=.3,bad=false){
  const id='serial-test-'+randomUUID(),stagedOutput=path.join(workdir,id+'.partial.mp4'),output=path.join(workdir,id+'.mp4');
  return createPersistentExportJob({id,stagedOutput,output,expectedDurationSeconds:duration,args:bad?['-invalid-export-test-option']:['-v','error','-y','-re','-f','lavfi','-i',`color=c=blue:s=160x284:r=30:d=${duration}`,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',stagedOutput]});
}

test('three concurrent export requests run one FFmpeg job at a time and complete FIFO',async()=>{
  const jobs=await Promise.all([create(),create(),create()]);
  const order:string[]=[];let peak=0,sawWaiting=false;
  const promises=jobs.map(j=>startPersistentExportJob(j.id).then(r=>{order.push(r.id);return r;}));
  let done=false;const all=Promise.all(promises).finally(()=>{done=true;});
  while(!done){
    const states=await Promise.all(jobs.map(j=>getPersistentExportJob(j.id)));
    peak=Math.max(peak,states.filter(j=>j.status==='running').length);
    if(states.filter(j=>j.status==='queued').length>=2)sawWaiting=true;
    await new Promise(r=>setTimeout(r,15));
  }
  const results=await all;
  assert.equal(peak,1);assert.equal(sawWaiting,true);
  assert.deepEqual(order,jobs.map(j=>j.id));assert.ok(results.every(r=>r.status==='completed'));
  for(const j of results)await access(j.output);
});

test('cancelling a waiting export keeps it from launching and does not block the next export',async()=>{
  const first=await create(.5),cancelled=await create(),next=await create();
  const a=startPersistentExportJob(first.id),b=startPersistentExportJob(cancelled.id),c=startPersistentExportJob(next.id);
  await cancelPersistentExportJob(cancelled.id);
  assert.deepEqual((await Promise.all([a,b,c])).map(j=>j.status),['completed','cancelled','completed']);
  await assert.rejects(access(cancelled.stagedOutput));await assert.rejects(access(cancelled.output));
});

test('a failed export releases the serial queue for the next request',async()=>{
  const bad=await create(.3,true),good=await create();
  const results=await Promise.all([startPersistentExportJob(bad.id),startPersistentExportJob(good.id)]);
  assert.deepEqual(results.map(j=>j.status),['failed','completed']);
});

test('startup recovery also queues multiple unfinished exports and repeated starts reuse the runner',async()=>{
  const jobs=await Promise.all([create(.4),create(.4)]);
  for(const j of jobs){j.status='running';const file=path.join(workdir,'export-jobs',j.id,'job.json');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(j));}
  await initializePersistentExportJobs();
  const a=startPersistentExportJob(jobs[0]!.id),duplicate=startPersistentExportJob(jobs[0]!.id),b=startPersistentExportJob(jobs[1]!.id);
  let done=false;const all=Promise.all([a,duplicate,b]).finally(()=>{done=true;});let peak=0;
  while(!done){const states=await Promise.all(jobs.map(j=>getPersistentExportJob(j.id)));peak=Math.max(peak,states.filter(j=>j.status==='running').length);await new Promise(r=>setTimeout(r,15));}
  assert.equal(peak,1);assert.ok((await all).every(j=>j.status==='completed'));
  const saved=JSON.parse(await readFile(path.join(workdir,'export-jobs',jobs[0]!.id,'job.json'),'utf8'));assert.equal(saved.status,'completed');
});
