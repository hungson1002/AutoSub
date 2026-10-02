import type { CanvasStudioScene } from './types';
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
  const shoreActors=scene.objects.some(o=>o.kind==='character'&&o.appearance!=='water-spirit'&&!o.onBoat&&o.waterlineY===undefined);
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
  ctx.fillStyle = '#080909';
  ctx.fillRect(dx, dy, dw, dh);
  ctx.strokeStyle = '#4b3c31';
  ctx.lineWidth = 7;
  ctx.strokeRect(dx, dy, dw, dh);
  ctx.fillStyle = 'rgba(90,72,57,.26)';
  ctx.fillRect(dx + dw * .78, dy, dw * .22, dh);

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
  if (!hearth) return;
  ctx.save();
  ctx.globalAlpha *= evaluateObjectKeyframes(hearth.keyframes, timeMs).opacity;
  const hx = hearth.x;
  const hy = hearth.y + hearth.height * .34;
  const glow = ctx.createRadialGradient(hx, hy, 4, hx, hy, width * .24);
  glow.addColorStop(0, 'rgba(181,103,48,.16)');
  glow.addColorStop(.55, 'rgba(154,87,43,.07)');
  glow.addColorStop(1, 'rgba(154,87,43,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
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
  const light = ctx.createRadialGradient(width*.28,height*.24,0,width*.28,height*.24,width*.75);
  light.addColorStop(0,'rgba(193,142,74,.16)'); light.addColorStop(1,'rgba(0,0,0,.5)');
  ctx.fillStyle = light; ctx.fillRect(0,0,width,height);
  for (let i=0;i<3;i++) curve(ctx,[{x:width*.54+i*11,y:height*.43},{x:width*.55+i*11,y:height*.54},{x:width*.59+i*11,y:height*.6}], '#997b5c', 1.2, .5);
}

function drawRoomUnderfloor(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  const seed = seedOf(scene.backgroundRef || scene.visualBrief || scene.name);

  const dark = ctx.createLinearGradient(0, 0, 0, height);
  dark.addColorStop(0, '#211b18');
  dark.addColorStop(.42, '#111313');
  dark.addColorStop(1, '#080a0a');
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, width, height);

  // Underside of the plank floor occupies the upper third and immediately
  // establishes that the camera is beneath the house, not inside the room.
  const floorBottom = height * .32;
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
  ctx.fillStyle = '#2f241e';
  ctx.fillRect(0, floorBottom - 18, width, 22);
  const posts = [width*.14, width*.38, width*.66, width*.87];
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

  // Bare earth is deliberately low-detail so the black negative space dominates.
  const groundY = height * .83;
  ctx.fillStyle = '#181613';
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.bezierCurveTo(width*.24, groundY-10, width*.43, groundY+9, width*.62, groundY-4);
  ctx.bezierCurveTo(width*.79, groundY-13, width*.91, groundY+4, width, groundY-6);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

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

  // Desk and objects.
  ctx.fillStyle = '#9a7659';
  ctx.fillRect(width * .08, height * .59, width * .28, 18);
  ctx.fillRect(width * .1, height * .61, 12, height * .18);
  ctx.fillRect(width * .31, height * .61, 12, height * .18);
  ctx.fillStyle='#d7c5a3';ctx.fillRect(width*.17,height*.555,width*.08,10);
  ctx.strokeStyle='#75634f';ctx.strokeRect(width*.17,height*.555,width*.08,10);
  // Ink pot / cup.
  ctx.fillStyle='#62564f';ctx.fillRect(width*.285,height*.55,12,17);
  curve(ctx,[{x:width*.29,y:height*.55},{x:width*.305,y:height*.515}],'#4f4741',2,.75);

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

export function drawAuthoredBackground(
  ctx: CanvasRenderingContext2D,
  scene: CanvasStudioScene,
  width: number,
  height: number,
  timeMs = 0,
) {
  timeMs += scene.atmosphere?.timeOffsetMs || 0;
  switch (scene.backgroundRef) {
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
    case 'bg:city-close':
      drawCityClose(ctx, scene, width, height); return true;
    case 'bg:room-study':
      drawRoomStudy(ctx, scene, width, height); return true;
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
