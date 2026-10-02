import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasObject,type CanvasStudioScene} from '../../../shared/canvasAnimationStudio';
import {drawCharacterV2} from './characterRenderer';
import {resolveStageCharacterRig} from './characterStaging';

test('all camera LODs draw legs, arms cover the torso and phone grip has no pointing finger',()=>{
  const original=globalThis.Path2D;
  class RecordedPath {constructor(public d:string){}}
  globalThis.Path2D=RecordedPath as unknown as typeof Path2D;
  try{
    for(const shot of ['medium','close-up','extreme-close-up'] as const)for(const gripping of [false,true]){
      const actor=createCanvasObject('character',{id:'minh',pose:'point',height:320,width:205});
      const scene:CanvasStudioScene={id:'call',name:'call',durationMs:3000,background:'room',camera:{shot,motion:'none',focusX:640,focusY:360,zoom:1},objects:[actor,...(gripping?[createCanvasObject('prop',{variant:'phone',heldBy:actor.id})]:[])]};
      const {rig,model}=resolveStageCharacterRig(actor,scene,1000,false);
      const calls:Array<{kind:string,args:any[],cap?:CanvasLineCap}>=[];
      const gradient={addColorStop(){}};
      const ctx=new Proxy({} as any,{get(target,key){
        if(key in target)return target[key];
        if(key==='createLinearGradient'||key==='createRadialGradient')return ()=>gradient;
        return (...args:any[])=>calls.push({kind:String(key),args,cap:target.lineCap});
      },set(target,key,value){target[key]=value;return true;}});
      drawCharacterV2(ctx,actor,scene,1000,false);
      for(const side of ['L','R'] as const){
        const hip=rig[`hip${side}`],foot=rig[`foot${side}`];
        const start=calls.findIndex(c=>c.kind==='moveTo'&&c.args[0]===hip.x&&c.args[1]===hip.y);
        const calfStroke=calls.slice(start).find(c=>c.kind==='stroke');
        assert.equal(calfStroke?.cap,'butt','calf must not have a rounded cap protruding below the shoe');
        assert.ok(calls.some(c=>c.kind==='lineTo'&&c.args[0]===foot.x&&c.args[1]===foot.y),'calf must end exactly at its ankle anchor');
        const shoe=calls.find(c=>c.kind==='fill'&&c.args[0]?.d?.startsWith(`M ${foot.x-4.3} ${foot.y-1} Q`));
        assert.ok(shoe?.args[0].d.includes(`${foot.y+4.5}`),'sole must be below the ankle, not above the leg endpoint');
      }
      const torso=calls.findIndex(c=>c.kind==='fill'&&c.args[0]?.d?.startsWith(`M ${-model.shoulderWidth/2} ${rig.chest.y-5} C`));
      const upperArm=calls.findIndex(c=>c.kind==='moveTo'&&c.args[0]===rig.shoulderR.x&&c.args[1]===rig.shoulderR.y);
      assert.ok(torso>=0 && upperArm>torso,'sleeve must cover the shirt, not vanish behind it');
      const finger=calls.some(c=>c.kind==='moveTo'&&c.args[0]===1&&c.args[1]===-.8);
      assert.equal(finger,!gripping,'gripping a phone must not leave an extended index finger');
    }
  }finally{globalThis.Path2D=original;}
});
