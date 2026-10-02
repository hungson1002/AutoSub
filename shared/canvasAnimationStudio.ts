export type CanvasBackgroundPreset = 'river' | 'paper' | 'night' | 'field' | 'room' | 'city' | 'underwater' | 'map';

export type CanvasObjectKind = 'character' | 'ship' | 'stake' | 'text' | 'image' | 'shape' | 'prop';
export type CanvasPropVariant =
  | 'tree' | 'house' | 'cloud' | 'sun' | 'moon' | 'mountain' | 'fire' | 'coin'
  | 'book' | 'sword' | 'shield' | 'crown' | 'flag' | 'cart' | 'barrel' | 'box'
  | 'arrow' | 'map' | 'clock' | 'phone' | 'computer' | 'factory' | 'lightbulb'
  | 'question' | 'water' | 'bridge' | 'ghost'
  | 'door' | 'window' | 'bowl' | 'pipe' | 'bamboo' | 'table' | 'chair' | 'lantern'
  | 'bed' | 'basket' | 'rope' | 'stairs' | 'floorboard' | 'note' | 'oar' | 'teapot' | 'sandals';

export type CanvasMotion =
  | 'none' | 'slide-left' | 'slide-right' | 'slide-up' | 'pop' | 'float'
  | 'shake' | 'drift-left' | 'drift-right' | 'pulse' | 'bounce'
  | 'walk-left' | 'walk-right' | 'hit' | 'tilt-left' | 'tilt-right' | 'fall';

export type CanvasExpression = 'neutral' | 'happy' | 'angry' | 'surprised' | 'sad' | 'afraid';
export type CanvasCharacterPose = 'idle' | 'talk' | 'point' | 'run' | 'row' | 'brace' | 'celebrate' | 'lie-down' | 'cover-face' | 'sit' | 'reach' | 'wipe' | 'write' | 'tie' | 'aid' | 'assist' | 'struggle' | 'float-body';

export type CanvasSpriteClip = {
  /** Pixel size of one cell in the sheet. */
  frameWidth: number;
  frameHeight: number;
  columns: number;
  /** Inclusive frame range + playback rate of this clip. */
  from: number;
  to: number;
  fps: number;
};

/** One acting clip: its own sheet + frame range, selected by beat action. */
export type CanvasSpriteAct = CanvasSpriteClip & {
  action: CanvasAnimationAction;
  imageUrl: string;
  loop?: boolean;
};
export type CanvasCharacterArchetype = 'narrator' | 'warrior' | 'scholar' | 'villager' | 'merchant' | 'sailor' | 'worker';
export type CanvasHairStyle = 'short' | 'crop' | 'messy' | 'bald' | 'bun' | 'hat';
export type CanvasMotionCurve = 'smooth' | 'snappy' | 'elastic' | 'cinematic';
export type CanvasFacing = 'left' | 'right';
export type CanvasObjectRole = 'focal' | 'support' | 'background';
export type CanvasShotType = 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'pov' | 'diagram' | 'split';
export type CanvasCameraMotion = 'none' | 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'follow' | 'impact';
export type CanvasEffectType = 'speed-lines' | 'impact' | 'splash' | 'smoke' | 'dust' | 'arrows' | 'glow' | 'vignette' | 'flashlight';

export type CanvasAnimationAction =
  | 'grab' | 'struggle' | 'sink' | 'surface'
  | 'reach' | 'wipe' | 'write' | 'tie' | 'aid' | 'assist'
  | 'talk'
  | 'point'
  | 'react'
  | 'celebrate'
  | 'brace'
  | 'run'
  | 'row'
  | 'reveal'
  | 'impact'
  | 'float'
  | 'pulse';

export type CanvasAnimationBeat = {
  id: string;
  atMs: number;
  durationMs: number;
  action: CanvasAnimationAction;
  targetIds: string[];
  intensity?: number;
  /** Phrase in dialogue.text; resolved against measured speech after TTS. */
  speechCue?: string;
  dialogueId?: string;
  focusTargetId?: string;
};

/**
 * Semantic composition contract. AI chooses a template + slots; deterministic
 * layout code converts those choices into pixels. This keeps the Director from
 * improvising raw x/y layouts that repeatedly collapse into the same stage.
 */
export type CanvasSceneTemplate =
  | 'hero-left'
  | 'hero-right'
  | 'two-shot'
  | 'wide-establishing'
  | 'close-reaction'
  | 'prop-focus'
  | 'foreground-pov'
  | 'over-shoulder'
  | 'diagram-clean'
  | 'split-contrast';

export type CanvasLayoutSlot =
  | 'hero'
  | 'hero-left'
  | 'hero-right'
  | 'support-left'
  | 'support-right'
  | 'foreground-left'
  | 'foreground-right'
  | 'mid-left'
  | 'mid-center'
  | 'mid-right'
  | 'background-left'
  | 'background-center'
  | 'background-right'
  | 'caption-top'
  | 'caption-bottom'
  | 'center';

export type CanvasDepthLayer = 'foreground' | 'midground' | 'background';
export type CanvasSizeClass = 'small' | 'medium' | 'large' | 'hero';
export type CanvasKeyframeEase = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'snappy' | 'elastic' | 'hold';

/** Relative transform/state keyframe layered on top of semantic layout. */
export type CanvasObjectKeyframe = {
  atMs: number;
  bandageProgress?: number;
  doorOpen?: number;
  boxOpen?: number;
  lightLevel?: number;
  dx?: number;
  dy?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  pose?: CanvasCharacterPose;
  expression?: CanvasExpression;
  facing?: CanvasFacing;
  easing?: CanvasKeyframeEase;
};

/** Camera track uses relative offsets so semantic focal framing remains intact. */
export type CanvasCameraKeyframe = {
  atMs: number;
  dx?: number;
  dy?: number;
  zoom?: number;
  rotation?: number;
  easing?: CanvasKeyframeEase;
};

export type CanvasStudioObject = {
  id: string;
  appearance?: 'human' | 'water-spirit';
  voiceGender?: 'male' | 'female';
  /** Water masks the submerged geometry; opacity never substitutes for depth. */
  waterlineY?: number;
  recliningStyle?: 'covered' | 'exposed';
  /** Architectural attachment resolved by layout, rather than a free prop. */
  environmentAnchor?: 'doorway' | 'free';
  lookAtId?: string;
  /** Hinged panel: 0 closed, 1 open. */
  doorOpen?: number;
  boxOpen?: number;
  /** Light changes without hiding the physical lamp. */
  lightLevel?: number;
  lightSignal?: { pattern: 'distress' | 'acknowledge'; offsetMs?: number };
  /** Procedural prop handle follows this actor's right hand. */
  heldBy?: string;
  /** A held teapot pours toward this bowl's center. */
  pouringInto?: string;
  tiedTo?: string;
  /** Derived by a tie beat: coil -> wrap -> knot. */
  tieProgress?: number;
  /** A seated passenger follows the vessel rather than floating over its deck. */
  onBoat?: string;
  boatSeat?: number;
  legBandage?: 'left' | 'right';
  /** 0 = bare injured leg, 1 = fully wrapped. Defaults to 1 for old projects. */
  bandageProgress?: number;
  /** Distinguish a supported chair seat from guarding an injured leg on the ground. */
  sittingStyle?: 'chair' | 'ground' | 'injured';
  kind: CanvasObjectKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  opacity: number;
  color: string;
  accent: string;
  zIndex: number;
  motion: CanvasMotion;
  text?: string;
  imageUrl?: string;
  /** Sprite-sheet clip (sprite-forge style). When set with imageUrl, renderer cycles frames instead of drawing static art. */
  sprite?: CanvasSpriteClip;
  /** Acting repertoire: renderer switches sheet+frames by active beat action. Falls back to `sprite`. */
  spriteActs?: CanvasSpriteAct[];
  /** Credit ảnh thật kiểu mẫu Bạch Đằng: "Ảnh: ... • Wikimedia • ...". */
  credit?: string;
  /** Approved generated/uploaded asset used by the professional visual pipeline. */
  assetId?: string;
  /** Semantic key shared by recurring visual assets across scenes. */
  assetKey?: string;
  /** Hand-authored vector-library asset selected by the Director/compiler. */
  assetRef?: string;
  /** Semantic layout slot; deterministic compiler turns this into x/y. */
  slot?: CanvasLayoutSlot;
  /** Perspective/depth layer used by layout and z-order. */
  depth?: CanvasDepthLayer;
  /** Coarse authored scale class; deterministic compiler turns this into dimensions. */
  sizeClass?: CanvasSizeClass;
  /** Art-director description used to select/design an asset, not rendered as text. */
  designNotes?: string;
  expression?: CanvasExpression;
  pose?: CanvasCharacterPose;
  facing?: CanvasFacing;
  role?: CanvasObjectRole;
  variant?: CanvasPropVariant;
  characterKey?: string;
  /** Cast-wide art direction; scenery must not change facial proportions. */
  visualStyle?: 'story' | 'horror';
  archetype?: CanvasCharacterArchetype;
  hair?: CanvasHairStyle;
  secondaryColor?: string;
  skinTone?: string;
  delayMs?: number;
  motionDurationMs?: number;
  motionCurve?: CanvasMotionCurve;
  motionIntensity?: number;
  /** Frame-addressable authored motion layered on top of the semantic base transform. */
  keyframes?: CanvasObjectKeyframe[];
};

export type CanvasSceneCamera = {
  shot: CanvasShotType;
  motion: CanvasCameraMotion;
  focusX: number;
  focusY: number;
  zoom: number;
  /** Optional explicit camera choreography; presets remain as a lightweight fallback. */
  keyframes?: CanvasCameraKeyframe[];
};

export type CanvasSceneEffect = {
  id: string;
  type: CanvasEffectType;
  x: number;
  y: number;
  scale: number;
  color?: string;
  intensity?: number;
  startMs?: number;
  durationMs?: number;
  zIndex?: number;
};

export type CanvasSoundPreset = 'knock' | 'scratch' | 'cloth' | 'fire' | 'wind' | 'footstep' | 'door-creak';
export type CanvasSoundCue = {
  id: string;
  preset: CanvasSoundPreset;
  atMs: number;
  durationMs: number;
  volume: number;
  pan?: number;
};
export type CanvasDialogueLine = {
  id: string;
  speaker: string;
  characterKey?: string;
  text: string;
  voice?: string;
  delivery?: 'natural' | 'distant';
  /** Optional pronunciation transcript; captions retain text. */
  spokenText?: string;
  emotion?: 'natural' | 'storytelling' | 'tense' | 'gentle' | 'firm';
  cue?: 'none' | 'sigh' | 'laugh' | 'clear-throat';
  speechWindows?: Array<{startMs:number;endMs:number}>;
  /** Measured voice energy, sampled once during audio production (not per frame). */
  speechEnvelope?: Array<{atMs:number;level:number}>;
  atMs?: number;
  durationMs?: number;
  audioUrl?: string;
  audioKey?: string;
};

export type CanvasStudioScene = {
  id: string;
  name: string;
  durationMs: number;
  atmosphere?: { rainIntensity?: number; waterIntensity?: number; timeOffsetMs?: number; timeOfDay?: 'day' | 'dusk' | 'night' };
  /** Preserve continuous narration captions through authored coverage cuts. */
  captionTrack?: {text:string;durationMs:number;offsetMs:number};
  /** Composition template chosen semantically, then compiled into pixel layout. */
  template?: CanvasSceneTemplate;
  background: CanvasBackgroundPreset;
  /** Authored environment composition. Production plans must use a registered ref. */
  backgroundRef?: string;
  /** Full-frame illustrated plate generated for this shot/background family. */
  backgroundImageUrl?: string;
  backgroundAssetId?: string;
  /** Credit ảnh thật nền, render góc dưới như video mẫu. */
  backgroundCredit?: string;
  /** Shot-level art brief for environment generation and composition. */
  visualBrief?: string;
  narration?: string;
  audioUrl?: string;
  /** Unmixed narration is retained when rebuilding the sound design. */
  sourceAudioUrl?: string;
  audioMixKey?: string;
  dialogue?: CanvasDialogueLine[];
  soundEffects?: CanvasSoundCue[];
  camera?: CanvasSceneCamera;
  effects?: CanvasSceneEffect[];
  /** Semantic choreography events compiled into pose/state/secondary motion at render time. */
  animationBeats?: CanvasAnimationBeat[];
  /**
   * Explicit voice-activity windows driving mouth motion. When omitted the
   * renderer derives pauses from talk beats; scenes without talk beats keep
   * the legacy always-animating mouth so old projects render unchanged.
   */
  lipSync?: Array<{ startMs: number; endMs: number }>;
  objects: CanvasStudioObject[];
};

export type CanvasStudioProject = {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  createdAt?: string;
  updatedAt?: string;
  sourcePrompt?: string;
  /** Stable characterKey (or named off-screen speaker) -> provider voice ID. */
  castVoices?: Record<string, string>;
  assetPipeline?: {
    version: 1;
    styleBible: string;
    generated: number;
    approved: number;
    rejected: number;
    reused: number;
    required?: number;
    attached?: number;
    warnings: string[];
  };
  scenes: CanvasStudioScene[];
};

export const CANVAS_STUDIO_VERSION = 1 as const;

export function createCanvasObject(
  kind: CanvasObjectKind,
  overrides: Partial<CanvasStudioObject> = {},
): CanvasStudioObject {
  const defaults: Record<CanvasObjectKind, Pick<CanvasStudioObject, 'width' | 'height' | 'color' | 'accent' | 'label'>> = {
    character: { width: 150, height: 260, color: '#e8b04f', accent: '#22201f', label: 'Nhân vật' },
    ship: { width: 320, height: 155, color: '#8a5437', accent: '#d9c4a2', label: 'Thuyền' },
    stake: { width: 42, height: 190, color: '#6c4933', accent: '#39281e', label: 'Cọc gỗ' },
    text: { width: 520, height: 110, color: '#ffffff', accent: '#1f1f1f', label: 'Tiêu đề' },
    image: { width: 360, height: 260, color: '#d9d9d9', accent: '#1f1f1f', label: 'Ảnh' },
    shape: { width: 260, height: 160, color: '#d66d4b', accent: '#1f1f1f', label: 'Hình khối' },
    prop: { width: 150, height: 150, color: '#d8b06d', accent: '#24211f', label: 'Đạo cụ' },
  };
  const base = defaults[kind];
  return {
    id: `obj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    label: base.label,
    x: 640,
    y: 380,
    width: base.width,
    height: base.height,
    scale: 1,
    rotation: 0,
    opacity: 1,
    color: base.color,
    accent: base.accent,
    zIndex: 10,
    motion: kind === 'text' ? 'pop' : 'slide-left',
    text: kind === 'text' ? '3 lần - 1 mẹo' : undefined,
    expression: kind === 'character' ? 'neutral' : undefined,
    pose: kind === 'character' ? 'idle' : undefined,
    facing: kind === 'character' ? 'right' : undefined,
    role: kind === 'text' ? 'support' : 'focal',
    variant: kind === 'prop' ? 'tree' : undefined,
    characterKey: kind === 'character' ? 'main' : undefined,
    archetype: kind === 'character' ? 'narrator' : undefined,
    hair: kind === 'character' ? 'short' : undefined,
    secondaryColor: kind === 'character' ? '#5d6d72' : undefined,
    skinTone: kind === 'character' ? '#e8bb94' : undefined,
    delayMs: 0,
    motionDurationMs: 520,
    motionCurve: 'cinematic',
    motionIntensity: 1,
    ...overrides,
  };
}

export function createCanvasScene(index = 0): CanvasStudioScene {
  return {
    id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Cảnh ${index + 1}`,
    durationMs: 4200,
    template: 'wide-establishing',
    background: 'river',
    narration: '',
    camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    animationBeats: [],
    objects: [
      createCanvasObject('text', {
        x: 640,
        y: 110,
        width: 620,
        height: 120,
        zIndex: 30,
        slot: 'caption-top',
        depth: 'midground',
        sizeClass: 'medium',
        text: index === 0 ? '3 lần - 1 mẹo' : `Cảnh ${index + 1}`,
      }),
      createCanvasObject('character', {
        x: 300,
        y: 470,
        zIndex: 20,
        slot: 'mid-left',
        depth: 'midground',
        sizeClass: 'large',
        motion: 'slide-left',
        expression: 'angry',
      }),
      createCanvasObject('ship', {
        x: 910,
        y: 440,
        zIndex: 12,
        slot: 'mid-right',
        depth: 'midground',
        sizeClass: 'large',
        motion: 'drift-left',
      }),
      createCanvasObject('stake', {
        x: 690,
        y: 580,
        zIndex: 8,
        rotation: -10,
        motion: 'pop',
      }),
      createCanvasObject('stake', {
        x: 770,
        y: 600,
        zIndex: 8,
        rotation: 8,
        motion: 'pop',
      }),
    ],
  };
}

export function createCanvasProject(): CanvasStudioProject {
  const now = new Date().toISOString();
  return {
    version: CANVAS_STUDIO_VERSION,
    id: crypto.randomUUID?.() || `canvas-project-${Date.now()}`,
    name: 'Canvas Story',
    width: 1280,
    height: 720,
    fps: 30,
    createdAt: now,
    updatedAt: now,
    scenes: [createCanvasScene(0)],
  };
}
