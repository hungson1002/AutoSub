export const ANIMATION_PROJECT_VERSION = 1 as const;

export type AnimationRenderMode = 'composite' | 'generated-video';
export type AssetType = 'character' | 'sprite' | 'background' | 'object' | 'icon' | 'image' | 'audio' | 'effect';
export type LayerType = 'image' | 'sprite' | 'text' | 'shape' | 'diagram' | 'chart' | 'particle' | 'audio';
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type AnimationCommandType =
  | 'MOVE' | 'WALK' | 'RUN' | 'JUMP' | 'FALL' | 'PLAY_ANIMATION'
  | 'LOOK_AT' | 'LOOK_LEFT' | 'LOOK_RIGHT' | 'POINT' | 'TALK' | 'SIT' | 'SLEEP'
  | 'FADE_IN' | 'FADE_OUT' | 'SCALE' | 'ROTATE' | 'ZOOM_IN' | 'ZOOM_OUT'
  | 'PAN_LEFT' | 'PAN_RIGHT' | 'CAMERA_SHAKE' | 'SPAWN' | 'DESPAWN'
  | 'BOUNCE' | 'EXPLOSION' | 'FLASH';

export interface Point { x: number; y: number }

export interface Transform {
  position: Point;
  scale: Point;
  rotation: number;
  opacity: number;
  anchor: Point;
}

export interface AnimationAsset {
  id: string;
  type: AssetType;
  name: string;
  uri: string;
  tags: string[];
  /** Optional production lifecycle marker. Older projects may omit it. */
  status?: 'approved' | 'candidate' | 'rejected' | 'draft';
  /** Stable content/config key used to avoid charging for duplicate generation. */
  cacheKey?: string;
  style?: string;
  width?: number;
  height?: number;
  animations?: string[];
  sprite?: {
    frameWidth: number;
    frameHeight: number;
    columns: number;
    frameCount: number;
    clips: Record<string, { from: number; to: number; fps: number; loop?: boolean }>;
  };
  createdAt: string;
  source?: 'upload' | 'generated' | 'bundled';
  generationPrompt?: string;
}

export interface SceneLayer {
  id: string;
  type: LayerType;
  name: string;
  assetId?: string;
  text?: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  width: number;
  height: number;
  fill?: string;
  fontSize?: number;
  shape?: 'rectangle' | 'ellipse';
  animation?: string;
  characterId?: string;
  data?: number[];
  labels?: string[];
  wordTimings?: Array<{ word: string; startMs: number; endMs: number }>;
  /** Sentence/cue timing used when word-level alignment is not available. */
  captionTimings?: Array<{ id?: string; text: string; startMs: number; endMs: number; source?: 'sentence-proportional' | 'measured-sentence' | 'provider' | 'forced-alignment' }>;
  startMs?: number;
  durationMs?: number;
  volume?: number;
  transform: Transform;
}

export interface AnimationCommand {
  id: string;
  type: AnimationCommandType;
  targetId: string;
  startMs: number;
  durationMs: number;
  easing?: Easing;
  from?: number | Point;
  to?: number | Point;
  animation?: string;
  target?: string;
  parameters?: Record<string, string | number | boolean>;
}

export interface CameraDefinition {
  transform: Transform;
  commands: AnimationCommand[];
}

interface SceneBase {
  id: string;
  name: string;
  durationMs: number;
  narration: string;
  order: number;
}

export interface CompositeScene extends SceneBase {
  renderMode: 'composite';
  backgroundColor: string;
  layers: SceneLayer[];
  commands: AnimationCommand[];
  camera: CameraDefinition;
}

export interface GeneratedVideoScene extends SceneBase {
  renderMode: 'generated-video';
  prompt: string;
  source?: { kind: 'external-video'; uri: string };
}

export type AnimationScene = CompositeScene | GeneratedVideoScene;

export type AnimationProductionTechnique = 'image-camera' | 'object-composite' | 'diagram' | 'sprite' | 'rig' | 'generated-video' | 'hold';

export interface AnimationNarrationUnit {
  id: string;
  sceneId: string;
  text: string;
  startMs?: number;
  endMs?: number;
  timingSource?: 'planned' | 'provider' | 'forced-alignment' | 'sentence-proportional' | 'measured-sentence';
}

export interface AnimationBeatContract {
  id: string;
  sceneId: string;
  narrationUnitId: string;
  cueText?: string;
  cueOccurrence?: number;
  subjectIds: string[];
  focusSubjectId?: string;
  action?: { description: string; actorId?: string; beforeState?: string; afterState?: string; targetId?: string };
  technique: AnimationProductionTechnique;
  startMs?: number;
  endMs?: number;
  screenDirection?: 'left-to-right' | 'right-to-left' | 'static';
  entryState?: string;
  exitState?: string;
  visibleEvidence: string;
  failureConditions: string[];
}

export interface AnimationProductionPlan {
  version: 1;
  source: 'director' | 'manual';
  status: 'draft' | 'ready' | 'warning';
  continuityBible?: string;
  narrationUnits: AnimationNarrationUnit[];
  beats: AnimationBeatContract[];
  diagnostics?: string[];
}

export type AnimationManifestRole = 'background' | 'character' | 'object' | 'diagram' | 'audio' | 'effect';

export interface AnimationAssetManifestEntry {
  id: string;
  role: AnimationManifestRole;
  name: string;
  sceneIds: string[];
  beatIds: string[];
  assetIds: string[];
  required: boolean;
  status: 'ready' | 'candidate' | 'missing' | 'rejected';
  capabilities: string[];
  cacheKey?: string;
}

export interface AnimationAssetManifest {
  version: 1;
  generatedAt: string;
  styleKey?: string;
  entries: AnimationAssetManifestEntry[];
  diagnostics?: string[];
}

export interface AnimationProject {
  schemaVersion: typeof ANIMATION_PROJECT_VERSION;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  createdAt: string;
  updatedAt: string;
  assets: AnimationAsset[];
  scenes: AnimationScene[];
  productionPlan?: AnimationProductionPlan;
  /** Optional, derived inventory for asset preflight and resumable generation. */
  assetManifest?: AnimationAssetManifest;
  styleProfile?: { name: string; style: string; palette?: string[]; subtitlePreset?: string; pacing?: 'slow' | 'balanced' | 'fast' };
  templateId?: string;
  generationWarnings?: string[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

const commandTypes = new Set<AnimationCommandType>([
  'MOVE', 'WALK', 'RUN', 'JUMP', 'FALL', 'PLAY_ANIMATION', 'LOOK_AT', 'LOOK_LEFT', 'LOOK_RIGHT',
  'POINT', 'TALK', 'SIT', 'SLEEP', 'FADE_IN', 'FADE_OUT', 'SCALE', 'ROTATE', 'ZOOM_IN',
  'ZOOM_OUT', 'PAN_LEFT', 'PAN_RIGHT', 'CAMERA_SHAKE', 'SPAWN', 'DESPAWN', 'BOUNCE', 'EXPLOSION', 'FLASH',
]);
const assetTypes = new Set<AssetType>(['character', 'sprite', 'background', 'object', 'icon', 'image', 'audio', 'effect']);
const layerTypes = new Set<LayerType>(['image', 'sprite', 'text', 'shape', 'diagram', 'chart', 'particle', 'audio']);
const productionTechniques = new Set<AnimationProductionTechnique>(['image-camera', 'object-composite', 'diagram', 'sprite', 'rig', 'generated-video', 'hold']);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function occurrenceCount(text: string, cue: string) {
  if (!cue) return 0;
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(cue, from);
    if (index < 0) break;
    count += 1;
    from = index + Math.max(1, cue.length);
  }
  return count;
}

function validateTransform(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!isRecord(value)) return void issues.push({ path, message: 'Transform must be an object.' });
  for (const key of ['position', 'scale', 'anchor'] as const) {
    const point = value[key];
    if (!isRecord(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) issues.push({ path: `${path}.${key}`, message: 'Point must contain finite x and y values.' });
  }
  if (!isFiniteNumber(value.rotation)) issues.push({ path: `${path}.rotation`, message: 'Rotation must be finite.' });
  if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) issues.push({ path: `${path}.opacity`, message: 'Opacity must be between 0 and 1.' });
}

function validateCommands(value: unknown, path: string, durationMs: number, validTargets: Set<string>, issues: ValidationIssue[]) {
  if (!Array.isArray(value)) return void issues.push({ path, message: 'Commands must be an array.' });
  const ids = new Set<string>();
  value.forEach((raw, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(raw)) return void issues.push({ path: itemPath, message: 'Command must be an object.' });
    if (!isNonEmptyString(raw.id) || ids.has(raw.id)) issues.push({ path: `${itemPath}.id`, message: 'Command id must be non-empty and unique in its track.' });
    else ids.add(raw.id);
    if (!isNonEmptyString(raw.type) || !commandTypes.has(raw.type as AnimationCommandType)) issues.push({ path: `${itemPath}.type`, message: 'Unknown animation command.' });
    if (!isNonEmptyString(raw.targetId) || !validTargets.has(raw.targetId)) issues.push({ path: `${itemPath}.targetId`, message: 'Command target does not exist in this scene.' });
    if (raw.type === 'LOOK_AT' && (!isNonEmptyString(raw.target) || !validTargets.has(raw.target))) issues.push({ path: `${itemPath}.target`, message: 'LOOK_AT target does not exist in this scene.' });
    if (!isFiniteNumber(raw.startMs) || raw.startMs < 0) issues.push({ path: `${itemPath}.startMs`, message: 'startMs must be zero or greater.' });
    if (!isFiniteNumber(raw.durationMs) || raw.durationMs < 0) issues.push({ path: `${itemPath}.durationMs`, message: 'durationMs must be zero or greater.' });
    if (isFiniteNumber(raw.startMs) && isFiniteNumber(raw.durationMs) && raw.startMs + raw.durationMs > durationMs) issues.push({ path: itemPath, message: 'Command extends beyond scene duration.' });
  });
}

export function validateAnimationProject(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return [{ path: '$', message: 'Project must be an object.' }];
  if (value.schemaVersion !== ANIMATION_PROJECT_VERSION) issues.push({ path: 'schemaVersion', message: `Only schema version ${ANIMATION_PROJECT_VERSION} is supported.` });
  for (const field of ['id', 'name', 'createdAt', 'updatedAt'] as const) if (!isNonEmptyString(value[field])) issues.push({ path: field, message: `${field} is required.` });
  if (!isFiniteNumber(value.width) || value.width < 1) issues.push({ path: 'width', message: 'Width must be positive.' });
  if (!isFiniteNumber(value.height) || value.height < 1) issues.push({ path: 'height', message: 'Height must be positive.' });
  if (!isFiniteNumber(value.fps) || value.fps < 1 || value.fps > 120) issues.push({ path: 'fps', message: 'FPS must be between 1 and 120.' });

  const assetIds = new Set<string>();
  if (!Array.isArray(value.assets)) issues.push({ path: 'assets', message: 'Assets must be an array.' });
  else value.assets.forEach((raw, index) => {
    const path = `assets[${index}]`;
    if (!isRecord(raw)) return void issues.push({ path, message: 'Asset must be an object.' });
    if (!isNonEmptyString(raw.id) || assetIds.has(raw.id)) issues.push({ path: `${path}.id`, message: 'Asset id must be non-empty and unique.' });
    else assetIds.add(raw.id);
    if (!isNonEmptyString(raw.name)) issues.push({ path: `${path}.name`, message: 'Asset name is required.' });
    if (!isNonEmptyString(raw.type) || !assetTypes.has(raw.type as AssetType)) issues.push({ path: `${path}.type`, message: 'Unknown asset type.' });
    if (!isNonEmptyString(raw.uri)) issues.push({ path: `${path}.uri`, message: 'Asset uri is required.' });
    if (!Array.isArray(raw.tags)) issues.push({ path: `${path}.tags`, message: 'Asset tags must be an array.' });
    if (raw.status !== undefined && (!isNonEmptyString(raw.status) || !['approved', 'candidate', 'rejected', 'draft'].includes(raw.status))) issues.push({ path: `${path}.status`, message: 'Asset status is invalid.' });
    if (raw.cacheKey !== undefined && (!isNonEmptyString(raw.cacheKey) || !/^[a-f0-9]{64}$/i.test(raw.cacheKey))) issues.push({ path: `${path}.cacheKey`, message: 'Asset cacheKey must be a SHA-256 hex string.' });
    if (raw.sprite !== undefined) {
      if (!isRecord(raw.sprite) || !isFiniteNumber(raw.sprite.frameWidth) || raw.sprite.frameWidth < 1 || !isFiniteNumber(raw.sprite.frameHeight) || raw.sprite.frameHeight < 1 || !isFiniteNumber(raw.sprite.columns) || raw.sprite.columns < 1 || !isFiniteNumber(raw.sprite.frameCount) || raw.sprite.frameCount < 1 || !isRecord(raw.sprite.clips)) issues.push({ path: `${path}.sprite`, message: 'Sprite metadata must define positive frame dimensions, columns, frameCount and clips.' });
    }
  });
  const sceneIds = new Set<string>();
  const characterAssets = new Map<string, string>();
  if (!Array.isArray(value.scenes)) issues.push({ path: 'scenes', message: 'Scenes must be an array.' });
  else value.scenes.forEach((raw, index) => {
    const path = `scenes[${index}]`;
    if (!isRecord(raw)) return void issues.push({ path, message: 'Scene must be an object.' });
    if (!isNonEmptyString(raw.id) || sceneIds.has(raw.id)) issues.push({ path: `${path}.id`, message: 'Scene id must be non-empty and unique.' });
    else sceneIds.add(raw.id);
    if (!isNonEmptyString(raw.name)) issues.push({ path: `${path}.name`, message: 'Scene name is required.' });
    if (!isFiniteNumber(raw.durationMs) || raw.durationMs < 1) issues.push({ path: `${path}.durationMs`, message: 'Scene duration must be positive.' });
    if (!isFiniteNumber(raw.order) || raw.order < 0) issues.push({ path: `${path}.order`, message: 'Scene order must be zero or greater.' });
    if (raw.renderMode === 'generated-video') {
      if (typeof raw.prompt !== 'string') issues.push({ path: `${path}.prompt`, message: 'Generated video prompt must be a string.' });
      return;
    }
    if (raw.renderMode !== 'composite') return void issues.push({ path: `${path}.renderMode`, message: 'Unknown render mode.' });
    if (!Array.isArray(raw.layers)) return void issues.push({ path: `${path}.layers`, message: 'Composite scene layers must be an array.' });
    const layerIds = new Set<string>();
    raw.layers.forEach((layer, layerIndex) => {
      const layerPath = `${path}.layers[${layerIndex}]`;
      if (!isRecord(layer)) return void issues.push({ path: layerPath, message: 'Layer must be an object.' });
      if (!isNonEmptyString(layer.id) || layerIds.has(layer.id)) issues.push({ path: `${layerPath}.id`, message: 'Layer id must be non-empty and unique in its scene.' });
      else layerIds.add(layer.id);
      if (!isNonEmptyString(layer.type) || !layerTypes.has(layer.type as LayerType)) issues.push({ path: `${layerPath}.type`, message: 'Unknown layer type.' });
      if (layer.assetId !== undefined && (!isNonEmptyString(layer.assetId) || !assetIds.has(layer.assetId))) issues.push({ path: `${layerPath}.assetId`, message: 'Layer asset does not exist in the project.' });
      if (!isFiniteNumber(layer.width) || layer.width < 1) issues.push({ path: `${layerPath}.width`, message: 'Layer width must be positive.' });
      if (!isFiniteNumber(layer.height) || layer.height < 1) issues.push({ path: `${layerPath}.height`, message: 'Layer height must be positive.' });
      validateTransform(layer.transform, `${layerPath}.transform`, issues);
      if (layer.type === 'audio') { if (layer.startMs !== undefined && (!isFiniteNumber(layer.startMs) || layer.startMs < 0)) issues.push({ path: `${layerPath}.startMs`, message: 'Audio startMs must be zero or greater.' }); if (layer.durationMs !== undefined && (!isFiniteNumber(layer.durationMs) || layer.durationMs < 0)) issues.push({ path: `${layerPath}.durationMs`, message: 'Audio durationMs must be zero or greater.' }); if (isFiniteNumber(layer.startMs) && isFiniteNumber(layer.durationMs) && isFiniteNumber(raw.durationMs) && layer.startMs + layer.durationMs > raw.durationMs) issues.push({ path: layerPath, message: 'Audio layer extends beyond scene duration.' }); if (layer.volume !== undefined && (!isFiniteNumber(layer.volume) || layer.volume < 0 || layer.volume > 1)) issues.push({ path: `${layerPath}.volume`, message: 'Audio volume must be between 0 and 1.' }); }
      if (isNonEmptyString(layer.characterId) && isNonEmptyString(layer.assetId)) { const previous = characterAssets.get(layer.characterId); if (previous && previous !== layer.assetId) issues.push({ path: `${layerPath}.characterId`, message: 'A characterId must keep the same assetId across scenes.' }); else characterAssets.set(layer.characterId, layer.assetId); }
    });
    const sceneDuration = isFiniteNumber(raw.durationMs) ? raw.durationMs : 0;
    validateCommands(raw.commands, `${path}.commands`, sceneDuration, layerIds, issues);
    if (!isRecord(raw.camera)) issues.push({ path: `${path}.camera`, message: 'Camera is required.' });
    else {
      validateTransform(raw.camera.transform, `${path}.camera.transform`, issues);
      validateCommands(raw.camera.commands, `${path}.camera.commands`, sceneDuration, new Set(['camera']), issues);
    }
  });
  if (value.assetManifest !== undefined) {
    const manifest = value.assetManifest;
    if (!isRecord(manifest)) issues.push({ path: 'assetManifest', message: 'Asset manifest must be an object.' });
    else {
      if (manifest.version !== 1) issues.push({ path: 'assetManifest.version', message: 'Only asset manifest version 1 is supported.' });
      if (!isNonEmptyString(manifest.generatedAt)) issues.push({ path: 'assetManifest.generatedAt', message: 'Asset manifest generatedAt is required.' });
      if (!Array.isArray(manifest.entries)) issues.push({ path: 'assetManifest.entries', message: 'Asset manifest entries must be an array.' });
      else {
        const manifestIds = new Set<string>();
        manifest.entries.forEach((entry, index) => {
          const entryPath = `assetManifest.entries[${index}]`;
          if (!isRecord(entry)) return void issues.push({ path: entryPath, message: 'Asset manifest entry must be an object.' });
          if (!isNonEmptyString(entry.id) || manifestIds.has(entry.id)) issues.push({ path: `${entryPath}.id`, message: 'Manifest entry id must be non-empty and unique.' }); else manifestIds.add(entry.id);
          if (!isNonEmptyString(entry.role) || !['background', 'character', 'object', 'diagram', 'audio', 'effect'].includes(entry.role)) issues.push({ path: `${entryPath}.role`, message: 'Manifest role is invalid.' });
          if (!isNonEmptyString(entry.name)) issues.push({ path: `${entryPath}.name`, message: 'Manifest entry name is required.' });
          for (const field of ['sceneIds', 'beatIds', 'assetIds', 'capabilities'] as const) if (!Array.isArray(entry[field]) || entry[field].some((item) => typeof item !== 'string')) issues.push({ path: `${entryPath}.${field}`, message: `${field} must be an array of strings.` });
          if (typeof entry.required !== 'boolean') issues.push({ path: `${entryPath}.required`, message: 'Manifest required must be boolean.' });
          if (!isNonEmptyString(entry.status) || !['ready', 'candidate', 'missing', 'rejected'].includes(entry.status)) issues.push({ path: `${entryPath}.status`, message: 'Manifest status is invalid.' });
          if (entry.cacheKey !== undefined && (!isNonEmptyString(entry.cacheKey) || !/^[a-f0-9]{64}$/i.test(entry.cacheKey))) issues.push({ path: `${entryPath}.cacheKey`, message: 'Manifest cacheKey must be a SHA-256 hex string.' });
          if (Array.isArray(entry.sceneIds) && entry.sceneIds.some((sceneId) => !sceneIds.has(sceneId))) issues.push({ path: `${entryPath}.sceneIds`, message: 'Manifest references an unknown scene.' });
          if (Array.isArray(entry.assetIds) && entry.assetIds.some((assetId) => !assetIds.has(assetId))) issues.push({ path: `${entryPath}.assetIds`, message: 'Manifest references an unknown asset.' });
        });
      }
    }
  }
  if (value.productionPlan !== undefined) {
    const plan = value.productionPlan;
    if (!isRecord(plan)) issues.push({ path: 'productionPlan', message: 'Production plan must be an object.' });
    else {
      if (plan.version !== 1) issues.push({ path: 'productionPlan.version', message: 'Only production plan version 1 is supported.' });
      if (!isNonEmptyString(plan.source) || !['director', 'manual'].includes(plan.source)) issues.push({ path: 'productionPlan.source', message: 'Production plan source is invalid.' });
      if (!isNonEmptyString(plan.status) || !['draft', 'ready', 'warning'].includes(plan.status)) issues.push({ path: 'productionPlan.status', message: 'Production plan status is invalid.' });
      const narrationIds = new Set<string>();
      const sceneDurations = new Map<string, number>();
      if (Array.isArray(value.scenes)) value.scenes.forEach((scene) => { if (isRecord(scene) && isNonEmptyString(scene.id) && isFiniteNumber(scene.durationMs)) sceneDurations.set(scene.id, scene.durationMs); });
      if (!Array.isArray(plan.narrationUnits)) issues.push({ path: 'productionPlan.narrationUnits', message: 'Narration units must be an array.' });
      else plan.narrationUnits.forEach((unit, index) => {
        const unitPath = `productionPlan.narrationUnits[${index}]`;
        if (!isRecord(unit)) return void issues.push({ path: unitPath, message: 'Narration unit must be an object.' });
        if (!isNonEmptyString(unit.id) || narrationIds.has(unit.id)) issues.push({ path: `${unitPath}.id`, message: 'Narration unit id must be non-empty and unique.' }); else narrationIds.add(unit.id);
        if (!isNonEmptyString(unit.sceneId) || !sceneIds.has(unit.sceneId)) issues.push({ path: `${unitPath}.sceneId`, message: 'Narration unit scene does not exist.' });
        if (!isNonEmptyString(unit.text)) issues.push({ path: `${unitPath}.text`, message: 'Narration unit text is required.' });
        if (unit.startMs !== undefined && (!isFiniteNumber(unit.startMs) || unit.startMs < 0)) issues.push({ path: `${unitPath}.startMs`, message: 'Narration unit startMs must be zero or greater.' });
        if (unit.endMs !== undefined && (!isFiniteNumber(unit.endMs) || unit.endMs < 0)) issues.push({ path: `${unitPath}.endMs`, message: 'Narration unit endMs must be zero or greater.' });
        if (isFiniteNumber(unit.startMs) && isFiniteNumber(unit.endMs) && unit.endMs <= unit.startMs) issues.push({ path: unitPath, message: 'Narration unit endMs must be after startMs.' });
        const sceneDuration = isNonEmptyString(unit.sceneId) ? sceneDurations.get(unit.sceneId) : undefined;
        if (sceneDuration !== undefined && isFiniteNumber(unit.endMs) && unit.endMs > sceneDuration) issues.push({ path: `${unitPath}.endMs`, message: 'Narration unit extends beyond scene duration.' });
      });
      const beatIds = new Set<string>();
      if (!Array.isArray(plan.beats)) issues.push({ path: 'productionPlan.beats', message: 'Beat contracts must be an array.' });
      else plan.beats.forEach((beat, index) => {
        const beatPath = `productionPlan.beats[${index}]`;
        if (!isRecord(beat)) return void issues.push({ path: beatPath, message: 'Beat contract must be an object.' });
        if (!isNonEmptyString(beat.id) || beatIds.has(beat.id)) issues.push({ path: `${beatPath}.id`, message: 'Beat id must be non-empty and unique.' }); else beatIds.add(beat.id);
        if (!isNonEmptyString(beat.sceneId) || !sceneIds.has(beat.sceneId)) issues.push({ path: `${beatPath}.sceneId`, message: 'Beat scene does not exist.' });
        if (!isNonEmptyString(beat.narrationUnitId) || !narrationIds.has(beat.narrationUnitId)) issues.push({ path: `${beatPath}.narrationUnitId`, message: 'Beat narration unit does not exist.' });
        if (!Array.isArray(beat.subjectIds) || beat.subjectIds.some((subjectId) => typeof subjectId !== 'string')) issues.push({ path: `${beatPath}.subjectIds`, message: 'Beat subjectIds must be an array of strings.' });
        if (!isNonEmptyString(beat.technique) || !productionTechniques.has(beat.technique as AnimationProductionTechnique)) issues.push({ path: `${beatPath}.technique`, message: 'Beat technique is unsupported.' });
        if (!isNonEmptyString(beat.visibleEvidence)) issues.push({ path: `${beatPath}.visibleEvidence`, message: 'Beat visibleEvidence is required.' });
        if (!Array.isArray(beat.failureConditions) || beat.failureConditions.some((condition) => typeof condition !== 'string' || !condition.trim())) issues.push({ path: `${beatPath}.failureConditions`, message: 'Beat failureConditions must contain text.' });
        if (beat.action !== undefined && (!isRecord(beat.action) || !isNonEmptyString(beat.action.description))) issues.push({ path: `${beatPath}.action`, message: 'Beat action must contain a description.' });
        if (beat.cueText !== undefined && typeof beat.cueText !== 'string') issues.push({ path: `${beatPath}.cueText`, message: 'Beat cueText must be a string.' });
        if (beat.cueOccurrence !== undefined && (!isFiniteNumber(beat.cueOccurrence) || !Number.isInteger(beat.cueOccurrence) || beat.cueOccurrence < 0)) issues.push({ path: `${beatPath}.cueOccurrence`, message: 'Beat cueOccurrence must be a non-negative integer.' });
        const unit = Array.isArray(plan.narrationUnits) ? plan.narrationUnits.find((candidate) => isRecord(candidate) && candidate.id === beat.narrationUnitId) : undefined;
        if (typeof beat.cueText === 'string' && beat.cueText.trim() && isRecord(unit) && typeof unit.text === 'string' && !unit.text.includes(beat.cueText)) issues.push({ path: `${beatPath}.cueText`, message: 'Beat cueText is not present in its narration unit.' });
        const cueOccurrence = beat.cueOccurrence;
        if (cueOccurrence !== undefined && typeof beat.cueText === 'string' && beat.cueText.trim() && isRecord(unit) && typeof unit.text === 'string' && isFiniteNumber(cueOccurrence) && Number.isInteger(cueOccurrence) && cueOccurrence >= 0 && cueOccurrence >= occurrenceCount(unit.text, beat.cueText)) issues.push({ path: `${beatPath}.cueOccurrence`, message: 'Beat cueOccurrence does not exist in its narration unit.' });
        if (beat.startMs !== undefined && (!isFiniteNumber(beat.startMs) || beat.startMs < 0)) issues.push({ path: `${beatPath}.startMs`, message: 'Beat startMs must be zero or greater.' });
        if (beat.endMs !== undefined && (!isFiniteNumber(beat.endMs) || beat.endMs < 0)) issues.push({ path: `${beatPath}.endMs`, message: 'Beat endMs must be zero or greater.' });
        if (isFiniteNumber(beat.startMs) && isFiniteNumber(beat.endMs) && beat.endMs <= beat.startMs) issues.push({ path: beatPath, message: 'Beat endMs must be after startMs.' });
        const sceneDuration = isNonEmptyString(beat.sceneId) ? sceneDurations.get(beat.sceneId) : undefined;
        if (sceneDuration !== undefined && isFiniteNumber(beat.endMs) && beat.endMs > sceneDuration) issues.push({ path: `${beatPath}.endMs`, message: 'Beat extends beyond scene duration.' });
      });
    }
  }
  return issues;
}

export function assertAnimationProject(value: unknown): asserts value is AnimationProject {
  const issues = validateAnimationProject(value);
  if (issues.length) throw new Error(`Invalid animation project: ${issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
}

export const defaultTransform = (): Transform => ({
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  anchor: { x: 0.5, y: 0.5 },
});
