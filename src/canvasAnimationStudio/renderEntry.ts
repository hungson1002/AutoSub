import type {CanvasStudioProject} from './types';
import {clearCanvasImageCache,preloadCanvasSceneImages} from './renderer';
import {renderCanvasSceneWithTransition} from './sceneTransition';
import {hasCanvasCaptions,drawCanvasCaption} from './captions';
import {createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {VectorSceneFrame} from '../remotion/VectorSceneFrame';

let project:CanvasStudioProject,origin:string,canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D,preparedScene=-1;
let svgRoot:Root|undefined;
async function prepareScene(sceneIndex:number){
  if(preparedScene===sceneIndex)return;
  clearCanvasImageCache();
  const scenes=[project.scenes[sceneIndex-1],project.scenes[sceneIndex]].filter(Boolean) as CanvasStudioProject['scenes'];
  await Promise.all(scenes.map(scene=>preloadCanvasSceneImages(scene,origin)));
  preparedScene=sceneIndex;
}
const api={
  async setup(value:CanvasStudioProject,assetOrigin:string){
    svgRoot?.unmount();svgRoot=undefined;
    project=value;origin=assetOrigin;preparedScene=-1;
    canvas=document.createElement('canvas');canvas.width=project.width;canvas.height=project.height;
    document.body.replaceChildren(canvas);ctx=canvas.getContext('2d')!;
    if(!ctx)throw new Error('Canvas 2D unavailable');
  },
  nativeFrame(sceneIndex:number,frame:number){
    if(!svgRoot){
      const host=document.createElement('div');host.style.cssText=`position:relative;width:${project.width}px;height:${project.height}px`;
      document.body.style.margin='0';document.body.replaceChildren(host);svgRoot=createRoot(host);
    }
    flushSync(()=>svgRoot!.render(createElement(VectorSceneFrame,{scene:project.scenes[sceneIndex]!,timeMs:frame/project.fps*1000,width:project.width,height:project.height})));
  },
  async frames(sceneIndex:number,startFrame:number,count:number){
    await prepareScene(sceneIndex);
    const scene=project.scenes[sceneIndex]!;const result:string[]=[];
    for(let frame=startFrame;frame<startFrame+count;frame++){
      const time=frame/project.fps*1000;
      renderCanvasSceneWithTransition(ctx,scene,project.scenes[sceneIndex-1],time,project.width,project.height,origin);
      if(hasCanvasCaptions(project))drawCanvasCaption(ctx,scene,time,project.width,project.height);
      result.push(canvas.toDataURL('image/png').split(',')[1]!);
    }
    return result;
  },
  cleanup(){
    svgRoot?.unmount();svgRoot=undefined;
    clearCanvasImageCache();preparedScene=-1;
    if(canvas){canvas.width=1;canvas.height=1;}
    document.body.replaceChildren();
  }
};
(window as unknown as {autosubCanvasRender:typeof api}).autosubCanvasRender=api;
