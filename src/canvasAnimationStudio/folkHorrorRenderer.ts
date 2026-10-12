import type { CanvasStudioObject, CanvasStudioScene } from './types';
import { folkCharacterScale, isFolkHorrorScene } from '../../shared/canvasFolkHorror';
import { evaluateCanvasObject } from './runtime';
import { evaluateObjectKeyframes } from './keyframes';
import { folkLimbGeometry, folkWorldPoint, isProceduralLongSpirit, resolveFolkGrip } from './folkHorrorContact';

const INK = '#101416', BONE = '#e1e0d0', HAIR = '#11131b';
function path(ctx: CanvasRenderingContext2D, d: string, fill: string) {
  const p = new Path2D(d); ctx.fillStyle = fill; ctx.strokeStyle = INK; ctx.lineWidth = 1.1; ctx.fill(p); ctx.stroke(p);
}

/** A ground detail belongs to the victim; a cropped background spirit must
 * not leave giant disconnected limbs behind the top captions. */
export function hideFolkBackgroundSpirit(scene: CanvasStudioScene, object: CanvasStudioObject) {
  return isFolkHorrorScene(scene) && isProceduralLongSpirit(object) && object.role !== 'focal'
    && !scene.animationBeats?.some(beat => ['grab','pull','release','aid','assist'].includes(beat.action))
    && scene.objects.some(actor => actor.kind === 'character' && actor.role === 'focal'
      && actor.appearance !== 'long-limbed-spirit' && (actor.pose === 'lie-down' || Math.abs(actor.rotation) >= 60));
}

/** Walk only while an authored travel track moves; held poses must stay still. */
export function folkActingState(object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number) {
  const grip = scene.objects.filter(isProceduralLongSpirit).map(source => resolveFolkGrip(scene, source, timeMs))
    .find(contact => contact?.victim.id === object.id && contact.progress > .85);
  const frame = evaluateCanvasObject(object, scene, timeMs);
  const fallen = Math.abs(frame.rotation) > 60;
  const before = evaluateObjectKeyframes(object.keyframes, Math.max(0, timeMs - 80));
  const after = evaluateObjectKeyframes(object.keyframes, Math.min(scene.durationMs, timeMs + 80));
  const presetWalk = ['walk-left', 'walk-right'].includes(object.motion)
    && timeMs >= (object.delayMs || 0) && timeMs < (object.delayMs || 0) + (object.motionDurationMs || 520);
  const walking = !grip && !fallen && (Math.abs(after.dx - before.dx) > .25 || presetWalk);
  return { walking, gait: walking ? Math.sin(timeMs / 170) : 0, gripped: Boolean(grip) && !fallen, fallen };
}

export function drawFolkCharacter(ctx: CanvasRenderingContext2D, object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number, speaking: boolean) {
  const ghost = object.appearance === 'long-limbed-spirit';
  ctx.save(); ctx.scale(folkCharacterScale(object) * (object.facing === 'left' ? -1 : 1), folkCharacterScale(object));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (ghost) {
    // Hair frames a readable skull face. Its outer contour stays visible on a
    // dark set, rather than becoming the tiny bent head of the former rig.
    path(ctx, 'M -23 26 Q -27 2 -24 -29 Q -24 -56 -3 -58 Q 20 -59 24 -32 Q 29 -3 25 29 L 15 19 L -15 20 Z', HAIR);
    ctx.strokeStyle = '#41414a'; ctx.lineWidth = .75;
    ctx.stroke(new Path2D('M -23 26 Q -27 -7 -21 -37 Q -17 -55 -3 -58 Q 17 -58 22 -36 Q 28 -8 25 29'));
    path(ctx, 'M -14 -23 Q -21 -22 -23 -9 L -27 24 Q -27 29 -23 30 L -20 27 L -17 -7 Z', BONE);
    path(ctx, 'M 14 -23 Q 21 -22 23 -9 L 27 24 Q 27 29 23 30 L 20 27 L 17 -7 Z', BONE);
    path(ctx, 'M -13 -23 Q 0 -28 13 -23 Q 17 -10 16 9 L 22 34 L 14 31 L 9 40 L 3 33 L -3 38 L -9 33 L -16 39 L -22 33 L -16 9 Z', BONE);
    path(ctx, 'M -6 -26 L -5 -19 L 1 -14 L 6 -21 L 6 -28 Z', '#cccbbb');
    path(ctx, 'M -10 -43 Q -1 -50 10 -43 L 10 -32 Q 9 -22 2 -19 Q -7 -20 -10 -30 Z', BONE);
    path(ctx, 'M -18 -42 Q -12 -57 0 -55 L -5 -42 L -11 -28 L -13 8 L -18 28 L -20 21 L -19 -13 Z', HAIR);
    path(ctx, 'M 3 -55 Q 20 -51 19 -35 L 20 -9 L 23 22 L 19 30 L 14 12 L 12 -22 L 9 -39 Z', HAIR);
    ctx.strokeStyle = '#57565a'; ctx.lineWidth = .45;
    ctx.stroke(new Path2D('M -14 -43 Q -17 -23 -16 17 M 15 -38 Q 15 -8 19 20'));
    ctx.strokeStyle = '#8f9184'; ctx.lineWidth = .55;
    ctx.stroke(new Path2D('M -11 -5 L -12 24 M 10 -3 L 14 28 M -4 7 L -6 31'));
  } else {
    const acting = folkActingState(object, scene, timeMs);
    // Short trousers and an uneven hem preserve the reference's block-like
    // simplicity while giving a traveler a visible weight-bearing stance.
    ctx.strokeStyle = '#2d2925'; ctx.lineWidth = 6;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(side * 8, 28);
      ctx.lineTo(side * 8 + acting.gait * side * 3, 36);
      ctx.lineTo(side * 8 + acting.gait * side * 5, 39); ctx.stroke();
    }
    path(ctx, 'M -5 -22 L 5 -22 L 5 -13 L -5 -13 Z', BONE);
    path(ctx, 'M -17 -15 Q -10 -19 0 -18 Q 10 -19 17 -15 L 18 31 Q 0 34 -18 31 Z', object.color || '#75674e');
    path(ctx, 'M -6 -17 L 0 -11 L 6 -17 L 5 -12 L 0 -7 L -5 -12 Z', '#655744');
    ctx.strokeStyle = '#463c31'; ctx.lineWidth = .6;
    ctx.stroke(new Path2D('M 0 -7 L 0 31 M -15 20 L -9 22 M 10 25 L 15 23'));
    for (const side of [-1, 1]) {
      const handX = acting.gripped ? side * 8 : side * 21 + acting.gait * side * 2;
      const handY = acting.gripped ? -18 : 28 + acting.gait * side * 5;
      ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(side * 16, -9);
      ctx.lineTo(side * (acting.gripped ? 23 : 21), acting.gripped ? -1 : 10);
      ctx.lineTo(handX, handY); ctx.stroke();
      ctx.fillStyle = BONE; ctx.beginPath(); ctx.arc(handX, handY, 2.3, 0, Math.PI * 2); ctx.fill();
    }
    for (const y of [-3, 7, 17, 27]) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0, y, .8, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = BONE; ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, -35, 14, 16, -.06, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#080d14';
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * (ghost ? 4 : 5), ghost ? -35 : -36, ghost ? 2.5 : 3.4, ghost ? 5.1 : 5, side * .15, 0, Math.PI * 2); ctx.fill(); }
  const open = speaking ? 1 + Math.max(0, Math.sin(timeMs / 85)) * 2 : 1;
  ctx.beginPath(); ctx.ellipse(ghost ? 1 : 0, ghost ? -24 : -26, ghost ? 2 : 2.8, 2 + open, -.1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawFolkTree(ctx: CanvasRenderingContext2D, object: CanvasStudioObject) {
  const w = object.width, h = object.height;
  ctx.save(); ctx.scale(w / 100, h / 100);
  path(ctx, 'M -48 -23 Q -56 -39 -43 -49 Q -29 -64 -14 -60 Q -2 -69 17 -58 Q 36 -60 45 -45 Q 56 -36 48 -21 Q 29 -14 9 -19 Q -15 -12 -33 -19 Z', '#1a2a21');
  path(ctx, 'M -37 -43 Q -16 -58 6 -51 Q 26 -54 39 -39 L 15 -40 L -4 -35 L -25 -38 Z', '#23382a');
  path(ctx, 'M -44 -25 Q -23 -39 -8 -29 L 13 -25 Q -14 -22 -29 -19 Z', '#203125');
  path(ctx, 'M -7 -25 L 5 -25 L 7 46 L 16 50 L 8 49 L -4 49 L -15 50 L -8 46 Z', '#5b4b36');
  path(ctx, 'M -2 -20 L 28 -21 L 39 -25 L 37 -21 L 25 -17 L 1 -14 Z', '#65533c');
  path(ctx, 'M -5 -26 L -28 -36 L -39 -34 L -29 -33 L -4 -22 Z', '#65533c');
  ctx.strokeStyle = '#38382a'; ctx.lineWidth = .55;
  ctx.stroke(new Path2D('M -4 -18 L -3 43 M 3 -6 L 4 31 M -10 47 L -18 51 M 9 48 L 18 51'));
  ctx.restore();
}

export function drawFolkBackground(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, width: number, height: number) {
  if (!scene.backgroundRef?.startsWith('bg:folk-')) return false;
  const day = scene.backgroundRef === 'bg:folk-day-field';
  const sky = ctx.createLinearGradient(0, 0, 0, height * .73);
  sky.addColorStop(0, day ? '#a7b3a8' : '#17232d');
  sky.addColorStop(1, day ? '#899c8b' : '#080f13');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  if (!day) {
    ctx.fillStyle = '#151e25'; ctx.beginPath(); ctx.arc(width * .15, height * .40, width * .08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BONE; ctx.beginPath(); ctx.arc(width * .15, height * .40, width * .035, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = day ? '#6d7957' : '#1b2b22'; ctx.fillRect(0, height * .73, width, height * .27);
  ctx.fillStyle = day ? '#5b6c4e' : '#14251c';
  ctx.beginPath(); ctx.moveTo(0, height * .76); ctx.quadraticCurveTo(width * .4, height * .71, width, height * .78);
  ctx.lineTo(width, height * .82); ctx.quadraticCurveTo(width * .4, height * .76, 0, height * .81); ctx.fill();
  ctx.fillStyle = '#413b2a'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, height * .91); ctx.quadraticCurveTo(width * .48, height * .79, width, height * .88);
  ctx.lineTo(width, height * .93); ctx.quadraticCurveTo(width * .48, height * .84, 0, height * .96); ctx.closePath(); ctx.fill(); ctx.stroke();
  return true;
}

/** Draw in scene coordinates after bodies, so the endpoints use the victim's current transform. */
export function drawFolkContactLimbs(ctx: CanvasRenderingContext2D, scene: CanvasStudioScene, timeMs: number) {
  if (!isFolkHorrorScene(scene)) return;
  for (const source of scene.objects.filter(isProceduralLongSpirit)) {
    if (hideFolkBackgroundSpirit(scene, source)) continue;
    const sourceFrame = evaluateCanvasObject(source, scene, timeMs);
    const grip = resolveFolkGrip(scene, source, timeMs);
    const victimFrame = grip ? evaluateCanvasObject(grip.victim, scene, timeMs) : undefined;
    ctx.save(); ctx.globalAlpha = Math.min(sourceFrame.opacity, victimFrame?.opacity ?? sourceFrame.opacity);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const thickness = folkCharacterScale(source) * sourceFrame.scale * 3.2;
    for (const side of [-1, 1] as const) {
      const limb = folkLimbGeometry(source, sourceFrame, grip?.victim, victimFrame, grip?.progress || 0, side);
      for (const [color, lineWidth] of [[INK, thickness + 2], [BONE, thickness]] as const) {
        ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.beginPath(); ctx.moveTo(limb.start.x, limb.start.y);
        ctx.quadraticCurveTo(limb.control.x, limb.control.y, limb.end.x, limb.end.y); ctx.stroke();
      }
    }
    if (grip?.wrapped && victimFrame) {
      const center = folkWorldPoint(grip.victim, victimFrame, 0, -19);
      ctx.translate(center.x, center.y); ctx.rotate(victimFrame.rotation * Math.PI / 180);
      ctx.strokeStyle = BONE; ctx.lineWidth = thickness;
      ctx.beginPath(); ctx.ellipse(0, 0, folkCharacterScale(grip.victim) * victimFrame.scale * 9, thickness * .5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}
