import type { AnimationProject, AnimationScene } from '../../shared/animationStudio';
import { sceneTransition } from '../animationStudio/sceneTransitions';

export interface RenderSceneRange {
  scene: AnimationScene;
  from: number;
  durationInFrames: number;
  transitionInFrames: number;
  transitionOutFrames: number;
}

export const millisecondsToFrames = (milliseconds: number, fps: number) =>
  Math.max(1, Math.round(milliseconds / 1000 * fps));

export function buildRenderTimeline(project: AnimationProject): RenderSceneRange[] {
  const fps = Math.max(1, project.fps);
  const scenes = [...project.scenes]
    .sort((a, b) => a.order - b.order);
  let cursor = 0;
  return scenes.map((scene, index) => {
    const durationInFrames = millisecondsToFrames(scene.durationMs, fps);
    const requested = sceneTransition(scene);
    const previous = scenes[index - 1];
    const transitionInFrames = index && scene.renderMode === 'composite' && previous?.renderMode === 'composite' && requested.type !== 'cut' ? Math.min(millisecondsToFrames(requested.durationMs, fps), Math.floor(durationInFrames / 3)) : 0;
    const next = scenes[index + 1];
    const nextTransition = next ? sceneTransition(next) : undefined;
    const transitionOutFrames = scene.renderMode === 'composite' && next?.renderMode === 'composite' && nextTransition && nextTransition.type !== 'cut' ? Math.min(millisecondsToFrames(nextTransition.durationMs, fps), Math.floor(durationInFrames / 3)) : 0;
    const from = cursor;
    cursor += durationInFrames;
    return { scene, from, durationInFrames, transitionInFrames, transitionOutFrames };
  });
}

export const renderDurationInFrames = (project: AnimationProject) => {
  const timeline = buildRenderTimeline(project);
  const last = timeline.at(-1);
  return last ? last.from + last.durationInFrames : 1;
};
