import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanvasStudioProject } from '../shared/canvasAnimationStudio';
import { createVieneuLocalProvider } from '../src/lib/providers';

process.env.AUTOSUB_VIENEU_WORKERS='1';
process.env.AUTOSUB_ANIMATION_RENDER_CONCURRENCY='1';
const { prepareCanvasProjectAudio }=await import('../server/services/canvasAudioProduction');
const { renderCanvasAnimationProject }=await import('../server/services/animationRender');
const directory=path.resolve('tmp/ma-xo-pilot');
const checkpoint=path.join(directory,'project-expressive-test.partial.json');
await mkdir(directory,{recursive:true});
let project=JSON.parse(await readFile(path.join(directory,'project-natural.json'),'utf8')) as CanvasStudioProject;
project.id=randomUUID();
project.name='Ma Xó — thử giọng truyền cảm 02-10-2026';
for(const scene of project.scenes) {
  scene.audioMixKey=undefined;scene.audioUrl=undefined;
  for(const line of scene.dialogue||[]) {
    // Only the spoken override has direction; captions retain the original script.
    line.spokenText=/…|\.{3}/u.test(line.text)?line.text.replace(/…|\.{3}/u,'… [pause 400ms]')
      :/,\s/u.test(line.text)?line.text.replace(/,\s/u,', [pause 220ms] ')
      :/\.\s/u.test(line.text)?line.text.replace(/\.\s/u,'. [pause 300ms] ')
      :`${line.text} [pause 180ms]`;
    line.atMs=undefined;line.audioKey=undefined;line.audioUrl=undefined;
    line.durationMs=undefined;line.speechWindows=undefined;
  }
}
try {
  const saved=JSON.parse(await readFile(checkpoint,'utf8')) as CanvasStudioProject;
  if(saved.name===project.name&&saved.scenes.length===project.scenes.length)project=saved;
} catch { /* First run; retain every completed scene on later runs. */ }
const narration={provider:createVieneuLocalProvider(),model:'vieneu-v3-turbo',voice:'preset:anh-khoi',speed:.94};
for(const [index,scene] of project.scenes.entries()) {
  console.log(`AUDIO ${index+1}/${project.scenes.length}: ${scene.name}`);
  const result=await prepareCanvasProjectAudio({project:{...project,scenes:[scene]},narration,autoSound:true});
  project.scenes[index]=result.scenes[0]!;
  await writeFile(checkpoint,JSON.stringify(project,null,2));
  console.log(`READY ${result.scenes[0]!.durationMs.toFixed(0)}ms`);
}
await writeFile(path.join(directory,'project-expressive-test.json'),JSON.stringify(project,null,2));
let previous=-1;
const result=await renderCanvasAnimationProject(project,undefined,progress=>{
  const percent=Math.floor(progress*10)*10;
  if(percent!==previous){previous=percent;console.log(`RENDER ${percent}%`);}
});
const video=path.join(directory,'ma-xo-expressive-test.mp4');
await copyFile(result.path,video);
console.log(`VIDEO=${video}`);
process.exit(0);
