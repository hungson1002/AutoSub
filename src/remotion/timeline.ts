import type { AnimationProject, AnimationScene } from '../../shared/animationStudio';

export interface RenderSceneRange {
  scene: AnimationScene;
  from: number;
  durationInFrames: number;
  transitionInFrames: number;
  transitionOutFrames: number;
}

export const millisecondsToFrames = (milliseconds: number, fps: number) =>
  Math.max(1, Math.round(milliseconds / 1000 * fps));

export function buildRenderTimeline(project: AnimationProject, transitionMilliseconds = 240): RenderSceneRange[] {
  const fps = Math.max(1, project.fps);
  const scenes = [...project.scenes]
    .filter((scene) => scene.renderMode === 'composite')
    .sort((a, b) => a.order - b.order);
  const preferredTransition = millisecondsToFrames(transitionMilliseconds, fps);
  let cursor = 0;
  return scenes.map((scene, index) => {
    const durationInFrames = millisecondsToFrames(scene.durationMs, fps);
    const previousDuration = index ? millisecondsToFrames(scenes[index - 1]!.durationMs, fps) : 0;
    const transitionInFrames = index ? Math.min(preferredTransition, Math.floor(previousDuration / 3), Math.floor(durationInFrames / 3)) : 0;
    const transitionOutFrames = index < scenes.length - 1
      ? Math.min(preferredTransition, Math.floor(durationInFrames / 3), Math.floor(millisecondsToFrames(scenes[index + 1]!.durationMs, fps) / 3))
      : 0;
    const from = Math.max(0, cursor - transitionInFrames);
    cursor = from + durationInFrames;
    return { scene, from, durationInFrames, transitionInFrames, transitionOutFrames };
  });
}

export const renderDurationInFrames = (project: AnimationProject) => {
  const timeline = buildRenderTimeline(project);
  const last = timeline.at(-1);
  return last ? last.from + last.durationInFrames : 1;
};
