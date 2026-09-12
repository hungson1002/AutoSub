import { generateAnimationSprite, normalizeSpriteRequests } from './animationSpriteGeneration';
import { buildAnimatedObjects, normalizeAnimatedObjects, animationObjectRules, type AnimatedObject } from './animationObjects';
import { randomUUID } from 'node:crypto';
import type { AnimationAsset, AnimationCommand, AnimationProject, AnimationScene, CompositeScene, SceneLayer } from '../../shared/animationStudio';
import { defaultTransform, validateAnimationProject } from '../../shared/animationStudio';
import { chat } from '../adapters';
import type { AIProvider } from '../types';
import { generateAnimationAsset, generateAnimationNarration, listAnimationAssets } from './animationAssets';
import { saveAnimationProject } from './animationProjects';
import { FlowSessionError, validateGoogleFlowSession } from './googleFlow';
import { animationCraftRules } from './directorKnowledge';
import { checkAnimationQuality } from './animationQuality';
import { createProceduralCharacter } from './animationCharacters';
import { buildAnimationBeatWindows } from './animationTiming';
import { compileAnimationProductionPlan } from './animationPlan';
import { withAnimationAssetManifest } from './animationManifest';
import { animationCheckpointKey, loadAnimationCheckpoint, saveAnimationCheckpoint, runAnimationOnce } from './animationCheckpoint';

export type DirectorAssetGeneration = { provider?: AIProvider; model?: string; generator?: 'flow-agent' };

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
type DirectorReply = { spriteRequests?: unknown; characterRequests?: Array<{ key: string; name: string; kind: 'stick' | 'robot'; color?: string }>; name?: string; continuityBible?: string; scenes?: AnimationScene[]; segments?: DirectorSegment[]; assetRequests?: Array<{ key: string; name: string; prompt: string; type?: 'image' | 'background' | 'object' | 'icon' | 'character'; tags?: string[]; style?: string }> };

export type LongAnimationSegment = {
  title: string;
  narration: string;
  visualBeats: Array<{ narrationCue?: string; action?: string; purpose: string; visual: string; motion: VisualBeatMotion; transition: VisualBeatTransition; objects?: AnimatedObject[]; actors?: BeatActor[]; diagram?: BeatDiagram }>;
  motionGraphic: 'particle' | 'path' | 'focus' | 'none';
};

type DirectorAssetRequest = NonNullable<DirectorReply['assetRequests']>[number];

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
  return generateAnimationAsset({ prompt: request.prompt, name: request.name, type: request.type || 'image', tags: request.tags, style: request.style, provider: generation.provider, model: generation.model, generator: generation.generator, width, height });
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
  const windows = buildAnimationBeatWindows({ beats, narration: input.narration, durationMs });
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
    const baseScale = beat?.motion?.startsWith('pan-') || beat?.motion?.startsWith('drift-') ? 1.09 : 1.03;
    layers.push({ id, name: `${beat?.purpose || 'Nhịp hình'} · ${visual.name}`, type: 'image', assetId: visual.id, visible: true, locked: true, zIndex: beatIndex, width: Math.round(width * 1.08), height: Math.round(height * 1.08), transform: { ...defaultTransform(), opacity: beatIndex ? 0 : 1, scale: { x: baseScale, y: baseScale }, position: { x: width / 2, y: height / 2 } } });
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

async function directLongAnimationProject(input: DirectAnimationInput, brief: string, targetDurationSeconds: number, checkpointKey: string, onStage: (stage: string) => Promise<void>) {
  const library = await listAnimationAssets();
  const assets = [...library.filter((asset) => !input.project.assets.some((item) => item.id === asset.id)), ...input.project.assets];
  const sceneCount = Math.max(4, Math.min(24, Math.ceil(targetDurationSeconds / 10)));
  const targetWords = Math.round(targetDurationSeconds * 2.35);
  const spriteCatalog = assets.filter((asset) => asset.sprite).map((asset) => ({ id: asset.id, name: asset.name, tags: asset.tags, clips: Object.keys(asset.sprite!.clips) }));
  const performanceRules = `Every visualBeat MUST include narrationCue (an exact contiguous quote of at least 4 characters from that segment narration) and action (the specific visible subject and before/after change explaining that quote). Decorative emphasis is not an action. No generic floating pointer, blur circle or particles. Do not add motion just to satisfy a quota; an honest still is allowed. ${animationObjectRules}\nIMPLEMENTATION CONTRACT: Return an explicit continuityBible string in the root JSON, not only private reasoning. Lock one visual medium/style, species anatomy, body proportions, colors and recurring locations. Never mix photorealism with cartoon illustration or substitute unrelated animals. Project style: ${input.project.styleProfile?.style || 'cohesive 2D educational illustration'}.
If a recurring character needs real pose animation and no suitable sprite is in the catalog, include root spriteRequests:[{key:"unique_key",name:"character name",design:"detailed immutable anatomy, costume, proportions, palette and 2D style",clips:["walk","talk"]}]. Maximum 3 characters and 3 REQUIRED actions each; available idle/walk/run/point/talk. Reference key in actors.assetId. Do not request sprites for photographic/3D performances this adapter cannot deliver. Never request a generic presenter unless the brief needs one. Keep sprites out of background prompts. Do not include magenta in generated sprite designs because it is the reserved matte color.
For each beat you may add actors:[{assetId,animation,fromX,toX,y}] using ONLY actual sprite catalog IDs and clip names below; coordinates are normalized .1..9. Background prompts must omit actors that will be composited as sprites. Actor movement uses actual sprite frames, not image zoom. Catalog: ${JSON.stringify(spriteCatalog)}.
For explanation/cause-effect/comparison beats add diagram:{steps:["short Vietnamese cause","short process","short result"]} with 2–3 factually supported labels, no invented statistics. These become separate editable cards with staggered movement, NOT text baked into an image. Use a diagram only when it explains a relationship more clearly than a scene; no minimum diagram quota. Do not add meaningless particles or arrows. Do not pretend a still image performs walking, chewing or pulling; when no matching sprite exists use an explanatory diagram for the process and a clearly illustrative still for context. Choose 1–6 meaningful beats; no fixed quota. Do not invent asset IDs.`;
  brief = `${brief}\n\n${performanceRules}\nYou can CREATE up to 3 new articulated 2D characters with root characterRequests:[{key:"hero",name:"...",kind:"stick|robot",color:"#54d8c2"}]. Reference key as actors.assetId; available clips are idle,walk,run,point,talk. Reuse the SAME key across scenes to lock identity. Create these stylized rigs ONLY if the user's brief explicitly requests stick figures or a simple robot presenter. Otherwise omit characterRequests entirely. Never substitute these rigs for a story's characters or animals. These are transparent vector sprites; backgrounds must match flat 2D style and leave space for the actors, not contain duplicates. Walking/running actors need travel fromX to toX; point/idle/talk should generally remain in place.\nFor a genuine A/B contrast use diagram:{layout:"comparison",steps:["A: concise defining feature","B: concise contrasting feature"]}. For causal explanations use layout:"process". Labels must express the actual distinction, not generic headings. Do not force comparisons into action-only topics. Keep each label under 50 characters for mobile readability.`;
  brief += `\nREQUIRED DELIVERY: This is animation, not a narrated image slideshow. Every purpose=action beat must specify a feasible actors performance or independently moving objects, tied to an exact narrationCue and visible before/after action. Camera pan/zoom, idle actors, fades and text-card reveals alone do not qualify. Preserve deliberate establishing holds, but the overall film must contain substantive subject motion. Do not relabel action beats as establishing to bypass this requirement. If a required character action cannot be rendered with the supported assets/clips, report the missing capability rather than replace the character with a diagram or a still. Available sprite generation: ${input.assetGeneration?.generator === 'flow-agent' ? 'Flow enabled' : 'disabled; use existing matching assets only'}.`;
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
    const planRaw = await chat(input.provider, input.model, [{ role: 'system', content: `You are an animation director and educational visual storyteller. Return compact JSON only: {"name":"","segments":[{"title":"","narration":"","visualBeats":[{"purpose":"establish|action|detail|reveal","visual":"","motion":"push|pull|pan-left|pan-right|drift-up|drift-down|locked","transition":"cut|match-cut|crossfade"}],"motionGraphic":"none"}]}. Create exactly ${sceneCount} chronological Vietnamese segments and about ${targetWords} spoken words total. Choose 1–6 visual beats per segment according to its actual narrative needs and spoken duration. Each beat has one clear purpose and an observable before/after state. Do not force every segment through establish/action/detail/reveal. A beat must advance meaning, never merely repeat the same image with another zoom. Build a clear hook, cause-and-effect development, visual turn and concise payoff. Each narration must flow naturally into the next, contain factual explanatory content, and never contain production directions. Create a compact continuity bible in your reasoning and repeat every recurring subject's exact age, face, body, wardrobe, colors, props, scale, lighting logic and world geography in every relevant visual prompt. Keep screen direction and action state continuous across match cuts. Generated imagery must contain no text, captions, labels, logos, borders or letterboxing. Do not add floating arrows, focus circles, particles or decorative motionGraphic overlays. Keep motionGraphic none. Start with a strong hook and end with a concise conclusion.\n\n${animationCraftRules}` }, { role: 'user', content: brief }], undefined, 16_384);
  plan = jsonFromDirectorReply(planRaw);
  continuity = String(plan.continuityBible || '').trim().slice(0, 1800);
  segments = normalizeLongAnimationSegments(plan, sceneCount);
  // Repair motion planning before image requests, rather than hide slideshow warnings after rendering.
  const needsMotion = (segment: LongAnimationSegment) => !segment.visualBeats.some((b) => b.narrationCue && b.action && ( b.actors?.length || (b.diagram?.steps.length || 0) >= 2 || b.objects?.some((o) => o.path.some((p) => p.x !== o.path[0].x || p.y !== o.path[0].y || p.rotation !== o.path[0].rotation))));
  if (segments.some(needsMotion) || animationPerformancePlanIssues(segments).length || animationActorPlanIssues(segments, plan, assets, input.assetGeneration?.generator === 'flow-agent').length) {
    const repaired = jsonFromDirectorReply(await chat(input.provider, input.model, [{ role: 'system', content: `Repair animation planning, JSON with segments, spriteRequests and characterRequests. Preserve resource requests referenced by actors; include any newly required resources. Keep segment count/order and narration verbatim. Replan illustration-only segments with meaningful explanatory motion where the subject supports it. Never invent facts, unrelated diagrams or generic characters. Keep honest establishing shots if motion is inappropriate. ${performanceRules}` }, { role: 'user', content: JSON.stringify({ brief, segments, spriteRequests: plan.spriteRequests, characterRequests: plan.characterRequests }) }], undefined, 16_384));
    const candidate = normalizeLongAnimationSegments(repaired, sceneCount);
    if (candidate.length === segments.length && candidate.every((item, i) => item.narration === segments[i].narration)) { segments = candidate; plan = { ...plan, ...repaired }; continuity = String(plan.continuityBible || '').trim().slice(0, 1800); }
  }
  for (const segment of segments) for (const beat of segment.visualBeats) {
    if (!beat.narrationCue || !beat.action) { beat.objects = undefined; beat.actors = undefined; beat.diagram = undefined; }
  }
  if (segments.length < sceneCount) throw new Error(`AI Director chỉ trả về ${segments.length}/${sceneCount} cảnh. Hãy thử dựng lại để bảo đảm đủ nhịp hình và thời lượng.`);
  if (segments.some((segment) => !segment.visualBeats.length)) throw new Error('Director trả cảnh không có kế hoạch hình/chuyển động. Không tự bịa ảnh để lấp cảnh.');
    sceneIds = segments.map(() => randomUUID());
    const capabilityIssues = [...animationPerformancePlanIssues(segments), ...animationActorPlanIssues(segments, plan, assets, input.assetGeneration?.generator === 'flow-agent')];
    if (capabilityIssues.length) throw new Error(capabilityIssues.join(' '));
    await saveAnimationCheckpoint(checkpointKey, { plan, segments, sceneIds });
  }
  const capabilityIssues = [...animationPerformancePlanIssues(segments), ...animationActorPlanIssues(segments, plan, assets, input.assetGeneration?.generator === 'flow-agent')];
  if (capabilityIssues.length) throw new Error(capabilityIssues.join(' '));
  const generationWarnings: string[] = [];
  const requests = (plan as DirectorReply & { characterRequests?: Array<{ key: string; name: string; kind: 'stick' | 'robot'; color?: string }> }).characterRequests;
  const characterIds = new Map<string, string>();
  if (Array.isArray(requests)) for (const request of requests.slice(0, 3)) {
    if (!request || typeof request.key !== 'string' || !['stick', 'robot'].includes(request.kind) || characterIds.has(request.key)) continue;
    const asset = createProceduralCharacter(request);
    characterIds.set(request.key, asset.id);
    if (!assets.some((item) => item.id === asset.id)) assets.push(asset);
  }
  const spriteRequests = normalizeSpriteRequests((plan as DirectorReply & { spriteRequests?: unknown }).spriteRequests);
  for (const request of spriteRequests) {
    await onStage(`Đang chuẩn bị sprite: ${request.name}`);
    if (!segments.some((segment) => segment.visualBeats.some((beat) => beat.actors?.some((actor) => actor.assetId === request.key)))) continue;
    if (input.assetGeneration?.generator !== 'flow-agent') { generationWarnings.push(`Sprite ${request.name}: cần bật tạo asset bằng Flow; không thay bằng nhân vật mẫu.`); continue; }
    try { const asset = await generateAnimationSprite(request, input.assetGeneration.model || 'narwhal', continuity, onStage); assets.push(asset); characterIds.set(request.key, asset.id); }
    catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; generationWarnings.push(error instanceof Error ? error.message : `Không tạo được sprite ${request.name}.`); }
  }
  for (const segment of segments) for (const beat of segment.visualBeats) for (const actor of beat.actors || []) actor.assetId = characterIds.get(actor.assetId) || actor.assetId;
  // Resolve actual generated assets before spending on backgrounds or voice.
  // Failed sprite generation must not silently become a narrated still.
  const missingPerformances = animationActorPlanIssues(segments, {}, assets, false);
  if (missingPerformances.length) throw new Error([...missingPerformances, ...generationWarnings].join(' '));
  const totalWords = segments.reduce((total, segment) => total + segment.narration.split(/\s+/).length, 0);
  const targetMs = targetDurationSeconds * 1000;
  let allocatedMs = 0;
  const sceneDurationsMs = segments.map((segment, index) => {
    const durationMs = index === segments.length - 1 ? Math.max(3000, targetMs - allocatedMs) : Math.max(3000, Math.round(targetMs * (segment.narration.split(/\s+/).length / Math.max(1, totalWords))));
    allocatedMs += durationMs;
    return durationMs;
  });
  if (!continuity) generationWarnings.push('Director chưa trả hồ sơ nhất quán; cần kiểm tra thiết kế chủ thể trước khi xuất.');
  const sceneAssets: Array<Array<AnimationAsset | undefined>> = segments.map((segment) => Array(segment.visualBeats.length).fill(undefined));
  if (input.assetGeneration) {
    let sessionUnavailable = false;
    for (const [index, segment] of segments.entries()) {
      if (sessionUnavailable) break;
      const aspect = input.project.width > input.project.height ? '16:9 landscape' : input.project.width < input.project.height ? '9:16 portrait' : '1:1 square';
      for (const [shotIndex, beat] of segment.visualBeats.entries()) {
        await onStage(`Ảnh cảnh ${index + 1}/${segments.length}, nhịp ${shotIndex + 1}/${segment.visualBeats.length}`);
        if ((beat.diagram?.steps.length || 0) >= 2 || (beat.objects?.length && !beat.visual)) continue;
        const request: DirectorAssetRequest = { key: `long-scene-${index}-${shotIndex}`, name: `${segment.title || `Minh họa cảnh ${index + 1}`} · ${beat.purpose}`, prompt: `${beat.visual}. ${input.project.styleProfile?.style || 'cinematic educational illustration'}. Preserve the exact recurring subject design, wardrobe, props, screen direction, environment geography, palette and lighting established by adjacent shots. Full-frame ${aspect} composition designed for subtle camera movement, edge-to-edge background, no borders, no letterboxing, no text, no captions, no logos`, type: 'background', tags: ['scene-visual', `scene-${index + 1}`, `shot-${shotIndex + 1}`, beat.purpose], style: input.project.styleProfile?.style };
        request.prompt = `LOCKED DESIGN: ${continuity || input.project.styleProfile?.style || 'cohesive 2D educational illustration'}.\n${request.prompt}`;
        try { sceneAssets[index][shotIndex] = await generateDirectorAsset(request, input.assetGeneration, input.project.width, input.project.height); }
        catch (error) {
          generationWarnings.push(`Không tạo được ảnh ${shotIndex + 1} của cảnh ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof FlowSessionError) {
            generationWarnings.push('Đã ngừng tạo ảnh do lỗi phiên Flow. Giữ kịch bản, đánh dấu nhịp thiếu ảnh; không lấy ảnh không liên quan để thay thế.');
            sessionUnavailable = true;
            break;
          }
        }
      }
    }
  }
  const generatedSceneAssets = sceneAssets.flat().filter((asset): asset is AnimationAsset => Boolean(asset));
  const allAssets = [...new Map([...assets, ...generatedSceneAssets].map((asset) => [asset.id, asset])).values()];
  const scenes: CompositeScene[] = segments.map((segment, index) => {
    const durationMs = sceneDurationsMs[index] || 3000; allocatedMs += durationMs;
    const visuals = sceneAssets[index];
    const timeline = buildVisualBeatTimeline({ sceneIndex: index, durationMs, width: input.project.width, height: input.project.height, visuals, beats: segment.visualBeats, narration: segment.narration });
    const performance = buildBeatPerformances({ sceneIndex: index, durationMs, width: input.project.width, height: input.project.height, assets: allAssets, beats: segment.visualBeats, narration: segment.narration });
    timeline.layers.push(...performance.layers);
    timeline.commands.push(...performance.commands);
    generationWarnings.push(...performance.warnings);
    segment.visualBeats.forEach((beat, beatIndex) => {
      if (!visuals[beatIndex] && !(beat.diagram?.steps.length) && !beat.actors?.length && !beat.objects?.length) generationWarnings.push(`Cảnh ${index + 1}, nhịp ${beatIndex + 1}: thiếu hình minh họa, cần bổ sung trước khi xuất.`);
    });
    const titleId = `title-${index}`;
    const layers: SceneLayer[] = [
      ...(timeline.layers.length ? timeline.layers : [{ id: `visual-${index}-0`, name: 'Thiếu hình minh họa', text: 'Chưa có hình minh họa cho cảnh này', fontSize: 32, type: 'text' as const, visible: true, locked: false, zIndex: 0, width: Math.round(input.project.width * .62), height: 150, fill: '#ffffff', transform: { ...defaultTransform(), position: { x: input.project.width / 2, y: input.project.height * .55 } } }]),
      { id: titleId, name: 'Tiêu đề cảnh', type: 'text', text: segment.title || `Phần ${index + 1}`, visible: true, locked: false, zIndex: visuals.length + 2, width: Math.round(input.project.width * .72), height: Math.round(Math.min(input.project.width, input.project.height) * .1), fill: '#ffffff', fontSize: Math.max(24, Math.round(Math.min(input.project.width, input.project.height) * .032)), transform: { ...defaultTransform(), opacity: 0, position: { x: input.project.width / 2, y: input.project.height * .13 } } },
    ];
    const titleInMs = Math.min(420, Math.max(180, Math.round(durationMs * .04)));
    const titleOutStart = Math.min(Math.max(titleInMs + 650, 1200), Math.max(titleInMs, durationMs - 350));
    const titleOutMs = Math.max(1, Math.min(300, durationMs - titleOutStart));
    return { id: sceneIds[index], name: segment.title || `Cảnh ${index + 1}`, order: index, durationMs, narration: segment.narration, renderMode: 'composite', backgroundColor: '#07111f', layers, commands: [...timeline.commands, { id: `title-in-${index}`, type: 'FADE_IN', targetId: titleId, startMs: 80, durationMs: titleInMs, easing: 'ease-out' }, { id: `title-out-${index}`, type: 'FADE_OUT', targetId: titleId, startMs: titleOutStart, durationMs: titleOutMs, easing: 'ease-in' }], camera: { transform: defaultTransform(), commands: [] } };
  });
  const productionPlan = compileAnimationProductionPlan({ segments, sceneIds, sceneDurationsMs, continuityBible: continuity, diagnostics: generationWarnings });
  let project: AnimationProject = { ...input.project, id: input.project.id || randomUUID(), name: String(plan.name || brief).slice(0, 160), assets: allAssets, scenes, productionPlan, assetManifest: undefined, updatedAt: new Date().toISOString(), generationWarnings };
  const issues = validateAnimationProject(project); if (issues.length) throw new Error(issues.slice(0, 8).map((item) => `${item.path}: ${item.message}`).join('; '));
  if (input.narration) project = await generateAnimationNarration({ project, ...input.narration }, onStage);
  await onStage('Đang kiểm tra project và tài nguyên');
  project = { ...project, scenes: project.scenes.map((scene) => scene.renderMode !== 'composite' ? scene : {
    ...scene,
    layers: scene.layers.map((layer) => layer.name === 'Voiceover · Subtitle' ? { ...layer, fontSize: Math.max(layer.fontSize || 24, Math.round(Math.min(project.width, project.height) * .044)) } : layer),
    commands: scene.commands.filter((command) => !(command.parameters?.autoVoiceover && scene.commands.some((other) => other.type === 'PLAY_ANIMATION' && other.targetId === command.targetId))),
  }) };
  project.generationWarnings = [...(project.generationWarnings || []), ...checkAnimationQuality(project).filter((issue) => ['SLIDESHOW_ONLY', 'UNGROUNDED_MOTION', 'DECORATIVE_MOTION'].includes(issue.code)).map((issue) => issue.message)];
  return withAnimationAssetManifest(project);
}

export async function directAnimationProject(input: DirectAnimationInput, onStage: (stage: string) => Promise<void> = async () => {}) {
  await onStage('Đang kiểm tra đầu vào và lập kế hoạch');
  const brief = String(input.brief || '').trim().slice(0, 20_000);
  if (brief.length < 10) throw new Error('Hãy nhập chủ đề hoặc kịch bản ít nhất 10 ký tự.');
  if (!input.provider || !input.model) throw new Error('Chưa cấu hình provider/model cho AI Director.');
  if (input.assetGeneration?.generator === 'flow-agent') await validateGoogleFlowSession();
  const requestedDurationSeconds = Number(input.targetDurationSeconds);
  if (!Number.isFinite(requestedDurationSeconds) || requestedDurationSeconds <= 0) throw new Error('Thời lượng video phải lớn hơn 0.');
  const targetDurationSeconds = Math.max(1, Math.round(requestedDurationSeconds));
  if (targetDurationSeconds >= 30) {
    const key = animationCheckpointKey({ version: 1, projectId: input.project.id, brief, targetDurationSeconds, width: input.project.width, height: input.project.height, fps: input.project.fps, style: input.project.styleProfile, provider: input.provider.id, model: input.model, assets: input.project.assets.map((asset) => ({ id: asset.id, uri: asset.uri, sprite: asset.sprite })) });
    const executionKey = animationCheckpointKey({ key, image: { generator: input.assetGeneration?.generator, provider: input.assetGeneration?.provider?.id, model: input.assetGeneration?.model }, narration: input.narration && { provider: input.narration.provider.id, model: input.narration.model, voice: input.narration.voice, speed: input.narration.speed } });
    return runAnimationOnce(executionKey, () => directLongAnimationProject(input, brief, targetDurationSeconds, key, onStage));
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
