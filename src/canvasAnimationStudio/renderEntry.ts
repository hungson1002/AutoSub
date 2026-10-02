import type {CanvasStudioProject} from './types';
import {preloadCanvasSceneImages,renderCanvasScene} from './renderer';
import {hasCanvasCaptions,drawCanvasCaption} from './captions';

let project:CanvasStudioProject,origin:string,canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D;
const api={
  async setup(value:CanvasStudioProject,assetOrigin:string){
    project=value;origin=assetOrigin;
    canvas=document.createElement('canvas');canvas.width=project.width;canvas.height=project.height;
    document.body.replaceChildren(canvas);ctx=canvas.getContext('2d')!;
    if(!ctx)throw new Error('Canvas 2D unavailable');
    await Promise.all(project.scenes.map(scene=>preloadCanvasSceneImages(scene,origin)));
  },
  frames(sceneIndex:number,startFrame:number,count:number){
    const scene=project.scenes[sceneIndex]!;const result:string[]=[];
    for(let frame=startFrame;frame<startFrame+count;frame++){
      const time=frame/project.fps*1000;
      renderCanvasScene(ctx,scene,time,project.width,project.height,origin);
      if(hasCanvasCaptions(project))drawCanvasCaption(ctx,scene,time,project.width,project.height);
      result.push(canvas.toDataURL('image/png').split(',')[1]!);
    }
    return result;
  }
};
(window as unknown as {autosubCanvasRender:typeof api}).autosubCanvasRender=api;
