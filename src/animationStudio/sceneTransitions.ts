import type { CSSProperties } from 'react';
import type { AnimationScene, SceneTransition, SceneTransitionType } from '../../shared/animationStudio';

export const DEFAULT_SCENE_TRANSITION: SceneTransition = { type: 'crossfade', durationMs: 320 };

export const SCENE_TRANSITION_OPTIONS: Array<{ value: SceneTransitionType; label: string }> = [
  { value: 'cut', label: 'Cắt thẳng' },
  { value: 'crossfade', label: 'Hòa tan' },
  { value: 'fade-black', label: 'Mờ qua đen' },
  { value: 'slide-left', label: 'Trượt trái' },
  { value: 'slide-right', label: 'Trượt phải' },
  { value: 'slide-up', label: 'Trượt lên' },
  { value: 'zoom', label: 'Zoom mềm' },
  { value: 'wipe-left', label: 'Quét ngang' },
];

export function sceneTransition(scene: AnimationScene): SceneTransition {
  const transition = scene.transition || DEFAULT_SCENE_TRANSITION;
  return transition.type === 'cut' ? { type: 'cut', durationMs: 0 } : { ...transition, durationMs: Math.max(80, Math.min(2000, transition.durationMs)) };
}

export function sceneTransitionStyles(type: SceneTransitionType, rawProgress: number): { outgoing: CSSProperties; incoming: CSSProperties } {
  const progress = Math.max(0, Math.min(1, rawProgress));
  const base: CSSProperties = { willChange: 'transform, opacity, clip-path' };
  if (type === 'fade-black') return { outgoing: { ...base, opacity: Math.max(0, 1 - progress * 2) }, incoming: { ...base, opacity: Math.max(0, progress * 2 - 1) } };
  if (type === 'slide-left') return { outgoing: { ...base, transform: `translate3d(${-18 * progress}%,0,0)` }, incoming: { ...base, transform: `translate3d(${100 * (1 - progress)}%,0,0)` } };
  if (type === 'slide-right') return { outgoing: { ...base, transform: `translate3d(${18 * progress}%,0,0)` }, incoming: { ...base, transform: `translate3d(${-100 * (1 - progress)}%,0,0)` } };
  if (type === 'slide-up') return { outgoing: { ...base, transform: `translate3d(0,${-14 * progress}%,0)` }, incoming: { ...base, transform: `translate3d(0,${100 * (1 - progress)}%,0)` } };
  if (type === 'zoom') return { outgoing: { ...base, opacity: 1 - progress * .45, transform: `scale(${1 - progress * .04})` }, incoming: { ...base, opacity: progress, transform: `scale(${1.08 - progress * .08})` } };
  if (type === 'wipe-left') return { outgoing: base, incoming: { ...base, clipPath: `inset(0 ${100 * (1 - progress)}% 0 0)` } };
  if (type === 'crossfade') return { outgoing: { ...base, opacity: 1 - progress }, incoming: { ...base, opacity: progress } };
  return { outgoing: base, incoming: base };
}
