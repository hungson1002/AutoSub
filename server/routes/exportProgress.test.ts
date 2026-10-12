import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import os from 'node:os';
import {mkdtempSync} from 'node:fs';
process.env.AUTOSUB_WORKDIR=mkdtempSync(path.join(os.tmpdir(),'AutoSub-export-progress-test-'));
const {exportRoutes}=await import('./export');
const {createPersistentExportJob}=await import('../services/exportRenderJobs');
const {workdir}=await import('../services/ffmpeg');

test('durable queued progress takes precedence over stale upload progress',async()=>{
  const app=Fastify();await app.register(multipart);await exportRoutes(app);
  const id='progress-test-'+randomUUID(),boundary='export-test-boundary';
  try{
    const upload=await app.inject({method:'POST',url:'/api/export/video',headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload:`--${boundary}\r\nContent-Disposition: form-data; name="exportId"\r\n\r\n${id}\r\n--${boundary}--\r\n`});
    assert.equal(upload.statusCode,400);
    const before=await app.inject({method:'GET',url:`/api/export/progress/${id}`});assert.equal(before.json().status,'running');
    await createPersistentExportJob({id,args:[],stagedOutput:path.join(workdir,'unused.partial.mp4'),output:path.join(workdir,'unused.mp4'),expectedDurationSeconds:1});
    const after=await app.inject({method:'GET',url:`/api/export/progress/${id}`});
    assert.equal(after.statusCode,200);assert.equal(after.json().status,'queued');assert.equal(after.json().percent,45);assert.equal(after.json().stage,'Đã xếp hàng render');
  }finally{await app.close();}
});

test('global export list discovers backend jobs and cancel updates the same job',async()=>{
  const app=Fastify();await app.register(multipart);await exportRoutes(app);
  const id='background-'+randomUUID();
  try{
    await createPersistentExportJob({id,args:['-i',path.join(workdir,'hidden-video.mp4')],stagedOutput:path.join(workdir,id+'.partial.mp4'),output:path.join(workdir,id+'.mp4'),expectedDurationSeconds:1});
    const listed=await app.inject({method:'GET',url:'/api/export/jobs'});
    assert.equal(listed.statusCode,200);assert.equal(listed.json().find((job:{id:string})=>job.id===id).name,'hidden-video.mp4');
    const cancelled=await app.inject({method:'POST',url:`/api/export/cancel/${id}`,headers:{'content-type':'application/json'},payload:'{}'});
    assert.equal(cancelled.json().status,'cancelled');
    const after=await app.inject({method:'GET',url:'/api/export/jobs'});
    assert.equal(after.json().find((job:{id:string})=>job.id===id).status,'cancelled');
  }finally{await app.close();}
});
