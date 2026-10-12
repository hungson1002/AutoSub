import {resolveStageCharacterRig} from './characterStaging';
import type { CanvasStudioObject, CanvasStudioScene } from '../types';
import { blanketTopAt, characterDrawingScale, characterRnd, resolveCharacterModel, resolveFaceParams, type CharacterModel } from './characterModel';
import { type CharacterPoint, type CharacterRig } from './characterRig';
import { evaluateCanvasObject } from '../runtime';

function darken(hex: string, amount: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = Number.parseInt(match[1]!, 16);
  const r = Math.max(0, Math.min(255, (value >> 16) - amount));
  const g = Math.max(0, Math.min(255, ((value >> 8) & 255) - amount));
  const b = Math.max(0, Math.min(255, (value & 255) - amount));
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function roughStroke(ctx: CanvasRenderingContext2D, path: Path2D, color: string, width: number, seed: number, alpha = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  ctx.stroke(path);
  ctx.globalAlpha = alpha * .24;
  ctx.translate((characterRnd(seed, 201) - .5) * .75, (characterRnd(seed, 202) - .5) * .65);
  ctx.rotate((characterRnd(seed, 203) - .5) * .008);
  ctx.lineWidth = Math.max(.45, width * .58);
  ctx.stroke(path);
  ctx.restore();
}

function filledPath(
  ctx: CanvasRenderingContext2D,
  d: string,
  fill: string | CanvasGradient,
  stroke: string,
  width: number,
  seed: number,
  alpha = 1,
) {
  const p = new Path2D(d);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.fill(p);
  ctx.restore();
  roughStroke(ctx, p, stroke, width, seed, alpha);
  return p;
}

function roughLine(ctx: CanvasRenderingContext2D, points: CharacterPoint[], color: string, width: number, seed: number, alpha = 1, cap: CanvasLineCap = 'round', jitter = true) {
  if (points.length < 2) return;
  const draw = (offset: number, a: number, w: number) => {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = cap;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const first = points[0]!;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i]!;
      const wobbleX = jitter ? (characterRnd(seed, offset + i * 2) - .5) * .75 : 0;
      const wobbleY = jitter ? (characterRnd(seed, offset + i * 2 + 1) - .5) * .75 : 0;
      ctx.lineTo(p.x + wobbleX, p.y + wobbleY);
    }
    ctx.stroke();
    ctx.restore();
  };
  draw(20, alpha, width);
  draw(80, alpha * .2, Math.max(.5, width * .55));
}

function clothingGradient(ctx: CanvasRenderingContext2D, model: CharacterModel, scene: CanvasStudioScene, object: CanvasStudioObject) {
  const fire = scene.objects.find((item) => item.kind === 'prop' && item.variant === 'fire');
  const flashlight = scene.effects?.find((item) => item.type === 'flashlight');
  const lightX = fire?.x ?? flashlight?.x;
  const warmLeft = lightX !== undefined ? lightX < object.x : true;
  const litPrimary = fire ? darken(model.primary, -12) : flashlight ? darken(model.primary, -8) : model.primary;
  const g = ctx.createLinearGradient(-24, 0, 24, 0);
  if (model.horror) {
    g.addColorStop(0, warmLeft ? litPrimary : darken(model.primary, 23));
    g.addColorStop(.52, model.primary);
    g.addColorStop(1, warmLeft ? darken(model.primary, 25) : litPrimary);
  } else {
    g.addColorStop(0, darken(model.primary, 7));
    g.addColorStop(.5, model.primary);
    g.addColorStop(1, darken(model.primary, 13));
  }
  return g;
}

function skinGradient(ctx: CanvasRenderingContext2D, model: CharacterModel, scene: CanvasStudioScene, object: CanvasStudioObject) {
  const fire = scene.objects.find((item) => item.kind === 'prop' && item.variant === 'fire');
  const flashlight = scene.effects?.find((item) => item.type === 'flashlight');
  const lightX = fire?.x ?? flashlight?.x;
  const warmLeft = lightX !== undefined ? lightX < object.x : true;
  const highlight = fire ? darken(model.highlight, -8) : flashlight ? darken(model.highlight, -4) : model.highlight;
  const g = ctx.createLinearGradient(-22, 0, 22, 0);
  if (model.horror) {
    g.addColorStop(0, warmLeft ? highlight : model.shadow);
    g.addColorStop(.32, model.skin);
    g.addColorStop(.7, model.skin);
    g.addColorStop(1, warmLeft ? model.shadow : highlight);
  } else {
    g.addColorStop(0, darken(model.skin, 10));
    g.addColorStop(.48, model.skin);
    g.addColorStop(1, darken(model.skin, 18));
  }
  return g;
}

function drawGroundShadow(ctx: CanvasRenderingContext2D, model: CharacterModel, baseline = 50.2, feet?:readonly CharacterPoint[], object?:CanvasStudioObject) {
  ctx.save();
  const far=object?.depth==='background'||object?.role==='background';
  ctx.globalAlpha = model.horror ? (far?.34:.24) : .11;
  const radius=model.shoulderWidth*(far?.72:.62);
  const shade=ctx.createRadialGradient(0,baseline,0,0,baseline,radius);
  shade.addColorStop(0,'#11110f');shade.addColorStop(.58,'rgba(17,17,15,.62)');shade.addColorStop(1,'rgba(17,17,15,0)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(0, baseline, radius, far?2.7:2.45, 0, 0, Math.PI * 2);
  ctx.fill();
  if(model.horror&&feet?.length){
    // Distant figures lose tiny floor cues first after encoding. Keep the
    // contact patches optically denser while their world position stays exact.
    ctx.globalAlpha=far?.56:.40;
    ctx.fillStyle='#0d0e0d';
    for(const foot of feet){
      ctx.beginPath();
      ctx.ellipse(foot.x+1,foot.y+3.05,far?5.7:5.0,far?1.35:1.18,-.04,0,Math.PI*2);
      ctx.fill();
    }
    const cx=feet.reduce((sum,foot)=>sum+foot.x,0)/feet.length;
    const cy=feet.reduce((sum,foot)=>sum+foot.y,0)/feet.length+2.8;
    ctx.globalAlpha=far?.18:.12;
    ctx.beginPath();ctx.ellipse(cx,cy,radius*.72,1.15,0,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

function drawLimb(
  ctx: CanvasRenderingContext2D,
  points: CharacterPoint[],
  fill: string,
  model: CharacterModel,
  seed: number,
  width: number,
  cap: CanvasLineCap = 'round',
) {
  roughLine(ctx, points, model.ink, width + (model.horror ? 1.35 : 2.1), seed, .95, cap, model.horror);
  roughLine(ctx, points, fill, width, seed + 91, .98, cap, model.horror);
}

function drawLegs(ctx: CanvasRenderingContext2D, rig: CharacterRig, model: CharacterModel, object:CanvasStudioObject) {
  const line = model.horror ? (model.lod === 'far' ? 3.2 : 4.2) : model.lod === 'far' ? 4.6 : 6.4;
  drawLimb(ctx, [rig.hipL, rig.kneeL, rig.footL], model.secondary, model, model.seed + 401, line, 'butt');
  drawLimb(ctx, [rig.hipR, rig.kneeR, rig.footR], model.secondary, model, model.seed + 411, line, 'butt');

  if (model.horror) {
    // Horror reference actors read as flat cutout figures. A tiny foot cap is
    // enough to ground the silhouette; detailed shoes make them look like the
    // generic editorial renderer again.
    for (const [p, seed] of [[rig.footL, model.seed + 431], [rig.footR, model.seed + 441]] as const) {
      ctx.save();
      ctx.fillStyle = '#262321';
      ctx.strokeStyle = model.ink;
      ctx.lineWidth = .7;
      ctx.beginPath();
      ctx.ellipse(p.x + 1.5, p.y + 1.5, 4.1, 1.8, -.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else {
  const shoe = (p: CharacterPoint, seed: number) => {
    // footL/R are ankle anchors. Shoes extend BELOW them and enclose the
    // trouser endpoint; a rounded calf cap must never protrude below the sole.
    const d = `M ${p.x - 4.3} ${p.y - 1} Q ${p.x} ${p.y - 1.8} ${p.x + 4.3} ${p.y - .5} L ${p.x + 5.1} ${p.y + 2.5} Q ${p.x + 4.3} ${p.y + 4.5} ${p.x} ${p.y + 4.5} Q ${p.x - 4.3} ${p.y + 4.5} ${p.x - 4.3} ${p.y + 2.5} Z`;
    filledPath(ctx, d, '#423b36', model.ink, .9, seed);
  };
  shoe(rig.footL, model.seed + 431);
  shoe(rig.footR, model.seed + 441);
  }
  const bandageProgress=Math.max(0,Math.min(1,object.bandageProgress??1));
  if(object.legBandage && bandageProgress>0) {
    const knee=object.legBandage==='right'?rig.kneeR:rig.kneeL;
    const foot=object.legBandage==='right'?rig.footR:rig.footL;
    const at=(t:number)=>({x:knee.x+(foot.x-knee.x)*t,y:knee.y+(foot.y-knee.y)*t});
    drawLimb(ctx,[at(.28),at(.28+.35*bandageProgress)],'#dbd4bb',model,model.seed+445,line+1.8);
    if(bandageProgress>.65)roughLine(ctx,[at(.4),at(.51)],'#a09a86',.6,model.seed+446,.6);
  }
}

function drawHand(ctx:CanvasRenderingContext2D,p:CharacterPoint,model:CharacterModel,seed:number,pointing=false,palmUp=false) {
  const side=p.x<0?-1:1;
  ctx.save();ctx.translate(p.x,p.y);ctx.scale(side,1);
  if(palmUp){
    filledPath(ctx,'M -3 -1 Q -1 -2.8 1 -2 L 2.2 -3.4 Q 3.4 -3.8 3.2 -2.2 L 2.8 -1 L 6 -1.2 Q 7.5 -.8 6 .5 L 1.5 2 Q -1 2.6 -3 1 Z',model.skin,model.ink,.7,seed);
    roughLine(ctx,[{x:1,y:.5},{x:4.8,y:-.2}],model.shadow,.45,seed+1,.3);
    ctx.restore();return;
  }
  filledPath(ctx,'M -2 -1.6 Q -2.6 -3 0 -2.6 L 2.4 -1.7 Q 4 -1 3.4 .4 L 2.2 2.1 Q -.3 3 -2 1.1 L -3.2 .4 Q -3.7 -.8 -2 -1.6 Z',model.skin,model.ink,.7,seed);
  roughLine(ctx,[{x:.4,y:.2},{x:2.1,y:.8}],model.shadow,.45,seed+1,.6);
  roughLine(ctx,[{x:.1,y:1.1},{x:1.6,y:1.5}],model.shadow,.4,seed+2,.5);
  if (pointing) drawLimb(ctx,[{x:1,y:-.8},{x:6,y:-1.5}],model.skin,model,seed+3,1.25);
  ctx.restore();
}

function drawArms(ctx: CanvasRenderingContext2D, rig: CharacterRig, model: CharacterModel, scene: CanvasStudioScene, object: CanvasStudioObject,side:'both'|'L'|'R'='both') {
  const sleeve = model.horror ? (model.lod === 'far' ? 2.4 : 3.2) : model.lod === 'far' ? 3.1 : 4.5;
  const fore = model.horror ? (model.lod === 'far' ? 1.9 : 2.45) : model.lod === 'far' ? 2.5 : 3.5;
  if(side!=='R'){
    drawLimb(ctx, [rig.shoulderL, rig.elbowL], model.primary, model, model.seed + 501, sleeve);
    drawLimb(ctx, [rig.elbowL, rig.handL], model.skin, model, model.seed + 521, fore);
  }
  if(side!=='L'){
    drawLimb(ctx, [rig.shoulderR, rig.elbowR], model.primary, model, model.seed + 511, sleeve);
    drawLimb(ctx, [rig.elbowR, rig.handR], model.skin, model, model.seed + 531, fore);
  }

  if (model.lod !== 'far') {
    const gripping=scene.objects.some(prop=>prop.heldBy===object.id);
    if (model.horror) {
      const dotHand=(p:CharacterPoint,seed:number)=>{
        ctx.save();ctx.fillStyle=model.skin;ctx.strokeStyle=model.ink;ctx.lineWidth=.65;
        ctx.beginPath();ctx.ellipse(p.x,p.y,2.3,2.1,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
      };
      if(side!=='R')dotHand(rig.handL,model.seed+541);
      if(side!=='L')dotHand(rig.handR,model.seed+551);
    } else {
      if(side!=='R')drawHand(ctx,rig.handL,model,model.seed+541);
      if(side!=='L')drawHand(ctx,rig.handR,model,model.seed+551,object.pose==='point'&&!gripping,object.pose==='gesture'&&!gripping);
    }
    if(side!=='L'&&object.pose==='wipe'){
      const {x,y}=rig.handR;
      filledPath(ctx,`M ${x-3} ${y-3} L ${x+4} ${y-2} L ${x+3} ${y+4} L ${x-4} ${y+3} Z`,'#e3dbbc',model.ink,.5,model.seed+552);
    }
    if(side!=='L'&&object.pose==='write'){
      const {x,y}=rig.handR;
      drawLimb(ctx,[{x:x-1,y:y-3},{x:x+1,y:y+4}],'#d0a14f',model,model.seed+553,1.1);
      roughLine(ctx,[{x:x+1,y:y+4},{x:x+1.3,y:y+5}],model.ink,.55,model.seed+554);
    }
  }
}


function drawTorso(ctx: CanvasRenderingContext2D, rig: CharacterRig, model: CharacterModel, scene: CanvasStudioScene, object: CanvasStudioObject) {
  const top = rig.chest.y - 5;
  const bottom = rig.pelvis.y + 4;
  const sw = model.shoulderWidth / 2;
  const ww = model.waistWidth / 2 * (model.lod === 'close' ? 1.08 : 1);
  const horrorSkew = model.asymmetryX * 1.4;
  const d = model.horror
    ? `M ${-sw*.82+horrorSkew*.2} ${top+1} Q ${horrorSkew*.35} ${top-3} ${sw*.82+horrorSkew} ${top-1} L ${ww*.78+horrorSkew*.55} ${bottom} Q ${horrorSkew*.2} ${bottom+2} ${-ww*.8+horrorSkew*.15} ${bottom+1} Z`
    : `M ${-sw} ${top} C ${-sw + 2} ${top - 5} ${sw - 2} ${top - 5} ${sw} ${top} L ${ww} ${bottom} C ${ww - 5} ${bottom + 4} ${-ww + 5} ${bottom + 4} ${-ww} ${bottom} Z`;
  filledPath(ctx, d, model.horror ? model.primary : clothingGradient(ctx, model, scene, object), model.ink, model.horror ? 1.2 : 1.65, model.seed + 601);

  if (model.lod !== 'far' && !model.horror) {
    if (model.wardrobe === 'jacket') {
      roughLine(ctx, [{x:-2,y:top+3},{x:-1,y:bottom-3}], darken(model.secondary, 18), 1.05, model.seed + 603, .72);
      roughLine(ctx, [{x:-sw*.7,y:top+4},{x:-5,y:top+11}], darken(model.secondary, 12), .95, model.seed + 604, .66);
      roughLine(ctx, [{x:sw*.7,y:top+4},{x:5,y:top+11}], darken(model.secondary, 12), .95, model.seed + 605, .66);
    } else if (model.wardrobe === 'robe') {
      roughLine(ctx, [{x:-sw*.55,y:top+4},{x:4,y:bottom-1}], darken(model.secondary, 16), 1.1, model.seed + 606, .62);
      roughLine(ctx, [{x:sw*.5,y:top+5},{x:-3,y:bottom-1}], darken(model.secondary, 16), 1.1, model.seed + 607, .58);
    } else if (model.wardrobe === 'sailor-shirt') {
      roughLine(ctx, [{x:-10,y:top+2},{x:0,y:top+9},{x:10,y:top+2}], '#d7d7cf', 1.25, model.seed + 608, .72);
    } else if (model.wardrobe === 'warrior-tunic') {
      roughLine(ctx, [{x:-sw*.75,y:top+7},{x:sw*.75,y:top+7}], darken(model.secondary, 16), 1.25, model.seed + 609, .62);
      roughLine(ctx, [{x:-8,y:top+2},{x:6,y:bottom-2}], darken(model.secondary, 18), 1, model.seed + 610, .55);
    } else if (model.wardrobe === 'work-shirt') {
      const pocket = new Path2D(`M 4 ${top+15} L 11 ${top+15} L 10 ${top+23} L 4 ${top+23} Z`);
      roughStroke(ctx, pocket, darken(model.secondary, 12), .8, model.seed + 645, .55);
      roughLine(ctx, [{x:-sw*.65,y:top+4},{x:-sw*.5,y:top+11}], darken(model.primary, 18), .7, model.seed + 646, .35);
      roughLine(ctx, [{x:sw*.65,y:top+4},{x:sw*.5,y:top+11}], darken(model.primary, 18), .7, model.seed + 647, .35);
    } else {
      roughLine(ctx, [{x:-8,y:top+2},{x:0,y:top+8},{x:8,y:top+2}], darken(model.secondary, 10), .9, model.seed + 648, .42);
    }


    // Collar and placket are deliberately asymmetric and identity-stable.
    const drift = model.asymmetryX * .7;
    roughLine(ctx, [{x:-7,y:top+1},{x:drift,y:top+7},{x:7,y:top+1}], darken(model.secondary, 8), 1.25, model.seed + 611, .72);
    roughLine(ctx, [{x:drift,y:top+7},{x:drift+.4,y:bottom-4}], darken(model.secondary, 16), .85, model.seed + 621, .5);
    if(model.wardrobe==='work-shirt'||model.wardrobe==='jacket'){
      filledPath(ctx,`M -7 ${top+1} L -1 ${top+7} L -5 ${top+9} L -10 ${top+3} Z`,darken(model.primary,9),model.ink,.55,model.seed+622);
      filledPath(ctx,`M 7 ${top+1} L 1 ${top+7} L 5 ${top+9} L 10 ${top+3} Z`,darken(model.primary,-4),model.ink,.55,model.seed+623);
      for(const y of [top+14,top+21,bottom-5]){ctx.fillStyle=model.secondary;ctx.beginPath();ctx.arc(drift+.4,y,.65,0,Math.PI*2);ctx.fill();}
    }
    if (model.lod === 'close') {
      roughLine(ctx, [{x:-10,y:top+15},{x:-6,y:top+28}], darken(model.primary, 24), .7, model.seed + 631, .35);
      roughLine(ctx, [{x:9,y:top+14},{x:5,y:top+27}], darken(model.primary, 24), .7, model.seed + 641, .32);
      if (object.archetype === 'worker') {
        const pocket = new Path2D(`M 4 ${top+15} L 11 ${top+15} L 10 ${top+23} L 4 ${top+23} Z`);
        roughStroke(ctx, pocket, darken(model.secondary, 12), .8, model.seed + 645, .55);
      }
    }
  }

  // Horror keeps the neck as a tiny flat connector; the generic renderer
  // uses a modeled neck with shading.
  const neckHalf = model.horror ? 2.45 : model.lod === 'close' ? 4.8 : 4;
  const neckTop = rig.head.y + model.faceHeight * (model.horror ? .47 : .43);
  const neckBottom = model.horror ? top - 1 : top + 2;
  const neck = model.horror
    ? `M ${rig.head.x-neckHalf} ${neckTop} L ${rig.chest.x-neckHalf} ${neckBottom} L ${rig.chest.x+neckHalf} ${neckBottom} L ${rig.head.x+neckHalf} ${neckTop} Z`
    : `M ${rig.head.x-neckHalf} ${neckTop} L ${rig.chest.x-neckHalf+1} ${neckBottom} C ${rig.chest.x-1} ${neckBottom+2} ${rig.chest.x+1} ${neckBottom+2} ${rig.chest.x+neckHalf-1} ${neckBottom} L ${rig.head.x+neckHalf} ${neckTop} Z`;
  filledPath(ctx, neck, model.horror ? model.skin : skinGradient(ctx, model, scene, object), model.ink, model.horror ? .85 : 1.05, model.seed + 651);
}

function faceContour(model: CharacterModel, rig: CharacterRig) {
  const cx = rig.head.x;
  const cy = rig.head.y;
  const w = model.faceWidth / 2;
  const h = model.faceHeight / 2;
  const jaw = model.jawWidth / 2;
  const chinY = cy + h * .96 + model.chinLength * .12;

  if (model.faceShape === 'angular') {
    return `M ${cx-w*.64} ${cy-h*.94}
      C ${cx-w*.3} ${cy-h*1.08} ${cx+w*.28} ${cy-h*1.08} ${cx+w*.64} ${cy-h*.94}
      L ${cx+w*.92} ${cy-h*.12}
      C ${cx+w*.9} ${cy+h*.3} ${cx+w*.72} ${cy+h*.58} ${cx+jaw} ${cy+h*.74}
      L ${cx+jaw*.48} ${cy+h*.92}
      L ${cx} ${chinY}
      L ${cx-jaw*.48} ${cy+h*.92}
      L ${cx-jaw} ${cy+h*.74}
      C ${cx-w*.72} ${cy+h*.58} ${cx-w*.9} ${cy+h*.3} ${cx-w*.92} ${cy-h*.12}
      Z`;
  }

  if (model.faceShape === 'round') {
    return `M ${cx-w*.62} ${cy-h*.92}
      C ${cx-w*.24} ${cy-h*1.08} ${cx+w*.24} ${cy-h*1.08} ${cx+w*.62} ${cy-h*.92}
      C ${cx+w*1.02} ${cy-h*.72} ${cx+w*1.03} ${cy+h*.16} ${cx+w*.82} ${cy+h*.55}
      C ${cx+w*.63} ${cy+h*.88} ${cx+w*.25} ${chinY} ${cx} ${chinY}
      C ${cx-w*.25} ${chinY} ${cx-w*.63} ${cy+h*.88} ${cx-w*.82} ${cy+h*.55}
      C ${cx-w*1.03} ${cy+h*.16} ${cx-w*1.02} ${cy-h*.72} ${cx-w*.62} ${cy-h*.92}
      Z`;
  }

  if (model.faceShape === 'long') {
    return `M ${cx-w*.62} ${cy-h*.96}
      C ${cx-w*.28} ${cy-h*1.08} ${cx+w*.28} ${cy-h*1.08} ${cx+w*.62} ${cy-h*.96}
      C ${cx+w*.9} ${cy-h*.7} ${cx+w*.92} ${cy+h*.38} ${cx+jaw} ${cy+h*.7}
      C ${cx+jaw*.55} ${cy+h*.92} ${cx+jaw*.2} ${chinY} ${cx} ${chinY}
      C ${cx-jaw*.2} ${chinY} ${cx-jaw*.55} ${cy+h*.92} ${cx-jaw} ${cy+h*.7}
      C ${cx-w*.92} ${cy+h*.38} ${cx-w*.9} ${cy-h*.7} ${cx-w*.62} ${cy-h*.96}
      Z`;
  }

  if (model.faceShape === 'narrow') {
    return `M ${cx-w*.61} ${cy-h*.95}
      C ${cx-w*.25} ${cy-h*1.08} ${cx+w*.24} ${cy-h*1.08} ${cx+w*.61} ${cy-h*.95}
      C ${cx+w*.88} ${cy-h*.7} ${cx+w*.9} ${cy+h*.25} ${cx+jaw} ${cy+h*.7}
      C ${cx+jaw*.5} ${cy+h*.9} ${cx+jaw*.18} ${chinY} ${cx} ${chinY}
      C ${cx-jaw*.18} ${chinY} ${cx-jaw*.5} ${cy+h*.9} ${cx-jaw} ${cy+h*.7}
      C ${cx-w*.9} ${cy+h*.25} ${cx-w*.88} ${cy-h*.7} ${cx-w*.61} ${cy-h*.95}
      Z`;
  }

  return `M ${cx-w*.66} ${cy-h*.94}
    C ${cx-w*.32} ${cy-h*1.08} ${cx+w*.28} ${cy-h*1.08} ${cx+w*.64} ${cy-h*.94}
    C ${cx+w*.9} ${cy-h*.78} ${cx+w*.98} ${cy-h*.42} ${cx+w*.96} ${cy-h*.03}
    C ${cx+w*.94} ${cy+h*.34} ${cx+w*.82} ${cy+h*.58} ${cx+jaw} ${cy+h*.78}
    C ${cx+jaw*.66} ${cy+h*.9} ${cx+jaw*.34} ${chinY} ${cx} ${chinY}
    C ${cx-jaw*.34} ${chinY} ${cx-jaw*.66} ${cy+h*.9} ${cx-jaw} ${cy+h*.78}
    C ${cx-w*.82} ${cy+h*.58} ${cx-w*.94} ${cy+h*.34} ${cx-w*.96} ${cy-h*.03}
    C ${cx-w*.98} ${cy-h*.42} ${cx-w*.9} ${cy-h*.78} ${cx-w*.66} ${cy-h*.94}
    Z`;
}

function drawHair(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, rig: CharacterRig, model: CharacterModel) {
  if (object.hair === 'bald') {
    if (model.lod === 'close') roughLine(ctx, [{x:-7,y:rig.head.y-21},{x:0,y:rig.head.y-23},{x:7,y:rig.head.y-21}], model.ink, .65, model.seed + 701, .22);
    return;
  }
  const y = rig.head.y - model.faceHeight * .43;
  const half = model.faceWidth * .48;
  if (object.hair === 'bun') {
    filledPath(ctx, `M ${-half} ${y+7} C ${-half*.88} ${y-2} ${-half*.3} ${y-7} 0 ${y-7} C ${half*.35} ${y-7} ${half*.82} ${y-2} ${half} ${y+7} C ${half*.48} ${y+3} ${-half*.45} ${y+3} ${-half} ${y+10} Z`, model.hair, model.ink, 1.15, model.seed + 711);
    ctx.save(); ctx.fillStyle = model.hair; ctx.strokeStyle=model.ink;ctx.lineWidth=1;ctx.beginPath(); ctx.ellipse(half*.7, y-4.5, 5.8, 5.1, -.18, 0, Math.PI*2); ctx.fill();ctx.stroke(); ctx.restore();
  } else if (object.hair === 'hat') {
    filledPath(ctx, `M ${-half} ${y+5} C ${-half*.7} ${y-8} ${half*.65} ${y-8} ${half} ${y+5} L ${half*.8} ${y+10} L ${-half*.82} ${y+10} Z`, model.secondary, model.ink, 1.25, model.seed + 721);
    roughLine(ctx,[{x:-half-3,y:y+10},{x:half+4,y:y+10}],model.ink,1.2,model.seed+722,.85);
  } else {
    const messy = object.hair === 'messy';
    filledPath(ctx, `M ${-half} ${y+8} C ${-half*.92} ${y+1} ${-half*.58} ${y-3.5} ${-half*.16} ${y-4.2} C ${half*.22} ${y-5.4} ${half*.66} ${y-3.2} ${half} ${y+5.5} C ${half*.72} ${y+4.4} ${half*.36} ${y+3.4} 0 ${y+4.2} C ${-half*.42} ${y+2.8} ${-half*.72} ${y+4.2} ${-half} ${y+10} Z`, model.hair, model.ink, 1.2, model.seed + 731);
    if (model.lod !== 'far') {
      const tufts = messy ? 4 : 3;
      for (let i=0;i<tufts;i++) {
        const x=-half*.58+i*(half*1.15/Math.max(1,tufts-1))+(characterRnd(model.seed,750+i)-.5)*1.6;
        const lift=messy ? 5.2 : 2.6;
        roughLine(ctx,[{x,y:y+1.5},{x:x+2.2,y:y-lift}],darken(model.hair, -18),.62,model.seed+741+i,.34);
      }
    }
  }
}

function drawFace(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, rig: CharacterRig, model: CharacterModel, scene: CanvasStudioScene, timeMs: number, voiceActive: boolean, speechLevel?: number) {
  const face = resolveFaceParams(object, model, timeMs, voiceActive, speechLevel);
  let faceTurn=0;
  const partner=scene.objects.find(actor=>actor.id===object.lookAtId)
    || scene.objects.find(actor=>actor.kind==='character'&&actor.id!==object.id);
  if(partner&&object.pose!=='lie-down'&&object.pose!=='cover-face'){
    const target=evaluateCanvasObject(partner,scene,timeMs);
    const actor=evaluateCanvasObject(object,scene,timeMs);
    const headY=actor.y+rig.head.y*characterDrawingScale(object,model);
    face.pupilX=Math.max(-.8,Math.min(.8,(target.x-actor.x)/250))*(object.facing==='left'?-1:1);
    const targetY=target.y-(partner.kind==='character'?partner.height*.28:0);
    face.pupilY=Math.max(-.35,Math.min(.35,(targetY-headY)/300));
    if(object.lookAtId&&partner.kind==='character')faceTurn=Math.sign(face.pupilX);
  }
  const contour = model.horror
    ? `M ${-model.faceWidth*.39} ${rig.head.y-model.faceHeight*.45}
       C ${-model.faceWidth*.51} ${rig.head.y-model.faceHeight*.2} ${-model.faceWidth*.47} ${rig.head.y+model.faceHeight*.23} ${-model.faceWidth*.12} ${rig.head.y+model.faceHeight*.46}
       Q 0 ${rig.head.y+model.faceHeight*.5} ${model.faceWidth*.12} ${rig.head.y+model.faceHeight*.46}
       C ${model.faceWidth*.47} ${rig.head.y+model.faceHeight*.23} ${model.faceWidth*.51} ${rig.head.y-model.faceHeight*.2} ${model.faceWidth*.39} ${rig.head.y-model.faceHeight*.45}
       C ${model.faceWidth*.18} ${rig.head.y-model.faceHeight*.54} ${-model.faceWidth*.18} ${rig.head.y-model.faceHeight*.54} ${-model.faceWidth*.39} ${rig.head.y-model.faceHeight*.45} Z`
    : faceContour(model, rig);
  if (model.lod !== 'far' && !model.horror) {
    const earX = model.faceWidth * .48;
    ctx.save();
    ctx.fillStyle = model.skin;
    ctx.strokeStyle = model.ink;
    ctx.lineWidth = .85;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * earX, rig.head.y + 1, 1.8, 3.4, side * .08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (model.lod === 'close') {
        ctx.globalAlpha = .42;
        ctx.beginPath();
        ctx.arc(side * earX - side * .25, rig.head.y + 1.2, 1.05, -.9, 1.2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
  filledPath(ctx, contour, model.horror ? model.skin : skinGradient(ctx, model, scene, object), model.ink, model.horror ? 1.05 : model.lod === 'far' ? 1 : 1.25, model.seed + 801);

  if (model.lod !== 'far' && !model.horror) {
    const clip = new Path2D(contour);
    ctx.save();
    ctx.clip(clip);
    const shade = ctx.createLinearGradient(rig.head.x - model.faceWidth * .48, 0, rig.head.x + model.faceWidth * .48, 0);
    shade.addColorStop(0, 'rgba(255,231,205,.05)');
    shade.addColorStop(.56, 'rgba(255,255,255,0)');
    shade.addColorStop(1, model.horror ? 'rgba(34,27,24,.24)' : 'rgba(44,31,26,.15)');
    ctx.fillStyle = shade;
    ctx.fillRect(rig.head.x - model.faceWidth, rig.head.y - model.faceHeight, model.faceWidth * 2, model.faceHeight * 2);
    const cheek = ctx.createRadialGradient(rig.head.x - model.faceWidth * .18, rig.head.y + 5, 1, rig.head.x - model.faceWidth * .18, rig.head.y + 5, model.faceWidth * .34);
    cheek.addColorStop(0, model.horror ? 'rgba(167,100,64,.06)' : 'rgba(180,105,82,.11)');
    cheek.addColorStop(1, 'rgba(180,105,82,0)');
    ctx.fillStyle = cheek;
    ctx.fillRect(rig.head.x - model.faceWidth, rig.head.y - model.faceHeight, model.faceWidth * 2, model.faceHeight * 2);
    ctx.restore();
  }

  drawHair(ctx, object, rig, model);
  if (model.lod === 'far') {
    // At small scale the face is intentionally a readable value pattern, not noisy details.
    ctx.save();
    ctx.fillStyle=model.ink;
    ctx.globalAlpha=.72;
    ctx.beginPath();ctx.arc(-4.2,rig.head.y-1,1,0,Math.PI*2);ctx.arc(4.2,rig.head.y-1,1,0,Math.PI*2);ctx.fill();
    ctx.restore();
    return;
  }

  // Horror stories use a deliberately reduced face language, matching the
  // reference film's cutout characters: large dark eyes, almost no facial
  // anatomy, and only a tiny mouth cue while speaking. Identity comes from
  // silhouette, hair and wardrobe instead of detailed brows/nose/cheeks.
  if (model.horror) {
    const eyeY = rig.head.y - model.faceHeight * .035;
    const spacing = model.eyeSpacing * .96;
    const radiusX = model.lod === 'close' ? 2.15 : 1.9;
    const radiusY = Math.max(.5, radiusX * 1.18 * Math.max(.16, face.eyesOpen));
    ctx.save();
    ctx.fillStyle = model.ink;
    ctx.globalAlpha = .94;
    for (const center of [-spacing, spacing]) {
      const cx = center + faceTurn * 1.25 + face.pupilX * .65;
      if (face.eyesOpen < .16) {
        ctx.strokeStyle = model.ink;
        ctx.lineWidth = 1.15;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - radiusX, eyeY);
        ctx.quadraticCurveTo(cx, eyeY + .7, cx + radiusX, eyeY);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(cx, eyeY + face.pupilY * .45, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (face.mouthOpen > .1) {
      const mouthY = rig.head.y + model.faceHeight * .285;
      const open = Math.max(.75, face.mouthOpen * 2.1);
      ctx.beginPath();
      ctx.ellipse(faceTurn * 1.15, mouthY, 2.1 + face.mouthOpen * .8, open, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const eyeY = rig.head.y - model.faceHeight * .055;
  const spacing = model.eyeSpacing;
  const eyeH = 2.7 * model.eyeScale * face.eyesOpen;

  const eye = (center:number, seed:number) => {
    const cx=center+faceTurn*1.6;
    const eyeW=4.55*model.eyeScale*(faceTurn&&center*faceTurn<0?.78:1);
    if (face.eyesOpen < .15) {
      ctx.save();ctx.strokeStyle=model.ink;ctx.lineWidth=.85;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(cx-eyeW,eyeY);
      ctx.quadraticCurveTo(cx,eyeY+1.1,cx+eyeW,eyeY);ctx.stroke();ctx.restore();
      return;
    }
    ctx.save();
    ctx.strokeStyle=model.ink;ctx.lineWidth=.8;ctx.lineCap='round';
    ctx.fillStyle = model.horror ? '#ded6c8' : '#f1ece3';
    ctx.beginPath();
    ctx.moveTo(cx-eyeW,eyeY);
    ctx.quadraticCurveTo(cx,eyeY-eyeH*1.25,cx+eyeW,eyeY);
    ctx.quadraticCurveTo(cx,eyeY+eyeH*1.05,cx-eyeW,eyeY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const px=cx+face.pupilX*2.5;
    const py=eyeY+face.pupilY*.9;
    ctx.fillStyle=model.ink;ctx.beginPath();ctx.arc(px,py,model.horror?1.02:1.18,0,Math.PI*2);ctx.fill();
    if (model.lod==='close') {ctx.fillStyle='rgba(255,255,255,.72)';ctx.beginPath();ctx.arc(px-.35,py-.4,.28,0,Math.PI*2);ctx.fill();}
    ctx.restore();
    roughLine(ctx,[{x:cx-eyeW-.5,y:eyeY-.15},{x:cx,y:eyeY-eyeH*.62},{x:cx+eyeW+.35,y:eyeY-.12}],model.ink,.82,seed,.62);
    if(model.lod==='close') roughLine(ctx,[{x:cx-eyeW*.72,y:eyeY+eyeH*.55},{x:cx+eyeW*.62,y:eyeY+eyeH*.5}],model.shadow,.5,seed+3,.24);
  };
  eye(-spacing + model.asymmetryX, model.seed+811);
  eye(spacing, model.seed+821);

  const browY=eyeY-6+face.browLift*10;
  roughLine(ctx,[{x:-spacing-4,y:browY-face.browTilt*3},{x:-spacing+3.6,y:browY+face.browTilt*2+model.asymmetryBrow}],model.ink,1.15,model.seed+831,.78);
  roughLine(ctx,[{x:spacing-3.6,y:browY-face.browTilt*2},{x:spacing+4,y:browY+face.browTilt*3}],model.ink,1.15,model.seed+841,.78);

  // Nose is a side hint, avoiding the icon-like centered triangle look.
  const nx=model.asymmetryX*.5+faceTurn*2.8;
  roughLine(ctx,[{x:nx+.3,y:eyeY+2},{x:nx-.6,y:eyeY+7.3},{x:nx+1.7,y:eyeY+8.4}],model.ink,.82,model.seed+851,.5);
  if(model.lod==='close') {
    roughLine(ctx,[{x:nx-2.5,y:eyeY+8.2},{x:nx-1,y:eyeY+8.5}],model.ink,.55,model.seed+852,.34);
    roughLine(ctx,[{x:nx+1.2,y:eyeY+8.45},{x:nx+2.45,y:eyeY+8.1}],model.ink,.48,model.seed+853,.3);
    roughLine(ctx,[{x:nx-.1,y:eyeY+2.4},{x:nx-.7,y:eyeY+5.3}],model.shadow,.46,model.seed+854,.24);
  }

  const mouthY=rig.head.y + model.faceHeight * .30;
  if(model.age>=55){
    roughLine(ctx,[{x:-10,y:eyeY+6},{x:-12,y:mouthY-1}],model.shadow,.48,model.seed+892,.4);
    roughLine(ctx,[{x:10,y:eyeY+6},{x:12,y:mouthY-1}],model.shadow,.48,model.seed+893,.4);
    roughLine(ctx,[{x:-4,y:eyeY-10},{x:0,y:eyeY-10.6},{x:4,y:eyeY-10}],model.shadow,.42,model.seed+894,.3);
  }
  const mw=5.4*face.mouthWidth;
  ctx.save();ctx.translate(faceTurn*1.8,0);ctx.strokeStyle=model.ink;ctx.lineWidth=1.12;ctx.lineCap='round';ctx.beginPath();
  if(face.mouthOpen>.12){
    const opening=Math.max(.8,face.mouthOpen*3.7),halfWidth=mw*(.55+face.mouthOpen*.22);
    ctx.moveTo(-halfWidth,mouthY);
    ctx.bezierCurveTo(-halfWidth,mouthY-opening,halfWidth,mouthY-opening,halfWidth,mouthY);
    ctx.bezierCurveTo(halfWidth,mouthY+opening*1.25,-halfWidth,mouthY+opening*1.25,-halfWidth,mouthY);
    ctx.closePath();
  } else {
    ctx.moveTo(-mw,mouthY);
    ctx.quadraticCurveTo(0,mouthY+face.mouthCurve*3.2,mw,mouthY);
  }
  if(face.mouthOpen>.12){ctx.fillStyle=darken(model.skin,65);ctx.fill();}
  ctx.stroke();
  if(face.mouthOpen>.48){
    ctx.save();ctx.clip();ctx.strokeStyle='#ede3d3';ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(-mw*.55,mouthY-face.mouthOpen*2.1);ctx.lineTo(mw*.55,mouthY-face.mouthOpen*2.1);ctx.stroke();ctx.restore();
  }
  ctx.restore();
  if(model.lod==='close' && face.mouthOpen<=.12){
    roughLine(ctx,[{x:-mw*.55,y:mouthY+1.55},{x:0,y:mouthY+1.9},{x:mw*.5,y:mouthY+1.45}],model.shadow,.48,model.seed+856,.24);
    roughLine(ctx,[{x:-1.6,y:mouthY+5.2},{x:1.8,y:mouthY+5.05}],model.shadow,.44,model.seed+857,.18);
  }

  if(model.lod==='close'){
    // Restrained cheek/jaw detail gives close shots depth without photorealism.
    roughLine(ctx,[{x:-model.faceWidth*.36,y:eyeY+9},{x:-model.faceWidth*.28,y:eyeY+12}],model.shadow,.62,model.seed+861,.24);
    roughLine(ctx,[{x:model.faceWidth*.36,y:eyeY+9},{x:model.faceWidth*.28,y:eyeY+12}],model.shadow,.62,model.seed+871,.22);
    if(object.hair==='bun' || /old|elder|già/i.test(object.designNotes||'')){
      roughLine(ctx,[{x:-spacing-4,y:eyeY+3},{x:-spacing+2,y:eyeY+3.6}],model.shadow,.5,model.seed+881,.28);
      roughLine(ctx,[{x:spacing-2,y:eyeY+3.6},{x:spacing+4,y:eyeY+3}],model.shadow,.5,model.seed+891,.28);
    }
  }
}

/** Near-side contact limbs occupy the vessel's front plane even when the
 * actor's submerged body is clipped at the water surface. */
export function drawCharacterContactArms(ctx:CanvasRenderingContext2D,object:CanvasStudioObject,scene:CanvasStudioScene,timeMs:number){
  const {model,rig}=resolveStageCharacterRig(object,scene,timeMs,false);
  const scale=characterDrawingScale(object,model);
  ctx.save();
  if(model.lod==='close')ctx.translate(0,object.height*.055);
  ctx.scale((object.facing==='left'?-1:1)*scale,scale);
  drawArms(ctx,rig,model,scene,object,'R');
  ctx.restore();
}

function horrorTorsoPath(
  model:CharacterModel,
  top:number,
  bottom:number,
  sw:number,
  ww:number,
  pelvisOffset:number,
){
  if(model.wardrobe==='jacket'){
    return `M ${-sw*1.06} ${top+1}
      Q 0 ${top-2.8} ${sw*1.06} ${top+1}
      L ${ww*.98+pelvisOffset} ${bottom}
      L ${-ww*.98+pelvisOffset} ${bottom} Z`;
  }
  if(model.wardrobe==='robe'){
    const hem=Math.max(ww*1.24,sw*.83);
    return `M ${-sw*.92} ${top+1}
      Q 0 ${top-2} ${sw*.92} ${top+1}
      L ${hem+pelvisOffset} ${bottom+2}
      Q ${pelvisOffset} ${bottom+3.2} ${-hem+pelvisOffset} ${bottom+2} Z`;
  }
  if(model.wardrobe==='work-shirt'){
    return `M ${-sw*.86} ${top+1}
      Q ${-sw*1.08} ${top+2.5} ${-sw*1.10} ${top+7}
      L ${-sw*.88} ${top+12}
      L ${-ww*1.05+pelvisOffset} ${bottom}
      Q ${pelvisOffset} ${bottom+1.4} ${ww*1.05+pelvisOffset} ${bottom}
      L ${sw*.88} ${top+12}
      L ${sw*1.10} ${top+7}
      Q ${sw*1.08} ${top+2.5} ${sw*.86} ${top+1} Z`;
  }
  if(model.wardrobe==='warrior-tunic'){
    return `M ${-sw*1.05} ${top+1}
      L ${sw*1.05} ${top+1}
      L ${ww*.92+pelvisOffset} ${bottom+1}
      L ${-ww*.92+pelvisOffset} ${bottom+1} Z`;
  }
  if(model.wardrobe==='sailor-shirt'){
    return `M ${-sw} ${top+1}
      Q 0 ${top-1.8} ${sw} ${top+1}
      L ${ww*.9+pelvisOffset} ${bottom}
      Q ${pelvisOffset} ${bottom+1.6} ${-ww*.9+pelvisOffset} ${bottom} Z`;
  }
  // Villager shirt: soft shoulder and a slightly uneven handmade hem.
  return `M ${-sw*.84} ${top+1}
    Q ${-sw*1.04} ${top+2.6} ${-sw*1.06} ${top+6.8}
    L ${-sw*.85} ${top+11.2}
    L ${-ww+pelvisOffset} ${bottom+.5}
    Q ${pelvisOffset} ${bottom+2.2} ${ww+pelvisOffset} ${bottom+.5}
    L ${sw*.85} ${top+11.2}
    L ${sw*1.06} ${top+6.8}
    Q ${sw*1.04} ${top+2.6} ${sw*.84} ${top+1} Z`;
}

function drawHorrorWardrobeDetails(
  ctx:CanvasRenderingContext2D,
  object:CanvasStudioObject,
  model:CharacterModel,
  top:number,
  bottom:number,
  sw:number,
  seed:number,
){
  const ink=darken(model.secondary,22);
  const alpha=model.lod==='far'?.28:.55;
  if(model.wardrobe==='jacket'){
    roughLine(ctx,[{x:-sw*.56,y:top+3},{x:-3,y:top+11},{x:-1,y:bottom-2}],ink,.8,seed+1,alpha);
    roughLine(ctx,[{x:sw*.56,y:top+3},{x:3,y:top+11},{x:1,y:bottom-2}],ink,.8,seed+2,alpha);
    roughLine(ctx,[{x:-5,y:bottom-8},{x:5,y:bottom-8}],ink,.65,seed+3,alpha*.7);
  }else if(model.wardrobe==='robe'){
    roughLine(ctx,[{x:-sw*.55,y:top+4},{x:5,y:bottom-1}],ink,.9,seed+4,alpha);
    roughLine(ctx,[{x:sw*.52,y:top+4},{x:-4,y:bottom-1}],ink,.75,seed+5,alpha*.85);
    roughLine(ctx,[{x:-sw*.62,y:bottom-4},{x:sw*.62,y:bottom-4}],ink,.65,seed+6,alpha*.65);
  }else if(model.wardrobe==='sailor-shirt'){
    roughLine(ctx,[{x:-8,y:top+2},{x:0,y:top+8},{x:8,y:top+2}], '#d0d5d1',.9,seed+7,.55);
    roughLine(ctx,[{x:0,y:top+8},{x:0,y:bottom-5}],ink,.55,seed+8,.38);
  }else if(model.wardrobe==='warrior-tunic'){
    roughLine(ctx,[{x:-sw*.67,y:top+7},{x:sw*.67,y:top+7}],ink,.95,seed+9,alpha);
    roughLine(ctx,[{x:-7,y:top+3},{x:5,y:bottom-3}],ink,.8,seed+10,alpha);
    roughLine(ctx,[{x:-sw*.52,y:bottom-6},{x:sw*.52,y:bottom-6}],object.accent||ink,1.2,seed+11,.55);
  }else if(model.wardrobe==='work-shirt'){
    roughLine(ctx,[{x:0,y:top+4},{x:0,y:bottom-4}],ink,.62,seed+12,alpha*.8);
    filledPath(ctx,'M -9 8 L -2 8 L -2 15 L -9 15 Z',darken(model.primary,8),ink,.48,seed+13,.46);
  }else{
    roughLine(ctx,[{x:-6,y:top+2},{x:0,y:top+7},{x:6,y:top+2}],ink,.7,seed+14,alpha*.7);
  }
  // One stable seam/fold gives clothing a designed cutout quality without
  // adding frame-by-frame noise.
  if(model.lod!=='far'){
    roughLine(ctx,[{x:-sw*.38,y:bottom-8},{x:-sw*.28,y:bottom-2}],model.shadow,.48,seed+15,.22);
    if(/old|worn|worker|rough/i.test(object.designNotes||'')){
      roughLine(ctx,[{x:sw*.18,y:top+10},{x:sw*.42,y:top+14}],model.shadow,.5,seed+16,.24);
    }
  }
}

function drawHorrorHair(
  ctx:CanvasRenderingContext2D,
  object:CanvasStudioObject,
  model:CharacterModel,
  fw:number,
  fh:number,
  headY:number,
  seed:number,
){
  const hair=object.hair||'short';
  if(hair==='bald'){
    if(model.age>=45)roughLine(ctx,[{x:-fw*.34,y:headY-fh*.43},{x:0,y:headY-fh*.49},{x:fw*.3,y:headY-fh*.42}],model.shadow,.55,seed+1,.22);
    return;
  }
  ctx.save();
  ctx.fillStyle=model.hair;
  ctx.strokeStyle=model.ink;
  ctx.lineWidth=.7;
  if(hair==='crop'){
    ctx.beginPath();
    ctx.moveTo(-fw*.61,headY-fh*.38);
    ctx.quadraticCurveTo(0,headY-fh*.61,fw*.58,headY-fh*.4);
    ctx.lineTo(fw*.52,headY-fh*.28);
    ctx.quadraticCurveTo(0,headY-fh*.38,-fw*.57,headY-fh*.25);
    ctx.closePath();ctx.fill();
  }else if(hair==='messy'){
    const pts=[
      [-.62,-.33],[-.47,-.59],[-.28,-.48],[-.09,-.67],[.08,-.5],[.28,-.64],[.42,-.45],[.61,-.52],[.56,-.25],[-.58,-.23]
    ];
    ctx.beginPath();
    pts.forEach(([x,y],i)=>{const px=x!*fw,py=headY+y!*fh;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});
    ctx.closePath();ctx.fill();ctx.stroke();
  }else if(hair==='bun'){
    ctx.beginPath();
    ctx.ellipse(-fw*.45,headY-fh*.42,fw*.22,fh*.2,-.2,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-fw*.62,headY-fh*.36);
    ctx.quadraticCurveTo(-fw*.08,headY-fh*.66,fw*.55,headY-fh*.42);
    ctx.lineTo(fw*.5,headY-fh*.22);
    ctx.quadraticCurveTo(-fw*.05,headY-fh*.4,-fw*.56,headY-fh*.2);
    ctx.closePath();ctx.fill();
    roughLine(ctx,[{x:-fw*.49,y:headY-fh*.27},{x:-fw*.54,y:headY+fh*.02}],model.hair,1.25,seed+4,.9);
  }else if(hair==='hat'){
    const brim=new Path2D();
    brim.ellipse(0,headY-fh*.44,fw*.72,fh*.1,-.03,0,Math.PI*2);
    ctx.fillStyle=darken(model.secondary,8);ctx.fill(brim);ctx.stroke(brim);
    const crown=new Path2D(`M ${-fw*.38} ${headY-fh*.67} Q 0 ${headY-fh*.78} ${fw*.39} ${headY-fh*.66} L ${fw*.32} ${headY-fh*.43} L ${-fw*.34} ${headY-fh*.43} Z`);
    ctx.fillStyle=object.secondaryColor||model.secondary;ctx.fill(crown);ctx.stroke(crown);
  }else{
    // Short hair has an offset part and one side lock, distinct from crop.
    ctx.beginPath();
    ctx.moveTo(-fw*.62,headY-fh*.34);
    ctx.quadraticCurveTo(-fw*.28,headY-fh*.68,fw*.56,headY-fh*.43);
    ctx.lineTo(fw*.53,headY-fh*.23);
    ctx.quadraticCurveTo(fw*.12,headY-fh*.42,-fw*.58,headY-fh*.2);
    ctx.closePath();ctx.fill();
    roughLine(ctx,[{x:-fw*.12,y:headY-fh*.53},{x:fw*.14,y:headY-fh*.45}],darken(model.hair,10),.65,seed+5,.4);
  }
  ctx.restore();
}

export function drawHorrorCharacter(
  ctx: CanvasRenderingContext2D,
  object: CanvasStudioObject,
  scene: CanvasStudioScene,
  timeMs: number,
  voiceActive = false,
  speechLevel = 0,
) {
  const staged=resolveStageCharacterRig(object,scene,timeMs,voiceActive);
  const model=staged.model,rig=staged.rig;
  const face=resolveFaceParams(object,model,timeMs,voiceActive,speechLevel);
  const facing = object.facing === 'left' ? -1 : 1;
  // Use the exact same drawing scale as attachment/IK calculations. A separate
  // horror-only scale was enough to make held props and head/body anatomy drift.
  const scale=characterDrawingScale(object,model);
  const seed = model.seed;
  const explicitFear = object.expression === 'afraid';
  const feetY=Math.max(rig.footL.y,rig.footR.y);
  const torsoTop=Math.min(rig.shoulderL.y,rig.shoulderR.y)-2;
  const torsoBottom=rig.pelvis.y+3;
  const torsoCenterX=rig.chest.x;

  ctx.save();
  ctx.scale(facing * scale, scale);
  drawGroundShadow(ctx, model, feetY + 4,[rig.footL,rig.footR],object);

  // Skeletal legs: all poses share one pelvis/hip/knee/foot hierarchy.
  // This removes the old horror-only "floating head/body" coordinate system.
  drawLimb(ctx,[rig.hipL,rig.kneeL,rig.footL],model.secondary,model,seed+610,4.15,'butt');
  drawLimb(ctx,[rig.hipR,rig.kneeR,rig.footR],model.secondary,model,seed+611,4.15,'butt');

  // Small grounded shoes.
  for (const [p,s] of [[rig.footL,seed+612],[rig.footR,seed+613]] as const) {
    ctx.save();ctx.fillStyle='#242220';ctx.strokeStyle=model.ink;ctx.lineWidth=.7;
    ctx.beginPath();ctx.ellipse(p.x+1.6,p.y+1.1,5.4,2.05,-.04,0,Math.PI*2);ctx.fill();ctx.stroke();
    roughLine(ctx,[{x:p.x-2.2,y:p.y+.35},{x:p.x+3.7,y:p.y+.25}], '#8d8880', .45, s+7, .34);
    ctx.restore();
  }

  // Torso is attached to the skeleton chest/pelvis. Clothing is still
  // hand-drawn, but its geometry can no longer drift away from the neck/head.
  const lean=rig.chest.x-rig.pelvis.x;
  const sw=Math.max(14,model.shoulderWidth*.46),ww=Math.max(11,model.waistWidth*.43);
  ctx.save();
  ctx.translate(torsoCenterX,0);
  filledPath(ctx,
    horrorTorsoPath(model,torsoTop,torsoBottom,sw,ww,rig.pelvis.x-torsoCenterX),
    model.primary, model.ink, 1.28, seed+620);
  drawHorrorWardrobeDetails(ctx,object,model,torsoTop,torsoBottom,sw,seed+622);
  ctx.restore();

  // The neck bridges the actual skull anchor to the chest. Its top overlaps the
  // chin slightly, eliminating the visible head/body gap at every pose/scale.
  const fw=model.faceWidth*.58,fh=model.faceHeight*.72;
  const chinOffset=fh*(model.faceShape==='long'?.61:model.faceShape==='round'?.48:.54);
  const neckTop=rig.head.y+chinOffset-1.5;
  const neckBottom=rig.chest.y-1;
  filledPath(ctx,`M ${rig.neck.x-2.7} ${neckTop} L ${rig.chest.x-2.5} ${neckBottom}
    L ${rig.chest.x+2.5} ${neckBottom} L ${rig.neck.x+2.7} ${neckTop} Z`,
    model.skin,model.ink,.82,seed+621);
  ctx.save();
  ctx.fillStyle=darken(model.primary,18);ctx.strokeStyle=model.ink;ctx.lineWidth=.72;
  ctx.beginPath();ctx.ellipse(rig.chest.x,torsoTop+.3,4.4,1.7,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.restore();

  // Arms are a real wardrobe part, not one skin-coloured stick from shoulder
  // to fingertip. Keep the same skeleton but dress the upper arm/sleeve so the
  // cast reads as one designed parts system instead of assembled line segments.
  const longSleeve=model.wardrobe==='jacket'||model.wardrobe==='robe';
  const drawDressedArm=(side:'L'|'R',armSeed:number)=>{
    const shoulder=rig[`shoulder${side}`],elbow=rig[`elbow${side}`],hand=rig[`hand${side}`];
    if(longSleeve){
      drawLimb(ctx,[shoulder,elbow,hand],model.primary,model,armSeed,2.75);
      ctx.save();ctx.fillStyle=darken(model.primary,7);ctx.strokeStyle=model.ink;ctx.lineWidth=.55;
      ctx.beginPath();ctx.ellipse(hand.x,hand.y,2.25,1.55,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
    }else{
      const sleeveEnd={
        x:shoulder.x+(elbow.x-shoulder.x)*.42,
        y:shoulder.y+(elbow.y-shoulder.y)*.42,
      };
      drawLimb(ctx,[shoulder,sleeveEnd],model.primary,model,armSeed,3.65);
      drawLimb(ctx,[sleeveEnd,elbow,hand],model.skin,model,armSeed+31,2.35);
      ctx.save();ctx.fillStyle=darken(model.primary,7);ctx.strokeStyle=model.ink;ctx.lineWidth=.55;
      ctx.beginPath();ctx.ellipse(sleeveEnd.x,sleeveEnd.y,2.7,1.85,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
    }
  };
  drawDressedArm('L',seed+630);
  drawDressedArm('R',seed+631);
  for (const [p,s] of [[rig.handL,seed+632],[rig.handR,seed+633]] as const) {
    ctx.save();ctx.fillStyle=model.skin;ctx.strokeStyle=model.ink;ctx.lineWidth=.6;
    ctx.beginPath();ctx.ellipse(p.x,p.y,2.75,2.45,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    if(model.lod!=='far'){
      roughLine(ctx,[{x:p.x-1.2,y:p.y+.15},{x:p.x+1.45,y:p.y+.25}],model.shadow,.38,s+17,.22);
    }
    ctx.restore();
  }

  // Head is drawn in a head-local transform centered on the skeleton head.
  // Authored look-at beats add a short three-quarter turn instead of snapping
  // only the pupils/metadata while the skull remains frozen front-on.
  const lookBeat=scene.visualBeats?.find(beat=>beat.action==='look-at'&&beat.targetIds.includes(object.id)
    && timeMs>=beat.atMs);
  const semanticHeadBeat=scene.animationBeats?.find(beat=>beat.action==='nod'&&beat.targetIds.includes(object.id)
    &&timeMs>=beat.atMs&&timeMs<=beat.atMs+beat.durationMs);
  const headAct=semanticHeadBeat?(()=>{
    const elapsed=timeMs-semanticHeadBeat.atMs,duration=Math.max(120,semanticHeadBeat.durationMs);
    const ramp=Math.min(320,duration/3);
    const ease=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;};
    return ease(elapsed/ramp)*ease((duration-elapsed)/ramp);
  })():0;
  const lookId=object.lookAtId||lookBeat?.focusTargetId;
  const lookTarget=lookId&&scene.objects.find(target=>target.id===lookId);
  // A semantic focus target enters/exits on the same acting envelope as the
  // head pose. Previously object.lookAtId made the skull snap to full turn on
  // the first frame while head-up itself was eased.
  const semanticLook=semanticHeadBeat?.focusTargetId===lookId?headAct:undefined;
  const lookProgress=lookBeat
    ?Math.max(0,Math.min(1,(timeMs-lookBeat.atMs)/Math.max(180,lookBeat.durationMs)))
    :semanticLook??(lookTarget?1:0);
  const localLook=lookTarget?Math.sign(lookTarget.x-object.x)*facing*lookProgress:0;
  const headCue=semanticHeadBeat?.speechCue||'';
  const headUp=headCue==='head-up'?headAct:0;
  const headTurn=headCue==='head-turn'||headCue==='listen'?headAct:0;
  const targetTurn=lookTarget?Math.sign(lookTarget.x-object.x)*facing:(object.facing==='left'?-1:1);
  const semanticTurn=headTurn*targetTurn*.78;
  const threeQuarter=Math.max(-1,Math.min(1,localLook+semanticTurn));
  ctx.save();
  ctx.translate(rig.head.x+localLook*1.6+semanticTurn*1.35,rig.head.y-headUp*1.3);
  ctx.rotate((rig.headTilt+localLook*.9-headUp*8+semanticTurn*5.2)*Math.PI/180);
  if(localLook||headTurn){
    const squash=Math.max(Math.abs(localLook)*.055,headTurn*.085);
    ctx.scale(1-squash,1);
  }
  const cheek=model.faceShape==='round'?.84:model.faceShape==='narrow'?.67:model.faceShape==='angular'?.72:.76;
  const jaw=model.faceShape==='round'?.52:model.faceShape==='angular'?.42:model.faceShape==='long'?.38:.46;
  const chin=model.faceShape==='long'?.61:model.faceShape==='round'?.48:.54;
  filledPath(ctx,
    `M ${-fw*.62} ${-fh*.42}
     C ${-fw*cheek} ${-fh*.12} ${-fw*(cheek-.06)} ${fh*.20} ${-fw*jaw} ${fh*.36}
     Q 0 ${fh*chin} ${fw*jaw} ${fh*.36}
     C ${fw*(cheek-.06)} ${fh*.20} ${fw*cheek} ${-fh*.12} ${fw*.62} ${-fh*.42}
     C ${fw*.28} ${-fh*.58} ${-fw*.25} ${-fh*.58} ${-fw*.62} ${-fh*.42} Z`,
    model.skin,model.ink,1.24,seed+640);

  drawHorrorHair(ctx,object,model,fw,fh,0,seed+641);
  if(model.age>=50&&model.lod!=='far'){
    roughLine(ctx,[{x:-fw*.34,y:fh*.13},{x:-fw*.27,y:fh*.18}],model.shadow,.48,seed+642,.24);
    roughLine(ctx,[{x:fw*.27,y:fh*.18},{x:fw*.34,y:fh*.13}],model.shadow,.48,seed+643,.22);
  }

  const eyeY=-fh*.04;
  const eyeSpacing=fw*.28;
  const eyeShift=threeQuarter*fw*.075;
  const farSide=threeQuarter>0?-1:threeQuarter<0?1:0;
  for (const side of [-1,1] as const) {
    const far=side===farSide;
    ctx.fillStyle='#171919';
    ctx.beginPath();
    const openY=(explicitFear?4.75:4.15)*Math.max(.08,face.eyesOpen)*(far?.82:1);
    const eyeWidth=(explicitFear?3.05:2.65)*(far?.86:1);
    ctx.ellipse(side*eyeSpacing+eyeShift+face.pupilX*.8,eyeY+face.pupilY*.7,eyeWidth,openY,0,0,Math.PI*2);
    ctx.fill();
  }
  if(Math.abs(threeQuarter)>.18&&model.lod!=='far'){
    const nx=threeQuarter*fw*.085;
    roughLine(ctx,[{x:nx,y:eyeY+2},{x:nx+threeQuarter*1.3,y:eyeY+6}],model.shadow,.55,seed+648,.32);
  }
  if(explicitFear){
    // Minimal raised brows are enough to make the expression beat visible
    // without turning the restrained horror face into a cartoon reaction.
    roughLine(ctx,[{x:-eyeSpacing-4,y:eyeY-7},{x:-eyeSpacing+3,y:eyeY-9}],model.shadow,.9,seed+646,.2);
    roughLine(ctx,[{x:eyeSpacing-3,y:eyeY-9},{x:eyeSpacing+4,y:eyeY-7}],model.shadow,.9,seed+647,.2);
  }

  // Speech follows the measured envelope; silent fear may keep a tiny open
  // mouth, but idle narration never flaps the actor.
  const open=voiceActive?face.mouthOpen:explicitFear?.20:0;
  if (open > .05) {
    ctx.strokeStyle='#3b2722';ctx.lineWidth=.9;ctx.lineCap='round';
    ctx.beginPath();
    ctx.ellipse(threeQuarter*fw*.035,fh*.24,2.15*Math.max(.7,face.mouthWidth),Math.max(.4,open*2.05),0,0,Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

export function drawCharacterV2(
  ctx: CanvasRenderingContext2D,
  object: CanvasStudioObject,
  scene: CanvasStudioScene,
  timeMs: number,
  voiceActive = true,
  speechLevel?: number,
  includeArms = true,
) {
  const {model,rig} = resolveStageCharacterRig(object, scene, timeMs, voiceActive);
  const exposed = object.pose === 'float-body' || object.recliningStyle === 'exposed';
  const reclined = exposed || object.pose === 'lie-down' || object.pose === 'cover-face';
  // The authored mattress has its pillow on the left. Standing gaze direction
  // must not flip a reclining face vertically after the body is rotated.
  const facing = !reclined && object.facing === 'left' ? -1 : 1;

  // Close LOD increases facial detail; framing belongs to the camera. Never
  // delete legs that may still be inside the frame.
  const scale = characterDrawingScale(object, model);

  ctx.save();
  if (model.lod === 'close') ctx.translate(0, object.height / scale * .055);
  if (reclined) ctx.rotate(-Math.PI / 2);
  ctx.scale(facing * scale, scale);
  if (!reclined || exposed) {
    if(!exposed&&object.waterlineY===undefined)drawGroundShadow(ctx, model, Math.max(rig.footL.y, rig.footR.y) + 4.5,[rig.footL,rig.footR],object);
    drawLegs(ctx, rig, model, object);
  }
  drawTorso(ctx, rig, model, scene, object);
  ctx.save();
  ctx.translate(rig.head.x, rig.head.y);
  const lookTarget=scene.objects.find(o=>o.id===object.lookAtId);
  if(!reclined&&lookTarget?.kind==='character'){
    // A small three-quarter turn accompanies eye contact. Keep the skull,
    // hair and face in one transform, and the neck attached to the collar.
    const turn=Math.sign(lookTarget.x-object.x)*facing;
    ctx.translate(turn*2.2,0);ctx.scale(.96,1);
  }
  // The resting body lies across the mattress, but the face turns toward the
  // viewer. Rotating the entire standing head sideways makes it read as a prop.
  if (reclined) ctx.rotate(Math.PI / 2 - .12);
  ctx.rotate(rig.headTilt * Math.PI / 180);
  ctx.translate(0, -rig.head.y);
  // Face contour, eyes, ears and hair share one head-local coordinate frame.
  drawFace(ctx, exposed?{...object,pose:'lie-down'}:object, {...rig,head:{x:0,y:rig.head.y}}, model, scene, timeMs, exposed?false:voiceActive, speechLevel);
  ctx.restore();
  // Draw the complete limb in front, including sleeves and gripping hands.
  // Splitting it around the torso leaves detached forearms in raised poses.
  if (!reclined || exposed) drawArms(ctx, rig, model, scene, object,includeArms?'both':'L');
  if (reclined && !exposed) {
    const top = blanketTopAt(object, timeMs);
    const bodyTop = -8;
    const cloth = ctx.createLinearGradient(-24, 0, 24, 0);
    cloth.addColorStop(0, '#655c4b');
    cloth.addColorStop(.45, '#92836a');
    cloth.addColorStop(1, '#514b40');
    // A low rounded volume follows the reclining body; a tall rectangle reads
    // as a standing box even when the actor underneath has the correct pose.
    filledPath(ctx, `M -15 ${bodyTop+2} Q 0 ${bodyTop-4} 15 ${bodyTop+2} L 12 46 Q 0 52 -14 49 Z`, cloth, model.ink, 1.15, model.seed + 910);
    roughLine(ctx, [{x:-13,y:bodyTop+5},{x:0,y:bodyTop+1},{x:13,y:bodyTop+5}], '#b2a084', .8, model.seed+911, .65);
    roughLine(ctx, [{x:-9,y:bodyTop+12},{x:-6,y:20},{x:-10,y:43}], '#423d35', .8, model.seed+912, .45);
    roughLine(ctx, [{x:9,y:bodyTop+12},{x:6,y:28},{x:10,y:45}], '#b0a087', .7, model.seed+913, .4);
    if (object.pose === 'cover-face') {
      const progress = (-8 - top) / 18;
      const edge = 23 - progress * 22;
      ctx.save(); ctx.rotate(Math.PI / 2);
      const lowerEdge = Math.max(edge + 5, 17);
      filledPath(ctx, `M -55 ${edge+2} Q -34 ${edge-2} -10 ${edge} L 48 14 Q -4 ${lowerEdge+2} -55 ${lowerEdge} Z`, cloth, model.ink, 1, model.seed+914);
      roughLine(ctx,[{x:-53,y:edge+4},{x:-34,y:edge+1},{x:-12,y:edge+3}], '#b2a084', .8, model.seed+915, .65);
      for (const x of [-52, -13]) {
        ctx.fillStyle = model.skin;
        ctx.strokeStyle = model.ink;
        ctx.lineWidth = .8;
        ctx.beginPath(); ctx.ellipse(x, edge+2, 3.1, 2.2, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}
