import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AIProvider } from '../types';
import { recognizeImage } from '../adapters/openaiCompatible';
import type { AnimationAsset } from '../../shared/animationStudio';
import type {
  CanvasStudioObject,
  CanvasStudioProject,
  CanvasStudioScene,
} from '../../shared/canvasAnimationStudio';
import {
  generateAnimationAsset,
  getAnimationAssetFile,
  listAnimationAssets,
  registerAnimationAsset,
  updateAnimationAsset,
  type AnimationAssetGenerationInput,
} from './animationAssets';
import { workdir } from './ffmpeg';

export const CANVAS_PRO_STYLE_BIBLE_ID = 'autosub-editorial-illustration-v1';

export const CANVAS_PRO_STYLE_BIBLE = [
  'PROFESSIONAL 2D EDITORIAL ANIMATION ASSET.',
  'A polished hand-drawn editorial explainer illustration made by an experienced animation art department.',
  'Organic imperfect dark ink contours with controlled line-weight variation; confident silhouette design; readable anatomy; expressive face and gesture.',
  'Flat muted earthy palette: warm off-white, beige, warm brown, dusty orange, sage, brick red, blue-gray, charcoal.',
  'Minimal tasteful shading only where it clarifies form. Clean shape language, restrained texture, strong visual hierarchy, generous negative space.',
  'NOT a stick figure, NOT geometric primitives, NOT an icon, NOT clip-art, NOT emoji, NOT glossy vector art, NOT 3D, NOT photorealistic.',
  'Avoid circles/rectangles as the main body construction. Hands may be simplified but must read as intentional illustrated hands, not line endpoints.',
  'Historical props and costumes must read as designed objects with believable silhouette, perspective and material cues.',
  'No typography, no captions, no watermark, no logo, no UI frame, no border.',
].join(' ');

export type CanvasAssetGenerationConfig = Pick<
  AnimationAssetGenerationInput,
  'provider' | 'model' | 'generator'
> & {
  enabled?: boolean;
  quality?: 'professional';
  /** Optional automatic failover, used when the primary image transport is unavailable/rate-limited. */
  fallback?: { provider: AIProvider; model: string };
  reviewer?: { provider: AIProvider; model: string };
};

type QcResult = {
  ok: boolean;
  reason?: string;
  occupancy?: number;
  borderMatteRatio?: number;
};

type ArtReview = {
  pass: boolean;
  score: number;
  issues: string[];
  unavailable?: boolean;
};

type ArtReviewKind = 'character-reference' | 'character-pose' | 'prop' | 'background';

type CharacterRequest = {
  key: string;
  name: string;
  design: string;
  objects: CanvasStudioObject[];
};

type BackgroundRequest = {
  key: string;
  scenes: CanvasStudioScene[];
  scene: CanvasStudioScene;
};

type PropRequest = {
  key: string;
  label: string;
  object: CanvasStudioObject;
};

const slug = (value: string) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 72) || 'asset';

const unique = <T,>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

function parseArtReview(raw: string): ArtReview {
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [];
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    return { pass: parsed.pass === true, score, issues };
  } catch {
    return { pass: false, score: 0, issues: ['Vision reviewer returned invalid JSON.'] };
  }
}

function artReviewPrompt(kind: ArtReviewKind, context: string) {
  const common = [
    'You are a strict senior 2D animation art director reviewing ONE production asset for a polished editorial explainer video.',
    'Judge the image itself, not the written prompt. Reject mediocre AI output.',
    'Return ONLY compact JSON: {"pass":true|false,"score":0-100,"issues":["..."]}.',
    'Hard reject if it looks like clip-art, emoji, geometric primitives, generic iconography, crude stick figure art, malformed anatomy, duplicated limbs, cropped subject, inconsistent perspective, unreadable silhouette, accidental text/watermark, muddy rendering, or amateur composition.',
    'The target is professional hand-drawn editorial illustration: confident organic contour, intentional shape design, readable anatomy/perspective, restrained texture, flat muted color, production-ready silhouette.',
    'Asset context: ' + context,
  ];
  if (kind === 'character-reference') {
    common.push(
      'For a CHARACTER MODEL SHEET: the same identity must stay consistent across all views; head/face, hair/headwear, costume construction, palette and body proportions must match. Full hands and feet must be visible. Turnaround views must be useful for later animation.',
      'Pass only at score >= 84.',
    );
  } else if (kind === 'character-pose') {
    common.push(
      'For a CHARACTER POSE CUTOUT: anatomy and gesture must feel intentionally drawn, pose must clearly communicate the requested action/expression, hands/feet must be plausible and fully visible, and the silhouette must remain recognizable at medium size.',
      'The character must look like a designed illustration, not a circle-head/rectangle-body mannequin.',
      'Pass only at score >= 86.',
    );
  } else if (kind === 'prop') {
    common.push(
      'For a PROP CUTOUT: silhouette, perspective, material cues and internal construction must be believable. Historical ships must not look like toy icons; wooden stakes must not look like plain brown polygons.',
      'Pass only at score >= 84.',
    );
  } else {
    common.push(
      'For a BACKGROUND PLATE: require clear foreground/midground/background depth, coherent perspective, designed environment shapes, staging space for animated subjects, and no baked-in hero characters/text.',
      'Pass only at score >= 82.',
    );
  }
  return common.join(' ');
}

async function reviewProfessionalAsset(
  asset: AnimationAsset,
  kind: ArtReviewKind,
  context: string,
  reviewer?: { provider: AIProvider; model: string },
): Promise<ArtReview> {
  if (!reviewer?.provider || !reviewer.model) {
    return { pass: true, score: 0, issues: ['Vision reviewer not configured.'], unavailable: true };
  }
  try {
    const file = await getAnimationAssetFile(asset.id);
    const raw = await recognizeImage(
      reviewer.provider,
      reviewer.model,
      file.path,
      artReviewPrompt(kind, context),
      AbortSignal.timeout(90_000),
    );
    const review = parseArtReview(raw);
    const threshold = kind === 'character-pose' ? 86 : kind === 'character-reference' || kind === 'prop' ? 84 : 82;
    return {
      ...review,
      pass: review.pass && review.score >= threshold,
      issues: review.issues.length ? review.issues : review.pass ? [] : ['Art direction score below production threshold.'],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pass: true, score: 0, issues: ['Vision reviewer unavailable: ' + message], unavailable: true };
  }
}

async function combineQcWithArtReview(
  asset: AnimationAsset,
  structural: Promise<QcResult> | QcResult,
  kind: ArtReviewKind,
  context: string,
  reviewer: { provider: AIProvider; model: string } | undefined,
  onUnavailable: (message: string) => void,
): Promise<QcResult> {
  const base = await structural;
  if (!base.ok) return base;
  const art = await reviewProfessionalAsset(asset, kind, context, reviewer);
  if (art.unavailable) {
    onUnavailable(art.issues[0] || 'Vision reviewer unavailable.');
    return base;
  }
  if (!art.pass) {
    return {
      ...base,
      ok: false,
      reason: 'art review ' + art.score + '/100: ' + (art.issues.join('; ') || 'below professional threshold'),
    };
  }
  return base;
}

const characterKey = (object: CanvasStudioObject) =>
  slug(object.characterKey || object.assetKey || object.label || object.id);

const poseKey = (object: CanvasStudioObject) =>
  [
    characterKey(object),
    object.pose || 'idle',
    object.expression || 'neutral',
    object.facing || 'right',
  ].join(':');

const propKey = (object: CanvasStudioObject) =>
  slug(object.assetKey || `${object.kind}-${object.variant || ''}-${object.label || ''}`);

function characterDescription(object: CanvasStudioObject) {
  return [
    `identity key ${characterKey(object)}`,
    `role/archetype: ${object.archetype || 'narrator'}`,
    `hair/headwear: ${object.hair || 'short'}`,
    `primary clothing color: ${object.color}`,
    `secondary clothing color: ${object.secondaryColor || '#64747a'}`,
    `outline/accent: ${object.accent}`,
    `skin tone: ${object.skinTone || '#e8bb94'}`,
    `visual label: ${object.label}`,
    object.designNotes ? `production design: ${object.designNotes}` : '',
  ].filter(Boolean).join('; ');
}

function backgroundKey(scene: CanvasStudioScene) {
  const shot = scene.camera?.shot || 'wide';
  const bucket = shot === 'close-up' || shot === 'extreme-close-up' ? 'close' : shot;
  const visualIdentity = slug(scene.visualBrief || scene.name || scene.background).slice(0, 42);
  return slug(`${scene.background}-${bucket}-${visualIdentity}`);
}

function backgroundPrompt(scene: CanvasStudioScene) {
  const shot = scene.camera?.shot || 'wide';
  const semantic = [scene.name, scene.narration].filter(Boolean).join('. ').slice(0, 500);
  return [
    CANVAS_PRO_STYLE_BIBLE,
    'ENVIRONMENT PLATE ONLY for compositing in a professional editorial animated explainer.',
    `Scene family: ${scene.background}. Camera framing: ${shot}.`,
    `Story context: ${semantic}`,
    scene.visualBrief ? `Art-direction brief: ${scene.visualBrief}` : '',
    'Draw a complete 16:9 environment with foreground, midground and background depth, purposeful composition and clear perspective.',
    'Do NOT draw any people, faces, labels, UI, text, ships or hero props that will need independent animation.',
    'Leave clean staging zones where animated characters/props can be composited later.',
    scene.background === 'river'
      ? 'A believable broad river environment with designed shore silhouettes, water perspective, atmospheric depth and subtle hand-drawn wave rhythm.'
      : '',
    scene.background === 'underwater'
      ? 'Underwater river cross-section atmosphere with depth gradient, suspended particles, riverbed perspective and soft light; no stakes unless explicitly part of the environment.'
      : '',
    scene.background === 'map'
      ? 'A hand-drawn tactical parchment/map environment with coastline/river geometry and empty zones for animated arrows and markers; no written labels.'
      : '',
  ].filter(Boolean).join(' ');
}

function modelSheetPrompt(request: CharacterRequest) {
  return [
    CANVAS_PRO_STYLE_BIBLE,
    'CHARACTER MODEL SHEET used as the immutable identity reference for later pose generation.',
    `Character: ${request.name}. ${request.design}`,
    'Show the SAME character in three clean views: front, 3/4 and side, plus four small facial expressions: neutral, happy, angry, surprised.',
    'Keep identical face proportions, hair/headwear, costume construction, palette and body proportions across all views.',
    'Professional animation turnaround sheet composition, full body visible, no cropped feet/hands.',
    'Plain warm off-white background. No text, no labels, no pose names.',
  ].join(' ');
}

function cutoutPrompt(object: CanvasStudioObject) {
  const action = object.pose || 'idle';
  const expression = object.expression || 'neutral';
  const facing = object.facing || 'right';
  return [
    CANVAS_PRO_STYLE_BIBLE,
    'SINGLE CHARACTER CUTOUT for 2D animation compositing.',
    `Use the provided character reference as a STRICT identity lock. Same face, hair/headwear, costume, palette and body proportions.`,
    `Pose/action: ${action}. Expression: ${expression}. Facing: ${facing}.`,
    `Character design contract: ${characterDescription(object)}.`,
    'Create one full-body character only, dynamic readable silhouette, professional pose drawing with believable balance and gesture.',
    'All hands, feet and accessories fully inside frame. No duplicate limbs. No extra person. No shadow touching the matte.',
    'BACKGROUND MUST BE one perfectly flat solid chroma magenta #FF00FF from edge to edge, with absolutely no gradient, texture, vignette or cast shadow.',
    'Do not use magenta anywhere on the character.',
    'No text, no labels, no border.',
  ].join(' ');
}

function propPrompt(request: PropRequest) {
  const object = request.object;
  const motionHint = object.motion && object.motion !== 'none' ? `It must read clearly while animated with motion "${object.motion}".` : '';
  return [
    CANVAS_PRO_STYLE_BIBLE,
    'SINGLE OBJECT CUTOUT for 2D animation compositing.',
    `Object: ${request.label}. Kind: ${object.kind}. Variant: ${object.variant || 'default'}.`,
    `Primary color ${object.color}; secondary ${object.secondaryColor || '#8f775d'}; outline ${object.accent}.`,
    object.designNotes ? `Production design: ${object.designNotes}` : '',
    motionHint,
    'Draw one production-quality object with convincing perspective, designed silhouette, material cues and enough internal detail to survive a medium or close shot.',
    object.kind === 'ship'
      ? 'For a historical ship: coherent hull construction, deck, mast/sail/rigging cues and perspective. Avoid toy-boat or icon geometry.'
      : '',
    object.kind === 'stake'
      ? 'For a wooden stake: irregular natural timber taper, visible cut/wood grain cues, believable perspective and non-uniform edges. Avoid a simple brown polygon.'
      : '',
    'Object fully inside frame with breathing room.',
    'BACKGROUND MUST BE one perfectly flat solid chroma magenta #FF00FF edge to edge. No gradient, texture or shadow. Do not use magenta on the object.',
    'No people, no text, no watermark, no border.',
  ].filter(Boolean).join(' ');
}


function sheetLayout(count: number) {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 1, rows: 2 };
  return { columns: 2, rows: 2 };
}

function propSheetPrompt(requests: PropRequest[]) {
  const { columns, rows } = sheetLayout(requests.length);
  const order = requests.map((request, index) => {
    const row = Math.floor(index / columns) + 1;
    const column = columns === 1 ? 'full-width' : index % columns === 0 ? 'left' : 'right';
    return `cell row ${row} ${column}: ${request.label}; kind=${request.object.kind}; variant=${request.object.variant || 'default'}; primary=${request.object.color}; secondary=${request.object.secondaryColor || '#8f775d'}; outline=${request.object.accent}`;
  }).join(' | ');
  return [
    CANVAS_PRO_STYLE_BIBLE,
    `PROFESSIONAL PROP CONTACT SHEET. EXACTLY ${columns} columns x ${rows} rows, equal-sized cells, reading left-to-right then top-to-bottom.`,
    `Required cell order: ${order}.`,
    'Every cell contains exactly ONE object, centered, fully visible, generous breathing room, with no overlap into neighboring cells.',
    'All cells use the SAME perfectly flat chroma magenta #FF00FF background edge-to-edge. No gutters, captions, labels, numbers, text, shadows or decorative marks.',
    'Keep one consistent illustration style, contour language, texture density and perspective treatment across the whole sheet.',
    'Ships must look like designed historical vessels with coherent hull/deck/mast/sail/rigging perspective, never toy icons.',
    'Wooden stakes must have irregular timber taper, cut wood/grain cues and believable perspective, never plain brown polygons.',
    'Do not include people unless an object intrinsically requires a tiny non-identifying scale silhouette; prefer no people.',
    'Do not use magenta on any object.',
  ].join(' ');
}

async function deriveGridAsset(
  sheet: AnimationAsset,
  request: PropRequest,
  index: number,
  count: number,
): Promise<AnimationAsset> {
  const source = await getAnimationAssetFile(sheet.id);
  const metadata = await sharp(source.path).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Prop sheet không đọc được kích thước.');

  const { columns, rows } = sheetLayout(count);
  const cellWidth = Math.floor(metadata.width / columns);
  const cellHeight = Math.floor(metadata.height / rows);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = column * cellWidth;
  const top = row * cellHeight;
  const width = column === columns - 1 ? metadata.width - left : cellWidth;
  const height = row === rows - 1 ? metadata.height - top : cellHeight;

  const id = randomUUID();
  const directory = path.join(workdir, 'animation-assets', 'files');
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${id}.png`);
  await sharp(source.path)
    .extract({ left, top, width, height })
    .png({ compressionLevel: 9 })
    .toFile(target);

  const cacheKey = createHash('sha256')
    .update(`canvas-pro-grid:v1:${sheet.cacheKey || sheet.id}:${request.key}:${index}`)
    .digest('hex');

  return registerAnimationAsset({
    id,
    name: `Canvas Prop · ${request.label}`,
    type: 'object',
    uri: `/api/animation-studio/assets/${id}/file`,
    tags: ['canvas-pro', 'prop', request.key, 'derived-prop-sheet'],
    status: 'candidate',
    cacheKey,
    style: CANVAS_PRO_STYLE_BIBLE_ID,
    createdAt: new Date().toISOString(),
    source: 'generated',
    generationPrompt: sheet.generationPrompt,
  });
}

async function generatePropSheetBatch(
  requests: PropRequest[],
  base: Pick<AnimationAssetGenerationInput, 'provider' | 'model' | 'generator'>,
  config: CanvasAssetGenerationConfig,
  runtime: AssetProviderRuntime,
) {
  if (!requests.length) return new Map<string, AnimationAsset>();
  const sheetResult = await generateWithQc({
    ...base,
    prompt: propSheetPrompt(requests),
    name: `Canvas Prop Sheet · ${requests.map((request) => request.key).join(' + ').slice(0, 90)}`,
    type: 'image',
    tags: ['canvas-pro', 'prop-sheet', ...requests.map((request) => request.key)],
    style: CANVAS_PRO_STYLE_BIBLE_ID,
    width: 1024,
    height: requests.length <= 2 ? 1024 : 1536,
  }, async (asset) => {
    const file = await getAnimationAssetFile(asset.id);
    const metadata = await sharp(file.path).metadata();
    return {
      ok: Boolean(metadata.width && metadata.height && metadata.width >= 768 && metadata.height >= 768),
      reason: 'prop sheet resolution too small',
    };
  }, 3, config.fallback, runtime);

  const mapped = new Map<string, AnimationAsset>();
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index]!;
    const candidate = await deriveGridAsset(sheetResult.asset, request, index, requests.length);
    const result = await prepareCutout(candidate);
    if (!result.ok) {
      await reject(candidate);
      continue;
    }
    mapped.set(request.key, await approve(candidate));
  }
  return mapped;
}

async function validateBackground(asset: AnimationAsset, width: number, height: number): Promise<QcResult> {
  const file = await getAnimationAssetFile(asset.id);
  const image = sharp(file.path, { limitInputPixels: 50_000_000 }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width < 640 || metadata.height < 360) {
    return { ok: false, reason: 'background resolution too small' };
  }
  const stats = await image.stats();
  const variance = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0) / 3;
  if (variance < 8) return { ok: false, reason: 'background appears nearly blank/flat' };
  const normalized = await image.resize(width, height, { fit: 'cover', position: 'centre' }).png({ compressionLevel: 9 }).toBuffer();
  await sharp(normalized).toFile(file.path);
  return { ok: true };
}

const isMagenta = (r: number, g: number, b: number) =>
  r > 180 && b > 180 && g < 125 && Math.min(r, b) - g > 80;

async function prepareCutout(asset: AnimationAsset): Promise<QcResult> {
  const file = await getAnimationAssetFile(asset.id);
  const source = sharp(file.path, { limitInputPixels: 40_000_000 }).rotate().ensureAlpha();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let border = 0;
  let borderMatte = 0;
  let visible = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * 4;
      const r = data[i] || 0;
      const g = data[i + 1] || 0;
      const b = data[i + 2] || 0;
      const edge = x < 8 || y < 8 || x >= info.width - 8 || y >= info.height - 8;
      const matte = isMagenta(r, g, b);
      if (edge) {
        border += 1;
        if (matte) borderMatte += 1;
      }

      if (matte) {
        data[i + 3] = 0;
      } else {
        const near = Math.max(0, Math.min(1, (Math.min(r, b) - g - 25) / 80));
        if (r > 135 && b > 135 && near > 0) data[i + 3] = Math.round((data[i + 3] || 255) * (1 - near));
        if ((data[i + 3] || 0) > 28) {
          visible += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
  }

  const borderMatteRatio = border ? borderMatte / border : 0;
  const occupancy = pixels ? visible / pixels : 0;
  if (borderMatteRatio < .88) return { ok: false, reason: 'matte background is not clean enough', borderMatteRatio, occupancy };
  if (occupancy < .035) return { ok: false, reason: 'subject is too small/empty', borderMatteRatio, occupancy };
  if (occupancy > .78) return { ok: false, reason: 'subject is cropped or fills too much of frame', borderMatteRatio, occupancy };
  if (maxX < minX || maxY < minY) return { ok: false, reason: 'no visible subject', borderMatteRatio, occupancy };

  const padding = Math.max(24, Math.round(Math.max(maxX - minX, maxY - minY) * .08));
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(info.width - 1, maxX + padding);
  const bottom = Math.min(info.height - 1, maxY + padding);
  const transparent = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(transparent).toFile(file.path);
  return { ok: true, borderMatteRatio, occupancy };
}

async function approve(asset: AnimationAsset) {
  return updateAnimationAsset(asset.id, { status: 'approved' });
}

async function reject(asset: AnimationAsset) {
  await updateAnimationAsset(asset.id, { status: 'rejected' }).catch(() => undefined);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function generationErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String((error as { code?: unknown }).code || '');
}

function retryableGenerationError(error: unknown) {
  const code = generationErrorCode(error);
  if ([
    'FLOW_REQUEST_CONTEXT_MISSING',
    'FLOW_NO_AUTHENTICATED_WORKERS',
    'FLOW_EXTENSION_NOT_CONNECTED',
    'NO_FLOW_KEY',
    'FLOW_SESSION_REFRESH_FAILED',
    'FLOW_LOCAL_WORKER_UNAVAILABLE',
    'FLOW_IMAGE_TRAFFIC_THROTTLED',
    'FLOW_IMAGE_RECAPTCHA_BLOCKED',
  ].includes(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|too.?many|flow agent.*not|extension.*not|too_much_traffic|traffic/i.test(message);
}

function shouldDisablePrimaryForJob(error: unknown) {
  const code = generationErrorCode(error);
  if ([
    'FLOW_REQUEST_CONTEXT_MISSING',
    'FLOW_NO_AUTHENTICATED_WORKERS',
    'FLOW_EXTENSION_NOT_CONNECTED',
    'NO_FLOW_KEY',
    'FLOW_SESSION_REFRESH_FAILED',
    'FLOW_LOCAL_WORKER_UNAVAILABLE',
  ].includes(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /FLOW_REQUEST_CONTEXT_MISSING|FLOW_NO_AUTHENTICATED_WORKERS|không có worker Flow nào có Flow key/i.test(message);
}

type AssetProviderRuntime = {
  skipPrimary: boolean;
  /** Serialize fallback image calls so a whole asset pack cannot burst a web-image provider. */
  lastFallbackStartedAt: number;
};

function retryDelayMs(error: unknown, attempt: number) {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|rate.?limit|too.?many/i.test(message)) return 12_000 * (attempt + 1);
  return 2_500 * (attempt + 1);
}

async function generateFallbackAsset(input: AnimationAssetGenerationInput, runtime?: AssetProviderRuntime) {
  if (runtime) {
    const minimumGapMs = 8_000;
    const elapsed = Date.now() - runtime.lastFallbackStartedAt;
    if (elapsed < minimumGapMs) await sleep(minimumGapMs - elapsed);
    runtime.lastFallbackStartedAt = Date.now();
  }
  return generateAnimationAsset(input);
}

async function generateWithQc(
  base: AnimationAssetGenerationInput,
  qc: (asset: AnimationAsset) => Promise<QcResult>,
  attempts = 3,
  fallback?: { provider: AIProvider; model: string },
  runtime?: AssetProviderRuntime,
) {
  let lastReason = 'quality check failed';
  let reused = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const prompt = attempt === 0
      ? base.prompt
      : `${base.prompt} QUALITY RETRY ${attempt + 1}: previous output failed production QC or provider delivery (${lastReason}). Follow every framing/matte/anatomy constraint exactly.`;
    const tagged = {
      ...base,
      prompt,
      tags: [...(base.tags || []), `pro-qc-attempt-${attempt + 1}`],
    } satisfies AnimationAssetGenerationInput;

    let asset: AnimationAsset;
    const fallbackInput = fallback ? {
      ...tagged,
      generator: undefined,
      provider: fallback.provider,
      model: fallback.model,
      prompt: `${prompt} PROVIDER FAILOVER: preserve the exact same art-direction and production constraints.`,
      tags: [...(tagged.tags || []), 'provider-failover'],
    } satisfies AnimationAssetGenerationInput : undefined;
    const startedOnFallback = Boolean(runtime?.skipPrimary && fallbackInput);
    try {
      asset = startedOnFallback
        ? await generateFallbackAsset(fallbackInput!, runtime)
        : await generateAnimationAsset(tagged);
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
      if (runtime && shouldDisablePrimaryForJob(error)) runtime.skipPrimary = true;

      // If this attempt already started on the fallback provider, never hammer
      // the same provider again immediately. Back off into the next attempt.
      if (startedOnFallback) {
        if (attempt < attempts - 1 && retryableGenerationError(error)) {
          await sleep(retryDelayMs(error, attempt));
          continue;
        }
        throw error;
      }

      if (fallbackInput && retryableGenerationError(error)) {
        try {
          asset = await generateFallbackAsset(fallbackInput, runtime);
        } catch (fallbackError) {
          lastReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          if (attempt < attempts - 1 && retryableGenerationError(fallbackError)) {
            await sleep(retryDelayMs(fallbackError, attempt));
            continue;
          }
          throw fallbackError;
        }
      } else if (attempt < attempts - 1 && retryableGenerationError(error)) {
        await sleep(retryDelayMs(error, attempt));
        continue;
      } else {
        throw error;
      }
    }

    reused = reused || Boolean(asset.status === 'approved');
    const result = await qc(asset);
    if (result.ok) return { asset: await approve(asset), reused, qc: result };
    lastReason = result.reason || lastReason;
    await reject(asset);
    if (attempt < attempts - 1) await sleep(600);
  }
  throw new Error(`Asset "${base.name || 'unnamed'}" không đạt QC: ${lastReason}`);
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function generationBase(config: CanvasAssetGenerationConfig): Pick<AnimationAssetGenerationInput, 'provider' | 'model' | 'generator'> {
  return {
    ...(config.provider ? { provider: config.provider } : {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.generator ? { generator: config.generator } : {}),
  };
}

function collectCharacterRequests(project: CanvasStudioProject): CharacterRequest[] {
  const objects = project.scenes.flatMap((scene) => scene.objects.filter((object) => object.kind === 'character'));
  return unique(objects, characterKey).slice(0, 6).map((object) => ({
    key: characterKey(object),
    name: object.label || characterKey(object),
    design: characterDescription(object),
    objects: objects.filter((candidate) => characterKey(candidate) === characterKey(object)),
  }));
}

function collectBackgroundRequests(project: CanvasStudioProject): BackgroundRequest[] {
  const groups = new Map<string, CanvasStudioScene[]>();
  for (const scene of project.scenes) {
    const key = backgroundKey(scene);
    const current = groups.get(key) || [];
    current.push(scene);
    groups.set(key, current);
  }
  return [...groups.entries()].slice(0, 20).map(([key, scenes]) => ({ key, scenes, scene: scenes[0]! }));
}

function collectPropRequests(project: CanvasStudioProject): PropRequest[] {
  const candidates = project.scenes.flatMap((scene) => scene.objects)
    .filter((object) => ['ship', 'stake', 'prop'].includes(object.kind));
  return unique(candidates, propKey).slice(0, 16).map((object) => ({
    key: propKey(object),
    label: object.label || object.variant || object.kind,
    object,
  }));
}

export async function professionalizeCanvasProject(
  project: CanvasStudioProject,
  brief: string,
  config: CanvasAssetGenerationConfig | undefined,
): Promise<CanvasStudioProject> {
  if (!config?.enabled) return project;
  if (!config.generator && (!config.provider || !config.model)) throw new Error('Professional asset pipeline chưa có provider tạo ảnh.');

  const base = generationBase(config);
  const providerRuntime: AssetProviderRuntime = { skipPrimary: false, lastFallbackStartedAt: 0 };
  const warnings: string[] = [];
  const reviewWarnings = new Set<string>();
  const noteReviewUnavailable = (message: string) => {
    if (reviewWarnings.size < 4) reviewWarnings.add(message);
  };
  let generated = 0;
  let approvedCount = 0;
  let rejected = 0;
  let reused = 0;

  const backgroundRequests = collectBackgroundRequests(project);
  const backgroundResults = await mapLimit(backgroundRequests, config.generator === 'flow-agent' && !config.fallback ? 4 : 1, async (request) => {
    try {
      const result = await generateWithQc({
        ...base,
        prompt: backgroundPrompt(request.scene),
        name: `Canvas BG · ${request.key}`,
        type: 'background',
        tags: ['canvas-pro', 'background', request.key],
        style: CANVAS_PRO_STYLE_BIBLE_ID,
        width: project.width,
        height: project.height,
      }, (asset) => combineQcWithArtReview(
        asset,
        validateBackground(asset, project.width, project.height),
        'background',
        request.scene.name + '. ' + (request.scene.narration || ''),
        config.reviewer,
        noteReviewUnavailable,
      ), 3, config.fallback, providerRuntime);
      generated += 1;
      approvedCount += 1;
      if (result.reused) reused += 1;
      return [request.key, result.asset] as const;
    } catch (error) {
      rejected += 1;
      warnings.push(error instanceof Error ? error.message : String(error));
      return [request.key, undefined] as const;
    }
  });
  const backgrounds = new Map(backgroundResults);

  const characters = collectCharacterRequests(project);
  const characterReferences = new Map<string, AnimationAsset>();
  for (const request of characters) {
    try {
      const result = await generateWithQc({
        ...base,
        prompt: modelSheetPrompt(request),
        name: `Character Reference · ${request.name}`,
        type: 'character',
        tags: ['canvas-pro', 'character-reference', request.key],
        style: CANVAS_PRO_STYLE_BIBLE_ID,
        width: 1024,
        height: 1024,
      }, async (asset) => {
        const file = await getAnimationAssetFile(asset.id);
        const meta = await sharp(file.path).metadata();
        return combineQcWithArtReview(
          asset,
          { ok: Boolean(meta.width && meta.height && meta.width >= 768 && meta.height >= 768), reason: 'character reference resolution too small' },
          'character-reference',
          request.name + '. ' + request.design,
          config.reviewer,
          noteReviewUnavailable,
        );
      }, 3, config.fallback, providerRuntime);
      characterReferences.set(request.key, result.asset);
      generated += 1;
      approvedCount += 1;
      if (result.reused) reused += 1;
    } catch (error) {
      rejected += 1;
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  const poseObjects = unique(
    project.scenes.flatMap((scene) => scene.objects.filter((object) => object.kind === 'character')),
    poseKey,
  ).slice(0, 24);
  const poseResults = await mapLimit(poseObjects, providerRuntime.skipPrimary ? 1 : config.generator === 'flow-agent' ? 3 : 1, async (object) => {
    const ref = characterReferences.get(characterKey(object));
    if (!ref) return [poseKey(object), undefined] as const;
    try {
      const result = await generateWithQc({
        ...base,
        prompt: cutoutPrompt(object),
        name: `Character Pose · ${object.label} · ${object.pose || 'idle'}`,
        type: 'character',
        tags: ['canvas-pro', 'character-pose', characterKey(object), object.pose || 'idle'],
        style: CANVAS_PRO_STYLE_BIBLE_ID,
        width: 1024,
        height: 1024,
        referenceAssetId: ref.id,
      }, (asset) => combineQcWithArtReview(
        asset,
        prepareCutout(asset),
        'character-pose',
        object.label + '; pose=' + (object.pose || 'idle') + '; expression=' + (object.expression || 'neutral') + '; facing=' + (object.facing || 'right'),
        config.reviewer,
        noteReviewUnavailable,
      ), 3, config.fallback, providerRuntime);
      generated += 1;
      approvedCount += 1;
      if (result.reused) reused += 1;
      return [poseKey(object), result.asset] as const;
    } catch (error) {
      rejected += 1;
      warnings.push(error instanceof Error ? error.message : String(error));
      return [poseKey(object), undefined] as const;
    }
  });
  const poses = new Map(poseResults);

  const propRequests = collectPropRequests(project);
  const props = new Map<string, AnimationAsset>();
  const propResults = await mapLimit(
    propRequests,
    providerRuntime.skipPrimary ? 1 : config.generator === 'flow-agent' ? 3 : 1,
    async (request) => {
      try {
        const result = await generateWithQc({
          ...base,
          prompt: propPrompt(request),
          name: `Canvas Prop · ${request.label}`,
          type: 'object',
          tags: ['canvas-pro', 'prop', request.key, 'individual-professional'],
          style: CANVAS_PRO_STYLE_BIBLE_ID,
          width: 1024,
          height: 1024,
        }, (asset) => combineQcWithArtReview(
          asset,
          prepareCutout(asset),
          'prop',
          request.label + '; kind=' + request.object.kind + '; variant=' + (request.object.variant || 'default'),
          config.reviewer,
          noteReviewUnavailable,
        ), 3, config.fallback, providerRuntime);
        generated += 1;
        approvedCount += 1;
        if (result.reused) reused += 1;
        return [request.key, result.asset] as const;
      } catch (error) {
        rejected += 1;
        warnings.push(error instanceof Error ? error.message : String(error));
        return [request.key, undefined] as const;
      }
    },
  );
  for (const [key, asset] of propResults) if (asset) props.set(key, asset);

  const missing: string[] = [];
  for (const request of backgroundRequests) if (!backgrounds.get(request.key)) missing.push(`background:${request.key}`);
  for (const request of characters) if (!characterReferences.get(request.key)) missing.push(`character-reference:${request.key}`);
  for (const object of poseObjects) if (!poses.get(poseKey(object))) missing.push(`character-pose:${poseKey(object)}`);
  for (const request of propRequests) if (!props.get(request.key)) missing.push(`prop:${request.key}`);
  if (missing.length) {
    const detail = warnings.slice(-8).join(' | ');
    throw new Error(`Professional asset pipeline dừng vì ${missing.length} asset chưa đạt QC: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}. Không fallback về primitive.${detail ? ` Chi tiết: ${detail}` : ''}`);
  }

  const scenes = project.scenes.map((scene) => {
    const background = backgrounds.get(backgroundKey(scene));
    const objects = scene.objects.map((object) => {
      const asset = object.kind === 'character'
        ? poses.get(poseKey(object))
        : ['ship', 'stake', 'prop'].includes(object.kind)
          ? props.get(propKey(object))
          : undefined;
      if (!asset) return object;
      return {
        ...object,
        assetId: asset.id,
        assetKey: object.kind === 'character' ? poseKey(object) : propKey(object),
        imageUrl: asset.uri,
      };
    });
    return {
      ...scene,
      ...(background ? { backgroundAssetId: background.id, backgroundImageUrl: background.uri } : {}),
      objects,
    };
  });

  const requiredIllustratedObjects = scenes.flatMap((scene) =>
    scene.objects.filter((object) => ['character', 'ship', 'stake', 'prop'].includes(object.kind)),
  );
  const unattached = requiredIllustratedObjects.filter((object) => !object.assetId || !object.imageUrl);
  const scenesWithoutBackground = scenes.filter((scene) => !scene.backgroundAssetId || !scene.backgroundImageUrl);
  if (unattached.length || scenesWithoutBackground.length) {
    const objectList = unattached.slice(0, 8).map((object) => object.kind + ':' + (object.label || object.assetKey || object.id));
    const sceneList = scenesWithoutBackground.slice(0, 4).map((scene) => 'background:' + scene.name);
    throw new Error(
      'Professional asset postcondition failed: ' + [...objectList, ...sceneList].join(', ') + '. ' +
      'Video bị chặn để không fallback về primitive Canvas.',
    );
  }

  return {
    ...project,
    updatedAt: new Date().toISOString(),
    assetPipeline: {
      version: 1,
      styleBible: CANVAS_PRO_STYLE_BIBLE_ID,
      generated,
      approved: approvedCount,
      rejected,
      reused,
      required: requiredIllustratedObjects.length + scenes.length,
      attached: requiredIllustratedObjects.length + scenes.length,
      warnings: [...warnings, ...reviewWarnings].slice(0, 24),
    },
    scenes,
  };
}
