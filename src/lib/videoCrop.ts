import type { CSSProperties } from 'react';
import type { VideoAspectRatio, VideoCropRegion } from '../types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function aspectRatioValue(aspectRatio: VideoAspectRatio, sourceWidth: number, sourceHeight: number) {
  if (aspectRatio === 'original') return sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;
  return ({ '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 } as const)[aspectRatio];
}

export function normalizeCropRegion(region: VideoCropRegion): VideoCropRegion {
  const xPercent = clamp(Number(region.xPercent) || 0, 0, 99);
  const yPercent = clamp(Number(region.yPercent) || 0, 0, 99);
  const widthPercent = clamp(Number(region.widthPercent) || 1, 1, 100 - xPercent);
  const heightPercent = clamp(Number(region.heightPercent) || 1, 1, 100 - yPercent);
  return { xPercent, yPercent, widthPercent, heightPercent };
}

export function centeredCropForAspect(aspectRatio: VideoAspectRatio, sourceWidth: number, sourceHeight: number): VideoCropRegion {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const sourceRatio = safeWidth / safeHeight;
  const targetRatio = aspectRatioValue(aspectRatio, safeWidth, safeHeight);
  if (Math.abs(sourceRatio - targetRatio) < 0.0001) return { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 };
  if (sourceRatio > targetRatio) {
    const widthPercent = (targetRatio / sourceRatio) * 100;
    return { xPercent: (100 - widthPercent) / 2, yPercent: 0, widthPercent, heightPercent: 100 };
  }
  const heightPercent = (sourceRatio / targetRatio) * 100;
  return { xPercent: 0, yPercent: (100 - heightPercent) / 2, widthPercent: 100, heightPercent };
}

export function isFullCrop(region?: VideoCropRegion) {
  if (!region) return true;
  const value = normalizeCropRegion(region);
  return value.xPercent < 0.01 && value.yPercent < 0.01 && Math.abs(value.widthPercent - 100) < 0.01 && Math.abs(value.heightPercent - 100) < 0.01;
}

export function cropVideoStyle(region?: VideoCropRegion): CSSProperties | undefined {
  if (!region || isFullCrop(region)) return undefined;
  const value = normalizeCropRegion(region);
  return {
    position: 'absolute',
    left: `${(-value.xPercent / value.widthPercent) * 100}%`,
    top: `${(-value.yPercent / value.heightPercent) * 100}%`,
    width: `${10000 / value.widthPercent}%`,
    height: `${10000 / value.heightPercent}%`,
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'fill',
  };
}
