import { Fragment } from 'react';
import { Composition, registerRoot } from 'remotion';
import type { AnimationProject } from '../../shared/animationStudio';
import type { CanvasStudioProject } from '../../shared/canvasAnimationStudio';
import { AnimationComposition, type AnimationCompositionProps } from './AnimationComposition';
import { CanvasAnimationComposition, canvasProjectFrames, type CanvasAnimationCompositionProps } from './CanvasAnimationComposition';
import { renderDurationInFrames } from './timeline';

const fallbackProject: AnimationProject = {
  schemaVersion: 1,
  id: '00000000-0000-0000-0000-000000000000',
  name: 'AutoSub Animation',
  width: 1920,
  height: 1080,
  fps: 30,
  createdAt: '',
  updatedAt: '',
  assets: [],
  scenes: [],
};

const fallbackCanvasProject: CanvasStudioProject = {
  version: 1,
  id: '00000000-0000-0000-0000-000000000001',
  name: 'AutoSub Canvas Animation',
  width: 1280,
  height: 720,
  fps: 30,
  scenes: [],
};

const defaultProps: AnimationCompositionProps = { project: fallbackProject, showSubtitles: true, assetOrigin: 'http://127.0.0.1:8787' };
const defaultCanvasProps: CanvasAnimationCompositionProps = { project: fallbackCanvasProject, assetOrigin: 'http://127.0.0.1:8787' };

const RemotionRoot = () => <Fragment>
  <Composition
    id="AutoSubAnimation"
    component={AnimationComposition}
    durationInFrames={1}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      width: props.project.width,
      height: props.project.height,
      fps: props.project.fps,
      durationInFrames: renderDurationInFrames(props.project),
    })}
  />
  <Composition
    id="AutoSubCanvasAnimation"
    component={CanvasAnimationComposition}
    durationInFrames={1}
    fps={30}
    width={1280}
    height={720}
    defaultProps={defaultCanvasProps}
    calculateMetadata={({ props }) => ({
      width: props.project.width,
      height: props.project.height,
      fps: props.project.fps,
      durationInFrames: Math.max(1, canvasProjectFrames(props.project)),
    })}
  />
</Fragment>;

registerRoot(RemotionRoot);
