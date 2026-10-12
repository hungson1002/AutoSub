import type { CanvasAnimationAction, CanvasStudioObject, CanvasStudioProject } from '../../shared/canvasAnimationStudio';

const acting = new Set<CanvasAnimationAction>(['talk', 'gesture', 'nod', 'point', 'react', 'celebrate', 'brace', 'run', 'row']);
export type CanvasActorRequest = {
  key: string;
  object: CanvasStudioObject;
  action: CanvasAnimationAction;
};

/** Only request performances actually directed on the timeline. */
export function collectCanvasActorRequests(project: CanvasStudioProject): CanvasActorRequest[] {
  const requests = new Map<string, CanvasActorRequest>();
  for (const scene of project.scenes) {
    for (const object of scene.objects.filter((item) => item.kind === 'character')) {
      for (const beat of scene.animationBeats || []) {
        if (!beat.targetIds.includes(object.id) || !acting.has(beat.action)) continue;
        const key = [object.characterKey || object.assetKey || object.id, object.assetId || '', beat.action, object.expression || 'neutral', object.facing || 'right'].join(':');
        if (!requests.has(key)) requests.set(key, { key, object, action: beat.action });
      }
    }
  }
  return [...requests.values()];
}
