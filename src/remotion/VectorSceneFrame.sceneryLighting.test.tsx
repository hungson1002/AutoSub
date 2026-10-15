import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';import sharp from 'sharp';
import {settingScenery} from '../../server/services/canvasScenerySetting';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';
import {normalizeVectorAssets,normalizeVectorScene} from '../../shared/canvasVectorScene';
import {VectorSceneFrame} from './VectorSceneFrame';
(globalThis as unknown as {React:typeof React}).React=React;

test('real canopy geometry partially occludes a round bright moon and its halo',async()=>{
 const location=settingScenery({place:'night-house',light:'night',atmosphere:'clear'});
 // Deliberately put the celestial group at the canopy edge to exercise the
 // old failure that a whole-moon bounding-box hide could not solve.
 const sky=location.stage.nodes.find(n=>n.id==='sky-light')!;sky.x=140;
 const assets=normalizeVectorAssets(location.assets);
 const scene={...createCanvasProject().scenes[0]!,durationMs:5000,narration:'',vectorAssetLibrary:assets,
  vectorScene:normalizeVectorScene({...location.stage,nodes:location.stage.nodes.map(n=>n.id==='person'?{...n,opacity:0}:n)},assets)};
 const markup=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:2500,width:1280,height:720}));
 const {data,info}=await sharp(Buffer.from(markup.match(/<svg.*<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const luminance=(x:number,y:number)=>{
  const at=(y*info.width+x)*info.channels;return (data[at]!+data[at+1]!+data[at+2]!)/3;
 };
 assert.ok(luminance(1140,90)<90,'canopy must hide the left side of the disk');
 assert.ok(luminance(1180,90)>210,'unoccluded moon stays bright instead of being hidden wholesale or graded dark');
});
