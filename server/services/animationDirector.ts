import { randomUUID } from 'node:crypto';
import type { AnimationAsset, AnimationCommand, AnimationProject, AnimationScene, CompositeScene, SceneLayer } from '../../shared/animationStudio';
import { defaultTransform, validateAnimationProject } from '../../shared/animationStudio';
import { chat } from '../adapters';
import type { AIProvider } from '../types';
import { generateAnimationAsset, generateAnimationNarration, listAnimationAssets } from './animationAssets';
import { saveAnimationProject } from './animationProjects';
import { FlowSessionError, validateGoogleFlowSession } from './googleFlow';
import { animationCraftRules } from './directorKnowledge';

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
type DirectorVisualBeat = { purpose?: string; visual?: string; motion?: VisualBeatMotion; transition?: VisualBeatTransition };
type DirectorSegment = { title?: string; narration?: string; visual?: string; visualDetail?: string; visualBeats?: DirectorVisualBeat[]; motionGraphic?: 'particle' | 'path' | 'focus' | 'none' };
type DirectorReply = { name?: string; scenes?: AnimationScene[]; segments?: DirectorSegment[]; assetRequests?: Array<{ key: string; name: string; prompt: string; type?: 'image' | 'background' | 'object' | 'icon' | 'character'; tags?: string[]; style?: string }> };

export type LongAnimationSegment = {
  title: string;
  narration: string;
  visualBeats: Array<{ purpose: string; visual: string; motion: VisualBeatMotion; transition: VisualBeatTransition }>;
  motionGraphic: 'particle' | 'path' | 'focus' | 'none';
};

type DirectorAssetRequest = NonNullable<DirectorReply['assetRequests']>[number];

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
    const beats = supplied.map((beat, beatIndex) => ({
      purpose: String(beat?.purpose || `Nhịp hình ${beatIndex + 1}`).trim(),
      visual: String(beat?.visual || '').trim(),
      motion: motions.has(beat?.motion as VisualBeatMotion) ? beat.motion as VisualBeatMotion : (['push', 'pan-right', 'pull', 'pan-left'][beatIndex % 4] as VisualBeatMotion),
      transition: transitions.has(beat?.transition as VisualBeatTransition) ? beat.transition as VisualBeatTransition : 'crossfade' as const,
    })).filter((beat) => beat.visual);
    for (const visual of legacyVisuals) if (!beats.some((beat) => beat.visual === visual)) beats.push({ purpose: 'Minh họa bổ sung', visual, motion: beats.length % 2 ? 'pull' : 'push', transition: 'crossfade' });
    const seed = beats[0]?.visual || title;
    const derived = [
      { purpose: 'Toàn cảnh thiết lập', visual: `${seed}. Wide establishing view that clearly establishes place, scale and subject`, motion: 'push' as const, transition: 'cut' as const },
      { purpose: 'Hành động hoặc diễn biến', visual: `${seed}. A distinct action or process moment, changed staging and camera angle`, motion: 'pan-right' as const, transition: 'match-cut' as const },
      { purpose: 'Chi tiết giàu thông tin', visual: `${seed}. Meaningful close detail, reaction, evidence or process insert`, motion: 'pull' as const, transition: 'crossfade' as const },
      { purpose: 'Kết quả hoặc hé lộ', visual: `${seed}. A distinct consequence, comparison or reveal that advances the story`, motion: 'pan-left' as const, transition: 'match-cut' as const },
    ];
    for (const beat of derived) if (beats.length < 4) beats.push(beat);
    return {
      title,
      narration: String(segment.narration || '').trim(),
      visualBeats: beats.slice(0, 4),
      motionGraphic: ['particle', 'path', 'focus'].includes(String(segment.motionGraphic)) ? segment.motionGraphic as LongAnimationSegment['motionGraphic'] : 'none',
    };
  }).filter((segment) => segment.narration).slice(0, sceneCount);
}

export function buildVisualBeatTimeline(input: { sceneIndex: number; durationMs: number; width: number; height: number; visuals: AnimationAsset[]; beats: LongAnimationSegment['visualBeats'] }) {
  const { sceneIndex, durationMs, width, height, visuals, beats } = input;
  const layers: SceneLayer[] = [];
  const commands: AnimationCommand[] = [];
  const count = Math.max(1, visuals.length);
  visuals.forEach((visual, beatIndex) => {
    const id = `visual-${sceneIndex}-${beatIndex}`;
    const beat = beats[beatIndex] || beats[beats.length - 1];
    const startMs = Math.round(durationMs * beatIndex / count);
    const endMs = beatIndex === count - 1 ? durationMs : Math.round(durationMs * (beatIndex + 1) / count);
    const beatDuration = Math.max(1, endMs - startMs);
    const transitionMs = beat?.transition === 'cut' ? 90 : Math.min(380, Math.max(180, Math.round(beatDuration * .11)));
    const baseScale = beat?.motion?.startsWith('pan-') || beat?.motion?.startsWith('drift-') ? 1.09 : 1.03;
    layers.push({ id, name: `${beat?.purpose || 'Nhịp hình'} · ${visual.name}`, type: 'image', assetId: visual.id, visible: true, locked: true, zIndex: beatIndex, width: Math.round(width * 1.08), height: Math.round(height * 1.08), transform: { ...defaultTransform(), opacity: beatIndex ? 0 : 1, scale: { x: baseScale, y: baseScale }, position: { x: width / 2, y: height / 2 } } });
    if (beatIndex > 0) commands.push({ id: `visual-in-${sceneIndex}-${beatIndex}`, type: 'FADE_IN', targetId: id, startMs, durationMs: transitionMs, easing: 'ease-out' });
    if (beatIndex < count - 1) commands.push({ id: `visual-out-${sceneIndex}-${beatIndex}`, type: 'FADE_OUT', targetId: id, startMs: Math.max(startMs, endMs - transitionMs), durationMs: transitionMs, easing: 'ease-in-out' });
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

async function directLongAnimationProject(input: DirectAnimationInput, brief: string, targetDurationSeconds: number) {
  const library = await listAnimationAssets();
  const assets = [...library.filter((asset) => !input.project.assets.some((item) => item.id === asset.id)), ...input.project.assets];
  const sceneCount = Math.max(4, Math.min(24, Math.ceil(targetDurationSeconds / 10)));
  const targetWords = Math.round(targetDurationSeconds * 2.35);
  const planRaw = await chat(input.provider, input.model, [{ role: 'system', content: `You are an animation director and educational visual storyteller. Return compact JSON only: {"name":"","segments":[{"title":"","narration":"","visualBeats":[{"purpose":"establish|action|detail|reveal","visual":"","motion":"push|pull|pan-left|pan-right|drift-up|drift-down|locked","transition":"cut|match-cut|crossfade"}],"motionGraphic":"particle|path|focus|none"}]}. Create exactly ${sceneCount} chronological Vietnamese segments and about ${targetWords} spoken words total. Every segment must contain exactly 4 genuinely different visual beats: establish the situation, show action/process, show an informative detail/reaction, then reveal a consequence/comparison. A beat must advance meaning, never merely repeat the same image with another zoom. Build a clear hook, cause-and-effect development, visual turn and concise payoff. Each narration must flow naturally into the next, contain factual explanatory content, and never contain production directions. Create a compact continuity bible in your reasoning and repeat every recurring subject's exact age, face, body, wardrobe, colors, props, scale, lighting logic and world geography in every relevant visual prompt. Keep screen direction and action state continuous across match cuts. Generated imagery must contain no text, captions, labels, logos, borders or letterboxing. Choose motionGraphic only when it adds explanatory meaning. Start with a strong hook and end with a concise conclusion.\n\n${animationCraftRules}` }, { role: 'user', content: brief }], undefined, 16_384);
  const plan = jsonFromDirectorReply(planRaw);
  const segments = normalizeLongAnimationSegments(plan, sceneCount);
  if (segments.length < sceneCount) throw new Error(`AI Director chỉ trả về ${segments.length}/${sceneCount} cảnh. Hãy thử dựng lại để bảo đảm đủ nhịp hình và thời lượng.`);
  const totalWords = segments.reduce((total, segment) => total + segment.narration.split(/\s+/).length, 0);
  const targetMs = targetDurationSeconds * 1000; let allocatedMs = 0;
  const generationWarnings: string[] = [];
  const sceneAssets: AnimationAsset[][] = Array.from({ length: segments.length }, () => []);
  if (input.assetGeneration) {
    let sessionUnavailable = false;
    for (const [index, segment] of segments.entries()) {
      if (sessionUnavailable) break;
      const aspect = input.project.width > input.project.height ? '16:9 landscape' : input.project.width < input.project.height ? '9:16 portrait' : '1:1 square';
      for (const [shotIndex, beat] of segment.visualBeats.entries()) {
        const request: DirectorAssetRequest = { key: `long-scene-${index}-${shotIndex}`, name: `${segment.title || `Minh họa cảnh ${index + 1}`} · ${beat.purpose}`, prompt: `${beat.visual}. ${input.project.styleProfile?.style || 'cinematic educational illustration'}. Preserve the exact recurring subject design, wardrobe, props, screen direction, environment geography, palette and lighting established by adjacent shots. Full-frame ${aspect} composition designed for subtle camera movement, edge-to-edge background, no borders, no letterboxing, no text, no captions, no logos`, type: 'background', tags: ['scene-visual', `scene-${index + 1}`, `shot-${shotIndex + 1}`, beat.purpose], style: input.project.styleProfile?.style };
        try { sceneAssets[index].push(await generateDirectorAsset(request, input.assetGeneration, input.project.width, input.project.height)); }
        catch (error) {
          generationWarnings.push(`Không tạo được ảnh ${shotIndex + 1} của cảnh ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof FlowSessionError) {
            generationWarnings.push('Đã ngừng tạo ảnh do lỗi phiên Flow. Kịch bản và giọng đọc vẫn được giữ; các cảnh thiếu ảnh dùng asset thay thế.');
            sessionUnavailable = true;
            break;
          }
        }
      }
    }
  }
  const generatedSceneAssets = sceneAssets.flat();
  const allAssets = [...assets, ...generatedSceneAssets];
  const backgrounds = allAssets.filter((asset) => asset.type === 'background');
  const fallbackVisuals = allAssets.filter((asset) => ['image', 'object', 'character', 'icon'].includes(asset.type));
  const scenes: CompositeScene[] = segments.map((segment, index) => {
    const durationMs = index === segments.length - 1 ? Math.max(3000, targetMs - allocatedMs) : Math.max(3000, Math.round(targetMs * (segment.narration.split(/\s+/).length / Math.max(1, totalWords)))); allocatedMs += durationMs;
    const generatedShots = sceneAssets[index];
    const fallback = backgrounds[index % Math.max(1, backgrounds.length)] || fallbackVisuals[index % Math.max(1, fallbackVisuals.length)];
    const visuals = generatedShots.length ? generatedShots : fallback ? [fallback] : [];
    const timeline = buildVisualBeatTimeline({ sceneIndex: index, durationMs, width: input.project.width, height: input.project.height, visuals, beats: segment.visualBeats });
    const titleId = `title-${index}`;
    const accentId = `motion-accent-${index}`;
    const accentLayer: SceneLayer | undefined = segment.motionGraphic === 'particle'
      ? { id: accentId, name: 'Hạt chuyển động', type: 'particle', visible: true, locked: false, zIndex: visuals.length + 1, width: input.project.width, height: input.project.height, fill: '#ffb37c', transform: { ...defaultTransform(), opacity: .2, position: { x: input.project.width / 2, y: input.project.height / 2 } } }
      : segment.motionGraphic === 'path'
        ? { id: accentId, name: 'Hướng chuyển động', type: 'diagram', visible: true, locked: false, zIndex: visuals.length + 1, width: Math.round(input.project.width * .24), height: Math.round(input.project.height * .035), fill: '#ff8a45', transform: { ...defaultTransform(), opacity: .75, position: { x: input.project.width * .28, y: input.project.height * .72 } } }
        : segment.motionGraphic === 'focus'
          ? { id: accentId, name: 'Điểm nhấn', type: 'shape', shape: 'ellipse', visible: true, locked: false, zIndex: visuals.length + 1, width: Math.round(input.project.width * .18), height: Math.round(input.project.width * .18), fill: '#ff8a45', transform: { ...defaultTransform(), opacity: .16, position: { x: input.project.width * .62, y: input.project.height * .52 } } }
          : undefined;
    const layers: SceneLayer[] = [
      ...(timeline.layers.length ? timeline.layers : [{ id: `visual-${index}-0`, name: segment.visualBeats[0]?.purpose || 'Minh họa', type: 'diagram' as const, visible: true, locked: false, zIndex: 0, width: Math.round(input.project.width * .62), height: 150, fill: '#ff8a45', transform: { ...defaultTransform(), position: { x: input.project.width / 2, y: input.project.height * .55 } } }]),
      ...(accentLayer ? [accentLayer] : []),
      { id: titleId, name: 'Tiêu đề cảnh', type: 'text', text: segment.title || `Phần ${index + 1}`, visible: true, locked: false, zIndex: visuals.length + 2, width: Math.round(input.project.width * .72), height: Math.round(Math.min(input.project.width, input.project.height) * .1), fill: '#ffffff', fontSize: Math.max(24, Math.round(Math.min(input.project.width, input.project.height) * .032)), transform: { ...defaultTransform(), opacity: 0, position: { x: input.project.width / 2, y: input.project.height * .13 } } },
    ];
    const accentCommands: AnimationCommand[] = !accentLayer ? [] : segment.motionGraphic === 'path'
      ? [{ id: `accent-move-${index}`, type: 'MOVE' as const, targetId: accentId, startMs: Math.round(durationMs * .18), durationMs: Math.round(durationMs * .62), easing: 'ease-in-out' as const, from: { x: input.project.width * .28, y: input.project.height * .72 }, to: { x: input.project.width * .72, y: input.project.height * .48 } }]
      : [{ id: `accent-pulse-${index}`, type: 'SCALE' as const, targetId: accentId, startMs: Math.round(durationMs * .15), durationMs: Math.round(durationMs * .7), easing: 'ease-in-out' as const, from: { x: .65, y: .65 }, to: { x: 1.25, y: 1.25 } }];
    const titleInMs = Math.min(420, Math.max(180, Math.round(durationMs * .04)));
    const titleOutStart = Math.min(Math.max(titleInMs + 650, 1200), Math.max(titleInMs, durationMs - 350));
    const titleOutMs = Math.max(1, Math.min(300, durationMs - titleOutStart));
    return { id: randomUUID(), name: segment.title || `Cảnh ${index + 1}`, order: index, durationMs, narration: segment.narration, renderMode: 'composite', backgroundColor: '#07111f', layers, commands: [...timeline.commands, { id: `title-in-${index}`, type: 'FADE_IN', targetId: titleId, startMs: 80, durationMs: titleInMs, easing: 'ease-out' }, { id: `title-out-${index}`, type: 'FADE_OUT', targetId: titleId, startMs: titleOutStart, durationMs: titleOutMs, easing: 'ease-in' }, ...accentCommands], camera: { transform: defaultTransform(), commands: [] } };
  });
  let project: AnimationProject = { ...input.project, id: input.project.id || randomUUID(), name: String(plan.name || brief).slice(0, 160), assets: allAssets, scenes, updatedAt: new Date().toISOString(), generationWarnings };
  const issues = validateAnimationProject(project); if (issues.length) throw new Error(issues.slice(0, 8).map((item) => `${item.path}: ${item.message}`).join('; '));
  if (input.narration) project = await generateAnimationNarration({ project, ...input.narration });
  return project;
}

export async function directAnimationProject(input: DirectAnimationInput) {
  const brief = String(input.brief || '').trim().slice(0, 20_000);
  if (brief.length < 10) throw new Error('Hãy nhập chủ đề hoặc kịch bản ít nhất 10 ký tự.');
  if (!input.provider || !input.model) throw new Error('Chưa cấu hình provider/model cho AI Director.');
  if (input.assetGeneration?.generator === 'flow-agent') await validateGoogleFlowSession();
  const requestedDurationSeconds = Number(input.targetDurationSeconds);
  if (!Number.isFinite(requestedDurationSeconds) || requestedDurationSeconds <= 0) throw new Error('Thời lượng video phải lớn hơn 0.');
  const targetDurationSeconds = Math.max(1, Math.round(requestedDurationSeconds));
  if (targetDurationSeconds >= 30) return directLongAnimationProject(input, brief, targetDurationSeconds);
  const library = await listAnimationAssets();
  const combinedAssets = [...library.filter((asset) => !input.project.assets.some((item) => item.id === asset.id)), ...input.project.assets];
  const baseProject = { ...input.project, assets: combinedAssets };
  const assets = combinedAssets.map(({ id, type, name, tags, style, animations }) => ({ id, type, name, tags, style, animations }));
  const system = `You are AutoSub AI Director for editable knowledge animation. Return JSON only with shape {"name":"","assetRequests":[],"scenes":[]}.
Project style profile: ${JSON.stringify(input.project.styleProfile || { name: 'AutoSub default', style: 'clean educational motion graphics', pacing: 'balanced' })}. Obey this visual style, palette and pacing consistently across all scenes.
Create 2-4 short composite scenes, each 2000-8000ms. Use at most 6 visible layers and 8 layer commands per scene. Return compact JSON without indentation. Never return generated-video scenes and never write animation code.
Every scene must exactly follow this TypeScript-compatible structure:
{"id":"unique","name":"","order":0,"durationMs":5000,"narration":"","renderMode":"composite","backgroundColor":"#07111f","layers":[{"id":"unique","name":"","type":"image|sprite|text|shape|diagram|chart|particle|audio","assetId":"optional-existing-id","text":"optional","animation":"optional-sprite-clip","characterId":"stable-id-across-scenes","visible":true,"locked":false,"zIndex":1,"width":300,"height":300,"fill":"#ffffff","fontSize":54,"shape":"rectangle|ellipse","transform":{"position":{"x":540,"y":960},"scale":{"x":1,"y":1},"rotation":0,"opacity":1,"anchor":{"x":0.5,"y":0.5}}}],"commands":[{"id":"unique","type":"MOVE|FADE_IN|FADE_OUT|SCALE|ROTATE|PLAY_ANIMATION|TALK|POINT|LOOK_LEFT|LOOK_RIGHT","targetId":"layer-id","startMs":0,"durationMs":1000,"easing":"linear|ease-in|ease-out|ease-in-out","animation":"optional-catalog-clip","from":{"x":0,"y":0},"to":{"x":1,"y":1}}],"camera":{"transform":{"position":{"x":0,"y":0},"scale":{"x":1,"y":1},"rotation":0,"opacity":1,"anchor":{"x":0.5,"y":0.5}},"commands":[{"id":"unique","type":"ZOOM_IN|ZOOM_OUT|PAN_LEFT|PAN_RIGHT","targetId":"camera","startMs":0,"durationMs":1000,"easing":"ease-in-out","from":{"x":1,"y":1},"to":{"x":1.08,"y":1.08}}]}}.
Visual vocabulary: danger = warning icon + red accent + quick scale; thinking = character thinking clip + question mark + slower pacing; increase = upward arrow + number/text; travel = map + moving marker; time passing = clock + visual state change. Convert quantities, comparisons, routes and timelines into editable diagram/chart/shape layers instead of narration-only scenes. Add a visual or camera change every 2-4 seconds.
Chart layers may include numeric "data" and string "labels" arrays. Diagram layers render directional arrows. Particle layers render procedural effects.
For characters, LOOK_AT commands may use "target" with another layer id; TALK and POINT select matching sprite clips when available. Reuse the same characterId and assetId when a character returns in later scenes.
Audio layers may include startMs, durationMs and volume. Select reusable audio assets by semantic tags and place SFX near matching actions.
Canvas is ${input.project.width}x${input.project.height}. Use assetId values from this catalog: ${JSON.stringify(assets)}. ${input.assetGeneration ? 'If an essential visual is missing, add at most 4 assetRequests shaped as {"key":"temporary-key","name":"","prompt":"single isolated editable visual or clean background, no text","type":"image|background|object|icon|character","tags":[],"style":""}, and reference that temporary key as assetId in layers.' : 'If no suitable asset exists, visualize with editable text/shape/diagram layers; do not invent an assetId.'} Keep titles/subtitles inside safe margins and change visuals every 2-4 seconds. Commands must fit scene duration and target an existing layer. Output concise Vietnamese narration.`;
  const timestamp = new Date().toISOString();
  const assemble = async (raw: string) => {
    const planned = jsonFromDirectorReply(raw);
    if (!Array.isArray(planned.scenes) || !planned.scenes.length) throw new Error('AI Director không trả về scene hợp lệ.');
    const generated: AnimationProject['assets'] = []; const replacements = new Map<string, string>(); const unavailable = new Set<string>(); const generationWarnings: string[] = [];
    let sessionUnavailable = false;
    if (input.assetGeneration) for (const request of (planned.assetRequests || []).slice(0, 4)) {
      if (!request?.key || !request.prompt) continue;
      if (sessionUnavailable) { unavailable.add(request.key); continue; }
      try { const asset = await generateDirectorAsset(request, input.assetGeneration, input.project.width, input.project.height); generated.push(asset); replacements.set(request.key, asset.id); }
      catch (error) { unavailable.add(request.key); generationWarnings.push(`Không tạo được asset “${request.name || request.key}”: ${error instanceof Error ? error.message : String(error)}`); if (error instanceof FlowSessionError) sessionUnavailable = true; }
    }
    const scenes = replaceUnavailableGeneratedAssets(planned.scenes, replacements, unavailable);
    const project: AnimationProject = { ...baseProject, assets: [...baseProject.assets, ...generated], id: input.project.id || randomUUID(), name: String(planned.name || brief).slice(0, 160), scenes, updatedAt: timestamp, generationWarnings };
    const issues = validateAnimationProject(project);
    if (issues.length) throw new Error(issues.slice(0, 8).map((item) => `${item.path}: ${item.message}`).join('; '));
    return project;
  };
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [{ role: 'system', content: system }, { role: 'user', content: brief }];
  const raw = await chat(input.provider, input.model, messages, undefined, 16_384);
  try { return await assemble(raw); }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const repairRule = directorRepairRule(reason);
    const repaired = await chat(input.provider, input.model, [{ role: 'system', content: `${system}\n${repairRule}` }, { role: 'user', content: `Original brief:\n${brief}\n\nThe previous JSON failed validation:\n${reason}\n\nRegenerate the complete corrected project. Do not explain.` }], undefined, 16_384);
    try { return await assemble(repaired); }
    catch (repairError) { throw new Error(`AI Director đã thử sửa Scene JSON nhưng vẫn chưa hợp lệ: ${repairError instanceof Error ? repairError.message : String(repairError)}`); }
  }
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

export async function batchDirectAnimationProjects(input: { briefs: string[]; template: AnimationProject; provider: AIProvider; model: string; assetGeneration?: DirectorAssetGeneration }) {
  const briefs = (Array.isArray(input.briefs) ? input.briefs : []).map(String).map((item) => item.trim()).filter((item) => item.length >= 10).slice(0, 20); if (!briefs.length) throw new Error('Batch cần ít nhất một chủ đề hợp lệ.');
  const results: Array<{ brief: string; status: 'completed' | 'failed'; project?: AnimationProject; error?: string }> = [];
  for (const brief of briefs) { try { const now = new Date().toISOString(); const base = { ...input.template, id: randomUUID(), name: brief.slice(0, 120), scenes: [], createdAt: now, updatedAt: now }; const project = await directAnimationProject({ brief, project: base, provider: input.provider, model: input.model, assetGeneration: input.assetGeneration }); results.push({ brief, status: 'completed', project: await saveAnimationProject(project) }); } catch (error) { results.push({ brief, status: 'failed', error: error instanceof Error ? error.message : String(error) }); } }
  return { total: briefs.length, completed: results.filter((item) => item.status === 'completed').length, failed: results.filter((item) => item.status === 'failed').length, results };
}
