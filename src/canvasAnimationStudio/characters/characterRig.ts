import type { CanvasStudioObject } from '../types';
import { blanketTopAt, characterRnd, type CharacterModel } from './characterModel';

export type CharacterPoint = { x: number; y: number };

export type CharacterRig = {
  pelvis: CharacterPoint;
  chest: CharacterPoint;
  neck: CharacterPoint;
  head: CharacterPoint;
  shoulderL: CharacterPoint;
  elbowL: CharacterPoint;
  handL: CharacterPoint;
  shoulderR: CharacterPoint;
  elbowR: CharacterPoint;
  handR: CharacterPoint;
  hipL: CharacterPoint;
  kneeL: CharacterPoint;
  footL: CharacterPoint;
  hipR: CharacterPoint;
  kneeR: CharacterPoint;
  footR: CharacterPoint;
  breath: number;
  headTilt: number;
};

const dist = (a: CharacterPoint, b: CharacterPoint) => Math.hypot(b.x - a.x, b.y - a.y);

export function solveTwoBoneIk(root: CharacterPoint, target: CharacterPoint, upper: number, lower: number, bend: 1 | -1): { joint: CharacterPoint; end: CharacterPoint } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const raw = Math.hypot(dx, dy);
  const d = Math.max(Math.abs(upper-lower)+.001, Math.min(raw, upper + lower - .001));
  const base = Math.atan2(dy, dx);
  const cosA = Math.max(-1, Math.min(1, (upper * upper + d * d - lower * lower) / (2 * upper * d)));
  const a = Math.acos(cosA) * bend;
  const joint = { x: root.x + Math.cos(base + a) * upper, y: root.y + Math.sin(base + a) * upper };
  const end = Math.abs(d-raw)>.00001 ? {
    x: root.x + Math.cos(base) * d,
    y: root.y + Math.sin(base) * d,
  } : target;
  return { joint, end };
}

function armTargets(object: CanvasStudioObject, model: CharacterModel, timeMs: number, voiceActive: boolean, gestureTimeMs: number) {
  const pose = object.pose || 'idle';
  const wave = Math.sin(gestureTimeMs / 190);
  const horrorRest = model.horror && ['idle','talk','gesture','nod'].includes(pose);
  const relaxLeft = horrorRest && characterRnd(model.seed, 300) > .5;
  const armReach=model.armLength+model.forearmLength;
  const lowY=armReach*.82;
  const bentY=armReach*.72;
  const left = horrorRest ? {
    // Rest targets scale with the actual arm kit. This keeps a visible elbow
    // bend even when a compact horror character has shorter upper/lower arms.
    x: -model.shoulderWidth / 2 - (relaxLeft ? .9 : 1.8) - characterRnd(model.seed, 301) * .28,
    y: (relaxLeft ? lowY : bentY) + characterRnd(model.seed, 302) * .35,
  } : {
    x: -model.shoulderWidth / 2 - 1,
    y: Math.min(26,armReach*.84),
  };
  const right = horrorRest ? {
    x: model.shoulderWidth / 2 + (relaxLeft ? 1.8 : .9) + characterRnd(model.seed, 303) * .28,
    y: (relaxLeft ? bentY : lowY) + characterRnd(model.seed, 304) * .35,
  } : {
    x: model.shoulderWidth / 2 + 1,
    y: Math.min(26,armReach*.84),
  };

  if (pose === 'lie-down' || pose === 'cover-face') return {
    left: { x: -18, y: pose === 'cover-face' ? blanketTopAt(object, timeMs) + 1 : -6 },
    right: { x: 18, y: pose === 'cover-face' ? blanketTopAt(object, timeMs) + 1 : -6 },
  };

  if (pose === 'point') return { left, right: { x: 49, y: -8 } };
  if (pose === 'gesture') return {left,right:{x:29,y:7}};
  if(pose==='struggle'){
    const effort=Math.sin(Math.min(gestureTimeMs,2400)/500*Math.PI)*2;
    return {left:{x:-30,y:-18+effort},right:{x:30,y:-12-effort}};
  }
  if(pose==='float-body')return {left:{x:-17,y:32},right:{x:16,y:36}};
  if (['reach','wipe','write','tie','aid','assist'].includes(pose)) return {
    left,
    right: pose==='reach'&&model.horror ? {x:40,y:7} : {x:29,y:12},
  };
  if (pose === 'talk') {
    // Speech owns the mouth. Only an authored action may move the arms.
    return {left,right};
  }
  if (pose === 'brace') return model.horror ? (object.expression==='surprised' ? {
    // Startle is not the same as a defensive hold: one hand flashes toward the
    // face while the other stays lower, producing a quick asymmetric recoil.
    left: { x: -model.shoulderWidth*.32, y: 18.5 },
    right: { x: model.shoulderWidth*.10, y: 3.5 },
  } : {
    // Protective horror silhouette: both hands rise into the upper torso,
    // asymmetric enough to read at phone size but never a cartoon T-pose.
    left: { x: -model.shoulderWidth*.24, y: 14.5 },
    right: { x: model.shoulderWidth*.20, y: 9.5 },
  }) : {
    left: { x: -13, y: 8 },
    right: { x: 13, y: 8 },
  };
  if (pose === 'celebrate') return {
    left: { x: -28, y: -31 },
    right: { x: 28, y: -31 },
  };
  if (pose === 'row') return {
    left: { x: 6 + wave * 5, y: 8 + wave * 3 },
    right: { x: 27 + wave * 6, y: 22 + wave * 5 },
  };
  if (pose === 'run') return {
    left: { x: left.x + wave * 3, y: left.y - 4 - wave * 4 },
    right: { x: right.x - wave * 3, y: right.y - 4 + wave * 4 },
  };
  return { left, right };
}

export function resolveCharacterRig(object: CanvasStudioObject, model: CharacterModel, timeMs: number, voiceActive = true, gestureTimeMs = timeMs, poseWeight = 1, travelDistance?: number, pointTarget?: CharacterPoint, holdingPhone = false, restPose?: CanvasStudioObject['pose']): CharacterRig {
  // Limited-animation moving hold: horror actors are never frozen cutouts,
  // but the amplitude stays far below explainer/cartoon idle loops.
  const phase=characterRnd(model.seed,96)*Math.PI*2;
  // The horror reference is pose-hold animation, not a continuous idle loop.
  // Body motion only comes from authored/semantic beats; atmosphere carries
  // the shot between poses.
  const breath = model.horror ? 0 : Math.sin(timeMs/900+phase)*.55;
  const weight = Math.max(0, Math.min(1, poseWeight));
  const effectivePose=(model.horror&&weight<=.001)?(restPose||'idle'):(object.pose||'idle');
  const locomoting=object.pose==='run'||(object.pose==='assist'&&travelDistance!==undefined&&Math.abs(travelDistance)>.01);
  const walk = locomoting ? Math.sin(gestureTimeMs / 190) * weight : 0;
  // Crouching lowers the whole torso while feet stay on their standing plane.
  const crouch = object.pose === 'aid' ? 12 * weight
    :object.pose==='reach'&&pointTarget?Math.min(22,Math.max(0,pointTarget.y-22))*weight:0;
  // Bend the upper torso for a low grip without lowering the pelvis past
  // planted feet (which would hide both calves under the shirt).
  const bend=object.pose==='reach'&&pointTarget?Math.min(14,Math.max(0,pointTarget.y-42))*weight:0;
  const quietHorror = model.horror && ['idle','talk','gesture','nod','brace'].includes(effectivePose);
  const movingHold=0;
  const stanceX = quietHorror
    ? (characterRnd(model.seed, 305) - .5) * 2.0
    : 0;
  const pelvis = { x: stanceX, y: (model.horror?21.5:24) + breath * .25 + crouch };
  // Horror body acting is controlled by pose/action beats. Facial fear must
  // never silently invent a different body silhouette.
  const torsoSpan=model.horror
    ? Math.max(23.5,Math.min(25.8,model.torsoHeight*.645))
    : Math.max(25,Math.min(27,model.torsoHeight*.74));
  const neckSpan=model.horror
    ? Math.max(3.2,Math.min(4.2,model.faceHeight*.105))
    : 12;
  const headSpan=model.horror
    ? Math.max(11.4,Math.min(13.2,model.faceHeight*.36))
    : 20;
  const actionLean=model.horror
    ? effectivePose==='brace'?-2.2*weight:effectivePose==='gesture'?.7*weight:0
    :0;
  const chest = {
    x: pelvis.x + (quietHorror ? (characterRnd(model.seed, 306) - .5) * 2.4 + movingHold*.34 : 0)+actionLean,
    y: pelvis.y - torsoSpan + bend - breath*.16,
  };
  const neck = {
    x: chest.x + (quietHorror ? (characterRnd(model.seed, 307) - .5) * .8 + movingHold*.12 : 0),
    y: chest.y - neckSpan,
  };
  const head = {
    x: neck.x,
    y: neck.y - headSpan - (model.horror ? breath*.08 : 0),
  };
  if(object.pose==='nod'){
    // One readable pose-to-pose nod: anticipation is handled by the acting
    // envelope, then the skull dips and settles with the whole neck attached.
    head.y+=2.4*weight;
  }
  const shoulderL = { x: chest.x - model.shoulderWidth / 2, y: chest.y - 2 };
  const shoulderR = { x: chest.x + model.shoulderWidth / 2, y: chest.y - 2 };
  const gaitTime = locomoting && travelDistance!==undefined ? travelDistance/20*Math.PI*2*190 : gestureTimeMs;
  const targets = armTargets(object, model, timeMs, voiceActive, gaitTime);
  if(model.horror){
    targets.left.x+=chest.x;
    targets.right.x+=chest.x;
  }
  if (['point','reach','wipe','write','tie','aid','assist'].includes(object.pose||'') && pointTarget && Number.isFinite(pointTarget.x) && Number.isFinite(pointTarget.y)) {
    const dx=pointTarget.x-shoulderR.x,dy=pointTarget.y-shoulderR.y;
    const distance=Math.hypot(dx,dy);
    const reach=Math.min(distance,(model.armLength+model.forearmLength)*.99);
    if(distance>.001) targets.right={x:shoulderR.x+dx/distance*reach,y:shoulderR.y+dy/distance*reach};
    const cycle=Math.sin(gestureTimeMs/(object.pose==='write'?105:240));
    if(object.pose==='wipe')targets.right.y+=cycle*3;
    if(object.pose==='write'){targets.right.x+=cycle*1.5;targets.right.y+=Math.cos(gestureTimeMs/155)*.8-3;}
    if(object.pose==='tie'){targets.right.y+=cycle*1.6;targets.left={x:targets.right.x-7,y:targets.right.y+2};}
    if(object.pose==='aid'){targets.right.y+=cycle*.7;targets.left={x:targets.right.x-6,y:targets.right.y+2};}
  }
  const contactTarget={...targets.right};
  const raisedContact=pointTarget&&contactTarget.y<shoulderR.y+8;
  if (object.pose !== 'lie-down' && object.pose !== 'cover-face') {
    const rest = armTargets({ ...object, pose: restPose || 'idle' }, model, timeMs, false, 0);
    if(model.horror){rest.left.x+=chest.x;rest.right.x+=chest.x;}
    for (const side of ['left', 'right'] as const) {
      targets[side] = { x: rest[side].x + (targets[side].x - rest[side].x) * weight, y: rest[side].y + (targets[side].y - rest[side].y) * weight };
    }
  }
  // Elbows bend outside the ribcage; inward elbows disappear under the shirt
  // and leave forearms looking like detached sticks.
  if(object.pose==='reach'&&crouch>0)targets.left.y+=crouch;
  const leftArm = solveTwoBoneIk(shoulderL, targets.left, model.armLength, model.forearmLength, -1);
  // A phone grip stays beside the ear, with the elbow outside the shoulder.
  // It is an attachment constraint, independent of talking/pointing envelopes.
  if (holdingPhone) targets.right = {x:head.x+model.faceWidth*.5+7,y:head.y+7};
  // A raised contact needs the elbow BELOW the hand. The resting branch
  // points outwards, but using it for every target folds a supporting arm
  // over the shoulder and makes its forearm hang down from the contact.
  if(raisedContact&&!holdingPhone){
    // Switch elbow branches only at full extension. Switching at a height
    // threshold teleports the elbow across the arm during lead-in/recovery.
    const length=model.armLength+model.forearmLength-.001;
    const extended={x:shoulderR.x+length*.8,y:shoulderR.y+length*.6};
    const rest=armTargets({...object,pose:'idle'},model,timeMs,false,0).right;
    const from=weight<.35?rest:extended,to=weight<.35?extended:contactTarget;
    const fraction=weight<.35?weight/.35:(weight-.35)/.65;
    targets.right={x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction};
  }
  const rightArm = solveTwoBoneIk(shoulderR, targets.right, model.armLength, model.forearmLength, holdingPhone || (raisedContact&&weight>=.35) ? 1 : -1);

  const hipL = { x: -7, y: pelvis.y };
  const hipR = { x: 7, y: pelvis.y };
  const activeLocomotion = locomoting && weight > .001;
  const legSum=model.thighLength+model.shinLength;
  const idleReach=legSum*.995;
  const gaitReach=legSum*(model.horror?.965:.985);
  const standingFootY = pelvis.y - crouch + (activeLocomotion
    ? Math.sqrt(Math.max(4,gaitReach*gaitReach-(model.horror?11:7)**2))
    : Math.sqrt(Math.max(4,idleReach*idleReach-9)));
  const horrorFootL = model.horror ? -7.8 - characterRnd(model.seed, 309) * 4.4 : -10;
  const horrorFootR = model.horror ? 8.2 + characterRnd(model.seed, 310) * 4.1 : 10;
  const horrorFootLiftL = model.horror ? characterRnd(model.seed, 311) * 1.2 : 0;
  const horrorFootLiftR = model.horror ? characterRnd(model.seed, 312) * .7 : 0;
  const gaitLift=model.horror?1.55:2.8;
  const leftFootTarget = activeLocomotion
    ? { x: -10 + walk * 8, y: standingFootY - Math.max(0, walk) * gaitLift }
    : { x: horrorFootL - (object.pose === 'brace' && model.horror ? 1.8 : 0), y: standingFootY - horrorFootLiftL };
  const rightFootTarget = activeLocomotion
    ? { x: 10 - walk * 8, y: standingFootY - Math.max(0, -walk) * gaitLift }
    : { x: horrorFootR + (object.pose === 'brace' && model.horror ? 2.2 : 0), y: standingFootY - horrorFootLiftR };
  const heldSeated=Boolean(object.sittingStyle)&&!['run','row','assist','aid','reach','tie','wipe','write','struggle','sink','surface','float-body','lie-down','cover-face'].includes(object.pose||'idle');
  if(object.pose==='sit'||object.onBoat||heldSeated) {
    // Front-view sitting: thighs open symmetrically; calves drop vertically.
    // A visual pose change (brace/point/gesture) may move the upper body while
    // the established chair/ground posture stays planted.
    // Both feet remain below their knees rather than folding under the pelvis.
    const spread=model.thighLength*.85;
    const drop=Math.sqrt(model.thighLength**2-spread**2);
    leftFootTarget.x=hipL.x-spread;leftFootTarget.y=pelvis.y+drop+model.shinLength;
    rightFootTarget.x=hipR.x+spread;rightFootTarget.y=pelvis.y+drop+model.shinLength;
    if(!object.onBoat&&(object.sittingStyle==='injured'||object.legBandage)){
      const injured=object.legBandage==='left'?'left':'right';
      const guarded=injured==='left'?leftFootTarget:rightFootTarget;
      const resting=injured==='left'?rightFootTarget:leftFootTarget;
      const sign=injured==='left'?-1:1;
      // One guarded leg extends forward, the other folds closer to the body.
      guarded.x=sign*(7+model.thighLength*1.3);
      guarded.y=pelvis.y+model.shinLength*1.25;
      resting.x=-sign*11;
      resting.y=pelvis.y+model.thighLength*.7+model.shinLength;
    }
  }
  if (activeLocomotion && travelDistance !== undefined) {
    // A planted foot moves backward exactly as far as the body moves forward.
    // Swing follows traveled distance, so slow/eased walks don't skate.
    const direction = travelDistance < 0 ? -1 : 1;
    const cycle = 20;
    const phase = Math.abs(travelDistance) / cycle;
    const basePelvisY=model.horror?21.5:24;
    const ground = standingFootY + (basePelvisY + (model.thighLength + model.shinLength) * (model.horror?.91:.945) - standingFootY) * weight;
    for (const [target, offset, base] of [[leftFootTarget, 0, -10], [rightFootTarget, .5, 10]] as const) {
      const p = (phase + offset) % 1;
      const swing = Math.max(0, (p - .6) / .4);
      const stride = p <= .6 ? 6 - p * cycle : -6 + 12 * (swing * swing * (3 - 2 * swing));
      target.x = base + stride * direction * weight;
      target.y = ground - Math.sin(swing * Math.PI) * 1.8 * weight;
    }
  }
  const leftLeg = solveTwoBoneIk(hipL, leftFootTarget, model.thighLength, model.shinLength,
    locomoting && !object.onBoat && travelDistance !== undefined && weight > .05 ? -1 : 1);
  const rightLeg = solveTwoBoneIk(hipR, rightFootTarget, model.thighLength, model.shinLength, -1);

  return {
    pelvis, chest, neck, head,
    shoulderL, elbowL: leftArm.joint, handL: leftArm.end,
    shoulderR, elbowR: rightArm.joint, handR: rightArm.end,
    hipL, kneeL: leftLeg.joint, footL: leftLeg.end,
    hipR, kneeR: rightLeg.joint, footR: rightLeg.end,
    breath,
    headTilt: (object.expression === 'sad' ? -2 : object.expression === 'surprised' ? -1 : 0)
      + (model.horror && effectivePose !== 'run' ? (characterRnd(model.seed, 313) - .5) * 1.5 : 0)
      + (effectivePose==='nod'?4.2*weight:0)
      + (effectivePose==='brace'?-2.1*weight:0),
  };
}

export function segmentLength(a: CharacterPoint, b: CharacterPoint) {
  return dist(a, b);
}
