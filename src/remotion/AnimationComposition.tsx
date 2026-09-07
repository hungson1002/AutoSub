import type { CSSProperties, ReactNode } from 'react';
import { Audio } from '@remotion/media';
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AnimationAsset, AnimationCommand, AnimationProject, CompositeScene, EvaluatedLayer } from './types';
import { evaluateScene } from '../animationStudio/evaluator';
import { buildRenderTimeline } from './timeline';

export interface AnimationCompositionProps extends Record<string, unknown> {
  project: AnimationProject;
  showSubtitles: boolean;
  assetOrigin: string;
}

const subtitleName = (name: string) => name.startsWith('Voiceover · Subtitle') || name.startsWith('Voiceover Â· Subtitle');
const assetUrl = (uri: string, origin: string) => uri.startsWith('/') ? `${origin}${uri}` : uri;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function activeSpriteCommand(scene: CompositeScene, layerId: string, timeMs: number) {
  return scene.commands
    .filter((command) => command.targetId === layerId && ['PLAY_ANIMATION', 'TALK', 'POINT', 'LOOK_AT', 'LOOK_LEFT', 'LOOK_RIGHT', 'SIT', 'SLEEP'].includes(command.type) && command.startMs <= timeMs && timeMs <= command.startMs + command.durationMs)
    .sort((a, b) => b.startMs - a.startMs)[0];
}

function spriteStyle(asset: AnimationAsset, layer: EvaluatedLayer, scene: CompositeScene, timeMs: number): CSSProperties | undefined {
  if (!asset.sprite) return undefined;
  const command = activeSpriteCommand(scene, layer.id, timeMs);
  const semantic = command?.type === 'TALK' ? 'talk' : command?.type === 'POINT' ? 'point' : command?.type === 'SIT' ? 'sit' : command?.type === 'SLEEP' ? 'sleep' : command?.type === 'LOOK_LEFT' ? 'look-left' : command?.type === 'LOOK_RIGHT' ? 'look-right' : undefined;
  const clipName = command?.animation || (semantic && asset.sprite.clips[semantic] ? semantic : undefined) || layer.animation || Object.keys(asset.sprite.clips)[0];
  const clip = clipName ? asset.sprite.clips[clipName] : undefined;
  if (!clip) return undefined;
  const elapsed = Math.max(0, timeMs - (command?.startMs || 0));
  const length = Math.max(1, clip.to - clip.from + 1);
  const offset = Math.floor(elapsed / 1000 * clip.fps);
  const spriteFrame = clip.loop === false ? Math.min(clip.to, clip.from + offset) : clip.from + offset % length;
  const column = spriteFrame % asset.sprite.columns;
  const row = Math.floor(spriteFrame / asset.sprite.columns);
  const sheetWidth = asset.sprite.columns * asset.sprite.frameWidth;
  const rows = Math.ceil(asset.sprite.frameCount / asset.sprite.columns);
  const sheetHeight = rows * asset.sprite.frameHeight;
  return {
    backgroundImage: `url(${asset.uri})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${sheetWidth / asset.sprite.frameWidth * 100}% ${sheetHeight / asset.sprite.frameHeight * 100}%`,
    backgroundPosition: `${asset.sprite.columns <= 1 ? 0 : column / (asset.sprite.columns - 1) * 100}% ${rows <= 1 ? 0 : row / (rows - 1) * 100}%`,
  };
}

function SubtitleText({ layer, timeMs }: { layer: EvaluatedLayer; timeMs: number }) {
  const timings = layer.wordTimings || [];
  if (!timings.length) return <>{layer.text || layer.name}</>;
  const found = timings.findIndex((timing) => timeMs < timing.endMs);
  const activeIndex = found < 0 ? timings.length - 1 : found;
  const cue = timings.slice(Math.floor(activeIndex / 7) * 7, Math.floor(activeIndex / 7) * 7 + 7);
  return <>{cue.map((timing, index) => <span key={`${timing.startMs}-${index}`} style={{ color: timeMs >= timing.startMs && timeMs < timing.endMs ? '#ff9a58' : layer.fill || '#fff' }}>{index ? ' ' : ''}{timing.word}</span>)}</>;
}

function layerBody(layer: EvaluatedLayer, asset: AnimationAsset | undefined, scene: CompositeScene, timeMs: number, origin: string): ReactNode {
  if (layer.type === 'image' && asset) return <Img src={assetUrl(asset.uri, origin)} style={{ width: '100%', height: '100%', objectFit: asset.type === 'background' ? 'cover' : 'fill' }} />;
  if (layer.type === 'sprite' && asset) {
    const normalized = { ...asset, uri: assetUrl(asset.uri, origin) };
    const style = spriteStyle(normalized, layer, scene, timeMs);
    return style ? <div style={{ width: '100%', height: '100%', ...style }} /> : <Img src={normalized.uri} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
  }
  if (layer.type === 'text') return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', whiteSpace: 'pre-wrap', overflow: 'hidden', color: layer.fill || '#fff', fontFamily: 'Inter, Arial, sans-serif', fontWeight: 700, fontSize: layer.fontSize || 54, lineHeight: 1.12, textShadow: '0 3px 18px rgba(0,0,0,.78)' }}><SubtitleText layer={layer} timeMs={timeMs} /></div>;
  if (layer.type === 'chart') {
    const values = layer.data?.length ? layer.data : [24, 52, 78]; const maximum = Math.max(1, ...values);
    return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', gap: '4%', padding: '8%', background: 'rgba(9,17,27,.72)', boxSizing: 'border-box' }}>{values.map((value, index) => <div key={index} style={{ flex: 1, height: `${value / maximum * 78}%`, minHeight: 2, borderRadius: '8px 8px 0 0', background: `linear-gradient(${layer.fill || '#ff8a45'}, #7655d8)`, position: 'relative' }}><span style={{ position: 'absolute', width: '100%', top: '100%', paddingTop: 6, textAlign: 'center', color: '#dfe9f3', font: `${Math.max(12, layer.fontSize || 24)}px Inter, sans-serif` }}>{layer.labels?.[index] || value}</span></div>)}</div>;
  }
  if (layer.type === 'diagram') return <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M8 50 H82 M82 20 L96 50 L82 80" fill="none" stroke={layer.fill || '#ff8a45'} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (layer.type === 'particle') return <div style={{ width: '100%', height: '100%', position: 'relative' }}>{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ position: 'absolute', display: 'block', left: `${(index * 73 % 101)}%`, top: `${((index * 47 + Math.floor(timeMs / 40)) % 101)}%`, width: 4 + index % 5, height: 4 + index % 5, borderRadius: '50%', opacity: .3 + index % 7 / 10, background: layer.fill || '#fff' }} />)}</div>;
  return <div style={{ width: '100%', height: '100%', borderRadius: layer.shape === 'ellipse' ? '50%' : 0, background: layer.fill || '#6f7f91' }} />;
}

function VisualLayer({ layer, assets, scene, timeMs, origin, evaluatedLayers }: { layer: EvaluatedLayer; assets: AnimationAsset[]; scene: CompositeScene; timeMs: number; origin: string; evaluatedLayers: EvaluatedLayer[] }) {
  const asset = assets.find((item) => item.id === layer.assetId);
  const lookAt = scene.commands.filter((command: AnimationCommand) => command.targetId === layer.id && command.type === 'LOOK_AT' && command.startMs <= timeMs && timeMs <= command.startMs + command.durationMs).sort((a, b) => b.startMs - a.startMs)[0];
  const target = lookAt?.target ? evaluatedLayers.find((item) => item.id === lookAt.target) : undefined;
  const facing = target && target.transform.position.x < layer.transform.position.x ? -1 : 1;
  const { position, scale, anchor } = layer.transform;
  return <div style={{ position: 'absolute', left: position.x - layer.width * anchor.x, top: position.y - layer.height * anchor.y, width: layer.width, height: layer.height, opacity: clamp(layer.transform.opacity, 0, 1), transformOrigin: `${anchor.x * 100}% ${anchor.y * 100}%`, transform: `rotate(${layer.transform.rotation}deg) scale(${scale.x * facing}, ${scale.y})`, overflow: layer.type === 'text' ? 'visible' : 'hidden' }}>{layerBody(layer, asset, scene, timeMs, origin)}</div>;
}

function SceneComposition({ scene, project, origin, showSubtitles, sceneDurationInFrames, transitionInFrames, transitionOutFrames }: { scene: CompositeScene; project: AnimationProject; origin: string; showSubtitles: boolean; sceneDurationInFrames: number; transitionInFrames: number; transitionOutFrames: number }) {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const timeMs = frame / fps * 1000;
  const evaluated = evaluateScene(scene, timeMs);
  const fadeIn = transitionInFrames <= 1 ? 1 : interpolate(frame, [0, transitionInFrames - 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = transitionOutFrames <= 1 ? (transitionOutFrames && frame >= sceneDurationInFrames - 1 ? 0 : 1) : interpolate(frame, [sceneDurationInFrames - transitionOutFrames, sceneDurationInFrames - 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const camera = evaluated.camera;
  return <AbsoluteFill style={{ backgroundColor: scene.backgroundColor, opacity: Math.min(fadeIn, fadeOut), overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: 0, transformOrigin: '50% 50%', transform: `translate(${camera.position.x}px, ${camera.position.y}px) rotate(${camera.rotation}deg) scale(${camera.scale.x}, ${camera.scale.y})`, opacity: clamp(camera.opacity, 0, 1) }}>
      {evaluated.layers.filter((layer) => layer.type !== 'audio' && (showSubtitles || !subtitleName(layer.name))).map((layer) => <VisualLayer key={layer.id} layer={layer} assets={project.assets} scene={scene} timeMs={timeMs} origin={origin} evaluatedLayers={evaluated.layers} />)}
    </div>
    {scene.layers.filter((layer) => layer.type === 'audio' && layer.assetId).map((layer) => {
      const asset = project.assets.find((item) => item.id === layer.assetId); if (!asset) return null;
      const from = Math.max(0, Math.round((layer.startMs || 0) / 1000 * fps));
      const duration = layer.durationMs ? Math.max(1, Math.round(layer.durationMs / 1000 * fps)) : undefined;
      const music = asset.tags.some((tag) => /^(?:music|bgm|nhac)$/i.test(tag));
      const hasVoice = scene.layers.some((item) => item.type === 'audio' && item.name.startsWith('Voiceover'));
      const volume = clamp((layer.volume ?? layer.transform.opacity) * (music && hasVoice ? .3 : 1), 0, 1);
      return <Sequence key={layer.id} from={from} durationInFrames={duration}><Audio src={assetUrl(asset.uri, origin)} volume={volume} /></Sequence>;
    })}
  </AbsoluteFill>;
}

export function AnimationComposition({ project, showSubtitles, assetOrigin }: AnimationCompositionProps) {
  const timeline = buildRenderTimeline(project);
  return <AbsoluteFill style={{ backgroundColor: '#090d13' }}>{timeline.map((range) => range.scene.renderMode === 'composite' ? <Sequence key={range.scene.id} from={range.from} durationInFrames={range.durationInFrames} premountFor={Math.min(project.fps, range.from)}><SceneComposition scene={range.scene} project={project} origin={assetOrigin} showSubtitles={showSubtitles} sceneDurationInFrames={range.durationInFrames} transitionInFrames={range.transitionInFrames} transitionOutFrames={range.transitionOutFrames} /></Sequence> : null)}</AbsoluteFill>;
}
