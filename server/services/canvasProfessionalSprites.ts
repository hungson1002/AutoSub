import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { CanvasSpriteAct, CanvasStudioProject } from '../../shared/canvasAnimationStudio';
import type { CanvasAssetGenerationConfig } from './canvasProfessionalAssets';
import { collectCanvasActorRequests, type CanvasActorRequest } from './canvasActorRequests';
import { findCachedAnimationAsset, generateAnimationAsset, getAnimationAssetFile, registerAnimationAsset } from './animationAssets';
import { prepareSpriteSheet } from './animationSpriteGeneration';
import { workdir } from './ffmpeg';
import { runAnimationOnce } from './animationCheckpoint';

export async function animateProfessionalCanvasActors(
  project: CanvasStudioProject,
  config: CanvasAssetGenerationConfig,
): Promise<CanvasStudioProject> {
  const acts = new Map<string, CanvasSpriteAct>();
  const requests = collectCanvasActorRequests(project);
  for (const request of requests) {
    const object = request.object;
    if (!object.assetId || !object.imageUrl) throw new Error('Sprite cần ảnh nhân vật đã qua pipeline tài sản: ' + object.label);
    const cacheKey = createHash('sha256').update('canvas-acting-v1:' + request.key).digest('hex');
    const asset = await runAnimationOnce('canvas-acting-' + cacheKey, async () => {
    let asset = await findCachedAnimationAsset(cacheKey);
    if (!asset?.sprite) {
      const source = await generateAnimationAsset({
        provider: config.provider,
        model: config.model,
        generator: config.generator,
        referenceAssetId: object.assetId,
        name: 'Canvas Acting · ' + object.label + ' · ' + request.action,
        type: 'image',
        tags: ['canvas-acting-source', cacheKey],
        style: 'hand-drawn editorial animation',
        width: 1536,
        height: 768,
        prompt: [
          'Production 2D animation sprite atlas: EXACTLY 4 columns by 2 rows, exactly 8 successive full-body poses, equal-sized cells.',
          'Use the attached character as the exact identity reference. Preserve face, hair, costume, proportions, colors and line style in every cell.',
          'Action: ' + request.action + '. Expression: ' + (object.expression || 'neutral') + '. Facing: ' + (object.facing || 'right') + '.',
          object.designNotes || '',
          'Show anticipation, action and recovery. For talk animate mouth and a restrained hand gesture. For run animate limbs IN PLACE.',
          'For point, react, brace and celebrate use one readable gesture and settle, not eight unrelated poses.',
          'Keep the same camera, scale and foot baseline. Leave 12% empty padding around all limbs.',
          'Pure flat magenta #FF00FF background in every cell. No magenta on the subject. No scenery, shadows, grid lines, text, labels or borders.',
        ].join(' '),
      });
      const file = await getAnimationAssetFile(source.id);
      // No blind regeneration: the source remains cached if geometry validation fails.
      const prepared = await prepareSpriteSheet(file.path);
      const id = randomUUID();
      const directory = path.join(workdir, 'animation-assets', 'files');
      await mkdir(directory, { recursive: true });
      await sharp({ create: { width: prepared.frameWidth * 4, height: prepared.frameHeight * 2, channels: 4, background: '#00000000' } })
        .composite(prepared.cells.map((input, frame) => ({ input, left: frame % 4 * prepared.frameWidth, top: Math.floor(frame / 4) * prepared.frameHeight })))
        .png().toFile(path.join(directory, id + '.png'));
      asset = await registerAnimationAsset({
        id, name: 'Canvas Acting · ' + object.label + ' · ' + request.action,
        type: 'sprite', uri: '/api/animation-studio/assets/' + id + '/file',
        tags: ['canvas-acting', 'geometry-validated', object.characterKey || object.id, request.action],
        cacheKey, status: 'candidate', source: 'generated', createdAt: new Date().toISOString(),
        width: prepared.frameWidth, height: prepared.frameHeight,
        sprite: {
          frameWidth: prepared.frameWidth, frameHeight: prepared.frameHeight, columns: 4, frameCount: 8,
          clips: { [request.action]: { from: 0, to: 7, fps: request.action === 'run' ? 12 : 8, loop: ['talk', 'run', 'row'].includes(request.action) } },
        },
      });
    }
    return asset;
    });
    const sprite = asset.sprite!;
    const clip = sprite.clips[request.action];
    if (!clip) throw new Error('Sprite cache thiếu động tác ' + request.action);
    acts.set(request.key, {
      action: request.action, imageUrl: asset.uri,
      frameWidth: sprite.frameWidth, frameHeight: sprite.frameHeight, columns: sprite.columns,
      from: clip.from, to: clip.to, fps: clip.fps, loop: clip.loop,
    });
  }
  return attachCanvasActorActs(project, requests, acts);
}

export function attachCanvasActorActs(
  project: CanvasStudioProject,
  requests: CanvasActorRequest[],
  acts: Map<string, CanvasSpriteAct>,
): CanvasStudioProject {
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      objects: scene.objects.map((object) => {
        const relevant = requests.filter((request) =>
          request.object.assetId === object.assetId
          && (request.object.characterKey || request.object.assetKey || request.object.id) === (object.characterKey || object.assetKey || object.id)
          && (request.object.expression || 'neutral') === (object.expression || 'neutral')
          && (request.object.facing || 'right') === (object.facing || 'right'),
        );
        const spriteActs = relevant.map((request) => acts.get(request.key)).filter((act): act is CanvasSpriteAct => Boolean(act));
        return spriteActs.length ? { ...object, spriteActs } : object;
      }),
    })),
  };
}
