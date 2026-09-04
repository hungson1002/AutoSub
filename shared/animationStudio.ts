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

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

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
