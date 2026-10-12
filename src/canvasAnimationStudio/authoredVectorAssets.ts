import { interpolate as interpolateShape } from 'flubber';
import type { CanvasStudioObject, CanvasStudioScene } from './types';
import { resolveCanvasPropVariant, canvasShipStyle } from '../../shared/canvasAssetRegistry';
import { CANVAS_DOOR_PANEL } from '../../shared/canvasEnvironment';
import {canvasLampLight} from '../../shared/canvasAtmosphere';
import {resolveCanvasProceduralAssetProfile, type CanvasProceduralAssetProfile} from '../../shared/canvasProceduralAssetForge';

type Pt = { x: number; y: number };

const INK = '#332f2b';
const PAPER = '#f4efe4';

const FIRE_MORPH = interpolateShape(
  'M 0 -44 C 9 -31 15 -19 11 -7 C 21 -14 29 -2 27 11 C 25 29 13 41 0 43 C -15 41 -27 29 -28 12 C -29 -2 -19 -13 -10 -8 C -13 -20 -8 -33 0 -44 Z',
  'M -2 -45 C 4 -32 9 -21 5 -10 C 19 -16 28 -3 24 10 C 20 28 10 40 -3 43 C -17 39 -25 27 -24 11 C -23 -3 -16 -11 -8 -5 C -9 -18 -7 -33 -2 -45 Z',
  { maxSegmentLength: 4 },
);
const FLAG_MORPH = interpolateShape(
  'M -26 -39 C -7 -36 12 -30 29 -25 C 20 -13 2 -13 -26 -17 Z',
  'M -26 -39 C -9 -43 12 -31 28 -29 C 18 -18 1 -11 -26 -18 Z',
  { maxSegmentLength: 4 },
);

function seedOf(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function rnd(seed: number, n: number) {
  let x = (seed + n * 2654435761) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967295;
}

function path(
  ctx: CanvasRenderingContext2D,
  d: string,
  fill: string | undefined,
  stroke = INK,
  width = 2.2,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const p = new Path2D(d);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(p);
  }
  if (stroke && width > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(p);
  }
  ctx.restore();
}

function curve(ctx: CanvasRenderingContext2D, points: Pt[], stroke = INK, width = 2.2, alpha = 1) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  if (points.length === 2) {
    ctx.lineTo(points[1]!.x, points[1]!.y);
  } else {
    for (let i = 1; i < points.length - 1; i += 1) {
      const p = points[i]!;
      const q = points[i + 1]!;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    const a = points[points.length - 2]!;
    const b = points[points.length - 1]!;
    ctx.quadraticCurveTo(a.x, a.y, b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill = INK) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function layeredLimb(
  ctx: CanvasRenderingContext2D,
  points: Pt[],
  fill: string,
  outerWidth: number,
  innerWidth: number,
  alpha = 1,
) {
  curve(ctx, points, INK, outerWidth, alpha);
  curve(ctx, points, fill, innerWidth, alpha);
}

function hatch(
  ctx: CanvasRenderingContext2D,
  lines: Array<[Pt, Pt]>,
  color = INK,
  width = .7,
  alpha = .24,
) {
  lines.forEach(([a, b]) => curve(ctx, [a, b], color, width, alpha));
}

/** Deterministic art-department detail. Nothing here uses frame randomness. */
function forgeGrain(
  ctx:CanvasRenderingContext2D,
  profile:CanvasProceduralAssetProfile,
  box:{left:number;top:number;right:number;bottom:number},
  vertical=false,
){
  const count=Math.max(0,Math.round(2+profile.detail*3+profile.grain*4));
  for(let i=0;i<count;i++){
    const a=rnd(profile.seed,90+i);
    const b=rnd(profile.seed,130+i);
    const c=rnd(profile.seed,170+i)-.5;
    if(vertical){
      const x=box.left+(box.right-box.left)*a;
      const y1=box.top+(box.bottom-box.top)*.08;
      const y2=box.bottom-(box.bottom-box.top)*.08;
      curve(ctx,[{x,y:y1},{x:x+c*4,y:(y1+y2)/2},{x:x-c*2,y:y2}],profile.shadow,.48+profile.detail*.2,.12+profile.grain*.18);
    }else{
      const y=box.top+(box.bottom-box.top)*a;
      const x1=box.left+(box.right-box.left)*.08;
      const x2=box.right-(box.right-box.left)*.08;
      curve(ctx,[{x:x1,y},{x:(x1+x2)/2,y:y+c*3},{x:x2,y:y-c*2}],profile.shadow,.48+profile.detail*.2,.12+profile.grain*.18);
    }
  }
}

function forgeWear(
  ctx:CanvasRenderingContext2D,
  profile:CanvasProceduralAssetProfile,
  points:Pt[],
){
  if(profile.wear<.25)return;
  const count=Math.max(1,Math.round(profile.wear*4));
  for(let i=0;i<count;i++){
    const p=points[i%points.length]!;
    const dx=(rnd(profile.seed,230+i)-.5)*9;
    const dy=(rnd(profile.seed,260+i)-.5)*9;
    curve(ctx,[{x:p.x+dx-2,y:p.y+dy},{x:p.x+dx+2.5,y:p.y+dy+(rnd(profile.seed,290+i)-.5)*2}],profile.highlight,.65,.18+profile.wear*.22);
  }
}

function forgeFastener(ctx:CanvasRenderingContext2D,profile:CanvasProceduralAssetProfile,x:number,y:number,r=1.2){
  if(profile.hardware<.25)return;
  dot(ctx,x,y,r,profile.shadow);
  curve(ctx,[{x:x-r*.7,y},{x:x+r*.7,y}],profile.highlight,.42,.55);
}

function fabricFolds(
  ctx: CanvasRenderingContext2D,
  seed: number,
  tone: string,
  density = 4,
) {
  for (let index = 0; index < density; index += 1) {
    const x = -9 + rnd(seed, 200 + index) * 18;
    const y = 2 + index * 4.2 + rnd(seed, 220 + index) * 2;
    curve(ctx, [
      { x, y },
      { x: x + (rnd(seed, 240 + index) - .5) * 2.4, y: y + 4 },
      { x: x + (rnd(seed, 260 + index) - .5) * 3.2, y: y + 8 },
    ], tone, .72, .34);
  }
}

function characterPose(object: CanvasStudioObject, timeMs: number) {
  const pose = object.pose || 'idle';
  const walk = Math.sin(timeMs / 150);
  const talk = Math.sin(timeMs / 175);

  let leftElbow = { x: -23, y: 4 };
  let leftHand = { x: -31, y: 17 };
  let rightElbow = { x: 23, y: 4 };
  let rightHand = { x: 31, y: 17 };
  let leftKnee = { x: -8, y: 36 };
  let leftFoot = { x: -10, y: 49 };
  let rightKnee = { x: 8, y: 36 };
  let rightFoot = { x: 10, y: 49 };

  if (pose === 'point') {
    rightElbow = { x: 27, y: -3 };
    rightHand = { x: 43, y: -9 };
    leftElbow = { x: -20, y: 6 };
    leftHand = { x: -27, y: 18 };
  } else if (pose === 'talk') {
    rightElbow = { x: 23 + talk * 2, y: 0 - talk * 2 };
    rightHand = { x: 33 + talk * 3, y: -7 - talk * 2 };
    leftElbow = { x: -22 - talk, y: 5 };
    leftHand = { x: -31 - talk * 2, y: 10 + talk * 2 };
  } else if (pose === 'run') {
    leftElbow = { x: -20 - walk * 4, y: 1 - walk * 3 };
    leftHand = { x: -28 - walk * 6, y: 11 - walk * 5 };
    rightElbow = { x: 20 - walk * 4, y: 1 + walk * 3 };
    rightHand = { x: 28 - walk * 6, y: 11 + walk * 5 };
    leftKnee = { x: -6 + walk * 6, y: 35 };
    leftFoot = { x: -10 + walk * 10, y: 48 - Math.max(0, walk) * 4 };
    rightKnee = { x: 6 + walk * 6, y: 35 };
    rightFoot = { x: 10 + walk * 10, y: 48 - Math.max(0, -walk) * 4 };
  } else if (pose === 'row') {
    leftElbow = { x: 2, y: 6 };
    leftHand = { x: 11 + talk * 4, y: 13 + talk * 2 };
    rightElbow = { x: 22, y: 1 };
    rightHand = { x: 35 + talk * 6, y: 14 + talk * 3 };
  } else if (pose === 'brace') {
    leftElbow = { x: -26, y: -1 };
    leftHand = { x: -39, y: 2 };
    rightElbow = { x: 26, y: -1 };
    rightHand = { x: 39, y: 2 };
    leftKnee = { x: -11, y: 36 };
    leftFoot = { x: -14, y: 49 };
    rightKnee = { x: 11, y: 36 };
    rightFoot = { x: 14, y: 49 };
  } else if (pose === 'celebrate') {
    leftElbow = { x: -22, y: -12 };
    leftHand = { x: -28, y: -31 };
    rightElbow = { x: 22, y: -12 };
    rightHand = { x: 28, y: -31 };
  }

  return { leftElbow, leftHand, rightElbow, rightHand, leftKnee, leftFoot, rightKnee, rightFoot };
}

function characterPalette(object: CanvasStudioObject) {
  const archetype = object.archetype || 'narrator';
  const defaults: Record<string, [string, string, string]> = {
    narrator: ['#d9a441', '#687878', '#e1b28b'],
    warrior: ['#9e5145', '#5f6b6c', '#ddb08a'],
    scholar: ['#7c7462', '#a48864', '#e1b28b'],
    villager: ['#aa7653', '#71806d', '#e1b28b'],
    merchant: ['#94705a', '#6d7180', '#e1b28b'],
    sailor: ['#607580', '#8d6759', '#ddb08a'],
    worker: ['#84705f', '#627279', '#ddb08a'],
  };
  const fallback = defaults[archetype] || defaults.narrator!;
  return {
    primary: object.color || fallback[0],
    secondary: object.secondaryColor || fallback[1],
    skin: object.skinTone || fallback[2],
    ink: '#332f2b',
  };
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  object: CanvasStudioObject,
  timeMs: number,
  seed: number,
  voiceActive = true,
) {
  const expression = object.expression || 'neutral';
  const eyeY = -30.5;
  const eyeSpread = 6.2 + rnd(seed, 11) * 1.2;
  const browTilt = (rnd(seed, 12) - .5) * .8;
  const mature = /old|elder|veteran|general|scholar|già|tướng|học giả/i.test(object.designNotes || '');
  const facialHair = object.archetype === 'warrior' && (mature || rnd(seed, 13) > .56);

  // Brows carry expression before the mouth does, matching editorial character design.
  const browLift = expression === 'surprised' ? -2.1 : expression === 'sad' ? -.8 : 0;
  if (expression === 'angry') {
    curve(ctx, [{x:-eyeSpread-3,y:eyeY-4},{x:-eyeSpread+2.5,y:eyeY-1.6+browTilt}], INK, 1.25);
    curve(ctx, [{x:eyeSpread+3,y:eyeY-4},{x:eyeSpread-2.5,y:eyeY-1.6-browTilt}], INK, 1.25);
  } else {
    curve(ctx, [{x:-eyeSpread-2.7,y:eyeY-3+browLift},{x:-eyeSpread+2.4,y:eyeY-3.1+browLift+browTilt}], INK, 1.05, .78);
    curve(ctx, [{x:eyeSpread-2.4,y:eyeY-3.1+browLift-browTilt},{x:eyeSpread+2.7,y:eyeY-3+browLift}], INK, 1.05, .78);
  }

  dot(ctx, -eyeSpread, eyeY, expression === 'surprised' ? 1.22 : 1.02);
  dot(ctx, eyeSpread, eyeY, expression === 'surprised' ? 1.22 : 1.02);

  // Nose bridge + nostril hint.
  curve(ctx, [{x:.4,y:-29},{x:-.4,y:-25.4},{x:.8,y:-23.7},{x:1.8,y:-24.1}], INK, .95, .58);
  curve(ctx, [{x:-1.8,y:-23.2},{x:-.8,y:-22.9}], INK, .7, .38);

  if (mature) {
    curve(ctx, [{x:-10.2,y:-25.7},{x:-12.1,y:-22.8}], INK, .68, .28);
    curve(ctx, [{x:10.2,y:-25.7},{x:12.1,y:-22.8}], INK, .68, .28);
    curve(ctx, [{x:-7.5,y:-17.7},{x:-4.2,y:-16.8}], INK, .6, .22);
    curve(ctx, [{x:7.5,y:-17.7},{x:4.2,y:-16.8}], INK, .6, .22);
  }

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.35;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (object.pose === 'talk') {
    // Voice-gated mouth: natural pauses stay shut instead of flapping forever.
    const open = voiceActive ? 1.05 + Math.abs(Math.sin(timeMs / 82)) * 1.25 : 0.45;
    ctx.ellipse(0, -19.8, 2.8, open, 0, 0, Math.PI * 2);
  } else if (expression === 'happy') {
    ctx.arc(0, -22.4, 4.8, .12 * Math.PI, .88 * Math.PI);
  } else if (expression === 'surprised') {
    ctx.ellipse(0, -20.6, 2.1, 2.8, 0, 0, Math.PI * 2);
  } else if (expression === 'angry' || expression === 'sad') {
    ctx.moveTo(-4.2, -19.1);
    ctx.quadraticCurveTo(0, -22.1, 4.2, -19.1);
  } else {
    ctx.moveTo(-4.3, -20.5);
    ctx.quadraticCurveTo(0, -19.7, 4.3, -20.5);
  }
  ctx.stroke();
  ctx.restore();

  if (facialHair) {
    curve(ctx, [{x:-4.8,y:-22.2},{x:0,y:-20.8},{x:4.8,y:-22.2}], INK, 1.05, .6);
    path(ctx, 'M -3 -18.5 C -2 -14.5 2 -14.5 3 -18.5 C 2.5 -15.2 1 -12.8 0 -11.8 C -1 -12.8 -2.5 -15.2 -3 -18.5 Z', INK, INK, .6, .55);
  }
}

function drawHead(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, seed: number) {
  const {skin, secondary, ink} = characterPalette(object);
  const archetype = object.archetype || 'narrator';
  const broad = rnd(seed, 5) > .58;
  const jaw = broad ? 1.8 : -1.2;
  const chin = rnd(seed, 7) > .55 ? 1.6 : -.4;

  // Identity-specific authored contour: temple width, cheek and chin all vary by stable seed.
  path(
    ctx,
    `M ${-18-jaw*.35} -41 C ${-16-jaw*.3} -48 -6 -51 4 -50 C 15 -49 ${20+jaw*.25} -43 ${20+jaw*.25} -34 C ${21+jaw*.25} -25 16 -16 ${9+jaw*.15} ${-12+chin*.25} C 2 ${-8+chin} -9 ${-9+chin*.7} ${-15-jaw*.12} -15 C ${-20-jaw*.25} -21 ${-22-jaw*.2} -32 ${-18-jaw*.35} -41 Z`,
    skin,
    ink,
    2.05,
  );

  path(ctx, 'M -18 -33 C -22 -34 -23 -29 -21 -25 C -20 -22 -17 -23 -16 -26 Z', skin, ink, 1.45);
  path(ctx, 'M 19 -33 C 23 -34 24 -29 22 -25 C 21 -22 18 -23 17 -26 Z', skin, ink, 1.45);
  // Inner ear detail.
  curve(ctx, [{x:-19.4,y:-30.6},{x:-18.2,y:-28.3},{x:-18.9,y:-26.2}], ink, .62, .32);
  curve(ctx, [{x:20.2,y:-30.6},{x:19,y:-28.3},{x:19.6,y:-26.2}], ink, .62, .32);

  const hair = object.hair || (archetype === 'warrior' || archetype === 'sailor' ? 'hat' : 'short');
  if (archetype === 'warrior' || hair === 'hat') {
    if (archetype === 'warrior') {
      // Helmet shell, brow band, cheek guards and plume — one designed object instead of a generic cap.
      path(ctx, 'M -17 -42 C -12 -50 10 -51 17 -42 L 15 -35 C 7 -38 -8 -38 -16 -35 Z', secondary, ink, 1.7);
      curve(ctx, [{x:-18,y:-36},{x:0,y:-34.8},{x:18,y:-36}], ink, 1.55);
      path(ctx, 'M -15 -35 L -18 -29 L -15 -23 L -12 -30 Z', secondary, ink, .9, .88);
      path(ctx, 'M 15 -35 L 18 -29 L 15 -23 L 12 -30 Z', secondary, ink, .9, .88);
    curve(ctx, [{x:-7,y:-45},{x:0,y:-48},{x:7,y:-45}], '#8f765e', .8, .55);
    curve(ctx, [{x:1,y:-48},{x:4,y:-54},{x:8,y:-52},{x:11,y:-48}], '#8e4e42', 2.3, .95);
  } else if (hair === 'bun') {
      path(ctx, 'M -16 -42 C -9 -48 10 -48 16 -41 L 14 -35 C 5 -38 -6 -38 -15 -35 Z', ink, ink, 1.3);
      curve(ctx, [{x:-11,y:-40},{x:0,y:-43},{x:11,y:-40}], '#5a554f', .7, .45);
    }
  } else if (hair === 'bun') {
    path(ctx, 'M -17 -39 C -15 -48 -5 -51 6 -50 C 15 -49 18 -43 18 -37 C 11 -41 -7 -40 -17 -34 Z', ink, ink, 1.15);
    dot(ctx, 14, -48, 4.2, ink);
    curve(ctx, [{x:-11,y:-42},{x:-2,y:-46},{x:9,y:-43}], '#5c5148', .7, .4);
  } else if (hair !== 'bald') {
    const rise = hair === 'messy' ? 4 : 0;
    path(ctx, `M -17 -38 C -14 -47 -7 ${-48-rise} 1 ${-47-rise} C 9 ${-50-rise} 16 -46 18 -39 C 10 -41 -7 -40 -17 -34 Z`, ink, ink, 1.15);
    // Hair strand accents avoid a single helmet-like blob.
    const strandColor = '#564b43';
    curve(ctx, [{x:-12,y:-41-rise*.2},{x:-7,y:-46-rise*.45},{x:-2,y:-41}], strandColor, .72, .52);
    curve(ctx, [{x:-2,y:-43-rise*.2},{x:4,y:-48-rise*.35},{x:9,y:-42}], strandColor, .72, .52);
    curve(ctx, [{x:8,y:-42},{x:13,y:-45-rise*.15},{x:15,y:-39}], strandColor, .68, .45);
  } else {
    // A few scalp lines keep bald heads illustrated rather than perfectly smooth.
    curve(ctx, [{x:-7,y:-47},{x:0,y:-49},{x:7,y:-47}], ink, .6, .18);
  }
}

function drawTorso(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, seed: number) {
  const {primary, secondary, ink} = characterPalette(object);
  const archetype = object.archetype || 'narrator';

  if (archetype === 'scholar') {
    path(ctx, 'M -14 -9 C -10 -13 10 -13 14 -9 L 19 24 C 12 30 -12 30 -19 24 Z', primary, ink, 2);
    path(ctx, 'M -8 -9 C -5 -5 -2 -3 0 -2 C 3 -4 6 -6 8 -9', undefined, secondary, 1.5);
    curve(ctx, [{x:0,y:-2},{x:0,y:24}], secondary, 1.15, .75);
    curve(ctx, [{x:-12,y:14},{x:12,y:14}], '#6e6458', .72, .32);
    dot(ctx, 0, 5, 1.05, '#6e6458');
    dot(ctx, 0, 11, 1.05, '#6e6458');
    fabricFolds(ctx, seed, '#5f574f', 4);
  } else if (archetype === 'warrior') {
    path(ctx, 'M -15 -8 C -11 -13 11 -13 15 -8 L 18 22 C 11 27 -11 27 -18 22 Z', primary, ink, 2);
    path(ctx, 'M -15 -7 L -24 -1 L -18 7 L -12 3 Z', secondary, ink, 1.6);
    path(ctx, 'M 15 -7 L 24 -1 L 18 7 L 12 3 Z', secondary, ink, 1.6);
    // Layered lamellar chest plate rather than one blank color block.
    path(ctx, 'M -10 -3 L 10 -3 L 12 12 C 6 15 -6 15 -12 12 Z', '#7e5c4c', ink, 1.05, .78);
    for (let row = 0; row < 3; row += 1) {
      const y = 1 + row * 4.2;
      curve(ctx, [{x:-9.5,y},{x:0,y:y+1},{x:9.5,y}], '#b08a68', .72, .58);
    }
    for (const x of [-6,-2,2,6]) {
      curve(ctx, [{x,y:-1},{x:x+.4,y:12}], '#5e4d43', .55, .45);
    }
    curve(ctx, [{x:-13,y:14},{x:13,y:14}], ink, 1.7);
    path(ctx, 'M -13 14 C -8 16 8 16 13 14 L 12 18 C 5 20 -5 20 -12 18 Z', secondary, ink, .85, .95);
    curve(ctx, [{x:-9,y:-5},{x:8,y:17}], '#554a43', 1.05, .7);
  } else if (archetype === 'worker') {
    path(ctx, 'M -14 -8 C -10 -12 10 -12 14 -8 L 15 24 C 7 28 -7 28 -15 24 Z', primary, ink, 2);
    path(ctx, 'M -7 -5 L -6 21 L 6 21 L 7 -5', secondary, ink, 1.4);
    path(ctx, 'M -5 8 L 5 8 L 5 16 L -5 16 Z', '#708087', ink, .72, .58);
    curve(ctx, [{x:-11,y:19},{x:11,y:19}], '#584f48', .75, .34);
    fabricFolds(ctx, seed, '#554d47', 3);
  } else if (archetype === 'merchant') {
    path(ctx, 'M -15 -8 C -11 -12 11 -12 15 -8 L 17 24 C 10 28 -10 28 -17 24 Z', primary, ink, 2);
    curve(ctx, [{x:-13,y:-3},{x:8,y:20}], secondary, 1.8);
    path(ctx, 'M 4 14 C 8 11 14 12 16 17 C 15 22 8 24 4 21 Z', secondary, ink, .9);
    curve(ctx, [{x:-9,y:7},{x:-5,y:9}], '#5c5149', .72, .36);
    curve(ctx, [{x:-8,y:13},{x:-4,y:15}], '#5c5149', .72, .36);
  } else if (archetype === 'sailor') {
    path(ctx, 'M -15 -8 C -11 -12 11 -12 15 -8 L 16 24 C 9 28 -9 28 -16 24 Z', primary, ink, 2);
    for (const y of [3, 8, 13]) curve(ctx, [{x:-11,y},{x:11,y}], secondary, 1.05, .78);
    curve(ctx, [{x:-7,y:-7},{x:0,y:-3},{x:7,y:-7}], '#495d65', 1.1, .75);
    fabricFolds(ctx, seed, '#45545a', 3);
  } else if (archetype === 'villager') {
    path(ctx, 'M -15 -8 C -11 -12 11 -12 15 -8 L 16 24 C 9 28 -9 28 -16 24 Z', primary, ink, 2);
    curve(ctx, [{x:-8,y:-6},{x:0,y:-1},{x:8,y:-6}], secondary, 1.15, .7);
    curve(ctx, [{x:-13,y:16},{x:12,y:16}], '#695c50', 1.25, .55);
    path(ctx, 'M -13 16 C -6 18 6 18 13 16 L 12 19 C 5 21 -5 21 -12 19 Z', secondary, ink, .7, .82);
    fabricFolds(ctx, seed, '#5c5148', 4);
  } else {
    path(ctx, 'M -15 -8 C -11 -12 11 -12 15 -8 L 16 24 C 9 28 -9 28 -16 24 Z', primary, ink, 2);
    curve(ctx, [{x:-7,y:-7},{x:0,y:-3},{x:7,y:-7}], secondary, 1.15, .7);
    curve(ctx, [{x:-12,y:16},{x:12,y:16}], '#65594f', .82, .42);
    fabricFolds(ctx, seed, '#5c5149', 3);
  }

  // Neck and collar bridge the head/body and add depth.
  path(ctx, 'M -4 -13 L -3 -7 C -1 -5 1 -5 3 -7 L 4 -13 Z', characterPalette(object).skin, INK, 1.35);
  curve(ctx, [{x:-5.5,y:-7.5},{x:0,y:-4.7},{x:5.5,y:-7.5}], '#6b5f54', .68, .32);
}

function drawLimbs(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, timeMs: number) {
  const pose = characterPose(object, timeMs);
  const {skin, secondary, primary, ink} = characterPalette(object);
  const shoulderL = {x:-15,y:-4};
  const shoulderR = {x:15,y:-4};
  const hipL = {x:-7,y:24};
  const hipR = {x:7,y:24};

  // Sleeves + forearms are layered separately so arms no longer read as loose wires.
  layeredLimb(ctx, [shoulderL, pose.leftElbow], primary, 4.3, 2.65);
  layeredLimb(ctx, [shoulderR, pose.rightElbow], primary, 4.3, 2.65);
  layeredLimb(ctx, [pose.leftElbow, pose.leftHand], skin, 3.25, 1.72);
  layeredLimb(ctx, [pose.rightElbow, pose.rightHand], skin, 3.25, 1.72);

  // Cuffs make hand attachment intentional.
  curve(ctx, [
    {x:pose.leftElbow.x-1.5,y:pose.leftElbow.y-.8},
    {x:pose.leftElbow.x+1.7,y:pose.leftElbow.y+.9},
  ], secondary, 1.35, .8);
  curve(ctx, [
    {x:pose.rightElbow.x-1.7,y:pose.rightElbow.y+.9},
    {x:pose.rightElbow.x+1.5,y:pose.rightElbow.y-.8},
  ], secondary, 1.35, .8);

  // Hands: palm + tiny thumb stroke.
  dot(ctx, pose.leftHand.x, pose.leftHand.y, 1.9, skin);
  dot(ctx, pose.rightHand.x, pose.rightHand.y, 1.9, skin);
  curve(ctx, [
    {x:pose.leftHand.x-1.4,y:pose.leftHand.y+.2},
    {x:pose.leftHand.x-2.6,y:pose.leftHand.y+1.2},
  ], ink, .65, .5);
  curve(ctx, [
    {x:pose.rightHand.x+1.4,y:pose.rightHand.y+.2},
    {x:pose.rightHand.x+2.6,y:pose.rightHand.y+1.2},
  ], ink, .65, .5);

  // Trouser legs have dark outline + cloth interior.
  layeredLimb(ctx, [hipL, pose.leftKnee, pose.leftFoot], secondary, 4.5, 2.75);
  layeredLimb(ctx, [hipR, pose.rightKnee, pose.rightFoot], secondary, 4.5, 2.75);

  // Shoes are short authored wedges rather than line caps.
  path(ctx,
    `M ${pose.leftFoot.x-3.2} ${pose.leftFoot.y-1.1} C ${pose.leftFoot.x-1.2} ${pose.leftFoot.y-2.2} ${pose.leftFoot.x+3.7} ${pose.leftFoot.y-1.7} ${pose.leftFoot.x+4.4} ${pose.leftFoot.y+.2} C ${pose.leftFoot.x+1.2} ${pose.leftFoot.y+1.5} ${pose.leftFoot.x-2.6} ${pose.leftFoot.y+1.3} ${pose.leftFoot.x-3.2} ${pose.leftFoot.y-1.1} Z`,
    '#574c44', ink, .8);
  path(ctx,
    `M ${pose.rightFoot.x-3.2} ${pose.rightFoot.y-1.1} C ${pose.rightFoot.x-1.2} ${pose.rightFoot.y-2.2} ${pose.rightFoot.x+3.7} ${pose.rightFoot.y-1.7} ${pose.rightFoot.x+4.4} ${pose.rightFoot.y+.2} C ${pose.rightFoot.x+1.2} ${pose.rightFoot.y+1.5} ${pose.rightFoot.x-2.6} ${pose.rightFoot.y+1.3} ${pose.rightFoot.x-3.2} ${pose.rightFoot.y-1.1} Z`,
    '#574c44', ink, .8);
}

function drawCharacterAccessories(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, seed: number) {
  const {secondary, ink} = characterPalette(object);
  const archetype = object.archetype || 'narrator';

  if (archetype === 'scholar') {
    // Head band + hanging book cord.
    curve(ctx,[{x:-12,y:-38},{x:12,y:-38}], secondary,1.45,.82);
    curve(ctx,[{x:10,y:-37},{x:14,y:-31}], secondary,.9,.66);
    curve(ctx,[{x:-12,y:5},{x:-16,y:20},{x:-13,y:30}], '#75634f',1.25,.72);
    path(ctx,'M -17 22 C -13 20 -9 22 -8 27 C -10 31 -15 31 -18 28 Z','#a98b65',ink,.75,.82);
  } else if (archetype === 'sailor') {
    // Knotted scarf + rope belt.
    path(ctx,'M -8 -7 C -3 -4 3 -4 8 -7 L 5 -1 C 2 1 -2 1 -5 -1 Z',secondary,ink,.8,.9);
    curve(ctx,[{x:-12,y:16},{x:12,y:16}], '#6d594a',1.4,.72);
    for(const x of [-8,-4,0,4,8]) dot(ctx,x,16, .55,'#4d423a');
  } else if (archetype === 'merchant') {
    // Shoulder strap and small purse tassel.
    curve(ctx,[{x:-12,y:-4},{x:9,y:22}], secondary,1.55,.9);
    curve(ctx,[{x:10,y:21},{x:12,y:27}], ink,.85,.55);
    dot(ctx,12,28,1.3,secondary);
  } else if (archetype === 'worker') {
    // Rolled sleeve bands + waist tool loop.
    curve(ctx,[{x:-16,y:2},{x:-12,y:4}], secondary,1.4,.82);
    curve(ctx,[{x:16,y:2},{x:12,y:4}], secondary,1.4,.82);
    curve(ctx,[{x:8,y:18},{x:14,y:22},{x:11,y:28}], '#5b4e43',1.15,.72);
  } else if (archetype === 'villager') {
    // Cloth sash and simple side knot.
    curve(ctx,[{x:-13,y:15},{x:13,y:15}], secondary,1.55,.84);
    curve(ctx,[{x:9,y:15},{x:15,y:19},{x:13,y:25}], secondary,1.15,.76);
  } else if (archetype === 'narrator') {
    // Minimal lapel/pocket keeps the host clean but designed.
    curve(ctx,[{x:-7,y:-6},{x:-1,y:3},{x:4,y:-5}], secondary,1.1,.6);
    if(rnd(seed,310)>.5) path(ctx,'M 6 8 L 12 8 L 11 13 L 7 13 Z',undefined,ink,.65,.42);
  }
}

function drawWarriorDetails(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  if (object.archetype !== 'warrior') return;
  const {secondary, ink} = characterPalette(object);
  // Small sheathed sword is attached to the actor rather than floating as a separate icon.
  curve(ctx, [{x:12,y:13},{x:20,y:28},{x:23,y:40}], ink, 1.55);
  curve(ctx, [{x:17,y:24},{x:24,y:21}], secondary, 1.9);
}

export function drawAuthoredCharacter(
  ctx: CanvasRenderingContext2D,
  object: CanvasStudioObject,
  timeMs: number,
  voiceActive = true,
) {
  const facing = object.facing === 'left' ? -1 : 1;
  const seed = seedOf(object.characterKey || object.label || object.id);

  // Stable authored proportions: height drives scale, width only nudges horizontal size.
  const sx = Math.min(object.width, object.height * .46) / 100;
  const sy = object.height / 100;

  ctx.save();
  ctx.scale(facing * sx, sy);

  // Grounding shadow.
  ctx.save();
  ctx.globalAlpha = .08;
  ctx.fillStyle = '#25211e';
  ctx.beginPath();
  ctx.ellipse(0, 49.5, 14, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawLimbs(ctx, object, timeMs);
  drawTorso(ctx, object, seed);
  drawHead(ctx, object, seed);
  drawFace(ctx, object, timeMs, seed, voiceActive);
  drawCharacterAccessories(ctx, object, seed);
  drawWarriorDetails(ctx, object);

  ctx.restore();
}

function shipPalette(object: CanvasStudioObject) {
  return {
    hull: object.color || '#77513c',
    darkHull: '#5d3d30',
    sail: object.secondaryColor || '#d8c7a4',
    ink: '#332a24',
    deck: '#9b7455',
  };
}

export function drawAuthoredShip(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, restingPaddle = true, phase:'full'|'back'|'front'='full') {
  if(canvasShipStyle(object)==='ferry'){drawWoodenFerry(ctx,object,restingPaddle,phase);return;}
  const p = shipPalette(object);
  const large = /large|war|fleet|yuan|mongol|nguyên|hạm/i.test(`${object.label} ${object.designNotes || ''}`);
  const sx = object.width / 100;
  const sy = object.height / 100;

  ctx.save();
  ctx.scale(sx, sy);

  ctx.save();
  ctx.globalAlpha = .1;
  ctx.fillStyle = '#1f3437';
  ctx.beginPath();
  ctx.ellipse(0, 34, 43, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Curved hull + darker lower plane.
  path(ctx, 'M -48 3 C -38 25 -22 34 5 35 C 28 35 41 27 48 6 C 29 12 -14 14 -48 3 Z', p.hull, p.ink, 1.9);
  path(ctx, 'M -35 18 C -16 28 16 29 36 18 C 31 28 20 34 4 35 C -14 35 -27 30 -35 18 Z', p.darkHull, p.ink, 1.2);
  curve(ctx, [{x:-40,y:10},{x:0,y:13},{x:39,y:9}], p.deck, 1.5, .9);
  curve(ctx, [{x:-31,y:19},{x:1,y:22},{x:29,y:18}], '#c39973', 1.15, .65);

  // Hull plank seams + ribs + stern cabin detail.
  for (const y of [15, 21, 27]) {
    curve(ctx, [{x:-33,y},{x:0,y:y+2},{x:32,y:y-1}], '#4e352b', .72, .42);
  }
  for (const x of [-24,-13,-2,10,22]) {
    curve(ctx, [{x,y:10},{x:x+1.2,y:29}], '#4a3229', .58, .33);
  }
  path(ctx, 'M -27 3 L -18 -5 L -6 -5 L -1 5 Z', '#8f6b50', p.ink, .9, .95);
  path(ctx, 'M -23 -3 L -20 -8 L -16 -8 L -13 -3 Z', '#d7c7a4', p.ink, .7, .75);
  curve(ctx, [{x:31,y:6},{x:38,y:1},{x:42,y:-4}], p.ink, 1, .65);

  const mastXs = large ? [-20, 2, 24] : [-13, 14];
  mastXs.forEach((x, i) => {
    const top = large ? (-41 - (i % 2) * 5) : (-39 - (i % 2) * 4);
    curve(ctx, [{x,y:9},{x:x+(i-1)*.8,y:top}], p.ink, 1.45);
    const dir = i % 2 === 0 ? 1 : -1;
    const sailWidth = large ? 19 : 22;
    const sailPath = dir > 0
      ? `M ${x+1} ${top+4} C ${x+sailWidth*.55} ${top+7} ${x+sailWidth} ${top+16} ${x+sailWidth*.88} -6 C ${x+sailWidth*.55} -1 ${x+sailWidth*.2} -2 ${x+1} -5 Z`
      : `M ${x-1} ${top+4} C ${x-sailWidth*.55} ${top+7} ${x-sailWidth} ${top+16} ${x-sailWidth*.88} -6 C ${x-sailWidth*.55} -1 ${x-sailWidth*.2} -2 ${x-1} -5 Z`;
    path(ctx, sailPath, p.sail, p.ink, 1.25);
    curve(ctx, [{x,y:top+4},{x:x+dir*sailWidth*.82,y:-6}], p.ink, .8, .45);
    // Sail ribs and folds create material depth.
    for (let rib = 1; rib <= 3; rib += 1) {
      const t = rib / 4;
      const sx1 = x + dir * sailWidth * (.08 + .7 * t);
      const sy1 = top + 6 + (18 - (top + 6)) * t;
      curve(ctx, [
        {x:x+dir*1.5,y:top+5+t*2},
        {x:sx1,y:sy1},
      ], '#806f5e', .55, .32);
    }
    curve(ctx, [
      {x:x+dir*sailWidth*.18,y:top+9},
      {x:x+dir*sailWidth*.52,y:top+15},
      {x:x+dir*sailWidth*.77,y:-8},
    ], '#a79273', .62, .3);
    path(ctx, `M ${x} ${top-2} L ${x+dir*8} ${top+1} L ${x} ${top+5} Z`, '#a34f42', p.ink, .85);
  });

  mastXs.forEach((x, i) => {
    const top = large ? (-41 - (i % 2) * 5) : (-39 - (i % 2) * 4);
    curve(ctx, [{x,y:top+3},{x:-34+i*22,y:8}], p.ink, .7, .35);
  });

  const crew = large ? 5 : 3;
  for (let i = 0; i < crew; i += 1) {
    const x = -25 + i * (50 / Math.max(1, crew - 1));
    dot(ctx, x, 5.5, 1.25, '#d9ad88');
    path(ctx, `M ${x-1.8} 4.8 L ${x} 2.9 L ${x+1.8} 4.8 Z`, '#3f4547', p.ink, .45);
    curve(ctx, [{x,y:7},{x:x+(i%2?1.1:-1.1),y:12}], p.ink, 1.25);
    curve(ctx, [{x:x-.9,y:9},{x:x-2.2,y:11.5}], p.ink, .72, .72);
    curve(ctx, [{x:x+.9,y:9},{x:x+2.1,y:11.3}], p.ink, .72, .72);
  }

  // Bow curl gives the hull a designed historical silhouette.
  curve(ctx, [{x:42,y:8},{x:50,y:0},{x:47,y:-6}], p.ink, 1.35);

  ctx.restore();
}

function drawWoodenFerry(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, restingPaddle: boolean, phase:'full'|'back'|'front') {
  const p=shipPalette(object);
  ctx.save();ctx.scale(object.width/100,object.height/100);
  // Open gunwale in shallow perspective, with the hull sitting on the water.
  const wood=ctx.createLinearGradient(0,-9,0,35);
  wood.addColorStop(0,p.hull);wood.addColorStop(.55,'#805d43');wood.addColorStop(1,'#44372e');
  const hull=new Path2D('M -49 -5 Q -37 9 0 10 Q 35 8 49 -9 Q 43 22 28 29 Q 0 38 -29 28 Q -43 19 -49 -5 Z');
  if(phase==='full'){ctx.fillStyle=wood;ctx.fill(hull);ctx.strokeStyle=p.ink;ctx.lineWidth=1.2;ctx.stroke(hull);}
  if(phase!=='front'){
  path(ctx,'M -49 -5 Q -28 -20 12 -19 Q 39 -18 49 -9 Q 34 7 0 10 Q -34 8 -49 -5 Z','#332d28',p.ink,1);
  path(ctx,'M -41 -5 Q -20 -14 12 -13 Q 32 -13 41 -8 Q 28 1 0 3 Q -24 3 -41 -5 Z','#72533d',p.ink,.6);
  for(const x of [-26,-7,15,32]){
    path(ctx,`M ${x-3} -12 L ${x+2} -13 L ${x+7} 4 L ${x+1} 5 Z`,'#aa8059',p.ink,.55);
    curve(ctx,[{x:x-1,y:-10},{x:x+4,y:2}],'#d0a777',.35,.65);
  }
  }
  if(phase!=='back'){
  if(phase==='front'){ctx.fillStyle=wood;ctx.fill(hull);ctx.strokeStyle=p.ink;ctx.lineWidth=1.2;ctx.stroke(hull);}
  curve(ctx,[{x:-48,y:-5},{x:0,y:10},{x:48,y:-9}],'#bd936a',1.8);
  for(const y of [16,22,28])curve(ctx,[{x:-37+(y-16)*.6,y},{x:0,y:y+6},{x:38-(y-16)*.8,y:y-2}],'#332b25',.6,.65);
  for(const x of [-28,-10,12,29])curve(ctx,[{x,y:13},{x:x*.8,y:29}],'#c69b72',.35,.4);
  // A real paddle: thin shaft and broad blade, resting across the stern.
  if(restingPaddle){
    curve(ctx,[{x:-39,y:-11},{x:-10,y:18}],'#bb9265',1.5);
    path(ctx,'M -14 12 L -5 19 Q -1 25 -6 26 L -16 17 Z','#ac8058',p.ink,.55);
  }
  curve(ctx,[{x:37,y:-8},{x:49,y:-14},{x:55,y:-3}],'#a68d6b',.8,.8);
  curve(ctx,[{x:-36,y:30},{x:0,y:37},{x:34,y:30}],'#a9c7c7',.65,.35);
  }
  ctx.restore();
}

export function drawAuthoredStake(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  const sx = object.width / 100;
  const sy = object.height / 100;
  const wood = object.color || '#6b4a35';
  const light = object.secondaryColor || '#9a7554';
  const seed = seedOf(object.assetRef || object.label || object.id);

  ctx.save();
  ctx.scale(sx, sy);

  const count = Math.max(3, Math.min(7, Math.round(3 + Math.min(4, object.width / Math.max(1, object.height) * 8))));
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? .5 : index / (count - 1);
    const x = -38 + t * 76 + (rnd(seed, index + 10) - .5) * 8;
    const height = 58 + rnd(seed, index + 20) * 26;
    const base = 42 - rnd(seed, index + 30) * 5;
    const lean = (rnd(seed, index + 40) - .5) * 7;
    const half = 3.2 + rnd(seed, index + 50) * 1.8;

    ctx.save();
    ctx.translate(x, 0);
    path(
      ctx,
      `M ${-half} ${base} L ${-half + lean * .35} ${-height * .64} L ${lean} ${-height} L ${half + lean * .35} ${-height * .64} L ${half} ${base} Z`,
      wood,
      INK,
      1.2,
      .94,
    );
    curve(ctx, [{x:-half*.25,y:base-8},{x:lean*.2,y:-height*.54}], light, .8, .55);
    curve(ctx, [{x:half*.18,y:base-17},{x:lean*.25+half*.1,y:-height*.42}], '#4c3529', .6, .35);
    ctx.restore();
  }

  // Low dark base visually groups the stakes into one authored cluster.
  path(ctx, 'M -46 39 C -27 34 -9 37 2 35 C 18 32 31 36 47 33 L 47 47 L -46 47 Z', '#51483b', INK, .8, .45);

  ctx.restore();
}

export function drawAuthoredProp(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, timeMs = 0, scene?:CanvasStudioScene) {
  const v = resolveCanvasPropVariant(object);
  const profile=resolveCanvasProceduralAssetProfile(object,scene);
  const sx = object.width / 100;
  const sy = object.height / 100;
  const fill = object.color || '#b58a5f';
  const secondary = object.secondaryColor || '#768071';

  ctx.save();
  ctx.scale(sx, sy);

  if(v==='dog'||v==='demon-dog'){
    const fur=object.color||'#d7d0bf';
    const shade=object.secondaryColor||'#625f58';
    const notes=(object.designNotes||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');
    const demon=v==='demon-dog';
    const hasHat=demon&&/(non|hat|conical|me rach)/.test(notes);
    const hasCane=demon&&/(gay|cane|staff|bamboo)/.test(notes);
    if(object.facing==='left')ctx.scale(-1,1);
    if(demon){
      // Supernatural canine kept unmistakably animal even when standing upright:
      // long muzzle, pointed ears, hock-shaped hind legs and a visible tail.
      ctx.save();ctx.globalAlpha*=Math.max(.25,object.opacity??1);
      const sway=Math.sin(timeMs/900)*1.2;
      ctx.translate(0,sway);
      path(ctx,'M -18 -10 C -20 8 -17 26 -12 38 L -2 38 L 0 10 L 8 38 L 19 38 C 21 13 20 -5 14 -17 C 8 -27 -8 -28 -15 -18 Z',fur,INK,1.35);
      path(ctx,'M -13 31 L -17 47 L -29 48 Q -32 43 -25 39 L -20 27 Z',shade,INK,1.1);
      path(ctx,'M 13 31 L 18 47 L 30 48 Q 33 43 26 39 L 20 27 Z',shade,INK,1.1);
      path(ctx,'M -13 -17 C -10 -29 11 -31 15 -16 L 11 -3 L -11 -3 Z',fur,INK,1.2);
      path(ctx,'M -17 -34 Q -10 -49 5 -48 Q 20 -46 22 -31 Q 20 -18 8 -16 Q -7 -16 -17 -25 Z',fur,INK,1.35);
      path(ctx,'M -13 -42 L -22 -55 L -5 -49 Z',shade,INK,1);
      path(ctx,'M 9 -47 L 18 -58 L 23 -41 Z',shade,INK,1);
      path(ctx,'M 7 -32 Q 25 -36 31 -25 Q 29 -14 13 -15 Q 3 -18 7 -32 Z',object.accent||'#a58f80',INK,1.1);
      ctx.fillStyle=INK;ctx.beginPath();ctx.ellipse(29,-25,1.8,2.3,0,0,Math.PI*2);ctx.fill();
      for(const x of [-5,7]){ctx.fillStyle=demon?'#a33b32':INK;ctx.beginPath();ctx.ellipse(x,-35,1.8,2.2,0,0,Math.PI*2);ctx.fill();}
      curve(ctx,[{x:-12,y:-8},{x:-24,y:8},{x:-17,y:20}],shade,4.2,.9);
      curve(ctx,[{x:12,y:-8},{x:24,y:7},{x:18,y:20}],shade,4.2,.9);
      curve(ctx,[{x:-16,y:10},{x:-33,y:4},{x:-36,y:-8},{x:-28,y:-15}],shade,4,.9);
      if(hasHat){
        path(ctx,'M -24 -50 Q 0 -66 26 -49 L 20 -44 L -19 -44 Z','#76624b',INK,1.2);
        curve(ctx,[{x:-34,y:-43},{x:32,y:-43}],INK,2);
      }
      if(hasCane){
        curve(ctx,[{x:27,y:-1},{x:33,y:46}],'#806344',3.2,.95);
        curve(ctx,[{x:26,y:-2},{x:31,y:-9},{x:36,y:-4}],'#806344',3.2,.95);
      }
      ctx.restore();
    }else{
      const step=(object.motion==='walk-left'||object.motion==='walk-right')?Math.sin(timeMs/180)*2:0;
      for(const [x,phase] of [[-22,1],[-9,-1],[14,-1],[27,1]] as const){
        const lift=Math.max(0,step*phase);
        path(ctx,'M '+(x-3)+' 11 L '+(x+4)+' 11 L '+(x+3)+' '+(37-lift)+' L '+(x-4)+' '+(37-lift)+' Z',shade,INK,.95);
      }
      path(ctx,'M -36 1 Q -35 -22 -9 -25 Q 17 -27 30 -10 L 31 11 Q 12 24 -15 21 Q -35 18 -36 1 Z',fur,INK,1.3);
      path(ctx,'M 17 -10 Q 18 -31 35 -28 Q 48 -23 46 -5 L 42 10 Q 29 18 17 9 Z',fur,INK,1.2);
      path(ctx,'M 21 -24 L 15 -37 Q 29 -38 31 -24 Z',shade,INK,.9);
      path(ctx,'M 35 -23 L 42 -35 Q 49 -28 43 -18 Z',shade,INK,.9);
      path(ctx,'M 37 -5 Q 49 -8 51 0 Q 49 8 38 8 Q 31 5 37 -5 Z','#a58f80',INK,.9);
      ctx.fillStyle=INK;ctx.beginPath();ctx.ellipse(31,-14,1.6,2,0,0,Math.PI*2);ctx.fill();
      curve(ctx,[{x:-35,y:-4},{x:-45,y:-14},{x:-49,y:-4},{x:-42,y:1}],shade,2.6,.9);
    }
  } else if(v==='pig'||v==='pig-hoof'){
    const skin=!object.color||['#b78a5d','#d8b06d'].includes(object.color)?'#bd9484':object.color;
    const shade=!object.secondaryColor||object.secondaryColor==='#7a8270'?'#946e61':object.secondaryColor;
    const count=object.hoofCount===5?5:4;
    if(object.facing==='left')ctx.scale(-1,1);
    const hoof=(x:number,y:number,size:number)=>{
      ctx.save();ctx.translate(x,y);ctx.scale(size,size);
      path(ctx,'M -6 -9 Q 0 -11 6 -9 L 7 1 Q 0 5 -7 1 Z',skin,INK,.8);
      // Spread all digits across the terminal foot, never up the shin.
      for(let i=0;i<count;i++){
        const toe=-6+(i+.5)*12/count;
        path(ctx,`M ${toe-5/count} -1 Q ${toe} -3 ${toe+5/count} -1 L ${toe+5/count} 3 Q ${toe} 5 ${toe-5/count} 3 Z`,'#554941',INK,.45);
      }
      ctx.restore();
    };
    if(v==='pig-hoof'){
      path(ctx,'M -19 -43 Q 0 -48 19 -43 L 20 8 Q 0 20 -20 8 Z',skin,INK,1.3);
      hoof(0,28,4);
    }else if(object.pose==='reach'){
      // A rearing pig keeps two hind hooves grounded; front legs brace higher.
      for(const x of [-12,12]){
        path(ctx,`M ${x-5} 12 L ${x+5} 12 L ${x+4} 37 L ${x-4} 37 Z`,skin,INK,1);
        hoof(x,38,1);
      }
      path(ctx,'M -24 5 Q -27 -17 -12 -25 Q 8 -34 22 -12 L 22 13 Q 0 28 -20 17 Z',skin,INK,1.4);
      for(const [x,y] of [[27,-18],[35,-10]] as const){
        path(ctx,`M 13 -9 Q 21 -14 ${x} ${y} L ${x+4} ${y+6} Q 23 0 15 5 Z`,skin,INK,1);
        hoof(x,y,1);
      }
      path(ctx,'M -8 -28 Q -7 -47 11 -46 Q 30 -43 31 -25 L 27 -14 Q 8 -9 -6 -18 Z',skin,INK,1.3);
      path(ctx,'M -4 -39 L -13 -49 Q 0 -52 7 -43 Z',shade,INK,1);
      path(ctx,'M 17 -42 L 26 -52 Q 36 -46 26 -34 Z',shade,INK,1);
      path(ctx,'M 23 -29 Q 37 -32 39 -22 Q 37 -13 25 -16 Q 18 -19 23 -29 Z','#cba797',INK,1);
      for(const x of [29,34]){ctx.fillStyle='#665046';ctx.beginPath();ctx.ellipse(x,-23,1.2,2,0,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle=INK;ctx.beginPath();ctx.ellipse(16,-35,1.7,2,0,0,Math.PI*2);ctx.fill();
      curve(ctx,[{x:-23,y:7},{x:-35,y:2},{x:-38,y:11},{x:-30,y:12},{x:-31,y:5}],shade,1.6);
    }else{
      const frames=object.keyframes||[];
      const keyedTravel=frames.some((frame,index)=>{
        const next=frames[index+1];return next&&timeMs>=frame.atMs&&timeMs<next.atMs
          &&Math.hypot((next.dx||0)-(frame.dx||0),(next.dy||0)-(frame.dy||0))>5;
      });
      const traveling=object.motion==='walk-left'||object.motion==='walk-right'||object.pose==='run'||keyedTravel;
      const step=traveling?Math.sin(timeMs/190):0;
      for(const [i,x] of [-25,-14,10,21].entries()){
        const lift=traveling?Math.max(0,step*(i%2?-1:1))*3:0;
        path(ctx,`M ${x-4} 10 L ${x+5} 10 L ${x+4} ${36-lift} L ${x-4} ${36-lift} Z`,i%2?shade:skin,INK,1);
        hoof(x,38-lift,1);
      }
      path(ctx,'M -35 0 Q -39 -24 -10 -27 Q 17 -31 29 -13 L 31 10 Q 16 24 -13 22 Q -35 21 -35 0 Z',skin,INK,1.4);
      path(ctx,'M 13 -10 Q 15 -33 34 -28 Q 47 -23 46 -4 L 42 11 Q 28 21 15 10 Z',skin,INK,1.3);
      path(ctx,'M 18 -24 L 12 -38 Q 25 -39 29 -26 Z',shade,INK,1);
      path(ctx,'M 34 -23 L 40 -36 Q 48 -30 43 -19 Z',shade,INK,1);
      path(ctx,'M 36 -5 Q 49 -9 51 0 Q 51 9 38 9 Q 31 7 36 -5 Z','#cba797',INK,1);
      for(const x of [40,46]){ctx.fillStyle='#665046';ctx.beginPath();ctx.ellipse(x,1,1.3,2,0,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle=INK;ctx.beginPath();ctx.ellipse(31,-13,1.7,timeMs%6500>6250?.3:2.1,0,0,Math.PI*2);ctx.fill();
      curve(ctx,[{x:-35,y:-5},{x:-45,y:-13},{x:-48,y:-3},{x:-40,y:-1},{x:-42,y:-8}],shade,1.6);
      curve(ctx,[{x:-25,y:-15},{x:-11,y:-20},{x:4,y:-20}],'#d0b1a0',1.2,.6);
    }
  } else if (v === 'shield') {
    path(ctx, 'M 0 42 C -25 29 -36 9 -31 -25 C -20 -36 20 -36 31 -25 C 36 9 25 29 0 42 Z', fill, INK, 2);
    path(ctx, 'M 0 33 C -10 20 -13 0 -10 -25 C -3 -28 3 -28 10 -25 C 13 0 10 20 0 33 Z', secondary, INK, 1.15, .7);
    curve(ctx, [{x:-19,y:-6},{x:19,y:-6}], INK, 1.2, .45);
  } else if (v === 'sword') {
    path(ctx, 'M -3 34 L -2 -28 L 0 -43 L 3 -28 L 3 34 Z', '#87918a', INK, 1.45);
    curve(ctx, [{x:-13,y:15},{x:13,y:15}], INK, 2.3);
    path(ctx, 'M -3 34 L 3 34 L 5 43 L -5 43 Z', secondary, INK, 1.2);
  } else if (v === 'flag') {
    curve(ctx, [{x:-27,y:44},{x:-27,y:-43}], INK, 2);
    const wave = (Math.sin(timeMs / 230) + 1) / 2;
    path(ctx, FLAG_MORPH(wave), fill, INK, 1.35);
    curve(ctx,[{x:-22,y:-33},{x:-5,y:-29},{x:18,y:-25}], '#6d5147', .8, .42);
    curve(ctx,[{x:-18,y:-25},{x:0,y:-22},{x:14,y:-20}], '#6d5147', .7, .32);
    path(ctx,'M -30 43 L -24 43 L -24 47 L -30 47 Z','#5c493c',INK,.7);
  } else if (v === 'mountain') {
    // Organic rock/mound rather than a geometric triangle.
    path(ctx, 'M -47 34 C -40 18 -33 9 -25 0 C -17 -12 -8 -22 2 -18 C 11 -14 15 -4 21 1 C 28 8 37 4 43 12 C 49 19 47 28 41 34 Z', fill, INK, 1.65);
    curve(ctx, [{x:-27,y:13},{x:-13,y:5},{x:-3,y:8}], secondary, 1.05, .45);
  } else if (v === 'book') {
    path(ctx, 'M -44 -26 C -24 -30 -10 -25 0 -18 C 10 -25 24 -30 44 -26 L 41 30 C 24 25 10 27 0 34 C -10 27 -24 25 -41 30 Z', '#d7c6a4', INK, 1.6);
    curve(ctx, [{x:0,y:-18},{x:0,y:34}], INK, 1);
    for(const y of [-10,-2,6,14]){
      curve(ctx,[{x:-33,y},{x:-8,y:y+1}], '#7d705e', .65, .35);
      curve(ctx,[{x:8,y:y+1},{x:33,y}], '#7d705e', .65, .35);
    }
    curve(ctx,[{x:-37,y:25},{x:-18,y:22},{x:-6,y:25}], '#8f7a61', .55, .26);
  } else if (v === 'house') {
    // Rural stilt house: roof, timber wall, floor deck and four visible posts.
    path(ctx, 'M -48 -12 L 0 -43 L 49 -12 L 40 -7 L -40 -7 Z', '#4a392f', INK, 1.8);
    path(ctx, 'M -38 -7 L 38 -7 L 38 24 L -38 24 Z', fill, INK, 1.7);
    for (const x of [-25,-8,9,26]) curve(ctx,[{x,y:-4},{x:x+(x%2?1:-1),y:22}], '#5c4638', .7, .34);
    path(ctx, 'M 8 2 L 25 2 L 25 18 L 8 18 Z', '#9b643f', INK, 1.05, .72);
    curve(ctx,[{x:-44,y:24},{x:44,y:24}],INK,2.4);
    for (const x of [-31,-11,12,31]) curve(ctx,[{x,y:24},{x:x+(x<0?-2:2),y:46}], '#3a2c25', 4.2,.96);
    curve(ctx,[{x:-42,y:46},{x:42,y:46}], '#241d19', 1.3,.5);
  } else if (v === 'tree') {
    path(ctx, 'M -8 43 C -9 23 -8 9 -5 -7 C -2 -11 2 -11 5 -7 C 8 8 9 24 8 43 Z', '#73533d', INK, 1.45);
    curve(ctx,[{x:-3,y:36},{x:-4,y:17},{x:0,y:-4}], '#9c7553', .85, .48);
    curve(ctx,[{x:4,y:32},{x:3,y:16},{x:1,y:1}], '#4d392d', .62, .34);
    path(ctx, 'M -34 1 C -39 -12 -30 -24 -17 -24 C -12 -39 9 -42 17 -27 C 32 -29 40 -17 34 -4 C 43 7 35 19 22 18 C 13 31 -8 30 -16 18 C -31 20 -40 12 -34 1 Z', fill, INK, 1.7);
    path(ctx, 'M -18 2 C -7 -2 3 -6 15 -13', undefined, secondary, 1.1, .5);
    path(ctx, 'M -9 10 C -1 5 8 1 17 1', undefined, secondary, 1, .45);
    const leafAccents: Array<[number, number]> = [[-21,-10],[-7,-24],[10,-17],[23,-5],[-18,12],[8,10]];
    for(const [x,y] of leafAccents){
      path(ctx,`M ${x-4} ${y} C ${x-2} ${y-3} ${x+3} ${y-3} ${x+5} ${y} C ${x+2} ${y+2} ${x-2} ${y+2} ${x-4} ${y} Z`,secondary,INK,.45,.38);
    }
  } else if (v === 'fire') {
    // A low hearth sits on the floor; flames are not an oversized floating icon.
    path(ctx, 'M -40 32 Q 0 24 40 32 L 35 44 Q 0 51 -35 44 Z', '#302925', INK, 1.3);
    curve(ctx,[{x:-25,y:34},{x:25,y:43}], '#5f4433', 7,.95);
    curve(ctx,[{x:24,y:34},{x:-24,y:43}], '#704c35', 7,.95);
    hatch(ctx,[
      [{x:-19,y:35},{x:-9,y:39}],[{x:8,y:37},{x:18,y:41}],
      [{x:-16,y:42},{x:-7,y:38}],[{x:10,y:43},{x:19,y:37}],
    ],'#352820',.8,.38);
    const flicker = (Math.sin(timeMs / 95) + 1) / 2;
    ctx.save(); ctx.translate(0, 13); ctx.scale(.64, .64);
    path(ctx, FIRE_MORPH(flicker), '#b65332', '#7b402a', .65);
    path(ctx, 'M 1 -18 C 7 -8 8 0 5 7 C 12 5 15 12 12 20 C 9 28 4 32 0 33 C -7 31 -12 26 -12 18 C -13 10 -7 4 -3 6 C -5 -2 -3 -11 1 -18 Z', '#e0ae58', undefined, 0);
    ctx.restore();
    for (const x of [-23,-12,8,24]) dot(ctx, x, 37 + Math.sin(x)*2, 1.3, '#bb5832');
  } else if (v === 'barrel') {
    path(ctx, 'M -28 -39 C -16 -45 16 -45 28 -39 C 34 -20 34 20 28 39 C 16 45 -16 45 -28 39 C -34 20 -34 -20 -28 -39 Z', '#8a5f45', INK, 1.75);
    curve(ctx, [{x:-29,y:-25},{x:0,y:-22},{x:29,y:-25}], secondary, 1.5);
    curve(ctx, [{x:-31,y:0},{x:0,y:2},{x:31,y:0}], secondary, 1.5);
    curve(ctx, [{x:-29,y:25},{x:0,y:22},{x:29,y:25}], secondary, 1.5);
    for(const x of [-18,-9,0,9,18]){
      curve(ctx,[{x,y:-39},{x:x+(x/18)*-2,y:39}], '#5e402f', .6, .27);
    }
    hatch(ctx,[
      [{x:-20,y:-14},{x:-10,y:-12}],[{x:4,y:-29},{x:16,y:-28}],
      [{x:-15,y:12},{x:-4,y:13}],[{x:8,y:21},{x:20,y:18}],
    ],'#4f372c',.65,.34);
    ctx.save();ctx.fillStyle='#b18462';ctx.globalAlpha=.55;ctx.beginPath();ctx.ellipse(0,-39,23,6,0,0,Math.PI*2);ctx.fill();ctx.restore();
  } else if (v === 'bridge') {
    curve(ctx, [{x:-47,y:3},{x:47,y:3}], INK, 3.2);
    path(ctx, 'M -44 3 C -33 -24 -11 -24 0 3 C 11 -24 33 -24 44 3', undefined, '#7c5f48', 2.1);
    curve(ctx, [{x:-34,y:3},{x:-34,y:35}], INK, 1.8);
    curve(ctx, [{x:0,y:3},{x:0,y:35}], INK, 1.8);
    curve(ctx, [{x:34,y:3},{x:34,y:35}], INK, 1.8);
    for(let x=-42;x<=42;x+=12){
      curve(ctx,[{x,y:0},{x:x+5,y:4}], '#a58261', 2.2,.75);
    }
    curve(ctx,[{x:-46,y:8},{x:46,y:8}], '#6a5442', .9,.4);
  } else if (v === 'clock') {
    path(ctx, 'M 0 -43 C 24 -43 43 -24 43 0 C 43 24 24 43 0 43 C -24 43 -43 24 -43 0 C -43 -24 -24 -43 0 -43 Z', PAPER, INK, 1.7);
    path(ctx,'M 0 -38 C 21 -38 38 -21 38 0 C 38 21 21 38 0 38 C -21 38 -38 21 -38 0 C -38 -21 -21 -38 0 -38 Z',undefined,'#8d7b65',.8,.55);
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6, r1=i%3===0?30:32, r2=36;
      curve(ctx,[{x:Math.cos(a)*r1,y:Math.sin(a)*r1},{x:Math.cos(a)*r2,y:Math.sin(a)*r2}],INK,i%3===0?1.3:.8,.6);
    }
    curve(ctx, [{x:0,y:0},{x:0,y:-19}], INK, 2);
    curve(ctx, [{x:0,y:0},{x:15,y:9}], INK, 2);
    dot(ctx, 0, 0, 2.1, INK);
  } else if (v === 'lightbulb') {
    path(ctx, 'M 0 -43 C 19 -43 32 -29 31 -11 C 30 2 21 8 16 17 C 13 22 13 27 13 29 L -13 29 C -13 27 -13 22 -16 17 C -21 8 -30 2 -31 -11 C -32 -29 -19 -43 0 -43 Z', '#d8ad4f', INK, 1.7);
    path(ctx,'M -16 -31 C -8 -37 6 -38 16 -29',undefined,'#f0cd76',1.1,.7);
    curve(ctx, [{x:-11,y:34},{x:11,y:34}], INK, 2);
    curve(ctx, [{x:-9,y:38},{x:9,y:38}], INK, 1.6);
    curve(ctx, [{x:-7,y:42},{x:7,y:42}], INK, 1.4);
    curve(ctx, [{x:-6,y:-10},{x:0,y:1},{x:6,y:-10}], '#7d6a46', 1.15, .6);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4;
      curve(ctx,[{x:Math.cos(a)*38,y:Math.sin(a)*38},{x:Math.cos(a)*47,y:Math.sin(a)*47}],'#b89448',1.1,.45);
    }
  } else if (v === 'ghost') {
    // Horror threat: an ambiguous human silhouette, never a cute white ghost
    // icon. The shape is intentionally uneven so it can read as a person in
    // darkness until the story explicitly reveals more.
    ctx.save();
    ctx.globalAlpha *= .96;
    // Keep the aura subordinate to the body. A large opaque radial blob made
    // medium/distant ghosts read like smoke stains instead of human silhouettes.
    const shadow=ctx.createRadialGradient(0,-6,3,0,-2,46);
    shadow.addColorStop(0,'rgba(28,39,39,.52)');
    shadow.addColorStop(.64,'rgba(13,19,19,.32)');
    shadow.addColorStop(1,'rgba(5,7,8,0)');
    ctx.fillStyle=shadow;ctx.fillRect(-54,-64,108,118);
    // Build a recognisably human shadow: small head, short neck, broad uneven
    // shoulders and a long tapering torso. Keeping these masses separate avoids
    // the hourglass/blob silhouette that read as an alien at reveal distance.
    // A cool, thin rim keeps a half-opacity reveal readable against a nearly
    // black corridor without turning the threat into a glowing ghost icon.
    ctx.fillStyle='#182222';ctx.strokeStyle=profile.highlight;ctx.lineWidth=1.45+profile.detail*.6;
    ctx.beginPath();ctx.ellipse(0,-35,7.5,10.5,-.04,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillRect(-3.1,-26,6.2,9.5);
    path(ctx,'M -4 -18 C -11 -17 -16 -13 -18 -6 L -15 16 L -12 47 L 13 47 L 16 17 L 18 -5 C 15 -12 10 -16 4 -18 Z','#243030','#667a76',1.65,.98);
    curve(ctx,[{x:-13,y:-5},{x:-16,y:20},{x:-14,y:45}],'#101617',3.4,.72);
    curve(ctx,[{x:13,y:-4},{x:15,y:19},{x:13,y:44}],'#101617',3.4,.72);
    // Eye pits are almost lost in the shadow; they should not read as glowing eyes.
    ctx.fillStyle='rgba(96,112,111,.14)';
    ctx.beginPath();ctx.ellipse(-2.7,-35,1.15,1.7,-.05,0,Math.PI*2);ctx.ellipse(2.9,-35,1.1,1.65,.04,0,Math.PI*2);ctx.fill();
    ctx.restore();
  } else if (v === 'cart') {
    // Xe tải nhỏ nhìn ngang: thùng + cabin + bánh + đèn.
    path(ctx, 'M -42 8 L 42 8 L 36 30 L -36 30 Z', fill, INK, 2);
    path(ctx, 'M -30 -14 L 30 -14 L 30 8 L -30 8 Z', secondary, INK, 1.8);
    path(ctx, 'M -28 30 A 10 10 0 1 0 -27.9 30 Z', '#22201f', INK, 1.8);
    path(ctx, 'M 28 30 A 10 10 0 1 0 28.1 30 Z', '#22201f', INK, 1.8);
    dot(ctx, 34, -6, 4, '#e8c85a');
  } else if (v === 'box') {
    path(ctx, 'M -24 -18 L 24 -18 L 24 22 L -24 22 Z', fill, INK, 2);
    const opening=Math.max(0,Math.min(1,object.boxOpen||0));
    if(opening>0)path(ctx,'M -22 -16 L 22 -16 L 22 -8 L -22 -8 Z','#302b24',INK,1);
    path(ctx, `M -24 -18 L 24 -18 L 24 ${-6-opening*40} L -24 ${-6-opening*40} Z`, secondary, INK, 1.4);
    curve(ctx, [{x:0,y:-18},{x:0,y:22}], INK, 1.4, .6);
  } else if (v === 'door') {
    const opening=Math.max(0,Math.min(1,object.doorOpen??0));
    // Frame belongs to the architecture and stays fixed while the slab rotates.
    if(object.environmentAnchor!=='doorway'){
      path(ctx,'M -36 -48 L 35 -48 L 36 48 L -36 48 Z','#292522',INK,profile.lineWeight+.35);
      path(ctx,'M -32 -44 L 30 -44 L 30 45 L -32 45 Z','#151515',undefined,0,.76);
      forgeFastener(ctx,profile,-31,-39,1);forgeFastener(ctx,profile,29,-39,1);
    }
    if(object.doorOpen!==undefined){
      ctx.save();ctx.translate(CANVAS_DOOR_PANEL.left,0);
      ctx.scale(Math.max(.13,Math.cos(opening*1.4)),1);
      ctx.translate(-CANVAS_DOOR_PANEL.left,0);
    }
    const panel=CANVAS_DOOR_PANEL;
    const doorPath=object.doorOpen!==undefined
      ? `M ${panel.left} ${panel.top} h ${panel.width} v ${panel.height} h ${-panel.width} Z`
      : 'M -30 -44 L 28 -42 L 31 44 L -31 44 Z';
    path(ctx,doorPath,fill,INK,profile.lineWeight+.45);
    // Recessed panels and stiles give a real door construction rather than a
    // beige rectangle. Keep enough contrast to survive medium shots.
    path(ctx,'M -23 -35 L 20 -34 L 20 -5 L -23 -5 Z',secondary,profile.shadow,.9,.42);
    path(ctx,'M -22 3 L 21 3 L 22 34 L -22 35 Z',secondary,profile.shadow,.9,.34);
    curve(ctx,[{x:-25,y:-1},{x:23,y:0}],profile.shadow,1,.34);
    forgeGrain(ctx,profile,{left:-27,top:-40,right:25,bottom:39},true);
    // Hinges, latch plate and knob.
    for(const y of [-27,27]){
      path(ctx,`M -31 ${y-4} L -27 ${y-4} L -27 ${y+4} L -31 ${y+4} Z`,'#5c5145',profile.shadow,.6,.8);
      forgeFastener(ctx,profile,-29,y,1);
    }
    path(ctx,'M 13 -4 L 22 -4 L 22 8 L 13 8 Z','#655849',profile.shadow,.65,.88);
    dot(ctx,17.5,2,2.55,'#8d7654');dot(ctx,17.1,1.6,.65,'#d1b47b');
    forgeWear(ctx,profile,[{x:-28,y:-40},{x:27,y:-38},{x:-29,y:39},{x:27,y:38},{x:4,y:-6}]);
    if (object.doorOpen !== undefined) ctx.restore();
  } else if (v === 'window') {
    path(ctx, 'M -42 -36 L 42 -36 L 42 36 L -42 36 Z', '#b7ced5', INK, 2);
    curve(ctx,[{x:0,y:-36},{x:0,y:36}],INK,2);
    curve(ctx,[{x:-42,y:0},{x:42,y:0}],INK,2);
    path(ctx,'M -48 -42 L 48 -42 L 48 -35 L -48 -35 Z',secondary,INK,.8,.7);
  } else if (v === 'bowl') {
    ctx.save();ctx.globalAlpha=.28;ctx.fillStyle='#080706';ctx.beginPath();ctx.ellipse(3,43,34,5,0,0,Math.PI*2);ctx.fill();ctx.restore();
    path(ctx, 'M -42 -8 C -36 24 -20 39 0 40 C 20 39 36 24 42 -8 Z', '#c8b591', INK, 1.45);
    path(ctx, 'M -42 -8 C -20 -17 20 -17 42 -8 C 20 3 -20 3 -42 -8 Z', '#e1d4b7', INK, .95);
    curve(ctx,[{x:-28,y:12},{x:0,y:18},{x:27,y:11}],secondary,.7,.24);
  } else if (v === 'pipe') {
    ctx.save();ctx.globalAlpha=.25;ctx.fillStyle='#080706';ctx.beginPath();ctx.ellipse(3,34,30,4,0,0,Math.PI*2);ctx.fill();ctx.restore();
    curve(ctx,[{x:-33,y:31},{x:-8,y:4},{x:18,y:-19}], '#604631', 7, .92);
    path(ctx,'M 11 -30 C 24 -35 36 -28 37 -16 C 37 -5 27 3 16 1 C 10 -8 8 -19 11 -30 Z',fill,INK,1.4);
    curve(ctx,[{x:30,y:-31},{x:37,y:-40},{x:31,y:-48}], '#8b8b84',1.1,.35);
  } else if (v === 'bamboo') {
    curve(ctx,[{x:-18,y:44},{x:-12,y:-44}], '#6f7c4f', 7,.95);
    curve(ctx,[{x:10,y:44},{x:15,y:-42}], '#7f8b5c', 7,.95);
    for(const y of [-28,-8,13,33]){curve(ctx,[{x:-16,y},{x:-10,y}],INK,.8,.45);curve(ctx,[{x:11,y},{x:16,y}],INK,.8,.45);}
  } else if (v === 'table') {
    // Designed furniture: perspective top, apron, four readable legs and grain.
    path(ctx,'M -48 -15 L 44 -15 L 48 -3 L -43 1 Z',fill,INK,profile.lineWeight+.35);
    path(ctx,'M -43 1 L 48 -3 L 45 7 L -41 10 Z',secondary,profile.shadow,.9,.74);
    // Back legs are lighter and slightly shorter; front legs own the silhouette.
    curve(ctx,[{x:-35,y:7},{x:-33,y:38}],profile.shadow,2.6,.62);
    curve(ctx,[{x:35,y:5},{x:33,y:38}],profile.shadow,2.6,.62);
    curve(ctx,[{x:-30,y:8},{x:-26,y:44}],INK,4.4,.96);
    curve(ctx,[{x:30,y:6},{x:27,y:44}],INK,4.4,.96);
    curve(ctx,[{x:-25,y:28},{x:26,y:27}],secondary,2.1,.62);
    forgeGrain(ctx,profile,{left:-42,top:-12,right:42,bottom:-1},false);
    forgeWear(ctx,profile,[{x:-44,y:-13},{x:44,y:-13},{x:-40,y:1},{x:46,y:-2}]);
    forgeFastener(ctx,profile,-34,6,.9);forgeFastener(ctx,profile,35,4,.9);
  } else if (v === 'chair') {
    path(ctx,'M -25 -36 L 25 -36 L 22 3 L -22 3 Z',fill,INK,1.7);
    path(ctx,'M -29 2 L 29 2 L 26 15 L -26 15 Z',secondary,INK,1.4);
    curve(ctx,[{x:-20,y:14},{x:-17,y:43}],INK,3.2);
    curve(ctx,[{x:20,y:14},{x:17,y:43}],INK,3.2);
  } else if (v === 'lantern') {
    const light=canvasLampLight(object,timeMs);
    if(light>0) {
      const halo=ctx.createRadialGradient(0,2,5,0,2,92);
      halo.addColorStop(0,`rgba(255,190,74,${.55*light})`);halo.addColorStop(1,'rgba(255,190,74,0)');
      ctx.fillStyle=halo;ctx.fillRect(-92,-90,184,184);
    }
    // Real lantern construction: carry handle, vented cap, glass chamber,
    // cage rods, burner and weighted base.
    path(ctx,'M -7 -32 Q -16 -51 0 -51 Q 16 -51 7 -32',undefined,'#a59680',2.1);
    path(ctx,'M -16 -30 Q -23 -22 -18 -18 L 18 -18 Q 23 -22 16 -30 Z','#716250',INK,profile.lineWeight+.2);
    for(const x of [-9,0,9])curve(ctx,[{x,y:-29},{x:x*.8,y:-20}],'#b3a187',.65,.55);
    path(ctx,'M -15 -18 Q -25 8 -16 27 L 16 27 Q 25 8 15 -18 Z','#514d42',INK,1.2);
    if(light>0) {
      path(ctx,'M -14 -17 Q -23 8 -15 26 L 15 26 Q 23 8 14 -17 Z','#e9b95d',undefined,0,.75*light);
      path(ctx,'M 0 21 Q -10 10 -4 1 Q 0 -7 1 -14 Q 4 -2 7 4 Q 11 15 0 21 Z','#ffe6a0',undefined,0,light);
    }
    for(const x of [-21,-10,10,21])curve(ctx,[{x,y:-22},{x:x*1.12,y:8},{x,y:31}],'#9b8868',x===-21||x===21?2:1.05,.88);
    path(ctx,'M -23 28 Q 0 21 23 28 L 20 40 L -20 40 Z','#665747',INK,profile.lineWeight+.25);
    path(ctx,'M -10 29 Q 0 25 10 29 L 8 36 L -8 36 Z','#3d342d',profile.shadow,.7,.75);
    forgeFastener(ctx,profile,-18,32,.8);forgeFastener(ctx,profile,18,32,.8);
    forgeWear(ctx,profile,[{x:-18,y:-24},{x:18,y:-24},{x:-18,y:35},{x:18,y:35}]);
    curve(ctx,[{x:-11,y:-13},{x:-16,y:15}],'#f9eaca',1,.25);
  } else if (v === 'note') {
    // Uneven handled paper: the silhouette itself carries production value.
    path(ctx,'M -44 -33 L -17 -37 L 5 -35 L 38 -38 L 44 28 L 21 31 L -5 29 L -39 35 Z',fill || '#d5bf92',INK,profile.lineWeight);
    // Fold memory, handling stains and a tiny torn corner.
    curve(ctx,[{x:-36,y:-6},{x:34,y:-9}],profile.shadow,.65,.16+profile.wear*.16);
    curve(ctx,[{x:8,y:-34},{x:5,y:29}],profile.shadow,.6,.12+profile.wear*.12);
    path(ctx,'M 31 29 L 43 18 L 44 28 Z','#b9a477',profile.shadow,.5,.55);
    ctx.save();ctx.globalAlpha=.08+profile.wear*.08;ctx.fillStyle='#775d40';
    ctx.beginPath();ctx.ellipse(-25,20,8,5,.2,0,Math.PI*2);ctx.fill();ctx.restore();
    forgeWear(ctx,profile,[{x:-42,y:-31},{x:36,y:-36},{x:-37,y:32},{x:39,y:26}]);
    const reveal=Math.max(0,Math.min(1,object.revealProgress ?? 1));
    ctx.save();
    ctx.beginPath();ctx.rect(-48,-40,96,80*reveal);ctx.clip();
    ctx.fillStyle='#342d24';ctx.font='700 11px Arial';ctx.textAlign='center';
    const lines=(object.text || 'CẦN GIÚP ĐỠ\nĐỪNG MỞ CỬA\nNÓ ĐANG NHÌN').split('\n');
    const visible=lines.slice(0,4);
    const startY=-((visible.length-1)*13)/2;
    visible.forEach((line,i)=>ctx.fillText(line,0,startY+i*13,78));ctx.restore();
  } else if (v === 'sandals') {
    // Two distinct soles, toe straps and wet highlights; no generic box fallback.
    for(const [x,y,angle] of [[-22,5,-.16],[23,-5,.18]]){
      ctx.save();ctx.translate(x!,y!);ctx.rotate(angle!);
      path(ctx,'M -13 28 C -20 16 -18 -16 -11 -29 C -5 -40 11 -38 16 -26 C 22 -12 18 21 12 30 Q 0 39 -13 28 Z','#383b35',INK,1.6);
      path(ctx,'M -10 25 C -16 12 -13 -14 -8 -25 C -3 -32 8 -32 11 -23 C 16 -10 13 17 8 26 Q -1 32 -10 25 Z','#74766a',INK,.7);
      curve(ctx,[{x:-13,y:-11},{x:0,y:-2},{x:13,y:-13}],fill,5);
      curve(ctx,[{x:0,y:-2},{x:1,y:-23}],fill,4);
      curve(ctx,[{x:-8,y:14},{x:-6,y:23}], '#b4c2bc',1,.55);
      ctx.restore();
    }
  } else if (v === 'teapot') {
    path(ctx,'M -23 -10 C -38 1 -32 27 -5 29 C 22 31 33 12 22 -10 Z','#987651',INK,1.2);
    path(ctx,'M 19 -5 Q 36 -1 42 -17 L 49 -17 Q 45 11 26 14 Z','#987651',INK,1);
    path(ctx,'M -25 -7 C -51 -24 -58 19 -31 16 L -31 8 C -46 7 -43 -12 -29 -1 Z','#876746',INK,1);
    path(ctx,'M -26 -11 Q -4 -24 26 -11 L 24 -7 L -24 -7 Z','#b7996c',INK,1);
    dot(ctx,-2,-21,3,'#705a3d');
    curve(ctx,[{x:-22,y:4},{x:-20,y:18},{x:-7,y:22}],'#d2b68b',1,.55);
  } else if (v === 'oar') {
    curve(ctx,[{x:-32,y:0},{x:35,y:0}],'#b79266',3);
    path(ctx,'M 32 -6 Q 45 -8 49 -3 L 49 3 Q 45 8 32 6 Z','#a87950',INK,1);
    curve(ctx,[{x:36,y:0},{x:46,y:0}],'#d4b17c',.8,.7);
  } else if (v === 'phone') {
    path(ctx,'M -21 -43 Q -25 -43 -25 -37 L -25 37 Q -25 43 -19 43 L 19 43 Q 25 43 25 37 L 25 -37 Q 25 -43 19 -43 Z','#292e32',INK,profile.lineWeight+.1);
    path(ctx,'M -20 -33 L 20 -33 L 20 31 L -20 31 Z','#57787f',profile.shadow,.7);
    // Speaker slot, camera and glass reflection keep it from reading as a
    // featureless rounded rectangle in close inserts.
    curve(ctx,[{x:-6,y:-38},{x:6,y:-38}],'#8b9597',1,.72);
    dot(ctx,12,-38,1.15,'#131718');
    curve(ctx,[{x:-16,y:-29},{x:9,y:-29}],profile.highlight,.7,.26);
    curve(ctx,[{x:-16,y:27},{x:10,y:-29}],'#d5e3df',.6,.12);
    ctx.save();ctx.fillStyle='#e5f2e8';ctx.font='6px Arial';ctx.textAlign='center';ctx.fillText(object.text || 'ĐANG GỌI',0,-5,37);
    ctx.fillStyle='#8eba9c';ctx.beginPath();ctx.arc(0,16,6,0,Math.PI*2);ctx.fill();ctx.restore();
    if(profile.wear>.55)curve(ctx,[{x:15,y:-17},{x:5,y:-5},{x:13,y:6}],profile.highlight,.55,.34);
  } else if (v === 'bed') {
    // Mattress, pillow and frame share one perspective and a visible baseline.
    path(ctx,'M -46 -18 L 37 -28 L 48 1 L -37 13 Z','#a68b68',INK,1.35);
    path(ctx,'M -37 13 L 48 1 L 48 13 L -37 25 Z',fill,INK,1.35);
    path(ctx,'M -46 -18 L -37 13 L -37 25 L -46 -8 Z',secondary,INK,1.2);
    path(ctx,'M -41 -17 Q -30 -26 -13 -21 L -8 -8 Q -20 -2 -36 -8 Z','#cbbfa8',INK,.85);
    curve(ctx,[{x:-43,y:-10},{x:-43,y:42}], '#3b2c23',3.5);
    curve(ctx,[{x:-35,y:23},{x:-35,y:44}], '#3b2c23',3.5);
    curve(ctx,[{x:45,y:13},{x:45,y:34}], '#3b2c23',3.5);
    curve(ctx,[{x:-43,y:-33},{x:-42,y:-5}],fill,5);
    curve(ctx,[{x:-43,y:-32},{x:-34,y:-6}],secondary,1.4);
  } else if (v === 'basket') {
    path(ctx,'M -35 -11 C -31 24 -18 39 0 41 C 18 39 31 24 35 -11 Z','#b88a57',INK,1.6);
    curve(ctx,[{x:-29,y:-10},{x:0,y:-39},{x:29,y:-10}],INK,2);
    for(const y of [0,10,20,30]) curve(ctx,[{x:-28,y},{x:28,y}],secondary,.7,.35);
  } else if (v === 'rope') {
    if(object.tiedTo){
      const progress=Math.max(0,Math.min(1,object.tieProgress??1));
      ctx.save();ctx.globalAlpha*=1-progress;ctx.strokeStyle=fill;ctx.lineWidth=7;
      ctx.beginPath();ctx.arc(0,2,30,0.25,Math.PI*2.15);ctx.stroke();ctx.restore();
      ctx.save();ctx.globalAlpha*=progress;
      curve(ctx,[{x:-46,y:-8},{x:0,y:-5},{x:46,y:-8}],fill,5);
      curve(ctx,[{x:-46,y:6},{x:0,y:10},{x:46,y:6}],fill,5);
      path(ctx,'M -5 -6 Q 12 -17 14 0 Q 14 15 -5 6 Q -18 -4 -5 -6 Z',fill,INK,1.2);
      curve(ctx,[{x:5,y:7},{x:18,y:27},{x:9,y:44}],fill,4);
      ctx.restore();
    }else{
    ctx.save();ctx.strokeStyle=fill;ctx.lineWidth=7;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,2,30,0.25,Math.PI*2.15);ctx.stroke();ctx.restore();
    curve(ctx,[{x:17,y:31},{x:30,y:43}],INK,2.2,.7);
    curve(ctx,[{x:23,y:34},{x:35,y:40}],secondary,1.1,.7);
    }
  } else if (v === 'stairs') {
    for(let i=0;i<5;i++){
      const y=30-i*14, x=-42+i*15;
      path(ctx,`M ${x} ${y} L ${x+30} ${y} L ${x+30} ${y-10} L ${x+15} ${y-10} L ${x+15} ${y+4} L ${x} ${y+4} Z`,fill,INK,1.1,.94);
    }
  } else if (v === 'floorboard') {
    // Close-up timber planks with one threatening seam; designed for horror inserts.
    for (let row = 0; row < 4; row += 1) {
      const y0 = -42 + row * 22;
      path(ctx, `M -48 ${y0} L 48 ${y0 + (row % 2 ? 1.5 : -1)} L 48 ${y0 + 19} L -48 ${y0 + 20} Z`, row % 2 ? secondary : fill, INK, 1.15, .96);
      curve(ctx, [{x:-39,y:y0+7},{x:-8,y:y0+5},{x:28,y:y0+9},{x:42,y:y0+7}], '#5a4132', .7, .3);
    }
    // Deep irregular crack/gap reads at phone size and can be animated with tiny dy keyframes.
    path(ctx, 'M -46 3 C -24 0 -7 4 10 1 C 26 -2 37 2 48 -1 L 48 7 C 32 10 18 6 4 9 C -14 12 -30 7 -46 11 Z', '#171310', undefined, 0);
    curve(ctx,[{x:-34,y:15},{x:-8,y:18},{x:24,y:14}], '#8d6a50', .8, .24);
  } else {
    ctx.restore();
    return false;
  }

  ctx.restore();
  return true;
}
