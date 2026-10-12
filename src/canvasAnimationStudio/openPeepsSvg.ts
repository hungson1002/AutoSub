import { Avatar, Style } from '@dicebear/core';
import definition from '@dicebear/styles/open-peeps.json';
import type { CanvasStudioObject, CanvasStudioScene } from './types';

const openPeepsStyle = new Style(definition);
const svgCache = new Map<string, string>();

const HEADS = {
  short: ['short1', 'short2', 'short3', 'short4', 'short5'],
  crop: ['shaved1', 'shaved2', 'shaved3'],
  messy: ['medium1', 'medium2', 'mediumBangs', 'mediumBangs2'],
  bald: ['noHair1', 'noHair2', 'noHair3'],
  bun: ['bun', 'bun2', 'grayBun'],
  hat: ['noHair2', 'short2'],
} as const;

const EXPRESSIONS = {
  neutral: ['calm', 'blank', 'serious'],
  happy: ['smile', 'smileBig', 'lovingGrin1'],
  angry: ['rage', 'veryAngry', 'driven'],
  surprised: ['awe', 'concernedFear'],
  sad: ['concerned', 'solemn', 'tired'],
  afraid: ['concernedFear', 'concerned'],
} as const;

function stableIndex(value: string, length: number) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % Math.max(1, length);
}

function normalizeColor(value: string | undefined, fallback: string) {
  const color = value?.replace('#', '').trim();
  return color && /^[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function selectedHead(object: CanvasStudioObject) {
  const group = HEADS[object.hair || 'short'];
  const key = object.characterKey || object.label || object.id;
  return group[stableIndex(key, group.length)]!;
}

function selectedExpression(object: CanvasStudioObject) {
  const group = EXPRESSIONS[object.expression || 'neutral'];
  const key = `${object.characterKey || object.label || object.id}:${object.expression || 'neutral'}`;
  return group[stableIndex(key, group.length)]!;
}

export function shouldUseOpenPeeps(scene: CanvasStudioScene, object: CanvasStudioObject) {
  if (object.kind !== 'character') return false;
  if(object.visualStyle==='horror')return false;
  // Open Peeps works for bright editorial explainers, but its friendly facial
  // vocabulary reads as comedy in the Ma Xó world. Horror shots stay on the
  // authored hand-drawn actor so close-ups remain restrained and ominous.
  if (scene.backgroundRef === 'bg:night-stilt-house'
    || scene.backgroundRef === 'bg:room-stilt-house'
    || scene.backgroundRef === 'bg:room-underfloor') return false;
  if (!['narrator', 'scholar', 'villager', 'merchant', 'worker'].includes(object.archetype || 'narrator')) return false;
  if (!['idle', 'talk'].includes(object.pose || 'idle')) return false;
  const shot = scene.camera?.shot || 'medium';
  return ['medium', 'close-up', 'extreme-close-up'].includes(shot);
}

export function openPeepsCharacterSvg(object: CanvasStudioObject) {
  const seed = object.characterKey || object.assetKey || object.label || object.id;
  const cacheKey = [
    seed,
    object.expression || 'neutral',
    object.hair || 'short',
    object.color,
    object.archetype || 'narrator',
  ].join('|');
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  const facialHairProbability = ['scholar', 'merchant'].includes(object.archetype || '') ? 18 : 0;
  const avatar = new Avatar(openPeepsStyle, {
    seed,
    headVariant: [selectedHead(object)],
    expressionVariant: [selectedExpression(object)],
    clothingColor: [normalizeColor(object.color, '8a725f')],
    accessoriesProbability: 0,
    maskProbability: 0,
    facialHairProbability,
  });
  const svg = avatar.toString();
  svgCache.set(cacheKey, svg);
  return svg;
}

export function openPeepsCharacterDataUri(object: CanvasStudioObject) {
  const svg = openPeepsCharacterSvg(object);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
