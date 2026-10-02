import type { CanvasStudioObject, CanvasStudioScene } from './types';

type Point = { x: number; y: number };

function hashSeed(value: string, salt = 0) {
  let hash = 2166136261 ^ salt;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function rand(seed: number, index = 0) {
  let x = (seed + index * 374761393) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke: string, line = 2.5) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function smoothClosed(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  fill: string,
  stroke: string,
  lineWidth: number,
) {
  if (points.length < 3) return;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const mx = (current.x + next.x) / 2;
    const my = (current.y + next.y) / 2;
    ctx.quadraticCurveTo(current.x, current.y, mx, my);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function strokeCurve(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  width: number,
  alpha = 1,
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  if (points.length === 2) {
    ctx.lineTo(points[1]!.x, points[1]!.y);
  } else {
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i]!;
      const next = points[i + 1]!;
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
    }
    const beforeLast = points[points.length - 2]!;
    const last = points[points.length - 1]!;
    ctx.quadraticCurveTo(beforeLast.x, beforeLast.y, last.x, last.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawHand(ctx: CanvasRenderingContext2D, p: Point, radius: number, skin: string, outline: string) {
  ellipse(ctx, p.x, p.y, radius, radius * .9, skin, outline, Math.max(1.8, radius * .24));
}

function drawFoot(ctx: CanvasRenderingContext2D, p: Point, facing: number, size: number, fill: string, outline: string) {
  smoothClosed(ctx, [
    { x: p.x - size * .35 * facing, y: p.y - size * .18 },
    { x: p.x + size * .42 * facing, y: p.y - size * .12 },
    { x: p.x + size * .68 * facing, y: p.y + size * .12 },
    { x: p.x - size * .28 * facing, y: p.y + size * .18 },
  ], fill, outline, Math.max(1.8, size * .09));
}

function characterRig(object: CanvasStudioObject, timeMs: number) {
  const w = object.width;
  const h = object.height;
  const pose = object.pose || 'idle';
  const cycle = Math.sin(timeMs / 150);
  const gesture = Math.sin(timeMs / 190);
  const shoulderY = -h * .035;
  const hipY = h * .235;
  const shoulderL = { x: -w * .235, y: shoulderY };
  const shoulderR = { x: w * .235, y: shoulderY };
  let elbowL = { x: -w * .36, y: h * .105 };
  let elbowR = { x: w * .36, y: h * .105 };
  let wristL = { x: -w * .47, y: h * .22 };
  let wristR = { x: w * .47, y: h * .22 };
  let kneeL = { x: -w * .15, y: h * .35 };
  let kneeR = { x: w * .15, y: h * .35 };
  let ankleL = { x: -w * .18, y: h * .49 };
  let ankleR = { x: w * .18, y: h * .49 };

  if (pose === 'point') {
    elbowR = { x: w * .44, y: -h * .03 };
    wristR = { x: w * .72, y: -h * .12 };
    elbowL = { x: -w * .31, y: h * .1 };
    wristL = { x: -w * .38, y: h * .23 };
  } else if (pose === 'talk') {
    elbowR = { x: w * (.38 + gesture * .035), y: -h * (.005 + gesture * .018) };
    wristR = { x: w * (.5 + gesture * .06), y: -h * (.1 + gesture * .03) };
    elbowL = { x: -w * (.36 - gesture * .025), y: h * .08 };
    wristL = { x: -w * (.48 - gesture * .05), y: h * (.12 - gesture * .025) };
  } else if (pose === 'run') {
    elbowL = { x: -w * (.34 + cycle * .08), y: h * (.02 - cycle * .04) };
    wristL = { x: -w * (.45 + cycle * .12), y: h * (.16 - cycle * .08) };
    elbowR = { x: w * (.34 - cycle * .08), y: h * (.02 + cycle * .04) };
    wristR = { x: w * (.45 - cycle * .12), y: h * (.16 + cycle * .08) };
    kneeL = { x: -w * (.13 - cycle * .12), y: h * .34 };
    kneeR = { x: w * (.13 + cycle * .12), y: h * .34 };
    ankleL = { x: -w * (.17 - cycle * .2), y: h * (.48 - Math.max(0, cycle) * .06) };
    ankleR = { x: w * (.17 + cycle * .2), y: h * (.48 - Math.max(0, -cycle) * .06) };
  } else if (pose === 'row') {
    elbowL = { x: w * .02, y: h * .08 };
    wristL = { x: w * (.15 + gesture * .08), y: h * (.15 + gesture * .05) };
    elbowR = { x: w * .35, y: h * .02 };
    wristR = { x: w * (.52 + gesture * .12), y: h * (.17 + gesture * .07) };
  } else if (pose === 'brace') {
    elbowL = { x: -w * .42, y: -h * .01 };
    wristL = { x: -w * .66, y: h * .02 };
    elbowR = { x: w * .42, y: -h * .01 };
    wristR = { x: w * .66, y: h * .02 };
    kneeL = { x: -w * .2, y: h * .34 };
    kneeR = { x: w * .2, y: h * .34 };
  } else if (pose === 'celebrate') {
    elbowL = { x: -w * .36, y: -h * .14 };
    wristL = { x: -w * .48, y: -h * .34 };
    elbowR = { x: w * .36, y: -h * .14 };
    wristR = { x: w * .48, y: -h * .34 };
  }

  return { shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, hipY, kneeL, kneeR, ankleL, ankleR };
}

function drawHeadShape(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, seed: number, headY: number, headW: number, headH: number) {
  const jaw = .82 + rand(seed, 11) * .14;
  const left = -headW * .5;
  const right = headW * .5;
  const top = headY - headH * .52;
  const bottom = headY + headH * .5;
  const skin = object.skinTone || '#e4b58d';
  ctx.save();
  ctx.fillStyle = skin;
  ctx.strokeStyle = object.accent;
  ctx.lineWidth = Math.max(2.4, object.width * .015);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(left * .78, top + headH * .07);
  ctx.bezierCurveTo(left * 1.08, headY - headH * .15, left * .96, headY + headH * .28, left * jaw * .55, bottom * .98);
  ctx.bezierCurveTo(-headW * .16, bottom + headH * .08, headW * .16, bottom + headH * .07, right * jaw * .55, bottom * .98);
  ctx.bezierCurveTo(right * .96, headY + headH * .25, right * 1.07, headY - headH * .15, right * .76, top + headH * .07);
  ctx.bezierCurveTo(headW * .28, top - headH * .09, -headW * .26, top - headH * .09, left * .78, top + headH * .07);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHairAndHeadwear(
  ctx: CanvasRenderingContext2D,
  object: CanvasStudioObject,
  seed: number,
  headY: number,
  headW: number,
  headH: number,
) {
  const hair = object.hair || (object.archetype === 'warrior' || object.archetype === 'sailor' ? 'hat' : 'short');
  const top = headY - headH * .52;
  const accent = object.accent;
  const secondary = object.secondaryColor || '#5f6868';

  if (hair === 'bald') {
    strokeCurve(ctx, [{ x: -headW*.22, y: top + headH*.04 }, { x: 0, y: top - headH*.02 }, { x: headW*.2, y: top + headH*.04 }], accent, Math.max(1.6, object.width*.009), .5);
    return;
  }

  if (hair === 'hat' || object.archetype === 'warrior' || object.archetype === 'sailor') {
    if (object.archetype === 'warrior') {
      smoothClosed(ctx, [
        { x: -headW*.43, y: headY-headH*.28 },
        { x: -headW*.27, y: top-headH*.13 },
        { x: 0, y: top-headH*.23 },
        { x: headW*.28, y: top-headH*.1 },
        { x: headW*.43, y: headY-headH*.28 },
        { x: headW*.31, y: headY-headH*.04 },
        { x: -headW*.33, y: headY-headH*.04 },
      ], secondary, accent, Math.max(2, object.width*.012));
      strokeCurve(ctx, [{x:-headW*.52,y:headY-headH*.04},{x:0,y:headY-headH*.015},{x:headW*.52,y:headY-headH*.04}], accent, Math.max(2, object.width*.014));
      const plume = rand(seed, 90) > .45;
      if (plume) strokeCurve(ctx, [{x:0,y:top-headH*.18},{x:headW*.12,y:top-headH*.45},{x:headW*.24,y:top-headH*.34}], secondary, Math.max(3, object.width*.02));
    } else {
      smoothClosed(ctx, [
        {x:-headW*.44,y:headY-headH*.3},
        {x:-headW*.24,y:top-headH*.1},
        {x:headW*.25,y:top-headH*.08},
        {x:headW*.44,y:headY-headH*.3},
        {x:headW*.32,y:headY-headH*.08},
        {x:-headW*.34,y:headY-headH*.08},
      ], accent, accent, Math.max(2, object.width*.012));
    }
    return;
  }

  const asym = (rand(seed, 31) - .5) * headW * .1;
  if (hair === 'bun') {
    smoothClosed(ctx, [
      {x:-headW*.46,y:headY-headH*.08},
      {x:-headW*.4,y:top-headH*.08},
      {x:-headW*.08,y:top-headH*.16},
      {x:headW*.35,y:top-headH*.06},
      {x:headW*.46,y:headY-headH*.08},
      {x:headW*.16,y:headY-headH*.25},
      {x:-headW*.4,y:headY-headH*.12},
    ], accent, accent, Math.max(2, object.width*.012));
    ellipse(ctx, headW*.34, top-headH*.08, headW*.13, headH*.12, accent, accent, 1.5);
    return;
  }

  const messy = hair === 'messy' ? headH*.16 : 0;
  smoothClosed(ctx, [
    {x:-headW*.46,y:headY-headH*.05},
    {x:-headW*.39,y:top-headH*(.04 + messy/headH)},
    {x:-headW*.18+asym,y:top-headH*.16-messy},
    {x:headW*.02,y:top-headH*.06-messy*.5},
    {x:headW*.25+asym*.3,y:top-headH*.14-messy},
    {x:headW*.46,y:headY-headH*.08},
    {x:headW*.22,y:headY-headH*.28},
    {x:-headW*.3,y:headY-headH*.22},
  ], accent, accent, Math.max(2, object.width*.012));
}

function drawFace(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, seed: number, timeMs: number, headY: number, headW: number, headH: number) {
  const accent = object.accent;
  const eyeY = headY - headH * .015;
  const eyeSpread = headW * (.17 + rand(seed, 44)*.035);
  const eyeSize = Math.max(2.3, object.width*.014);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(-eyeSpread, eyeY, eyeSize, 0, Math.PI*2);
  ctx.arc(eyeSpread, eyeY, eyeSize, 0, Math.PI*2);
  ctx.fill();

  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.8, object.width*.011);
  ctx.lineCap = 'round';
  const expression = object.expression || 'neutral';

  if (expression === 'angry') {
    strokeCurve(ctx, [{x:-eyeSpread-headW*.08,y:eyeY-headH*.08},{x:-eyeSpread+headW*.05,y:eyeY-headH*.02}], accent, ctx.lineWidth);
    strokeCurve(ctx, [{x:eyeSpread+headW*.08,y:eyeY-headH*.08},{x:eyeSpread-headW*.05,y:eyeY-headH*.02}], accent, ctx.lineWidth);
  } else if (expression === 'sad') {
    strokeCurve(ctx, [{x:-eyeSpread-headW*.07,y:eyeY},{x:-eyeSpread+headW*.05,y:eyeY-headH*.05}], accent, ctx.lineWidth);
    strokeCurve(ctx, [{x:eyeSpread+headW*.07,y:eyeY},{x:eyeSpread-headW*.05,y:eyeY-headH*.05}], accent, ctx.lineWidth);
  }

  const noseX = (rand(seed, 49)-.5)*headW*.06;
  strokeCurve(ctx, [{x:noseX,y:headY+headH*.03},{x:noseX-headW*.025,y:headY+headH*.13},{x:noseX+headW*.035,y:headY+headH*.15}], accent, Math.max(1.3, object.width*.008), .58);

  const mouthY = headY + headH*.245;
  ctx.beginPath();
  if (object.pose === 'talk') {
    const open = .045 + Math.abs(Math.sin(timeMs/82))*.035;
    ctx.ellipse(0, mouthY, headW*.085, headH*open, 0, 0, Math.PI*2);
  } else if (expression === 'happy') {
    ctx.arc(0, mouthY-headH*.035, headW*.12, .1*Math.PI, .9*Math.PI);
  } else if (expression === 'surprised') {
    ctx.ellipse(0, mouthY, headW*.065, headH*.065, 0, 0, Math.PI*2);
  } else if (expression === 'angry' || expression === 'sad') {
    ctx.moveTo(-headW*.1, mouthY+headH*.035);
    ctx.quadraticCurveTo(0, mouthY-headH*.045, headW*.1, mouthY+headH*.035);
  } else {
    ctx.moveTo(-headW*.095, mouthY);
    ctx.quadraticCurveTo(0, mouthY+headH*.02, headW*.095, mouthY);
  }
  ctx.stroke();
}

function drawTorso(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, seed: number) {
  const w = object.width;
  const h = object.height;
  const primary = object.color;
  const secondary = object.secondaryColor || '#667279';
  const outline = object.accent;
  const archetype = object.archetype || 'narrator';
  const shoulder = archetype === 'warrior' ? .235 : archetype === 'scholar' ? .205 : .215;
  const waist = archetype === 'warrior' ? .15 : archetype === 'scholar' ? .16 : .145;
  const top = -h*.105;
  const bottom = h*.205;

  smoothClosed(ctx, [
    {x:-w*shoulder,y:top+h*.015},
    {x:-w*(shoulder+.02),y:h*.07},
    {x:-w*waist,y:bottom},
    {x:w*waist,y:bottom},
    {x:w*(shoulder+.02),y:h*.07},
    {x:w*shoulder,y:top+h*.015},
    {x:w*.13,y:top-h*.02},
    {x:-w*.13,y:top-h*.02},
  ], primary, outline, Math.max(2.5,w*.015));

  if (archetype === 'warrior') {
    smoothClosed(ctx, [
      {x:-w*.33,y:-h*.045},{x:-w*.49,y:h*.01},{x:-w*.35,y:h*.1},{x:-w*.26,y:h*.04},
    ], secondary, outline, Math.max(1.8,w*.01));
    smoothClosed(ctx, [
      {x:w*.33,y:-h*.045},{x:w*.49,y:h*.01},{x:w*.35,y:h*.1},{x:w*.26,y:h*.04},
    ], secondary, outline, Math.max(1.8,w*.01));
    strokeCurve(ctx,[{x:-w*.22,y:h*.11},{x:w*.22,y:h*.11}],outline,Math.max(3,w*.018));
    strokeCurve(ctx,[{x:-w*.14,y:-h*.03},{x:w*.14,y:h*.2}],outline,Math.max(1.5,w*.009),.75);
  } else if (archetype === 'scholar') {
    strokeCurve(ctx,[{x:-w*.2,y:-h*.045},{x:0,y:h*.02},{x:w*.2,y:-h*.045}],secondary,Math.max(2,w*.012));
    strokeCurve(ctx,[{x:0,y:h*.02},{x:0,y:h*.25}],secondary,Math.max(1.4,w*.008),.8);
  } else if (archetype === 'sailor') {
    strokeCurve(ctx,[{x:-w*.23,y:h*.06},{x:w*.23,y:h*.06}],secondary,Math.max(2,w*.012));
    strokeCurve(ctx,[{x:-w*.21,y:h*.13},{x:w*.21,y:h*.13}],secondary,Math.max(2,w*.012));
  } else if (archetype === 'merchant') {
    strokeCurve(ctx,[{x:-w*.28,y:-h*.01},{x:w*.18,y:h*.2}],secondary,Math.max(3,w*.016));
    ellipse(ctx,w*.17,h*.19,w*.075,w*.06,secondary,outline,Math.max(1.4,w*.008));
  } else if (archetype === 'worker') {
    smoothClosed(ctx,[
      {x:-w*.15,y:-h*.01},{x:-w*.12,y:h*.24},{x:w*.12,y:h*.24},{x:w*.15,y:-h*.01},
    ],secondary,outline,Math.max(1.8,w*.01));
  } else {
    const collar = rand(seed, 66) > .5;
    if (collar) strokeCurve(ctx,[{x:-w*.16,y:-h*.045},{x:0,y:h*.02},{x:w*.16,y:-h*.045}],secondary,Math.max(1.8,w*.01));
  }

  strokeCurve(ctx,[{x:-w*.24,y:h*.205},{x:w*.24,y:h*.205}],outline,Math.max(2.5,w*.015));
}

export function drawProceduralCharacter(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, timeMs: number) {
  const w = object.width;
  const h = object.height;
  const facing = object.facing === 'left' ? -1 : 1;
  const seed = hashSeed(object.characterKey || object.label || object.id);
  const skin = object.skinTone || '#e4b58d';
  const outline = object.accent;
  const rig = characterRig(object,timeMs);
  const headW = w * (.46 + rand(seed,2)*.055);
  const headH = h * (.205 + rand(seed,3)*.025);
  const headY = -h * (.31 + rand(seed,4)*.008);
  const limbWidth = Math.max(4.2,w*.038);

  ctx.save();
  ctx.scale(facing,1);

  // Contact shadow makes the cutout feel grounded.
  ctx.save();
  ctx.globalAlpha=.11;
  ctx.fillStyle='#1f2424';
  ctx.beginPath();
  ctx.ellipse(0,h*.505,w*.29,h*.025,0,0,Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Back legs and arms use jointed curves instead of stick lines.
  strokeCurve(ctx,[{x:-w*.105,y:h*.235},rig.kneeL,rig.ankleL],outline,limbWidth);
  strokeCurve(ctx,[{x:w*.105,y:h*.235},rig.kneeR,rig.ankleR],outline,limbWidth);
  strokeCurve(ctx,[rig.shoulderL,rig.elbowL,rig.wristL],outline,limbWidth*.86);
  strokeCurve(ctx,[rig.shoulderR,rig.elbowR,rig.wristR],outline,limbWidth*.86);

  // Skin inset prevents arms from reading as black wires.
  strokeCurve(ctx,[rig.shoulderL,rig.elbowL,rig.wristL],skin,limbWidth*.58);
  strokeCurve(ctx,[rig.shoulderR,rig.elbowR,rig.wristR],skin,limbWidth*.58);

  drawFoot(ctx,rig.ankleL,-1,w*.115,object.secondaryColor||'#554b43',outline);
  drawFoot(ctx,rig.ankleR,1,w*.115,object.secondaryColor||'#554b43',outline);

  drawTorso(ctx,object,seed);

  // Neck sits under the head.
  smoothClosed(ctx,[
    {x:-w*.07,y:-h*.125},{x:-w*.055,y:-h*.045},{x:w*.055,y:-h*.045},{x:w*.07,y:-h*.125},
  ],skin,outline,Math.max(1.8,w*.01));

  drawHeadShape(ctx,object,seed,headY,headW,headH);
  ellipse(ctx,-headW*.49,headY+headH*.03,w*.035,h*.03,skin,outline,Math.max(1.5,w*.008));
  ellipse(ctx,headW*.49,headY+headH*.03,w*.035,h*.03,skin,outline,Math.max(1.5,w*.008));
  drawHairAndHeadwear(ctx,object,seed,headY,headW,headH);
  drawFace(ctx,object,seed,timeMs,headY,headW,headH);

  drawHand(ctx,rig.wristL,w*.026,skin,outline);
  drawHand(ctx,rig.wristR,w*.026,skin,outline);

  if ((object.archetype||'')==='warrior') {
    // Sheathed sword / command staff detail.
    strokeCurve(ctx,[{x:w*.22,y:h*.18},{x:w*.45,y:h*.46}],outline,Math.max(2,w*.012));
  }

  ctx.restore();
}

function shipColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function drawProceduralShip(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  const w=object.width,h=object.height;
  const seed=hashSeed(object.assetKey||object.label||object.id,101);
  const outline=shipColor(object.accent,'#33251e');
  const hull=shipColor(object.color,'#8b553a');
  const sail=shipColor(object.secondaryColor||'#d9c5a2','#d9c5a2');
  const big=/large|fleet|war|yuan|mongol|nguyên|hạm/i.test((object.label+' '+(object.designNotes||'')));
  const mastCount=big?3:2;

  ctx.save();
  ctx.globalAlpha=.13;
  ctx.fillStyle='#0d2930';
  ctx.beginPath();
  ctx.ellipse(0,h*.42,w*.46,h*.06,0,0,Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Three-quarter hull with separate rim and side plane.
  smoothClosed(ctx,[
    {x:-w*.5,y:-h*.02},{x:-w*.38,y:h*.28},{x:-w*.12,y:h*.39},{x:w*.29,y:h*.35},
    {x:w*.48,y:h*.08},{x:w*.5,y:-h*.03},{x:w*.18,y:h*.06},{x:-w*.22,y:h*.08},
  ],hull,outline,Math.max(3,w*.012));
  smoothClosed(ctx,[
    {x:-w*.38,y:h*.18},{x:-w*.12,y:h*.31},{x:w*.28,y:h*.29},{x:w*.4,y:h*.12},{x:w*.11,y:h*.17},{x:-w*.23,y:h*.2},
  ],'#6f412e',outline,Math.max(1.8,w*.007));
  strokeCurve(ctx,[{x:-w*.42,y:h*.06},{x:w*.4,y:h*.06}],outline,Math.max(3,w*.011));
  strokeCurve(ctx,[{x:-w*.31,y:h*.19},{x:w*.31,y:h*.18}], '#b98661', Math.max(2,w*.007),.7);

  const mastXs=Array.from({length:mastCount},(_,i)=>mix(-w*.22,w*.24,i/(mastCount-1)));
  mastXs.forEach((x,i)=>{
    const mastH=h*(.54+(i%2)*.08);
    strokeCurve(ctx,[{x,y:h*.04},{x:x+(i-1)*w*.01,y:-mastH}],outline,Math.max(3,w*.01));
    const sailSide=i%2===0?1:-1;
    const topY=-mastH+h*.06;
    smoothClosed(ctx,[
      {x:x+w*.015*sailSide,y:topY+h*.04},
      {x:x+w*(.19+.025*i)*sailSide,y:topY+h*.12},
      {x:x+w*(.17+.02*i)*sailSide,y:-h*.05},
      {x:x+w*.01*sailSide,y:-h*.09},
    ],sail,outline,Math.max(1.8,w*.006));
    strokeCurve(ctx,[{x:x+w*.01*sailSide,y:topY+h*.08},{x:x+w*(.17+.02*i)*sailSide,y:-h*.05}],outline,Math.max(1.2,w*.004),.55);
    const flagDir=i%2===0?1:-1;
    smoothClosed(ctx,[
      {x:x,y:topY-h*.02},{x:x+w*.075*flagDir,y:topY+h*.005},{x:x+w*.02*flagDir,y:topY+h*.045},
    ],'#c84d3c',outline,Math.max(1,w*.004));
  });

  // Ropes establish construction and scale.
  mastXs.forEach((x,i)=>{
    const mastH=h*(.54+(i%2)*.08);
    strokeCurve(ctx,[{x,y:-mastH+h*.05},{x:-w*.31+(i*w*.28),y:h*.06}],outline,Math.max(1,w*.0035),.42);
  });

  const crewCount=big?5:3;
  for(let i=0;i<crewCount;i+=1){
    const x=mix(-w*.27,w*.24,i/(crewCount-1));
    ellipse(ctx,x,-h*.005,w*.018,w*.02,'#d8ad89',outline,Math.max(1,w*.0035));
    strokeCurve(ctx,[{x,y:h*.015},{x,y:h*.08}],outline,Math.max(2,w*.006));
  }

  // Bow ornament makes historical ships less icon-like.
  if(rand(seed,30)>.35){
    strokeCurve(ctx,[{x:w*.42,y:h*.02},{x:w*.53,y:-h*.12},{x:w*.49,y:-h*.18}],outline,Math.max(2,w*.007));
  }
}

function drawSingleStake(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, x: number, y: number, w: number, h: number, seed: number) {
  const outline=object.accent;
  const wood=object.color;
  const lean=(rand(seed,4)-.5)*w*.18;
  smoothClosed(ctx,[
    {x:x-w*.42,y:y+h*.48},
    {x:x-w*.36+lean,y:y-h*.28},
    {x:x+lean,y:y-h*.5},
    {x:x+w*.36+lean,y:y-h*.28},
    {x:x+w*.42,y:y+h*.48},
  ],wood,outline,Math.max(2,w*.08));
  strokeCurve(ctx,[{x:x-w*.15,y:y+h*.38},{x:x-w*.08+lean,y:y-h*.22}], '#9d7651', Math.max(1.2,w*.035),.7);
  strokeCurve(ctx,[{x:x+w*.12,y:y+h*.33},{x:x+w*.07+lean,y:y-h*.18}], '#4d3326', Math.max(1,w*.027),.48);
  for(let r=0;r<3;r+=1){
    const yy=y+h*(.16+r*.09);
    strokeCurve(ctx,[{x:x-w*.23,y:yy},{x:x+w*.21,y:yy+h*.015}], '#4d3326', Math.max(1,w*.022),.35);
  }
}

export function drawProceduralStake(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  const w=object.width,h=object.height;
  const seed=hashSeed(object.assetKey||object.label||object.id,151);
  const cluster=/cluster|bãi|stakes|cọc ngầm|cọc/i.test((object.label+' '+(object.designNotes||''))) && w>90;
  if(!cluster){
    drawSingleStake(ctx,object,0,0,w,h,seed);
    return;
  }
  const count=Math.max(3,Math.min(6,Math.round(w/55)));
  for(let i=0;i<count;i+=1){
    const t=count===1?.5:i/(count-1);
    const localH=h*(.7+rand(seed,i+20)*.25);
    const localW=Math.max(18,Math.min(w*.105,localH*.105));
    const x=mix(-w*.38,w*.38,t)+(rand(seed,i+30)-.5)*w*.08;
    const y=h*.5-localH*.5+(rand(seed,i+40)-.5)*h*.05;
    ctx.save();
    ctx.rotate((rand(seed,i+50)-.5)*.16);
    drawSingleStake(ctx,object,x,y,localW,localH,seed+i*97);
    ctx.restore();
  }
}

function drawCloud(ctx: CanvasRenderingContext2D,w:number,h:number,fill:string,outline:string) {
  ctx.save();
  ctx.fillStyle=fill;ctx.strokeStyle=outline;ctx.lineWidth=Math.max(1.5,w*.012);
  ctx.beginPath();
  ctx.moveTo(-w*.46,h*.12);
  ctx.bezierCurveTo(-w*.52,-h*.08,-w*.32,-h*.2,-w*.18,-h*.12);
  ctx.bezierCurveTo(-w*.11,-h*.42,w*.18,-h*.45,w*.24,-h*.13);
  ctx.bezierCurveTo(w*.43,-h*.18,w*.54,-h*.02,w*.45,h*.14);
  ctx.bezierCurveTo(w*.2,h*.23,-w*.22,h*.22,-w*.46,h*.12);
  ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}

export function drawProceduralProp(ctx: CanvasRenderingContext2D,object:CanvasStudioObject) {
  const w=object.width,h=object.height,v=object.variant||'box';
  const fill=object.color,outline=object.accent,secondary=object.secondaryColor||'#9b7f61';
  if(v==='cloud'){drawCloud(ctx,w,h,fill,outline);return;}
  if(v==='sun'||v==='moon'){
    ellipse(ctx,0,0,Math.min(w,h)*.3,Math.min(w,h)*.3,fill,outline,Math.max(2,w*.012));
    if(v==='sun') for(let i=0;i<8;i++){const a=i*Math.PI/4;strokeCurve(ctx,[{x:Math.cos(a)*w*.36,y:Math.sin(a)*h*.36},{x:Math.cos(a)*w*.48,y:Math.sin(a)*h*.48}],outline,Math.max(1.5,w*.008),.75);}
    return;
  }
  if(v==='tree'){
    smoothClosed(ctx,[{x:-w*.08,y:h*.45},{x:-w*.1,y:-h*.05},{x:w*.09,y:-h*.05},{x:w*.08,y:h*.45}], '#76533a',outline,Math.max(2,w*.012));
    ellipse(ctx,-w*.16,-h*.12,w*.25,h*.25,fill,outline,Math.max(1.5,w*.008));
    ellipse(ctx,w*.12,-h*.2,w*.28,h*.28,fill,outline,Math.max(1.5,w*.008));
    ellipse(ctx,w*.22,h*.01,w*.22,h*.2,fill,outline,Math.max(1.5,w*.008));
    return;
  }
  if(v==='house'||v==='factory'){
    smoothClosed(ctx,[{x:-w*.42,y:h*.38},{x:-w*.42,y:-h*.02},{x:0,y:-h*.38},{x:w*.42,y:-h*.02},{x:w*.42,y:h*.38}],fill,outline,Math.max(2,w*.012));
    smoothClosed(ctx,[{x:-w*.12,y:h*.38},{x:-w*.12,y:h*.08},{x:w*.08,y:h*.08},{x:w*.08,y:h*.38}],secondary,outline,Math.max(1.5,w*.008));
    if(v==='factory'){
      smoothClosed(ctx,[{x:w*.13,y:-h*.12},{x:w*.13,y:-h*.5},{x:w*.29,y:-h*.5},{x:w*.29,y:h*.02}],secondary,outline,Math.max(1.5,w*.008));
    }
    return;
  }
  if(v==='mountain'){
    smoothClosed(ctx,[{x:-w*.5,y:h*.4},{x:-w*.16,y:-h*.4},{x:w*.02,y:-h*.02},{x:w*.25,y:-h*.32},{x:w*.5,y:h*.4}],fill,outline,Math.max(2,w*.01));return;
  }
  if(v==='fire'){
    smoothClosed(ctx,[{x:0,y:-h*.48},{x:w*.26,y:-h*.08},{x:w*.2,y:h*.34},{x:0,y:h*.48},{x:-w*.24,y:h*.32},{x:-w*.22,y:-h*.08}],fill,outline,Math.max(2,w*.012));
    smoothClosed(ctx,[{x:0,y:-h*.18},{x:w*.1,y:h*.05},{x:0,y:h*.28},{x:-w*.1,y:h*.06}],secondary,outline,Math.max(1.2,w*.007));return;
  }
  if(v==='book'||v==='map'){
    smoothClosed(ctx,[{x:-w*.46,y:-h*.3},{x:-w*.2,y:-h*.34},{x:0,y:-h*.24},{x:w*.2,y:-h*.34},{x:w*.46,y:-h*.3},{x:w*.42,y:h*.32},{x:0,y:h*.34},{x:-w*.42,y:h*.32}],fill,outline,Math.max(2,w*.01));
    strokeCurve(ctx,[{x:0,y:-h*.24},{x:0,y:h*.34}],outline,Math.max(1.5,w*.007),.7);
    if(v==='map'){strokeCurve(ctx,[{x:-w*.28,y:-h*.08},{x:-w*.08,y:h*.05},{x:w*.13,y:-h*.02},{x:w*.28,y:h*.12}],secondary,Math.max(1.3,w*.006),.6);}
    return;
  }
  if(v==='sword'){
    smoothClosed(ctx,[{x:-w*.04,y:h*.37},{x:-w*.045,y:-h*.31},{x:0,y:-h*.5},{x:w*.045,y:-h*.31},{x:w*.04,y:h*.37}],secondary,outline,Math.max(1.5,w*.007));
    strokeCurve(ctx,[{x:-w*.18,y:h*.18},{x:w*.18,y:h*.18}],outline,Math.max(3,w*.015));return;
  }
  if(v==='shield'){
    smoothClosed(ctx,[{x:0,y:h*.48},{x:-w*.4,y:h*.2},{x:-w*.36,y:-h*.3},{x:0,y:-h*.44},{x:w*.36,y:-h*.3},{x:w*.4,y:h*.2}],fill,outline,Math.max(2,w*.012));
    strokeCurve(ctx,[{x:0,y:-h*.32},{x:0,y:h*.34}],secondary,Math.max(2,w*.01),.65);return;
  }
  if(v==='flag'){
    strokeCurve(ctx,[{x:-w*.28,y:h*.45},{x:-w*.28,y:-h*.44}],outline,Math.max(3,w*.014));
    smoothClosed(ctx,[{x:-w*.27,y:-h*.4},{x:w*.33,y:-h*.32},{x:w*.2,y:-h*.08},{x:-w*.27,y:-h*.12}],fill,outline,Math.max(1.5,w*.008));return;
  }
  if(v==='arrow'){
    strokeCurve(ctx,[{x:-w*.43,y:0},{x:w*.34,y:0}],outline,Math.max(4,w*.02));
    smoothClosed(ctx,[{x:w*.46,y:0},{x:w*.26,y:-h*.14},{x:w*.26,y:h*.14}],fill,outline,Math.max(1.5,w*.007));return;
  }
  if(v==='water'){
    for(let i=-2;i<=2;i++){
      const y=i*h*.12;
      strokeCurve(ctx,[{x:-w*.46,y},{x:-w*.2,y:y-h*.04},{x:w*.05,y:y+h*.04},{x:w*.46,y}], '#5d91a0',Math.max(2,w*.011),.8);
    }
    return;
  }
  if(v==='bridge'){
    strokeCurve(ctx,[{x:-w*.5,y:h*.08},{x:w*.5,y:h*.08}],outline,Math.max(5,w*.02));
    ctx.save();ctx.strokeStyle=outline;ctx.lineWidth=Math.max(2,w*.01);
    for(const x of [-w*.22,w*.22]){ctx.beginPath();ctx.arc(x,h*.09,w*.2,Math.PI,Math.PI*2);ctx.stroke();}
    ctx.restore();return;
  }
  if(v==='ghost'){
    // Ma kieu Ma Xo: dia den sau lung + mat oval trang + 2 mat den + mieng o.
    const s=Math.min(w,h);
    ctx.save();ctx.globalAlpha=.88;ctx.fillStyle='#020306';
    ctx.beginPath();ctx.arc(0,-s*.02,s*.46,0,Math.PI*2);ctx.fill();ctx.restore();
    ellipse(ctx,0,-s*.08,s*.2,s*.24,'#e9edf2',outline,Math.max(2,s*.02));
    ellipse(ctx,-s*.075,-s*.1,s*.048,s*.075,'#0b0d12','#0b0d12',1);
    ellipse(ctx,s*.075,-s*.1,s*.048,s*.075,'#0b0d12','#0b0d12',1);
    ellipse(ctx,0,s*.045,s*.035,s*.05,'#0b0d12','#0b0d12',1);
    smoothClosed(ctx,[{x:-s*.16,y:s*.12},{x:-s*.2,y:s*.42},{x:-s*.1,y:s*.44},{x:s*.1,y:s*.44},{x:s*.2,y:s*.42},{x:s*.16,y:s*.12}],'rgba(233,237,242,.92)',outline,Math.max(1.5,s*.01));return;
  }
  if(v==='clock'||v==='coin'||v==='question'||v==='lightbulb'){
    ellipse(ctx,0,0,Math.min(w,h)*.3,Math.min(w,h)*.3,fill,outline,Math.max(2,w*.012));
    if(v==='clock'){strokeCurve(ctx,[{x:0,y:0},{x:0,y:-h*.17}],outline,Math.max(2,w*.01));strokeCurve(ctx,[{x:0,y:0},{x:w*.14,y:h*.08}],outline,Math.max(2,w*.01));}
    else if(v==='coin'){ctx.fillStyle=outline;ctx.font=`800 ${Math.min(w,h)*.28}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('$',0,2);}
    else if(v==='question'){ctx.fillStyle=outline;ctx.font=`900 ${Math.min(w,h)*.45}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',0,2);}
    else {strokeCurve(ctx,[{x:-w*.08,y:h*.3},{x:w*.08,y:h*.3}],outline,Math.max(2,w*.01));for(let i=0;i<6;i++){const a=i*Math.PI/3;strokeCurve(ctx,[{x:Math.cos(a)*w*.35,y:Math.sin(a)*h*.35},{x:Math.cos(a)*w*.46,y:Math.sin(a)*h*.46}],outline,Math.max(1.3,w*.006),.7);}}
    return;
  }
  if(v==='cart'){
    smoothClosed(ctx,[{x:-w*.4,y:-h*.12},{x:w*.4,y:-h*.12},{x:w*.32,y:h*.23},{x:-w*.32,y:h*.23}],fill,outline,Math.max(2,w*.012));
    ellipse(ctx,-w*.24,h*.31,h*.11,h*.11,secondary,outline,Math.max(2,w*.01));
    ellipse(ctx,w*.24,h*.31,h*.11,h*.11,secondary,outline,Math.max(2,w*.01));return;
  }
  if(v==='barrel'){
    smoothClosed(ctx,[{x:-w*.28,y:-h*.38},{x:w*.28,y:-h*.38},{x:w*.36,y:0},{x:w*.28,y:h*.38},{x:-w*.28,y:h*.38},{x:-w*.36,y:0}],fill,outline,Math.max(2,w*.012));
    strokeCurve(ctx,[{x:-w*.31,y:-h*.2},{x:w*.31,y:-h*.2}],secondary,Math.max(2,w*.01));strokeCurve(ctx,[{x:-w*.31,y:h*.2},{x:w*.31,y:h*.2}],secondary,Math.max(2,w*.01));return;
  }
  if(v==='phone'||v==='computer'){
    smoothClosed(ctx,[{x:-w*.36,y:-h*.42},{x:w*.36,y:-h*.42},{x:w*.36,y:h*.42},{x:-w*.36,y:h*.42}],fill,outline,Math.max(2,w*.012));
    if(v==='computer'){strokeCurve(ctx,[{x:0,y:h*.42},{x:0,y:h*.53}],outline,Math.max(3,w*.015));strokeCurve(ctx,[{x:-w*.2,y:h*.53},{x:w*.2,y:h*.53}],outline,Math.max(3,w*.015));}return;
  }
  if(v==='crown'){
    smoothClosed(ctx,[{x:-w*.43,y:h*.28},{x:-w*.3,y:-h*.25},{x:-w*.08,y:0},{x:w*.08,y:-h*.3},{x:w*.27,y:0},{x:w*.43,y:-h*.22},{x:w*.34,y:h*.28}],fill,outline,Math.max(2,w*.012));return;
  }
  smoothClosed(ctx,[{x:-w*.38,y:-h*.32},{x:w*.38,y:-h*.32},{x:w*.38,y:h*.32},{x:-w*.38,y:h*.32}],fill,outline,Math.max(2,w*.012));
}

function drawDistantMountains(ctx:CanvasRenderingContext2D,w:number,h:number,seed:number,color:string,baseY:number,alpha:number) {
  ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=color;
  ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(0,baseY);
  let x=0;
  let y=baseY;
  let segment=0;
  while(x<w){
    const step=w*(.16+rand(seed,segment+1)*.1);
    const crest=baseY-h*(.035+rand(seed,segment+11)*.085);
    const endY=baseY+(rand(seed,segment+21)-.5)*h*.018;
    ctx.bezierCurveTo(
      x+step*.24,y-h*.015,
      x+step*.42,crest,
      x+step*.58,crest,
    );
    ctx.bezierCurveTo(
      x+step*.74,crest,
      x+step*.86,endY,
      Math.min(w,x+step),endY,
    );
    x+=step;y=endY;segment+=1;
  }
  ctx.lineTo(w,h);ctx.closePath();ctx.fill();ctx.restore();
}

function drawRiverRipples(ctx:CanvasRenderingContext2D,w:number,h:number,seed:number,startY:number) {
  for(let row=0;row<7;row++){
    const y=startY+row*h*.045;
    const offset=(rand(seed,row)*w*.08);
    for(let x=-w*.05+offset;x<w;x+=w*.16){
      strokeCurve(ctx,[{x,y},{x:x+w*.055,y:y-h*.008},{x:x+w*.11,y:y+h*.005}], 'rgba(255,255,255,.38)', Math.max(1.5,w*.0018),.9);
    }
  }
}


export function drawProceduralBackgroundBase(
  ctx: CanvasRenderingContext2D,
  scene: CanvasStudioScene,
  width: number,
  height: number,
) {
  const seed = hashSeed(scene.visualBrief || scene.name || scene.id, 401);
  const type = scene.background;
  const shot = scene.camera?.shot || 'medium';

  if (type === 'paper' || type === 'map') {
    const paper = ctx.createLinearGradient(0, 0, width, height);
    paper.addColorStop(0, '#f2ecdf');
    paper.addColorStop(1, '#e8deca');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.globalAlpha = .1;
    ctx.strokeStyle = '#7b6b59';
    ctx.lineWidth = 1;
    for (let y = 58; y < height; y += 48) {
      strokeCurve(ctx, [{x:0,y},{x:width*.5,y:y+2},{x:width,y:y-1}], '#7b6b59', 1, .65);
    }
    ctx.restore();
    if (type === 'map') {
      ctx.save();
      ctx.fillStyle = '#c9b78f';
      ctx.strokeStyle = '#75654f';
      ctx.lineWidth = 3;
      const land = (ox:number, oy:number, sx:number, sy:number, flip=1) => {
        ctx.beginPath();
        ctx.moveTo(ox-sx*.48,oy-sy*.08);
        ctx.bezierCurveTo(ox-sx*.35,oy-sy*.42,ox-sx*.08,oy-sy*.48,ox+sx*.12,oy-sy*.28);
        ctx.bezierCurveTo(ox+sx*.43,oy-sy*.38,ox+sx*.52,oy-sy*.02,ox+sx*.34,oy+sy*.17);
        ctx.bezierCurveTo(ox+sx*.12,oy+sy*.39,ox-sx*.18,oy+sy*.31,ox-sx*.42,oy+sy*.2*flip);
        ctx.bezierCurveTo(ox-sx*.5,oy+sy*.08,ox-sx*.52,oy,ox-sx*.48,oy-sy*.08);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      };
      land(width*.3,height*.46,width*.34,height*.42,1);
      land(width*.72,height*.5,width*.38,height*.36,-1);
      ctx.restore();
    }
    return;
  }

  if (type === 'underwater') {
    const water = ctx.createLinearGradient(0, 0, 0, height);
    water.addColorStop(0, '#7ca8ad');
    water.addColorStop(.4, '#557f87');
    water.addColorStop(1, '#294d55');
    ctx.fillStyle = water;
    ctx.fillRect(0,0,width,height);
    ctx.save();
    ctx.globalAlpha=.17;
    ctx.fillStyle='#edf7f5';
    for(let i=0;i<6;i++){
      ctx.beginPath();
      ctx.moveTo(width*(i/6),0);
      ctx.lineTo(width*(i/6+.1),0);
      ctx.lineTo(width*(i/6+.18),height*.5);
      ctx.lineTo(width*(i/6+.08),height*.52);
      ctx.closePath();ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle='#625e4f';
    ctx.beginPath();
    ctx.moveTo(0,height*.84);
    ctx.bezierCurveTo(width*.18,height*.79,width*.4,height*.88,width*.58,height*.84);
    ctx.bezierCurveTo(width*.75,height*.8,width*.86,height*.89,width,height*.82);
    ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();
    return;
  }

  if (type === 'room') {
    ctx.fillStyle='#e8dfd1';ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#b99976';ctx.fillRect(0,height*.76,width,height*.24);
    ctx.strokeStyle='#876f5b';ctx.lineWidth=3;
    strokeCurve(ctx,[{x:0,y:height*.76},{x:width,y:height*.76}],'#876f5b',3,.8);
    return;
  }

  if (type === 'city') {
    const sky=ctx.createLinearGradient(0,0,0,height);
    sky.addColorStop(0,'#d8e3e4');sky.addColorStop(1,'#efe8d9');
    ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#59686b';ctx.fillRect(0,height*.82,width,height*.18);
    return;
  }

  const night = type === 'night';
  const field = type === 'field';
  const sky = ctx.createLinearGradient(0,0,0,height);
  if (night) {
    sky.addColorStop(0,'#202a39');sky.addColorStop(.7,'#53646c');sky.addColorStop(1,'#6c746d');
  } else {
    sky.addColorStop(0,'#c8dadd');sky.addColorStop(.72,'#e8e4d6');sky.addColorStop(1,'#efe5cf');
  }
  ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);

  const horizon = shot === 'close-up' || shot === 'extreme-close-up'
    ? height*.57
    : shot === 'pov'
      ? height*.47
      : height*(.51 + (rand(seed,3)-.5)*.06);

  ctx.fillStyle = night ? '#4a5b57' : field ? '#8f9d72' : '#788c74';
  ctx.beginPath();
  ctx.moveTo(0,horizon);
  ctx.bezierCurveTo(width*.12,horizon-height*.06,width*.24,horizon+height*.015,width*.38,horizon-height*.035);
  ctx.bezierCurveTo(width*.53,horizon-height*.075,width*.63,horizon+height*.018,width*.78,horizon-height*.04);
  ctx.bezierCurveTo(width*.9,horizon-height*.065,width*.96,horizon-height*.01,width,horizon-height*.025);
  ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();

  if (field) {
    const ground=ctx.createLinearGradient(0,horizon,0,height);
    ground.addColorStop(0,'#8d9e72');ground.addColorStop(1,'#6f8060');
    ctx.fillStyle=ground;
    ctx.beginPath();ctx.moveTo(0,horizon+height*.035);
    ctx.bezierCurveTo(width*.25,horizon-height*.01,width*.55,horizon+height*.055,width,horizon+height*.01);
    ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();
    return;
  }

  const waterTop = horizon + height*.075;
  const water = ctx.createLinearGradient(0,waterTop,0,height);
  water.addColorStop(0, night ? '#526d75' : '#8ca8aa');
  water.addColorStop(1, night ? '#314a55' : '#607f83');
  ctx.fillStyle=water;
  ctx.beginPath();
  ctx.moveTo(0,waterTop);
  ctx.bezierCurveTo(width*.22,waterTop-height*.012,width*.48,waterTop+height*.018,width*.68,waterTop-height*.006);
  ctx.bezierCurveTo(width*.84,waterTop-height*.016,width*.92,waterTop+height*.008,width,waterTop-height*.004);
  ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();

  if (night) {
    ctx.fillStyle='#e3d8ae';
    ctx.beginPath();ctx.arc(width*.82,height*.13,28,0,Math.PI*2);ctx.fill();
  }

  // Organic near-bank shapes vary by shot/seed instead of repeating a mountain wallpaper.
  ctx.save();
  ctx.fillStyle=night?'#31453d':'#68795f';
  if (rand(seed,21)>.3 || shot==='pov') {
    ctx.beginPath();ctx.moveTo(0,horizon-height*.015);
    ctx.bezierCurveTo(width*.07,horizon-height*.03,width*.12,waterTop-height*.015,width*.2,waterTop+height*.055);
    ctx.lineTo(0,height);ctx.closePath();ctx.fill();
  }
  if (rand(seed,22)>.5) {
    ctx.beginPath();ctx.moveTo(width,horizon-height*.02);
    ctx.bezierCurveTo(width*.93,horizon-height*.01,width*.88,waterTop+height*.015,width*.81,waterTop+height*.055);
    ctx.lineTo(width,height);ctx.closePath();ctx.fill();
  }
  ctx.restore();
}

export function drawProceduralBackgroundDetails(ctx:CanvasRenderingContext2D,scene:CanvasStudioScene,width:number,height:number) {
  const seed=hashSeed(scene.visualBrief||scene.name||scene.id,500);
  const type=scene.background;

  if(type==='river'||type==='field'||type==='night'){
    drawDistantMountains(ctx,width,height,seed,type==='night'?'#3c5064':'#7e9c86',height*.55,.55);
    drawDistantMountains(ctx,width,height,seed+17,type==='night'?'#2f4355':'#668678',height*.6,.72);
  }

  if(type==='river'||type==='night'){
    drawRiverRipples(ctx,width,height,seed,height*.64);
    // Opposing riverbanks create depth and vary per scene seed.
    ctx.save();ctx.fillStyle=type==='night'?'#273a43':'#718766';ctx.globalAlpha=.92;
    ctx.beginPath();ctx.moveTo(0,height*.54);ctx.bezierCurveTo(width*.08,height*.52,width*.13,height*.61,width*.22,height*.64);ctx.lineTo(0,height);ctx.closePath();ctx.fill();
    if(rand(seed,9)>.35){ctx.beginPath();ctx.moveTo(width,height*.56);ctx.bezierCurveTo(width*.9,height*.54,width*.86,height*.62,width*.79,height*.65);ctx.lineTo(width,height);ctx.closePath();ctx.fill();}
    ctx.restore();
  }

  if(type==='field'){
    ctx.save();ctx.strokeStyle='rgba(74,93,50,.35)';ctx.lineWidth=1.5;
    for(let i=0;i<42;i++){
      const x=rand(seed,i)*width,y=height*(.62+rand(seed,i+70)*.34),len=10+rand(seed,i+120)*26;
      ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x-3,y-len*.6,x+(rand(seed,i+160)-.5)*8,y-len);ctx.stroke();
    }
    ctx.restore();
  }

  if(type==='underwater'){
    ctx.save();
    for(let i=0;i<14;i++){
      const x=rand(seed,i)*width,y=height*(.12+rand(seed,i+20)*.65),r=3+rand(seed,i+40)*8;
      ctx.strokeStyle='rgba(225,247,248,.3)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();
    }
    // Silhouetted stake field in the distance.
    for(let i=0;i<9;i++){
      const x=width*(.08+i*.105)+(rand(seed,i+100)-.5)*26;
      ctx.save();ctx.translate(x,height*.75);ctx.rotate((rand(seed,i+140)-.5)*.22);
      ctx.fillStyle='rgba(73,55,39,.48)';
      ctx.beginPath();ctx.moveTo(-5,height*.18);ctx.lineTo(-4,-height*.12);ctx.lineTo(0,-height*.2);ctx.lineTo(5,-height*.12);ctx.lineTo(6,height*.18);ctx.closePath();ctx.fill();ctx.restore();
    }
    ctx.restore();
  }

  if(type==='map'){
    ctx.save();ctx.strokeStyle='rgba(104,71,48,.35)';ctx.lineWidth=2;
    for(let i=0;i<4;i++){
      const x1=width*(.12+i*.17),y1=height*(.72-i*.07),x2=width*(.43+i*.13),y2=height*(.3+i*.05);
      strokeCurve(ctx,[{x:x1,y:y1},{x:(x1+x2)/2,y:(y1+y2)/2-height*.05},{x:x2,y:y2}],'rgba(135,72,51,.45)',3);
      smoothClosed(ctx,[{x:x2,y:y2},{x:x2-14,y:y2-8},{x:x2-10,y:y2+13}],'rgba(135,72,51,.45)','rgba(135,72,51,.45)',1);
    }
    ctx.restore();
  }

  if(type==='room'){
    // Furniture silhouettes keep rooms from feeling like rectangles.
    ctx.save();ctx.fillStyle='#9a7656';ctx.strokeStyle='#6e5542';ctx.lineWidth=2;
    ctx.fillRect(width*.08,height*.62,width*.25,height*.07);
    ctx.fillRect(width*.1,height*.69,width*.025,height*.18);
    ctx.fillRect(width*.285,height*.69,width*.025,height*.18);
    ctx.fillStyle='#d9c9ad';ctx.fillRect(width*.12,height*.42,width*.14,height*.16);ctx.strokeRect(width*.12,height*.42,width*.14,height*.16);
    ctx.restore();
  }

  if(type==='city'){
    ctx.save();
    for(let i=0;i<10;i++){
      const bw=width*(.055+rand(seed,i)*.055),bh=height*(.16+rand(seed,i+20)*.38),x=width*(i/9)-bw*.35,y=height*.79-bh;
      ctx.fillStyle=i%2?'#74858b':'#829398';ctx.fillRect(x,y,bw,bh);
      ctx.fillStyle='rgba(235,226,183,.4)';
      for(let ry=y+18;ry<y+bh-10;ry+=24) for(let rx=x+10;rx<x+bw-8;rx+=18) ctx.fillRect(rx,ry,5,7);
    }
    ctx.restore();
  }

  // A few foreground accents on non-diagram backgrounds add parallax depth.
  if(type==='river'||type==='field'){
    ctx.save();ctx.globalAlpha=.45;ctx.fillStyle='#435844';
    for(let i=0;i<4;i++){
      const x=rand(seed,i+220)*width;
      const y=height*(.76+rand(seed,i+240)*.18);
      ctx.beginPath();ctx.ellipse(x,y,22+rand(seed,i+260)*28,8+rand(seed,i+280)*8,0,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
}
