import type {CanvasVectorScene,VectorDrawing} from './canvasVectorScene';

export type CanvasBackgroundPreset = 'river' | 'paper' | 'night' | 'field' | 'room' | 'city' | 'underwater' | 'map';

export type CanvasObjectKind = 'character' | 'ship' | 'stake' | 'text' | 'image' | 'shape' | 'prop';
export type CanvasPropVariant =
  | 'tree' | 'house' | 'cloud' | 'sun' | 'moon' | 'mountain' | 'fire' | 'coin'
  | 'book' | 'sword' | 'shield' | 'crown' | 'flag' | 'cart' | 'barrel' | 'box'
  | 'arrow' | 'map' | 'clock' | 'phone' | 'computer' | 'factory' | 'lightbulb'
  | 'question' | 'water' | 'bridge' | 'ghost'
  | 'door' | 'window' | 'bowl' | 'pipe' | 'bamboo' | 'table' | 'chair' | 'lantern'
  | 'bed' | 'basket' | 'rope' | 'stairs' | 'floorboard' | 'note' | 'oar' | 'teapot' | 'sandals' | 'pig' | 'pig-hoof'
  | 'dog' | 'demon-dog';

export type CanvasMotion =
  | 'none' | 'slide-left' | 'slide-right' | 'slide-up' | 'pop' | 'float'
  | 'shake' | 'drift-left' | 'drift-right' | 'pulse' | 'bounce'
  | 'walk-left' | 'walk-right' | 'hit' | 'tilt-left' | 'tilt-right' | 'fall';

export type CanvasExpression = 'neutral' | 'happy' | 'angry' | 'surprised' | 'sad' | 'afraid';
export type CanvasCharacterPose = 'idle' | 'talk' | 'gesture' | 'nod' | 'point' | 'run' | 'row' | 'brace' | 'celebrate' | 'lie-down' | 'cover-face' | 'sit' | 'reach' | 'wipe' | 'write' | 'tie' | 'aid' | 'assist' | 'struggle' | 'float-body';

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
  | 'pull' | 'release'
  | 'grab' | 'struggle' | 'sink' | 'surface'
  | 'reach' | 'wipe' | 'write' | 'tie' | 'aid' | 'assist'
  | 'talk'
  | 'gesture' | 'nod'
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
 * Editorial change inside one continuous shot. Visual beats are intentionally
 * higher-level than animationBeats: they add/remove a layer, change a held pose,
 * dim a practical light, draw a clue, or make a tiny focus shift without
 * rebuilding the stage or cutting to a new scene.
 */
export type CanvasVisualBeatAction =
  | 'reveal-layer'
  | 'hide-layer'
  | 'pose-change'
  | 'expression-change'
  | 'look-at'
  | 'light-change'
  | 'draw-on'
  | 'focus-shift';

export type CanvasVisualBeat = {
  id: string;
  atMs: number;
  durationMs: number;
  action: CanvasVisualBeatAction;
  targetIds: string[];
  speechCue?: string;
  focusTargetId?: string;
  pose?: CanvasCharacterPose;
  expression?: CanvasExpression;
  opacity?: number;
  lightLevel?: number;
  /** Tiny relative camera change. Horror grammar clamps this heavily. */
  cameraZoomDelta?: number;
  cameraDx?: number;
  cameraDy?: number;
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
  /** 0..1 authored ink/detail reveal for note/map style clue inserts. */
  revealProgress?: number;
  dx?: number;
  dy?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  pose?: CanvasCharacterPose;
  expression?: CanvasExpression;
  facing?: CanvasFacing;
  /** Held gaze target; later keyframes may redirect it without a scene cut. */
  lookAtId?: string;
  /** Internal provenance so post-TTS cue alignment can retime only derived visual frames. */
  visualBeatId?: string;
  visualBeatPhase?: 'start' | 'end';
  easing?: CanvasKeyframeEase;
};

/** Camera track uses relative dx/dy and absolute zoom; it replaces preset motion. */
export type CanvasCameraKeyframe = {
  atMs: number;
  dx?: number;
  dy?: number;
  zoom?: number;
  rotation?: number;
  visualBeatId?: string;
  visualBeatPhase?: 'start' | 'end';
  easing?: CanvasKeyframeEase;
};

export type CanvasStudioObject = {
  id: string;
  appearance?: 'human' | 'water-spirit' | 'long-limbed-spirit';
  /** A perched character rests on the branch of this tree object. */
  perchedOn?: string;
  /** Last inferred folk reclining angle; a different authored rotation takes precedence. */
  folkReclineAngle?: number;
  voiceGender?: 'male' | 'female';
  /** Water masks the submerged geometry; opacity never substitutes for depth. */
  waterlineY?: number;
  /** Absolute scene-space floor contact used by grounded procedural actors. */
  groundY?: number;
  recliningStyle?: 'covered' | 'exposed';
  /** Architectural attachment resolved by layout, rather than a free prop. */
  environmentAnchor?: 'doorway' | 'free';
  lookAtId?: string;
  /** Hinged panel: 0 closed, 1 open. */
  doorOpen?: number;
  boxOpen?: number;
  /** Light changes without hiding the physical lamp. */
  lightLevel?: number;
  /** 0..1 reveal amount used by clue assets that are drawn progressively. */
  revealProgress?: number;
  lightSignal?: { pattern: 'distress' | 'acknowledge'; offsetMs?: number };
  /** Static prop rests on another semantic prop's authored top surface. */
  restingOn?: string;
  /** Horizontal offset as a fraction of the support prop width (-1..1). */
  restingOffsetX?: number;
  /** Procedural prop handle follows this actor's right hand. */
  heldBy?: string;
  heldHand?: 'left' | 'right';
  /** Cue-derived contact transaction; layout defines its resting position. */
  handling?: {actorId:string;kind:'pick-up'|'place';atMs:number;durationMs:number};
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
  hoofCount?: 4 | 5;
  characterKey?: string;
  /** Cast-wide art direction; scenery must not change facial proportions. */
  visualStyle?: 'story' | 'horror' | 'folk-horror';
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
  /** Light follows this object's evaluated position, including a held prop. */
  sourceObjectId?: string;
};

export type CanvasSoundPreset = 'knock' | 'scratch' | 'cloth' | 'fire' | 'wind' | 'footstep' | 'door-creak' | 'water' | 'splash' | 'dog-howl' | 'pig-grunt' | 'bell' | 'horror-score';
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

export type CanvasSpecSky = 'night' | 'dusk' | 'dawn' | 'overcast' | 'day';
export type CanvasSpecGround = 'dirt-path' | 'grass' | 'rice-field' | 'stone-yard' | 'mud' | 'water-edge';
export type CanvasSpecStructureKind = 'stilt-house' | 'ground-house' | 'shrine' | 'village-gate' | 'well' | 'grave-mound' | 'fence' | 'buffalo-shed' | 'footbridge' | 'altar-table';
export type CanvasSpecStructure = {
  kind: CanvasSpecStructureKind;
  /** Horizontal anchor, 0 (left) to 1 (right). */
  x: number;
  /** 0.5 (far/small) to 1.6 (near/large). */
  scale?: number;
  /** Warm lamp or window light. */
  lit?: boolean;
};
/**
 * Layered description of a brand-new location. The renderer composes it from
 * shared JS canvas building blocks so each story can have places that were
 * never hand-drawn as a dedicated background.
 */
export type CanvasBackgroundSpec = {
  sky: CanvasSpecSky;
  moon?: boolean;
  /** Number of mountain/hill ridges, 0-3. */
  ridges?: number;
  ground: CanvasSpecGround;
  structures?: CanvasSpecStructure[];
  /** Background trees, 0-8. */
  trees?: number;
  /** Ground fog density, 0-1. */
  fog?: number;
  /** Optional warm practical light on the ground, x 0-1. */
  lampX?: number;
  palette?: 'cold' | 'warm' | 'ash';
};

export type CanvasVectorDirection = {
  /** Purposeful background work; [] deliberately keeps the ensemble still.
   * Native crowded markets supply sensible defaults when omitted. */
  backgroundActions?: Array<{actor:string;activity:'pass'|'visit'|'attend'|'converse'|'hold';partner?:string}>;
  /** A new chapter/time jump may deliberately discard the preceding state. */
  continuity?: 'continue'|'reset';
  /** End hand ownership changes only at a visible, narrated event. */
  propEvents?: Array<{prop:string;action:'take'|'release';cue:string}>;
  purpose: string;
  location: string;
  /** Actors present in this view, including cue-timed entrances. [] is an empty set. */
  visibleCast?: string[];
  /** Explicit occupied hands for this shot; geometry comes from asset grips. */
  heldProps?: Array<{actor:string;arm:'l'|'r';prop:string;hang?:boolean}>;
  shot: {size:'wide'|'action'|'detail'|'reaction';focus:string;include:string[];framing?:'context'|'close'};
  beats: Array<{
    cue:string; kind:'motion'|'travel'|'row'|'strike'|'reveal'|'hide'|'hold';
    targets:string[]; motionTargets:string[]; before:string; after:string;
    /** Executable destination; the illustrator supplies geometry, not timing. */
    travel?: {actor:string;to:string;gap?:number;followDepth?:boolean};
    /** A locked whole-body pose change, executed by the compact rig. */
    turn?: {actor:string;from:'front'|'back'|'left'|'right';to:'front'|'back'|'left'|'right'};
    /** Cue-linked compact performance, independent of illustrator keyframes. */
    fear?: {actor:string;level:'uneasy'|'terrified'};
  }>;
};

export type CanvasStudioScene = {
  id: string;
  name: string;
  durationMs: number;
  /** Stable physical set/location identity reused across editorial cuts. */
  stageId?: string;
  /** Derived continuous dialogue stage; preview must retain its compiled geometry. */
  dialogueLayout?: boolean;
  /**
   * Compiled camera continuity basis. Recurring characters listed here keep
   * ownership of camera auto-fit across same-stage additive scene boundaries;
   * newly introduced support actors must not recenter the whole frame.
   */
  continuityCameraCharacterKeys?: string[];
  atmosphere?: {
    rainIntensity?: number;
    waterIntensity?: number;
    timeOffsetMs?: number;
    timeOfDay?: 'day' | 'dusk' | 'night';
    /** Continuous low-amplitude ambience, independent from story actions. */
    fogDrift?: number;
    dustMotes?: number;
    filmGrain?: number;
    shadowBreath?: number;
    fireFlicker?: number;
    lampBreath?: number;
    wind?: number;
  };
  /** Preserve continuous narration captions through authored coverage cuts. */
  captionTrack?: {text:string;durationMs:number;offsetMs:number};
  /** Composition template chosen semantically, then compiled into pixel layout. */
  template?: CanvasSceneTemplate;
  background: CanvasBackgroundPreset;
  /** Authored environment composition. Production plans must use a registered ref. */
  backgroundRef?: string;
  /** Layered new-location spec; rendered when backgroundRef is 'bg:composed'. */
  backgroundSpec?: CanvasBackgroundSpec;
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
  /** Editorial changes that happen inside one continuous stage/camera shot. */
  visualBeats?: CanvasVisualBeat[];
  /**
   * Explicit voice-activity windows driving mouth motion. When omitted the
   * renderer derives pauses from talk beats; scenes without talk beats keep
   * the legacy always-animating mouth so old projects render unchanged.
   */
  lipSync?: Array<{ startMs: number; endMs: number }>;
  /** Fully authored vector stage, independent of the preset layout compiler. */
  vectorScene?: CanvasVectorScene;
  vectorStageId?: string;
  vectorBeats?: Array<{cue:string;targets:string[]}>;
  /** Locked screenplay and observable action requirements, independent of artwork. */
  vectorDirection?: CanvasVectorDirection;
  /** Derived shot sizing applied once; later explicit camera repairs win. */
  vectorFramingVersion?: 1;
  /** Derived references for the frame renderer; source assets live on the project. */
  vectorAssetLibrary?: Record<string,VectorDrawing>;
  objects: CanvasStudioObject[];
};

export type CanvasStudioProject = {
  vectorStory?: {premise:string;stakes:string;turn:string;ending:string};
  vectorAssets?: Record<string,VectorDrawing>;
  vectorStages?: Record<string,CanvasVectorScene>;
  vectorStyleReferences?:string[];
  vectorReview?: {pass:boolean; rounds:number; previewDirectory:string;issues?:Array<{sceneId:string;problem:string;fix:string}>};
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Optional final runtime: uniformly retime pictures and sound at export. */
  exportDurationMs?: number;
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

export function canvasExportFramePlan(project:CanvasStudioProject){
  const frames=project.scenes.map(scene=>Math.max(1,Math.round(Math.max(1,scene.durationMs)/1000*project.fps)));
  if(project.exportDurationMs===undefined)return frames;
  const source=frames.reduce((a,b)=>a+b,0),target=Math.round(project.exportDurationMs/1000*project.fps);
  if(!Number.isFinite(target)||target<frames.length||target/source<.8||target/source>1.2)throw new Error('Export runtime must stay within 20% of the voiced film');
  let elapsed=0,allocated=0;
  return frames.map(n=>{elapsed+=n;const end=Math.round(elapsed*target/source),count=end-allocated;allocated=end;return count;});
}

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
