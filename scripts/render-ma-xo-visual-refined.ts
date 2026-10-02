import {readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';

process.env.AUTOSUB_ANIMATION_RENDER_CONCURRENCY='1';
const {renderCanvasAnimationProject}=await import('../server/services/animationRender');
const directory=path.resolve('tmp/ma-xo-pilot');
const project=JSON.parse(await readFile(path.join(directory,'project-expressive-test.json'),'utf8')) as CanvasStudioProject;
project.id=randomUUID();
project.name='Ma Xó — nhân vật và diễn xuất tinh chỉnh';
await writeFile(path.join(directory,'project-visual-refined.json'),JSON.stringify(project,null,2));
let previous=-1;
const result=await renderCanvasAnimationProject(project,undefined,progress=>{
  const percent=Math.floor(progress*10)*10;
  if(percent!==previous){previous=percent;console.log(`RENDER ${percent}%`);}
});
const target=path.join(directory,'ma-xo-visual-refined.mp4');
await copyFile(result.path,target);
console.log(`VIDEO=${target}`);
process.exit(0);
