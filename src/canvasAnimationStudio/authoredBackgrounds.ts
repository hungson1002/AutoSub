import type { CanvasBackgroundSpec, CanvasSpecStructure, CanvasStudioScene } from './types';
import { evaluateObjectKeyframes } from './keyframes';
import {canvasWaterPhase} from '../../shared/canvasAtmosphere';
import { canvasEnvironmentDoorway } from '../../shared/canvasEnvironment';

type Pt = { x: number; y: number };

const INK = '#3a342e';
const SKY = '#d7e1df';
const PAPER = '#eee7d9';

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

function curve(ctx: CanvasRenderingContext2D, points: Pt[], stroke: string, width = 2, alpha = 1) {
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i]!;
    const q = points[i + 1]!;
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  const a = points[points.length - 2]!;
  const b = points[points.length - 1]!;
  ctx.quadraticCurveTo(a.x, a.y, b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawCloudBand(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  yBase: number,
  alpha = .38,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#f6f2e7';
  for (let i = 0; i < 5; i += 1) {
    const x = width * (.08 + i * .21) + (rnd(seed, i + 2) - .5) * width * .08;
    const y = yBase + (rnd(seed, i + 12) - .5) * height * .035;
    const w = width * (.07 + rnd(seed, i + 22) * .045);
    const h = height * (.025 + rnd(seed, i + 32) * .018);
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * .45, y - h * .2, w * .6, h * .75, 0, 0, Math.PI * 2);
    ctx.ellipse(x - w * .42, y + h * .05, w * .55, h * .68, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawReeds(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  width: number,
  height: number,
  seed: number,
  count: number,
  alpha = .55,
) {
  for (let i = 0; i < count; i += 1) {
    const x = x0 + rnd(seed, i + 50) * width;
    const len = height * (.45 + rnd(seed, i + 70) * .55);
    const sway = (rnd(seed, i + 90) - .5) * 10;
    curve(ctx, [
      {x, y:y0},
      {x:x+sway*.45, y:y0-len*.55},
      {x:x+sway, y:y0-len},
    ], '#4f654f', 1.3, alpha);
    if (rnd(seed, i + 110) > .62) {
      ctx.save();
      ctx.globalAlpha = alpha * .75;
      ctx.fillStyle = '#6c6947';
      ctx.beginPath();
      ctx.ellipse(x+sway, y0-len-3, 2.2, 6, -.12, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawPaperGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  alpha = .08,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 220; i += 1) {
    const x = rnd(seed, i + 400) * width;
    const y = rnd(seed, i + 700) * height;
    const r = .35 + rnd(seed, i + 1000) * 1.1;
    ctx.fillStyle = i % 3 === 0 ? '#5f554b' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHorrorFinish(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  strength = 1,
) {
  ctx.save();
  const vignette = ctx.createRadialGradient(width * .52, height * .48, height * .18, width * .52, height * .48, width * .72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(.58, `rgba(0,0,0,${.12 * strength})`);
  vignette.addColorStop(1, `rgba(0,0,0,${.48 * strength})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = .055 * strength;
  for (let i = 0; i < 360; i += 1) {
    const x = rnd(seed, i + 9000) * width;
    const y = rnd(seed, i + 9400) * height;
    const r = .35 + rnd(seed, i + 9800) * 1.35;
    ctx.fillStyle = i % 3 === 0 ? '#fff6d8' : '#090705';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = .08 * strength;
  ctx.fillStyle = '#0b0705';
  for (let y = 0; y < height; y += 3) ctx.fillRect(0, y, width, 1);
  ctx.restore();
}

function drawForegroundLeaves(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  side: 'left' | 'right',
) {
  const anchorX = side === 'left' ? -width*.015 : width*1.015;
  ctx.save();
  ctx.fillStyle = '#425746';
  ctx.strokeStyle = '#324237';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 8; i += 1) {
    const y = height * (.18 + i * .095) + (rnd(seed, i + 1300)-.5)*18;
    const x = anchorX + (side === 'left' ? 1 : -1) * (20 + rnd(seed, i+1320)*70);
    ctx.beginPath();
    ctx.ellipse(x, y, 18+rnd(seed,i+1340)*16, 8+rnd(seed,i+1360)*7, side==='left' ? -.45 : .45, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawBackgroundTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  seed: number,
  alpha = .9,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#67513e';
  ctx.strokeStyle = '#493c33';
  ctx.lineWidth = Math.max(1, scale*1.1);
  ctx.beginPath();
  ctx.moveTo(x-scale*4,y);
  ctx.bezierCurveTo(x-scale*4.8,y-scale*18,x-scale*3,y-scale*34,x-scale*1.5,y-scale*47);
  ctx.bezierCurveTo(x+scale*1,y-scale*48,x+scale*4.8,y-scale*20,x+scale*4,y);
  ctx.closePath();ctx.fill();ctx.stroke();

  const greens = ['#5a7059','#667d61','#52694f'];
  for(let i=0;i<5;i++){
    const ox=(rnd(seed,i+20)-.5)*scale*24;
    const oy=-scale*(38+rnd(seed,i+40)*20);
    const rx=scale*(12+rnd(seed,i+60)*8);
    const ry=scale*(10+rnd(seed,i+80)*8);
    ctx.fillStyle=greens[i%greens.length]!;
    ctx.strokeStyle='#465844';
    ctx.lineWidth=Math.max(.8,scale*.65);
    ctx.beginPath();
    ctx.ellipse(x+ox,y+oy,rx,ry,(rnd(seed,i+100)-.5)*.45,0,Math.PI*2);
    ctx.fill();ctx.stroke();
  }
  ctx.restore();
}

function fillBezierLand(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  y: number,
  color: string,
  amplitude: number,
  seed: number,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, y);
  const segments = 5;
  for (let i = 0; i < segments; i += 1) {
    const x0 = width * (i / segments);
    const x1 = width * ((i + 1) / segments);
    const mid = (x0 + x1) / 2;
    const crest = y - amplitude * (.35 + rnd(seed, i + 10) * .65);
    const endY = y + (rnd(seed, i + 30) - .5) * amplitude * .18;
    ctx.bezierCurveTo(
      x0 + (x1 - x0) * .23, y - amplitude * .08,
      mid - (x1 - x0) * .08, crest,
      mid, crest,
    );
    ctx.bezierCurveTo(
      mid + (x1 - x0) * .08, crest,
      x1 - (x1 - x0) * .18, endY,
      x1, endY,
    );
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawWater(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  top: number,
  seed: number,
  dark = false,
  timeMs = 0,
  intensity = 1,
) {
  const gradient = ctx.createLinearGradient(0, top, 0, height);
  gradient.addColorStop(0, dark ? '#5b737b' : '#9ab0b0');
  gradient.addColorStop(1, dark ? '#314a55' : '#688487');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, top, width, height - top);

  for (let row = 0; row < 7; row += 1) {
    const phase = canvasWaterPhase(timeMs, row, intensity);
    const y = top + 26 + row * 38 + phase.dy;
    for (let col = 0; col < 8; col += 1) {
      const origin = -30 + col * (width / 7) + rnd(seed, row * 19 + col) * 50;
      const x = ((origin + phase.dx + 160) % (width + 160)) - 160;
      const length = 42 + rnd(seed, row * 31 + col) * 70;
      curve(ctx, [
        { x, y },
        { x: x + length * .4, y: y - 2.5 },
        { x: x + length, y: y + 1.5 },
      ], dark ? '#a8bdbe' : '#e7efeb', 1.6, dark ? .38 : .55);
    }
  }
}

function drawRiverEstablishing(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number, timeMs = 0) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#cddbdd');
  sky.addColorStop(.7, '#e8e5d9');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  drawCloudBand(ctx, width, height, seed + 8, height * .17, .34);
  fillBezierLand(ctx, width, height, height * .49, '#a3af91', height * .09, seed + 1, .85);
  fillBezierLand(ctx, width, height, height * .56, '#7e927a', height * .07, seed + 2, .95);
  drawWater(ctx, width, height, height * .61, seed + 3, false, timeMs, scene.atmosphere?.waterIntensity);

  // Distant settlement/boats give the river a lived-in scale reference.
  ctx.save();
  ctx.globalAlpha = .34;
  ctx.fillStyle = '#59675a';
  for (let i = 0; i < 5; i += 1) {
    const bx = width * (.28 + i * .09) + (rnd(seed, i + 150) - .5) * 24;
    const by = height * (.585 + rnd(seed, i + 170) * .018);
    ctx.fillRect(bx, by - 7, 12 + rnd(seed, i + 180) * 10, 7);
    ctx.beginPath();
    ctx.moveTo(bx - 3, by - 7);
    ctx.lineTo(bx + 6, by - 14);
    ctx.lineTo(bx + 18, by - 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = '#66785e';
  ctx.beginPath();
  ctx.moveTo(0, height * .56);
  ctx.bezierCurveTo(width * .09, height * .54, width * .13, height * .64, width * .2, height * .69);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  if (rnd(seed, 90) > .4) {
    ctx.beginPath();
    ctx.moveTo(width, height * .55);
    ctx.bezierCurveTo(width * .92, height * .56, width * .88, height * .64, width * .81, height * .68);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  }
  drawReeds(ctx, 0, height*.83, width*.2, height*.18, seed+200, 16, .42);
  drawReeds(ctx, width*.82, height*.84, width*.18, height*.16, seed+240, 12, .38);
  if (rnd(seed, 91) > .5) drawForegroundLeaves(ctx, width, height, seed+270, 'left');
}

function drawRiverShoreline(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number, night = false, timeMs = 0) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, night ? '#263140' : '#d4e0df');
  sky.addColorStop(1, night ? '#586a70' : '#e8e4d8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  fillBezierLand(ctx, width, height, height * .47, night ? '#465950' : '#9aa98c', height * .06, seed + 10, .75);
  drawWater(ctx, width, height, height * .57, seed + 11, night, timeMs, scene.atmosphere?.waterIntensity);

  drawCloudBand(ctx, width, height, seed + 12, height * .15, night ? .07 : .28);
  ctx.fillStyle = night ? '#35443c' : '#6f8065';
  ctx.beginPath();
  ctx.moveTo(0, height * .39);
  ctx.bezierCurveTo(width * .15, height * .42, width * .23, height * .56, width * .29, height * .72);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = '#50614d';
  ctx.lineWidth = 2;
  for (let i = 0; i < 18; i += 1) {
    const x = rnd(seed, i + 20) * width * .28;
    const y = height * (.55 + rnd(seed, i + 40) * .34);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 3, y - 18, x + (rnd(seed, i + 60) - .5) * 7, y - 34);
    ctx.stroke();
  }
  ctx.restore();
  drawReeds(ctx, 0, height*.87, width*.29, height*.22, seed+160, 22, .62);
  drawForegroundLeaves(ctx, width, height, seed+190, 'left');
  const shoreActors=scene.objects.some(o=>o.kind==='character'&&o.appearance!=='water-spirit'&&!o.onBoat&&o.waterlineY===undefined)
    ||scene.objects.some(o=>o.variant==='sandals'&&!o.onBoat&&!o.heldBy&&o.y>=height*.8);
  if(shoreActors){
    // A near bank supports shore witnesses and exposed washed-ashore bodies.
    ctx.fillStyle=night?'#39443a':'#a49b78';
    ctx.beginPath();ctx.moveTo(0,height*.64);
    ctx.bezierCurveTo(width*.18,height*.65,width*.43,height*.70,width*.66,height*.83);
    ctx.lineTo(width,height*.94);ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();
    ctx.strokeStyle=night?'#647363':'#c6bd96';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,height*.64);ctx.bezierCurveTo(width*.18,height*.65,width*.43,height*.70,width*.66,height*.83);ctx.stroke();
  }
}

function drawRiverPov(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number, timeMs = 0) {
  drawRiverEstablishing(ctx, scene, width, height, timeMs);
  ctx.fillStyle = '#4f6254';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(width * .12, 0);
  ctx.bezierCurveTo(width * .14, height * .2, width * .13, height * .42, width * .19, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(width, 0);
  ctx.lineTo(width * .92, 0);
  ctx.bezierCurveTo(width * .9, height * .22, width * .91, height * .45, width * .86, height);
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
}

function drawNightRiver(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number, timeMs = 0) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#263140');
  sky.addColorStop(.7, '#586a70');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e0d4ac';
  ctx.beginPath();
  ctx.arc(width * .78, height * .13, 22, 0, Math.PI * 2);
  ctx.fill();
  fillBezierLand(ctx, width, height, height * .53, '#465950', height * .08, seed + 1, .8);
  fillBezierLand(ctx, width, height, height * .58, '#354a44', height * .06, seed + 2, .95);
  drawWater(ctx, width, height, height * .62, seed + 4, true, timeMs, scene.atmosphere?.waterIntensity);
  ctx.save();
  ctx.globalAlpha=.36;
  ctx.fillStyle='#d9d4ba';
  for(let i=0;i<12;i++){
    const x=width*(.08+rnd(seed,i+300)*.76);
    const y=height*(.08+rnd(seed,i+330)*.22);
    ctx.beginPath();ctx.arc(x,y,1+rnd(seed,i+350)*1.4,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
  drawReeds(ctx, width*.02, height*.9, width*.16, height*.18, seed+380, 14, .35);
}

function drawNightStiltHouse(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#17222f');
  sky.addColorStop(.58, '#33414b');
  sky.addColorStop(1, '#202c29');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Distant layered mountain silhouettes keep the location rural and isolated.
  fillBezierLand(ctx, width, height, height * .48, '#2b3936', height * .12, seed + 91, .72);
  fillBezierLand(ctx, width, height, height * .57, '#1d2a25', height * .08, seed + 92, .96);

  ctx.save();
  ctx.globalAlpha = .8;
  ctx.fillStyle = '#d8cfaa';
  ctx.beginPath();
  ctx.arc(width * .79, height * .14, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Stilt house, intentionally large enough to become the location anchor.
  const hx = width * .42;
  const hy = height * .46;
  const hw = width * .34;
  const hh = height * .25;
  ctx.fillStyle = '#3b302a';
  ctx.strokeStyle = '#171515';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hx - hw * .58, hy);
  ctx.lineTo(hx, hy - hh * .5);
  ctx.lineTo(hx + hw * .58, hy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#4c3c31';
  ctx.fillRect(hx - hw * .48, hy, hw * .96, hh * .62);
  ctx.strokeRect(hx - hw * .48, hy, hw * .96, hh * .62);

  // Timber plank rhythm.
  for (let i = 1; i < 7; i += 1) {
    const x = hx - hw * .48 + (hw * .96 / 7) * i;
    curve(ctx, [{ x, y: hy + 4 }, { x: x + (i % 2 ? 2 : -2), y: hy + hh * .6 }], '#261f1b', 1.1, .45);
  }
  for (let row = 1; row < 4; row += 1) {
    const y = hy + (hh * .62 / 4) * row;
    curve(ctx, [
      { x: hx - hw * .47, y },
      { x: hx - hw * .05, y: y + (row % 2 ? 1.5 : -1) },
      { x: hx + hw * .47, y: y + .5 },
    ], '#221b17', 1, .5);
  }
  ctx.save();
  ctx.globalAlpha = .18;
  for (let i = 0; i < 20; i += 1) {
    const x = hx - hw * .42 + rnd(seed, i + 520) * hw * .84;
    const y = hy + rnd(seed, i + 560) * hh * .48;
    curve(ctx, [{ x, y }, { x: x + 22 + rnd(seed, i + 580) * 40, y: y + (rnd(seed, i + 600) - .5) * 4 }], '#896b50', .7, .55);
  }
  ctx.restore();

  // One weak warm window is the only strong light source.
  const wx = hx + hw * .15;
  const wy = hy + hh * .17;
  const ww = hw * .13;
  const wh = hh * .22;
  const glow = ctx.createRadialGradient(wx + ww / 2, wy + wh / 2, 4, wx + ww / 2, wy + wh / 2, ww * 2.8);
  glow.addColorStop(0, 'rgba(205,137,70,.23)');
  glow.addColorStop(1, 'rgba(205,137,70,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(wx - ww * 2.2, wy - wh * 1.8, ww * 5.4, wh * 4.7);
  ctx.fillStyle = '#b87545';
  ctx.globalAlpha = .68;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.globalAlpha = 1;

  // Tall stilts and black under-floor gap are essential to the story world.
  const floorY = hy + hh * .62;
  ctx.fillStyle = '#0d1110';
  ctx.fillRect(hx - hw * .5, floorY, hw, height * .22);
  const underGlow = ctx.createRadialGradient(hx + hw * .18, floorY - hh * .07, 2, hx + hw * .18, floorY - hh * .07, hw * .56);
  underGlow.addColorStop(0, 'rgba(194,118,58,.08)');
  underGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = underGlow;
  ctx.fillRect(hx - hw * .55, floorY - hh * .18, hw * 1.1, height * .35);
  ctx.strokeStyle = '#31261f';
  ctx.lineWidth = 7;
  for (const x of [hx - hw * .36, hx - hw * .12, hx + hw * .14, hx + hw * .36]) {
    curve(ctx, [{ x, y: floorY }, { x: x + (rnd(seed, Math.round(x)) - .5) * 5, y: height * .87 }], '#31261f', 7, .95);
  }

  // Ground haze and dark vegetation create depth without adding busyness.
  ctx.save();
  ctx.globalAlpha = .24;
  ctx.fillStyle = '#69736d';
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.ellipse(width * (.15 + i * .18), height * (.82 + (i % 2) * .03), width * .15, height * .035, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  drawForegroundLeaves(ctx, width, height, seed + 410, 'left');
  drawForegroundLeaves(ctx, width, height, seed + 430, 'right');
  drawHorrorFinish(ctx, width, height, seed + 450, 1.05);
}

function drawFieldOpen(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, width, height);
  drawCloudBand(ctx, width, height, seed+4, height*.16, .31);
  fillBezierLand(ctx, width, height, height * .5, '#abb99a', height * .08, seed + 2, .75);
  fillBezierLand(ctx, width, height, height * .58, '#879b77', height * .05, seed + 3, .9);

  const ground = ctx.createLinearGradient(0, height * .58, 0, height);
  ground.addColorStop(0, '#83966f');
  ground.addColorStop(1, '#687c5f');
  ctx.fillStyle = ground;
  ctx.fillRect(0, height * .61, width, height * .39);

  ctx.save();
  ctx.strokeStyle = '#53664f';
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = .35;
  for (let i = 0; i < 42; i += 1) {
    const x = rnd(seed, i + 80) * width;
    const y = height * (.67 + rnd(seed, i + 100) * .3);
    const len = 10 + rnd(seed, i + 120) * 26;
    curve(ctx, [
      { x, y },
      { x: x - 2, y: y - len * .6 },
      { x: x + (rnd(seed, i + 140) - .5) * 8, y: y - len },
    ], '#53664f', 1.1, .5);
  }
  ctx.restore();
  // Layered foreground shrubs break the flat horizon and create depth.
  if (rnd(seed, 170) > .35) drawBackgroundTree(ctx, width*.08, height*.78, 1.05, seed+170, .8);
  if (rnd(seed, 171) > .55) drawBackgroundTree(ctx, width*.9, height*.8, .9, seed+190, .72);
  drawReeds(ctx, width*.02, height*.96, width*.22, height*.12, seed+210, 18, .34);
}

function drawFieldCamp(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  drawFieldOpen(ctx, scene, width, height);
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);
  drawBackgroundTree(ctx, width*.08, height*.78, 1.25, seed+10, .95);
  drawBackgroundTree(ctx, width*.9, height*.77, 1.1, seed+30, .9);
  // Tents / campsite silhouettes create a specific location rather than generic grass.
  ctx.save();
  ctx.globalAlpha=.82;
  ctx.fillStyle='#8a7258';
  ctx.strokeStyle='#5c4b3e';
  ctx.lineWidth=1.5;
  const tents: Array<[number,number,number]> = [
    [width*.68,height*.72,58],[width*.76,height*.75,42],
  ];
  tents.forEach(([x,y,s])=>{
    ctx.beginPath();ctx.moveTo(x-s*.5,y);ctx.lineTo(x,y-s*.55);ctx.lineTo(x+s*.5,y);ctx.closePath();ctx.fill();ctx.stroke();
    curve(ctx,[{x,y:y-s*.55},{x,y:y+4}],'#5c4b3e',1.1,.75);
  });
  ctx.restore();

  if (rnd(seed, 7) > .3) {
    ctx.strokeStyle = '#5c4b3e';
    ctx.lineWidth = 3;
    curve(ctx, [
      { x: width * .34, y: height * .73 },
      { x: width * .44, y: height * .68 },
      { x: width * .53, y: height * .73 },
    ], '#5c4b3e', 3, .75);
  }
}

function drawCityStreet(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);
  ctx.fillStyle = '#dce5e4';
  ctx.fillRect(0, 0, width, height);

  const horizon = height * .73;
  const palette = ['#789096', '#667b82', '#8a9ca0', '#60737a'];
  let x = -20;
  let building = 0;
  while (x < width) {
    const bw = width * (.07 + rnd(seed, building + 1) * .06);
    const bh = height * (.22 + rnd(seed, building + 9) * .36);
    const y = horizon - bh;
    const body = palette[building % palette.length]!;
    ctx.fillStyle = body;
    ctx.fillRect(x, y, bw, bh);
    // Roof / cornice silhouette varies per building.
    ctx.fillStyle = building % 2 ? '#596d72' : '#66797d';
    if (building % 3 === 0) {
      ctx.beginPath();ctx.moveTo(x-4,y);ctx.lineTo(x+bw*.5,y-18);ctx.lineTo(x+bw+4,y);ctx.closePath();ctx.fill();
    } else {
      ctx.fillRect(x-3,y-7,bw+6,7);
    }
    ctx.fillStyle = 'rgba(239,230,190,.42)';
    for (let wy = y + 20; wy < horizon - 22; wy += 28) {
      for (let wx = x + 12; wx < x + bw - 9; wx += 22) {
        ctx.fillRect(wx, wy, 6, 10);
        ctx.fillStyle='rgba(55,69,72,.38)';
        ctx.fillRect(wx+2.5,wy,1,10);
        ctx.fillStyle='rgba(239,230,190,.42)';
      }
    }
    // Small awning or balcony.
    if (building % 2 === 0) {
      ctx.fillStyle='#b48a69';
      ctx.fillRect(x+bw*.16,horizon-48,bw*.58,6);
      curve(ctx,[{x:x+bw*.16,y:horizon-42},{x:x+bw*.74,y:horizon-42}],'#4f5d60',1,.5);
    }
    x += bw + 7;
    building += 1;
  }

  ctx.fillStyle = '#596b6e';
  ctx.fillRect(0, horizon, width, height - horizon);
  curve(ctx, [{x:0,y:horizon+10},{x:width,y:horizon+10}], '#809092', 2, .35);
  // Sidewalk perspective, lamp posts and distant pedestrians add real street structure.
  curve(ctx,[{x:0,y:horizon+42},{x:width*.5,y:horizon+24},{x:width,y:horizon+42}],'#879497',2,.42);
  for (const px of [width*.12,width*.84]) {
    curve(ctx,[{x:px,y:horizon+8},{x:px,y:horizon-65}],'#495a5d',3,.82);
    ctx.save();ctx.fillStyle='#596a6d';ctx.beginPath();ctx.arc(px,horizon-69,7,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  ctx.save();ctx.globalAlpha=.38;ctx.fillStyle='#3f4f52';
  for(let i=0;i<5;i++){
    const px=width*(.24+i*.12), py=horizon+18+(i%2)*5;
    ctx.beginPath();ctx.arc(px,py-10,3,0,Math.PI*2);ctx.fill();
    curve(ctx,[{x:px,y:py-7},{x:px+(i%2?2:-2),y:py+8}],'#3f4f52',2,.6);
  }
  ctx.restore();
  if(scene.atmosphere?.timeOfDay==='night'){
    ctx.save();ctx.fillStyle='rgba(7,15,18,.56)';ctx.fillRect(0,0,width,height);
    for(const px of [width*.12,width*.84]){
      const glow=ctx.createRadialGradient(px,horizon-69,2,px,horizon-69,width*.075);
      glow.addColorStop(0,'rgba(232,184,101,.20)');glow.addColorStop(1,'rgba(232,184,101,0)');
      ctx.fillStyle=glow;ctx.fillRect(px-width*.08,horizon-height*.23,width*.16,height*.28);
    }
    ctx.restore();drawHorrorFinish(ctx,width,height,seed+1200,.52);
  }
}

function drawCityAlleyNight(ctx:CanvasRenderingContext2D,scene:CanvasStudioScene,width:number,height:number){
  const seed=seedOf(scene.stageId||scene.visualBrief||scene.name||'city-alley-night');
  const vanishX=width*.58,vanishY=height*.54;

  // Night sky / humid ambient bounce.
  const sky=ctx.createLinearGradient(0,0,0,height);
  sky.addColorStop(0,'#172125');sky.addColorStop(.55,'#20292b');sky.addColorStop(1,'#141819');
  ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);

  // Alley floor: one strong perspective wedge with damp material breakup.
  const ground=ctx.createLinearGradient(0,vanishY,0,height);
  ground.addColorStop(0,'#313738');ground.addColorStop(.48,'#242829');ground.addColorStop(1,'#111415');
  ctx.fillStyle=ground;
  ctx.beginPath();ctx.moveTo(width*.16,height);ctx.lineTo(width*.84,height);ctx.lineTo(vanishX+width*.05,vanishY);ctx.lineTo(vanishX-width*.05,vanishY);ctx.closePath();ctx.fill();

  // Old facades form a canyon rather than a skyline card.
  const left=ctx.createLinearGradient(0,0,width*.42,0);
  left.addColorStop(0,'#1b2021');left.addColorStop(1,'#394143');
  ctx.fillStyle=left;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(width*.42,0);ctx.lineTo(vanishX-width*.045,vanishY);ctx.lineTo(width*.16,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();
  const right=ctx.createLinearGradient(width*.58,0,width,0);
  right.addColorStop(0,'#424846');right.addColorStop(1,'#171b1c');
  ctx.fillStyle=right;ctx.beginPath();ctx.moveTo(width*.63,0);ctx.lineTo(width,0);ctx.lineTo(width,height);ctx.lineTo(width*.84,height);ctx.lineTo(vanishX+width*.045,vanishY);ctx.closePath();ctx.fill();

  // Horizontal slab/awning rhythms shrink toward the vanishing point.
  for(let i=0;i<5;i++){
    const t=i/5,scale=1-t*.72;
    const y=height*(.19+t*.105);
    const leftEdge=width*(.018+t*.105),rightEdge=width*(.982-t*.085);
    curve(ctx,[{x:leftEdge,y},{x:vanishX-width*.052*scale,y:vanishY-(1-t)*height*.035}],'#111617',Math.max(.7,2.2*scale),.54);
    curve(ctx,[{x:rightEdge,y:y+4},{x:vanishX+width*.052*scale,y:vanishY-(1-t)*height*.03}],'#111617',Math.max(.7,2.2*scale),.5);
  }

  // Doors/windows on the side walls use perspective-scaled proportions.
  for(let i=0;i<4;i++){
    const t=i/4,scale=1-t*.68;
    const y=height*(.78-t*.06);
    const dh=height*.28*scale,dw=width*.075*scale;
    const lx=width*(.03+t*.105);
    ctx.fillStyle=i%2?'#202526':'#252b2b';ctx.strokeStyle='#56605d';ctx.lineWidth=Math.max(.6,1.2*scale);
    ctx.fillRect(lx,y-dh,dw,dh);ctx.strokeRect(lx,y-dh,dw,dh);
    ctx.fillStyle='rgba(183,151,91,.35)';ctx.beginPath();ctx.arc(lx+dw*.82,y-dh*.48,Math.max(.7,2*scale),0,Math.PI*2);ctx.fill();
    const rx=width-lx-dw;
    ctx.fillStyle=i%2?'#272c2b':'#202526';ctx.fillRect(rx,y-dh,dw,dh);ctx.strokeRect(rx,y-dh,dw,dh);
    if(i<3){
      const wh=dh*.26,wy=y-dh*.83;
      ctx.fillStyle='rgba(101,119,119,.24)';ctx.fillRect(lx+dw*.18,wy,dw*.55,wh);
      ctx.fillRect(rx+dw*.18,wy,dw*.55,wh);
    }
  }

  // The boarding-house facade at the alley end gives the establishing shot a
  // specific destination instead of a generic city silhouette.
  const houseW=width*.18,houseH=height*.25,hx=vanishX-houseW*.5,hy=vanishY-houseH*.52;
  ctx.fillStyle='#303534';ctx.strokeStyle='#62665f';ctx.lineWidth=1.15;
  ctx.fillRect(hx,hy,houseW,houseH);ctx.strokeRect(hx,hy,houseW,houseH);
  ctx.fillStyle='#202526';ctx.fillRect(vanishX-houseW*.11,vanishY-houseH*.02,houseW*.22,houseH*.48);
  ctx.fillStyle='rgba(218,170,88,.25)';
  for(const sx of [-.29,.29])for(const sy of [-.23,.13])ctx.fillRect(vanishX+houseW*sx-houseW*.075,hy+houseH*(.28+sy),houseW*.15,houseH*.12);
  // Blank hanging signboard: location cue without generated text.
  ctx.fillStyle='#6f5a44';ctx.strokeStyle='#24211f';ctx.fillRect(hx+houseW*.57,hy+houseH*.18,houseW*.27,houseH*.11);ctx.strokeRect(hx+houseW*.57,hy+houseH*.18,houseW*.27,houseH*.11);

  // Pipes, utility wires and drain channels make the alley feel built rather
  // than decorated with foreground props.
  for(const x of [width*.12,width*.88])curve(ctx,[{x,y:height*.09},{x:x+(x<width*.5?9:-8),y:height*.80}],'#16191a',2.3,.72);
  curve(ctx,[{x:0,y:height*.13},{x:width*.35,y:height*.18},{x:width*.73,y:height*.11},{x:width,y:height*.16}],'#0e1213',1.25,.82);
  curve(ctx,[{x:0,y:height*.18},{x:width*.42,y:height*.23},{x:width*.68,y:height*.17},{x:width,y:height*.22}],'#0d1112',.9,.65);

  // One warm practical near the destination and its local pool of light.
  const lampX=vanishX+houseW*.31,lampY=hy+houseH*.13;
  const glow=ctx.createRadialGradient(lampX,lampY,2,lampX,lampY,width*.085);
  glow.addColorStop(0,'rgba(238,183,96,.25)');glow.addColorStop(.5,'rgba(224,163,79,.08)');glow.addColorStop(1,'rgba(224,163,79,0)');
  ctx.fillStyle=glow;ctx.fillRect(lampX-width*.09,lampY-width*.09,width*.18,width*.18);
  ctx.fillStyle='#b79761';ctx.beginPath();ctx.arc(lampX,lampY,3.2,0,Math.PI*2);ctx.fill();

  // Damp puddles reflect only small vertical streaks of the practical/window light.
  ctx.save();
  for(let i=0;i<5;i++){
    const px=width*(.31+rnd(seed,i+110)*.38),py=height*(.79+rnd(seed,i+140)*.14);
    ctx.globalAlpha=.08+rnd(seed,i+170)*.08;ctx.fillStyle=i%2?'#9e8058':'#718384';
    ctx.beginPath();ctx.ellipse(px,py,width*(.022+rnd(seed,i+200)*.035),height*.008,0,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();

  // Sparse wall wear near the foreground surfaces.
  for(let i=0;i<14;i++){
    const sideLeft=i%2===0;
    const x=sideLeft?width*(.025+rnd(seed,i+240)*.25):width*(.75+rnd(seed,i+270)*.22);
    const y=height*(.25+rnd(seed,i+300)*.45);
    curve(ctx,[{x,y},{x:x+(sideLeft?1:-1)*(8+rnd(seed,i+330)*28),y:y+(rnd(seed,i+360)-.5)*5}],'#7f7468',.6,.12);
  }
  drawHorrorFinish(ctx,width,height,seed+3100,.88);
}

function drawCityClose(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed=seedOf(scene.visualBrief||scene.name);
  ctx.fillStyle = '#dde5e3';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#778c91';
  ctx.fillRect(0, height * .18, width * .32, height * .7);
  ctx.fillStyle = '#87999d';
  ctx.fillRect(width * .75, height * .28, width * .25, height * .6);

  ctx.fillStyle = 'rgba(242,233,194,.4)';
  for (const baseX of [width * .05, width * .8]) {
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const wx=baseX + col * 28, wy=height * .26 + row * 40;
        ctx.fillRect(wx, wy, 8, 13);
        ctx.fillStyle='rgba(67,80,82,.34)';ctx.fillRect(wx+3.4,wy,1.2,13);
        ctx.fillStyle='rgba(242,233,194,.4)';
      }
    }
  }
  // Framing facade details.
  ctx.fillStyle='#687c80';
  ctx.fillRect(width*.74,height*.23,width*.26,10);
  ctx.fillRect(0,height*.14,width*.33,9);
  ctx.fillStyle='#ae8264';
  ctx.fillRect(width*.78,height*.63,width*.17,9);
  ctx.fillRect(width*.04,height*.58,width*.19,8);
  // Wires / signage.
  curve(ctx,[{x:width*.28,y:height*.31},{x:width*.5,y:height*.27},{x:width*.76,y:height*.33}],'#5c696b',1.4,.4);
  ctx.save();ctx.globalAlpha=.35;ctx.fillStyle='#435356';
  for(let i=0;i<4;i++){
    const x=width*(.38+i*.08)+(rnd(seed,i+10)-.5)*18;
    const y=height*(.76+rnd(seed,i+20)*.06);
    ctx.beginPath();ctx.arc(x,y-12,3,0,Math.PI*2);ctx.fill();
    curve(ctx,[{x,y:y-9},{x:x+(i%2?2:-2),y:y+6}],'#435356',2,.55);
  }
  ctx.restore();
  ctx.fillStyle = '#607276';
  ctx.fillRect(0, height * .86, width, height * .14);
  if(scene.atmosphere?.timeOfDay==='night'){
    ctx.save();ctx.fillStyle='rgba(6,14,17,.60)';ctx.fillRect(0,0,width,height);ctx.restore();
    drawHorrorFinish(ctx,width,height,seed+1300,.62);
  }
}

function drawCityHallway(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed=seedOf(scene.stageId||scene.visualBrief||scene.name);
  const wall=ctx.createLinearGradient(0,0,0,height);
  wall.addColorStop(0,'#303b3f');wall.addColorStop(.58,'#242c2f');wall.addColorStop(1,'#171c1e');
  ctx.fillStyle=wall;ctx.fillRect(0,0,width,height);
  const horizonY=height*.49,vanishX=width*.57;
  // ceiling and floor converge into one deep corridor instead of reading as a flat facade.
  ctx.fillStyle='#20272a';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(width,0);ctx.lineTo(vanishX,horizonY);ctx.closePath();ctx.fill();
  const floor=ctx.createLinearGradient(0,horizonY,0,height);floor.addColorStop(0,'#31383a');floor.addColorStop(1,'#171a1b');
  ctx.fillStyle=floor;ctx.beginPath();ctx.moveTo(0,height);ctx.lineTo(width,height);ctx.lineTo(vanishX,horizonY);ctx.closePath();ctx.fill();
  ctx.fillStyle='#394447';ctx.beginPath();ctx.moveTo(0,height);ctx.lineTo(0,0);ctx.lineTo(vanishX,horizonY);ctx.closePath();ctx.fill();
  ctx.fillStyle='#344043';ctx.beginPath();ctx.moveTo(width,height);ctx.lineTo(width,0);ctx.lineTo(vanishX,horizonY);ctx.closePath();ctx.fill();

  // Perspective floor grammar: converging seams + compressed cross joints make
  // the corridor a walkable plane instead of a flat dark triangle.
  for(const bottomX of [width*.12,width*.30,width*.48,width*.68,width*.86]){
    curve(ctx,[{x:vanishX,y:horizonY},{x:bottomX,y:height}],'rgba(100,119,121,.28)',1,.72);
  }
  for(let row=1;row<=5;row++){
    const t=row/6,p=t*t;
    const y=horizonY+(height-horizonY)*p;
    const left=vanishX*(1-p),right=vanishX+(width-vanishX)*p;
    curve(ctx,[{x:left,y},{x:right,y:y+(rnd(seed,900+row)-.5)*2}],'rgba(96,108,109,.22)',.8,.58);
  }
  // A darker skirting line locks wall planes to the floor.
  curve(ctx,[{x:0,y:height},{x:vanishX,y:horizonY}],'rgba(9,13,14,.72)',2.2,.7);
  curve(ctx,[{x:width,y:height},{x:vanishX,y:horizonY}],'rgba(9,13,14,.72)',2.2,.7);

  // Damp/material breakup follows perspective rather than screen-space noise.
  for(let i=0;i<9;i++){
    const t=.24+rnd(seed,930+i)*.7;
    const y=horizonY+(height-horizonY)*t;
    const left=vanishX*(1-t),right=vanishX+(width-vanishX)*t;
    const x=left+(right-left)*(.18+rnd(seed,960+i)*.64);
    const len=width*(.018+rnd(seed,990+i)*.035)*t;
    curve(ctx,[{x:x-len,y},{x,y:y+(rnd(seed,1020+i)-.5)*3},{x:x+len,y:y+1}],'rgba(8,12,13,.34)',.8,.55);
  }
  // Repeating doors shrink toward the vanishing point.
  for(let i=0;i<4;i++){
    const t=i/4,scale=1-t*.72;
    const leftX=width*(.035+t*.105),baseY=height*(.78-t*.07),dw=width*.105*scale,dh=height*.36*scale;
    ctx.fillStyle=i%2?'#252b2c':'#2b3031';ctx.strokeStyle='#536164';ctx.lineWidth=Math.max(.7,1.4*scale);
    ctx.fillRect(leftX,baseY-dh,dw,dh);ctx.strokeRect(leftX,baseY-dh,dw,dh);
    ctx.fillStyle='#7b684e';ctx.beginPath();ctx.arc(leftX+dw*.82,baseY-dh*.48,2.1*scale,0,Math.PI*2);ctx.fill();
    const rightX=width-leftX-dw;
    ctx.fillStyle=i%2?'#2b3031':'#252b2c';ctx.fillRect(rightX,baseY-dh,dw,dh);ctx.strokeRect(rightX,baseY-dh,dw,dh);
  }
  // Fluorescent practicals: small local islands of light, not a globally bright corridor.
  for(let i=0;i<4;i++){
    const t=i/4,x=width*(.52+t*.015),y=height*(.09+t*.105),w=width*(.11*(1-t*.7)),h=Math.max(3,height*.012*(1-t*.6));
    const glow=ctx.createRadialGradient(x,y,1,x,y,w*.75);glow.addColorStop(0,'rgba(202,216,207,.13)');glow.addColorStop(1,'rgba(202,216,207,0)');
    ctx.fillStyle=glow;ctx.fillRect(x-w,y-w*.5,w*2,w);
    ctx.fillStyle=i===3?'#65706c':'#89958f';ctx.globalAlpha=.55;ctx.fillRect(x-w/2,y,w,h);ctx.globalAlpha=1;

    // Matching floor pool connects each practical to the architecture below.
    const floorT=.82-i*.15;
    const py=horizonY+(height-horizonY)*floorT;
    const px=vanishX+(width*.5-vanishX)*floorT;
    const poolW=width*(.13*floorT+.018),poolH=height*(.018*floorT+.006);
    const pool=ctx.createRadialGradient(px,py,1,px,py,poolW);
    pool.addColorStop(0,'rgba(184,202,194,.075)');pool.addColorStop(1,'rgba(184,202,194,0)');
    ctx.fillStyle=pool;ctx.beginPath();ctx.ellipse(px,py,poolW,poolH,0,0,Math.PI*2);ctx.fill();
  }
  // Far end stays almost black so a silhouette has negative space to live in.
  ctx.fillStyle='rgba(7,10,11,.78)';ctx.fillRect(vanishX-width*.045,horizonY-height*.07,width*.09,height*.16);
  drawHorrorFinish(ctx,width,height,seed+1700,.82);
}

function drawRoomSimpleNight(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed=seedOf(scene.stageId||scene.visualBrief||scene.name);
  const floorY=height*.76;
  const vanishX=width*.57;

  // Architectural shell: one broad back wall plus a darker return wall. The
  // set now has a real corner and depth before any semantic furniture is drawn.
  const wall=ctx.createLinearGradient(0,0,0,floorY);
  wall.addColorStop(0,'#3f4745');wall.addColorStop(.52,'#353331');wall.addColorStop(1,'#292421');
  ctx.fillStyle=wall;ctx.fillRect(0,0,width,floorY);
  const side=ctx.createLinearGradient(width*.72,0,width,0);
  side.addColorStop(0,'rgba(31,29,28,.08)');side.addColorStop(1,'rgba(13,13,13,.62)');
  ctx.fillStyle=side;
  ctx.beginPath();ctx.moveTo(width*.76,0);ctx.lineTo(width,0);ctx.lineTo(width,floorY);ctx.lineTo(width*.82,floorY);ctx.closePath();ctx.fill();
  curve(ctx,[{x:width*.76,y:0},{x:width*.82,y:floorY}],'#191817',1.4,.65);

  // Ceiling edge and skirting give scale without baking story props into the plate.
  const ceiling=ctx.createLinearGradient(0,0,0,height*.09);
  ceiling.addColorStop(0,'rgba(12,14,14,.5)');ceiling.addColorStop(1,'rgba(12,14,14,0)');
  ctx.fillStyle=ceiling;ctx.fillRect(0,0,width,height*.10);
  ctx.fillStyle='#28211d';ctx.fillRect(0,floorY-9,width,9);
  curve(ctx,[{x:0,y:floorY-9},{x:width,y:floorY-9}],'#655246',1.15,.48);

  // A few deterministic plaster repairs/stains create lived-in material detail
  // without turning the wall into decorative noise.
  ctx.save();
  for(let i=0;i<13;i++){
    const x=width*(.30+rnd(seed,i+310)*.43);
    const y=height*(.13+rnd(seed,i+350)*.48);
    const rx=10+rnd(seed,i+390)*34,ry=4+rnd(seed,i+430)*13;
    ctx.globalAlpha=.035+rnd(seed,i+470)*.055;
    ctx.fillStyle=i%3===0?'#8a8178':'#171817';
    ctx.beginPath();ctx.ellipse(x,y,rx,ry,(rnd(seed,i+500)-.5)*.35,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
  for(let i=0;i<7;i++){
    const x=width*(.34+rnd(seed,i+540)*.37),y=height*(.21+rnd(seed,i+570)*.38);
    curve(ctx,[{x,y},{x:x+10+rnd(seed,i+600)*26,y:y+(rnd(seed,i+630)-.5)*6}],'#171615',.6,.14);
  }

  // Floor plane with perspective boards. Converging seams and compressed cross
  // joints make characters/furniture feel grounded in one physical room.
  const floor=ctx.createLinearGradient(0,floorY,0,height);
  floor.addColorStop(0,'#4b3a30');floor.addColorStop(.52,'#352820');floor.addColorStop(1,'#1e1815');
  ctx.fillStyle=floor;ctx.fillRect(0,floorY,width,height-floorY);
  for(const bottomX of [-.10,.08,.25,.42,.59,.76,.93,1.10].map(v=>width*v)){
    curve(ctx,[{x:vanishX,y:floorY},{x:bottomX,y:height}],'#171311',1,.30);
  }
  for(let row=1;row<=4;row++){
    const t=row/4;
    const eased=t*t;
    const y=floorY+(height-floorY)*eased;
    curve(ctx,[{x:0,y},{x:width*.46,y:y+(row%2?1.8:-1.2)},{x:width,y:y+.8}],'#211814',.85,.28);
  }
  ctx.save();ctx.globalAlpha=.12;for(let i=0;i<16;i++){
    const x=rnd(seed,i+700)*width,y=floorY+(height-floorY)*(.08+rnd(seed,i+730)*.84);
    curve(ctx,[{x,y},{x:x+18+rnd(seed,i+760)*48,y:y+(rnd(seed,i+790)-.5)*3}],'#b08361',.6,.7);
  }ctx.restore();

  // Cool night window with a recessed jamb + sill. No desk/bed is baked in:
  // semantic furniture remains independently stageable.
  const wx=width*.075,wy=height*.16,ww=width*.20,wh=height*.285;
  ctx.fillStyle='#191918';ctx.fillRect(wx-9,wy-8,ww+18,wh+17);
  ctx.fillStyle='#1a292f';ctx.strokeStyle='#746d64';ctx.lineWidth=2.2;ctx.fillRect(wx,wy,ww,wh);ctx.strokeRect(wx,wy,ww,wh);
  ctx.fillStyle='#514a43';ctx.fillRect(wx-13,wy+wh+1,ww+27,9);
  curve(ctx,[{x:wx+ww*.5,y:wy},{x:wx+ww*.5,y:wy+wh}],'#616762',1.4,.78);
  curve(ctx,[{x:wx,y:wy+wh*.52},{x:wx+ww,y:wy+wh*.52}],'#616762',1.4,.78);
  // Slightly uneven curtain edge on one side, treated as architecture rather than a moving prop.
  ctx.save();ctx.globalAlpha=.66;ctx.fillStyle='#292927';ctx.strokeStyle='#171817';ctx.lineWidth=.7;
  ctx.beginPath();ctx.moveTo(wx-9,wy-2);ctx.bezierCurveTo(wx+9,wy+wh*.18,wx-1,wy+wh*.64,wx+14,wy+wh+2);
  ctx.lineTo(wx-10,wy+wh+3);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  const moon=ctx.createRadialGradient(wx+ww*.57,wy+wh*.36,2,wx+ww*.57,wy+wh*.36,ww*.82);
  moon.addColorStop(0,'rgba(160,188,191,.17)');moon.addColorStop(1,'rgba(150,177,181,0)');
  ctx.fillStyle=moon;ctx.fillRect(wx-ww*.65,wy-wh*.55,ww*2.25,wh*2.25);
  // Window light falls onto floor as a restrained trapezoid, establishing depth.
  ctx.save();ctx.globalAlpha=.07;ctx.fillStyle='#9bb3b4';
  ctx.beginPath();ctx.moveTo(wx+ww*.18,floorY);ctx.lineTo(wx+ww*.87,floorY);ctx.lineTo(width*.43,height);ctx.lineTo(width*.08,height);ctx.closePath();ctx.fill();ctx.restore();

  // Old conduit + junction point: tiny architectural detail that scales the wall.
  curve(ctx,[{x:width*.68,y:height*.10},{x:width*.68,y:floorY*.58},{x:width*.71,y:floorY*.58}],'#232321',1.4,.52);
  ctx.save();ctx.fillStyle='#4b4741';ctx.strokeStyle='#1d1c1a';ctx.lineWidth=.8;
  ctx.fillRect(width*.705-6,floorY*.58-6,12,12);ctx.strokeRect(width*.705-6,floorY*.58-6,12,12);ctx.restore();

  drawHorrorFinish(ctx,width,height,seed+2100,.70);
}

function drawRoomStiltHouse(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number, daylight = false, timeMs = 0) {
  const seed = seedOf('recurring-stilt-room');

  // Dark timber wall with cool upper ambience and almost-black lower corners.
  const wall = ctx.createLinearGradient(0, 0, 0, height);
  wall.addColorStop(0, daylight ? '#858b83' : '#474d4c');
  wall.addColorStop(.48, daylight ? '#706453' : '#3a332e');
  wall.addColorStop(1, daylight ? '#494136' : '#24201d');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, width, height);

  // Horizontal plank bands + irregular grain.
  ctx.strokeStyle = '#171513';
  ctx.lineWidth = 2;
  for (let row = 1; row < 8; row += 1) {
    const y = height * (.08 + row * .085);
    curve(ctx, [{ x: 0, y }, { x: width * .46, y: y + (row % 2 ? 2 : -1) }, { x: width, y: y + 1 }], '#171513', 1.6, .55);
  }
  for (let i = 0; i < 22; i += 1) {
    const x = rnd(seed, i + 400) * width;
    const y = height * (.12 + rnd(seed, i + 430) * .55);
    curve(ctx, [{ x, y }, { x: x + 24 + rnd(seed, i + 460) * 50, y: y + (rnd(seed, i + 470) - .5) * 5 }], '#725b49', .7, .16);
  }
  ctx.save();
  ctx.globalAlpha = daylight ? .1 : .16;
  ctx.strokeStyle = '#0e0d0c';
  for (let i = 0; i < 16; i += 1) {
    const x = rnd(seed, i + 900) * width;
    const y = height * (.11 + rnd(seed, i + 930) * .48);
    curve(ctx, [{ x, y }, { x: x + 38 + rnd(seed, i + 960) * 70, y: y + (rnd(seed, i + 990) - .5) * 6 }], '#0e0d0c', .7, .35);
  }
  ctx.restore();

  // Heavy roof beams.
  ctx.fillStyle = '#221c18';
  ctx.fillRect(0, height * .08, width, 18);
  ctx.fillRect(width * .18, 0, 18, height * .78);
  ctx.fillRect(width * .79, 0, 22, height * .8);
  ctx.save();
  ctx.translate(width * .51, height * .06);
  ctx.rotate(-.055);
  ctx.fillRect(-width * .55, 0, width * 1.1, 16);
  ctx.restore();

  // Cold window creates a faint rectangular patch, but never brightens the whole room.
  const wx = width * .11;
  const wy = height * .2;
  const ww = width * .16;
  const wh = height * .2;
  ctx.fillStyle = daylight ? '#d6dfda' : '#617078';
  ctx.globalAlpha = daylight ? .9 : .42;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#1d1a17';
  ctx.lineWidth = 5;
  ctx.strokeRect(wx, wy, ww, wh);
  curve(ctx, [{ x: wx + ww / 2, y: wy }, { x: wx + ww / 2, y: wy + wh }], '#1d1a17', 3, .75);
  curve(ctx, [{ x: wx, y: wy + wh / 2 }, { x: wx + ww, y: wy + wh / 2 }], '#1d1a17', 3, .75);

  // Deep doorway / passage as negative space.
  const {x:dx,y:dy,width:dw,height:dh} = canvasEnvironmentDoorway('bg:room-stilt-house',width,height)!;
  ctx.fillStyle = '#050606';
  ctx.fillRect(dx, dy, dw, dh);
  const doorDark = ctx.createRadialGradient(dx + dw*.44, dy + dh*.43, 2, dx + dw*.44, dy + dh*.43, dw*.92);
  doorDark.addColorStop(0, 'rgba(0,0,0,.72)');
  doorDark.addColorStop(.6, 'rgba(0,0,0,.42)');
  doorDark.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = doorDark;
  ctx.fillRect(dx - dw*.42, dy - dh*.16, dw*1.84, dh*1.34);
  ctx.strokeStyle = '#3a3028';
  ctx.lineWidth = 6;
  ctx.strokeRect(dx, dy, dw, dh);
  ctx.fillStyle = 'rgba(70,55,45,.18)';
  ctx.fillRect(dx + dw * .82, dy, dw * .18, dh);

  // Threat shots keep the doorway almost unreadable. A barely separated
  // shoulder/head mass gives the eye something to discover without turning
  // the darkness into a literal ghost icon.
  const threatCue = [scene.name, scene.narration, scene.visualBrief].filter(Boolean).join(' ');
  if (!daylight && /cánh\s*cửa|ngoài\s*cửa|bóng\s*đen|bóng\s*người|doorway|shadow|peek|tiếng\s*động/iu.test(threatCue)) {
    ctx.save();
    ctx.globalAlpha = .82;
    ctx.fillStyle = '#334140';
    ctx.beginPath();
    ctx.ellipse(dx + dw*.62, dy + dh*.33, dw*.084, dh*.095, -.08, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(dx + dw*.535, dy + dh*.415);
    ctx.quadraticCurveTo(dx + dw*.63, dy + dh*.37, dx + dw*.715, dy + dh*.43);
    ctx.lineTo(dx + dw*.75, dy + dh*.79);
    ctx.lineTo(dx + dw*.515, dy + dh*.79);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = .24;
    ctx.strokeStyle = '#71807b';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  // Low plank floor with perspective lines.
  const floorTop = height * .72;
  const floor = ctx.createLinearGradient(0, floorTop, 0, height);
  floor.addColorStop(0, daylight ? '#75604a' : '#4c392e');
  floor.addColorStop(1, daylight ? '#504432' : '#2b231e');
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorTop, width, height - floorTop);
  for (let i = 0; i < 10; i += 1) {
    const x = width * (i / 9);
    curve(ctx, [{ x: width / 2 + (x - width / 2) * .35, y: floorTop }, { x, y: height }], '#171310', 1.4, .5);
  }
  for (let row = 1; row < 4; row += 1) {
    const y = floorTop + (height - floorTop) * row / 4;
    curve(ctx, [{ x: 0, y }, { x: width, y: y + 2 }], '#171310', 1.1, .42);
  }

  // Very restrained warm hearth spill from one side, enough for faces but not a bright room.
  if (daylight) {
    ctx.fillStyle = 'rgba(220,219,182,.12)';
    ctx.beginPath(); ctx.moveTo(wx, wy + wh); ctx.lineTo(wx + ww, wy + wh);
    ctx.lineTo(width * .62, height); ctx.lineTo(width * .24, height); ctx.closePath(); ctx.fill();
  }
  const hearth = scene.objects.find(object => object.kind === 'prop' && (object.variant === 'fire' || object.assetRef === 'prop:fire'));
  if (hearth) {
    ctx.save();
    ctx.globalAlpha *= evaluateObjectKeyframes(hearth.keyframes, timeMs).opacity;
    const hx = hearth.x;
    const hy = hearth.y + hearth.height * .34;
    const glow = ctx.createRadialGradient(hx, hy, 4, hx, hy, width * .24);
    glow.addColorStop(0, 'rgba(181,103,48,.18)');
    glow.addColorStop(.55, 'rgba(154,87,43,.075)');
    glow.addColorStop(1, 'rgba(154,87,43,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    if (!daylight) {
      // Keep one small practical-light pool while the rest of the room falls
      // into black. This is the main tonal difference from the editorial mode.
      const falloff = ctx.createRadialGradient(hx, hy, width*.05, hx, hy, width*.68);
      falloff.addColorStop(0, 'rgba(0,0,0,0)');
      falloff.addColorStop(.48, 'rgba(0,0,0,.08)');
      falloff.addColorStop(1, 'rgba(0,0,0,.48)');
      ctx.fillStyle = falloff;
      ctx.fillRect(0,0,width,height);
    }
    ctx.restore();
  } else if (!daylight) {
    const falloff = ctx.createRadialGradient(width*.42,height*.62,width*.06,width*.42,height*.62,width*.72);
    falloff.addColorStop(0,'rgba(0,0,0,0)');
    falloff.addColorStop(.5,'rgba(0,0,0,.12)');
    falloff.addColorStop(1,'rgba(0,0,0,.5)');
    ctx.fillStyle=falloff;ctx.fillRect(0,0,width,height);
  }
  if (!daylight) {
    ctx.save();
    ctx.globalAlpha=.055;
    ctx.strokeStyle='#c8c1ad';
    ctx.lineWidth=18;
    for(let i=0;i<3;i++){
      const y=height*(.48+i*.09)+Math.sin(timeMs/1200+i)*5;
      ctx.beginPath();ctx.moveTo(width*.22,y);ctx.bezierCurveTo(width*.4,y-16,width*.55,y+12,width*.72,y-5);ctx.stroke();
    }
    ctx.restore();
  }
  drawHorrorFinish(ctx, width, height, seed + 1040, daylight ? .35 : 1.02);
}

function drawRoomFloorDetail(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed = seedOf(scene.backgroundRef || 'floor');
  ctx.fillStyle = '#241d18'; ctx.fillRect(0, 0, width, height);
  const rows = 7;
  const plankHeight = height / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * plankHeight;
    const fill = ctx.createLinearGradient(0, y, 0, y+plankHeight);
    fill.addColorStop(0, row % 2 ? '#514035' : '#47362c');
    fill.addColorStop(1, '#30261f');
    ctx.fillStyle = fill; ctx.fillRect(0, y+3, width, plankHeight-6);
    for (let grain = 0; grain < 18; grain++) {
      const gx = rnd(seed, row*100+grain)*width;
      const gy = y + 8 + rnd(seed, row*100+grain+40)*(plankHeight-16);
      curve(ctx, [{x:gx,y:gy},{x:gx+45,y:gy-3},{x:gx+110,y:gy+1}], '#967456', .7, .2);
    }
    for (const x of [width*.06, width*.93]) {
      ctx.fillStyle = '#151411'; ctx.beginPath(); ctx.ellipse(x,y+plankHeight*.5,2.5,3,0,0,Math.PI*2); ctx.fill();
    }
  }
  // Light grazes the surface; deep seams and a small scratch are the focal clue.
  const light = ctx.createRadialGradient(width*.48,height*.38,0,width*.48,height*.38,width*.68);
  light.addColorStop(0,'rgba(193,142,74,.13)');
  light.addColorStop(.42,'rgba(126,83,45,.055)');
  light.addColorStop(1,'rgba(0,0,0,.56)');
  ctx.fillStyle = light; ctx.fillRect(0,0,width,height);
  const graze = ctx.createLinearGradient(0,height*.52,width,height*.62);
  graze.addColorStop(0,'rgba(0,0,0,0)');
  graze.addColorStop(.42,'rgba(209,161,93,.035)');
  graze.addColorStop(.68,'rgba(209,161,93,.075)');
  graze.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=graze;ctx.fillRect(0,height*.34,width,height*.36);
  for (let i=0;i<3;i++) curve(ctx,[{x:width*.54+i*11,y:height*.43},{x:width*.55+i*11,y:height*.54},{x:width*.59+i*11,y:height*.6}], '#997b5c', 1.2, .5);
  drawHorrorFinish(ctx, width, height, seed + 90, .72);
}

function drawRoomUnderfloor(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);

  const dark = ctx.createLinearGradient(0, 0, 0, height);
  dark.addColorStop(0, '#211b18');
  dark.addColorStop(.42, '#111313');
  dark.addColorStop(1, '#080a0a');
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, width, height);

  // Make the geography unmistakable: this is the underside of a raised stilt
  // house, not another dark room. Keep the floor overhead compact and let the
  // supporting posts visibly descend all the way into bare earth.
  const floorBottom = height * .255;
  ctx.fillStyle = '#4b382e';
  ctx.fillRect(0, 0, width, floorBottom);
  for (let row = 0; row < 5; row += 1) {
    const y = row * floorBottom / 5;
    ctx.fillStyle = row % 2 ? '#49362d' : '#543d31';
    ctx.fillRect(0, y, width, floorBottom / 5 + 1);
    curve(ctx, [{x:0,y:y+floorBottom/5-2},{x:width*.44,y:y+floorBottom/5},{x:width,y:y+floorBottom/5-1}], '#171310', 2, .75);
    for (let grain = 0; grain < 6; grain += 1) {
      const x = rnd(seed, row * 20 + grain) * width;
      curve(ctx, [
        {x, y:y + 8 + rnd(seed, row * 40 + grain) * (floorBottom / 5 - 16)},
        {x:x + 45 + rnd(seed, row * 60 + grain) * 85, y:y + 9 + rnd(seed, row * 80 + grain) * (floorBottom / 5 - 18)},
      ], '#7e5c47', .75, .2);
    }
  }

  // One deep irregular seam is a strong visual target for knocks/scratches.
  pathUnderfloorGap(ctx, width, floorBottom);

  // Structural beams and stilts create real depth instead of a generic dark box.
  // A thick sill plus visible joists under the planks reads immediately as an
  // elevated floor seen from below.
  ctx.fillStyle = '#211914';
  ctx.fillRect(0, floorBottom - 10, width, 30);
  ctx.fillStyle = '#3a2a22';
  for (const x of [width*.08,width*.29,width*.52,width*.76,width*.94]) {
    ctx.save();
    ctx.translate(x, floorBottom - 2);
    ctx.rotate(-.055 + x / width * .11);
    ctx.fillRect(-8, -floorBottom*.18, 16, floorBottom*.28);
    ctx.restore();
  }
  const posts = [width*.14, width*.40, width*.68, width*.88];
  for (let index = 0; index < posts.length; index += 1) {
    const x = posts[index]!;
    const lean = (rnd(seed, index + 220) - .5) * 10;
    ctx.save();
    ctx.translate(x, floorBottom);
    ctx.rotate(lean / 180 * Math.PI);
    const post = ctx.createLinearGradient(-10, 0, 12, 0);
    post.addColorStop(0, '#211915');
    post.addColorStop(.5, '#4a362b');
    post.addColorStop(1, '#211915');
    ctx.fillStyle = post;
    ctx.fillRect(-11, 0, 22, height * .55);
    ctx.restore();
  }

  // Diagonal bracing is characteristic of a raised stilt-house undercroft and
  // prevents this view from reading as an ordinary interior corridor.
  ctx.save();
  ctx.strokeStyle='#34271f';ctx.lineWidth=9;ctx.globalAlpha=.82;
  ctx.beginPath();ctx.moveTo(width*.16,floorBottom+22);ctx.lineTo(width*.37,height*.72);ctx.stroke();
  ctx.beginPath();ctx.moveTo(width*.37,floorBottom+22);ctx.lineTo(width*.17,height*.72);ctx.stroke();
  ctx.beginPath();ctx.moveTo(width*.69,floorBottom+24);ctx.lineTo(width*.86,height*.7);ctx.stroke();
  ctx.restore();

  // A simple stair/ladder rising from the earth to the floor edge makes the
  // vertical relationship explicit: the room is above us, the camera is below.
  ctx.save();
  ctx.strokeStyle='#4a3529';ctx.lineWidth=7;ctx.lineCap='round';
  const stairX=width*.92, stairBottomY=height*.78, stairTopY=floorBottom+4;
  ctx.beginPath();ctx.moveTo(stairX-42,stairBottomY);ctx.lineTo(stairX,stairTopY);ctx.stroke();
  ctx.beginPath();ctx.moveTo(stairX+12,stairBottomY);ctx.lineTo(stairX+50,stairTopY);ctx.stroke();
  ctx.lineWidth=4;
  for(let i=0;i<6;i+=1){
    const t=i/5,y=stairBottomY+(stairTopY-stairBottomY)*t;
    const lx=(stairX-42)+(42)*t,rx=(stairX+12)+(38)*t;
    ctx.beginPath();ctx.moveTo(lx,y);ctx.lineTo(rx,y);ctx.stroke();
  }
  ctx.restore();

  // Bare earth is a strong spatial cue: uneven soil, post feet and a shallow
  // damp patch distinguish the crawlspace from an interior room.
  const groundY = height * .79;
  ctx.fillStyle = '#1b1713';
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.bezierCurveTo(width*.24, groundY-10, width*.43, groundY+9, width*.62, groundY-4);
  ctx.bezierCurveTo(width*.79, groundY-13, width*.91, groundY+4, width, groundY-6);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalAlpha=.5;
  ctx.strokeStyle='#3f3429';ctx.lineWidth=2;
  for(const x of posts){
    ctx.beginPath();ctx.ellipse(x,groundY-2,28,7,0,0,Math.PI*2);ctx.stroke();
  }
  ctx.fillStyle='rgba(67,81,76,.26)';
  ctx.beginPath();ctx.ellipse(width*.55,groundY+18,width*.16,10,-.03,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='rgba(112,133,125,.22)';ctx.lineWidth=1.2;
  for(const x of [width*.09,width*.23,width*.82,width*.93]){
    ctx.beginPath();ctx.moveTo(x,groundY+8);ctx.lineTo(x-5,groundY-12);ctx.moveTo(x,groundY+8);ctx.lineTo(x+7,groundY-9);ctx.stroke();
  }
  ctx.restore();

  // Tiny warm leaks through plank seams; enough to reveal dust without making
  // the crawlspace readable all at once.
  ctx.save();
  ctx.globalAlpha = .17;
  ctx.strokeStyle = '#d39a5c';
  for (const x of [width*.26, width*.53, width*.74]) {
    ctx.beginPath();
    ctx.moveTo(x, floorBottom - 6);
    ctx.lineTo(x + 18, floorBottom + height*.24);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = .24;
  ctx.fillStyle = '#b6a485';
  for (let i = 0; i < 36; i += 1) {
    const x = rnd(seed, i + 300) * width;
    const y = floorBottom + rnd(seed, i + 350) * (groundY - floorBottom);
    const radius = .5 + rnd(seed, i + 400) * 1.4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // A tiny cool separation on the far-right rear plane lets a shadow figure
  // become discoverable late in the shot while preserving the dominant black.
  if (scene.objects.some(object => object.variant === 'ghost')) {
    const reveal = ctx.createRadialGradient(width*.5, height*.55, 2, width*.5, height*.55, width*.23);
    reveal.addColorStop(0, 'rgba(105,128,125,.29)');
    reveal.addColorStop(.42, 'rgba(74,92,91,.14)');
    reveal.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = reveal;
    ctx.fillRect(width*.28, floorBottom, width*.5, groundY-floorBottom);
  }
  drawHorrorFinish(ctx, width, height, seed + 520, 1.08);
}

function pathUnderfloorGap(ctx: CanvasRenderingContext2D, width: number, floorBottom: number) {
  ctx.save();
  ctx.fillStyle = '#050606';
  ctx.beginPath();
  ctx.moveTo(width*.08, floorBottom*.55);
  ctx.bezierCurveTo(width*.25, floorBottom*.49, width*.38, floorBottom*.61, width*.53, floorBottom*.54);
  ctx.bezierCurveTo(width*.7, floorBottom*.47, width*.82, floorBottom*.58, width*.94, floorBottom*.5);
  ctx.lineTo(width*.94, floorBottom*.59);
  ctx.bezierCurveTo(width*.77, floorBottom*.66, width*.64, floorBottom*.57, width*.5, floorBottom*.64);
  ctx.bezierCurveTo(width*.35, floorBottom*.7, width*.21, floorBottom*.59, width*.08, floorBottom*.65);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRoomStudy(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed=seedOf(scene.visualBrief||scene.name);
  ctx.fillStyle = '#e9dfd0';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#b89977';
  ctx.fillRect(0, height * .79, width, height * .21);
  curve(ctx, [{x:0,y:height*.79},{x:width,y:height*.79}], '#8d715a', 2);

  // Window + curtain + light spill.
  ctx.fillStyle='#d5e1dd';ctx.strokeStyle='#8e795f';ctx.lineWidth=2;
  ctx.fillRect(width*.1,height*.2,width*.18,height*.25);ctx.strokeRect(width*.1,height*.2,width*.18,height*.25);
  curve(ctx,[{x:width*.19,y:height*.2},{x:width*.19,y:height*.45}],'#9c8973',1,.55);
  curve(ctx,[{x:width*.1,y:height*.325},{x:width*.28,y:height*.325}],'#9c8973',1,.55);
  ctx.save();ctx.globalAlpha=.12;ctx.fillStyle='#f5edcf';
  ctx.beginPath();ctx.moveTo(width*.1,height*.45);ctx.lineTo(width*.37,height*.79);ctx.lineTo(width*.57,height*.79);ctx.lineTo(width*.28,height*.45);ctx.closePath();ctx.fill();ctx.restore();

  // Background furniture is only a fallback. If the semantic scene owns a
  // table/desk prop, do not bake a second desk into the environment.
  const semanticTable=scene.objects.some(object=>object.kind==='prop'&&object.variant==='table');
  if(!semanticTable){
    ctx.fillStyle = '#9a7659';
    ctx.fillRect(width * .08, height * .59, width * .28, 18);
    ctx.fillRect(width * .1, height * .61, 12, height * .18);
    ctx.fillRect(width * .31, height * .61, 12, height * .18);
    ctx.fillStyle='#d7c5a3';ctx.fillRect(width*.17,height*.555,width*.08,10);
    ctx.strokeStyle='#75634f';ctx.strokeRect(width*.17,height*.555,width*.08,10);
    ctx.fillStyle='#62564f';ctx.fillRect(width*.285,height*.55,12,17);
    curve(ctx,[{x:width*.29,y:height*.55},{x:width*.305,y:height*.515}],'#4f4741',2,.75);
  }

  // Framed wall art.
  ctx.fillStyle = '#d8c9ad';ctx.strokeStyle = '#8e795f';ctx.lineWidth = 2;
  ctx.fillRect(width * .38, height * .18, width * .13, height * .16);ctx.strokeRect(width * .38, height * .18, width * .13, height * .16);
  curve(ctx,[{x:width*.395,y:height*.3},{x:width*.43,y:height*.23},{x:width*.49,y:height*.29}],'#8b765f',1.3,.5);

  // Book shelf with varied books.
  ctx.fillStyle = '#7b6959';ctx.fillRect(width * .76, height * .2, width * .15, height * .59);
  for (let i = 0; i < 4; i += 1) {
    const shelfY=height*(.31+i*.115);
    curve(ctx,[{x:width*.77,y:shelfY},{x:width*.9,y:shelfY}],'#bda686',2,.65);
    for(let b=0;b<5;b++){
      const bx=width*.78+b*18, bh=18+rnd(seed,i*10+b)*16;
      ctx.fillStyle=['#8b5f50','#6d7b72','#b18b62','#5e6f78'][b%4]!;
      ctx.fillRect(bx,shelfY-bh,10,bh);
    }
  }
  if(scene.atmosphere?.timeOfDay==='night'){
    ctx.save();ctx.fillStyle='rgba(15,21,22,.55)';ctx.fillRect(0,0,width,height);
    const moon=ctx.createRadialGradient(width*.19,height*.31,4,width*.19,height*.31,width*.26);
    moon.addColorStop(0,'rgba(126,161,170,.11)');moon.addColorStop(1,'rgba(126,161,170,0)');
    ctx.fillStyle=moon;ctx.fillRect(0,0,width*.5,height*.72);ctx.restore();
    drawHorrorFinish(ctx,width,height,seed+1600,.58);
  }
}

function drawPaperEditorial(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed=seedOf(scene.visualBrief||scene.name);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.strokeStyle = '#baa995';ctx.globalAlpha = .22;ctx.lineWidth = 1;
  for (let y = 48; y < height; y += 44) curve(ctx, [{x:0,y},{x:width*.5,y:y+1},{x:width,y:y-.5}], '#baa995', 1, .5);
  ctx.restore();
  drawPaperGrain(ctx,width,height,seed,.055);
  ctx.fillStyle = '#d8cbb9';
  ctx.beginPath();ctx.ellipse(width * .13, height * .83, width * .19, height * .08, -.1, 0, Math.PI * 2);ctx.fill();
  // Hand-drawn marginal marks keep diagram scenes editorial rather than sterile.
  curve(ctx,[{x:width*.05,y:height*.16},{x:width*.08,y:height*.13},{x:width*.1,y:height*.16}],'#a18e76',1.2,.38);
  curve(ctx,[{x:width*.88,y:height*.78},{x:width*.92,y:height*.81},{x:width*.95,y:height*.78}],'#a18e76',1.2,.32);
}

function drawUnderwaterStakes(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);
  const water = ctx.createLinearGradient(0, 0, 0, height);
  water.addColorStop(0, '#85aeb0');
  water.addColorStop(.45, '#5e878d');
  water.addColorStop(1, '#31545a');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = 'rgba(235,247,244,.13)';
  for (let i = 0; i < 6; i += 1) {
    ctx.beginPath();
    ctx.moveTo(width * (i / 6), 0);
    ctx.lineTo(width * (i / 6 + .08), 0);
    ctx.lineTo(width * (i / 6 + .16), height * .58);
    ctx.lineTo(width * (i / 6 + .07), height * .58);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Moving-light style caustic ribbons.
  for(let row=0;row<4;row++){
    const y=height*(.18+row*.11);
    for(let col=0;col<6;col++){
      const x=width*(.04+col*.17)+(rnd(seed,row*20+col)-.5)*30;
      curve(ctx,[
        {x,y},
        {x:x+34,y:y-5},
        {x:x+75,y:y+3},
      ],'#d7eeeb',1.2,.16);
    }
  }

  ctx.fillStyle = '#625e50';
  ctx.beginPath();
  ctx.moveTo(0, height * .84);
  ctx.bezierCurveTo(width * .24, height * .8, width * .45, height * .9, width * .66, height * .84);
  ctx.bezierCurveTo(width * .83, height * .8, width * .92, height * .87, width, height * .82);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 18; i += 1) {
    const x = rnd(seed, i + 1) * width;
    const y = height * (.15 + rnd(seed, i + 30) * .56);
    const r = 2 + rnd(seed, i + 60) * 7;
    ctx.strokeStyle = 'rgba(229,243,241,.28)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Distant stake silhouettes and suspended silt add depth before focal stakes.
  ctx.save();ctx.globalAlpha=.35;ctx.fillStyle='#4f4338';
  for(let i=0;i<10;i++){
    const x=width*(.05+i*.095)+(rnd(seed,i+150)-.5)*18;
    const h=height*(.14+rnd(seed,i+170)*.13);
    ctx.save();ctx.translate(x,height*.82);ctx.rotate((rnd(seed,i+190)-.5)*.18);
    ctx.beginPath();ctx.moveTo(-4,0);ctx.lineTo(-3,-h*.72);ctx.lineTo(0,-h);ctx.lineTo(4,-h*.72);ctx.lineTo(5,0);ctx.closePath();ctx.fill();ctx.restore();
  }
  ctx.restore();
  ctx.save();ctx.globalAlpha=.18;ctx.fillStyle='#d7e5df';
  for(let i=0;i<60;i++){
    const x=rnd(seed,i+220)*width,y=height*(.42+rnd(seed,i+300)*.5);
    ctx.beginPath();ctx.arc(x,y,.5+rnd(seed,i+380)*1.5,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

function drawMapTactical(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  drawPaperEditorial(ctx, scene, width, height);
  ctx.fillStyle = '#c8b993';
  ctx.strokeStyle = '#79684f';
  ctx.lineWidth = 2.2;
  const islands: Array<[number, number, number, number]> = [
    [width*.3,height*.46,width*.26,height*.26],
    [width*.7,height*.53,width*.31,height*.23],
  ];
  islands.forEach(([x,y,rx,ry], i) => {
    ctx.beginPath();
    ctx.moveTo(x-rx*.5,y);
    ctx.bezierCurveTo(x-rx*.34,y-ry*.55,x+rx*.08,y-ry*.5,x+rx*.37,y-ry*.2);
    ctx.bezierCurveTo(x+rx*.58,y+ry*.05,x+rx*.25,y+ry*.5,x-rx*.04,y+ry*.34);
    ctx.bezierCurveTo(x-rx*.34,y+ry*.46,x-rx*.6,y+ry*.16,x-rx*.5,y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (i === 0) curve(ctx,[{x:x-rx*.12,y:y+ry*.05},{x:x+rx*.1,y:y-ry*.08},{x:x+rx*.3,y:y+ry*.04}],'#97624c',2,.55);
    // Topographic contour accents.
    for(let ring=1;ring<=2;ring++){
      ctx.save();ctx.globalAlpha=.22;ctx.strokeStyle='#76654f';ctx.lineWidth=1;
      ctx.beginPath();ctx.ellipse(x,y,rx*(.18+.12*ring),ry*(.12+.09*ring),-.12,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
  });
  drawPaperGrain(ctx,width,height,seedOf(scene.visualBrief||scene.name)+700,.04);
}

type SpecTone = { top: string; bottom: string; ridges: [string, string, string]; ground: string };
const SPEC_TONES: Record<CanvasBackgroundSpec['sky'], SpecTone> = {
  night: { top: '#101d27', bottom: '#34473f', ridges: ['#1d2e2e', '#233629', '#2a3d30'], ground: '#2f3d33' },
  dusk: { top: '#2b3045', bottom: '#a46a50', ridges: ['#4a4a5a', '#3e4a47', '#33443a'], ground: '#4b4a3a' },
  dawn: { top: '#3c4b5b', bottom: '#cbaa8b', ridges: ['#6a7580', '#566a67', '#455a4d'], ground: '#5a6046' },
  overcast: { top: '#59666b', bottom: '#a7ada5', ridges: ['#7d8a86', '#697a73', '#586b5e'], ground: '#5f6a56' },
  day: { top: '#a8c5c8', bottom: '#e4e0ca', ridges: ['#7d9a85', '#6a8a72', '#587a60'], ground: '#7f8f5a' },
};

function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(255,201,120,${alpha})`);
  g.addColorStop(1, 'rgba(255,201,120,0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function rectInk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, ink: string) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
}

function polyInk(ctx: CanvasRenderingContext2D, points: Array<[number, number]>, fill: string, ink: string) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** One structure in local units (baseline y=0, ~240 wide) so every building scales and sits on the ground the same way. */
function drawSpecStructure(
  ctx: CanvasRenderingContext2D,
  structure: CanvasSpecStructure,
  width: number,
  height: number,
  groundY: number,
  wood: string,
  roof: string,
  ink: string,
  timeMs: number,
  index: number,
) {
  const k = (structure.scale ?? 1) * (height / 720);
  const flicker = .55 + .1 * Math.sin(timeMs / 190 + index * 1.7);
  ctx.save();
  ctx.translate(width * structure.x, groundY + 4 * index);
  ctx.scale(k, k);
  switch (structure.kind) {
    case 'stilt-house':
      for (const px of [-95, -45, 45, 95]) rectInk(ctx, px - 4, -70, 8, 70, wood, ink);
      rectInk(ctx, -120, -80, 240, 10, wood, ink);
      rectInk(ctx, -105, -170, 210, 90, wood, ink);
      polyInk(ctx, [[-140, -165], [-60, -240], [60, -240], [140, -165]], roof, ink);
      rectInk(ctx, -20, -150, 40, 70, '#120e0c', ink);
      rectInk(ctx, 56, -146, 28, 26, structure.lit ? '#d9a95f' : '#1a1512', ink);
      for (let step = 0; step < 4; step += 1) rectInk(ctx, -118 + step * 6, -step * 18, 26, 5, wood, ink);
      if (structure.lit) glow(ctx, 70, -133, 130, flicker);
      break;
    case 'ground-house':
      rectInk(ctx, -100, -120, 200, 120, wood, ink);
      polyInk(ctx, [[-125, -115], [-55, -185], [55, -185], [125, -115]], roof, ink);
      rectInk(ctx, -18, -90, 36, 90, '#120e0c', ink);
      rectInk(ctx, 48, -92, 26, 24, structure.lit ? '#d9a95f' : '#1a1512', ink);
      if (structure.lit) glow(ctx, 60, -80, 120, flicker);
      break;
    case 'shrine':
      rectInk(ctx, -44, -12, 88, 12, '#6f6a60', ink);
      rectInk(ctx, -30, -82, 6, 70, '#5a2f27', ink);
      rectInk(ctx, 24, -82, 6, 70, '#5a2f27', ink);
      ctx.fillStyle = roof; ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-52, -78); ctx.quadraticCurveTo(0, -122, 52, -78); ctx.lineTo(42, -68); ctx.quadraticCurveTo(0, -100, -42, -68); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = structure.lit ? '#e0813f' : '#7a3a2a'; ctx.beginPath(); ctx.arc(0, -30, 3, 0, Math.PI * 2); ctx.fill();
      if (structure.lit) glow(ctx, 0, -30, 80, flicker);
      break;
    case 'village-gate':
      rectInk(ctx, -82, -140, 10, 140, wood, ink);
      rectInk(ctx, 72, -140, 10, 140, wood, ink);
      rectInk(ctx, -96, -152, 192, 12, wood, ink);
      polyInk(ctx, [[-104, -150], [-70, -178], [70, -178], [104, -150]], roof, ink);
      if (structure.lit) glow(ctx, 0, -100, 90, flicker * .8);
      break;
    case 'well':
      rectInk(ctx, -34, -22, 68, 22, '#6f6a60', ink);
      ctx.fillStyle = '#0d0f10'; ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -22, 34, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      rectInk(ctx, -30, -84, 5, 62, wood, ink);
      rectInk(ctx, 25, -84, 5, 62, wood, ink);
      rectInk(ctx, -36, -90, 72, 7, wood, ink);
      break;
    case 'grave-mound':
      ctx.fillStyle = '#4a4034'; ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -10, 72, 22, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      rectInk(ctx, -4, -76, 8, 66, wood, ink);
      rectInk(ctx, -18, -66, 36, 6, wood, ink);
      break;
    case 'fence':
      for (let i = 0; i < 8; i += 1) rectInk(ctx, -112 + i * 32, -62, 6, 62, wood, ink);
      rectInk(ctx, -112, -48, 230, 5, wood, ink);
      rectInk(ctx, -112, -26, 230, 5, wood, ink);
      break;
    case 'buffalo-shed':
      rectInk(ctx, -90, -92, 7, 92, wood, ink);
      rectInk(ctx, 80, -92, 7, 92, wood, ink);
      rectInk(ctx, -82, -88, 160, 88, '#0f0c0a', ink);
      polyInk(ctx, [[-112, -84], [100, -112], [104, -94], [-112, -68]], roof, ink);
      if (structure.lit) glow(ctx, 0, -50, 90, flicker * .7);
      break;
    case 'footbridge':
      for (let i = 0; i < 9; i += 1) rectInk(ctx, -100 + i * 22, -26 - Math.sin((i / 8) * Math.PI) * 16, 18, 6, wood, ink);
      ctx.strokeStyle = ink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-100, -62); ctx.quadraticCurveTo(0, -92, 100, -62); ctx.stroke();
      break;
    case 'altar-table':
      rectInk(ctx, -62, -62, 124, 8, wood, ink);
      rectInk(ctx, -54, -54, 7, 54, wood, ink);
      rectInk(ctx, 47, -54, 7, 54, wood, ink);
      rectInk(ctx, -34, -84, 7, 22, '#cdbf9f', ink);
      rectInk(ctx, 27, -84, 7, 22, '#cdbf9f', ink);
      ctx.fillStyle = '#6b5a45'; ctx.strokeStyle = ink; ctx.beginPath(); ctx.ellipse(0, -68, 14, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      glow(ctx, 0, -80, 100, structure.lit === false ? .2 : flicker);
      break;
  }
  ctx.restore();
}

/** Draws a never-before-seen location from the Director's layered spec using shared canvas building blocks. */
function drawComposedBackground(
  ctx: CanvasRenderingContext2D,
  scene: CanvasStudioScene,
  width: number,
  height: number,
  timeMs: number,
) {
  const spec = scene.backgroundSpec;
  if (!spec) return false;
  const seed = seedOf(`${scene.name}|${JSON.stringify(spec)}`);
  const tone = SPEC_TONES[spec.sky];
  const dark = spec.sky === 'night' ? .5 : spec.sky === 'dusk' ? .3 : spec.sky === 'dawn' ? .2 : spec.sky === 'overcast' ? .12 : 0;
  const groundY = height * (spec.ground === 'water-edge' ? .72 : .7);
  const wood = mixHex('#6a5240', tone.top, dark);
  const roof = mixHex('#3a322b', tone.top, dark * .8);
  const ink = '#1f1a17';

  const sky = ctx.createLinearGradient(0, 0, 0, height * .75);
  sky.addColorStop(0, tone.top);
  sky.addColorStop(1, tone.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  if (spec.moon) {
    glow(ctx, width * .78, height * .16, height * .22, .22);
    ctx.fillStyle = '#efe6c8';
    ctx.beginPath(); ctx.arc(width * .78, height * .16, height * .045, 0, Math.PI * 2); ctx.fill();
  }
  if (spec.sky === 'overcast' || spec.sky === 'day') drawCloudBand(ctx, width, height, seed, height * .2, .3);

  const ridges = Math.max(0, Math.min(3, Math.round(spec.ridges ?? 1)));
  for (let i = 0; i < ridges; i += 1) fillBezierLand(ctx, width, height, height * (.5 + i * .07), tone.ridges[i]!, height * (.2 - i * .03), seed + i);

  const groundBase = spec.ground === 'rice-field' ? mixHex(tone.ground, '#7a8a48', .45)
    : spec.ground === 'mud' ? mixHex(tone.ground, '#4a3b2c', .55)
    : spec.ground === 'stone-yard' ? mixHex(tone.ground, '#77736a', .5)
    : spec.ground === 'water-edge' ? mixHex(tone.ground, '#2d4a50', .6)
    : tone.ground;
  ctx.fillStyle = groundBase;
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.save(); ctx.globalAlpha = .28; ctx.fillStyle = '#000000'; ctx.fillRect(0, height * .9, width, height * .1); ctx.restore();

  if (spec.ground === 'dirt-path') {
    ctx.fillStyle = mixHex('#7a6a52', tone.top, dark * .7);
    ctx.beginPath(); ctx.moveTo(width * .35, groundY); ctx.bezierCurveTo(width * .45, height * .8, width * .2, height * .9, width * .1, height);
    ctx.lineTo(width * .62, height); ctx.bezierCurveTo(width * .6, height * .86, width * .52, height * .8, width * .55, groundY); ctx.closePath(); ctx.fill();
  } else if (spec.ground === 'rice-field') {
    for (let row = 0; row < 6; row += 1) curve(ctx, [{ x: 0, y: groundY + row * height * .045 }, { x: width * .5, y: groundY + row * height * .045 - 8 }, { x: width, y: groundY + row * height * .045 + 4 }], '#4f6538', 2, .55);
  } else if (spec.ground === 'stone-yard') {
    for (let i = 0; i < 24; i += 1) {
      ctx.save(); ctx.globalAlpha = .3; ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
      ctx.strokeRect(rnd(seed, i + 3) * width, groundY + rnd(seed, i + 40) * (height - groundY - 20), 50 + rnd(seed, i + 70) * 40, 24);
      ctx.restore();
    }
  } else if (spec.ground === 'mud') {
    ctx.save(); ctx.globalAlpha = .35; ctx.fillStyle = '#1f2a2c';
    for (let i = 0; i < 4; i += 1) { ctx.beginPath(); ctx.ellipse(width * (.15 + i * .22), height * (.84 + rnd(seed, i + 5) * .08), width * .06, height * .018, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  } else if (spec.ground === 'water-edge') {
    for (let row = 0; row < 5; row += 1) curve(ctx, [{ x: 0, y: groundY + 12 + row * height * .05 }, { x: width * .5, y: groundY + 6 + row * height * .05 + Math.sin(timeMs / 700 + row) * 3 }, { x: width, y: groundY + 12 + row * height * .05 }], '#8fb0b3', 1.5, .3);
  }

  const treeCount = Math.max(0, Math.min(8, Math.round(spec.trees ?? 2)));
  for (let i = 0; i < treeCount; i += 1) drawBackgroundTree(ctx, width * (.04 + ((i + rnd(seed, i + 60) * .6) / Math.max(1, treeCount)) * .92), groundY + rnd(seed, i + 90) * 14, 2.2 + rnd(seed, i + 120) * 2, seed + i, .85);

  const structures = [...(spec.structures || [])].sort((a, b) => (a.scale ?? 1) - (b.scale ?? 1));
  structures.forEach((structure, index) => drawSpecStructure(ctx, structure, width, height, groundY, wood, roof, ink, timeMs, index));

  if (spec.lampX !== undefined) glow(ctx, width * spec.lampX, groundY + 8, height * .2, .5 + .08 * Math.sin(timeMs / 210));
  const fog = Math.max(0, Math.min(1, spec.fog ?? .25));
  for (let band = 0; band < 3 && fog > .02; band += 1) {
    const y = groundY - 18 + band * height * .05;
    const g = ctx.createLinearGradient(0, y - 30, 0, y + 30);
    g.addColorStop(0, 'rgba(210,220,215,0)');
    g.addColorStop(.5, `rgba(210,220,215,${fog * .22})`);
    g.addColorStop(1, 'rgba(210,220,215,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 30, width, 60);
  }
  const tint = spec.palette === 'warm' ? 'rgba(130,75,30,.12)' : spec.palette === 'ash' ? 'rgba(150,150,150,.14)' : 'rgba(20,60,80,.10)';
  ctx.save(); ctx.fillStyle = tint; ctx.fillRect(0, 0, width, height); ctx.restore();
  if (dark > 0) drawHorrorFinish(ctx, width, height, seed, spec.sky === 'night' ? 1 : .7);
  else drawPaperGrain(ctx, width, height, seed, .05);
  return true;
}

export function drawAuthoredBackground(
  ctx: CanvasRenderingContext2D,
  scene: CanvasStudioScene,
  width: number,
  height: number,
  timeMs = 0,
) {
  timeMs += scene.atmosphere?.timeOffsetMs || 0;
  switch (scene.backgroundRef) {
    case 'bg:composed':
      return drawComposedBackground(ctx, scene, width, height, timeMs);
    case 'bg:night-hill-path':
      drawNightHillPath(ctx,scene,width,height);return true;
    case 'bg:night-rescue-banks':
      drawNightRescueBanks(ctx,scene,width,height,timeMs);return true;
    case 'bg:river-establishing':
      drawRiverEstablishing(ctx, scene, width, height, timeMs); return true;
    case 'bg:river-shoreline':
      drawRiverShoreline(ctx, scene, width, height, false, timeMs); return true;
    case 'bg:night-river-shoreline':
      drawRiverShoreline(ctx, scene, width, height, true, timeMs); return true;
    case 'bg:river-pov':
      drawRiverPov(ctx, scene, width, height, timeMs); return true;
    case 'bg:night-river':
      drawNightRiver(ctx, scene, width, height, timeMs); return true;
    case 'bg:night-stilt-house':
      drawNightStiltHouse(ctx, scene, width, height); return true;
    case 'bg:field-open':
      drawFieldOpen(ctx, scene, width, height); return true;
    case 'bg:field-camp':
      drawFieldCamp(ctx, scene, width, height); return true;
    case 'bg:city-street':
      drawCityStreet(ctx, scene, width, height); return true;
    case 'bg:city-alley-night':
      drawCityAlleyNight(ctx, scene, width, height); return true;
    case 'bg:city-close':
      drawCityClose(ctx, scene, width, height); return true;
    case 'bg:city-hallway':
      drawCityHallway(ctx, scene, width, height); return true;
    case 'bg:room-study':
      drawRoomStudy(ctx, scene, width, height); return true;
    case 'bg:room-simple-night':
      drawRoomSimpleNight(ctx, scene, width, height); return true;
    case 'bg:room-stilt-house':
      drawRoomStiltHouse(ctx, scene, width, height, false, timeMs); return true;
    case 'bg:room-stilt-day':
      drawRoomStiltHouse(ctx, scene, width, height, true, timeMs); return true;
    case 'bg:room-underfloor':
      drawRoomUnderfloor(ctx, scene, width, height); return true;
    case 'bg:room-floor-detail':
      drawRoomFloorDetail(ctx, scene, width, height); return true;
    case 'bg:paper-editorial':
      drawPaperEditorial(ctx, scene, width, height); return true;
    case 'bg:underwater-stakes':
      drawUnderwaterStakes(ctx, scene, width, height); return true;
    case 'bg:map-tactical':
      drawMapTactical(ctx, scene, width, height); return true;
    default:
      return false;
  }
}

function drawNightHillPath(ctx:CanvasRenderingContext2D,scene:CanvasStudioScene,width:number,height:number) {
  const seed=seedOf(scene.backgroundRef||'hill');
  const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,'#172832');sky.addColorStop(1,'#42524c');
  ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
  fillBezierLand(ctx,width,height,height*.6,'#293d36',height*.25,seed);
  fillBezierLand(ctx,width,height,height*.8,'#394438',height*.14,seed+1);
  ctx.fillStyle='#695d4b';ctx.beginPath();ctx.moveTo(0,height*.87);ctx.bezierCurveTo(width*.3,height*.68,width*.7,height*.78,width,height*.83);
  ctx.lineTo(width,height);ctx.lineTo(0,height);ctx.fill();
  for(const [x,y,size] of [[.05,.78,5],[.93,.81,5],[.71,.77,2.5]])drawBackgroundTree(ctx,width*x!,height*y!,size!,seed);
  drawReeds(ctx,0,height*.98,width,height*.09,seed,28,.4);
}

function drawNightRescueBanks(ctx:CanvasRenderingContext2D,scene:CanvasStudioScene,width:number,height:number,timeMs:number) {
  drawNightRiver(ctx,scene,width,height,timeMs);
  // Two disconnected shores: actors must never walk across the channel.
  ctx.fillStyle='#38443c';ctx.strokeStyle='#263630';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(0,height*.62);ctx.quadraticCurveTo(width*.13,height*.59,width*.25,height*.85);
  ctx.lineTo(width*.28,height);ctx.lineTo(0,height);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.moveTo(width,height*.54);ctx.quadraticCurveTo(width*.76,height*.56,width*.6,height*.76);
  ctx.lineTo(width*.56,height);ctx.lineTo(width,height);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#64706a';ctx.beginPath();ctx.ellipse(width*.78,height*.86,width*.12,height*.055,0,0,Math.PI*2);ctx.fill();
  drawBackgroundTree(ctx,width*.95,height*.74,3,77);
  drawReeds(ctx,width*.86,height*.99,width*.14,height*.11,68,14,.5);
}
