import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import sharp from 'sharp';
import {vectorRiverbank} from '../../server/services/canvasVectorRiverbank';import {createCanvasProject} from '../../shared/canvasAnimationStudio';import {normalizeVectorAssets,normalizeVectorScene} from '../../shared/canvasVectorScene';import {VectorSceneFrame} from './VectorSceneFrame';
(globalThis as unknown as {React:typeof React}).React=React;
test('riverbank earth artwork reaches both 16:9 edges without relying on a rectangular fallback',async()=>{
 const frame={width:1280,height:720},location=vectorRiverbank(frame),assets=normalizeVectorAssets(location.assets);
 // Remove only the physical fallback to expose the old portrait-width island.
 const scene={...createCanvasProject().scenes[0]!,durationMs:3000,narration:'',vectorAssetLibrary:assets,
  vectorScene:normalizeVectorScene({...location.stage,nodes:location.stage.nodes.filter(n=>n.id!=='physical-ground-plane').map(n=>n.id==='person'?{...n,opacity:0}:n)},assets)};
 const svg=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:0,...frame})).match(/<svg.*<\/svg>/)![0];
 const {data,info}=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({resolveWithObject:true});
 for(const x of [20,1260]){const at=(700*info.width+x)*info.channels;assert.deepEqual([...data.subarray(at,at+3)],[143,123,97],'earth artwork must reach edge '+x);}
});
