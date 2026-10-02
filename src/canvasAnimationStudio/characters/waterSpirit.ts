import type {CanvasStudioObject,CanvasStudioScene} from '../types';
import {resolveStageCharacterRig} from './characterStaging';
import {characterDrawingScale} from './characterModel';

/** A articulated, waterlogged silhouette. Uses the same anatomical anchors and
 * contact solver as human actors, so grabbing is not a floating overlay icon. */
export function drawWaterSpirit(ctx:CanvasRenderingContext2D,object:CanvasStudioObject,scene:CanvasStudioScene,timeMs:number){
  const {model,rig}=resolveStageCharacterRig(object,scene,timeMs,false);
  const scale=characterDrawingScale(object,model);
  const paint=(d:string,fill:string,line=1.1)=>{
    const path=new Path2D(d);ctx.fillStyle=fill;ctx.strokeStyle='#142520';ctx.lineWidth=line;ctx.fill(path);ctx.stroke(path);
  };
  const limb=(points:Array<{x:number;y:number}>,color:string,width:number)=>{
    ctx.beginPath();ctx.moveTo(points[0]!.x,points[0]!.y);
    for(const p of points.slice(1))ctx.lineTo(p.x,p.y);
    ctx.strokeStyle='#142520';ctx.lineWidth=width+1.5;ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
  };
  ctx.save();ctx.scale((object.facing==='left'?-1:1)*scale,scale);ctx.lineCap='round';ctx.lineJoin='round';
  const top=rig.chest.y-4,bottom=Math.max(rig.footL.y,rig.footR.y)+2;
  const cloak=ctx.createLinearGradient(0,top,0,bottom);cloak.addColorStop(0,'#344b43');cloak.addColorStop(1,'#172d28');
  const robe=new Path2D(`M -14 ${top} Q 0 ${top-5} 14 ${top} L 19 ${bottom-5} L 11 ${bottom-1} L 6 ${bottom-8} L 0 ${bottom+1} L -6 ${bottom-6} L -17 ${bottom} Z`);
  ctx.fillStyle=cloak;ctx.fill(robe);ctx.strokeStyle='#101f1d';ctx.lineWidth=1.3;ctx.stroke(robe);
  for(const x of [-8,2,9])limb([{x,y:top+9},{x:x*.65,y:bottom-10}],'#53685c',.5);
  for(const side of ['L','R'] as const){
    limb([rig[`shoulder${side}`],rig[`elbow${side}`]],'#30453c',5.1);
    limb([rig[`elbow${side}`],rig[`hand${side}`]],'#8caa98',3.1);
    const hand=rig[`hand${side}`];
    paint(`M ${hand.x-2} ${hand.y-2} L ${hand.x+2} ${hand.y-2} L ${hand.x+3} ${hand.y+2} L ${hand.x-2} ${hand.y+3} Z`,'#a4b6a7',.6);
    for(let finger=0;finger<3;finger++)limb([{x:hand.x+finger-1,y:hand.y+1},{x:hand.x+finger-1,y:hand.y+5},{x:hand.x+finger+1,y:hand.y+6}],'#9db2a0',.65);
  }
  const h=rig.head;
  ctx.translate(h.x,h.y);
  paint('M -19 -15 Q -8 -29 8 -24 Q 22 -19 20 4 L 15 28 L 10 18 L 4 29 L -5 21 L -17 30 L -22 7 Z','#101d1b');
  paint('M -12 -15 Q 0 -21 12 -13 L 13 7 Q 8 17 0 18 Q -10 14 -13 5 Z','#a7b9a9');
  paint('M -19 -15 Q -4 -28 12 -18 L 17 -4 L 10 -10 L 7 -16 L 4 -4 L 0 -13 L -5 -5 L -8 -13 L -15 3 Z','#111f1c',.75);
  for(const x of [-6,6]){
    ctx.fillStyle='#344d43';ctx.beginPath();ctx.ellipse(x,0,4,3,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#e1e8d5';ctx.beginPath();ctx.ellipse(x,0,2.5,1.5,0,0,Math.PI*2);ctx.fill();
  }
  limb([{x:0,y:2},{x:-1,y:7},{x:2,y:8}],'#61796a',.7);
  paint('M -3 12 Q 0 10 3 12 L 2 15 L -2 15 Z','#2b453c',.65);
  ctx.restore();
}
