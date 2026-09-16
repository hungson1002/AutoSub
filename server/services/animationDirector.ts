import { normalizeSpriteRequests } from './animationSpriteGeneration';
import { buildAnimatedObjects, normalizeAnimatedObjects, type AnimatedObject } from './animationObjects';
import { randomUUID } from 'node:crypto';
import type { AnimationAsset, AnimationCommand, AnimationProject, AnimationScene, CompositeScene, SceneLayer } from '../../shared/animationStudio';
import { defaultTransform, validateAnimationProject } from '../../shared/animationStudio';
import { chat } from '../adapters';
import type { AIProvider } from '../types';
import { generateAnimationAsset, generateAnimationNarration, generateFlowAnimationAssetBatch, listAnimationAssets } from './animationAssets';
import { saveAnimationProject } from './animationProjects';
import { FlowSessionError, validateGoogleFlowSession } from './googleFlow';
import { animationCraftRules } from './directorKnowledge';
import { checkAnimationQuality } from './animationQuality';
import { buildAnimationBeatWindows } from './animationTiming';
import { compileAnimationProductionPlan } from './animationPlan';
import { withAnimationAssetManifest } from './animationManifest';
import { animationCheckpointKey, loadAnimationCheckpoint, saveAnimationCheckpoint, runAnimationOnce } from './animationCheckpoint';

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
type DirectorReply = { spriteRequests?: unknown; characterRequests?: Array<{ key: string; name: string; kind: 'stick' | 'robot'; color?: string }>; characterOptions?: Array<{ name?: string; prompt?: string }>; name?: string; continuityBible?: string; scenes?: AnimationScene[]; segments?: DirectorSegment[]; assetRequests?: Array<{ key: string; name: string; prompt: string; type?: 'image' | 'background' | 'object' | 'icon' | 'character'; tags?: string[]; style?: string }> };

export type LongAnimationSegment = {
  title: string;
  narration: string;
  visualBeats: Array<{ narrationCue?: string; action?: string; purpose: string; visual: string; motion: VisualBeatMotion; transition: VisualBeatTransition; objects?: AnimatedObject[]; actors?: BeatActor[]; diagram?: BeatDiagram }>;
  motionGraphic: 'particle' | 'path' | 'focus' | 'none';
};

type DirectorAssetRequest = NonNullable<DirectorReply['assetRequests']>[number];

const narrationWordCount = (segments: Array<{ narration?: string }>) => segments.reduce((total, segment) => total + String(segment.narration || '').trim().split(/\s+/u).filter(Boolean).length, 0);

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
  // A scene is one stable composition. Two adjacent meaningful beats usually
  // reuse that composition with camera/highlight motion instead of buying a new image.
  const sceneCount = Math.ceil(visualCount / 2);
  const visualsPerScene = Array.from({ length: sceneCount }, (_, index) => Math.min(2, visualCount - index * 2));
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
      motion: motions.has(beat?.motion as VisualBeatMotion) ? beat.motion as VisualBeatMotion : (['push', 'pan-right', 'pull', 'pan-left'][beatIndex % 4] as VisualBeatMotion),
      transition: transitions.has(beat?.transition as VisualBeatTransition) ? beat.transition as VisualBeatTransition : 'crossfade' as const,
      objects: normalizeAnimatedObjects(beat.objects),
      actors: Array.isArray(beat.actors) ? beat.actors.filter((actor) => actor && typeof actor.assetId === 'string' && typeof actor.animation === 'string' && [actor.fromX, actor.toX, actor.y].every((value) => Number.isFinite(value) && value >= .1 && value <= .9)).slice(0, 3) : undefined,
      diagram: Array.isArray(beat.diagram?.steps) ? { steps: beat.diagram.steps.filter((text) => typeof text === 'string' && text.trim()).map((text) => text.trim().slice(0, 80)).slice(0, beat.diagram.layout === 'comparison' ? 2 : 3), layout: beat.diagram.layout === 'comparison' ? 'comparison' as const : 'process' as const } : undefined,
    })).filter((beat) => beat.visual || beat.objects?.length || beat.actors?.length || beat.diagram?.steps.length);
    for (const visual of legacyVisuals) if (!beats.some((beat) => beat.visual === visual)) beats.push({ purpose: 'Minh họa bổ sung', visual, motion: beats.length % 2 ? 'pull' : 'push', transition: 'crossfade' });
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
    const transitionMs = beat?.transition === 'cut' ? 90 : Math.min(380, Math.max(180, Math.round(beatDuration * .11)));
    const locked = beat?.motion === 'locked';
    const baseScale = locked ? 1 : beat?.motion?.startsWith('pan-') || beat?.motion?.startsWith('drift-') ? 1.09 : 1.03;
    layers.push({ id, name: `${beat?.purpose || 'Nhịp hình'} · ${visual.name}`, type: 'image', assetId: visual.id, visible: true, locked: true, zIndex: beatIndex, width: locked ? width : Math.round(width * 1.08), height: locked ? height : Math.round(height * 1.08), transform: { ...defaultTransform(), opacity: beatIndex ? 0 : 1, scale: { x: baseScale, y: baseScale }, position: { x: width / 2, y: height / 2 } } });
    if (beatIndex > 0) commands.push({ id: `visual-in-${sceneIndex}-${beatIndex}`, type: 'FADE_IN', targetId: id, startMs, durationMs: transitionMs, easing: 'ease-out' });
    if (beatIndex < count - 1) commands.push({ id: `visual-out-${sceneIndex}-${beatIndex}`, type: 'FADE_OUT', targetId: id, startMs: Math.min(durationMs - 1, endMs + Math.min(380, Math.max(180, Math.round((durationMs / count) * .11)))), durationMs: 1, easing: 'ease-in-out' });
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

async function directLongAnimationProject(input: DirectAnimationInput, brief: string, targetDurationSeconds: number, _automaticDuration: boolean, checkpointKey: string, onStage: (stage: string) => Promise<void>) {
  const library = await listAnimationAssets();
  const assets = [...library.filter((asset) => !input.project.assets.some((item) => item.id === asset.id)), ...input.project.assets];
  const density = buildVisualDensityPlan(targetDurationSeconds);
  const sceneCount = density.sceneCount;
  const visualsPerScene = density.visualsPerScene;
  const targetWords = Math.round(targetDurationSeconds * 2.25);
  const hasCharacterReference = Boolean(input.assetGeneration?.referenceUploadId || input.assetGeneration?.referenceAssetId);
  const storyRules = `STORYBOARD CONTRACT: turn the user's input into a narrated visual story. If it is already a detailed script, preserve its facts, order and intent while making it natural to speak. If it is only a premise, invent a complete coherent script. Each segment is one coherent visual idea and may contain one or two short related narration sentences. Do not create a new composition for every sentence or phrase. A segment's visualBeats are meaningful internal changes within the same composition: change focus with a gentle push, pull or pan while keeping the same subjects, setting and visual grammar. All visualBeats inside one segment must describe one reusable full-frame composition containing the elements needed for those internal changes. narrationCue must be the exact clause where the focus changes. The first 15 seconds may move at 2-2.5 seconds per beat; the main explanation should stay near 2.5-3.5 seconds. Important comparisons or mechanism explanations may use a longer held beat. Never exceed 25 meaningful visual changes per minute except a deliberate short montage. Return a continuityBible that locks the art style, recurring characters, clothing, proportions, color palette and world. ${hasCharacterReference ? 'A selected character reference image will be supplied to the image generator: treat that identity and its art style as immutable, and design every other character in the same visual universe.' : 'A selected AI character design will be supplied to the image generator and is the immutable identity/style anchor.'} Images must have no captions, subtitles, labels, logos, UI cards or baked-in text. Prefer comprehension over constant cutting.`;
  brief = `${brief}\n\n${storyRules}`;
  const checkpoint = await loadAnimationCheckpoint<{ plan: DirectorReply; segments: LongAnimationSegment[]; sceneIds: string[] }>(checkpointKey);
  let plan: DirectorReply;
  let segments: LongAnimationSegment[];
  let continuity: string;
  let sceneIds: string[];
  if (checkpoint) {
    plan = checkpoint.plan;
    segments = checkpoint.segments;
    sceneIds = checkpoint.sceneIds;
    if (!Array.isArray(segments) || segments.length !== sceneCount || sceneIds.length !== segments.length) throw new Error('Checkpoint animation không hợp lệ; không tự tạo lại tài nguyên.');
    continuity = String(plan.continuityBible || '').trim().slice(0, 1800);
  } else {
    const chunks = Math.ceil(sceneCount / 20);
    const plannedSegments: DirectorSegment[] = [];
    plan = { segments: [] };
    continuity = '';
    for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
      const chunkSize = Math.min(20, sceneCount - plannedSegments.length);
      const chunkVisualCounts = visualsPerScene.slice(plannedSegments.length, plannedSegments.length + chunkSize);
      await onStage(`Đang viết storyboard ${chunkIndex + 1}/${chunks}`);
      const prior = plannedSegments.at(-1);
      const planRaw = await chat(input.provider, input.model, [{ role: 'system', content: `You are a storyboard director. Return compact JSON only: {"name":"","continuityBible":"","segments":[{"title":"","narration":"one coherent visual idea in one or two short related sentences","visualBeats":[{"purpose":"hook|explain|comparison|mechanism|payoff","narrationCue":"exact focus-change clause from narration","visual":"the same reusable composition prompt for this segment","motion":"push|pull|pan-left|pan-right|locked","transition":"crossfade"}],"motionGraphic":"none"}]}. This is chunk ${chunkIndex + 1}/${chunks}; create exactly ${chunkSize} consecutive visual ideas, covering positions ${plannedSegments.length + 1}-${plannedSegments.length + chunkSize} of ${sceneCount}, and about ${Math.round(targetWords * chunkSize / sceneCount)} spoken words. The required meaningful visualBeat count for each returned segment, in order, is exactly [${chunkVisualCounts.join(', ')}]. Beats within one segment reuse one composition and alter focus through motion; they are not separate image prompts. ${chunkIndex === 0 ? 'Only the first 15 seconds may use the faster hook pace.' : `Continue directly after: ${prior?.narration || ''}`} ${chunkIndex === chunks - 1 ? 'Resolve the idea in the final segment.' : 'Do not conclude the story yet.'} ${continuity ? `Use this immutable continuityBible verbatim: ${continuity}` : 'Infer and return one detailed continuityBible from the user input and selected character reference.'} Do not force a white background or predetermined art style. No text inside images.\n\n${storyRules}` }, { role: 'user', content: brief }], undefined, 16_384);
      let chunk = jsonFromDirectorReply(planRaw);
      const chunkTargetWords = Math.round(targetWords * chunkSize / sceneCount);
      if (narrationWordCount((chunk.segments || []).slice(0, chunkSize)) < chunkTargetWords * .88) {
        const expandedRaw = await chat(input.provider, input.model, [{ role: 'system', content: `The storyboard narration is too short for the requested video duration. Return the same compact JSON shape with exactly ${chunkSize} segments and ${chunkTargetWords - Math.round(chunkTargetWords * .04)}-${chunkTargetWords + Math.round(chunkTargetWords * .04)} total Vietnamese spoken words. Preserve facts, order and continuity, but add useful explanation rather than filler. Keep exactly [${chunkVisualCounts.join(', ')}] visualBeats per segment; every narrationCue must be an exact atomic clause from its expanded narration. Return JSON only.` }, { role: 'user', content: JSON.stringify(chunk) }], undefined, 16_384);
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
    visualBeats: segment.visualBeats.filter((beat) => beat.visual.trim()).slice(0, expectedCounts[index] || 1).map((beat, beatIndex) => ({
      ...beat,
      motion: beat.motion === 'locked' ? (beatIndex % 2 ? 'pan-right' as const : 'push' as const) : beat.motion,
      transition: 'crossfade' as const,
      objects: undefined,
      actors: undefined,
      diagram: undefined,
    })),
    motionGraphic: 'none' as const,
  }));
  segments = asStoryboard(segments);
  if (segments.some((segment, index) => segment.visualBeats.length !== visualsPerScene[index])) {
    for (const [index, segment] of segments.entries()) {
      const expectedCount = visualsPerScene[index] || 1;
      if (segment.visualBeats.length === expectedCount) continue;
      const repaired = jsonFromDirectorReply(await chat(input.provider, input.model, [{ role: 'system', content: `Repair one storyboard segment. Keep its title and narration verbatim. Return JSON with one segments item containing exactly ${expectedCount} meaningful visualBeats inside one reusable composition. Each narrationCue is an exact different focus-change clause; do not invent a new image for each clause. Preserve this continuityBible: ${continuity}. Return no text in images. ${storyRules}` }, { role: 'user', content: JSON.stringify(segment) }], undefined, 8192));
      const [candidate] = asStoryboard(normalizeLongAnimationSegments(repaired, 1), [expectedCount]);
      if (candidate?.narration === segment.narration && candidate.visualBeats.length === expectedCount) segments[index] = candidate;
    }
  }
  if (segments.length < sceneCount) throw new Error(`AI Director chỉ trả về ${segments.length}/${sceneCount} cảnh. Hãy thử dựng lại để bảo đảm đủ nhịp hình và thời lượng.`);
  if (segments.some((segment, index) => segment.visualBeats.length !== visualsPerScene[index])) throw new Error('Director chưa trả đủ mật độ hình theo atomic idea. Hãy tiếp tục job để sửa các cảnh còn thiếu thay vì kéo dài một ảnh quá 3 giây.');
  if (narrationWordCount(segments) < targetWords * .8) throw new Error(`AI Director viết narration quá ngắn (${narrationWordCount(segments)}/${targetWords} từ) so với thời lượng ${Math.round(targetDurationSeconds / 60 * 10) / 10} phút. Project chưa được tạo để tránh xuất video ngắn sai yêu cầu; hãy tiếp tục job để AI viết lại đủ nội dung.`);
    sceneIds = segments.map(() => randomUUID());
    await saveAnimationCheckpoint(checkpointKey, { plan, segments, sceneIds });
  }
  const generationWarnings: string[] = [];
  const targetMs = targetDurationSeconds * 1000;
  let allocatedMs = 0;
  const sceneDurationsMs = segments.map((_segment, index) => {
    const durationMs = index === segments.length - 1 ? Math.max(1, targetMs - allocatedMs) : Math.round((density.sceneDurationsSeconds[index] || 1) * 1000);
    allocatedMs += durationMs;
    return durationMs;
  });
  if (!continuity) generationWarnings.push('Director chưa trả hồ sơ nhất quán; cần kiểm tra thiết kế chủ thể trước khi xuất.');
  const sceneAssets: Array<Array<AnimationAsset | undefined>> = segments.map((segment) => Array(segment.visualBeats.length).fill(undefined));
  if (input.assetGeneration) {
    const assetGeneration = input.assetGeneration;
    const aspect = input.project.width > input.project.height ? '16:9 landscape' : input.project.width < input.project.height ? '9:16 portrait' : '1:1 square';
    const tasks = segments.map((segment, index) => ({ segment, index }));
    const concurrency = assetGeneration.generator === 'flow-agent' ? 4 : 2;
    let cursor = 0;
    let completed = 0;
    let stopError: unknown;
    await onStage(`Đang tạo ${tasks.length} ảnh cảnh · tối đa ${Math.min(concurrency, tasks.length)} ảnh đồng thời`);
    const worker = async () => {
      while (!stopError) {
        const task = tasks[cursor++];
        if (!task) return;
        const { segment, index } = task;
        const composition = [...new Set(segment.visualBeats.map((beat) => beat.visual.trim()).filter(Boolean))].join('. Internal focus areas: ');
        const request: DirectorAssetRequest = { key: `story-scene-${index}`, name: segment.title || `Minh họa cảnh ${index + 1}`, prompt: `${composition}. Create one reusable full-frame ${aspect} composition containing the subjects and details needed for every focus change in this coherent idea. Match the narration: “${segment.narration}”. Preserve recurring character identity, clothing, proportions, world, palette and art style. No text, captions, labels, cards, borders, logos or UI.`, type: 'background', tags: ['storyboard', `scene-${index + 1}`, 'reusable-composition'], style: 'story-matched consistent illustration' };
        request.prompt = `LOCKED CHARACTER AND VISUAL CONTINUITY: ${continuity || 'Keep the selected character and inferred art style identical across the whole story.'}\n${request.prompt}`;
        try {
          const asset = await generateDirectorAsset(request, assetGeneration, input.project.width, input.project.height);
          sceneAssets[index] = sceneAssets[index].map(() => asset);
        }
        catch (error) {
          generationWarnings.push(`Không tạo được ảnh minh họa câu ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof FlowSessionError) {
            generationWarnings.push('Đã ngừng tạo ảnh do lỗi phiên Flow. Kịch bản và prompt từng câu vẫn được giữ để thử lại; không lấy ảnh không liên quan thay thế.');
            stopError = error;
          }
        }
        completed += 1;
        try { await onStage(`Composition ${index + 1}/${segments.length} · đã xong ${completed}/${tasks.length}`); }
        catch (error) { stopError = error; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
    if (stopError && !(stopError instanceof FlowSessionError)) throw stopError;
  }
  const generatedSceneAssets = sceneAssets.flat().filter((asset): asset is AnimationAsset => Boolean(asset));
  const allAssets = [...new Map([...assets, ...generatedSceneAssets].map((asset) => [asset.id, asset])).values()];
  const scenes: CompositeScene[] = segments.map((segment, index) => {
    const durationMs = sceneDurationsMs[index] || 3000; allocatedMs += durationMs;
    const visuals = sceneAssets[index];
    const timeline = buildVisualBeatTimeline({ sceneIndex: index, durationMs, width: input.project.width, height: input.project.height, visuals, beats: segment.visualBeats, narration: segment.narration });
    if (visuals.some((visual) => !visual)) generationWarnings.push(`Câu ${index + 1}: thiếu ảnh composition minh họa, cần tạo lại trước khi xuất.`);
    const layers: SceneLayer[] = timeline.layers.length ? timeline.layers : [{ id: `visual-${index}-0`, name: 'Thiếu hình minh họa', text: 'Chưa có hình minh họa', fontSize: 30, type: 'text' as const, visible: true, locked: false, zIndex: 0, width: Math.round(input.project.width * .62), height: 80, fill: '#ffffff', transform: { ...defaultTransform(), position: { x: input.project.width / 2, y: input.project.height / 2 } } }];
    return { id: sceneIds[index], name: segment.title || `Cảnh ${index + 1}`, order: index, durationMs, narration: segment.narration, transition: { type: index ? 'crossfade' : 'cut', durationMs: index ? 320 : 0 }, renderMode: 'composite', backgroundColor: '#101218', layers, commands: timeline.commands, camera: { transform: defaultTransform(), commands: [] } };
  });
  const productionPlan = compileAnimationProductionPlan({ segments, sceneIds, sceneDurationsMs, continuityBible: continuity, diagnostics: generationWarnings });
  let project: AnimationProject = { ...input.project, id: input.project.id || randomUUID(), name: String(plan.name || brief).slice(0, 160), assets: allAssets, scenes, productionPlan, assetManifest: undefined, styleProfile: { name: 'AI Storyboard', style: continuity || 'story-matched illustration with consistent recurring characters', palette: input.project.styleProfile?.palette || [], pacing: 'balanced' }, updatedAt: new Date().toISOString(), generationWarnings };
  const issues = validateAnimationProject(project); if (issues.length) throw new Error(issues.slice(0, 8).map((item) => `${item.path}: ${item.message}`).join('; '));
  if (input.narration) project = await generateAnimationNarration({ project, ...input.narration, preservePlannedDuration: true }, onStage);
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
  const inputWords = brief.split(/\s+/).filter(Boolean).length;
  const automaticDuration = !Number.isFinite(requestedDurationSeconds) || requestedDurationSeconds <= 0;
  const targetDurationSeconds = !automaticDuration
    ? Math.max(1, Math.round(requestedDurationSeconds))
    : inputWords >= 40 ? Math.max(15, Math.min(1200, Math.round(inputWords / 2.25))) : 60;
  if (targetDurationSeconds > 0) {
    const key = animationCheckpointKey({ version: 6, mode: 'paced-reusable-compositions', projectId: input.project.id, brief, targetDurationSeconds, automaticDuration, width: input.project.width, height: input.project.height, fps: input.project.fps, style: input.project.styleProfile, provider: input.provider.id, model: input.model, referenceUploadId: input.assetGeneration?.referenceUploadId, referenceAssetId: input.assetGeneration?.referenceAssetId, assets: input.project.assets.map((asset) => ({ id: asset.id, uri: asset.uri, sprite: asset.sprite })) });
    const executionKey = animationCheckpointKey({ key, image: { generator: input.assetGeneration?.generator, provider: input.assetGeneration?.provider?.id, model: input.assetGeneration?.model }, narration: input.narration && { provider: input.narration.provider.id, model: input.narration.model, voice: input.narration.voice, speed: input.narration.speed } });
    return runAnimationOnce(executionKey, () => directLongAnimationProject(input, brief, targetDurationSeconds, automaticDuration, key, onStage));
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
    let sessionUnavailable = false;
    if (input.assetGeneration) for (const request of (planned.assetRequests || []).slice(0, 4)) {
      await onStage(`Đang tạo tài nguyên: ${request.name || request.key}`);
      if (!request?.key || !request.prompt) continue;
      if (sessionUnavailable) { unavailable.add(request.key); continue; }
      try { const asset = await generateDirectorAsset(request, input.assetGeneration, input.project.width, input.project.height); generated.push(asset); replacements.set(request.key, asset.id); }
      catch (error) { unavailable.add(request.key); generationWarnings.push(`Không tạo được asset “${request.name || request.key}”: ${error instanceof Error ? error.message : String(error)}`); if (error instanceof FlowSessionError) sessionUnavailable = true; }
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
  const failures: string[] = [];
  const processedScenes = new Set<string>();
  for (const [taskIndex, task] of tasks.entries()) {
    if (processedScenes.has(task.scene.id)) continue;
    processedScenes.add(task.scene.id);
    const liveScene = project.scenes.find((item): item is CompositeScene => item.id === task.scene.id && item.renderMode === 'composite');
    if (liveScene?.layers.some((layer) => layer.id === task.layerId && layer.type === 'image' && layer.assetId)) continue;
    const compositionTasks = tasks.filter((candidate) => candidate.scene.id === task.scene.id);
    await onStage(`Tạo lại ảnh lỗi ${taskIndex + 1}/${tasks.length}`);
    const narration = plan.narrationUnits.find((unit) => unit.sceneId === task.scene.id)?.text || task.scene.narration;
    let prompt = `${[...new Set(compositionTasks.map((candidate) => candidate.beat.visibleEvidence))].join('. Internal focus areas: ')}. Create one reusable full-frame composition for these related focus changes, matching this narration: “${narration}”. Locked continuity: ${plan.continuityBible || project.styleProfile?.style || 'keep characters and art style consistent'}. No text, captions, logos, UI, borders or graphic violence.`;
    let asset: AnimationAsset | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2 && !asset; attempt += 1) {
      try {
        asset = await generateDirectorAsset({ key: `retry-${task.beat.id}`, name: `Ảnh sửa · ${task.scene.name} · ${task.beatIndex + 1}`, prompt, type: 'background', tags: ['storyboard', 'repaired', `scene-${task.sceneIndex + 1}`, `shot-${task.beatIndex + 1}`], style: project.styleProfile?.style }, input.assetGeneration, project.width, project.height);
      } catch (error) {
        lastError = error;
        if (/UNSAFE_GENERATION|INVALID_ARGUMENT/i.test(error instanceof Error ? error.message : String(error))) {
          const rewritten = await chat(input.provider, input.model, [{ role: 'system', content: 'Rewrite the supplied image prompt into one family-safe, non-graphic visual metaphor accepted by a general image generator. Preserve the educational meaning, recurring character identity and setting. Remove violence, injury, weapons, sexual content and unsafe wording. Return only the rewritten English prompt.' }, { role: 'user', content: prompt }], undefined, 2048);
          prompt = rewritten.trim().slice(0, 4000);
          continue;
        }
        if (!/timed out waiting/i.test(error instanceof Error ? error.message : String(error))) break;
      }
    }
    if (!asset) {
      const detail = lastError instanceof Error ? lastError.message : String(lastError);
      failures.push(`Câu ${task.sceneIndex + 1}, ảnh ${task.beatIndex + 1}: ${detail}`);
      if (lastError instanceof FlowSessionError) break;
      continue;
    }
    const layers: SceneLayer[] = compositionTasks.map((candidate) => ({ id: candidate.layerId, name: `Ảnh đã sửa · ${asset.name}`, type: 'image', assetId: asset.id, visible: true, locked: true, zIndex: candidate.beatIndex, width: project.width, height: project.height, transform: { ...defaultTransform(), opacity: candidate.beatIndex ? 0 : 1, position: { x: project.width / 2, y: project.height / 2 } } }));
    const layerIds = new Set(layers.map((layer) => layer.id));
    const commands: AnimationCommand[] = compositionTasks.flatMap((candidate) => {
      const startMs = Math.max(0, Math.min(candidate.scene.durationMs - 1, Math.round(candidate.beat.startMs || 0)));
      const endMs = Math.max(startMs + 1, Math.min(candidate.scene.durationMs, Math.round(candidate.beat.endMs || candidate.scene.durationMs)));
      return [
        ...(candidate.beatIndex ? [{ id: `visual-in-${candidate.sceneIndex}-${candidate.beatIndex}`, type: 'FADE_IN' as const, targetId: candidate.layerId, startMs, durationMs: Math.min(320, endMs - startMs), easing: 'ease-out' as const }] : []),
        ...(candidate.beatIndex < candidate.beatCount - 1 ? [{ id: `visual-out-${candidate.sceneIndex}-${candidate.beatIndex}`, type: 'FADE_OUT' as const, targetId: candidate.layerId, startMs: endMs - 1, durationMs: 1, easing: 'ease-in-out' as const }] : []),
      ];
    });
    project = { ...project, assets: [...project.assets, asset], scenes: project.scenes.map((item) => item.id !== task.scene.id || item.renderMode !== 'composite' ? item : { ...item, layers: [...item.layers.filter((candidate) => !layerIds.has(candidate.id) && candidate.name !== 'Thiếu hình minh họa'), ...layers].sort((a, b) => a.zIndex - b.zIndex), commands: [...item.commands.filter((command) => !layerIds.has(command.targetId)), ...commands] }), updatedAt: new Date().toISOString() };
    repaired += compositionTasks.length;
  }
  const remaining = tasks.length - repaired;
  project = { ...project, generationWarnings: [...(project.generationWarnings || []).filter((warning) => !/Không tạo được ảnh minh họa câu|thiếu hình minh họa/i.test(warning)), ...failures, ...(remaining ? [`Còn ${remaining} ảnh minh họa chưa tạo được. Hãy xác minh lại Google Flow rồi bấm tạo lại lần nữa.`] : [])], productionPlan: { ...plan, status: remaining ? 'warning' : 'ready', diagnostics: failures.length ? failures : undefined }, assetManifest: undefined };
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
