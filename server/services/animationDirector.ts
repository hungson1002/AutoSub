import { normalizeSpriteRequests } from './animationSpriteGeneration';
import { buildAnimatedObjects, normalizeAnimatedObjects, type AnimatedObject } from './animationObjects';
import { randomUUID } from 'node:crypto';
import type { AnimationAsset, AnimationCommand, AnimationProject, AnimationScene, CompositeScene, SceneLayer } from '../../shared/animationStudio';
import { defaultTransform, validateAnimationProject } from '../../shared/animationStudio';
import { chat } from '../adapters';
import type { AIProvider } from '../types';
import { deleteAnimationAssets, generateAnimationAsset, generateAnimationNarration, generateFlowAnimationAssetBatch, listAnimationAssets, resolveAnimationGenerationReferencePath } from './animationAssets';
import { saveAnimationProject } from './animationProjects';
import { FlowSessionError, getGoogleFlowImagePoolCapacity, prewarmGoogleFlowImageReference, validateGoogleFlowSession } from './googleFlow';
import { animationCraftRules } from './directorKnowledge';
import { checkAnimationQuality } from './animationQuality';
import { buildAnimationBeatWindows } from './animationTiming';
import { compileAnimationProductionPlan } from './animationPlan';
import { withAnimationAssetManifest } from './animationManifest';
import { animationCheckpointKey, loadAnimationCheckpoint, saveAnimationCheckpoint, runAnimationOnce } from './animationCheckpoint';
import { selectThumbnailConcepts, thumbnailPackagingRules, type ThumbnailConceptCandidate } from './thumbnailStrategy';

export type DirectorAssetGeneration = { provider?: AIProvider; model?: string; generator?: 'flow-agent'; referenceUploadId?: string; referenceAssetId?: string };

export interface DirectAnimationInput {
  brief: string;
  project: AnimationProject;
  provider: AIProvider;
  model: string;
  assetGeneration?: DirectorAssetGeneration;
  targetDurationSeconds?: number;
  narration?: { provider: AIProvider; model: string; voice: string; speed?: number };
}

type VisualBeatMotion = 'push' | 'pull' | 'pan-left' | 'pan-right' | 'drift-up' | 'drift-down' | 'locked';
type VisualBeatTransition = 'cut' | 'match-cut' | 'crossfade';
type BeatActor = { assetId: string; animation: string; fromX: number; toX: number; y: number };
type BeatDiagram = { steps: string[]; layout?: 'process' | 'comparison' };
type DirectorVisualBeat = { narrationCue?: string; action?: string; purpose?: string; visual?: string; motion?: VisualBeatMotion; transition?: VisualBeatTransition; objects?: AnimatedObject[]; actors?: BeatActor[]; diagram?: BeatDiagram };
type DirectorSegment = { title?: string; narration?: string; visual?: string; visualDetail?: string; visualBeats?: DirectorVisualBeat[]; motionGraphic?: 'particle' | 'path' | 'focus' | 'none' };
type DirectorReply = { spriteRequests?: unknown; characterRequests?: Array<{ key: string; name: string; kind: 'stick' | 'robot'; color?: string }>; characterOptions?: Array<{ name?: string; prompt?: string }>; thumbnailOptions?: ThumbnailConceptCandidate[]; name?: string; continuityBible?: string; scenes?: AnimationScene[]; segments?: DirectorSegment[]; assetRequests?: Array<{ key: string; name: string; prompt: string; type?: 'image' | 'background' | 'object' | 'icon' | 'character'; tags?: string[]; style?: string }> };

export type LongAnimationSegment = {
  title: string;
  narration: string;
  visualBeats: Array<{ narrationCue?: string; action?: string; purpose: string; visual: string; motion: VisualBeatMotion; transition: VisualBeatTransition; objects?: AnimatedObject[]; actors?: BeatActor[]; diagram?: BeatDiagram }>;
  motionGraphic: 'particle' | 'path' | 'focus' | 'none';
};

type DirectorAssetRequest = NonNullable<DirectorReply['assetRequests']>[number];

const narrationWordCount = (segments: Array<{ narration?: string }>) => segments.reduce((total, segment) => total + String(segment.narration || '').trim().split(/\s+/u).filter(Boolean).length, 0);

export function characterReferenceDirective(hasReference: boolean) {
  return hasReference
    ? 'CHARACTER REFERENCE HAS HIGHEST PRIORITY: the attached reference image is the single source of truth for every recurring character appearance. Copy the same head shape, facial language, body proportions, clothing silhouette, clothing details, accessories, line weight and accent colors exactly. The reference may be a model sheet with multiple poses; treat those as the SAME character, not alternate designs. Ignore any conflicting appearance words in the storyboard, style preset or continuityBible. Only the pose, action, camera angle and expression may change. Never redesign the character, swap hoodie/shirt/jacket, enlarge the head or eyes into chibi/anime proportions, add/remove hair or accessories, or change rendering style. If the recurring character is not needed in a shot, do not insert them.'
    : 'No external character reference is attached. Recurring characters must still keep one stable design, proportions, clothing and rendering language across the whole video.';
}

export type VisualTextLanguage = 'Vietnamese' | 'English';

export function visualTextLanguage(value: string): VisualTextLanguage {
  const text = ` ${String(value || '').toLocaleLowerCase('vi').normalize('NFC')} `;
  const vietnameseMarks = (text.match(/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu) || []).length;
  const vietnameseWords = (text.match(/\b(?:và|là|của|cho|với|không|một|những|tại|sao|khi|bạn|giá|tiền|mua|video|giải thích)\b/giu) || []).length;
  const englishWords = (text.match(/\b(?:the|and|is|are|for|with|not|why|when|you|your|price|money|buy|video|explain)\b/giu) || []).length;
  return vietnameseMarks >= 2 || vietnameseWords > englishWords ? 'Vietnamese' : 'English';
}

export function visualTextDirective(language: VisualTextLanguage = 'English') {
  const languageRule = language === 'Vietnamese'
    ? 'The video language is VIETNAMESE. Every intentional word or phrase rendered inside an image MUST be Vietnamese. Translate generic English labels such as SALE, FREE, DEAL, BUY or SAVE into natural Vietnamese. Numbers, currency symbols, percentages, arrows, product/brand proper nouns and standard units may remain as symbols/names.'
    : 'The video language is ENGLISH. Every intentional word or phrase rendered inside an image MUST be English. Do not insert Vietnamese labels. Numbers, currency symbols, percentages, arrows, product/brand proper nouns and standard units may remain as symbols/names.';
  return `REFERENCE-LIKE TEXT POLICY: normal storyboard images are visual-first. Across the whole video, AT MOST 20% of visual beats may contain intentional on-image text; roughly four text-bearing shots in a 23-shot minute is enough. Avoid text in adjacent shots. Default to ZERO text whenever the picture can communicate the idea. Text is only a semantic accent, like the reference videos: one keyword/label, one number/percentage/price, or one compact comparison such as 100 → 50. Use at most ONE prominent text element in the composition. HARD LIMIT FOR EVERY TEXT-BEARING SHOT: render only ONE text block, maximum 4 whitespace-separated words and maximum 24 visible characters total, unless the content is purely a short numeric expression. Never render a complete sentence. Never render narration, storyboard instructions, scene titles, explanatory clauses, quoted spoken lines or prompt wording as text in the image. If the only available wording is longer than this limit, OMIT TEXT ENTIRELY and communicate the idea visually. The permitted text must be large enough to read instantly. Never make text carry the explanation. Do not create a title plus secondary labels, multi-line headings, paragraphs, subtitles, detailed receipts, shopping lists, tables, menus full of words, fake app/UI screens, decorative filler text, or tiny unreadable writing. If the image works without words, use no words. ${languageRule}`;
}

export function chooseStoryboardTextBeatIndexes(beats: Array<{ visual?: string; narrationCue?: string }>, ratio = .2) {
  const limit = Math.max(0, Math.floor(beats.length * Math.max(0, Math.min(.2, ratio))));
  if (!limit) return new Set<number>();
  const scored = beats.map((beat, index) => {
    const text = `${String(beat.visual || '')} ${String(beat.narrationCue || '')}`.toLocaleLowerCase('vi');
    let score = 0;
    if (/[₫$€£¥%]|→/.test(text)) score += 5;
    if (/\b(?:sale|free|deal|price|discount|label|sign|text|number|percentage|giảm giá|miễn phí|tặng|giá|nhãn|biển|phần trăm)\b/iu.test(text)) score += 4;
    if (/\b\d+(?:[.,]\d+)?\b/u.test(text)) score += 2;
    return { index, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen: number[] = [];
  for (const candidate of scored) {
    if (chosen.length >= limit) break;
    if (chosen.some((index) => Math.abs(index - candidate.index) <= 1)) continue;
    chosen.push(candidate.index);
  }
  return new Set(chosen);
}

export function allocateLockedSceneDurations(measuredNarrationMs: number[], targetDurationMs: number) {
  const target = Math.max(1, Math.round(targetDurationMs));
  if (!measuredNarrationMs.length) return [];
  const measured = measuredNarrationMs.map((value) => Math.max(1, Math.round(Number(value) || 1)));
  const spokenTotal = measured.reduce((sum, value) => sum + value, 0);
  if (spokenTotal > target) throw new Error(`Lời đọc dài hơn timeline đã khóa ${spokenTotal - target}ms.`);
  const slack = target - spokenTotal;
  let allocated = 0;
  return measured.map((value, index) => {
    if (index === measured.length - 1) return Math.max(1, target - allocated);
    const share = spokenTotal > 0 ? Math.round(slack * value / spokenTotal) : Math.round(slack / measured.length);
    const duration = Math.max(value, value + share);
    allocated += duration;
    return duration;
  });
}

export function narrationFitWordTargets(segments: Array<{ narration?: string }>, measuredNarrationMs: number[], targetNarrationMs: number[]) {
  return segments.map((segment, index) => {
    const currentWords = Math.max(4, narrationWordCount([segment]));
    const measured = Math.max(500, Number(measuredNarrationMs[index]) || 500);
    const target = Math.max(500, Number(targetNarrationMs[index]) || measured);
    const ratio = Math.max(.45, Math.min(2.8, target / measured));
    return Math.max(6, Math.round(currentWords * ratio));
  });
}

/** Infer an explicit duration written in the brief when the UI is left on auto. */
export function durationSecondsFromBrief(value: string) {
  const text = String(value || '').toLocaleLowerCase('vi').replace(/,/g, '.');
  const unitSeconds = (unit: string) => /phút|minute|min\b/i.test(unit) ? 60 : 1;
  const range = /(\d+(?:\.\d+)?)\s*(?:-|–|—|đến|to)\s*(\d+(?:\.\d+)?)\s*(giây|seconds?|secs?|phút|minutes?|mins?)\b/iu.exec(text);
  if (range) {
    const low = Number(range[1]); const high = Number(range[2]);
    if (Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > 0) return Math.round((low + high) / 2 * unitSeconds(range[3]));
  }
  const single = /(\d+(?:\.\d+)?)\s*(giây|seconds?|secs?|phút|minutes?|mins?)\b/iu.exec(text);
  if (single) {
    const amount = Number(single[1]);
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount * unitSeconds(single[2]));
  }
  return undefined;
}

export function buildVisualDensityPlan(durationSeconds: number) {
  const duration = Math.max(1, Math.round(durationSeconds));
  const openingSeconds = Math.min(15, duration);
  const openingVisualCount = Math.max(1, Math.round(openingSeconds / 2.25));
  const mainSeconds = Math.max(0, duration - openingSeconds);
  const mainVisualCount = mainSeconds ? Math.max(1, Math.round(mainSeconds / 2.9)) : 0;
  const visualDurationsSeconds = [
    ...Array.from({ length: openingVisualCount }, () => openingSeconds / openingVisualCount),
    ...Array.from({ length: mainVisualCount }, () => mainSeconds / mainVisualCount),
  ];
  const visualCount = visualDurationsSeconds.length;
  // A narration scene is only a timing/container boundary. The reference style
  // changes the actual composition every ~2-3 seconds, so every visual beat must
  // remain eligible for its own generated image. Group a few beats into one scene
  // to avoid fragmenting narration/TTS into hundreds of tiny clips.
  const beatsPerScene = 3;
  const sceneCount = Math.ceil(visualCount / beatsPerScene);
  const visualsPerScene = Array.from({ length: sceneCount }, (_, index) => Math.min(beatsPerScene, visualCount - index * beatsPerScene));
  let cursor = 0;
  const sceneDurationsSeconds = visualsPerScene.map((count) => {
    const value = visualDurationsSeconds.slice(cursor, cursor + count).reduce((sum, seconds) => sum + seconds, 0);
    cursor += count;
    return value;
  });
  return { sceneCount, visualCount, openingVisualCount, visualsPerScene, visualDurationsSeconds, sceneDurationsSeconds };
}

export function animationPerformancePlanIssues(segments: LongAnimationSegment[]) {
  const issues: string[] = [];
  let movingBeats = 0;
  segments.forEach((segment, sceneIndex) => segment.visualBeats.forEach((beat, beatIndex) => {
    const actorMotion = beat.actors?.some((actor) => actor.animation !== 'idle' || actor.fromX !== actor.toX);
    const objectMotion = beat.objects?.some((object) => object.path.some((point) => {
      const first = object.path[0];
      return first && (point.x !== first.x || point.y !== first.y || point.rotation !== first.rotation);
    }));
    const performance = Boolean(beat.narrationCue && beat.action && (actorMotion || objectMotion));
    if (performance) movingBeats++;
    if (beat.purpose === 'action' && !performance) {
      issues.push(`Cảnh ${sceneIndex + 1}, nhịp ${beatIndex + 1}: hành động chưa có sprite hoặc đối tượng chuyển động. Ảnh zoom và chữ hiện lần lượt không thể thay hành động.`);
    }
  }));
  if (!movingBeats) issues.push('Kế hoạch chỉ có ảnh/chữ, chưa có animation thực. Cần lập lại hành động với sprite khả thi hoặc đối tượng chuyển động đúng nội dung.');
  return issues;
}

export function animationActorPlanIssues(segments: LongAnimationSegment[], plan: Pick<DirectorReply, 'spriteRequests' | 'characterRequests'>, assets: AnimationAsset[], canGenerateSprites: boolean) {
  const capabilities = new Map(assets.filter((asset) => asset.sprite && asset.status !== 'rejected').map((asset) => [asset.id, Object.keys(asset.sprite!.clips)]));
  const issues: string[] = [];
  for (const request of normalizeSpriteRequests(plan.spriteRequests)) {
    if (capabilities.has(request.key)) issues.push(`Asset key trùng: ${request.key}.`);
    else if (canGenerateSprites) capabilities.set(request.key, request.clips);
  }
  for (const request of (plan.characterRequests || []).slice(0, 3)) {
    if (!request || !['stick', 'robot'].includes(request.kind)) continue;
    if (capabilities.has(request.key)) issues.push(`Asset key trùng: ${request.key}.`);
    else capabilities.set(request.key, ['idle', 'walk', 'run', 'point', 'talk']);
  }
  segments.forEach((segment, sceneIndex) => segment.visualBeats.forEach((beat, beatIndex) => {
    for (const actor of beat.actors || []) {
      const clips = capabilities.get(actor.assetId);
      if (!clips?.includes(actor.animation)) issues.push(`Cảnh ${sceneIndex + 1}, nhịp ${beatIndex + 1}: không có tài nguyên/clip ${actor.assetId}/${actor.animation}. Cần khai báo sprite khả thi với Flow hoặc lập lại cách kể.`);
    }
  }));
  return issues;
}

async function generateDirectorAsset(request: DirectorAssetRequest, generation: DirectorAssetGeneration, width?: number, height?: number) {
  return generateAnimationAsset({ prompt: request.prompt, name: request.name, type: request.type || 'image', tags: request.tags, style: request.style, provider: generation.provider, model: generation.model, generator: generation.generator, width, height, referenceUploadId: generation.referenceUploadId, referenceAssetId: generation.referenceAssetId });
}

const imageRetryDetail = (error: unknown) => error instanceof Error ? error.message : String(error);
const imagePromptNeedsRewrite = (error: unknown) => /UNSAFE_GENERATION|INVALID_ARGUMENT|safety|blocked|content.?policy/i.test(imageRetryDetail(error));
const transientImageGenerationError = (error: unknown) => /429|rate.?limit|failed to fetch|timed? ?out|timeout|econnreset|socket|network|temporar|502|503|504|không phản hồi lượt tạo ảnh|tạm loại worker/i.test(imageRetryDetail(error));
const imageRetryDelayMs = (attempt: number) => Math.min(30_000, Math.round(1_200 * Math.pow(1.7, Math.max(0, attempt - 1))));
const waitForImageRetry = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type DirectorAssetRetryInput = {
  request: DirectorAssetRequest;
  generation: DirectorAssetGeneration;
  width?: number;
  height?: number;
  provider: AIProvider;
  model: string;
  label: string;
  onStage: (stage: string) => Promise<void>;
  onFailure?: (error: unknown, attempt: number) => void;
};

/**
 * Image generation is a required production step. A failed provider call must
 * never silently become a black frame or a "missing illustration" placeholder.
 * Keep the same task alive until it succeeds or the surrounding job is
 * explicitly cancelled (the job store cancels by making onStage throw).
 */
async function generateDirectorAssetUntilSuccess(input: DirectorAssetRetryInput) {
  let prompt = input.request.prompt;
  let attempt = 0;
  let genericRepairTried = false;
  const maxAttempts = input.generation.generator === 'flow-agent' ? 6 : 5;
  while (attempt < maxAttempts) {
    attempt += 1;
    await input.onStage(`${input.label}${attempt > 1 ? ` · thử lại lần ${attempt}` : ''}`);
    try {
      return await generateDirectorAsset({ ...input.request, prompt }, input.generation, input.width, input.height);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      input.onFailure?.(error, attempt);
      const detail = imageRetryDetail(error);
      const shouldRepairPrompt = imagePromptNeedsRewrite(error) || (!genericRepairTried && attempt >= 4 && !transientImageGenerationError(error) && !(error instanceof FlowSessionError));
      if (shouldRepairPrompt) {
        genericRepairTried = true;
        try {
          const rewritten = await chat(input.provider, input.model, [{ role: 'system', content: 'Rewrite the supplied image prompt into one simple, family-safe educational visual that is easy for a general image generator to render. Preserve the exact explanatory meaning, recurring character identity, user-requested visual style and setting. Remove unsafe, ambiguous or overcomplicated wording. Do not add extra text. Return only the rewritten English prompt.' }, { role: 'user', content: prompt }], undefined, 2048);
          if (rewritten.trim().length >= 8) prompt = rewritten.trim().slice(0, 4000);
        } catch { /* Retry the last valid prompt if prompt repair itself is unavailable. */ }
      }
      if (attempt >= maxAttempts) throw new Error(`${input.label} thất bại ${attempt} lần liên tiếp: ${detail}. Đã dừng ảnh này để không treo job hàng giờ; checkpoint và các ảnh đã tạo vẫn được giữ để tiếp tục sau.`);
      const delayMs = imageRetryDelayMs(attempt);
      await input.onStage(`${input.label} lỗi: ${detail.slice(0, 180)} · tự thử lại sau ${(delayMs / 1000).toFixed(delayMs < 10_000 ? 1 : 0)}s`);
      await waitForImageRetry(delayMs);
    }
  }
  throw new Error(`${input.label} không thể hoàn tất.`);
}

async function generateDirectorFlowBatchUntilSuccess(input: Omit<DirectorAssetRetryInput, 'request'> & { requests: DirectorAssetRequest[] }) {
  if (!input.requests.length) return [] as AnimationAsset[];
  if (input.requests.length === 1) {
    return [await generateDirectorAssetUntilSuccess({ ...input, request: input.requests[0] })];
  }

  const generationInputs = input.requests.map((request) => ({
    prompt: request.prompt,
    name: request.name,
    type: request.type || 'image',
    tags: request.tags,
    style: request.style,
    provider: input.generation.provider,
    model: input.generation.model,
    generator: input.generation.generator,
    width: input.width,
    height: input.height,
    referenceUploadId: input.generation.referenceUploadId,
    referenceAssetId: input.generation.referenceAssetId,
  }));

  const maxBatchAttempts = 3;
  for (let attempt = 1; attempt <= maxBatchAttempts; attempt += 1) {
    await input.onStage(`${input.label}${attempt > 1 ? ` · thử lại batch lần ${attempt}` : ''}`);
    try {
      return await generateFlowAnimationAssetBatch(generationInputs, generationInputs.map((item) => item.prompt));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      input.onFailure?.(error, attempt);
      const detail = imageRetryDetail(error);
      // Safety/prompt errors usually belong to only one member of the pair. Split
      // immediately so the healthy prompt is not retried together with it.
      if (imagePromptNeedsRewrite(error)) {
        const assets: AnimationAsset[] = [];
        for (const request of input.requests) assets.push(await generateDirectorAssetUntilSuccess({ ...input, request, label: input.label }));
        return assets;
      }
      if (attempt >= maxBatchAttempts) {
        // A batch can be slower than one request when the local bridge is under
        // pressure. Fall back to two sequential singles inside this worker rather
        // than stopping the whole storyboard job.
        const assets: AnimationAsset[] = [];
        for (const request of input.requests) assets.push(await generateDirectorAssetUntilSuccess({ ...input, request, label: input.label }));
        return assets;
      }
      const delayMs = imageRetryDelayMs(attempt);
      await input.onStage(`${input.label} lỗi batch: ${detail.slice(0, 180)} · tự thử lại sau ${(delayMs / 1000).toFixed(1)}s`);
      await waitForImageRetry(delayMs);
    }
  }
  throw new Error(`${input.label} không thể hoàn tất batch.`);
}

export function jsonFromDirectorReply(raw: string): DirectorReply {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(cleaned) as DirectorReply; }
  catch { /* Some providers wrap valid JSON in a short explanation. */ }
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('AI Director không trả về JSON.');
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') { quoted = true; continue; }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return JSON.parse(cleaned.slice(start, index + 1)) as DirectorReply;
  }
  throw new Error('JSON từ AI Director bị thiếu phần kết thúc.');
}

export async function generateAnimationCharacterOptions(input: { brief: string; provider: AIProvider; model: string; assetGeneration: DirectorAssetGeneration; width?: number; height?: number }, signal?: AbortSignal) {
  const brief = String(input.brief || '').trim().slice(0, 8_000);
  if (brief.length < 10) throw new Error('Hãy nhập nội dung trước khi tạo nhân vật.');
  if (!input.provider || !input.model) throw new Error('Chưa cấu hình AI để thiết kế nhân vật.');
  if (input.assetGeneration.generator === 'flow-agent') await validateGoogleFlowSession(undefined, signal);
  const raw = await chat(input.provider, input.model, [{ role: 'system', content: 'Return compact JSON only: {"characterOptions":[{"name":"","prompt":""}]}. Create exactly four clearly different lead-character design options for the supplied story. Each prompt must describe one full-body character reference sheet: front three-quarter pose, complete uncropped silhouette, recognizable face, clothing, colors, proportions and one coherent art style suitable for consistent reuse in later story illustrations. Use a simple neutral background. No text, labels, grids, multiple poses, UI or logos.' }, { role: 'user', content: brief }], signal, 4096);
  const planned = jsonFromDirectorReply(raw).characterOptions || [];
  const fallbacks = ['cinematic illustrated realism', 'expressive 3D animated film style', 'modern graphic novel illustration', 'warm hand-painted storybook illustration'];
  const options = Array.from({ length: 4 }, (_, index) => ({
    name: String(planned[index]?.name || `Nhân vật ${index + 1}`).trim().slice(0, 80),
    prompt: String(planned[index]?.prompt || `Create the lead character for this story in ${fallbacks[index]}: ${brief}`).trim(),
  }));
  const requests = options.map((option, index) => ({
    prompt: `${option.prompt}. This is a reusable identity and art-style reference for the story: ${brief}. Show exactly one character, full body, uncropped, no text or labels.`,
    name: option.name,
    type: 'character' as const,
    tags: ['character-option', `option-${index + 1}`],
    style: 'character reference',
    ...input.assetGeneration,
    referenceUploadId: undefined,
    referenceAssetId: undefined,
    width: input.width || 1024,
    height: input.height || 1024,
  }));
  if (input.assetGeneration.generator === 'flow-agent') {
    const directions = options.map((option, index) => `${index + 1}. ${option.name}: ${option.prompt}`).join('\n');
    return generateFlowAnimationAssetBatch(requests, `Create four strongly distinct lead-character design alternatives for this story. Each returned image must contain exactly one full-body character in a front three-quarter pose, complete uncropped silhouette, recognizable face, clothing, colors and proportions, on a simple neutral background. Vary identity, silhouette and art direction clearly across the batch. No text, labels, grids, multiple poses, UI or logos. Story: ${brief}\nDesign directions:\n${directions}`, signal);
  }
  return Promise.all(requests.map(generateAnimationAsset));
}

export async function generateAnimationThumbnailOptions(input: { project: AnimationProject; brief?: string; provider: AIProvider; model: string; assetGeneration: DirectorAssetGeneration; count?: number }, signal?: AbortSignal) {
  const count = Math.max(1, Math.min(3, Math.round(Number(input.count) || 3)));
  if (!input.provider || !input.model) throw new Error('Chưa cấu hình AI để lập thumbnail.');
  if (!input.assetGeneration) throw new Error('Hãy chọn provider tạo ảnh trước khi tạo thumbnail.');
  if (input.assetGeneration.generator === 'flow-agent') await validateGoogleFlowSession(undefined, signal);

  const title = String(input.project.name || '').trim() || 'Untitled video';
  const narration = input.project.scenes
    .map((scene) => scene.renderMode === 'composite' ? String(scene.narration || '').trim() : '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 12_000);
  const story = [
    `VIDEO TITLE: ${title}`,
    String(input.brief || '').trim() ? `BRIEF: ${String(input.brief || '').trim()}` : '',
    narration ? `NARRATION: ${narration}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 16_000);
  if (!story.trim()) throw new Error('Project chưa có đủ nội dung để lập thumbnail.');

  const hasCharacterReference = Boolean(input.assetGeneration.referenceUploadId || input.assetGeneration.referenceAssetId);
  const characterRule = characterReferenceDirective(hasCharacterReference);
  const style = String(input.project.styleProfile?.style || '').trim();
  const thumbnailLanguage = visualTextLanguage(story);
  const thumbnailLanguageRule = thumbnailLanguage === 'Vietnamese'
    ? 'VIDEO LANGUAGE: Vietnamese. Intentional thumbnail words must be natural Vietnamese. Numbers, currency symbols, percentages, arrows, proper nouns and standard units may remain as symbols/names.'
    : 'VIDEO LANGUAGE: English. Intentional thumbnail words must be English. Numbers, currency symbols, percentages, arrows, proper nouns and standard units may remain as symbols/names.';

  const plannerSchema = '{"thumbnailOptions":[{"title":"internal concept name","angle":"payoff|curiosity|before-after|emotion|mechanism|consequence","text":"optional 0-4 words","prompt":"complete visual direction","scores":{"titleComplementarity":0,"visualSimplicity":0,"mobileReadability":0,"curiosityGap":0,"semanticAccuracy":0}}]}';
  const raw = await chat(input.provider, input.model, [
    {
      role: 'system',
      content: `You are a senior YouTube packaging strategist. Follow these rules as ground truth: ${thumbnailPackagingRules} The VIDEO TITLE already carries the searchable topic; the thumbnail should usually carry the missing payoff, emotion, object, consequence, scale contrast, before/after or surprising mechanism. First design SIX genuinely different candidate concepts, then self-score every candidate from 0-10 on titleComplementarity, visualSimplicity, mobileReadability, curiosityGap and semanticAccuracy. A candidate that merely rewrites the title deserves a very low titleComplementarity score. Test the composition mentally at about 120 px wide. Use at most one main subject plus one supporting object/result. Avoid keyword stuffing, paragraphs, fake UI, watermarks and logos. ${thumbnailLanguageRule} ${characterRule} ${style ? `VISUAL STYLE: ${style}.` : ''} Return compact JSON only matching this schema: ${plannerSchema}`,
    },
    { role: 'user', content: story },
  ], signal, 8192);

  const planned = jsonFromDirectorReply(raw).thumbnailOptions || [];
  const fallbacks: ThumbnailConceptCandidate[] = [
    { title: 'Payoff', angle: 'payoff', text: '', prompt: 'Show the strongest concrete result or payoff from the video as one oversized visual outcome contrasted against its small cause.', scores: { titleComplementarity: 9, visualSimplicity: 9, mobileReadability: 10, curiosityGap: 8, semanticAccuracy: 9 } },
    { title: 'Mechanism', angle: 'mechanism', text: '', prompt: 'Turn the central mechanism into one simple visual cause-and-effect relationship with a single dominant object and one obvious result.', scores: { titleComplementarity: 9, visualSimplicity: 9, mobileReadability: 10, curiosityGap: 7, semanticAccuracy: 9 } },
    { title: 'Consequence', angle: 'consequence', text: '', prompt: 'Show the most surprising supported consequence from the story with one clear subject reacting to one enlarged result.', scores: { titleComplementarity: 9, visualSimplicity: 8, mobileReadability: 10, curiosityGap: 8, semanticAccuracy: 9 } },
    { title: 'Before After', angle: 'before-after', text: '', prompt: 'Use a clean split composition showing a meaningful before-versus-after or small-versus-large contrast supported by the story.', scores: { titleComplementarity: 8, visualSimplicity: 9, mobileReadability: 9, curiosityGap: 8, semanticAccuracy: 9 } },
    { title: 'Curiosity', angle: 'curiosity', text: '', prompt: 'Show one visually puzzling but truthful contradiction from the story that makes the viewer want the explanation.', scores: { titleComplementarity: 9, visualSimplicity: 8, mobileReadability: 9, curiosityGap: 9, semanticAccuracy: 8 } },
    { title: 'Emotion', angle: 'emotion', text: '', prompt: 'Use one strong but believable reaction tied to the key object or result from the video, with a clean background and no extra clutter.', scores: { titleComplementarity: 8, visualSimplicity: 8, mobileReadability: 9, curiosityGap: 8, semanticAccuracy: 8 } },
  ];
  const options = selectThumbnailConcepts(title, [...planned, ...fallbacks], count);
  if (options.length < count) throw new Error('AI chưa lập đủ concept thumbnail khác nhau để A/B test.');

  const batchId = randomUUID().replace(/-/g, '').slice(0, 10);
  const projectTag = `project:${input.project.id}`;
  const requests = options.map((option, index) => ({
    prompt: [
      characterRule,
      thumbnailLanguageRule,
      'Create ONE finished 16:9 YouTube thumbnail, not a storyboard frame and not a collage.',
      `VIDEO TITLE FOR CONTEXT ONLY — DO NOT REPEAT IT ON THE IMAGE: “${title}”.`,
      `CONCEPT ANGLE: ${option.angle}.`,
      `VISUAL DIRECTION: ${option.prompt}`,
      option.text
        ? `Render exactly ONE large text block with only: “${option.text}”. Do not add any other intentional words.`
        : 'Use no intentional text unless a tiny unavoidable real-world marking is essential.',
      'One dominant focal point. Strong foreground/background separation. Bold silhouette. High contrast. Generous negative space. The idea must still read when the image is only about 120 pixels wide.',
      'The thumbnail must complement the title with payoff, emotion, consequence, contrast or mechanism rather than restating the searchable topic.',
      'Keep factual meaning accurate to the actual video. No unsupported clickbait, fake interface chrome, watermarks, logos, paragraphs, subtitles or tiny decorative text.',
      style ? `Match the established video art direction: ${style}.` : 'Match the established visual language of the video.',
    ].join('\n'),
    name: `${title} · Thumbnail ${index + 1} · ${option.title} · ${batchId}`.slice(0, 160),
    type: 'image' as const,
    tags: [
      'thumbnail',
      'youtube-thumbnail',
      projectTag,
      `thumbnail-batch:${batchId}`,
      `thumbnail-angle:${option.angle}`,
      `thumbnail-score:${option.totalScore.toFixed(2)}`,
      `option-${index + 1}`,
    ],
    style: style || 'YouTube educational explainer thumbnail',
    ...input.assetGeneration,
    width: 1280,
    height: 720,
  }));

  const generated = input.assetGeneration.generator === 'flow-agent'
    ? await generateFlowAnimationAssetBatch(
      requests,
      [
        characterRule,
        thumbnailLanguageRule,
        `Create exactly ${count} DISTINCT standalone 16:9 YouTube thumbnails in the returned order. Never return a contact sheet.`,
        'The three images must use clearly different visual hooks/layouts, remain readable at mobile size, and complement rather than repeat the video title.',
        'One dominant focal point per image, strong contrast, uncluttered negative space, no watermarks/logos/fake UI.',
        'Only render thumbnail text when explicitly specified for that numbered direction, and never invent extra words.',
        'THUMBNAIL DIRECTIONS:',
        options.map((option, index) => `${index + 1}. [${option.angle}] score=${option.totalScore} | ${option.text ? `text: “${option.text}” | ` : ''}${option.prompt.slice(0, 700)}`).join('\n'),
        'VIDEO CONTEXT:',
        story.slice(0, 1400),
      ].join('\n').slice(0, 5000),
      signal,
    )
    : await Promise.all(requests.map(generateAnimationAsset));

  const newIds = new Set(generated.map((asset) => asset.id));
  const library = await listAnimationAssets();
  const oldThumbnailIds = new Set<string>([
    ...input.project.assets.filter((asset) => asset.tags?.includes('youtube-thumbnail')).map((asset) => asset.id),
    ...library.filter((asset) => asset.tags?.includes('youtube-thumbnail') && asset.tags?.includes(projectTag)).map((asset) => asset.id),
  ]);
  await deleteAnimationAssets([...oldThumbnailIds].filter((id) => !newIds.has(id)));
  return generated;
}

export function directorRepairRule(reason: string) {
  return /thiếu phần kết thúc|unexpected end|unterminated|end of json/i.test(reason)
    ? 'TRUNCATION RECOVERY: regenerate a smaller complete project with exactly 2 scenes, at most 4 layers and 5 commands per scene. Use compact one-line JSON. Close every array and object. Do not repeat the broken response.'
    : 'STRICT REPAIR: return a complete compact JSON document and correct every validation problem.';
}

export function replaceUnavailableGeneratedAssets(scenes: AnimationScene[], replacements: Map<string, string>, unavailable: Set<string>) {
  return scenes.map((scene): AnimationScene => scene.renderMode !== 'composite' ? scene : {
    ...scene,
    layers: scene.layers.map((layer) => {
      if (!layer.assetId) return layer;
      const replacement = replacements.get(layer.assetId);
      if (replacement) return { ...layer, assetId: replacement };
      if (!unavailable.has(layer.assetId)) return layer;
      const { assetId: _assetId, animation: _animation, characterId: _characterId, ...editable } = layer;
      return { ...editable, name: `${layer.name} · placeholder`, type: 'shape', shape: 'rectangle', fill: layer.fill || '#263548' };
    }),
  });
}

export function normalizeLongAnimationSegments(plan: DirectorReply, sceneCount: number): LongAnimationSegment[] {
  const motions = new Set<VisualBeatMotion>(['push', 'pull', 'pan-left', 'pan-right', 'drift-up', 'drift-down', 'locked']);
  const transitions = new Set<VisualBeatTransition>(['cut', 'match-cut', 'crossfade']);
  return (plan.segments || []).map((segment, segmentIndex): LongAnimationSegment => {
    const title = String(segment.title || `Cảnh ${segmentIndex + 1}`).trim();
    const legacyVisuals = [segment.visual, segment.visualDetail].map((value) => String(value || '').trim()).filter(Boolean);
    const supplied = Array.isArray(segment.visualBeats) ? segment.visualBeats : [];
    const beats: LongAnimationSegment['visualBeats'] = supplied.map((beat, beatIndex) => ({
      narrationCue: typeof beat.narrationCue === 'string' && String(segment.narration || '').includes(beat.narrationCue.trim()) && beat.narrationCue.trim().length >= 4 ? beat.narrationCue.trim() : undefined,
      action: typeof beat.action === 'string' ? beat.action.trim().slice(0, 240) : undefined,
      purpose: String(beat?.purpose || `Nhịp hình ${beatIndex + 1}`).trim(),
      visual: String(beat?.visual || '').trim(),
      // Auto-storyboard still images default to a true static hold. The editor/runtime
      // can still evaluate authored pan/zoom commands, but Director must not invent
      // Ken Burns motion merely to make a generated illustration look animated.
      motion: motions.has(beat?.motion as VisualBeatMotion) ? beat.motion as VisualBeatMotion : 'locked',
      transition: transitions.has(beat?.transition as VisualBeatTransition) ? beat.transition as VisualBeatTransition : 'cut' as const,
      objects: normalizeAnimatedObjects(beat.objects),
      actors: Array.isArray(beat.actors) ? beat.actors.filter((actor) => actor && typeof actor.assetId === 'string' && typeof actor.animation === 'string' && [actor.fromX, actor.toX, actor.y].every((value) => Number.isFinite(value) && value >= .1 && value <= .9)).slice(0, 3) : undefined,
      diagram: Array.isArray(beat.diagram?.steps) ? { steps: beat.diagram.steps.filter((text) => typeof text === 'string' && text.trim()).map((text) => text.trim().slice(0, 80)).slice(0, beat.diagram.layout === 'comparison' ? 2 : 3), layout: beat.diagram.layout === 'comparison' ? 'comparison' as const : 'process' as const } : undefined,
    })).filter((beat) => beat.visual || beat.objects?.length || beat.actors?.length || beat.diagram?.steps.length);
    for (const visual of legacyVisuals) if (!beats.some((beat) => beat.visual === visual)) beats.push({ purpose: 'Minh họa bổ sung', visual, motion: 'locked', transition: 'cut' });
    // Do not fabricate extra image prompts to meet an arbitrary shot quota.
    const uniqueBeats = beats.filter((beat, index) => beat.objects?.length || beat.actors?.length || beat.diagram?.steps.length || beats.findIndex((other) => other.visual.toLowerCase().replace(/\s+/g, ' ').trim() === beat.visual.toLowerCase().replace(/\s+/g, ' ').trim()) === index);
    return {
      title,
      narration: String(segment.narration || '').trim(),
      visualBeats: uniqueBeats.slice(0, 6),
      motionGraphic: 'none',
    };
  }).filter((segment) => segment.narration).slice(0, sceneCount);
}

export function buildBeatPerformances(input: { sceneIndex: number; durationMs: number; width: number; height: number; assets: AnimationAsset[]; beats: LongAnimationSegment['visualBeats']; narration?: string }) {
  const { sceneIndex, durationMs, width, height, assets, beats } = input;
  const windows = buildAnimationBeatWindows({ beats, narration: input.narration, durationMs });
  const layers: SceneLayer[] = [];
  const commands: AnimationCommand[] = [];
  const warnings: string[] = [];
  beats.forEach((beat, index) => {
    const { startMs: start, endMs: end } = windows[index] || { startMs: 0, endMs: durationMs };
    const gate = (id: string, enter: number) => {
      commands.push({ id: `${id}-in`, type: 'FADE_IN', targetId: id, startMs: enter, durationMs: 1 });
      commands.push({ id: `${id}-out`, type: 'FADE_OUT', targetId: id, startMs: end - 1, durationMs: 1 });
    };
    const objectPerformance = buildAnimatedObjects(beat.objects || [], `beat-${sceneIndex}-${index}`, start, end, width, height);
    layers.push(...objectPerformance.layers); commands.push(...objectPerformance.commands);
    (beat.actors || []).forEach((actor, actorIndex) => {
      const asset = assets.find((item) => item.id === actor.assetId);
      if (!asset?.sprite?.clips[actor.animation]) {
        warnings.push(`Cảnh ${sceneIndex + 1}, nhịp ${index + 1}: thiếu sprite/clip ${actor.animation}; không thay bằng ảnh đứng.`);
        return;
      }
      const id = `actor-${sceneIndex}-${index}-${actorIndex}`;
      const h = height * .38;
      layers.push({ id, type: 'sprite', name: `${asset.name} · ${actor.animation}`, assetId: asset.id, characterId: asset.id, animation: actor.animation, visible: true, locked: false, zIndex: 100 + actorIndex, width: h * asset.sprite.frameWidth / asset.sprite.frameHeight, height: h, transform: { ...defaultTransform(), scale: { x: actor.toX < actor.fromX ? -1 : 1, y: 1 }, opacity: 0, position: { x: actor.fromX * width, y: actor.y * height } } });
      gate(id, start);
      commands.push({ id: `${id}-perform`, type: 'PLAY_ANIMATION', targetId: id, animation: actor.animation, startMs: start, durationMs: end - start });
      commands.push({ id: `${id}-travel`, type: 'MOVE', targetId: id, startMs: start, durationMs: end - start, easing: 'linear', from: { x: actor.fromX * width, y: actor.y * height }, to: { x: actor.toX * width, y: actor.y * height } });
    });
    const steps = beat.diagram?.steps || [];
    steps.forEach((text, stepIndex) => {
      const id = `process-${sceneIndex}-${index}-${stepIndex}`;
      const portrait = height > width;
      const comparison = beat.diagram?.layout === 'comparison';
      const x = portrait ? width * .5 : width * (.5 + (stepIndex - (steps.length - 1) / 2) * .3);
      const y = portrait ? height * (.25 + stepIndex * .18) : height * .48;
      const enter = start + Math.round((end - start) * stepIndex / Math.max(steps.length, 1) * (comparison ? .18 : .65));
      const cardWidth = width * (portrait ? .78 : .26);
      const cardHeight = height * (portrait ? .14 : .24);
      for (const [suffix, type, fill] of [['card', 'shape', '#102033'], ['label', 'text', '#ffffff'], ['accent', 'shape', stepIndex % 2 ? '#ffb36b' : '#61ddc6']] as const) {
        const targetId = `${id}-${suffix}`;
        const targetY = suffix === 'accent' ? y - cardHeight / 2 : y;
        layers.push({ id: targetId, name: `${comparison ? 'So sánh' : 'Tiến trình'} ${stepIndex + 1}`, type, shape: type === 'shape' ? 'rectangle' : undefined, text: type === 'text' ? `${comparison ? (stepIndex ? 'B' : 'A') : stepIndex + 1}. ${text}` : undefined, fill, fontSize: Math.max(28, Math.round(Math.min(width, height) * .036)), visible: true, locked: false, zIndex: 110 + stepIndex * 3 + (suffix === 'card' ? 0 : suffix === 'label' ? 1 : 2), width: cardWidth, height: suffix === 'accent' ? Math.max(4, height * .006) : cardHeight, transform: { ...defaultTransform(), opacity: 0, position: { x, y: targetY } } });
        gate(targetId, enter);
        commands.push({ id: `${targetId}-reveal`, type: 'MOVE', targetId, startMs: enter, durationMs: Math.min(300, end - enter), easing: 'ease-out', from: { x, y: targetY + height * .04 }, to: { x, y: targetY } });
        if (comparison) commands.push({ id: `${targetId}-emphasis`, type: 'SCALE', targetId, startMs: start + Math.round((end - start) * (.3 + stepIndex * .3)), durationMs: Math.min(260, Math.floor((end - start) * .15)), easing: 'ease-out', from: { x: .96, y: .96 }, to: { x: 1, y: 1 } });
      }
    });
  });
  for (const [index, beat] of beats.entries()) {
    if (!beat.narrationCue || !beat.action) continue;
    const prefixes = [`beat-${sceneIndex}-${index}-`, `actor-${sceneIndex}-${index}-`, `process-${sceneIndex}-${index}-`];
    for (const command of commands) if (prefixes.some((prefix) => command.targetId.startsWith(prefix))) command.parameters = { ...command.parameters, narrationCue: beat.narrationCue, motionPurpose: beat.action };
  }
  return { layers, commands, warnings };
}

export function buildVisualBeatTimeline(input: { sceneIndex: number; durationMs: number; width: number; height: number; visuals: Array<AnimationAsset | undefined>; beats: LongAnimationSegment['visualBeats']; narration?: string }) {
  const { sceneIndex, durationMs, width, height, visuals, beats } = input;
  const cueWindows = buildAnimationBeatWindows({ beats, narration: input.narration, durationMs });
  const starts = cueWindows.map((window) => window.startMs);
  if (durationMs <= Math.max(1, beats.length) * 3000) {
    for (let index = 1; index < starts.length; index++) {
      const earliest = Math.max(starts[index - 1] + 1, durationMs - (starts.length - index) * 3000);
      const latest = Math.min(durationMs - 1, starts[index - 1] + 3000);
      starts[index] = Math.max(earliest, Math.min(latest, starts[index]));
    }
  }
  const windows = cueWindows.map((window, index) => ({
    ...window,
    startMs: starts[index],
    endMs: index + 1 < starts.length ? starts[index + 1] : durationMs,
  }));
  const layers: SceneLayer[] = [];
  const commands: AnimationCommand[] = [];
  const count = Math.max(1, visuals.length);
  visuals.forEach((visual, beatIndex) => {
    if (!visual) return;
    const id = `visual-${sceneIndex}-${beatIndex}`;
    const beat = beats[beatIndex] || beats[beats.length - 1];
    const window = windows[beatIndex] || { startMs: Math.round(durationMs * beatIndex / count), endMs: durationMs };
    const startMs = window.startMs;
    const endMs = beatIndex === count - 1 ? durationMs : window.endMs;
    const beatDuration = Math.max(1, endMs - startMs);
    const transitionDuration = (transition: VisualBeatTransition | undefined, duration: number) => transition === 'cut'
      ? 1
      : transition === 'match-cut'
        ? Math.min(120, Math.max(60, Math.round(duration * .04)))
        : Math.min(320, Math.max(160, Math.round(duration * .1)));
    const transitionMs = transitionDuration(beat?.transition, beatDuration);
    const nextBeat = beats[beatIndex + 1];
    const nextTransitionMs = transitionDuration(nextBeat?.transition, Math.max(1, (windows[beatIndex + 1]?.endMs || durationMs) - endMs));
    const locked = beat?.motion === 'locked';
    const baseScale = locked ? 1 : beat?.motion?.startsWith('pan-') || beat?.motion?.startsWith('drift-') ? 1.09 : 1.03;
    layers.push({ id, name: `${beat?.purpose || 'Nhịp hình'} · ${visual.name}`, type: 'image', assetId: visual.id, visible: true, locked: true, zIndex: beatIndex, width: locked ? width : Math.round(width * 1.08), height: locked ? height : Math.round(height * 1.08), transform: { ...defaultTransform(), opacity: beatIndex ? 0 : 1, scale: { x: baseScale, y: baseScale }, position: { x: width / 2, y: height / 2 } } });
    if (beatIndex > 0) commands.push({ id: `visual-in-${sceneIndex}-${beatIndex}`, type: 'FADE_IN', targetId: id, startMs, durationMs: transitionMs, easing: 'ease-out' });
    if (beatIndex < count - 1) commands.push({ id: `visual-out-${sceneIndex}-${beatIndex}`, type: 'FADE_OUT', targetId: id, startMs: endMs, durationMs: nextTransitionMs, easing: 'ease-in' });
    if (beat?.motion === 'push' || beat?.motion === 'pull') {
      const pulling = beat.motion === 'pull';
      commands.push({ id: `visual-scale-${sceneIndex}-${beatIndex}`, type: 'SCALE', targetId: id, startMs, durationMs: beatDuration, easing: 'ease-in-out', from: pulling ? { x: 1.1, y: 1.1 } : { x: 1.02, y: 1.02 }, to: pulling ? { x: 1.02, y: 1.02 } : { x: 1.1, y: 1.1 } });
    } else if (beat?.motion !== 'locked') {
      const dx = width * .035; const dy = height * .035;
      const from = beat?.motion === 'pan-left' ? { x: width / 2 + dx, y: height / 2 } : beat?.motion === 'pan-right' ? { x: width / 2 - dx, y: height / 2 } : beat?.motion === 'drift-up' ? { x: width / 2, y: height / 2 + dy } : { x: width / 2, y: height / 2 - dy };
      const to = { x: width - from.x, y: height - from.y };
      commands.push({ id: `visual-move-${sceneIndex}-${beatIndex}`, type: 'MOVE', targetId: id, startMs, durationMs: beatDuration, easing: 'ease-in-out', from, to });
    }
  });
  return { layers, commands };
}

async function directLongAnimationProject(input: DirectAnimationInput, brief: string, targetDurationSeconds: number, strictDuration: boolean, checkpointKey: string, onStage: (stage: string) => Promise<void>) {
  const library = await listAnimationAssets();
  const assets = [...library.filter((asset) => !input.project.assets.some((item) => item.id === asset.id)), ...input.project.assets];
  const density = buildVisualDensityPlan(targetDurationSeconds);
  const sceneCount = density.sceneCount;
  const visualsPerScene = density.visualsPerScene;
  const targetWords = Math.round(targetDurationSeconds * 2.25);
  const targetMs = targetDurationSeconds * 1000;
  const hasCharacterReference = Boolean(input.assetGeneration?.referenceUploadId || input.assetGeneration?.referenceAssetId);
  const characterReferenceRule = characterReferenceDirective(hasCharacterReference);
  const requestedStyle = String(input.project.styleProfile?.style || '').trim();
  const requestedTone = input.project.styleProfile?.tone || 'balanced';
  const imageTextLanguage = visualTextLanguage(brief);
  const textRule = visualTextDirective(imageTextLanguage);
  const styleRule = requestedStyle
    ? `USER VISUAL STYLE IS IMMUTABLE: ${requestedStyle}. Apply it to every generated visual; do not replace it with a generic cinematic, 3D, doodle, whiteboard or storybook preset. If this is a stick-figure/mascot style, keep the same head shape, face language, line weight, body proportions, clothing silhouette and accent colors in every recurring appearance; never reinterpret the mascot as chibi, anime, realistic, 3D or a different illustration language. When an external character reference is attached, it overrides generic character appearance hints from this style preset.`
    : 'No explicit visual style was supplied; infer one coherent style from the brief and keep it consistent. Recurring characters must keep the same design language and proportions across every shot.';
  const toneRule = requestedTone === 'humorous'
    ? 'STORY TONE: smart light humor. Prefer 2-3 sequence-based humor beats per minute such as setup → immediate visual payoff, stated intention → cut → contradiction, or restrained reaction cutaways. Humor should come from editing and situation more than random exaggerated faces. Never distort facts, never force a joke into every sentence, and reduce or remove humor when the subject is serious or sensitive.'
    : requestedTone === 'curious'
      ? 'STORY TONE: curious discovery. Use questions, reveals and satisfying cause-and-effect payoffs without clickbait exaggeration.'
      : requestedTone === 'energetic'
        ? 'STORY TONE: energetic and punchy. Keep sentences concise, transitions decisive and visual payoffs frequent without becoming frantic.'
        : requestedTone === 'serious'
          ? 'STORY TONE: calm, precise and professional. Prefer clarity and evidence over jokes or hype.'
          : 'STORY TONE: natural and balanced. Keep the explanation conversational, clear and engaging without forcing jokes or hype.';
  const hybridRule = 'AI-IMAGE-ONLY VISUAL RULE: every visualBeat must contain a complete generated-image prompt in visual. Do not replace storyboard beats with vector-only objects, procedural diagrams, shapes, or empty visual prompts. All meaningful shot changes remain AI-generated still images.';
  const storyRules = `STORYBOARD CONTRACT: turn the user's input into a narrated visual story. If it is already a detailed script, preserve its facts, order and intent while making it natural to speak. If it is only a premise, invent a complete coherent script. Each segment is a short narration container, not one reusable picture. Split the narration into atomic visual ideas. Every visualBeat must represent the exact idea currently being spoken and should normally be a DISTINCT composition/shot when the subject, relationship, example, location, scale or explanatory function changes. Do not hold one pretty image and simulate coverage with repeated zooms. Reuse a composition only when the spoken idea genuinely stays the same and a focus change communicates new information. narrationCue must be the exact clause where that visual becomes relevant. Prefer literal explanation first: show the actual object, place, action, relationship or comparison being discussed before using metaphor. Use metaphor only when it makes the mechanism clearer. Mix establishing scenes, character actions, object inserts, diagrams/comparisons, maps, process steps and reaction shots according to the narration; never force one visual type. The first 15 seconds may move at 2-2.5 seconds per beat; the main explanation should stay near 2.5-3.5 seconds. Important comparisons or mechanism explanations may use a longer readable hold. Target roughly 20-24 meaningful composition changes per minute overall; do not exceed 25 except a deliberate short montage. Generated bitmap/image shots are STATIC by default: use motion="locked" and do not use push, pull, pan or drift on still illustrations. Do not create Ken Burns zooms to fake animation. Prefer a clean cut to a genuinely different composition when the spoken idea changes. Reserve visible motion for genuinely editable diagram/object/number/reveal techniques when the runtime can execute them; do not manufacture motion on the bitmap itself. Cuts are the normal transition for fast educational explanation; use crossfade only when continuity or passage of time benefits from it. Return a continuityBible that locks recurring character identity, head/face language, clothing, proportions, palette, line weight/render language and world. ${styleRule} ${toneRule} ${characterReferenceRule} ${hasCharacterReference ? 'When writing visual prompts for a recurring referenced character, DO NOT invent or restate clothing, hair, head shape, eye size, body proportions, accessories or character colors. Refer to them simply as the recurring reference mascot/character and specify only pose, action, expression, framing and interaction. The attached reference supplies appearance.' : 'A selected AI character design may be supplied as an identity anchor; do not force that character into every beat.'} ${textRule} ${hybridRule} Prefer comprehension and real shot changes over decorative camera motion.`;
  brief = `${brief}\n\n${storyRules}`;
  const checkpoint = await loadAnimationCheckpoint<{ plan: DirectorReply; segments: LongAnimationSegment[]; sceneIds: string[]; narrationDurationsMs?: number[]; narrationRenderSpeed?: number }>(checkpointKey);
  let plan: DirectorReply;
  let segments: LongAnimationSegment[];
  let continuity: string;
  let sceneIds: string[];
  let narrationDurationsMs: number[] | undefined;
  let narrationRenderSpeed = Math.max(.5, Math.min(2, Number(input.narration?.speed) || 1));
  if (checkpoint) {
    plan = checkpoint.plan;
    segments = checkpoint.segments;
    sceneIds = checkpoint.sceneIds;
    narrationDurationsMs = Array.isArray(checkpoint.narrationDurationsMs) ? checkpoint.narrationDurationsMs.map(Number) : undefined;
    if (Number.isFinite(checkpoint.narrationRenderSpeed) && Number(checkpoint.narrationRenderSpeed) > 0) narrationRenderSpeed = Math.max(.5, Math.min(2, Number(checkpoint.narrationRenderSpeed)));
    if (!Array.isArray(segments) || segments.length !== sceneCount || sceneIds.length !== segments.length) throw new Error('Checkpoint animation không hợp lệ; không tự tạo lại tài nguyên.');
    continuity = String(plan.continuityBible || '').trim().slice(0, 1800);
  } else {
    const chunks = Math.ceil(sceneCount / 20);
    const plannedSegments: DirectorSegment[] = [];
    plan = { segments: [] };
    continuity = '';
    for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
      const chunkSize = Math.min(20, sceneCount - plannedSegments.length);
      const chunkStart = plannedSegments.length;
      const chunkVisualCounts = visualsPerScene.slice(chunkStart, chunkStart + chunkSize);
      const chunkWordTargets = density.sceneDurationsSeconds.slice(chunkStart, chunkStart + chunkSize).map((seconds) => Math.max(8, Math.round(seconds * 2.25)));
      await onStage(`Đang viết storyboard ${chunkIndex + 1}/${chunks}`);
      const prior = plannedSegments.at(-1);
      const planRaw = await chat(input.provider, input.model, [{ role: 'system', content: `You are a storyboard director. Return compact JSON only: {"name":"","continuityBible":"","segments":[{"title":"","narration":"a short connected narration passage","visualBeats":[{"purpose":"hook|explain|comparison|mechanism|payoff","narrationCue":"exact clause from narration where this shot becomes relevant","visual":"a complete prompt for this distinct shot/composition, or empty when a procedural beat fully explains the idea","motion":"locked","transition":"cut|match-cut|crossfade","objects":[{"name":"","shape":"ellipse|rectangle","fill":"#RRGGBB","width":0.12,"height":0.12,"path":[{"t":0,"x":0.2,"y":0.4,"rotation":0},{"t":1,"x":0.7,"y":0.4,"rotation":0}]}],"diagram":{"layout":"process|comparison","steps":["short label"]}}],"motionGraphic":"none"}]}.  This is chunk ${chunkIndex + 1}/${chunks}; create exactly ${chunkSize} consecutive narration containers, covering positions ${plannedSegments.length + 1}-${plannedSegments.length + chunkSize} of ${sceneCount}, and about ${Math.round(targetWords * chunkSize / sceneCount)} spoken words. The required meaningful visualBeat count for each returned segment, in order, is exactly [${chunkVisualCounts.join(', ')}]. Keep the spoken-word distribution per segment close to [${chunkWordTargets.join(', ')}] respectively (about ±15% each) so real TTS fits the requested timeline instead of making one scene much longer than the others. Each beat is normally a distinct image/shot tied to one atomic idea; do not repeat the same composition merely to satisfy the count. ${chunkIndex === 0 ? 'Only the first 15 seconds may use the faster hook pace.' : `Continue directly after: ${prior?.narration || ''}`} ${chunkIndex === chunks - 1 ? 'Resolve the idea in the final segment.' : 'Do not conclude the story yet.'} ${continuity ? `Use this immutable continuityBible verbatim: ${continuity}` : 'Infer and return one detailed continuityBible from the user input, requested style and selected character reference.'} ${textRule}\n\n${storyRules}` }, { role: 'user', content: brief }], undefined, 16_384);
      let chunk = jsonFromDirectorReply(planRaw);
      const chunkTargetWords = Math.round(targetWords * chunkSize / sceneCount);
      if (narrationWordCount((chunk.segments || []).slice(0, chunkSize)) < chunkTargetWords * .88) {
        const expandedRaw = await chat(input.provider, input.model, [{ role: 'system', content: `The storyboard narration is too short for the requested video duration. Return the same compact JSON shape with exactly ${chunkSize} segments and ${chunkTargetWords - Math.round(chunkTargetWords * .04)}-${chunkTargetWords + Math.round(chunkTargetWords * .04)} total Vietnamese spoken words. Preserve facts, order and continuity, but add useful explanation rather than filler. Keep the per-segment spoken-word distribution close to [${chunkWordTargets.join(', ')}] respectively and keep exactly [${chunkVisualCounts.join(', ')}] visualBeats per segment; every narrationCue must be an exact atomic clause from its expanded narration. Return JSON only.` }, { role: 'user', content: JSON.stringify(chunk) }], undefined, 16_384);
        const expanded = jsonFromDirectorReply(expandedRaw);
        if ((expanded.segments || []).length >= chunkSize && narrationWordCount((expanded.segments || []).slice(0, chunkSize)) > narrationWordCount((chunk.segments || []).slice(0, chunkSize))) chunk = expanded;
      }
      if (!continuity) continuity = String(chunk.continuityBible || '').trim().slice(0, 1800);
      if (!plan.name) plan.name = chunk.name;
      plannedSegments.push(...(chunk.segments || []).slice(0, chunkSize));
    }
    plan = { ...plan, continuityBible: continuity, segments: plannedSegments };
    segments = normalizeLongAnimationSegments(plan, sceneCount);
  const asStoryboard = (items: LongAnimationSegment[], expectedCounts = visualsPerScene) => items.map((segment, index) => ({
    ...segment,
    visualBeats: segment.visualBeats.filter((beat) => beat.visual.trim() || beat.objects?.length || beat.diagram?.steps.length).slice(0, expectedCounts[index] || 1).map((beat) => ({
      ...beat,
      // Generated storyboard images are intentionally true stills. Reference
      // videos get their energy from shot selection and cuts, while long-form
      // mechanism/comparison beats may use real editable vector performances.
      motion: 'locked' as const,
      transition: beat.transition,
      actors: undefined,
      objects: beat.visual.trim() ? undefined : beat.objects,
      diagram: beat.visual.trim() ? undefined : beat.diagram,
    })),
    motionGraphic: 'none' as const,
  }));
  segments = asStoryboard(segments);
  if (segments.some((segment, index) => segment.visualBeats.length !== visualsPerScene[index])) {
    for (const [index, segment] of segments.entries()) {
      const expectedCount = visualsPerScene[index] || 1;
      if (segment.visualBeats.length === expectedCount) continue;
      const repaired = jsonFromDirectorReply(await chat(input.provider, input.model, [{ role: 'system', content: `Repair one storyboard segment. Keep its title and narration verbatim. Return JSON with one segments item containing exactly ${expectedCount} meaningful visualBeats. Each beat is normally a distinct shot/composition for a different atomic visual idea, and each narrationCue must be an exact different clause from the narration. Do not create redundant near-duplicate shots just to reach the count. Preserve this continuityBible: ${continuity}. ${textRule} ${storyRules}` }, { role: 'user', content: JSON.stringify(segment) }], undefined, 8192));
      const [candidate] = asStoryboard(normalizeLongAnimationSegments(repaired, 1), [expectedCount]);
      if (candidate?.narration === segment.narration && candidate.visualBeats.length === expectedCount) segments[index] = candidate;
    }
  }
  if (strictDuration) {
    for (const [index, segment] of segments.entries()) {
      const targetSegmentWords = Math.max(8, Math.round((density.sceneDurationsSeconds[index] || 1) * 2.25));
      const currentWords = narrationWordCount([segment]);
      if (currentWords <= targetSegmentWords * 1.18) continue;
      const expectedCount = visualsPerScene[index] || segment.visualBeats.length || 1;
      const tightened = jsonFromDirectorReply(await chat(input.provider, input.model, [{ role: 'system', content: `Shorten one storyboard segment so its spoken narration fits a locked video timeline. Return JSON with exactly one segments item. Keep the title, facts, order, tone and explanatory meaning, but rewrite narration to ${Math.round(targetSegmentWords * .92)}-${Math.round(targetSegmentWords * 1.05)} spoken words. Keep exactly ${expectedCount} meaningful visualBeats and update every narrationCue so it is an exact clause from the shortened narration. Preserve the same visual ideas and continuityBible: ${continuity}. No filler. ${textRule} Return JSON only.\n\n${storyRules}` }, { role: 'user', content: JSON.stringify(segment) }], undefined, 8192));
      const [candidate] = asStoryboard(normalizeLongAnimationSegments(tightened, 1), [expectedCount]);
      if (candidate && candidate.visualBeats.length === expectedCount && narrationWordCount([candidate]) <= targetSegmentWords * 1.12) segments[index] = candidate;
    }
  }
  if (segments.length < sceneCount) throw new Error(`AI Director chỉ trả về ${segments.length}/${sceneCount} cảnh. Hãy thử dựng lại để bảo đảm đủ nhịp hình và thời lượng.`);
  if (segments.some((segment, index) => segment.visualBeats.length !== visualsPerScene[index])) throw new Error('Director chưa trả đủ mật độ hình theo atomic idea. Hãy tiếp tục job để sửa các cảnh còn thiếu thay vì kéo dài một ảnh quá 3 giây.');
  if (narrationWordCount(segments) < targetWords * .8) throw new Error(`AI Director viết narration quá ngắn (${narrationWordCount(segments)}/${targetWords} từ) so với thời lượng ${Math.round(targetDurationSeconds / 60 * 10) / 10} phút. Project chưa được tạo để tránh xuất video ngắn sai yêu cầu; hãy tiếp tục job để AI viết lại đủ nội dung.`);
    sceneIds = segments.map(() => randomUUID());

    if (strictDuration && input.narration) {
      const spokenTargetTotalMs = Math.max(1_000, targetMs - Math.min(Math.round(targetMs * .015), Math.max(200, sceneCount * 80)));
      const targetNarrationMs = density.sceneDurationsSeconds.map((seconds) => Math.max(600, Math.round(spokenTargetTotalMs * seconds / Math.max(1, targetDurationSeconds))));
      const buildNarrationMeasurementProject = (items: LongAnimationSegment[]): AnimationProject => ({
        ...input.project,
        assets: [],
        scenes: items.map((segment, index): CompositeScene => ({
          id: sceneIds[index],
          name: segment.title || `Cảnh ${index + 1}`,
          order: index,
          durationMs: Math.max(1, Math.round((density.sceneDurationsSeconds[index] || 1) * 1000)),
          narration: segment.narration,
          transition: { type: 'cut', durationMs: 0 },
          renderMode: 'composite',
          backgroundColor: '#101218',
          layers: [],
          commands: [],
          camera: { transform: defaultTransform(), commands: [] },
        })),
        productionPlan: undefined,
        assetManifest: undefined,
      });
      const measureNarration = async (items: LongAnimationSegment[], speed = narrationRenderSpeed) => {
        const measured = await generateAnimationNarration({ project: buildNarrationMeasurementProject(items), ...input.narration!, speed, preservePlannedDuration: false }, onStage);
        return measured.scenes.map((scene) => Math.max(1, Math.round(scene.durationMs)));
      };
      narrationDurationsMs = await measureNarration(segments, narrationRenderSpeed);
      for (let pass = 1; pass <= 4; pass += 1) {
        const spokenTotal = narrationDurationsMs.reduce((sum, value) => sum + value, 0);
        const totalRatio = spokenTotal / spokenTargetTotalMs;
        const sceneRatios = narrationDurationsMs.map((value, index) => value / Math.max(1, targetNarrationMs[index] || value));
        const sceneOutlier = sceneRatios.some((ratio) => ratio < .88 || ratio > 1.12);
        if (totalRatio >= .985 && totalRatio <= 1.005 && !sceneOutlier) break;
        const wordTargets = narrationFitWordTargets(segments, narrationDurationsMs, targetNarrationMs);
        await onStage(`Đang căn kịch bản theo giọng đọc · ${Math.round(spokenTotal / 100) / 10}s → ${Math.round(spokenTargetTotalMs / 100) / 10}s · lượt ${pass}/4`);
        const chunkSize = 12;
        for (let start = 0; start < segments.length; start += chunkSize) {
          const end = Math.min(segments.length, start + chunkSize);
          const current = segments.slice(start, end);
          const measuredChunk = narrationDurationsMs.slice(start, end);
          const targetChunk = targetNarrationMs.slice(start, end);
          const needsRewrite = measuredChunk.some((value, localIndex) => {
            const ratio = value / Math.max(1, targetChunk[localIndex] || value);
            return ratio < .9 || ratio > 1.1;
          });
          if (!needsRewrite) continue;
          const timing = current.map((segment, localIndex) => ({
            scene: start + localIndex + 1,
            currentWords: narrationWordCount([segment]),
            measuredSeconds: Math.round((measuredChunk[localIndex] || 0) / 100) / 10,
            targetSeconds: Math.round((targetChunk[localIndex] || 0) / 100) / 10,
            targetWords: wordTargets[start + localIndex],
          }));
          const fittedRaw = await chat(input.provider, input.model, [{ role: 'system', content: `You are fitting an already approved Vietnamese explainer storyboard to a LOCKED spoken duration using real measured TTS. Return compact JSON only with shape {"segments":[{"narration":"","visualBeats":[{"narrationCue":""}]}]}. Return exactly ${current.length} segments in the same order. Rewrite ONLY narration and narrationCue. Preserve every fact, explanation order, tone and existing visual idea; do not add a new topic that would require a new image. Make each narration natural spoken Vietnamese, not filler. Match each segment targetWords closely (about ±6%) because the current voice was measured, not estimated. Every narrationCue must be a verbatim clause inside its rewritten narration and there must be exactly the same number of cues as existing visual beats. Timing targets: ${JSON.stringify(timing)}. ${toneRule} Return JSON only.` }, { role: 'user', content: JSON.stringify(current.map((segment) => ({ title: segment.title, narration: segment.narration, visualBeats: segment.visualBeats.map((beat) => ({ purpose: beat.purpose, narrationCue: beat.narrationCue, visual: beat.visual })) }))) }], undefined, 16_384);
          const fitted = jsonFromDirectorReply(fittedRaw).segments || [];
          current.forEach((segment, localIndex) => {
            const candidate = fitted[localIndex];
            const narration = String(candidate?.narration || '').trim();
            const candidateBeats = Array.isArray(candidate?.visualBeats) ? candidate!.visualBeats! : [];
            const cues = segment.visualBeats.map((_beat, beatIndex) => String(candidateBeats[beatIndex]?.narrationCue || '').trim());
            if (!narration || cues.length !== segment.visualBeats.length || cues.some((cue) => cue.length < 4 || !narration.includes(cue))) return;
            segments[start + localIndex] = { ...segment, narration, visualBeats: segment.visualBeats.map((beat, beatIndex) => ({ ...beat, narrationCue: cues[beatIndex] })) };
          });
        }
        narrationDurationsMs = await measureNarration(segments);
      }
      let spokenTotal = narrationDurationsMs.reduce((sum, value) => sum + value, 0);
      // When the script is already close, prefer a tiny natural TTS slowdown over
      // failing the whole job or padding several seconds of dead air. This keeps
      // a locked 60s video sounding continuous without forcing another rewrite.
      for (let speedPass = 1; speedPass <= 2 && spokenTotal < spokenTargetTotalMs * .985; speedPass += 1) {
        const ratio = spokenTotal / Math.max(1, spokenTargetTotalMs);
        if (ratio < .9) break;
        const nextSpeed = Math.max(.9, Math.min(narrationRenderSpeed, narrationRenderSpeed * ratio));
        if (Math.abs(nextSpeed - narrationRenderSpeed) < .005) break;
        const previousSpeed = narrationRenderSpeed;
        const previousDurations = narrationDurationsMs;
        const previousTotal = spokenTotal;
        narrationRenderSpeed = nextSpeed;
        await onStage(`Lời đọc còn ngắn nhẹ · tự căn tốc độ ${previousSpeed.toFixed(2)}× → ${narrationRenderSpeed.toFixed(2)}×`);
        const adjustedDurations = await measureNarration(segments, narrationRenderSpeed);
        const adjustedTotal = adjustedDurations.reduce((sum, value) => sum + value, 0);
        if (adjustedTotal > targetMs) {
          narrationRenderSpeed = previousSpeed;
          narrationDurationsMs = previousDurations;
          spokenTotal = previousTotal;
          break;
        }
        narrationDurationsMs = adjustedDurations;
        spokenTotal = adjustedTotal;
      }
      if (spokenTotal < spokenTargetTotalMs * .94) throw new Error(`Kịch bản sau khi đo TTS vẫn quá ngắn: ${Math.round(spokenTotal / 100) / 10}s cho video ${targetDurationSeconds}s. Hệ thống đã thử viết lại và căn tốc độ đọc nhưng vẫn thiếu quá nhiều nội dung.`);
      if (spokenTotal > targetMs) throw new Error(`Kịch bản sau khi đo TTS vẫn dài ${Math.round(spokenTotal / 100) / 10}s so với timeline ${targetDurationSeconds}s. Dừng trước khi tạo ảnh để tránh kéo dài video.`);
      plan = { ...plan, segments: segments.map((segment) => ({ title: segment.title, narration: segment.narration, visualBeats: segment.visualBeats, motionGraphic: segment.motionGraphic })) };
      await onStage(`Đã khóa kịch bản theo TTS thật · lời đọc ${Math.round(spokenTotal / 100) / 10}s / timeline ${targetDurationSeconds}s · tốc độ ${narrationRenderSpeed.toFixed(2)}×`);
    }
    await saveAnimationCheckpoint(checkpointKey, { plan, segments, sceneIds, narrationDurationsMs, narrationRenderSpeed });
  }

  const generationWarnings: string[] = [];
  let allocatedMs = 0;
  const sceneDurationsMs = strictDuration && narrationDurationsMs?.length === segments.length
    ? allocateLockedSceneDurations(narrationDurationsMs, targetMs)
    : segments.map((_segment, index) => {
      const durationMs = index === segments.length - 1 ? Math.max(1, targetMs - allocatedMs) : Math.round((density.sceneDurationsSeconds[index] || 1) * 1000);
      allocatedMs += durationMs;
      return durationMs;
    });
  if (!continuity) generationWarnings.push('Director chưa trả hồ sơ nhất quán; cần kiểm tra thiết kế chủ thể trước khi xuất.');
  const sceneAssets: Array<Array<AnimationAsset | undefined>> = segments.map((segment) => Array(segment.visualBeats.length).fill(undefined));
  if (input.assetGeneration) {
    const assetGeneration = input.assetGeneration;
    const aspect = input.project.width > input.project.height ? '16:9 landscape' : input.project.width < input.project.height ? '9:16 portrait' : '1:1 square';
    const tasks = segments.flatMap((segment, sceneIndex) => segment.visualBeats.map((beat, beatIndex) => ({ segment, beat, sceneIndex, beatIndex })));
    const textBeatIndexes = chooseStoryboardTextBeatIndexes(tasks.map((task) => task.beat), .2);
    // Keep storyboard generation at one image per provider request. Live tests
    // show four single-image requests are stable, while packing two images into
    // each request increases provider latency enough to trigger timeouts.
    const flowBatchSize = 1;
    const workItems: Array<Array<{ taskIndex: number; task: typeof tasks[number] }>> = [];
    for (let start = 0; start < tasks.length; start += flowBatchSize) {
      workItems.push(tasks.slice(start, start + flowBatchSize).map((task, offset) => ({ taskIndex: start + offset, task })));
    }
    const configuredMax = Number(process.env.AUTOSUB_ANIMATION_IMAGE_CONCURRENCY);
    const flowPool = assetGeneration.generator === 'flow-agent' ? await getGoogleFlowImagePoolCapacity() : undefined;
    const flowRecommendedConcurrency = flowPool?.recommendedSlots || 2;
    const maxConcurrency = assetGeneration.generator === 'flow-agent'
      ? Math.max(1, Math.min(flowPool?.isolatedWorkers ? Math.max(1, flowPool.accountCount) : 4, Number.isFinite(configuredMax) && configuredMax > 0 ? Math.round(configuredMax) : flowRecommendedConcurrency))
      : Math.max(2, Math.min(8, Number.isFinite(configuredMax) && configuredMax > 0 ? Math.round(configuredMax) : 4));
    // Isolated mode is one Flow Agent process per linked account, so seven
    // ready accounts mean seven real image lanes. Legacy single-bridge mode
    // keeps the empirically safe four-request ceiling.
    let adaptiveLimit = Math.min(workItems.length, assetGeneration.generator === 'flow-agent' ? Math.min(flowRecommendedConcurrency, maxConcurrency) : Math.min(3, maxConcurrency));
    if (assetGeneration.generator === 'flow-agent' && (assetGeneration.referenceUploadId || assetGeneration.referenceAssetId)) {
      const referenceImagePath = await resolveAnimationGenerationReferencePath(assetGeneration);
      if (referenceImagePath) {
        const targetAccounts = Math.max(1, Math.min(7, flowPool?.accountCount || adaptiveLimit));
        await onStage(`Đang đồng bộ ảnh tham chiếu một lần lên ${targetAccounts} tài khoản Flow song song...`);
        const prewarm = await prewarmGoogleFlowImageReference(referenceImagePath, targetAccounts);
        adaptiveLimit = Math.min(adaptiveLimit, Math.max(1, prewarm.ready.length));
        const elapsed = Math.round(prewarm.elapsedMs / 100) / 10;
        await onStage(`Ảnh tham chiếu đã sẵn sàng trên ${prewarm.ready.length}/${prewarm.attempted} tài khoản sau ${elapsed}s${prewarm.failed.length ? ` · tạm bỏ ${prewarm.failed.length} tài khoản lỗi` : ''}`);
      }
    }
    let flowPauseUntil = 0;
    let cursor = 0;
    let completed = 0;
    let successfulSinceTune = 0;
    let stopError: unknown;
    let lastProgressAt = 0;
    await onStage(`Đang tạo ${tasks.length} ảnh AI · ${flowPool ? `${flowPool.accountCount} tài khoản sẵn sàng · ${adaptiveLimit} request ảnh song song` : `Turbo ${adaptiveLimit} luồng`} · scheduler tự xoay tài khoản khi mỗi ảnh hoàn tất`);

    const buildStoryboardRequest = (entry: { taskIndex: number; task: typeof tasks[number] }) => {
      const { taskIndex, task } = entry;
      const { segment, beat, sceneIndex, beatIndex } = task;
      const cue = beat.narrationCue || segment.narration;
      const beatTextRule = textBeatIndexes.has(taskIndex)
        ? `${textRule} This is one of the small number of text-eligible beats, so text MAY be used only if it materially helps this exact idea. IMPORTANT: the spoken context supplied below is for semantic guidance only and must NEVER be copied, paraphrased or rendered as image text. If you cannot express the useful label within the hard short-text limit, render NO TEXT.`
        : `THIS SHOT MUST BE TEXT-FREE. It is part of the roughly 80% of storyboard beats that communicate visually without words. Render no intentional words, letters, labels, headings, captions, prices, percentages, receipts, signs, UI text or decorative writing. Do not invent pseudo-text. The spoken context below is semantic guidance only and must NEVER appear inside the image.`;
      const request: DirectorAssetRequest = {
        key: `story-scene-${sceneIndex}-beat-${beatIndex}`,
        name: `${segment.title || `Cảnh ${sceneIndex + 1}`} · hình ${beatIndex + 1}`,
        prompt: `${beat.visual}. Create this as one distinct full-frame ${aspect} educational-explainer shot. SPOKEN CONTEXT FOR MEANING ONLY — DO NOT RENDER OR PARAPHRASE THIS SENTENCE AS IMAGE TEXT: “${cue}”. The shot must communicate that idea at a glance and must be meaningfully different from adjacent beats when the narration changes subject, relationship, example, location, scale or explanatory function. Prefer literal visual evidence over generic symbolism. Keep the composition clean enough to read in about 2-3 seconds. Preserve recurring character identity exactly: same head shape, face language, body proportions, clothing silhouette, line weight, world and palette. Do not turn a recurring mascot into chibi, anime, realistic, 3D or any alternate rendering style. ${beatTextRule}`,
        type: 'background',
        tags: ['storyboard', `scene-${sceneIndex + 1}`, `beat-${beatIndex + 1}`, 'atomic-visual'],
        style: requestedStyle || continuity || 'story-matched consistent illustration',
      };
      request.prompt = `${characterReferenceRule}\n${styleRule}\nSHOT CONTENT: ${request.prompt}\nCONTINUITY CONTEXT (lower priority than the attached reference): ${continuity || 'Keep recurring characters and the inferred visual language identical across the whole story.'}`;
      return request;
    };

    const noteFailure = (error: unknown, attempt: number) => {
      const sessionPressure = error instanceof FlowSessionError && ['FLOW_AGENT_OFFLINE', 'FLOW_AGENT_HUNG', 'FLOW_FETCH_FAILED', 'FLOW_SESSION_REFRESH_FAILED'].includes(error.code);
      if (transientImageGenerationError(error) || sessionPressure) {
        if (assetGeneration.generator === 'flow-agent' && flowPool?.isolatedWorkers) {
          // A failed isolated worker is cooled down by googleFlow.ts. Do not
          // throttle the other six independent workers because one account had
          // a timeout/session problem.
          adaptiveLimit = Math.min(maxConcurrency, Math.max(1, flowPool.accountCount));
        } else {
          adaptiveLimit = assetGeneration.generator === 'flow-agent'
            ? Math.max(2, adaptiveLimit - 1)
            : Math.max(1, Math.floor(adaptiveLimit / 2));
          flowPauseUntil = Math.max(flowPauseUntil, Date.now() + Math.min(15_000, 1_500 * Math.max(1, attempt)));
        }
        successfulSinceTune = 0;
      }
    };

    const worker = async (workerIndex: number) => {
      while (!stopError) {
        while (!stopError && workerIndex >= adaptiveLimit && cursor < workItems.length) await new Promise((resolve) => setTimeout(resolve, 80));
        while (!stopError && Date.now() < flowPauseUntil && cursor < workItems.length) await new Promise((resolve) => setTimeout(resolve, 180));
        if (stopError) return;
        const item = workItems[cursor++];
        if (!item) return;
        const requests = item.map(buildStoryboardRequest);
        const first = item[0];
        const last = item[item.length - 1];
        const label = item.length > 1
          ? `Đang xử lý ảnh ${first.taskIndex + 1}-${last.taskIndex + 1}/${tasks.length}`
          : `Đang xử lý ảnh ${first.taskIndex + 1}/${tasks.length}`;
        try {
          const generated = assetGeneration.generator === 'flow-agent' && requests.length > 1
            ? await generateDirectorFlowBatchUntilSuccess({
              requests,
              generation: assetGeneration,
              width: input.project.width,
              height: input.project.height,
              provider: input.provider,
              model: input.model,
              label,
              onStage,
              onFailure: noteFailure,
            })
            : [await generateDirectorAssetUntilSuccess({
              request: requests[0],
              generation: assetGeneration,
              width: input.project.width,
              height: input.project.height,
              provider: input.provider,
              model: input.model,
              label,
              onStage,
              onFailure: noteFailure,
            })];

          generated.forEach((asset, index) => {
            const entry = item[index];
            if (entry) sceneAssets[entry.task.sceneIndex][entry.task.beatIndex] = asset;
          });
          completed += generated.length;
          successfulSinceTune += generated.length;
          if (successfulSinceTune >= Math.max(8, adaptiveLimit * flowBatchSize * 2) && adaptiveLimit < Math.min(maxConcurrency, workItems.length)) {
            adaptiveLimit += 1;
            successfulSinceTune = 0;
          }
        } catch (error) {
          stopError = error;
          return;
        }

        const progressNow = Date.now();
        if (completed === tasks.length || progressNow - lastProgressAt >= 900) {
          lastProgressAt = progressNow;
          try {
            await onStage(`Ảnh ${completed}/${tasks.length} · ${adaptiveLimit} request song song · tới ${Math.min(Math.max(0, tasks.length - completed), adaptiveLimit * flowBatchSize)} ảnh ở đợt kế`);
          } catch (error) { stopError = error; }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrency, workItems.length) }, (_, workerIndex) => worker(workerIndex)));
    if (stopError) throw stopError;
    const missingAfterRetry = segments.reduce((total, segment, sceneIndex) => total + segment.visualBeats.reduce((sceneTotal, beat, beatIndex) => sceneTotal + (beat.visual.trim() && !sceneAssets[sceneIndex][beatIndex] ? 1 : 0), 0), 0);
    if (missingAfterRetry) throw new Error(`Còn ${missingAfterRetry} ảnh AI bắt buộc chưa tạo xong. Project không được hoàn tất để tránh xuất khung đen; các nhịp vector không cần ảnh và vẫn được giữ nguyên.`);
  }
  const generatedSceneAssets = sceneAssets.flat().filter((asset): asset is AnimationAsset => Boolean(asset));
  const allAssets = [...new Map([...assets, ...generatedSceneAssets].map((asset) => [asset.id, asset])).values()];
  const configuredTransition = input.project.transitionPreset || { type: 'cut' as const, durationMs: 0 };
  const transitionPreset = configuredTransition.type === 'cut'
    ? { type: 'cut' as const, durationMs: 0 }
    : { ...configuredTransition, durationMs: Math.max(80, Math.min(2000, configuredTransition.durationMs || 220)) };
  const scenes: CompositeScene[] = segments.map((segment, index) => {
    const durationMs = sceneDurationsMs[index] || 3000; allocatedMs += durationMs;
    const visuals = sceneAssets[index];
    const timeline = buildVisualBeatTimeline({ sceneIndex: index, durationMs, width: input.project.width, height: input.project.height, visuals, beats: segment.visualBeats, narration: segment.narration });
    const performance = buildBeatPerformances({ sceneIndex: index, durationMs, width: input.project.width, height: input.project.height, assets: allAssets, beats: segment.visualBeats, narration: segment.narration });
    if (segment.visualBeats.some((beat, beatIndex) => beat.visual.trim() && !visuals[beatIndex])) generationWarnings.push(`Câu ${index + 1}: thiếu ảnh composition minh họa bắt buộc, cần tạo lại trước khi xuất.`);
    generationWarnings.push(...performance.warnings);
    const combinedLayers = [...timeline.layers, ...performance.layers];
    const layers: SceneLayer[] = combinedLayers.length ? combinedLayers : [{ id: `visual-${index}-0`, name: 'Thiếu hình minh họa', text: 'Chưa có hình minh họa', fontSize: 30, type: 'text' as const, visible: true, locked: false, zIndex: 0, width: Math.round(input.project.width * .62), height: 80, fill: '#ffffff', transform: { ...defaultTransform(), position: { x: input.project.width / 2, y: input.project.height / 2 } } }];
    return { id: sceneIds[index], name: segment.title || `Cảnh ${index + 1}`, order: index, durationMs, narration: segment.narration, transition: index ? transitionPreset : { type: 'cut', durationMs: 0 }, renderMode: 'composite', backgroundColor: '#101218', layers, commands: [...timeline.commands, ...performance.commands], camera: { transform: defaultTransform(), commands: [] } };
  });
  const productionPlan = compileAnimationProductionPlan({ segments, sceneIds, sceneDurationsMs, continuityBible: continuity, diagnostics: generationWarnings });
  let project: AnimationProject = { ...input.project, id: input.project.id || randomUUID(), name: String(plan.name || brief).slice(0, 160), assets: allAssets, scenes, transitionPreset, productionPlan, assetManifest: undefined, styleProfile: { name: input.project.styleProfile?.name || 'AI Storyboard', style: requestedStyle || continuity || 'story-matched illustration with consistent recurring characters', palette: input.project.styleProfile?.palette || [], pacing: input.project.styleProfile?.pacing || 'balanced', tone: requestedTone }, updatedAt: new Date().toISOString(), generationWarnings };
  const issues = validateAnimationProject(project); if (issues.length) throw new Error(issues.slice(0, 8).map((item) => `${item.path}: ${item.message}`).join('; '));
  if (input.narration) project = await generateAnimationNarration({ project, ...input.narration, speed: narrationRenderSpeed, preservePlannedDuration: true, strictSceneDurations: strictDuration }, onStage);
  await onStage('Đang kiểm tra project và tài nguyên');
  project = { ...project, scenes: project.scenes.map((scene) => scene.renderMode !== 'composite' ? scene : {
    ...scene,
    layers: scene.layers.map((layer) => layer.name === 'Voiceover · Subtitle' ? { ...layer, fontSize: Math.max(layer.fontSize || 24, Math.round(Math.min(project.width, project.height) * .044)) } : layer),
    commands: scene.commands.filter((command) => !(command.parameters?.autoVoiceover && scene.commands.some((other) => other.type === 'PLAY_ANIMATION' && other.targetId === command.targetId))),
  }) };
  project.generationWarnings = [...(project.generationWarnings || []), ...checkAnimationQuality(project).filter((issue) => ['UNGROUNDED_MOTION', 'DECORATIVE_MOTION'].includes(issue.code)).map((issue) => issue.message)];
  return withAnimationAssetManifest(project);
}

export async function directAnimationProject(input: DirectAnimationInput, onStage: (stage: string) => Promise<void> = async () => {}) {
  await onStage('Đang kiểm tra đầu vào và lập kế hoạch');
  const brief = String(input.brief || '').trim().slice(0, 20_000);
  if (brief.length < 10) throw new Error('Hãy nhập chủ đề hoặc kịch bản ít nhất 10 ký tự.');
  if (!input.provider || !input.model) throw new Error('Chưa cấu hình provider/model cho AI Director.');
  if (input.assetGeneration?.generator === 'flow-agent') await validateGoogleFlowSession();
  const requestedDurationSeconds = Number(input.targetDurationSeconds);
  const briefDurationSeconds = durationSecondsFromBrief(brief);
  const inputWords = brief.split(/\s+/).filter(Boolean).length;
  const hasUiDuration = Number.isFinite(requestedDurationSeconds) && requestedDurationSeconds > 0;
  const hasBriefDuration = !hasUiDuration && Number.isFinite(briefDurationSeconds) && Number(briefDurationSeconds) > 0;
  const automaticDuration = !hasUiDuration && !hasBriefDuration;
  const strictDuration = hasUiDuration || hasBriefDuration;
  const targetDurationSeconds = hasUiDuration
    ? Math.max(1, Math.round(requestedDurationSeconds))
    : hasBriefDuration
      ? Math.max(1, Math.round(Number(briefDurationSeconds)))
      : inputWords >= 40 ? Math.max(15, Math.min(1200, Math.round(inputWords / 2.25))) : 60;
  if (targetDurationSeconds > 0) {
    const key = animationCheckpointKey({ version: 16, mode: 'ai-image-only-multi-account-flow-pool-reference-locked-static-shot-20pct-short-text-tts-speed-fitted-storyboard', projectId: input.project.id, brief, targetDurationSeconds, automaticDuration, strictDuration, width: input.project.width, height: input.project.height, fps: input.project.fps, style: input.project.styleProfile, provider: input.provider.id, model: input.model, narration: input.narration && { provider: input.narration.provider.id, model: input.narration.model, voice: input.narration.voice, speed: input.narration.speed }, referenceUploadId: input.assetGeneration?.referenceUploadId, referenceAssetId: input.assetGeneration?.referenceAssetId, assets: input.project.assets.map((asset) => ({ id: asset.id, uri: asset.uri, sprite: asset.sprite })) });
    const executionKey = animationCheckpointKey({ key, image: { generator: input.assetGeneration?.generator, provider: input.assetGeneration?.provider?.id, model: input.assetGeneration?.model }, narration: input.narration && { provider: input.narration.provider.id, model: input.narration.model, voice: input.narration.voice, speed: input.narration.speed } });
    return runAnimationOnce(executionKey, () => directLongAnimationProject(input, brief, targetDurationSeconds, strictDuration, key, onStage));
  }
  const library = await listAnimationAssets();
  const combinedAssets = [...library.filter((asset) => !input.project.assets.some((item) => item.id === asset.id)), ...input.project.assets];
  const baseProject = { ...input.project, assets: combinedAssets };
  const assets = combinedAssets.map(({ id, type, name, tags, style, animations }) => ({ id, type, name, tags, style, animations }));
  const system = `You are AutoSub AI Director for editable knowledge animation. Return JSON only with shape {"name":"","assetRequests":[],"scenes":[]}.
Project style profile: ${JSON.stringify(input.project.styleProfile || { name: 'AutoSub default', style: 'clean educational motion graphics', pacing: 'balanced' })}. Obey this visual style, palette and pacing consistently across all scenes.
Create 2-4 short composite scenes, each 2000-8000ms. Use at most 6 visible layers and 8 layer commands per scene. Return compact JSON without indentation. Never return generated-video scenes and never write animation code.
Every scene must exactly follow this TypeScript-compatible structure:
{"id":"unique","name":"","order":0,"durationMs":5000,"narration":"","renderMode":"composite","backgroundColor":"#07111f","layers":[{"id":"unique","name":"","type":"image|sprite|text|shape|diagram|chart|particle|audio","assetId":"optional-existing-id","text":"optional","animation":"optional-sprite-clip","characterId":"stable-id-across-scenes","visible":true,"locked":false,"zIndex":1,"width":300,"height":300,"fill":"#ffffff","fontSize":54,"shape":"rectangle|ellipse","transform":{"position":{"x":540,"y":960},"scale":{"x":1,"y":1},"rotation":0,"opacity":1,"anchor":{"x":0.5,"y":0.5}}}],"commands":[{"id":"unique","type":"MOVE|FADE_IN|FADE_OUT|SCALE|ROTATE|PLAY_ANIMATION|TALK|POINT|LOOK_LEFT|LOOK_RIGHT","targetId":"layer-id","startMs":0,"durationMs":1000,"easing":"linear|ease-in|ease-out|ease-in-out","animation":"optional-catalog-clip","from":{"x":0,"y":0},"to":{"x":1,"y":1}}],"camera":{"transform":{"position":{"x":0,"y":0},"scale":{"x":1,"y":1},"rotation":0,"opacity":1,"anchor":{"x":0.5,"y":0.5}},"commands":[{"id":"unique","type":"ZOOM_IN|ZOOM_OUT|PAN_LEFT|PAN_RIGHT","targetId":"camera","startMs":0,"durationMs":1000,"easing":"ease-in-out","from":{"x":1,"y":1},"to":{"x":1.08,"y":1.08}}]}}.
Use only visual changes justified by the narration. No generic danger icons, question marks, floating arrows, blurry focus circles or mandatory camera movement. Every MOVE/SCALE/ROTATE/PLAY_ANIMATION command needs parameters:{narrationCue:"exact quote from scene narration",motionPurpose:"specific subject and visible change"}. A static establishing shot is valid. Render quantities, routes or comparisons as diagrams only when the actual spoken content calls for them.
Chart layers may include numeric "data" and string "labels" arrays. Diagram layers render directional arrows. Particle layers render procedural effects.
For characters, LOOK_AT commands may use "target" with another layer id; TALK and POINT select matching sprite clips when available. Reuse the same characterId and assetId when a character returns in later scenes.
Audio layers may include startMs, durationMs and volume. Select reusable audio assets by semantic tags and place SFX near matching actions.
Canvas is ${input.project.width}x${input.project.height}. Use assetId values from this catalog: ${JSON.stringify(assets)}. ${input.assetGeneration ? 'If an essential visual is missing, add at most 4 assetRequests shaped as {"key":"temporary-key","name":"","prompt":"single isolated editable visual or clean background, no text","type":"image|background|object|icon|character","tags":[],"style":""}, and reference that temporary key as assetId in layers.' : 'If no suitable asset exists, visualize with editable text/shape/diagram layers; do not invent an assetId.'} Keep titles/subtitles inside safe margins and change visuals every 2-4 seconds. Commands must fit scene duration and target an existing layer. Output concise Vietnamese narration.`;
  const timestamp = new Date().toISOString();
  const assemble = async (raw: string) => {
    const planned = jsonFromDirectorReply(raw);
    if (!Array.isArray(planned.scenes) || !planned.scenes.length) throw new Error('AI Director không trả về scene hợp lệ.');
    const declaredAssets: AnimationAsset[] = (planned.assetRequests || []).filter((request) => request?.key && request.prompt).map((request) => ({ id: request.key, name: request.name || request.key, type: request.type || 'image', uri: 'pending:generation', tags: [], createdAt: timestamp }));
    const preflight = validateAnimationProject({ ...baseProject, productionPlan: undefined, assetManifest: undefined, scenes: planned.scenes, assets: [...new Map([...baseProject.assets, ...declaredAssets].map((asset) => [asset.id, asset])).values()] });
    if (preflight.length) throw new Error(preflight.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    const generated: AnimationProject['assets'] = []; const replacements = new Map<string, string>(); const unavailable = new Set<string>(); const generationWarnings: string[] = [];
    if (input.assetGeneration) for (const [assetIndex, request] of (planned.assetRequests || []).slice(0, 4).entries()) {
      if (!request?.key || !request.prompt) continue;
      const asset = await generateDirectorAssetUntilSuccess({
        request,
        generation: input.assetGeneration,
        width: input.project.width,
        height: input.project.height,
        provider: input.provider,
        model: input.model,
        label: `Tài nguyên ${assetIndex + 1}/${Math.min(4, planned.assetRequests?.length || 0)} · ${request.name || request.key}`,
        onStage,
      });
      generated.push(asset);
      replacements.set(request.key, asset.id);
    }
    const scenes = replaceUnavailableGeneratedAssets(planned.scenes, replacements, unavailable);
    const project: AnimationProject = { ...baseProject, assets: [...new Map([...baseProject.assets, ...generated].map((asset) => [asset.id, asset])).values()], productionPlan: undefined, assetManifest: undefined, id: input.project.id || randomUUID(), name: String(planned.name || brief).slice(0, 160), scenes, updatedAt: timestamp, generationWarnings };
    const issues = validateAnimationProject(project);
    if (issues.length) throw new Error(issues.slice(0, 8).map((item) => `${item.path}: ${item.message}`).join('; '));
    await onStage('Đang kiểm tra project trước khi tạo lời đọc');
    return withAnimationAssetManifest(project);
  };
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [{ role: 'system', content: system }, { role: 'user', content: brief }];
  const raw = await chat(input.provider, input.model, messages, undefined, 16_384);
  let assembled: AnimationProject;
  try { assembled = await assemble(raw); }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    const reason = error instanceof Error ? error.message : String(error);
    const repairRule = directorRepairRule(reason);
    const repaired = await chat(input.provider, input.model, [{ role: 'system', content: `${system}\n${repairRule}` }, { role: 'user', content: `Original brief:\n${brief}\n\nThe previous JSON failed validation:\n${reason}\n\nRegenerate the complete corrected project. Do not explain.` }], undefined, 16_384);
    try { assembled = await assemble(repaired); }
    catch (repairError) { throw new Error(`AI Director đã thử sửa Scene JSON nhưng vẫn chưa hợp lệ: ${repairError instanceof Error ? repairError.message : String(repairError)}`); }
  }
  // TTS errors must not trigger a new planning/image-generation attempt.
  if (input.narration) assembled = await generateAnimationNarration({ project: assembled, ...input.narration }, onStage);
  await onStage('Đang hoàn tất project');
  return withAnimationAssetManifest(assembled);
}

export async function retryMissingAnimationImages(input: { project: AnimationProject; assetGeneration: DirectorAssetGeneration; provider: AIProvider; model: string }, onStage: (stage: string) => Promise<void> = async () => {}) {
  if (input.assetGeneration.generator === 'flow-agent') await validateGoogleFlowSession();
  const plan = input.project.productionPlan;
  if (!plan) throw new Error('Project cũ không có production plan nên không xác định được prompt của ảnh còn thiếu.');
  const imagePlanBeats = plan.beats.filter((beat) => beat.technique === 'image-camera');
  const retryTextLanguage = visualTextLanguage(input.project.scenes.map((scene) => scene.renderMode === 'composite' ? scene.narration : '').join(' '));
  const retryTextRule = visualTextDirective(retryTextLanguage);
  const retryTextBeatIndexes = chooseStoryboardTextBeatIndexes(imagePlanBeats.map((beat) => ({ visual: beat.visibleEvidence, narrationCue: beat.cueText })), .2);
  const tasks = plan.beats.flatMap((beat) => {
    if (beat.technique !== 'image-camera') return [];
    const scene = input.project.scenes.find((item): item is CompositeScene => item.id === beat.sceneId && item.renderMode === 'composite');
    if (!scene) return [];
    const sceneIndex = input.project.scenes.findIndex((item) => item.id === scene.id);
    const sceneBeats = plan.beats.filter((item) => item.sceneId === scene.id && item.technique === 'image-camera');
    const beatIndex = sceneBeats.findIndex((item) => item.id === beat.id);
    const layerId = `visual-${sceneIndex}-${beatIndex}`;
    return scene.layers.some((layer) => layer.id === layerId && layer.type === 'image' && layer.assetId) ? [] : [{ beat, scene, sceneIndex, beatIndex, layerId, beatCount: sceneBeats.length }];
  });
  if (!tasks.length) return { project: input.project, repaired: 0, remaining: 0 };
  let project = input.project;
  let repaired = 0;
  for (const [taskIndex, task] of tasks.entries()) {
    const liveScene = project.scenes.find((item): item is CompositeScene => item.id === task.scene.id && item.renderMode === 'composite');
    if (liveScene?.layers.some((layer) => layer.id === task.layerId && layer.type === 'image' && layer.assetId)) continue;
    const narration = plan.narrationUnits.find((unit) => unit.sceneId === task.scene.id)?.text || task.scene.narration;
    const style = String(project.styleProfile?.style || '').trim();
    const globalBeatIndex = imagePlanBeats.findIndex((beat) => beat.id === task.beat.id);
    const beatTextRule = retryTextBeatIndexes.has(globalBeatIndex)
      ? `${retryTextRule} This repaired shot is text-eligible only if text materially improves the idea. The narration below is context only; never render or paraphrase it as image text. If no short 1-4 word label or compact number is clearly useful, use NO TEXT.`
      : 'THIS REPAIRED SHOT MUST BE TEXT-FREE. Render no intentional words, labels, headings, captions, prices, percentages, receipts, signs, UI text or decorative pseudo-writing. The narration below is semantic context only and must not appear inside the image.';
    const prompt = `${task.beat.visibleEvidence}. Create one distinct full-frame educational-explainer shot for this missing beat. SPOKEN CONTEXT FOR MEANING ONLY — NEVER RENDER OR PARAPHRASE AS IMAGE TEXT: “${narration}”. Keep it meaningfully different from adjacent beats when the explanatory idea changes. Locked continuity: ${plan.continuityBible || style || 'keep recurring characters and visual language consistent'}. ${style ? `User visual style: ${style}.` : ''} ${beatTextRule} Avoid fake UI, watermarks, logos, borders or graphic violence.`;
    const request: DirectorAssetRequest = { key: `retry-${task.beat.id}`, name: `Ảnh sửa · ${task.scene.name} · ${task.beatIndex + 1}`, prompt, type: 'background', tags: ['storyboard', 'repaired', 'atomic-visual', `scene-${task.sceneIndex + 1}`, `shot-${task.beatIndex + 1}`], style: style || undefined };
    const asset = await generateDirectorAssetUntilSuccess({
      request,
      generation: input.assetGeneration,
      width: project.width,
      height: project.height,
      provider: input.provider,
      model: input.model,
      label: `Tạo lại ảnh lỗi ${taskIndex + 1}/${tasks.length} · cảnh ${task.sceneIndex + 1}, nhịp ${task.beatIndex + 1}`,
      onStage,
    });
    const startMs = Math.max(0, Math.min(task.scene.durationMs - 1, Math.round(task.beat.startMs || 0)));
    const endMs = Math.max(startMs + 1, Math.min(task.scene.durationMs, Math.round(task.beat.endMs || task.scene.durationMs)));
    const layer: SceneLayer = { id: task.layerId, name: `Ảnh đã sửa · ${asset.name}`, type: 'image', assetId: asset.id, visible: true, locked: true, zIndex: task.beatIndex, width: project.width, height: project.height, transform: { ...defaultTransform(), opacity: task.beatIndex ? 0 : 1, position: { x: project.width / 2, y: project.height / 2 } } };
    const commands: AnimationCommand[] = [
      ...(task.beatIndex ? [{ id: `visual-in-${task.sceneIndex}-${task.beatIndex}`, type: 'FADE_IN' as const, targetId: task.layerId, startMs, durationMs: 1, easing: 'ease-out' as const }] : []),
      ...(task.beatIndex < task.beatCount - 1 ? [{ id: `visual-out-${task.sceneIndex}-${task.beatIndex}`, type: 'FADE_OUT' as const, targetId: task.layerId, startMs: endMs - 1, durationMs: 1, easing: 'ease-in-out' as const }] : []),
    ];
    project = { ...project, assets: [...project.assets, asset], scenes: project.scenes.map((item) => item.id !== task.scene.id || item.renderMode !== 'composite' ? item : { ...item, layers: [...item.layers.filter((candidate) => candidate.id !== task.layerId && candidate.name !== 'Thiếu hình minh họa'), layer].sort((a, b) => a.zIndex - b.zIndex), commands: [...item.commands.filter((command) => command.targetId !== task.layerId), ...commands] }), updatedAt: new Date().toISOString() };
    repaired += 1;
  }
  const remaining = tasks.filter((task) => {
    const scene = project.scenes.find((item): item is CompositeScene => item.id === task.scene.id && item.renderMode === 'composite');
    return !scene?.layers.some((layer) => layer.id === task.layerId && layer.type === 'image' && layer.assetId);
  }).length;
  if (remaining) throw new Error(`Còn ${remaining} ảnh chưa tạo xong. Không trả project thiếu ảnh để tránh khung đen; hệ thống phải tiếp tục retry hoặc người dùng hủy.`);
  project = { ...project, generationWarnings: (project.generationWarnings || []).filter((warning) => !/Không tạo được ảnh minh họa câu|không tạo được ảnh cảnh|thiếu hình minh họa/i.test(warning)), productionPlan: { ...plan, status: 'ready', diagnostics: (plan.diagnostics || []).filter((warning) => !/không tạo được ảnh|thiếu hình/i.test(warning)) }, assetManifest: undefined };
  return { project: withAnimationAssetManifest(project), repaired, remaining };
}

export async function editAnimationScene(input: { instruction: string; project: AnimationProject; sceneId: string; provider: AIProvider; model: string; mode?: 'edit' | 'animation' | 'visual' }) {
  const instruction = String(input.instruction || '').trim().slice(0, 4000); if (instruction.length < 4) throw new Error('Lệnh chỉnh sửa quá ngắn.');
  const scene = input.project.scenes.find((item) => item.id === input.sceneId); if (!scene || scene.renderMode !== 'composite') throw new Error('Không tìm thấy composite scene cần sửa.');
  const assets = input.project.assets.map(({ id, name, type, tags, style, animations }) => ({ id, name, type, tags, style, animations }));
  const modeRule = input.mode === 'animation' ? 'Change only layer commands and camera commands. Do not change layers, assets, narration, duration or background.' : input.mode === 'visual' ? 'Change only visual properties of existing layers (assetId, text, fill, dimensions, transforms). Preserve every layer id, narration, duration, commands and camera timing.' : 'Apply the smallest change requested.';
  const system = `You edit one AutoSub composite scene. Return the complete edited scene JSON only, no markdown. Preserve IDs unless the instruction requires adding/removing elements. Use only existing assetId from ${JSON.stringify(assets)} and only commands from MOVE, FADE_IN, FADE_OUT, SCALE, ROTATE, PLAY_ANIMATION, TALK, POINT, LOOK_LEFT, LOOK_RIGHT, ZOOM_IN, ZOOM_OUT, PAN_LEFT, PAN_RIGHT. Never return code or a flat video prompt. ${modeRule} Keep commands inside durationMs.`;
  const raw = await chat(input.provider, input.model, [{ role: 'system', content: system }, { role: 'user', content: `Instruction: ${instruction}\n\nCurrent scene:\n${JSON.stringify(scene)}` }], undefined, 6000);
  let edited = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) as AnimationScene;
  if (edited.renderMode === 'composite' && input.mode === 'animation') edited = { ...edited, id: scene.id, name: scene.name, order: scene.order, durationMs: scene.durationMs, narration: scene.narration, backgroundColor: scene.backgroundColor, layers: scene.layers };
  if (edited.renderMode === 'composite' && input.mode === 'visual') edited = { ...edited, id: scene.id, name: scene.name, order: scene.order, durationMs: scene.durationMs, narration: scene.narration, commands: scene.commands, camera: scene.camera, layers: scene.layers.map((original) => { const changed = edited.renderMode === 'composite' ? edited.layers.find((layer) => layer.id === original.id) : undefined; return changed ? { ...changed, id: original.id, zIndex: original.zIndex } : original; }) };
  const project: AnimationProject = { ...input.project, scenes: input.project.scenes.map((item) => item.id === scene.id ? edited : item), updatedAt: new Date().toISOString() };
  const issues = validateAnimationProject(project); if (issues.length) throw new Error(`AI sửa scene không hợp lệ: ${issues.slice(0, 6).map((item) => `${item.path}: ${item.message}`).join('; ')}`); return project;
}

export async function editAnimationProject(input: { instruction: string; project: AnimationProject; provider: AIProvider; model: string }) {
  let project = input.project;
  for (const scene of input.project.scenes.filter((item) => item.renderMode === 'composite').slice(0, 12)) project = await editAnimationScene({ ...input, project, sceneId: scene.id, mode: 'edit' });
  return project;
}

export async function batchDirectAnimationProjects(input: Omit<DirectAnimationInput, 'brief' | 'project'> & { briefs: string[]; template: AnimationProject }) {
  const briefs = (Array.isArray(input.briefs) ? input.briefs : []).map(String).map((item) => item.trim()).filter((item) => item.length >= 10).slice(0, 20); if (!briefs.length) throw new Error('Batch cần ít nhất một chủ đề hợp lệ.');
  const results: Array<{ brief: string; status: 'completed' | 'failed'; project?: AnimationProject; error?: string }> = [];
  for (const brief of briefs) { try { const now = new Date().toISOString(); const base = { ...input.template, id: randomUUID(), name: brief.slice(0, 120), scenes: [], createdAt: now, updatedAt: now }; const project = await directAnimationProject({ brief, project: base, provider: input.provider, model: input.model, assetGeneration: input.assetGeneration, targetDurationSeconds: input.targetDurationSeconds, narration: input.narration }); results.push({ brief, status: 'completed', project: await saveAnimationProject(project) }); } catch (error) { results.push({ brief, status: 'failed', error: error instanceof Error ? error.message : String(error) }); } }
  return { total: briefs.length, completed: results.filter((item) => item.status === 'completed').length, failed: results.filter((item) => item.status === 'failed').length, results };
}
