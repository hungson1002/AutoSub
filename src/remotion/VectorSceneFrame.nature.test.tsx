import test from 'node:test';import assert from 'node:assert/strict';
import React from 'react';import sharp from 'sharp';import {renderToStaticMarkup} from 'react-dom/server';
import {VectorSceneFrame} from './VectorSceneFrame';
import {parseVectorPlan} from '../../server/services/canvasVectorDirector';
(globalThis as any).React=React;

test('actual renderer fills the scenery frame and preserves filled black ink through horror production',async()=>{
 const p=parseVectorPlan(JSON.stringify({vectorStages:{woods:{template:'nature-landscape',water:'waterfall',light:'day',seed:117}},
  scenes:[{durationMs:1000,narration:'A quiet waterfall.',vectorScene:{stage:'woods',tracks:[{target:'person',start:0,end:1,frames:[{t:0,opacity:0},{t:1,opacity:0}]}],camera:[{t:0,x:640,y:360,zoom:1}]}}]}),'[folk-horror]',{width:1280,height:720});
 const scene={...p.scenes[0]!,vectorAssetLibrary:p.vectorAssets};
 const svg=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:0,width:1280,height:720})).match(/<svg.*<\/svg>/)![0];
 const {data,info}=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const pixel=(x:number,y:number)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4)];
 for(const [x,y] of [[0,0],[1279,0],[0,719],[1279,719],[640,719]])assert.equal(pixel(x!,y!)[3],255,'no floating image or exposed inset border');
 assert.deepEqual(pixel(640,10).slice(0,3),[163,203,213],'native sky palette survives the production path');
 let black=0,water=0,foam=0;
 for(let i=0;i<data.length;i+=4){
  if(data[i]===23&&data[i+1]===18&&data[i+2]===15)black++;
  if(data[i]===65&&data[i+1]===127&&data[i+2]===124)water++;
  if(data[i]===224&&data[i+1]===234&&data[i+2]===209)foam++;
 }
 assert.ok(black>6000,'filled pressure ink must not become gray in nighttime readability processing');
 assert.ok(water>30000&&foam>10000,'connected waterfall and receiving pool must survive assembly');
});
