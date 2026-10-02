import {resolveStageCharacterRig} from './characterStaging';
import type { CanvasStudioObject, CanvasStudioScene } from '../types';
import { blanketTopAt, characterDrawingScale, characterRnd, resolveCharacterModel, resolveFaceParams, type CharacterModel } from './characterModel';
import { resolveCharacterRig, type CharacterPoint, type CharacterRig } from './characterRig';
import { canvasActingTiming } from '../choreography';
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

function drawGroundShadow(ctx: CanvasRenderingContext2D, model: CharacterModel, baseline = 50.2) {
  ctx.save();
  ctx.globalAlpha = model.horror ? .22 : .11;
  const radius=model.shoulderWidth*.6;
  const shade=ctx.createRadialGradient(0,baseline,0,0,baseline,radius);
  shade.addColorStop(0,'#11110f');shade.addColorStop(1,'rgba(17,17,15,0)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(0, baseline, radius, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
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
  roughLine(ctx, points, model.ink, width + 2.1, seed, .95, cap, false);
  roughLine(ctx, points, fill, width, seed + 91, .98, cap, false);
}

function drawLegs(ctx: CanvasRenderingContext2D, rig: CharacterRig, model: CharacterModel, object:CanvasStudioObject) {
  const line = model.lod === 'far' ? 4.6 : 6.4;
  drawLimb(ctx, [rig.hipL, rig.kneeL, rig.footL], model.secondary, model, model.seed + 401, line, 'butt');
  drawLimb(ctx, [rig.hipR, rig.kneeR, rig.footR], model.secondary, model, model.seed + 411, line, 'butt');

  const shoe = (p: CharacterPoint, seed: number) => {
    // footL/R are ankle anchors. Shoes extend BELOW them and enclose the
    // trouser endpoint; a rounded calf cap must never protrude below the sole.
    const d = `M ${p.x - 4.3} ${p.y - 1} Q ${p.x} ${p.y - 1.8} ${p.x + 4.3} ${p.y - .5} L ${p.x + 5.1} ${p.y + 2.5} Q ${p.x + 4.3} ${p.y + 4.5} ${p.x} ${p.y + 4.5} Q ${p.x - 4.3} ${p.y + 4.5} ${p.x - 4.3} ${p.y + 2.5} Z`;
    filledPath(ctx, d, '#423b36', model.ink, .9, seed);
  };
  shoe(rig.footL, model.seed + 431);
  shoe(rig.footR, model.seed + 441);
  const bandageProgress=Math.max(0,Math.min(1,object.bandageProgress??1));
  if(object.legBandage && bandageProgress>0) {
    const knee=object.legBandage==='right'?rig.kneeR:rig.kneeL;
    const foot=object.legBandage==='right'?rig.footR:rig.footL;
    const at=(t:number)=>({x:knee.x+(foot.x-knee.x)*t,y:knee.y+(foot.y-knee.y)*t});
    drawLimb(ctx,[at(.28),at(.28+.35*bandageProgress)],'#dbd4bb',model,model.seed+445,line+1.8);
    if(bandageProgress>.65)roughLine(ctx,[at(.4),at(.51)],'#a09a86',.6,model.seed+446,.6);
  }
}

function drawHand(ctx:CanvasRenderingContext2D,p:CharacterPoint,model:CharacterModel,seed:number,pointing=false) {
  const side=p.x<0?-1:1;
  ctx.save();ctx.translate(p.x,p.y);ctx.scale(side,1);
  filledPath(ctx,'M -2 -1.6 Q -2.6 -3 0 -2.6 L 2.4 -1.7 Q 4 -1 3.4 .4 L 2.2 2.1 Q -.3 3 -2 1.1 L -3.2 .4 Q -3.7 -.8 -2 -1.6 Z',model.skin,model.ink,.7,seed);
  roughLine(ctx,[{x:.4,y:.2},{x:2.1,y:.8}],model.shadow,.45,seed+1,.6);
  roughLine(ctx,[{x:.1,y:1.1},{x:1.6,y:1.5}],model.shadow,.4,seed+2,.5);
  if (pointing) drawLimb(ctx,[{x:1,y:-.8},{x:6,y:-1.5}],model.skin,model,seed+3,1.25);
  ctx.restore();
}

function drawArms(ctx: CanvasRenderingContext2D, rig: CharacterRig, model: CharacterModel, scene: CanvasStudioScene, object: CanvasStudioObject) {
  const sleeve = model.lod === 'far' ? 3.1 : 4.5;
  const fore = model.lod === 'far' ? 2.5 : 3.5;
    drawLimb(ctx, [rig.shoulderL, rig.elbowL], model.primary, model, model.seed + 501, sleeve);
    drawLimb(ctx, [rig.shoulderR, rig.elbowR], model.primary, model, model.seed + 511, sleeve);
  drawLimb(ctx, [rig.elbowL, rig.handL], model.skin, model, model.seed + 521, fore);
  drawLimb(ctx, [rig.elbowR, rig.handR], model.skin, model, model.seed + 531, fore);

  if (model.lod !== 'far') {
    drawHand(ctx,rig.handL,model,model.seed+541);
    const gripping=scene.objects.some(prop=>prop.heldBy===object.id);
    drawHand(ctx,rig.handR,model,model.seed+551,object.pose==='point'&&!gripping);
    if(object.pose==='wipe'){
      const {x,y}=rig.handR;
      filledPath(ctx,`M ${x-3} ${y-3} L ${x+4} ${y-2} L ${x+3} ${y+4} L ${x-4} ${y+3} Z`,'#e3dbbc',model.ink,.5,model.seed+552);
    }
    if(object.pose==='write'){
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
  const d = `M ${-sw} ${top} C ${-sw + 2} ${top - 5} ${sw - 2} ${top - 5} ${sw} ${top} L ${ww} ${bottom} C ${ww - 5} ${bottom + 4} ${-ww + 5} ${bottom + 4} ${-ww} ${bottom} Z`;
  filledPath(ctx, d, clothingGradient(ctx, model, scene, object), model.ink, 1.65, model.seed + 601);

  if (model.lod !== 'far') {
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

  // Neck bridges head and torso so the actor never reads as a floating icon.
  const neckHalf = model.lod === 'close' ? 4.8 : 4;
  const neckTop = rig.head.y + model.faceHeight * .43;
  const neckBottom = top + 2;
  const neck = `M ${rig.head.x-neckHalf} ${neckTop} L ${rig.chest.x-neckHalf+1} ${neckBottom} C ${rig.chest.x-1} ${neckBottom+2} ${rig.chest.x+1} ${neckBottom+2} ${rig.chest.x+neckHalf-1} ${neckBottom} L ${rig.head.x+neckHalf} ${neckTop} Z`;
  filledPath(ctx, neck, skinGradient(ctx, model, scene, object), model.ink, 1.05, model.seed + 651);
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
  const partner=scene.objects.find(actor=>actor.id===object.lookAtId)
    || scene.objects.find(actor=>actor.kind==='character'&&actor.id!==object.id);
  if(partner&&object.pose!=='lie-down'&&object.pose!=='cover-face'){
    const target=evaluateCanvasObject(partner,scene,timeMs);
    const actor=evaluateCanvasObject(object,scene,timeMs);
    const headY=actor.y+rig.head.y*characterDrawingScale(object,model);
    face.pupilX=Math.max(-.8,Math.min(.8,(target.x-actor.x)/250))*(object.facing==='left'?-1:1);
    const targetY=target.y-(partner.kind==='character'?partner.height*.28:0);
    face.pupilY=Math.max(-.35,Math.min(.35,(targetY-headY)/300));
  }
  const contour = faceContour(model, rig);
  if (model.lod !== 'far') {
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
  filledPath(ctx, contour, skinGradient(ctx, model, scene, object), model.ink, model.lod === 'far' ? 1 : 1.25, model.seed + 801);

  if (model.lod !== 'far') {
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

  const eyeY = rig.head.y - model.faceHeight * .055;
  const spacing = model.eyeSpacing;
  const eyeW = 4.55 * model.eyeScale;
  const eyeH = 2.7 * model.eyeScale * face.eyesOpen;

  const eye = (cx:number, seed:number) => {
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
    const px=cx+face.pupilX*1.15;
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
  const nx=model.asymmetryX*.5;
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
  ctx.save();ctx.strokeStyle=model.ink;ctx.lineWidth=1.12;ctx.lineCap='round';ctx.beginPath();
  if(face.mouthOpen>.12){
    ctx.ellipse(model.asymmetryX*.3,mouthY,mw*.5,Math.max(.8,face.mouthOpen*3.7),0,0,Math.PI*2);
  } else {
    ctx.moveTo(-mw,mouthY);
    ctx.quadraticCurveTo(0,mouthY+face.mouthCurve*3.2,mw,mouthY);
  }
  if(face.mouthOpen>.12){ctx.fillStyle=darken(model.skin,65);ctx.fill();}
  ctx.stroke();ctx.restore();
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

export function drawCharacterV2(
  ctx: CanvasRenderingContext2D,
  object: CanvasStudioObject,
  scene: CanvasStudioScene,
  timeMs: number,
  voiceActive = true,
  speechLevel?: number,
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
    if(!exposed&&object.waterlineY===undefined)drawGroundShadow(ctx, model, Math.max(rig.footL.y, rig.footR.y) + 4.5);
    drawLegs(ctx, rig, model, object);
  }
  drawTorso(ctx, rig, model, scene, object);
  ctx.save();
  ctx.translate(rig.head.x, rig.head.y);
  // The resting body lies across the mattress, but the face turns toward the
  // viewer. Rotating the entire standing head sideways makes it read as a prop.
  if (reclined) ctx.rotate(Math.PI / 2 - .12);
  const nod=voiceActive&&object.pose==='talk'?Math.sin((timeMs+model.seed%900)/540)*(model.horror?.7:1.2):0;
  ctx.rotate((rig.headTilt + nod + (model.horror ? Math.sin((timeMs + model.seed % 700) / 2300) * .35 : 0)) * Math.PI / 180);
  ctx.translate(0, -rig.head.y);
  // Face contour, eyes, ears and hair share one head-local coordinate frame.
  drawFace(ctx, exposed?{...object,pose:'lie-down'}:object, {...rig,head:{x:0,y:rig.head.y}}, model, scene, timeMs, exposed?false:voiceActive, speechLevel);
  ctx.restore();
  // Draw the complete limb in front, including sleeves and gripping hands.
  // Splitting it around the torso leaves detached forearms in raised poses.
  if (!reclined || exposed) drawArms(ctx, rig, model, scene, object);
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
