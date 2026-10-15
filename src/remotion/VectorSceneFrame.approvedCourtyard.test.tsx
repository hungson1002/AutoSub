import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import React from 'react';import sharp from 'sharp';import {renderToStaticMarkup} from 'react-dom/server';
import {parseVectorPlan} from '../../server/services/canvasVectorDirector';import {createCanvasProject} from '../../shared/canvasAnimationStudio';import {VectorSceneFrame} from './VectorSceneFrame';
(globalThis as unknown as {React:typeof React}).React=React;
test('native Studio pixels retain the approved hand-painted composition and palette',async()=>{
 const parsed=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard',light:'day'}},scenes:[{durationMs:1000,narration:'An empty courtyard.',vectorScene:{stage:'yard'}}]}),'[folk-horror]',{width:1280,height:720});
 const scene={...createCanvasProject().scenes[0]!,...parsed.scenes[0]!,narration:'',vectorAssetLibrary:parsed.vectorAssets};
 scene.vectorScene={...scene.vectorScene!,nodes:scene.vectorScene!.nodes.map(n=>n.id==='person'?{...n,opacity:0}:n)};
 const svg=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:0,width:1280,height:720})).match(/<svg.*<\/svg>/)![0];
 const source=await fs.readFile(new URL('../../server/assets/vector-styles/folk-horror/approved-courtyard/source.svg',import.meta.url));
 const images=await Promise.all([Buffer.from(svg),source].map(input=>sharp(input).resize(640,360).removeAlpha().raw().toBuffer()));
 let difference=0;
 for(let i=0;i<images[0]!.length;i++)difference+=Math.abs(images[0]![i]!-images[1]![i]!);
 assert.ok(difference/images[0]!.length<4,'native paint lost the approved composition/ink: mean RGB difference '+difference/images[0]!.length);
});
