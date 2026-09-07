import { Composition, registerRoot } from 'remotion';
import type { AnimationProject } from '../../shared/animationStudio';
import { AnimationComposition, type AnimationCompositionProps } from './AnimationComposition';
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

const defaultProps: AnimationCompositionProps = { project: fallbackProject, showSubtitles: true, assetOrigin: 'http://127.0.0.1:8787' };

const RemotionRoot = () => <Composition
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
/>;

registerRoot(RemotionRoot);
