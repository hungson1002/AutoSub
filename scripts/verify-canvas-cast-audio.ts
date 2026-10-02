import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const file='tmp/cast-production-check/project.json';const project=JSON.parse(await readFile(file,'utf8'));
const narration={provider:{id:'edge-tts-local',name:'Edge TTS',baseUrl:'local://edge-tts',enabled:true,models:[],providerType:'edge-tts',authType:'none',capabilities:{tts:true}},model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1};
const start=Date.now();const response=await fetch('http://127.0.0.1:8787/api/canvas-animation-studio/audio',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({project,narration,autoSound:true})});
if(!response.ok)throw new Error(await response.text());const voiced=await response.json();
for(let i=0;i<project.scenes.length;i++)for(let j=0;j<project.scenes[i].dialogue.length;j++){
 const old=project.scenes[i].dialogue[j],line=voiced.scenes[i].dialogue[j];
 assert.equal(line.audioUrl,old.audioUrl);assert.equal(line.voice,old.voice);assert.ok(line.speechEnvelope.length>0);
}
assert.equal(voiced.castVoices.lan,'vi-VN-HoaiMyNeural');assert.equal(voiced.castVoices.minh,'vi-VN-NamMinhNeural');
const report={elapsedMs:Date.now()-start,scenes:voiced.scenes.length,castVoices:voiced.castVoices,retainedAllDialogueAudio:true,measuredSpeechEnvelope:true};
await writeFile('tmp/cast-production-check/audio-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
