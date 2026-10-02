import type {
  CanvasBackgroundPreset,
  CanvasCharacterArchetype,
  CanvasPropVariant,
  CanvasSceneTemplate,
  CanvasStudioObject,
  CanvasStudioScene,
} from './canvasAnimationStudio';

export type CanvasAuthoredAssetKind = 'character' | 'ship' | 'stake' | 'prop';
export type CanvasAuthoredBackgroundDefinition = {
  id: string;
  background: CanvasBackgroundPreset;
  templates: CanvasSceneTemplate[];
  label: string;
  /** 1-10 production art-detail score. Production backgrounds must be >= 8. */
  detailScore: number;
};

export type CanvasAuthoredAssetDefinition = {
  id: string;
  kind: CanvasAuthoredAssetKind;
  label: string;
  /** 1-10 production art-detail score. Focal semantic assets must be >= 8. */
  detailScore: number;
  propVariant?: CanvasPropVariant;
  characterArchetype?: CanvasCharacterArchetype;
};

const CHARACTER_ASSETS: CanvasAuthoredAssetDefinition[] = (
  ['narrator', 'warrior', 'scholar', 'villager', 'merchant', 'sailor', 'worker'] as CanvasCharacterArchetype[]
).map((archetype) => ({
  id: `character:${archetype}`,
  kind: 'character',
  label: `Authored ${archetype} actor`,
  detailScore: 9,
  characterArchetype: archetype,
}));

const PROP_ASSETS: CanvasAuthoredAssetDefinition[] = (
  ['tree', 'house', 'fire', 'barrel', 'shield', 'sword', 'flag', 'mountain', 'book', 'bridge', 'clock', 'lightbulb', 'ghost', 'cart', 'box', 'door', 'window', 'bowl', 'pipe', 'bamboo', 'table', 'chair', 'lantern', 'bed', 'basket', 'rope', 'stairs', 'floorboard', 'note', 'phone','oar','teapot','sandals'] as CanvasPropVariant[]
).map((variant) => ({
  id: `prop:${variant}`,
  kind: 'prop',
  label: `Authored ${variant}`,
  detailScore: ['tree','fire','barrel','book','bridge','clock','lightbulb'].includes(variant) ? 9 : 8,
  propVariant: variant,
}));

export const CANVAS_AUTHORED_BACKGROUNDS: CanvasAuthoredBackgroundDefinition[] = [
  { id:'bg:night-hill-path',background:'night',templates:['wide-establishing','two-shot','hero-left','hero-right'],label:'Safe hillside path above the flood',detailScore:10 },
  { id:'bg:night-rescue-banks',background:'night',templates:['wide-establishing','two-shot','close-reaction','prop-focus','hero-left','hero-right'],label:'Separated river banks and elevated rescue platform',detailScore:10 },
  { id: 'bg:river-establishing', background: 'river', templates: ['wide-establishing', 'hero-left', 'hero-right', 'two-shot'], label: 'Layered river establishing', detailScore: 10 },
  { id: 'bg:river-shoreline', background: 'river', templates: ['wide-establishing', 'hero-left', 'close-reaction', 'prop-focus', 'over-shoulder'], label: 'Near-bank river detail', detailScore: 10 },
  { id: 'bg:river-pov', background: 'river', templates: ['foreground-pov'], label: 'Foreground-framed river POV', detailScore: 9 },
  { id: 'bg:night-river', background: 'night', templates: ['wide-establishing', 'hero-left', 'hero-right', 'two-shot', 'close-reaction'], label: 'Moonlit river environment', detailScore: 9 },
  { id: 'bg:night-river-shoreline', background: 'night', templates: ['wide-establishing', 'hero-left', 'close-reaction', 'prop-focus', 'over-shoulder'], label: 'Moonlit near-bank river with solid left shore', detailScore: 10 },
  { id: 'bg:night-stilt-house', background: 'night', templates: ['wide-establishing', 'hero-left', 'hero-right', 'two-shot', 'close-reaction', 'prop-focus'], label: 'Isolated mountain stilt-house at night', detailScore: 10 },
  { id: 'bg:field-open', background: 'field', templates: ['wide-establishing', 'hero-left', 'hero-right', 'two-shot'], label: 'Open field layered landscape', detailScore: 9 },
  { id: 'bg:field-camp', background: 'field', templates: ['prop-focus', 'over-shoulder', 'close-reaction'], label: 'Camp/detail field environment', detailScore: 10 },
  { id: 'bg:city-street', background: 'city', templates: ['wide-establishing', 'hero-left', 'hero-right', 'two-shot'], label: 'Editorial city street', detailScore: 10 },
  { id: 'bg:city-close', background: 'city', templates: ['close-reaction', 'prop-focus', 'over-shoulder'], label: 'Close city facade environment', detailScore: 9 },
  { id: 'bg:room-study', background: 'room', templates: ['close-reaction', 'hero-left', 'hero-right', 'two-shot', 'prop-focus'], label: 'Warm editorial interior', detailScore: 10 },
  { id: 'bg:room-stilt-house', background: 'room', templates: ['close-reaction', 'hero-left', 'hero-right', 'two-shot', 'prop-focus', 'foreground-pov', 'over-shoulder'], label: 'Dark timber stilt-house interior', detailScore: 10 },
  { id: 'bg:room-underfloor', background: 'room', templates: ['prop-focus', 'foreground-pov', 'close-reaction'], label: 'Under-floor timber crawlspace', detailScore: 10 },
  { id: 'bg:room-floor-detail', background: 'room', templates: ['prop-focus', 'foreground-pov', 'close-reaction'], label: 'Top-down timber floor insert', detailScore: 9 },
  { id: 'bg:room-stilt-day', background: 'room', templates: ['two-shot', 'close-reaction', 'hero-left', 'hero-right'], label: 'Morning light in the same timber interior', detailScore: 10 },
  { id: 'bg:paper-editorial', background: 'paper', templates: ['diagram-clean', 'split-contrast', 'close-reaction', 'prop-focus', 'foreground-pov'], label: 'Editorial paper stage', detailScore: 8 },
  { id: 'bg:underwater-stakes', background: 'underwater', templates: ['wide-establishing', 'prop-focus', 'foreground-pov', 'close-reaction'], label: 'Underwater stake environment', detailScore: 9 },
  { id: 'bg:map-tactical', background: 'map', templates: ['diagram-clean', 'split-contrast', 'prop-focus'], label: 'Tactical map environment', detailScore: 8 },
];

export const CANVAS_AUTHORED_ASSETS: CanvasAuthoredAssetDefinition[] = [
  ...CHARACTER_ASSETS,
  { id: 'ship:historical-warship', kind: 'ship', label: 'Authored historical warship', detailScore: 10 },
  { id: 'ship:wooden-ferry', kind: 'ship', label: 'Low wooden river ferry with benches and oar, no sails', detailScore: 9 },
  { id: 'stake:wood-cluster', kind: 'stake', label: 'Authored sharpened wood stake cluster', detailScore: 8 },
  ...PROP_ASSETS,
];

const BY_ID = new Map(CANVAS_AUTHORED_ASSETS.map((asset) => [asset.id, asset]));
const BACKGROUND_BY_ID = new Map(CANVAS_AUTHORED_BACKGROUNDS.map((asset) => [asset.id, asset]));

export function canvasShipStyle(object: Partial<Pick<CanvasStudioObject,'assetRef'|'label'|'designNotes'>>) {
  if(object.assetRef==='ship:wooden-ferry')return 'ferry';
  const description=`${object.label||''} ${object.designNotes||''}`.normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/g,'d').toLowerCase();
  if(/warship|chien|ham|quan|fleet|mongol|yuan/.test(description))return 'historical';
  return /\b(do|ferry|rowboat|canoe|sampan|xuong)\b|thuyen go|thuyen cheo/.test(description)?'ferry':'historical';
}
export function defaultCanvasAssetRef(object: Pick<CanvasStudioObject, 'kind' | 'archetype' | 'variant'> & Partial<Pick<CanvasStudioObject,'label'|'designNotes'|'assetRef'>>) {
  if (object.kind === 'character') return `character:${object.archetype || 'narrator'}`;
  if (object.kind === 'ship') return canvasShipStyle(object)==='ferry'?'ship:wooden-ferry':'ship:historical-warship';
  if (object.kind === 'stake') return 'stake:wood-cluster';
  if (object.kind === 'prop' && object.variant) return `prop:${object.variant}`;
  return undefined;
}

export function resolveCanvasAuthoredAsset(
  object: Pick<CanvasStudioObject, 'kind' | 'archetype' | 'variant' | 'assetRef'>,
) {
  const id = object.assetRef || defaultCanvasAssetRef(object);
  return id ? BY_ID.get(id) : undefined;
}

/** An authored asset reference must not silently turn into a generic box. */
export function resolveCanvasPropVariant(object: Pick<CanvasStudioObject, 'kind' | 'variant' | 'assetRef'>) {
  return resolveCanvasAuthoredAsset(object)?.propVariant || object.variant || 'box';
}

export function isCanvasAuthoredAssetSupported(
  object: Pick<CanvasStudioObject, 'kind' | 'archetype' | 'variant' | 'assetRef'>,
) {
  if (object.kind === 'text' || object.kind === 'shape' || object.kind === 'image') return true;
  return Boolean(resolveCanvasAuthoredAsset(object));
}

export function defaultCanvasBackgroundRef(
  scene: Pick<CanvasStudioScene, 'background' | 'template'>,
) {
  const template = scene.template || 'wide-establishing';
  return CANVAS_AUTHORED_BACKGROUNDS.find((item) =>
    item.background === scene.background && item.templates.includes(template),
  )?.id
    || CANVAS_AUTHORED_BACKGROUNDS.find((item) => item.background === scene.background)?.id;
}

export function resolveCanvasAuthoredBackground(
  scene: Pick<CanvasStudioScene, 'background' | 'template' | 'backgroundRef'>,
) {
  const id = scene.backgroundRef || defaultCanvasBackgroundRef(scene);
  const asset = id ? BACKGROUND_BY_ID.get(id) : undefined;
  if (!asset) return undefined;
  const template = scene.template || 'wide-establishing';
  if (asset.background !== scene.background) return undefined;
  if (!asset.templates.includes(template)) return undefined;
  return asset;
}

export function canvasAuthoredAssetVocabulary() {
  return {
    characters: CHARACTER_ASSETS.map((asset) => asset.characterArchetype!).join('|'),
    props: PROP_ASSETS.map((asset) => asset.propVariant!).join('|'),
    assetRefs: CANVAS_AUTHORED_ASSETS.map((asset) => asset.id).join('|'),
    backgroundRefs: CANVAS_AUTHORED_BACKGROUNDS.map((asset) => asset.id).join('|'),
  };
}
