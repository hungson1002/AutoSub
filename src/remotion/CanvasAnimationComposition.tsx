import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Audio } from '@remotion/media';
import { TransitionSeries } from '@remotion/transitions';
import { AbsoluteFill, continueRender, delayRender, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CanvasStudioProject, CanvasStudioScene } from '../../shared/canvasAnimationStudio';
import { preloadCanvasSceneImages, renderCanvasScene } from '../canvasAnimationStudio/renderer';
import {hasCanvasCaptions,drawCanvasCaption} from '../canvasAnimationStudio/captions';

export interface CanvasAnimationCompositionProps extends Record<string, unknown> {
  project: CanvasStudioProject;
  assetOrigin: string;
}

const absoluteUrl = (uri: string, origin: string) => uri.startsWith('/') ? `${origin}${uri}` : uri;

function isHorrorCanvasProject(project: CanvasStudioProject) {
  const prompt = project.sourcePrompt || '';
  return /ma\s*x[oó]|truy[eệ]n\s*ma|kinh\s*d[iị]|horror|ghost|haunted|g[aầ]m\s*s[aà]n/iu.test(prompt)
    || project.scenes.some((scene) => scene.backgroundRef === 'bg:night-stilt-house' || scene.backgroundRef === 'bg:room-underfloor');
}

function splitCaptionText(value: string) {
  const clauses = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…:])\s+/u)
    .filter(Boolean);
  const output: string[] = [];
  for (const clause of clauses) {
    const words = clause.split(/\s+/).filter(Boolean);
    if (words.length <= 10) {
      output.push(clause);
      continue;
    }
    for (let index = 0; index < words.length; index += 9) {
      output.push(words.slice(index, index + 9).join(' '));
    }
  }
  return output.length ? output : [String(value || '').trim()].filter(Boolean);
}

function captionAt(scene: CanvasStudioScene, timeMs: number) {
  if(scene.captionTrack) {
    const source=scene.captionTrack;
    const elapsed=timeMs+source.offsetMs;
    if(elapsed>=source.durationMs)return '';
    return captionAt({...scene,captionTrack:undefined,dialogue:undefined,narration:source.text,durationMs:source.durationMs},elapsed);
  }
  if (scene.dialogue?.length) {
    const active=scene.dialogue.find(line=>timeMs>=(line.atMs??0)&&timeMs<(line.atMs??0)+(line.durationMs??0));
    if(!active)return '';
    return captionAt({...scene,dialogue:undefined,narration:active.text,durationMs:active.durationMs||1},timeMs-(active.atMs??0));
  }
  const chunks = splitCaptionText(scene.narration || '');
  if (!chunks.length) return '';
  const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).filter(Boolean).length));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const target = Math.max(0, Math.min(.999999, timeMs / Math.max(1, scene.durationMs))) * total;
  let cursor = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    cursor += weights[index]!;
    if (target < cursor) return chunks[index]!;
  }
  return chunks[chunks.length - 1]!;
}

function HorrorCaption({ scene, project }: { scene: CanvasStudioScene; project: CanvasStudioProject }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const caption = captionAt(scene, frame / fps * 1000);
  if (!caption) return null;
  const fontSize = Math.max(24, Math.round(project.height * .042));
  return <div
    style={{
      position: 'absolute',
      left: '8%',
      right: '8%',
      bottom: '5.2%',
      zIndex: 200,
      color: '#fff',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize,
      fontWeight: 700,
      lineHeight: 1.28,
      textAlign: 'center',
      WebkitTextStroke: `${Math.max(2, Math.round(fontSize * .09))}px rgba(0,0,0,.96)`,
      paintOrder: 'stroke fill',
      textShadow: '0 2px 3px rgba(0,0,0,.9)',
      letterSpacing: '.01em',
      pointerEvents: 'none',
    }}
  >{caption}</div>;
}

function CanvasSceneFrame({ scene, project, assetOrigin }: { scene: CanvasStudioScene; project: CanvasStudioProject; assetOrigin: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [assetHandle] = useState(() => delayRender(`canvas-assets-${scene.id}`));
  const timeMs = frame / fps * 1000;

  useEffect(() => {
    let active = true;
    void preloadCanvasSceneImages(scene, assetOrigin)
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
        continueRender(assetHandle);
      });
    return () => { active = false; };
  }, [assetHandle, assetOrigin, scene]);

  useLayoutEffect(() => {
    if (!ready) return;
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    renderCanvasScene(context, scene, timeMs, project.width, project.height, assetOrigin);
    if(hasCanvasCaptions(project))drawCanvasCaption(context,scene,timeMs,project.width,project.height);
  }, [assetOrigin, frame, project.height, project.width, ready, scene, timeMs]);

  return <canvas ref={ref} width={project.width} height={project.height} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

function SketchCutOverlay({ durationInFrames, direction }: { durationInFrames: number; direction: 1 | -1 }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(.16, 1, .3, 1),
  });
  const flash = interpolate(progress, [0, .32, .66, 1], [0, .18, .08, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const sweep = interpolate(progress, [0, 1], [direction > 0 ? -38 : 138, direction > 0 ? 138 : -38]);
  const inkOpacity = interpolate(progress, [0, .18, .62, 1], [0, .34, .2, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
    <AbsoluteFill style={{ backgroundColor: '#fff8e8', opacity: flash }} />
    <div
      style={{
        position: 'absolute',
        top: '-20%',
        left: `${sweep}%`,
        width: '28%',
        height: '140%',
        rotate: direction > 0 ? '-7deg' : '7deg',
        translate: '-50% 0',
        opacity: inkOpacity,
        background: 'linear-gradient(90deg, transparent 0%, rgba(36,33,30,.16) 20%, rgba(255,248,232,.88) 50%, rgba(36,33,30,.12) 78%, transparent 100%)',
        filter: 'blur(2px)',
      }}
    />
  </AbsoluteFill>;
}

function MatchCutOverlay({ durationInFrames }: { durationInFrames: number }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(.3, 0, .2, 1),
  });
  const dip = interpolate(progress, [0, .5, 1], [0, .12, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const push = interpolate(progress, [0, 1], [14, -14], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
    <AbsoluteFill style={{ backgroundColor: '#f5f1e7', opacity: dip }} />
    <div style={{ position: 'absolute', inset: 0, translate: `${push}px 0`, opacity: 0.06, background: 'linear-gradient(90deg, transparent, rgba(36,33,30,.5), transparent)' }} />
  </AbsoluteFill>;
}

function isMatchCut(a: CanvasStudioScene, b: CanvasStudioScene): boolean {
  if (!a || !b) return false;
  if (a.background && a.background === b.background) return true;
  if (a.template && a.template === b.template) return true;
  const tactical = new Set(['diagram-clean', 'split-contrast']);
  if (tactical.has(a.template || '') && tactical.has(b.template || '')) return true;
  if ((a.background === 'map' || b.background === 'map') && a.background === b.background) return true;
  return false;
}
export function canvasSceneFrames(scene: CanvasStudioScene, fps: number) {
  return Math.max(1, Math.round(Math.max(1, scene.durationMs) / 1000 * fps));
}

export function canvasProjectFrames(project: CanvasStudioProject) {
  return project.scenes.reduce((total, scene) => total + canvasSceneFrames(scene, project.fps), 0);
}

export function CanvasAnimationComposition({ project, assetOrigin }: CanvasAnimationCompositionProps) {
  const horror = isHorrorCanvasProject(project);
  // Mẫu Vui Vẻ cắt khô hard-cut: không overlay chuyển cảnh, không lòi nền trắng.
  return <AbsoluteFill style={{ backgroundColor: '#f5f1e7' }}>
    <TransitionSeries>
      {project.scenes.map((scene) => {
        const durationInFrames = canvasSceneFrames(scene, project.fps);
        return <Fragment key={scene.id}>
          <TransitionSeries.Sequence durationInFrames={durationInFrames} name={scene.name}>
            <CanvasSceneFrame scene={scene} project={project} assetOrigin={assetOrigin} />
            {scene.audioUrl ? <Audio src={absoluteUrl(scene.audioUrl, assetOrigin)} volume={1} /> : null}
          </TransitionSeries.Sequence>
        </Fragment>;
      })}
    </TransitionSeries>
  </AbsoluteFill>;
}
