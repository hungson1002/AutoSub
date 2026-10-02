import type { CanvasStudioObject, CanvasStudioScene } from '../types';

export type CharacterLod = 'far' | 'medium' | 'close';
export type CharacterFaceShape = 'soft' | 'narrow' | 'angular' | 'long' | 'round';
export type CharacterWardrobe = 'work-shirt' | 'villager-shirt' | 'robe' | 'jacket' | 'sailor-shirt' | 'warrior-tunic';

export type CharacterFaceParams = {
  eyesOpen: number;
  pupilX: number;
  pupilY: number;
  browLift: number;
  browTilt: number;
  mouthOpen: number;
  mouthCurve: number;
  mouthWidth: number;
  headTilt: number;
};

export type CharacterModel = {
  seed: number;
  lod: CharacterLod;
  horror: boolean;
  faceShape: CharacterFaceShape;
  wardrobe: CharacterWardrobe;
  age: number;
  faceWidth: number;
  faceHeight: number;
  jawWidth: number;
  chinLength: number;
  eyeScale: number;
  eyeSpacing: number;
  shoulderWidth: number;
  waistWidth: number;
  torsoHeight: number;
  armLength: number;
  forearmLength: number;
  thighLength: number;
  shinLength: number;
  skin: string;
  primary: string;
  secondary: string;
  ink: string;
  hair: string;
  highlight: string;
  shadow: string;
  asymmetryX: number;
  asymmetryBrow: number;
};

export function characterSeed(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export function characterRnd(seed: number, n: number) {
  let x = (seed + n * 2654435761) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967295;
}

const HORROR_REFS = new Set(['bg:night-stilt-house', 'bg:room-stilt-house', 'bg:room-stilt-day', 'bg:room-underfloor', 'bg:room-floor-detail']);
const BODY_POSES = new Set(['lie-down', 'cover-face', 'float-body', 'struggle', 'grab', 'sink', 'surface', 'sit', 'aid', 'assist', 'reach', 'tie', 'wipe', 'write', 'run', 'row', 'brace', 'celebrate']);

function resolveLod(object: CanvasStudioObject, scene: CanvasStudioScene): CharacterLod {
  if (object.pose === 'lie-down' || object.pose === 'cover-face' || object.pose === 'float-body') return 'medium';
  // Keep body geometry stable for the whole action, including its idle lead-in
  // and recovery. A camera close-up must not turn a physical actor into a bust.
  const source = scene.objects.find(actor => actor.id === object.id) || object;
  const needsBody = BODY_POSES.has(object.pose || '') || BODY_POSES.has(source.pose || '')
    || source.keyframes?.some(frame => BODY_POSES.has(frame.pose || ''))
    || scene.animationBeats?.some(beat => BODY_POSES.has(beat.action)
      && (beat.targetIds.includes(object.id) || beat.focusTargetId === object.id));
  const shot = scene.camera?.shot || 'medium';
  if (shot === 'close-up' || shot === 'extreme-close-up') return needsBody ? 'medium' : 'close';
  if(object.onBoat&&object.height>=160)return 'medium';
  if (object.height <= 150 || (shot==='wide'&&object.height<240)) return 'far';
  return 'medium';
}

function resolveFaceShape(object: CanvasStudioObject, seed: number): CharacterFaceShape {
  const notes = (object.designNotes || '').toLowerCase();
  if (/narrow|thin|g[aầ]y|d[aà]i|kh[aắ]c kh[oổ]/u.test(notes)) return 'narrow';
  if (/angular|g[oó]c c[aạ]nh|stern|c[uứ]ng/u.test(notes)) return 'angular';
  if (/round|tr[oò]n|ph[uú]c h[aậ]u/u.test(notes)) return 'round';
  if (/long face|m[aặ]t d[aà]i/u.test(notes)) return 'long';
  if (object.archetype === 'worker' || object.archetype === 'scholar') return characterRnd(seed, 31) > .45 ? 'narrow' : 'angular';
  if (object.hair === 'bun') return characterRnd(seed, 32) > .5 ? 'long' : 'angular';
  return (['soft', 'round', 'narrow'] as CharacterFaceShape[])[Math.floor(characterRnd(seed, 33) * 3)]!;
}

function resolveWardrobe(object: CanvasStudioObject): CharacterWardrobe {
  const notes = (object.designNotes || '').toLowerCase();
  if (/jacket|[aá]o kho[aá]c/u.test(notes)) return 'jacket';
  if (/robe|[aá]o d[aà]i|[aá]o cho[aà]ng/u.test(notes)) return 'robe';
  if (object.archetype === 'warrior') return 'warrior-tunic';
  if (object.archetype === 'sailor') return 'sailor-shirt';
  if (object.archetype === 'worker') return 'work-shirt';
  return 'villager-shirt';
}

function resolveAge(object: CanvasStudioObject, seed: number) {
  const notes = (object.designNotes || '').toLowerCase();
  const explicit=notes.match(/\bage\s*[:=]?\s*(\d{1,3})\b/);
  if(explicit)return Math.max(5,Math.min(95,Number(explicit[1])));
  if (/old|elder|older|gi[aà]|l[oớ]n tu[oổ]i|kh[aắ]c kh[oổ]/u.test(notes)) return 55 + Math.round(characterRnd(seed, 34) * 18);
  if (/young|tr[eẻ]/u.test(notes)) return 20 + Math.round(characterRnd(seed, 35) * 10);
  return 26 + Math.round(characterRnd(seed, 36) * 20);
}

function archetypePalette(object: CanvasStudioObject) {
  const defaults: Record<string, [string, string, string]> = {
    narrator: ['#b78a55', '#66716f', '#d5aa84'],
    warrior: ['#8f5046', '#596467', '#d4a57f'],
    scholar: ['#756e60', '#987e60', '#d8ad88'],
    villager: ['#8f664d', '#687263', '#d6aa84'],
    merchant: ['#886b58', '#656c79', '#d8ad88'],
    sailor: ['#60717a', '#806157', '#d4a57f'],
    worker: ['#6e6860', '#56666c', '#d3a47f'],
  };
  return defaults[object.archetype || 'narrator'] || defaults.narrator!;
}

function lighten(hex: string, amount: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = Number.parseInt(match[1]!, 16);
  const r = Math.max(0, Math.min(255, (value >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((value >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (value & 255) + amount));
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function resolveCharacterModel(object: CanvasStudioObject, scene: CanvasStudioScene): CharacterModel {
  const seed = characterSeed(object.characterKey || object.assetKey || object.label || object.id);
  const horror = object.visualStyle ? object.visualStyle==='horror' : HORROR_REFS.has(scene.backgroundRef || '') || /horror|kinh\s*d[iị]|ma\s*x[oó]|truy[eệ]n\s*ma/iu.test(scene.visualBrief || '');
  const palette = archetypePalette(object);
  const faceShape = resolveFaceShape(object, seed);
  const wardrobe = resolveWardrobe(object);
  const age = resolveAge(object, seed);
  const older = age >= 50;
  const baseWidth = faceShape === 'narrow' ? 38.5 : faceShape === 'long' ? 40 : faceShape === 'round' ? 44 : faceShape === 'angular' ? 41.5 : 42;
  const baseHeight = faceShape === 'long' ? 39 : faceShape === 'round' ? 35 : older ? 38 : 36;

  const faceWidth = (baseWidth + (characterRnd(seed, 3) - .5) * 2.2)*(horror?.76:1);
  const faceHeight = (baseHeight + (characterRnd(seed, 4) - .5) * 1.6)*(horror?.9:1);
  const primary = object.color || palette[0];
  const secondary = object.secondaryColor || palette[1];
  const skin = object.skinTone || palette[2];

  const jawRatio = faceShape === 'round' ? .84 : faceShape === 'soft' ? .8 : faceShape === 'angular' ? .74 : .76;
  const chinBase = faceShape === 'long' ? 2.7 : faceShape === 'angular' ? 2.2 : 1.7;
  return {
    seed,
    lod: resolveLod(object, scene),
    horror,
    faceShape,
    wardrobe,
    age,
    faceWidth,
    faceHeight,
    jawWidth: faceWidth * (jawRatio + characterRnd(seed, 5) * .035),
    chinLength: chinBase + characterRnd(seed, 6) * .85,
    eyeScale: horror ? .74 + characterRnd(seed, 7) * .07 : .84 + characterRnd(seed, 7) * .08,
    eyeSpacing: ((faceShape === 'narrow' ? 6.6 : faceShape === 'round' ? 7.5 : 7) + characterRnd(seed, 8) * 1.0) * (horror ? .9 : 1),
    shoulderWidth: (object.archetype === 'warrior' ? 40 : object.archetype === 'worker' ? 37.5 : 36) + characterRnd(seed, 9) * 2.6,
    waistWidth: 28 + characterRnd(seed, 10) * 2.4,
    torsoHeight: 34 + characterRnd(seed, 11) * 2,
    armLength: 14.5 + characterRnd(seed, 12) * 1.4,
    forearmLength: 13.5 + characterRnd(seed, 13) * 1.4,
    thighLength: 14.2 + characterRnd(seed, 14) * 1.1,
    shinLength: 14.2 + characterRnd(seed, 15) * 1.1,
    skin,
    primary,
    secondary,
    ink: horror ? '#272421' : '#332f2b',
    hair: horror ? '#302c29' : '#39332f',
    highlight: horror ? lighten(skin, 13) : lighten(skin, 20),
    shadow: horror ? lighten(skin, -38) : lighten(skin, -28),
    asymmetryX: (characterRnd(seed, 16) - .5) * 1.2,
    asymmetryBrow: (characterRnd(seed, 17) - .5) * 1.5,
  };
}

export function resolveFaceParams(object: CanvasStudioObject, model: CharacterModel, timeMs: number, voiceActive: boolean, speechLevel?: number): CharacterFaceParams {
  const expression = object.expression || 'neutral';
  const speaking = voiceActive && object.pose !== 'cover-face' && object.pose !== 'lie-down';
  const talk = speaking ? speechLevel === undefined
    ? .25 + .75*Math.abs(Math.sin(timeMs / 105))
    : Math.max(0,Math.min(1,speechLevel)) : 0;
  const blinkPeriod = 3200 + characterRnd(model.seed, 90) * 1500;
  const blinkPhase = (timeMs + characterRnd(model.seed, 91) * blinkPeriod) % blinkPeriod;
  const blink = blinkPhase > blinkPeriod - 115 ? Math.max(.08, Math.abs((blinkPhase - (blinkPeriod - 57.5)) / 57.5)) : 1;
  const gazeDrift = Math.sin((timeMs + characterRnd(model.seed, 92) * 900) / 1700) * .08;

  const base: CharacterFaceParams = {
    eyesOpen: (model.horror ? .78 : .82) * blink,
    pupilX: gazeDrift,
    pupilY: 0,
    browLift: 0,
    browTilt: 0,
    mouthOpen: talk * (model.horror?.75:.9),
    mouthCurve: model.horror ? -.04 : .02,
    mouthWidth: model.horror ? .72 : .82,
    headTilt: 0,
  };

  if (expression === 'afraid' || object.pose === 'cover-face') {
    return { ...base, eyesOpen: .94 * blink, pupilX: -.14, pupilY: .08, browLift: -.14, browTilt: .2, mouthOpen: base.mouthOpen, mouthCurve: -.2, mouthWidth: .58, headTilt: -1 };
  }
  if (object.pose === 'lie-down' && expression === 'neutral') {
    return { ...base, eyesOpen: .06, mouthOpen: 0, mouthCurve: 0, headTilt: 0 };
  }
  if (expression === 'surprised') {
    return { ...base, eyesOpen: model.horror ? .9 : 1, browLift: -.18, browTilt: -.08, mouthOpen: Math.max(.3, base.mouthOpen), mouthCurve: -.04, mouthWidth: .58, headTilt: -1.5 };
  }
  if (expression === 'sad') {
    return { ...base, eyesOpen: .58, pupilY: .08, browLift: -.02, browTilt: .2, mouthCurve: -.5, mouthWidth: .7, headTilt: -2.2 };
  }
  if (expression === 'angry') {
    return { ...base, eyesOpen: .7, browTilt: -.45, mouthCurve: -.25, mouthWidth: .78, headTilt: 1.2 };
  }
  if (expression === 'happy') {
    return { ...base, eyesOpen: .65, browLift: .02, mouthCurve: model.horror ? .12 : .72, mouthWidth: .86, headTilt: 1.3 };
  }
  return base;
}

/** Fit one anatomy uniformly; a different shot must never stretch a person's face. */
export function characterDrawingScale(object: CanvasStudioObject, model: CharacterModel) {
  if (object.pose === 'lie-down' || object.pose === 'cover-face' || object.pose === 'float-body') return Math.min(object.width / 100, object.height / 68);
  return model.lod === 'close' ? Math.min(object.width / 68, object.height / 82) : Math.min(object.width / 68, object.height / 100);
}

export function blanketTopAt(object: CanvasStudioObject, timeMs: number) {
  if (object.pose !== 'cover-face') return -8;
  const start = [...(object.keyframes || [])].filter((frame) => frame.pose === 'cover-face' && frame.atMs <= timeMs).sort((a, b) => b.atMs - a.atMs)[0]?.atMs || 0;
  const progress = Math.max(0, Math.min(1, (timeMs - start) / 900));
  return -8 - 18 * (1 - Math.pow(1 - progress, 3));
}
