import { createHash } from 'node:crypto';
import type {
  AnimationAsset,
  AnimationAssetManifest,
  AnimationAssetManifestEntry,
  AnimationBeatContract,
  AnimationManifestRole,
  AnimationProject,
  CompositeScene,
} from '../../shared/animationStudio';

function stableKey(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalize(value: string) {
  return value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/\s+/gu, ' ').trim();
}

function sceneIndex(project: AnimationProject, sceneId: string) {
  return project.scenes.findIndex((scene) => scene.id === sceneId);
}

function layersForBeat(scene: CompositeScene, scenePosition: number, beatPosition: number) {
  const visualPrefix = `visual-${scenePosition}-${beatPosition}`;
  const objectPrefix = `beat-${scenePosition}-${beatPosition}-`;
  const processPrefix = `process-${scenePosition}-${beatPosition}-`;
  return scene.layers.filter((layer) => layer.id === visualPrefix || layer.id.startsWith(objectPrefix) || layer.id.startsWith(processPrefix) || layer.id.startsWith(`actor-${scenePosition}-${beatPosition}-`));
}

function roleForBeat(beat: AnimationBeatContract): AnimationManifestRole {
  if (beat.technique === 'sprite' || beat.technique === 'rig') return 'character';
  if (beat.technique === 'object-composite') return 'object';
  if (beat.technique === 'diagram') return 'diagram';
  if (beat.technique === 'generated-video') return 'background';
  return 'background';
}

function capabilitiesForBeat(beat: AnimationBeatContract) {
  const capabilities: string[] = [beat.technique];
  if (beat.action) capabilities.push('observable-action');
  if (beat.screenDirection && beat.screenDirection !== 'static') capabilities.push(`screen-direction:${beat.screenDirection}`);
  return capabilities;
}

function entryStatus(assetIds: string[], assets: Map<string, AnimationAsset>, required: boolean): AnimationAssetManifestEntry['status'] {
  if (assetIds.some((id) => assets.get(id)?.status === 'rejected')) return 'rejected';
  if (assetIds.some((id) => !assets.has(id))) return required ? 'missing' : 'candidate';
  if (!assetIds.length) return required ? 'missing' : 'ready';
  if (assetIds.some((id) => ['candidate', 'draft'].includes(assets.get(id)?.status || ''))) return 'candidate';
  return 'ready';
}

/**
 * Derive a small, inspectable inventory from the production contract and the
 * editable scene graph. It never creates assets or calls a provider; callers
 * can use it as a preflight before spending credits.
 */
export function buildAnimationAssetManifest(project: AnimationProject, generatedAt = new Date().toISOString()): AnimationAssetManifest {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const plan = project.productionPlan;
  const entries = new Map<string, AnimationAssetManifestEntry>();
  const diagnostics = new Set<string>(plan?.diagnostics || []);
  const add = (input: {
    role: AnimationManifestRole;
    name: string;
    sceneId: string;
    beatId?: string;
    assetIds?: string[];
    required: boolean;
    capabilities: string[];
    status?: AnimationAssetManifestEntry['status'];
  }) => {
    const assetIds = [...new Set((input.assetIds || []).filter(Boolean))].sort();
    const identity = `${input.role}|${assetIds.join(',')}|${normalize(input.name)}`;
    const id = `manifest-${stableKey(identity).slice(0, 20)}`;
    const current = entries.get(id);
    if (current) {
      current.sceneIds = [...new Set([...current.sceneIds, input.sceneId])];
      if (input.beatId) current.beatIds = [...new Set([...current.beatIds, input.beatId])];
      current.assetIds = [...new Set([...current.assetIds, ...assetIds])].sort();
      current.capabilities = [...new Set([...current.capabilities, ...input.capabilities])];
      current.required = current.required || input.required;
      const rank = { ready: 0, candidate: 1, missing: 2, rejected: 3 };
      const incoming = input.status || entryStatus(assetIds, assets, input.required);
      if (rank[incoming] > rank[current.status]) current.status = incoming;
      current.cacheKey = current.cacheKey || stableKey({ role: input.role, name: normalize(input.name), style: project.styleProfile?.style || '', assets: current.assetIds.map((assetId) => assets.get(assetId)?.cacheKey || assets.get(assetId)?.generationPrompt || assetId) });
      return;
    }
    const cacheKey = stableKey({ role: input.role, name: normalize(input.name), style: project.styleProfile?.style || '', assetIds: assetIds.map((assetId) => assets.get(assetId)?.cacheKey || assets.get(assetId)?.generationPrompt || assetId) });
    const entry: AnimationAssetManifestEntry = {
      id,
      role: input.role,
      name: input.name.trim().slice(0, 160) || input.role,
      sceneIds: [input.sceneId],
      beatIds: input.beatId ? [input.beatId] : [],
      assetIds,
      required: input.required,
      status: input.status || entryStatus(assetIds, assets, input.required),
      capabilities: [...new Set(input.capabilities)],
      cacheKey,
    };
    entries.set(id, entry);
    if (entry.status === 'missing' && entry.required) diagnostics.add(`Thiếu asset bắt buộc: ${entry.name} (${entry.role}).`);
  };

  if (plan) {
    const beatsByScene = new Map<string, AnimationBeatContract[]>();
    for (const beat of plan.beats) beatsByScene.set(beat.sceneId, [...(beatsByScene.get(beat.sceneId) || []), beat]);
    for (const [sceneId, sceneBeats] of beatsByScene) {
      const position = sceneIndex(project, sceneId);
      const scene = project.scenes[position];
      for (const [beatPosition, beat] of sceneBeats.entries()) {
        const layers = scene?.renderMode === 'composite' ? layersForBeat(scene, position, beatPosition) : [];
        const visible = layers.filter((layer) => layer.visible);
        const procedural = beat.technique === 'object-composite' || beat.technique === 'diagram';
        const targets = procedural ? visible.filter((layer) => !layer.id.startsWith('visual-') && !layer.assetId)
          : beat.technique === 'sprite' || beat.technique === 'rig' ? visible.filter((layer) => layer.type === 'sprite') : visible;
        const assetIds = targets.map((layer) => layer.assetId).filter((id): id is string => Boolean(id));
        const validSprites = targets.every((layer) => layer.type !== 'sprite' || Boolean(layer.assetId && assets.get(layer.assetId)?.sprite?.clips[layer.animation || 'idle'])) && (!(beat.technique === 'sprite' || beat.technique === 'rig') || beat.subjectIds.every((id) => assetIds.includes(id)));
        const status = procedural ? (targets.length ? 'ready' : 'missing') : !validSprites ? 'missing' : undefined;
        add({ role: roleForBeat(beat), name: beat.visibleEvidence, sceneId, beatId: beat.id, assetIds, required: beat.technique !== 'hold', capabilities: capabilitiesForBeat(beat), status });
        if (procedural || beat.technique === 'sprite' || beat.technique === 'rig') {
          const backgroundIds = visible.filter((layer) => layer.id.startsWith('visual-')).map((layer) => layer.assetId).filter((id): id is string => Boolean(id));
          if (backgroundIds.length) add({ role: 'background', name: `Background · ${scene.name}`, sceneId, beatId: beat.id, assetIds: backgroundIds, required: true, capabilities: ['image'] });
        }
      }
    }
  } else {
    diagnostics.add('Project chưa có productionPlan; manifest chỉ phản ánh asset đang có.');
  }

  for (const scene of project.scenes) {
    if (scene.renderMode !== 'composite') continue;
    const audioLayers = scene.layers.filter((layer) => layer.visible && layer.type === 'audio' && (!scene.narration.trim() || /^voiceover/i.test(layer.name) || assets.get(layer.assetId || '')?.tags.some((tag) => /^(voiceover|narration)$/i.test(tag))));
    if (scene.narration.trim() || audioLayers.length) add({ role: 'audio', name: `Voiceover · ${scene.name}`, sceneId: scene.id, assetIds: audioLayers.map((layer) => layer.assetId).filter((assetId): assetId is string => Boolean(assetId)), required: Boolean(scene.narration.trim()), capabilities: ['voiceover', 'scene-sync'] });
  }

  return {
    version: 1,
    generatedAt,
    styleKey: stableKey({ style: project.styleProfile || {}, continuityBible: plan?.continuityBible || '' }),
    entries: [...entries.values()].map((entry) => ({ ...entry, sceneIds: [...entry.sceneIds], beatIds: [...entry.beatIds], assetIds: [...entry.assetIds], capabilities: [...entry.capabilities] })),
    diagnostics: diagnostics.size ? [...diagnostics] : undefined,
  };
}

export function withAnimationAssetManifest(project: AnimationProject, generatedAt?: string): AnimationProject {
  return { ...project, assetManifest: buildAnimationAssetManifest(project, generatedAt) };
}
