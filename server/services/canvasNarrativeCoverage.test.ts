import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCanvasCoverageReview} from './canvasNarrativeCoverage';
import {reviewCanvasNarrativeCoverage} from './canvasNarrativeCoverage';
import {createServer} from 'node:http';
import {parsePlan} from './canvasAnimationDirector';
import {repairCanvasVisualPlan} from './canvasAnimationDirector';
import {evaluateCanvasVisualQuality} from '../../shared/canvasVisualQuality';
const project=parsePlan(JSON.stringify({name:'Test',scenes:[{name:'Getting coat',narration:'Minh lấy áo khoác rồi gọi trưởng bản.',objects:[]}]}),'horror story');
test('semantic review catches actions outside the deterministic vocabulary',()=>{
  const issues=parseCanvasCoverageReview(JSON.stringify({pass:false,issues:[{sceneIndex:0,cue:'lấy áo khoác',missing:'No coat or action is visible',fix:'Show handling a coat before the phone call in a detail shot'}]}),project);
  assert.equal(issues.length,1);assert.equal(issues[0]!.sceneId,project.scenes[0]!.id);
});
test('semantic review rejects invented phrases and ambiguous success reports',()=>{
  assert.throws(()=>parseCanvasCoverageReview('{"pass":false,"issues":[]}',project));
  assert.throws(()=>parseCanvasCoverageReview('{"pass":false,"issues":[{"sceneIndex":0,"cue":"flying","missing":"missing","fix":"fix"}]}',project));
  assert.deepEqual(parseCanvasCoverageReview('{"pass":true,"issues":[]}',project),[]);
});

test('invalid reviewer citation is corrected without silently accepting a bad plan',async()=>{
  let calls=0;
  const server=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const payload=JSON.parse(Buffer.concat(chunks).toString());calls++;
    if(calls>1)assert.ok(payload.messages.at(-1).content.includes('copied verbatim'));
    const report={pass:false,issues:[{sceneIndex:0,cue:calls===1?'invented quote':'lấy áo khoác',missing:'No coat visible',fix:'Show the coat'}]};
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(report)}}]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const port=(server.address() as {port:number}).port;
    const issues=await reviewCanvasNarrativeCoverage({id:'test',name:'test',enabled:true,providerType:'openai-compatible',authType:'none',baseUrl:`http://127.0.0.1:${port}/v1`,models:[],capabilities:{chat:true}},'reviewer',project);
    assert.equal(calls,2);assert.equal(issues.length,1);assert.equal(issues[0]!.severity,'error');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('coverage review uses the configured chat provider and sends the actual scene plan',async()=>{
  let payload:any;
  const server=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    payload=JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({choices:[{message:{content:'{"pass":true,"issues":[]}'}}]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const port=(server.address() as {port:number}).port;
    const issues=await reviewCanvasNarrativeCoverage({id:'test',name:'test',enabled:true,providerType:'openai-compatible',authType:'none',baseUrl:`http://127.0.0.1:${port}/v1`,models:[],capabilities:{chat:true}},'reviewer',project);
    assert.deepEqual(issues,[]);assert.equal(payload.model,'reviewer');
    assert.ok(payload.messages[0].content.includes('every clause'));
    assert.ok(payload.messages[0].content.includes('bandageProgress:0 means bare/untreated'));
    assert.equal(JSON.parse(payload.messages[1].content).scenes[0].narration,project.scenes[0]!.narration);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('QC repair can express a bare injured leg instead of a premature complete bandage',async()=>{
  const original=parsePlan(JSON.stringify({name:'Inspection',scenes:[{name:'Inspection',narration:'Minh mới bắt đầu kiểm tra chân bác Duy.',background:'room',objects:[
    {kind:'character',label:'Duy',characterKey:'duy',pose:'sit',sittingStyle:'injured',legBandage:'right'},
  ]}]}),'horror');
  const repaired=structuredClone(original);repaired.scenes[0]!.objects[0]!.bandageProgress=0;
  const report=evaluateCanvasVisualQuality(original);
  report.issues.push(...parseCanvasCoverageReview(JSON.stringify({pass:false,issues:[{sceneIndex:0,cue:'kiểm tra chân',missing:'Bandage already present before inspection',fix:'Keep injured right leg bare before treatment'}]}),original));
  const server=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const payload=JSON.parse(Buffer.concat(chunks).toString());
    assert.ok(payload.messages[0].content.includes('bandageProgress:0'));
    assert.ok(payload.messages[0].content.includes('Bandage already present'));
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(repaired)}}]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const port=(server.address() as {port:number}).port;
    const result=await repairCanvasVisualPlan({id:'test',name:'test',enabled:true,providerType:'openai-compatible',authType:'none',baseUrl:`http://127.0.0.1:${port}/v1`,models:[],capabilities:{chat:true}},'reviewer','horror',original,report);
    assert.equal(result.scenes[0]!.objects[0]!.legBandage,'right');
    assert.equal(result.scenes[0]!.objects[0]!.sittingStyle,'injured');
    assert.equal(result.scenes[0]!.objects[0]!.bandageProgress,0);
    assert.equal(result.scenes[0]!.narration,original.scenes[0]!.narration);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
