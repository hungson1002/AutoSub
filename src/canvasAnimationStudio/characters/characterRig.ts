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
  const left = { x: -model.shoulderWidth / 2 - 1, y: 26 };
  const right = { x: model.shoulderWidth / 2 + 1, y: 26 };

  if (pose === 'lie-down' || pose === 'cover-face') return {
    left: { x: -18, y: pose === 'cover-face' ? blanketTopAt(object, timeMs) + 1 : -6 },
    right: { x: 18, y: pose === 'cover-face' ? blanketTopAt(object, timeMs) + 1 : -6 },
  };

  if (pose === 'point') return { left, right: { x: 49, y: -8 } };
  if(pose==='struggle'){
    const effort=Math.sin(Math.min(gestureTimeMs,2400)/500*Math.PI)*2;
    return {left:{x:-30,y:-18+effort},right:{x:30,y:-12-effort}};
  }
  if(pose==='float-body')return {left:{x:-17,y:32},right:{x:16,y:36}};
  if (['reach','wipe','write','tie','aid','assist'].includes(pose)) return {left,right:{x:29,y:12}};
  if (pose === 'talk') {
    const smooth=(value:number)=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};
    const gesture=voiceActive ? smooth(gestureTimeMs/450)*(1-smooth((gestureTimeMs-900)/1000)) : 0;
    const amount=model.horror?.65:1;
    // One phrase gesture, a short hold, then a rest; avoid perpetual hand waving.
    return {
      left,
      right:{x:right.x-gesture*8*amount,y:right.y-gesture*12*amount},
    };
  }
  if (pose === 'brace') return {
    left: { x: -13, y: 8 },
    right: { x: 13, y: 8 },
  };
  if (pose === 'celebrate') return {
    left: { x: -28, y: -31 },
    right: { x: 28, y: -31 },
  };
  if (pose === 'row') return {
    left: { x: 7 + wave * 5, y: 12 + wave * 3 },
    right: { x: 32 + wave * 6, y: 14 + wave * 3 },
  };
  if (pose === 'run') return {
    left: { x: left.x + wave * 3, y: left.y - 4 - wave * 4 },
    right: { x: right.x - wave * 3, y: right.y - 4 + wave * 4 },
  };
  return { left, right };
}

export function resolveCharacterRig(object: CanvasStudioObject, model: CharacterModel, timeMs: number, voiceActive = true, gestureTimeMs = timeMs, poseWeight = 1, travelDistance?: number, pointTarget?: CharacterPoint, holdingPhone = false): CharacterRig {
  const breath = Math.sin(timeMs / 900 + characterRnd(model.seed,96)*Math.PI*2) * .55;
  const weight = Math.max(0, Math.min(1, poseWeight));
  const locomoting=object.pose==='run'||object.pose==='assist';
  const walk = locomoting ? Math.sin(gestureTimeMs / 190) * weight : 0;
  // Crouching lowers the whole torso while feet stay on their standing plane.
  const crouch = object.pose === 'aid' ? 12 * weight : 0;
  const pelvis = { x: 0, y: 24 + breath * .25 + crouch };
  // One torso frame owns its attachment points. Poses move the limbs, not
  // individual shoulders/head away from the shirt and collar.
  const chest = { x: pelvis.x, y: pelvis.y - 26 };
  const neck = { x: chest.x, y: chest.y - 12 };
  const head = { x: neck.x, y: neck.y - (model.horror ? 16 : 20) };
  const shoulderL = { x: chest.x - model.shoulderWidth / 2, y: chest.y - 2 };
  const shoulderR = { x: chest.x + model.shoulderWidth / 2, y: chest.y - 2 };
  const gaitTime = locomoting && travelDistance!==undefined ? travelDistance/20*Math.PI*2*190 : gestureTimeMs;
  const targets = armTargets(object, model, timeMs, voiceActive, gaitTime);
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
  if (object.pose !== 'lie-down' && object.pose !== 'cover-face') {
    const rest = armTargets({ ...object, pose: 'idle' }, model, timeMs, false, 0);
    for (const side of ['left', 'right'] as const) {
      targets[side] = { x: rest[side].x + (targets[side].x - rest[side].x) * weight, y: rest[side].y + (targets[side].y - rest[side].y) * weight };
    }
  }
  // Elbows bend outside the ribcage; inward elbows disappear under the shirt
  // and leave forearms looking like detached sticks.
  const leftArm = solveTwoBoneIk(shoulderL, targets.left, model.armLength, model.forearmLength, 1);
  // A phone grip stays beside the ear, with the elbow outside the shoulder.
  // It is an attachment constraint, independent of talking/pointing envelopes.
  if (holdingPhone) targets.right = {x:model.faceWidth*.5+7,y:head.y+7};
  const rightArm = solveTwoBoneIk(shoulderR, targets.right, model.armLength, model.forearmLength, holdingPhone ? 1 : -1);

  const hipL = { x: -7, y: pelvis.y };
  const hipR = { x: 7, y: pelvis.y };
  const standingFootY = pelvis.y - crouch + Math.sqrt(Math.pow((model.thighLength + model.shinLength) * .995, 2) - 9);
  const leftFootTarget = locomoting
    ? { x: -10 + walk * 8, y: standingFootY - Math.max(0, walk) * 2.8 }
    : { x: -10, y: object.pose === 'brace' ? standingFootY - 3 * weight : standingFootY };
  const rightFootTarget = locomoting
    ? { x: 10 - walk * 8, y: standingFootY - Math.max(0, -walk) * 2.8 }
    : { x: 10, y: object.pose === 'brace' ? standingFootY - 3 * weight : standingFootY };
  if(object.pose==='sit'||object.onBoat) {
    // Front-view sitting: thighs open symmetrically; calves drop vertically.
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
  if (locomoting && travelDistance !== undefined) {
    // A planted foot moves backward exactly as far as the body moves forward.
    // Swing follows traveled distance, so slow/eased walks don't skate.
    const direction = travelDistance < 0 ? -1 : 1;
    const cycle = 20;
    const phase = Math.abs(travelDistance) / cycle;
    const ground = standingFootY + (24 + (model.thighLength + model.shinLength) * .945 - standingFootY) * weight;
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
    headTilt: object.expression === 'sad' ? -2 : object.expression === 'surprised' ? -1 : 0,
  };
}

export function segmentLength(a: CharacterPoint, b: CharacterPoint) {
  return dist(a, b);
}
