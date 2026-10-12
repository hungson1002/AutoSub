import {evaluateAttachedProp,resolveCanvasLight} from './propAttachment';
import { evaluateCanvasCamera, evaluateCanvasObject } from './runtime';
import { resolveSpriteAct, spriteFrameAt } from './spriteFrames';
import { spriteContentBounds, type SpriteContentBounds } from './spriteContentBounds';
const spriteBoundsCache = new WeakMap<HTMLImageElement, Map<string, SpriteContentBounds>>();
function clipContentBounds(image: HTMLImageElement, fw: number, fh: number, columns: number, from: number, to: number) {
  let cached = spriteBoundsCache.get(image);
  if (!cached) { cached = new Map(); spriteBoundsCache.set(image, cached); }
  const key = [fw, fh, columns, from, to].join(':');
  const found = cached.get(key); if (found) return found;
  let bounds = { x: 0, y: 0, width: fw, height: fh };
  try {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) { context.drawImage(image, 0, 0); bounds = spriteContentBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, fw, fh, columns, from, to); }
  } catch { /* Cross-origin legacy assets keep their original frame bounds. */ }
  cached.set(key, bounds); return bounds;
}
import { applyCanvasChoreographyState } from './choreography';
import { isCanvasActorSpeaking, canvasActorSpeechLevel } from '../../shared/canvasDialogue';
import { isVoiceActiveAt, resolveVoiceWindows } from '../../shared/canvasBeats';
import { drawProceduralBackgroundBase, drawProceduralBackgroundDetails, drawProceduralProp } from './proceduralIllustrationEngine';
import { drawAuthoredCharacter, drawAuthoredProp, drawAuthoredShip, drawAuthoredStake } from './authoredVectorAssets';
import { drawAuthoredBackground } from './authoredBackgrounds';
import { openPeepsCharacterDataUri } from './openPeepsSvg';
import { drawCharacterV2, drawCharacterContactArms, drawHorrorCharacter } from './characters/characterRenderer';
import {canvasCharacterLocalGroundOffset} from './characters/characterStaging';
import {drawWaterSpirit} from './characters/waterSpirit';
import { drawFolkCharacter, drawFolkTree, drawFolkBackground, drawFolkContactLimbs, hideFolkBackgroundSpirit } from './folkHorrorRenderer';
import { isFolkHorrorScene } from '../../shared/canvasFolkHorror';
import {canvasFloorPropBottomRatio,canvasUnderwaterInsert,canvasLampMountedOnPost,canvasLanternUsesHandlePivot} from '../../shared/canvasSpatialRelations';
import type { CanvasSceneEffect, CanvasStudioObject, CanvasStudioScene } from './types';
import {drawVectorScene} from './vectorSceneRenderer';

const imageCache = new Map<string, HTMLImageElement>();
function resolveAssetUrl(src: string, assetOrigin?: string) {
  if (!src) return src;
  if (/^(?:data:|blob:|https?:)/i.test(src)) return src;
  if (src.startsWith('/') && assetOrigin) return `${assetOrigin.replace(/\/$/, '')}${src}`;
  return src;
}

function getImage(src: string, assetOrigin?: string) {
  const resolved = resolveAssetUrl(src, assetOrigin);
  let image = imageCache.get(resolved);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.src = resolved;
    imageCache.set(resolved, image);
  }
  return image;
}

export function clearCanvasImageCache() {
  for (const image of imageCache.values()) {
    try { image.removeAttribute('src'); image.src = ''; } catch { /* best-effort decoded bitmap release */ }
  }
  imageCache.clear();
}

export async function preloadCanvasSceneImages(scene: CanvasStudioScene, assetOrigin?: string) {
  const sources = [...new Set([
    scene.backgroundImageUrl,
    ...scene.objects.map((item) => item.imageUrl),
    ...scene.objects.flatMap((item) => (item.spriteActs || []).map((act) => act.imageUrl)),
  ].filter((item): item is string => Boolean(item)))];
  await Promise.all(sources.map((src) => new Promise<void>((resolve) => {
    const image = getImage(src, assetOrigin);
    if (image.complete) {
      resolve();
      return;
    }
    const done = () => resolve();
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
  })));
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function handLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(
    x1 + dx * 0.34 + dy * 0.018,
    y1 + dy * 0.3 - dx * 0.012,
    x1 + dx * 0.68 - dy * 0.02,
    y1 + dy * 0.72 + dx * 0.014,
    x2,
    y2,
  );
  ctx.stroke();
}

function drawBackground(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const preset = scene.background;
  if (preset === 'paper') {
    ctx.fillStyle = '#f5f1e7';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(58, 47, 39, 0.08)';
    ctx.lineWidth = 1;
    for (let y = 50; y < height; y += 46) handLine(ctx, 0, y, width, y + 2);
    return;
  }
  if (preset === 'room') {
    ctx.fillStyle = '#eee4d5'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#c9a77b'; ctx.fillRect(0, height * .72, width, height * .28);
    ctx.strokeStyle = '#8d755e'; ctx.lineWidth = 5; handLine(ctx, 0, height * .72, width, height * .72);
    ctx.fillStyle = '#bcd5de'; ctx.fillRect(width * .68, height * .15, width * .2, height * .28);
    ctx.strokeRect(width * .68, height * .15, width * .2, height * .28);
    return;
  }
  if (preset === 'city') {
    ctx.fillStyle = '#d9e7ea'; ctx.fillRect(0, 0, width, height);
    const blocks: Array<[number, number, number, number]> = [[0,.43,.16,.57],[.14,.3,.18,.7],[.31,.5,.14,.5],[.44,.22,.2,.78],[.63,.4,.15,.6],[.77,.28,.23,.72]];
    for (const [x,y,w,h] of blocks) { ctx.fillStyle = '#8b9aa0'; ctx.fillRect(width*x, height*y, width*w, height*h); }
    ctx.fillStyle = '#59676d'; ctx.fillRect(0, height * .8, width, height * .2);
    return;
  }
  if (preset === 'underwater') {
    const water = ctx.createLinearGradient(0, 0, 0, height);
    water.addColorStop(0, '#5f9dac');
    water.addColorStop(.48, '#366f7f');
    water.addColorStop(1, '#173f4d');
    ctx.fillStyle = water; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(231,248,248,.24)'; ctx.lineWidth = 3;
    for (let row = 0; row < 7; row += 1) handLine(ctx, 30 + row * 15, 42 + row * 74, width - 40, 48 + row * 74);
    ctx.fillStyle = '#6d6650';
    ctx.beginPath();
    ctx.moveTo(0, height * .86);
    ctx.bezierCurveTo(width * .22, height * .8, width * .55, height * .92, width, height * .83);
    ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fill();
    return;
  }
  if (preset === 'map') {
    ctx.fillStyle = '#efe5cf'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#8e7c62'; ctx.lineWidth = 5;
    ctx.fillStyle = '#c8b68f';
    ctx.beginPath();
    ctx.moveTo(width * .08, height * .2);
    ctx.bezierCurveTo(width * .2, height * .08, width * .3, height * .24, width * .38, height * .16);
    ctx.bezierCurveTo(width * .48, height * .07, width * .55, height * .3, width * .47, height * .43);
    ctx.bezierCurveTo(width * .35, height * .58, width * .2, height * .48, width * .1, height * .64);
    ctx.bezierCurveTo(width * .03, height * .52, width * .05, height * .32, width * .08, height * .2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(width * .58, height * .3);
    ctx.bezierCurveTo(width * .7, height * .16, width * .9, height * .25, width * .92, height * .48);
    ctx.bezierCurveTo(width * .82, height * .62, width * .7, height * .7, width * .58, height * .58);
    ctx.bezierCurveTo(width * .52, height * .48, width * .53, height * .38, width * .58, height * .3);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(70,92,101,.3)'; ctx.lineWidth = 2;
    for (let row = 0; row < 8; row += 1) handLine(ctx, 0, 40 + row * 86, width, 44 + row * 86);
    return;
  }

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  if (preset === 'night') {
    sky.addColorStop(0, '#17243b');
    sky.addColorStop(1, '#53677a');
  } else if (preset === 'field') {
    sky.addColorStop(0, '#d9edf0');
    sky.addColorStop(1, '#fbf4d9');
  } else {
    sky.addColorStop(0, '#cfe7ec');
    sky.addColorStop(1, '#f5e8c9');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  if (preset === 'night') {
    ctx.fillStyle = '#e8ddac';
    ctx.beginPath();
    ctx.arc(width * 0.82, 95, 34, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = preset === 'field' ? '#a9bd75' : '#879b65';
  ctx.beginPath();
  ctx.moveTo(0, height * 0.58);
  ctx.bezierCurveTo(width * 0.2, height * 0.47, width * 0.36, height * 0.58, width * 0.52, height * 0.52);
  ctx.bezierCurveTo(width * 0.7, height * 0.46, width * 0.84, height * 0.55, width, height * 0.49);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  if (preset !== 'field') {
    ctx.fillStyle = preset === 'night' ? '#304e67' : '#6f9fb0';
    ctx.beginPath();
    ctx.moveTo(0, height * 0.62);
    ctx.bezierCurveTo(width * 0.24, height * 0.58, width * 0.52, height * 0.7, width, height * 0.59);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = preset === 'night' ? 'rgba(225,235,239,.23)' : 'rgba(255,255,255,.42)';
    ctx.lineWidth = 3;
    for (let row = 0; row < 6; row += 1) {
      const y = height * 0.68 + row * 42;
      handLine(ctx, 40 + row * 18, y, width - 70, y + 7);
    }
  }
}

function drawCharacter(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, timeMs: number) {
  const width = object.width;
  const height = object.height;
  const headRadius = Math.min(width * 0.39, height * 0.2);
  let headY = -height * 0.3;
  const bodyTop = -height * 0.07;
  const pose = object.pose || 'idle';
  const gait = Math.sin(timeMs / 125);
  const gesture = Math.sin(timeMs / 180);
  const facing = object.facing === 'left' ? -1 : 1;
  // Secondary head bob: walk/run bounce, celebrate jump, talk nod.
  if (pose === 'run') headY += Math.abs(gait) * -4;
  else if (pose === 'celebrate') headY += Math.sin(timeMs / 160) * -5;
  else if (pose === 'talk') headY += Math.sin(timeMs / 240) * 1.6;

  ctx.save();
  ctx.scale(facing, 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = object.accent;
  ctx.lineWidth = Math.max(4, width * 0.032);

  // Thin editorial limbs are drawn first so the torso reads cleanly on top.
  const shoulderY = bodyTop + height * 0.08;
  const hipY = bodyTop + height * 0.35;
  let leftHand = { x: -width * 0.5, y: shoulderY + height * 0.2 };
  let rightHand = { x: width * 0.5, y: shoulderY + height * 0.18 };
  if (pose === 'point') {
    rightHand = { x: width * 0.72, y: shoulderY - height * 0.05 };
    leftHand = { x: -width * 0.38, y: shoulderY + height * 0.24 };
  } else if (pose === 'talk') {
    rightHand = { x: width * (0.48 + gesture * .05), y: shoulderY - height * (0.04 + gesture * .025) };
    leftHand = { x: -width * (0.46 - gesture * .04), y: shoulderY + height * (0.16 - gesture * .03) };
  } else if (pose === 'run') {
    leftHand = { x: -width * (0.46 + gait * .1), y: shoulderY + height * (.12 - gait * .08) };
    rightHand = { x: width * (0.46 - gait * .1), y: shoulderY + height * (.12 + gait * .08) };
  } else if (pose === 'row') {
    rightHand = { x: width * (.48 + gesture * .12), y: shoulderY + height * (.14 + gesture * .08) };
    leftHand = { x: width * (.12 + gesture * .08), y: shoulderY + height * (.1 + gesture * .06) };
  } else if (pose === 'brace') {
    leftHand = { x: -width * .68, y: shoulderY + height * .04 };
    rightHand = { x: width * .68, y: shoulderY + height * .04 };
  } else if (pose === 'celebrate') {
    leftHand = { x: -width * .5, y: shoulderY - height * .3 };
    rightHand = { x: width * .5, y: shoulderY - height * .3 };
  }

  handLine(ctx, -width * 0.22, shoulderY, leftHand.x, leftHand.y);
  handLine(ctx, width * 0.22, shoulderY, rightHand.x, rightHand.y);

  const legSwing = pose === 'run' ? gait * width * .14 : 0;
  handLine(ctx, -width * 0.13, hipY, -width * 0.28 + legSwing, height * 0.47);
  handLine(ctx, width * 0.13, hipY, width * 0.28 - legSwing, height * 0.47);

  // Organic shirt silhouette instead of a hard rectangle.
  ctx.fillStyle = object.color;
  ctx.beginPath();
  ctx.moveTo(-width * .28, bodyTop);
  ctx.quadraticCurveTo(-width * .33, bodyTop + height * .18, -width * .22, hipY);
  ctx.quadraticCurveTo(0, hipY + height * .045, width * .22, hipY);
  ctx.quadraticCurveTo(width * .33, bodyTop + height * .18, width * .28, bodyTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f1c49f';
  ctx.beginPath();
  ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Loose hand-drawn hair mass; intentionally asymmetrical.
  ctx.fillStyle = object.accent;
  ctx.beginPath();
  ctx.moveTo(-headRadius * .9, headY - headRadius * .2);
  ctx.quadraticCurveTo(-headRadius * .82, headY - headRadius * 1.0, -headRadius * .08, headY - headRadius * 1.03);
  ctx.quadraticCurveTo(headRadius * .7, headY - headRadius * .98, headRadius * .86, headY - headRadius * .35);
  ctx.quadraticCurveTo(headRadius * .48, headY - headRadius * .62, headRadius * .16, headY - headRadius * .55);
  ctx.quadraticCurveTo(-headRadius * .3, headY - headRadius * .72, -headRadius * .9, headY - headRadius * .2);
  ctx.fill();

  const eyeY = headY - headRadius * 0.04;
  const expression = object.expression || 'neutral';
  ctx.fillStyle = object.accent;
  ctx.strokeStyle = object.accent;
  if (expression === 'angry') {
    ctx.lineWidth = Math.max(3, width * 0.023);
    handLine(ctx, -headRadius * 0.57, eyeY - 8, -headRadius * 0.18, eyeY + 1);
    handLine(ctx, headRadius * 0.57, eyeY - 8, headRadius * 0.18, eyeY + 1);
  } else if (expression === 'sad') {
    ctx.lineWidth = Math.max(3, width * 0.021);
    handLine(ctx, -headRadius * .52, eyeY + 1, -headRadius * .18, eyeY - 5);
    handLine(ctx, headRadius * .52, eyeY + 1, headRadius * .18, eyeY - 5);
  }
  ctx.beginPath();
  ctx.arc(-headRadius * 0.32, eyeY, Math.max(3.4, width * .018), 0, Math.PI * 2);
  ctx.arc(headRadius * 0.32, eyeY, Math.max(3.4, width * .018), 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = Math.max(2.5, width * 0.02);
  ctx.beginPath();
  if (pose === 'talk') {
    // Phoneme-like mouth: open/close/half-open pattern instead of pure sine.
    const phonemes = [0.24, 0.07, 0.17, 0.05, 0.2, 0.1, 0.15, 0.06];
    const step = Math.floor(timeMs / 110) % phonemes.length;
    const mouthOpen = phonemes[step] ?? 0.12;
    ctx.ellipse(0, headY + headRadius * .31, headRadius * .18, headRadius * mouthOpen, 0, 0, Math.PI * 2);
  } else if (expression === 'happy') {
    ctx.arc(0, headY + headRadius * 0.18, headRadius * 0.3, 0.1 * Math.PI, 0.9 * Math.PI);
  } else if (expression === 'surprised') {
    ctx.arc(0, headY + headRadius * 0.3, headRadius * 0.14, 0, Math.PI * 2);
  } else if (expression === 'angry') {
    ctx.moveTo(-headRadius * 0.24, headY + headRadius * 0.36);
    ctx.quadraticCurveTo(0, headY + headRadius * 0.2, headRadius * 0.24, headY + headRadius * 0.36);
  } else if (expression === 'sad') {
    ctx.moveTo(-headRadius * .25, headY + headRadius * .42);
    ctx.quadraticCurveTo(0, headY + headRadius * .27, headRadius * .25, headY + headRadius * .42);
  } else {
    ctx.moveTo(-headRadius * 0.22, headY + headRadius * 0.31);
    ctx.quadraticCurveTo(0, headY + headRadius * 0.35, headRadius * 0.22, headY + headRadius * 0.31);
  }
  ctx.stroke();
  ctx.restore();
}

function drawShip(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  const w = object.width;
  const h = object.height;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = object.accent;
  ctx.lineWidth = 5;
  ctx.fillStyle = object.color;
  ctx.beginPath();
  ctx.moveTo(-w * 0.48, h * 0.06);
  ctx.lineTo(w * 0.45, h * 0.06);
  ctx.lineTo(w * 0.29, h * 0.34);
  ctx.lineTo(-w * 0.34, h * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  handLine(ctx, -w * 0.06, h * 0.04, -w * 0.06, -h * 0.57);
  ctx.fillStyle = object.accent;
  ctx.beginPath();
  ctx.moveTo(-w * 0.04, -h * 0.5);
  ctx.lineTo(w * 0.29, -h * 0.28);
  ctx.lineTo(-w * 0.04, -h * 0.04);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#efe4ce';
  roundedRect(ctx, -w * 0.3, -h * 0.07, w * 0.42, h * 0.18, 7);
  ctx.fill();
  ctx.stroke();
}

function drawStake(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  ctx.fillStyle = object.color;
  ctx.strokeStyle = object.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-object.width / 2, object.height / 2);
  ctx.lineTo(-object.width / 2, -object.height * 0.33);
  ctx.lineTo(0, -object.height / 2);
  ctx.lineTo(object.width / 2, -object.height * 0.33);
  ctx.lineTo(object.width / 2, object.height / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  const raw = (object.text || object.label).trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const hardLines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const targetLines = raw.length > 24 ? 2 : 1;
  const lines: string[] = [];
  if (hardLines.length > 1) lines.push(...hardLines.slice(0, 3));
  else if (targetLines === 1) lines.push(raw);
  else {
    const midpoint = Math.ceil(words.length / 2);
    lines.push(words.slice(0, midpoint).join(' '), words.slice(midpoint).join(' '));
  }
  const fontSize = Math.max(28, Math.min(68, object.height * (lines.length > 1 ? .31 : .5)));
  ctx.font = `800 ${fontSize}px "Be Vietnam Pro", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lineHeight = fontSize * 1.05;
  const firstY = -((lines.length - 1) * lineHeight) / 2;
  const isTitle = object.slot === 'caption-top' || object.slot === 'caption-bottom';
  const isChip = object.slot === 'caption-bottom' && (object.sizeClass === 'small' || !object.sizeClass);
  // Sub phim kiểu Ma Xó: caption-bottom + size medium + câu dài = chữ trắng
  // viền đen trên nền đen bán trong suốt, được vẽ cùng text để khung không lệch.
  const isSub = object.slot === 'caption-bottom' && object.sizeClass === 'medium' && raw.length > 24;
  if (isSub) {
    const tagMatch = lines.length > 1 && /^[A-ZÀ-Ỹ0-9 ]{2,14}$/.test(lines[0]!.trim()) ? lines.shift()! : undefined;
    const subFont = Math.max(24, Math.min(40, object.height * .3));
    ctx.font = `600 ${subFont}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const subLineHeight = subFont * 1.25;
    const subFirstY = -((lines.length - 1) * subLineHeight) / 2 + (tagMatch ? subFont * .7 : 0);
    if (tagMatch) {
      ctx.fillStyle = '#d9a441';
      ctx.font = `700 ${subFont * .62}px system-ui, sans-serif`;
      ctx.fillText(tagMatch.trim(), 0, -((lines.length - 1) * subLineHeight) / 2 - subFont * .55, object.width);
      ctx.font = `600 ${subFont}px system-ui, sans-serif`;
    }
    const widths = lines.map((line) => ctx.measureText(line).width);
    const boxW = Math.min(object.width - 22, Math.max(...widths, 1) + subFont * 1.65);
    const boxH = lines.length * subLineHeight + subFont * .7;
    ctx.fillStyle = 'rgba(11,8,7,.88)';
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(-boxW / 2, -boxH / 2, boxW, boxH, Math.max(8, subFont * .28));
    else ctx.rect(-boxW / 2, -boxH / 2, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = Math.max(3, subFont * .12);
    ctx.strokeStyle = 'rgba(0,0,0,.9)';
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, index) => {
      const y = subFirstY + index * subLineHeight;
      ctx.strokeText(line, 0, y, object.width - 40);
      ctx.fillText(line, 0, y, object.width - 40);
    });
    return;
  }
  if (isChip) {
    // Chip caption đáy kiểu mẫu: thanh đen chữ trắng ("1288 · Bạch Đằng").
    const chipW = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 44;
    const chipH = lines.length * lineHeight + 18;
    ctx.fillStyle = 'rgba(24,20,17,.92)';
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(-chipW / 2, -chipH / 2, chipW, chipH, 9);
    else ctx.rect(-chipW / 2, -chipH / 2, chipW, chipH);
    ctx.fill();
    ctx.fillStyle = '#fff';
    lines.forEach((line, index) => {
      ctx.fillText(line, 0, firstY + index * lineHeight, object.width);
    });
    return;
  }
  lines.forEach((line, index) => {
    const y = firstY + index * lineHeight;
    if (isTitle) {
      // Tiêu đề kiểu mẫu: chữ trắng viền đen + gạch đỏ dưới.
      ctx.lineWidth = Math.max(4, fontSize * .14);
      ctx.strokeStyle = '#1d1a16';
      ctx.fillStyle = '#ffffff';
      ctx.strokeText(line, 0, y, object.width);
      ctx.fillText(line, 0, y, object.width);
    } else {
      // Thin warm halo keeps editorial labels legible without cartoon bubble outlines.
      ctx.lineWidth = Math.max(2.5, fontSize * .055);
      ctx.strokeStyle = 'rgba(245,241,231,.92)';
      ctx.fillStyle = '#342f2a';
      ctx.strokeText(line, 0, y, object.width);
      ctx.fillText(line, 0, y, object.width);
    }
  });
  if (isTitle) {
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const barY = firstY + (lines.length - 1) * lineHeight + fontSize * .52;
    ctx.fillStyle = '#d33a2c';
    ctx.fillRect(-widest / 2, barY, widest, Math.max(4, fontSize * .09));
  }
}

function drawShape(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  ctx.fillStyle = object.color;
  ctx.strokeStyle = object.accent;
  ctx.lineWidth = 5;
  roundedRect(ctx, -object.width / 2, -object.height / 2, object.width, object.height, 24);
  ctx.fill();
  ctx.stroke();
}

function drawImageLayer(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, assetOrigin?: string) {
  if (!object.imageUrl) {
    drawShape(ctx, object);
    return;
  }
  const image = getImage(object.imageUrl, assetOrigin);
  if (!image.complete || !image.naturalWidth) {
    drawShape(ctx, object);
    return;
  }
  const scale = Math.min(object.width / image.naturalWidth, object.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  if (object.credit) {
    // Polaroid evidence style như video mẫu: viền trắng + băng dính + caption.
    const pad = Math.max(10, width * 0.035);
    const captionH = object.label ? 34 : 12;
    const fw = width + pad * 2;
    const fh = height + pad * 2 + captionH;
    ctx.save();
    ctx.fillStyle = '#fdfbf6';
    ctx.strokeStyle = 'rgba(40,34,28,.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(-fw / 2, -fh / 2, fw, fh, 6);
    else ctx.rect(-fw / 2, -fh / 2, fw, fh);
    ctx.fill();
    ctx.stroke();
    ctx.drawImage(image, -width / 2, -fh / 2 + pad, width, height);
    // Băng dính 2 góc.
    ctx.fillStyle = 'rgba(232,220,180,.85)';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * (fw / 2 - 34), -fh / 2 - 6);
      ctx.rotate(side * -0.5);
      ctx.fillRect(-34, -12, 68, 26);
      ctx.restore();
    }
    if (object.label) {
      ctx.fillStyle = '#3a342c';
      ctx.font = `700 17px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(object.label.slice(0, 42), 0, fh / 2 - captionH / 2 - 2, fw - 20);
    }
    ctx.restore();
    return;
  }
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
}


function drawProp(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  const w = object.width, h = object.height;
  const v = object.variant || 'box';
  ctx.strokeStyle = object.accent; ctx.fillStyle = object.color; ctx.lineWidth = Math.max(4, Math.min(w, h) * .035); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (v === 'sun' || v === 'moon' || v === 'coin' || v === 'clock' || v === 'question' || v === 'lightbulb') {
    ctx.beginPath(); ctx.arc(0, 0, Math.min(w,h)*.32, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    if (v === 'coin') { ctx.font = `700 ${Math.min(w,h)*.34}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=object.accent; ctx.fillText('$',0,2); }
    if (v === 'clock') { handLine(ctx,0,0,0,-h*.18); handLine(ctx,0,0,w*.14,h*.08); }
    if (v === 'question') { ctx.font = `800 ${Math.min(w,h)*.5}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=object.accent; ctx.fillText('?',0,2); }
    if (v === 'lightbulb') { ctx.fillStyle=object.accent; ctx.fillRect(-w*.1,h*.29,w*.2,h*.16); }
    return;
  }
  if (v === 'tree') { ctx.fillStyle='#79563a'; ctx.fillRect(-w*.08,h*.05,w*.16,h*.4); ctx.fillStyle=object.color; for (const [x,y,r] of [[0,-.2,.3],[-.2,-.05,.24],[.2,-.05,.24]] as const){ctx.beginPath();ctx.arc(w*x,h*y,Math.min(w,h)*r,0,Math.PI*2);ctx.fill();ctx.stroke();} return; }
  if (v === 'house' || v === 'factory') { ctx.fillRect(-w*.38,-h*.05,w*.76,h*.45); ctx.strokeRect(-w*.38,-h*.05,w*.76,h*.45); ctx.beginPath();ctx.moveTo(-w*.46,-h*.05);ctx.lineTo(0,-h*.42);ctx.lineTo(w*.46,-h*.05);ctx.closePath();ctx.fill();ctx.stroke(); if(v==='factory'){ctx.fillRect(w*.18,-h*.45,w*.12,h*.4);} return; }
  if (v === 'cloud') { for(const [x,y,r] of [[-.22,.08,.24],[0,-.04,.3],[.25,.08,.22]] as const){ctx.beginPath();ctx.arc(w*x,h*y,Math.min(w,h)*r,0,Math.PI*2);ctx.fill();ctx.stroke();} return; }
  if (v === 'mountain') { ctx.beginPath();ctx.moveTo(-w*.5,h*.35);ctx.lineTo(-w*.12,-h*.35);ctx.lineTo(w*.08,h*.02);ctx.lineTo(w*.28,-h*.28);ctx.lineTo(w*.5,h*.35);ctx.closePath();ctx.fill();ctx.stroke();return; }
  if (v === 'fire') { ctx.beginPath();ctx.moveTo(0,-h*.45);ctx.bezierCurveTo(w*.38,-h*.08,w*.28,h*.42,0,h*.46);ctx.bezierCurveTo(-w*.3,h*.35,-w*.32,-h*.08,0,-h*.45);ctx.fill();ctx.stroke();return; }
  if (v === 'book' || v === 'map') { ctx.fillRect(-w*.42,-h*.3,w*.84,h*.6);ctx.strokeRect(-w*.42,-h*.3,w*.84,h*.6);handLine(ctx,0,-h*.3,0,h*.3);return; }
  if (v === 'sword' || v === 'arrow') { handLine(ctx,0,h*.38,0,-h*.36); handLine(ctx,-w*.16,h*.15,w*.16,h*.15); ctx.beginPath();ctx.moveTo(0,-h*.5);ctx.lineTo(-w*.1,-h*.3);ctx.lineTo(w*.1,-h*.3);ctx.closePath();ctx.fill();ctx.stroke();return; }
  if (v === 'shield') { ctx.beginPath();ctx.moveTo(0,h*.48);ctx.bezierCurveTo(-w*.42,h*.18,-w*.38,-h*.28,0,-h*.42);ctx.bezierCurveTo(w*.38,-h*.28,w*.42,h*.18,0,h*.48);ctx.fill();ctx.stroke();return; }
  if (v === 'crown') { ctx.beginPath();ctx.moveTo(-w*.42,h*.28);ctx.lineTo(-w*.3,-h*.25);ctx.lineTo(-w*.08,.0);ctx.lineTo(w*.08,-h*.3);ctx.lineTo(w*.27,0);ctx.lineTo(w*.42,-h*.22);ctx.lineTo(w*.34,h*.28);ctx.closePath();ctx.fill();ctx.stroke();return; }
  if (v === 'flag') { handLine(ctx,-w*.3,h*.42,-w*.3,-h*.42);ctx.beginPath();ctx.moveTo(-w*.28,-h*.38);ctx.lineTo(w*.34,-h*.25);ctx.lineTo(-w*.28,-h*.04);ctx.closePath();ctx.fill();ctx.stroke();return; }
  if (v === 'phone' || v === 'computer') { roundedRect(ctx,-w*.32,-h*.42,w*.64,h*.84,14);ctx.fill();ctx.stroke(); if(v==='computer'){handLine(ctx,0,h*.42,0,h*.52);handLine(ctx,-w*.2,h*.52,w*.2,h*.52);} return; }
  if (v === 'bridge') { handLine(ctx,-w*.5,h*.18,w*.5,h*.18);ctx.beginPath();ctx.arc(-w*.2,h*.2,w*.2,Math.PI,0);ctx.stroke();ctx.beginPath();ctx.arc(w*.2,h*.2,w*.2,Math.PI,0);ctx.stroke();return; }
  if (v === 'water') { for(let i=-2;i<=2;i++) handLine(ctx,-w*.45,h*i*.1,w*.45,h*i*.1+5); return; }
  if (v === 'cart') { ctx.fillRect(-w*.35,-h*.1,w*.7,h*.32);ctx.strokeRect(-w*.35,-h*.1,w*.7,h*.32);for(const x of [-.23,.23]){ctx.beginPath();ctx.arc(w*x,h*.28,h*.12,0,Math.PI*2);ctx.fill();ctx.stroke();}return; }
  roundedRect(ctx,-w*.38,-h*.32,w*.76,h*.64,14); ctx.fill(); ctx.stroke();
}


function atmosphereHash(value:string){
  let hash=2166136261;
  for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}

function atmosphereRandom(seed:number,index:number){
  let x=(seed+Math.imul(index+1,2654435761))>>>0;
  x^=x>>>16;x=Math.imul(x,2246822519)>>>0;x^=x>>>13;x=Math.imul(x,3266489917)>>>0;x^=x>>>16;
  return (x>>>0)/4294967295;
}

function ambientObjectMotion(object:CanvasStudioObject,scene:CanvasStudioScene,timeMs:number){
  const wind=Math.max(0,Math.min(1,scene.atmosphere?.wind||0));
  if(!wind||object.heldBy||object.onBoat)return {dx:0,dy:0,rotation:0};
  const elapsed=timeMs+(scene.atmosphere?.timeOffsetMs||0);
  const phase=(object.id.length%13)*.47;
  if(object.kind==='prop'&&(object.variant==='bamboo'||object.variant==='tree')){
    const depth=object.depth==='background'?.55:object.depth==='foreground'?1.15:.82;
    return {
      dx:Math.sin(elapsed/1800+phase)*1.5*wind*depth,
      dy:0,
      rotation:Math.sin(elapsed/2100+phase)*.8*wind*depth,
    };
  }
  // A hanging lantern can react slightly to wind, but a lamp sitting on a
  // table/floor stays physically grounded.
  if(object.kind==='prop'&&object.variant==='lantern'&&/(treo|hanging|eave|hien|mai)/iu.test(object.designNotes||'')){
    return {dx:Math.sin(elapsed/1500+phase)*.7*wind,dy:0,rotation:Math.sin(elapsed/1700+phase)*.55*wind};
  }
  return {dx:0,dy:0,rotation:0};
}

function drawAmbientAtmosphere(
  ctx:CanvasRenderingContext2D,
  scene:CanvasStudioScene,
  timeMs:number,
  width:number,
  height:number,
  phase:'back'|'front',
){
  const atmosphere=scene.atmosphere;
  if(!atmosphere)return;
  const elapsed=timeMs+(atmosphere.timeOffsetMs||0);
  const seed=atmosphereHash(scene.stageId||scene.backgroundRef||scene.id);
  if(phase==='back'){
    const fog=Math.max(0,Math.min(1,atmosphere.fogDrift||0));
    if(fog>0){
      ctx.save();ctx.filter='blur(14px)';ctx.fillStyle='#c9d0cc';
      for(let index=0;index<4;index++){
        const span=width*(.38+atmosphereRandom(seed,index)*.22);
        const drift=((elapsed*(.005+.002*index)+atmosphereRandom(seed,index+10)*width*1.6)%(width+span))-span;
        const y=height*(.56+index*.075)+Math.sin(elapsed/2200+index)*height*.012;
        ctx.globalAlpha=fog*(.025+index*.009);
        ctx.beginPath();ctx.ellipse(drift,y,span*.62,height*(.025+.007*index),-.03,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
    const dust=Math.max(0,Math.min(1,atmosphere.dustMotes||0));
    if(dust>0){
      ctx.save();ctx.fillStyle='#ddd5c0';
      const count=Math.round(10+dust*20);
      for(let index=0;index<count;index++){
        const speed=.004+atmosphereRandom(seed,index+200)*.006;
        const x=(atmosphereRandom(seed,index+300)*width+Math.sin(elapsed/1700+index)*8*dust+width)%width;
        const base=atmosphereRandom(seed,index+400)*height;
        const y=((base-elapsed*speed)%(height+30)+height+30)%(height+30)-15;
        const radius=.45+atmosphereRandom(seed,index+500)*1.2;
        ctx.globalAlpha=dust*(.025+atmosphereRandom(seed,index+600)*.06);
        ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
    const lightPulse=(object:CanvasStudioObject,amount:number)=>{
      const frame=evaluateCanvasObject(object,scene,timeMs);
      const pulse=.5+.5*Math.sin(elapsed/(object.variant==='fire'?185:430)+atmosphereRandom(seed,object.id.length)*Math.PI*2);
      const radius=Math.max(object.width,object.height)*(1.1+amount*.8);
      const alpha=(.025+.035*pulse)*amount;
      const gradient=ctx.createRadialGradient(frame.x,frame.y,2,frame.x,frame.y,radius);
      gradient.addColorStop(0,`rgba(235,158,77,${alpha})`);
      gradient.addColorStop(1,'rgba(235,158,77,0)');
      ctx.fillStyle=gradient;ctx.fillRect(frame.x-radius,frame.y-radius,radius*2,radius*2);
    };
    const fire=Math.max(0,Math.min(1,atmosphere.fireFlicker||0));
    if(fire>0)for(const object of scene.objects.filter(item=>item.kind==='prop'&&item.variant==='fire'))lightPulse(object,fire);
    const lamp=Math.max(0,Math.min(1,atmosphere.lampBreath||0));
    if(lamp>0)for(const object of scene.objects.filter(item=>item.kind==='prop'&&item.variant==='lantern'))lightPulse(object,lamp*.72);
  } else {
    const shadow=Math.max(0,Math.min(1,atmosphere.shadowBreath||0));
    if(shadow>0){
      const breath=.72+.28*Math.sin(elapsed/2600);
      const gradient=ctx.createRadialGradient(width*.5,height*.48,height*.16,width*.5,height*.48,Math.max(width,height)*.72);
      gradient.addColorStop(0,'rgba(0,0,0,0)');
      gradient.addColorStop(.66,`rgba(0,0,0,${.05*shadow*breath})`);
      gradient.addColorStop(1,`rgba(0,0,0,${.20*shadow*breath})`);
      ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
    }
    const grain=Math.max(0,Math.min(1,atmosphere.filmGrain||0));
    if(grain>0){
      const frame=Math.floor(elapsed/120);
      const frameSeed=(seed+Math.imul(frame,977))>>>0;
      ctx.save();ctx.fillStyle='#fff';
      const count=Math.round(50+grain*90);
      for(let index=0;index<count;index++){
        const x=atmosphereRandom(frameSeed,index)*width;
        const y=atmosphereRandom(frameSeed,index+1000)*height;
        ctx.globalAlpha=grain*(.006+atmosphereRandom(frameSeed,index+2000)*.018);
        const size=.35+atmosphereRandom(frameSeed,index+3000)*.7;
        ctx.fillRect(x,y,size,size);
      }
      ctx.restore();
    }
  }
}

function effectProgress(effect: CanvasSceneEffect, timeMs: number) {
  const start = Math.max(0, effect.startMs || 0);
  const duration = Math.max(120, effect.durationMs || 900);
  if (timeMs < start || timeMs > start + duration) return -1;
  return Math.max(0, Math.min(1, (timeMs - start) / duration));
}

function drawSceneEffect(ctx: CanvasRenderingContext2D, effect: CanvasSceneEffect, timeMs: number) {
  if(effect.intensity===0)return;
  const progress = effectProgress(effect, timeMs);
  if (progress < 0) return;
  const strength = Math.max(.2, Math.min(3, effect.intensity || 1));
  const scale = Math.max(.2, effect.scale || 1);
  const color = effect.color || '#ffffff';
  ctx.save();
  ctx.translate(effect.x, effect.y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (effect.type === 'impact') {
    const pulse = Math.sin(progress * Math.PI);
    ctx.globalAlpha = .9 * pulse;
    ctx.lineWidth = 7 * strength;
    for (let index = 0; index < 12; index += 1) {
      const angle = (Math.PI * 2 * index) / 12;
      const inner = 28 + 28 * progress;
      const outer = inner + 65 * strength * pulse;
      handLine(ctx, Math.cos(angle) * inner, Math.sin(angle) * inner, Math.cos(angle) * outer, Math.sin(angle) * outer);
    }
  } else if (effect.type === 'speed-lines') {
    ctx.globalAlpha = .5 * (1 - progress * .35);
    ctx.lineWidth = 4 * strength;
    for (let index = 0; index < 16; index += 1) {
      const y = -150 + index * 20;
      const phase = ((index * 47) % 90) + progress * 80;
      handLine(ctx, -250 + phase, y, 80 + phase, y + ((index % 3) - 1) * 8);
    }
  } else if (effect.type === 'splash') {
    const burst = Math.sin(progress * Math.PI);
    ctx.globalAlpha = .8 * burst;
    ctx.lineWidth = 5 * strength;
    for (let index = 0; index < 18; index += 1) {
      const angle = Math.PI * (1.02 + index / 19 * .96);
      const length = (40 + (index % 5) * 20 + (index % 3) * 8) * strength * burst;
      handLine(ctx, 0, 0, Math.cos(angle) * length, Math.sin(angle) * length);
    }
    ctx.beginPath();
    ctx.ellipse(0, 16, 95 * strength * burst, 20 * strength * burst, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = .4 * burst;
    ctx.beginPath();
    ctx.ellipse(0, 26, 60 * strength * burst, 10 * strength * burst, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Bạch Đằng hull-breach plume: droplets above the burst, count follows intensity.
    const drops = Math.round(4 + strength * 4);
    for (let drop = 0; drop < drops; drop += 1) {
      const spread = (drops <= 1 ? 0 : drop / (drops - 1) - .5) * 150 * strength;
      const lift = (46 + ((drop * 53) % 34)) * burst * strength;
      ctx.globalAlpha = .7 * burst;
      ctx.beginPath();
      ctx.arc(spread, -lift, 2.5 + (drop % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (effect.type === 'smoke') {
    // Thin layered wisps instead of opaque bubble clouds. Horror scenes need
    // atmosphere that reads as air/smoke, not a sticker covering the artwork.
    ctx.save();
    ctx.filter = 'blur(5px)';
    for (let index = 0; index < 8; index += 1) {
      const local = (progress + index * .13) % 1;
      const sway = Math.sin((progress * 2.3 + index) * Math.PI) * 18 * strength;
      const x = -24 + (index % 4) * 15 + sway;
      const y = 42 - local * 145 - (index % 3) * 8;
      const rx = (12 + (index % 3) * 5) * strength * (1 + local * .55);
      const ry = (7 + (index % 2) * 4) * strength * (1 + local * .75);
      ctx.globalAlpha = (.09 + (1 - local) * .07) * Math.min(1.4, strength);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, -.18 + Math.sin(index) * .12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = .12 * Math.min(1.3, strength);
    ctx.lineWidth = 1.4 * strength;
    for (let index = 0; index < 3; index += 1) {
      const rise = progress * 55 + index * 24;
      handLine(ctx, -14 + index * 13, 32 - rise, -2 + index * 10 + Math.sin(progress * 4 + index) * 9, -18 - rise);
    }
  } else if (effect.type === 'dust') {
    for (let index = 0; index < 10; index += 1) {
      const phase = (progress + index * .09) % 1;
      const x = ((index * 37) % 110) - 55 + Math.sin(index * 1.7) * phase * 9;
      const y = 30 - phase * 95 - (index % 4) * 8;
      const radius = 2 + (index % 3) * 1.6;
      ctx.globalAlpha = (.16 - phase * .11) * strength;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (effect.type === 'arrows') {
    ctx.globalAlpha = .9;
    for (let row = 0; row < 3; row += 1) {
      const local = Math.max(0, Math.min(1, progress * 1.4 - row * 0.2));
      if (local <= 0) continue;
      const yOff = (row - 1) * 34;
      ctx.globalAlpha = .9 * (1 - row * 0.18) * Math.min(1, local * 2);
      ctx.lineWidth = (8 - row * 1.5) * strength;
      const length = 190 * (0.35 + local * .65);
      const x0 = -length * .5;
      ctx.save();
      ctx.translate(0, yOff);
      handLine(ctx, x0, 0, x0 + length, 0);
      handLine(ctx, x0 + length, 0, x0 + length - 24, -13);
      handLine(ctx, x0 + length, 0, x0 + length - 24, 13);
      ctx.restore();
    }
  } else if (effect.type === 'glow') {
    // Practical lights must visibly own a small island of exposure. Their
    // intensity is already multiplied by lightLevel in resolveCanvasLight, so
    // a 1 -> .05 beat now creates a perceptible fade instead of a metadata-only
    // change while remaining local to the lamp.
    const radius=120*strength*(1+Math.sin(timeMs/170)*.025+Math.sin(timeMs/311)*.015);
    const halo=ctx.createRadialGradient(0,0,0,0,0,radius);
    halo.addColorStop(0,'rgba(255,205,125,.40)');
    halo.addColorStop(.32,'rgba(255,184,92,.19)');
    halo.addColorStop(.72,'rgba(255,166,75,.07)');
    halo.addColorStop(1,'rgba(255,180,90,0)');
    ctx.fillStyle=halo;ctx.fillRect(-radius,-radius,radius*2,radius*2);
  } else if (effect.type === 'vignette') {
    // Tối 4 góc kiểu Ma Xó, giữ nguyên suốt cảnh (bỏ qua progress).
    ctx.globalAlpha = .88 * Math.min(1.2, strength);
    const r = 1050 * scale;
    const g = ctx.createRadialGradient(0, 0, r * .42, 0, 0, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(.72, 'rgba(0,0,0,.38)');
    g.addColorStop(1, 'rgba(0,0,0,.82)');
    ctx.fillStyle = g;
    ctx.fillRect(-2000, -2000, 4000, 4000);
  } else if (effect.type === 'flashlight') {
    // Vũng sáng đèn pin ấm: trung tâm tỏ, rìa chìm vào tối.
    ctx.globalAlpha = .9*Math.min(1,strength);
    const r = 340 * scale * (0.9 + progress * .2);
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, r);
    g.addColorStop(0, 'rgba(255,196,110,.34)');
    g.addColorStop(.55, 'rgba(255,180,90,.14)');
    g.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawOpenPeepsHybridCharacter(
  ctx: CanvasRenderingContext2D,
  object: CanvasStudioObject,
  scene: CanvasStudioScene,
  assetOrigin?: string,
) {
  const src = openPeepsCharacterDataUri(object);
  const image = getImage(src, assetOrigin);
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) {
    drawAuthoredCharacter(ctx, object, 0);
    return;
  }

  const facing = object.facing === 'left' ? -1 : 1;
  const height = object.height;
  const width = object.width;
  const bustSize = Math.min(height * .82, width * 1.9);
  const bustTop = -height * .49;
  const bustBottom = bustTop + bustSize;
  const legTop = Math.max(height * .1, bustBottom - height * .07);
  const legBottom = height * .48;
  const pants = object.secondaryColor || '#687575';
  const ink = '#332f2b';

  ctx.save();
  ctx.scale(facing, 1);

  // Ground shadow.
  ctx.save();
  ctx.globalAlpha = .08;
  ctx.fillStyle = '#24201c';
  ctx.beginPath();
  ctx.ellipse(0, height * .49, Math.max(18, width * .22), Math.max(3, height * .018), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Full-body extension under the Open Peeps half-body artwork.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(3.2, width * .022);
  const hipSpread = width * .09;
  const footSpread = width * .13;
  handLine(ctx, -hipSpread, legTop, -footSpread, legBottom);
  handLine(ctx, hipSpread, legTop, footSpread, legBottom);
  ctx.strokeStyle = pants;
  ctx.lineWidth = Math.max(2, width * .013);
  handLine(ctx, -hipSpread, legTop, -footSpread, legBottom);
  handLine(ctx, hipSpread, legTop, footSpread, legBottom);

  ctx.fillStyle = '#574c44';
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.5, width * .009);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * footSpread + side * width * .018, legBottom + height * .006, width * .055, height * .018, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.drawImage(image, -bustSize / 2, bustTop, bustSize, bustSize);

  // Small editorial grounding accent for medium/close shots.
  if ((scene.camera?.shot || 'medium') !== 'extreme-close-up') {
    ctx.strokeStyle = 'rgba(51,47,43,.28)';
    ctx.lineWidth = 1;
    handLine(ctx, -width * .2, height * .505, width * .2, height * .505);
  }
  ctx.restore();
}

export { spriteFrameAt } from './spriteFrames';

function drawSpriteFrame(
  ctx: CanvasRenderingContext2D,
  object: CanvasStudioObject,
  scene: CanvasStudioScene,
  timeMs: number,
  assetOrigin?: string,
) {
  // Acting repertoire: active beat action selects the sheet, like film direction.
  const activeBeat = (scene.animationBeats || []).find((beat) =>
    beat.targetIds.includes(object.id)
    && timeMs >= beat.atMs
    && timeMs <= beat.atMs + beat.durationMs,
  );
  const resolvedAct = resolveSpriteAct(object.spriteActs, activeBeat?.action);
  const baseIsSheet = object.spriteActs?.some((clip) => clip.imageUrl === object.imageUrl);
  const act = resolvedAct || (baseIsSheet ? object.spriteActs?.[0] : undefined);
  if (object.spriteActs?.length && !act && !object.sprite) return false;
  const sheetUrl = act?.imageUrl || object.imageUrl;
  const clip = act || object.sprite;
  if (!clip || !sheetUrl) return false;
  const image = getImage(sheetUrl, assetOrigin);
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
  const fw = Math.floor(clip.frameWidth);
  const fh = Math.floor(clip.frameHeight);
  if (fw < 16 || fh < 16) return false;
  // Limited animation: không beat nào active thì GIỮ pose (moving hold),
  // không chạy vòng lặp. Miệng/tay chỉ cử động khi đang diễn.
  let column: number;
  let row: number;
  if (!activeBeat || (object.spriteActs?.length && !resolvedAct)) {
    const from = Math.max(0, Math.floor(clip.from));
    const columns = Math.max(1, Math.floor(clip.columns) || 1);
    column = from % columns;
    row = Math.floor(from / columns);
  } else {
    const localT = timeMs - activeBeat.atMs;
    ({ column, row } = spriteFrameAt({ ...clip, loop: act?.loop }, localT));
  }
  const sx = Math.min(image.naturalWidth - fw, column * fw);
  const sy = Math.min(image.naturalHeight - fh, row * fh);
  if (sx < 0 || sy < 0) return false;
  const bounds = clipContentBounds(image, fw, fh, Math.max(1, clip.columns), Math.max(0, clip.from), Math.max(clip.from, clip.to));
  const scale = Math.min(object.width / bounds.width, object.height / bounds.height);
  const dw = bounds.width * scale;
  const dh = bounds.height * scale;
  // Ground-anchored: feet stay on baseline across frames.
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#24201c';
  ctx.beginPath();
  ctx.ellipse(0, object.height / 2 - 4, dw * 0.26, Math.max(3, dh * 0.02), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.drawImage(image, sx + bounds.x, sy + bounds.y, bounds.width, bounds.height, -dw / 2, object.height / 2 - dh, dw, dh);
  return true;
}

function drawObject(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number, assetOrigin?: string, contactBodyOnly=false) {
  // Generated illustrated cutouts are authoritative. Procedural drawing is only
  // a resilient fallback when an approved asset is unavailable.
  if (object.kind === 'image') drawImageLayer(ctx, object, assetOrigin);
  else if ((object.spriteActs?.length || object.sprite) && (object.spriteActs?.[0]?.imageUrl || object.imageUrl)) {
    // Sprite-forge style: cycle sheet frames; act switches sheet by beat.
    // Falls back to static art if the sheet is not ready yet.
    if (!drawSpriteFrame(ctx, object, scene, timeMs, assetOrigin)) drawImageLayer(ctx, object, assetOrigin);
  } else if (object.imageUrl) drawImageLayer(ctx, object, assetOrigin);
  else if (object.kind === 'character') {
    // CharacterRendererV2 owns production procedural actors. Identity, anatomy,
    // facial state, IK and LOD stay deterministic across every scene.
    if(object.visualStyle==='folk-horror')drawFolkCharacter(ctx,object,scene,timeMs,isCanvasActorSpeaking(scene,object,timeMs) === true);
    else if(object.appearance==='water-spirit')drawWaterSpirit(ctx,object,scene,timeMs,contactBodyOnly?'body':'full');
    else {
      const dialogueSpeaking = isCanvasActorSpeaking(scene, object, timeMs);
      const horrorTalkBeat = object.visualStyle === 'horror'
        ? scene.animationBeats?.some(beat => beat.action === 'talk'
          && beat.targetIds.includes(object.id)
          && timeMs >= beat.atMs
          && timeMs < beat.atMs + beat.durationMs) === true
        : false;
      // Legacy projects may animate from scene-wide voice windows. Horror actors
      // must never flap their mouths to narrator audio: only their own dialogue
      // or an explicit targeted talk beat can activate lip sync.
      const voiceActive = dialogueSpeaking
        ?? (object.visualStyle === 'horror' ? horrorTalkBeat : isVoiceActiveAt(resolveVoiceWindows(scene), timeMs));
      if(object.visualStyle==='horror'&&!contactBodyOnly){
        drawHorrorCharacter(
          ctx,
          object,
          scene,
          timeMs,
          voiceActive,
          voiceActive ? canvasActorSpeechLevel(scene, object, timeMs) : 0,
        );
      }else{
        drawCharacterV2(
          ctx,
          object,
          scene,
          timeMs,
          voiceActive,
          voiceActive ? canvasActorSpeechLevel(scene, object, timeMs) : 0,
          !contactBodyOnly,
        );
      }
    }
  }
  else if (object.kind === 'ship') drawAuthoredShip(ctx, object, !scene.objects.some(prop=>
    prop.variant==='oar' && prop.heldBy && scene.objects.some(actor=>actor.id===prop.heldBy && actor.onBoat===object.id)));
  else if (object.kind === 'stake') drawAuthoredStake(ctx, object);
  else if (object.kind === 'text') drawText(ctx, object);
  else if (object.kind === 'prop') {
    if (object.variant === 'tree' && isFolkHorrorScene(scene)) { drawFolkTree(ctx, object); return; }
    const handled = drawAuthoredProp(ctx, object, timeMs + (scene.atmosphere?.timeOffsetMs || 0), scene);
    // Legacy/manual projects without assetRef keep the old fallback so the editor
    // remains backward-compatible. Production plans assign assetRef and are
    // rejected by visual QC before render if no authored asset exists.
    if (!handled && !object.assetRef) drawProceduralProp(ctx, object);
  } else drawShape(ctx, object);
}

function canvasSceneObjectFilter(scene:CanvasStudioScene,object:CanvasStudioObject){
  if(object.kind==='text'||object.kind==='shape')return 'none';
  const night=scene.atmosphere?.timeOfDay==='night'
    ||['bg:city-hallway','bg:city-alley-night','bg:room-simple-night','bg:room-stilt-house','bg:room-underfloor','bg:night-stilt-house'].includes(scene.backgroundRef||'');
  if(!night)return 'none';
  // Depth haze belongs to the same lighting grammar as the authored set.
  // Background cutouts should not keep the same clean/saturated palette as
  // foreground actors because that makes them read as pasted stickers.
  let brightness=object.depth==='background'?.68:object.depth==='foreground'?.90:.80;
  let saturation=object.depth==='background'?.72:object.depth==='foreground'?.88:.80;
  if(object.role==='focal'){brightness=Math.min(1,brightness+.06);saturation=Math.min(1,saturation+.05);}
  if(object.variant==='lantern'||object.variant==='fire'){brightness=1;saturation=1;}
  return `brightness(${brightness}) saturate(${saturation})`;
}

function drawCanvasPropContactShadow(ctx:CanvasRenderingContext2D,object:CanvasStudioObject){
  if(object.kind!=='prop'||object.heldBy||object.onBoat||object.handling||object.restingOn||object.environmentAnchor==='doorway')return;
  const bottom=canvasFloorPropBottomRatio(object);
  if(bottom===undefined)return;
  const depthAlpha=object.depth==='background'?.10:object.depth==='foreground'?.17:.14;
  ctx.save();
  ctx.globalAlpha=depthAlpha;
  ctx.fillStyle='#080a0a';
  ctx.beginPath();
  ctx.ellipse(0,object.height*bottom,Math.max(8,object.width*.34),Math.max(2.2,object.height*.025),0,0,Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function drawGeneratedBackground(
  ctx: CanvasRenderingContext2D,
  scene: CanvasStudioScene,
  width: number,
  height: number,
  assetOrigin?: string,
) {
  if (!scene.backgroundImageUrl) return false;
  const image = getImage(scene.backgroundImageUrl, assetOrigin);
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return true;
}

export function renderCanvasScene(
  ctx: CanvasRenderingContext2D,
  scene: CanvasStudioScene,
  timeMs: number,
  width: number,
  height: number,
  assetOrigin?: string,
) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f5f1e7';
  ctx.fillRect(0, 0, width, height);

  if(drawVectorScene(ctx,scene,timeMs,width,height)){ctx.restore();return;}

  // Project preparation owns geometry. Recompiling one shot here discards
  // the room and cast anchors already shared by preview and export.
  const compiledScene = scene;
  // A grip below the surface needs an actual underwater insert, not a splash
  // obscuring the actor. Keep the same anatomy/contact coordinates across it.
  const underwaterShot=canvasUnderwaterInsert(compiledScene,timeMs);
  const environment=underwaterShot?{...compiledScene,background:'underwater' as const,backgroundRef:'bg:underwater-stakes'}:compiledScene;
  const camera = evaluateCanvasCamera(compiledScene, timeMs, width, height);
  ctx.translate(camera.offsetX, camera.offsetY);
  ctx.translate(camera.focusX, camera.focusY);
  ctx.rotate((camera.rotation * Math.PI) / 180);
  ctx.scale(camera.scale, camera.scale);
  ctx.translate(-camera.focusX, -camera.focusY);

  const hasGeneratedBackground = drawGeneratedBackground(ctx, environment, width, height, assetOrigin);
  const hasAuthoredBackground = !hasGeneratedBackground && (drawFolkBackground(ctx, environment, width, height)
    || drawAuthoredBackground(ctx, environment, width, height, timeMs));
  if (!hasGeneratedBackground && !hasAuthoredBackground) {
    // Legacy/manual projects retain the procedural environment fallback.
    // Production plans carry backgroundRef and are rejected by QC before render
    // if no authored environment exists.
    drawProceduralBackgroundBase(ctx, compiledScene, width, height);
    drawProceduralBackgroundDetails(ctx, compiledScene, width, height);
  }
  drawAmbientAtmosphere(ctx,compiledScene,timeMs,width,height,'back');

  const effects = [...(compiledScene.effects || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const effect of effects.filter((item) => (item.zIndex || 0) < 15)) drawSceneEffect(ctx, resolveCanvasLight(effect,compiledScene,timeMs), timeMs);

  const sorted = compiledScene.objects.map(object=>{
    const holderId=object.heldBy||object.handling?.actorId;
    const holder=holderId?compiledScene.objects.find(o=>o.id===holderId):undefined;
    const boat=holder?.onBoat?compiledScene.objects.find(o=>o.id===holder.onBoat):undefined;
    return holder?{...object,zIndex:Math.max(object.zIndex,holder.zIndex+1,boat?boat.zIndex+1:0)}:object;
  }).sort((a, b) => a.zIndex - b.zIndex);
  // An open vessel has two depth planes: interior behind occupants, near
  // hull in front. Drawing its entire deck over people makes them look like
  // they are standing behind the boat rather than seated inside it.
  const splitBoats=new Set(sorted.filter(o=>o.kind==='ship'&&!o.imageUrl&&o.assetRef==='ship:wooden-ferry'
    &&sorted.some(actor=>actor.kind==='character'&&actor.onBoat===o.id)).map(o=>o.id));
  const layers=sorted.flatMap<{object:CanvasStudioObject;phase:'back'|'front'|'full';z:number}>(object=>splitBoats.has(object.id)
    ?[{object,phase:'back' as const,z:Math.min(...sorted.filter(o=>o.onBoat===object.id).map(o=>o.zIndex))-0.5},
      {object,phase:'front' as const,z:object.zIndex}]
    :[{object,phase:'full' as const,z:object.zIndex}]).sort((a,b)=>a.z-b.z);
  const contactActors=sorted.filter(object=>{
    if(object.kind!=='character'||object.imageUrl||object.sprite||object.spriteActs?.length)return false;
    const state=applyCanvasChoreographyState(object,compiledScene,timeMs);
    return state.pose==='reach'&&compiledScene.objects.some(o=>o.id===state.lookAtId&&o.kind==='ship')
      &&compiledScene.animationBeats?.some(b=>b.action==='grab'&&b.targetIds.includes(object.id)&&b.focusTargetId===state.lookAtId&&timeMs>=b.atMs);
  });
  for (const {object,phase} of layers) {
    if (hideFolkBackgroundSpirit(compiledScene, object)) continue;
    const animatedObject = applyCanvasChoreographyState(object, compiledScene, timeMs);
    if(object.variant==='rope'&&object.tiedTo){
      const tie=compiledScene.animationBeats?.find(beat=>beat.action==='tie'&&beat.focusTargetId===object.id);
      animatedObject.tieProgress=tie?Math.max(0,Math.min(1,(timeMs-tie.atMs)/tie.durationMs)):1;
    }
    const transform = evaluateAttachedProp(object, compiledScene, timeMs);
    const ambient=ambientObjectMotion(object,compiledScene,timeMs);
    ctx.save();
    if(object.kind==='character'&&object.onBoat){
      const vessel=compiledScene.objects.find(o=>o.id===object.onBoat&&o.kind==='ship');
      if(vessel){
        // The front hull occludes legs even when a seated actor crouches.
        // Clip in the vessel's frame so a tilted boat cannot expose feet below it.
        const frame=evaluateAttachedProp(vessel,compiledScene,timeMs),angle=frame.rotation*Math.PI/180;
        ctx.translate(frame.x,frame.y);ctx.rotate(angle);
        ctx.beginPath();ctx.rect(-width*4,-height*4,width*8,height*4+vessel.height*.06*frame.scale);ctx.clip();
        ctx.rotate(-angle);ctx.translate(-frame.x,-frame.y);
      }
    }
    if(object.waterlineY!==undefined&&!underwaterShot){
      ctx.beginPath();ctx.rect(-width*4,-height*4,width*8,object.waterlineY+height*4);ctx.clip();
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity));
    if(canvasLampMountedOnPost(object)){
      const top=transform.y+object.height*.40*transform.scale;
      const bottom=Math.max(top+object.height,height*.94);
      const postWidth=Math.max(5,object.width*.15*transform.scale);
      ctx.fillStyle='#604736';ctx.strokeStyle='#302b25';ctx.lineWidth=2;
      ctx.fillRect(transform.x-postWidth/2,top,postWidth,bottom-top);
      ctx.strokeRect(transform.x-postWidth/2,top,postWidth,bottom-top);
    }
    const propBottom=canvasFloorPropBottomRatio(animatedObject);
    const groundShiftY=object.kind==='character'&&animatedObject.visualStyle==='horror'&&Number.isFinite(animatedObject.groundY)
      ? (animatedObject.groundY as number)-(transform.y+canvasCharacterLocalGroundOffset(animatedObject,compiledScene,timeMs)*transform.scale)
      :object.kind==='prop'&&propBottom!==undefined&&Number.isFinite(animatedObject.groundY)&&!animatedObject.restingOn
        ? (animatedObject.groundY as number)-(transform.y+propBottom*object.height*transform.scale)
        :0;
    ctx.translate(transform.x+ambient.dx, transform.y+ambient.dy+groundShiftY);
    const hanging = object.kind === 'prop' && canvasLanternUsesHandlePivot(object);
    if (hanging) ctx.translate(0,-object.height*.51*transform.scale);
    ctx.rotate(((transform.rotation+ambient.rotation) * Math.PI) / 180);
    ctx.scale(transform.scale, transform.scale);
    if (hanging) ctx.translate(0,object.height*.51);
    if(phase==='full')drawCanvasPropContactShadow(ctx,animatedObject);
    ctx.filter=canvasSceneObjectFilter(compiledScene,animatedObject);
    if(phase!=='full')drawAuthoredShip(ctx,animatedObject,!compiledScene.objects.some(prop=>prop.variant==='oar'&&prop.heldBy
      &&compiledScene.objects.some(actor=>actor.id===prop.heldBy&&actor.onBoat===object.id)),phase);
    else drawObject(ctx, animatedObject, compiledScene, timeMs, assetOrigin,contactActors.some(actor=>actor.id===object.id));
    ctx.restore();
    if(object.waterlineY!==undefined&&!underwaterShot&&transform.opacity>.05){
      ctx.save();ctx.strokeStyle='rgba(160,193,185,.42)';ctx.lineWidth=1.5;
      const drift=Math.sin(timeMs/1100)*3;
      for(const spread of [1,1.3]){
        ctx.beginPath();ctx.ellipse(transform.x+drift,object.waterlineY,object.width*.42*spread,3*spread,0,0,Math.PI*2);ctx.stroke();
      }
      ctx.restore();
    }
    const bowl=object.variant==='teapot'&&object.pouringInto&&compiledScene.objects.find(o=>o.id===object.pouringInto&&o.variant==='bowl');
    if(bowl){
      const destination=evaluateCanvasObject(bowl,compiledScene,timeMs),angle=transform.rotation*Math.PI/180;
      const sx=object.width*.49*transform.scale,sy=-object.height*.17*transform.scale;
      const x=transform.x+sx*Math.cos(angle)-sy*Math.sin(angle),y=transform.y+sx*Math.sin(angle)+sy*Math.cos(angle);
      if(destination.y>y){
        ctx.save();ctx.globalAlpha=transform.opacity;ctx.strokeStyle='rgba(190,213,210,.75)';ctx.lineWidth=2.3;
        ctx.setLineDash([6,3]);ctx.lineDashOffset=-timeMs/80;
        ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(destination.x,y+8,destination.x,destination.y-bowl.height*.08);ctx.stroke();ctx.restore();
      }
    }
  }

  // Under-floor horror keeps the threat partially occluded by a near post.
  // This foreground plane is drawn after actors so a shadow figure never reads
  // as a clean icon pasted on top of the architecture.
  if (compiledScene.backgroundRef === 'bg:room-underfloor') {
    ctx.save();
    const postX = width * .805;
    const postWidth = width * .025;
    const post = ctx.createLinearGradient(postX - postWidth, 0, postX + postWidth, 0);
    post.addColorStop(0, '#15110f');
    post.addColorStop(.48, '#34261f');
    post.addColorStop(1, '#110f0e');
    ctx.fillStyle = post;
    ctx.fillRect(postX - postWidth * .5, height * .29, postWidth, height * .58);
    ctx.fillStyle = 'rgba(0,0,0,.52)';
    ctx.fillRect(0, height * .86, width, height * .14);
    ctx.restore();
  }

  // A submerged torso stays behind the surface; the gripping limbs sit on
  // the near rim, above its hull. One world transform owns both passes.
  for(const actor of contactActors){
    const state=applyCanvasChoreographyState(actor,compiledScene,timeMs),frame=evaluateCanvasObject(actor,compiledScene,timeMs);
    ctx.save();ctx.globalAlpha=frame.opacity;ctx.translate(frame.x,frame.y);ctx.rotate(frame.rotation*Math.PI/180);ctx.scale(frame.scale,frame.scale);
    if(actor.appearance==='water-spirit')drawWaterSpirit(ctx,state,compiledScene,timeMs,'arms');
    else drawCharacterContactArms(ctx,state,compiledScene,timeMs);
    ctx.restore();
  }
  drawFolkContactLimbs(ctx, compiledScene, timeMs);
  for (const effect of effects.filter((item) => (item.zIndex || 0) >= 15)) drawSceneEffect(ctx, resolveCanvasLight(effect,compiledScene,timeMs), timeMs);
  drawCanvasRain(ctx,compiledScene,timeMs,width,height);
  drawAmbientAtmosphere(ctx,compiledScene,timeMs,width,height,'front');
  ctx.restore();

  drawSceneCredits(ctx, compiledScene, width, height);
}

function drawSceneCredits(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const lines = [
    scene.backgroundCredit,
    ...scene.objects.map((item) => item.credit).filter((item): item is string => Boolean(item)),
  ].map((line) => String(line || '').trim()).filter(Boolean).filter((line, index, all) => all.indexOf(line) === index).slice(0, 2);
  if (!lines.length) return;
  ctx.save();
  ctx.font = '13px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  const padX = 9;
  const lineH = 20;
  const boxW = Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2;
  const boxH = lines.length * lineH + 8;
  const x = 12;
  const y = height - boxH - 12;
  ctx.fillStyle = 'rgba(20, 16, 12, 0.62)';
  if (typeof (ctx as any).roundRect === 'function') {
    ctx.beginPath();
    (ctx as any).roundRect(x, y, Math.min(boxW, width - 24), boxH, 6);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, Math.min(boxW, width - 24), boxH);
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  lines.forEach((line, index) => {
    ctx.fillText(line.slice(0, 90), x + padX, y + 8 + lineH * index + lineH / 2 - 1);
  });
  ctx.restore();
}

function drawCanvasRain(ctx: CanvasRenderingContext2D,scene:CanvasStudioScene,timeMs:number,width:number,height:number) {
  const strength=Math.max(0,Math.min(1,scene.atmosphere?.rainIntensity||0));
  if(!strength)return;
  const elapsed=timeMs+(scene.atmosphere?.timeOffsetMs||0);
  ctx.save();ctx.strokeStyle='#b4c9d2';ctx.globalAlpha=.14+strength*.17;ctx.lineWidth=1.1;
  ctx.beginPath();
  for(let i=0;i<Math.round(90*strength);i++) {
    const y=(i*137+elapsed*(.34+(i%7)*.015))%(height+40)-40;
    const x=((i*193-y*.18)%width+width)%width;
    ctx.moveTo(x,y);ctx.lineTo(x-5,y+19);
  }
  ctx.stroke();ctx.restore();
}
