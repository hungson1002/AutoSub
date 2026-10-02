import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createCanvasObject, createCanvasProject } from '../shared/canvasAnimationStudio';
import { renderCanvasAnimationProject, validateAnimationOutput } from '../server/services/animationRender';
import { getAnimationAssetFile } from '../server/services/animationAssets';
import { run, workdir } from '../server/services/ffmpeg';

const assets = JSON.parse(await readFile(path.join(workdir, 'animation-assets', 'library.json'), 'utf8'));
const actorAsset = assets.findLast((asset: any) => asset.sprite?.clips?.talk && asset.status !== 'rejected');
if (!actorAsset) throw new Error('Smoke test requires an existing talk atlas; does not generate new images.');
const file = await getAnimationAssetFile(actorAsset.id);
const sprite = actorAsset.sprite;
const clip = sprite.clips.talk;
const pose = await sharp(file.path).extract({
  left: clip.from % sprite.columns * sprite.frameWidth,
  top: Math.floor(clip.from / sprite.columns) * sprite.frameHeight,
  width: sprite.frameWidth, height: sprite.frameHeight,
}).png().toBuffer();
const project = createCanvasProject();
project.id = randomUUID();
project.name = 'Canvas acting smoke';
project.width = 1280; project.height = 720; project.fps = 30;
const scene = project.scenes[0];
scene.durationMs = 5000;
scene.template = 'hero-left'; scene.backgroundRef = 'bg:river-establishing';
scene.camera = { shot: 'wide', motion: 'none', focusX: 640, focusY: 360, zoom: 1 };
const actor = createCanvasObject('character', {
  assetRef: 'character:warrior', characterKey: 'smoke-actor', role: 'focal', slot: 'hero-left',
  imageUrl: 'data:image/png;base64,' + pose.toString('base64'), motion: 'none', pose: 'idle',
  spriteActs: [{ action: 'talk', imageUrl: actorAsset.uri, frameWidth: sprite.frameWidth,
    frameHeight: sprite.frameHeight, columns: sprite.columns, from: clip.from, to: clip.to, fps: clip.fps, loop: true }],
});
scene.objects = [actor,
  createCanvasObject('ship', { assetRef: 'ship:historical-warship', slot: 'mid-right', role: 'support', motion: 'drift-left' }),
];
scene.animationBeats = [{ id: 'smoke-talk', action: 'talk', targetIds: [actor.id], atMs: 700, durationMs: 2000 }];
scene.effects = [];
const result = await renderCanvasAnimationProject(project);
const metadata = await validateAnimationOutput(result.path);
const sheet = path.join(workdir, 'canvas-acting-smoke.png');
await run('ffmpeg', ['-y', '-i', result.path, '-vf', 'fps=2,scale=384:216,tile=5x2', '-frames:v', '1', sheet]);
console.log(JSON.stringify({ result, metadata, sheet }));
