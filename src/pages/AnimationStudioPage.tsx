import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { AnimationAsset, AnimationProject, CompositeScene, SceneLayer } from '../../shared/animationStudio';
import { ANIMATION_PROJECT_VERSION, defaultTransform } from '../../shared/animationStudio';
import { isLikelyVietnamese } from '../../shared/kokoroVoices';
import { AnimationCanvas } from '../animationStudio/AnimationCanvas';
import { BookOpen, ChevronDown, CirclePlay, Download, Image, Layers3, LoaderCircle, Maximize, Pause, Play, Plus, RefreshCw, Save, Settings2, Sparkles, Trash2, X } from '../components/Icons';
import { animationAssetUrl, animationProjectRenderCacheKey, api, friendlyErrorMessage, type AnimationDirectorJobStatus, type AnimationProjectSummary } from '../lib/api';
import { loadVoicePreview } from '../lib/voicePreview';
import { capabilityAssignments } from '../lib/settings';
import type { AIProvider, AppSettings } from '../types';
import { buildRenderTimeline } from '../remotion/timeline';
import './AnimationStudioPage.css';

const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const GPT_IMAGE_PROVIDER: AIProvider = {
  id: 'ima2-gpt-oauth', name: 'GPT Image · ChatGPT', baseUrl: 'local://ima2-gpt-oauth', enabled: true,
  models: [{ id: 'gpt-5.6-luna', name: 'GPT Image · gpt-5.6-luna' }], providerType: 'custom', authType: 'none', capabilities: {},
};
const GPT_IMAGE_MODEL = 'gpt-5.6-luna';

const VISUAL_STYLE_PRESETS = [
  {
    id: 'stick-explainer',
    label: 'Người que explainer',
    prompt: 'clean minimalist stick-figure explainer illustrations, bald round-headed stick characters, thin black limbs, simple expressive faces, flat vector design, bold clean outlines, off-white background, yellow accent color for the main mascot, simple economics and everyday-life icons, highly readable compositions, modern editorial educational style, consistent character design, minimal shading, clear comparisons and diagrams, professional YouTube explainer aesthetic',
  },
  {
    id: 'modern-editorial',
    label: 'Editorial hiện đại',
    prompt: 'premium modern editorial explainer illustration, clean shapes, expressive simplified characters, polished digital painting with subtle texture, strong visual hierarchy, warm accent colors, readable diagrams and object illustrations, consistent art direction, dynamic but not overly cinematic, designed for fast-paced educational YouTube videos',
  },
  {
    id: 'flat-infographic',
    label: 'Flat vector / infographic',
    prompt: 'clean flat vector infographic illustration, geometric shapes, minimal shading, bold readable silhouettes, simple characters and objects, clear charts diagrams and comparisons, restrained color palette, uncluttered backgrounds, high information clarity, consistent educational explainer design',
  },
  {
    id: 'whiteboard-doodle',
    label: 'Whiteboard / doodle',
    prompt: 'hand-drawn whiteboard explainer style, simple black marker line art, sparse accent colors, playful doodles, clean white background, highly legible diagrams, expressive minimal characters, intentionally simple educational visual storytelling, consistent line weight and character design',
  },
  {
    id: 'paper-cutout',
    label: 'Paper cutout',
    prompt: 'layered paper-cutout educational illustration, simple tactile paper shapes, soft shallow shadows, clean silhouettes, restrained color palette, readable compositions, playful but professional explainer design, consistent characters and objects, clear diagrams and comparisons',
  },
] as const;

const STORY_TONE_OPTIONS = [
  { value: 'balanced', label: 'Tự nhiên / cân bằng' },
  { value: 'humorous', label: 'Hài hước thông minh' },
  { value: 'curious', label: 'Tò mò / khám phá' },
  { value: 'energetic', label: 'Nhanh, nhiều năng lượng' },
  { value: 'serious', label: 'Nghiêm túc / chính xác' },
] as const;

const visualStylePresetId = (style: string | undefined) => VISUAL_STYLE_PRESETS.find((preset) => preset.prompt === String(style || '').trim())?.id || 'custom';

function srtTimestamp(milliseconds: number) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  const seconds = Math.floor(value % 60_000 / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function subtitleWordTimings(text: string, durationMs: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordDuration = durationMs / Math.max(1, words.length);
  return words.map((word, index) => ({ word, startMs: Math.round(index * wordDuration), endMs: Math.round((index + 1) * wordDuration) }));
}

function storyboardProject(): AnimationProject {
  const createdAt = now();
  return {
    schemaVersion: ANIMATION_PROJECT_VERSION,
    id: crypto.randomUUID(),
    name: 'Video giải thích mới',
    width: 1280,
    height: 720,
    fps: 30,
    createdAt,
    updatedAt: createdAt,
    assets: [],
    transitionPreset: { type: 'cut', durationMs: 0 },
    styleProfile: {
      name: 'AI Storyboard',
      style: VISUAL_STYLE_PRESETS[0].prompt,
      palette: [],
      pacing: 'balanced',
      tone: 'balanced',
    },
    scenes: [{
      id: 'scene-001',
      name: 'Bắt đầu',
      order: 0,
      durationMs: 5000,
      narration: '',
      transition: { type: 'cut', durationMs: 0 },
      renderMode: 'composite',
      backgroundColor: '#ffffff',
      layers: [{
        id: 'starter-label',
        name: 'Hướng dẫn',
        type: 'text',
        text: 'Nhập ý tưởng hoặc toàn bộ kịch bản để bắt đầu',
        visible: true,
        locked: true,
        zIndex: 1,
        width: 780,
        height: 80,
        fill: '#263238',
        fontSize: 34,
        transform: { ...defaultTransform(), position: { x: 640, y: 360 } },
      }],
      commands: [],
      camera: { transform: defaultTransform(), commands: [] },
    }],
  };
}

export function AnimationStudioPage({ providers, settings, onNotice }: { providers: AIProvider[]; settings: AppSettings; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [project, setProject] = useState(storyboardProject);
  const [sceneId, setSceneId] = useState('scene-001');
  const [selectedLayerId, setSelectedLayerId] = useState('');
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sequenceMode, setSequenceMode] = useState(false);
  const [sequenceTimeMs, setSequenceTimeMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [brief, setBrief] = useState('');
  const [directing, setDirecting] = useState(false);
  const [directorJob, setDirectorJob] = useState<AnimationDirectorJobStatus>();
  const [directorJobId, setDirectorJobId] = useState(() => { try { return localStorage.getItem('autosub.animation-director-job-id') || ''; } catch { return ''; } });
  const autoOpenDirector = useRef(false);
  const [directorPollRevision, setDirectorPollRevision] = useState(0);
  const [targetMinutes, setTargetMinutes] = useState('1');
  const [durationMode, setDurationMode] = useState<'auto' | 'fixed'>('fixed');
  const [characterReference, setCharacterReference] = useState<{ uploadId: string; name: string }>();
  const [characterAppearanceLock, setCharacterAppearanceLock] = useState('');
  const [characterOptions, setCharacterOptions] = useState<AnimationAsset[]>([]);
  const [selectedCharacterAssetId, setSelectedCharacterAssetId] = useState('');
  const [characterPreview, setCharacterPreview] = useState<{ id?: string; name: string; uri: string }>();
  const [preparingCharacters, setPreparingCharacters] = useState(false);
  const [directorError, setDirectorError] = useState('');
  const [directorWarning, setDirectorWarning] = useState('');
  const [retryingMissingImages, setRetryingMissingImages] = useState(false);
  useEffect(() => {
    if (!directorJobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await api.animationDirectorJob(directorJobId);
        if (disposed) return;
        setDirectorJob(job);
        const active = job.status === 'queued' || job.status === 'running';
        setDirecting(active);
        if (!active) {
          if (job.error) setDirectorError(job.error);
          if (job.hasResult && autoOpenDirector.current) {
            const result = await api.animationDirectorResult(job.id);
            if (!disposed) { applyDirectorProject(result); autoOpenDirector.current = false; }
          }
          return;
        }
      } catch (error) {
        if (!disposed) setDirectorError(friendlyErrorMessage(error, 'Mất kết nối theo dõi job; sẽ kiểm tra lại, không gửi lệnh tạo mới.'));
      }
      if (!disposed) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [directorJobId, directorPollRevision]);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const renderSessionRef = useRef<{ projectId: string; cacheKey: string } | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const pollRenderJob = async () => {
      try {
        const cacheKey = await animationProjectRenderCacheKey(project, false);
        const jobs = await api.listAnimationRenderJobs();
        const active = jobs
          .filter((job) => job.projectId === project.id && job.cacheKey === cacheKey && (job.status === 'queued' || job.status === 'rendering'))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const ownsCurrentSession = renderSessionRef.current?.projectId === project.id && renderSessionRef.current?.cacheKey === cacheKey;
        if (!disposed && active) {
          setRendering(true);
          setRenderProgress(Math.max(0, Math.min(100, Number(active.progress) || 0)));
        } else if (!disposed && !ownsCurrentSession) {
          setRendering(false);
          setRenderProgress(0);
        }
      } catch { /* the export itself reports its own error */ }
      if (!disposed) timer = window.setTimeout(() => void pollRenderJob(), 1500);
    };
    void pollRenderJob();
    return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [project]);
  const [libraryAssets, setLibraryAssets] = useState<AnimationAsset[]>([]);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetPrompt, setAssetPrompt] = useState('');
  const [imageModel, setImageModel] = useState('narwhal');
  const [gptImageModel, setGptImageModel] = useState(GPT_IMAGE_MODEL);
  const [imageProviderId, setImageProviderId] = useState('flow-agent');
  const [flowAgent, setFlowAgent] = useState<Awaited<ReturnType<typeof api.flowAgentStatus>>>();
  const [ima2GptStatus, setIma2GptStatus] = useState<Awaited<ReturnType<typeof api.ima2GptImageStatus>>>();
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const [generatingThumbnails, setGeneratingThumbnails] = useState(false);
  const [autoGenerateAssets, setAutoGenerateAssets] = useState(true);
  const [editInstruction, setEditInstruction] = useState('');
  const [editingWithAi, setEditingWithAi] = useState(false);
  const [qualityIssues, setQualityIssues] = useState<Array<{ severity: 'error' | 'warning'; code: string; sceneId: string; layerId?: string; message: string }>>([]);
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsVoices, setTtsVoices] = useState<Array<{ id: string; name?: string; language?: string }>>([]);
  const [testingTtsVoice, setTestingTtsVoice] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [creatingVoiceover, setCreatingVoiceover] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<AnimationProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [setupOpen, setSetupOpen] = useState(() => window.innerWidth > 900);
  const [versions, setVersions] = useState<Array<{ id: string; createdAt: string; name: string; sceneCount: number }>>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement[]>([]);
  const ttsTestAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsTestUrlRef = useRef<string | null>(null);
  const ttsTestRequestRef = useRef(0);
  const sceneRef = useRef<CompositeScene | undefined>(undefined);
  const sequencePlayheadRef = useRef<HTMLElement | null>(null);
  const sequenceScrubRef = useRef<{ pointerId: number; active: boolean }>({ pointerId: -1, active: false });
  const startedAt = useRef(0);
  const lastPreviewFrameAt = useRef(0);
  const characterPreviewCloseRef = useRef<HTMLButtonElement | null>(null);
  const characterGenerationRef = useRef<AbortController | null>(null);
  const scene = project.scenes.find((item): item is CompositeScene => item.id === sceneId && item.renderMode === 'composite') || project.scenes.find((item): item is CompositeScene => item.renderMode === 'composite');
  sceneRef.current = scene;
  const selectedLayer = scene?.layers.find((layer) => layer.id === selectedLayerId);
  const selectedAsset = selectedLayer?.assetId ? project.assets.find((asset) => asset.id === selectedLayer.assetId) : undefined;
  const selectedCharacter = characterOptions.find((asset) => asset.id === selectedCharacterAssetId);
  const storyCastReferenceAssets = (project.storyCastReferenceAssetIds || []).map((id) => project.assets.find((asset) => asset.id === id)).filter((asset): asset is AnimationAsset => Boolean(asset));
  const thumbnailAssets = project.assets.filter((asset) => asset.tags?.includes('youtube-thumbnail'));
  const videoHasNarration = project.scenes.some((item) => item.renderMode === 'composite' && Boolean(String(item.narration || '').trim()));
  const directorAssignment = capabilityAssignments(settings, 'translation')[0];
  const directorProvider = providers.find((item) => item.id === directorAssignment?.providerId);
  const usingFlowAgentAssets = imageProviderId === 'flow-agent';
  const gptImageModelChoices = ima2GptStatus?.modelChoices?.length ? ima2GptStatus.modelChoices : [GPT_IMAGE_MODEL];
  const selectedGptImageModel = gptImageModelChoices.includes(gptImageModel) ? gptImageModel : gptImageModelChoices[0] || GPT_IMAGE_MODEL;
  const imageProvider = usingFlowAgentAssets ? undefined : imageProviderId === GPT_IMAGE_PROVIDER.id ? GPT_IMAGE_PROVIDER : providers.find((item) => item.id === imageProviderId)
    || providers.find((item) => item.enabled && item.models.some((model) => model.id === imageModel))
    || directorProvider;
  const ttsAssignment = capabilityAssignments(settings, 'tts')[0]; const ttsProvider = providers.find((item) => item.id === ttsAssignment?.providerId);
  const compositeScenes = project.scenes.filter((item): item is CompositeScene => item.renderMode === 'composite');
  const totalDurationMs = compositeScenes.reduce((total, item) => total + item.durationMs, 0);
  const sceneIndex = compositeScenes.findIndex((item) => item.id === scene?.id);
  const sceneOffsetMs = (targetId: string) => compositeScenes.slice(0, Math.max(0, compositeScenes.findIndex((item) => item.id === targetId))).reduce((total, item) => total + item.durationMs, 0);

  useEffect(() => { void api.listAnimationAssets(assetQuery).then(setLibraryAssets).catch(() => setLibraryAssets([])); }, [assetQuery]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => void api.flowAgentStatus().then((status) => { if (mounted) setFlowAgent(status); }).catch(() => { if (mounted) setFlowAgent(undefined); });
    refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let mounted = true;
    const refresh = () => void api.ima2GptImageStatus().then((status) => { if (mounted) setIma2GptStatus(status); }).catch(() => { if (mounted) setIma2GptStatus(undefined); });
    refresh(); const timer = window.setInterval(refresh, 8000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { if (!persisted) return; const timer = setTimeout(() => { void api.saveAnimationProject(project).catch(() => undefined); }, 1500); return () => clearTimeout(timer); }, [persisted, project]);

  useEffect(() => {
    if (!playing || !sceneRef.current) return;
    startedAt.current = performance.now() - (sequenceMode ? sequenceTimeMs : timeMs);
    lastPreviewFrameAt.current = 0;
    let frame = 0;
    const tick = (timestamp: number) => {
      if (lastPreviewFrameAt.current && timestamp - lastPreviewFrameAt.current < 1000 / Math.max(1, project.fps)) { frame = requestAnimationFrame(tick); return; }
      lastPreviewFrameAt.current = timestamp;
      const next = timestamp - startedAt.current;
      if (sequenceMode) {
        if (next >= totalDurationMs) { const lastScene = compositeScenes.at(-1); setSequenceTimeMs(totalDurationMs); setTimeMs(lastScene?.durationMs || 0); if (sequencePlayheadRef.current) sequencePlayheadRef.current.style.left = '100%'; setPlaying(false); return; }
        let offset = 0; const active = compositeScenes.find((item) => { const inside = next < offset + item.durationMs; if (!inside) offset += item.durationMs; return inside; });
        if (active) { if (active.id !== sceneRef.current?.id) { setSceneId(active.id); setSelectedLayerId(''); } setTimeMs(next - offset); setSequenceTimeMs(next); if (sequencePlayheadRef.current) sequencePlayheadRef.current.style.left = `${next / Math.max(1, totalDurationMs) * 100}%`; }
        frame = requestAnimationFrame(tick); return;
      }
      const currentScene = sceneRef.current;
      if (!currentScene) return;
      if (next >= currentScene.durationMs) { setTimeMs(currentScene.durationMs); setPlaying(false); return; }
      setTimeMs(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, sequenceMode, totalDurationMs, project.fps]);

  useEffect(() => {
    if (!ttsProvider) { setTtsVoices([]); return; }
    const fallback = ttsProvider.providerType === 'hiiu-tts'
      ? ttsProvider.models.map((model) => ({ id: model.id, name: model.name }))
      : (ttsProvider.voices || []);
    setTtsVoices(fallback);
    const controller = new AbortController();
    void api.listVoices(ttsProvider, controller.signal).then(({ voices }) => { if (voices.length) setTtsVoices(voices); }).catch(() => undefined);
    return () => controller.abort();
  }, [ttsProvider]);

  useEffect(() => {
    ttsTestRequestRef.current += 1;
    const audio = ttsTestAudioRef.current;
    ttsTestAudioRef.current = null;
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); }
    if (ttsTestUrlRef.current) URL.revokeObjectURL(ttsTestUrlRef.current);
    ttsTestUrlRef.current = null;
    setTestingTtsVoice(false);
    return () => {
      ttsTestRequestRef.current += 1;
      const current = ttsTestAudioRef.current;
      if (current) { current.onended = null; current.onerror = null; current.pause(); current.removeAttribute('src'); current.load(); }
      if (ttsTestUrlRef.current) URL.revokeObjectURL(ttsTestUrlRef.current);
      ttsTestAudioRef.current = null;
      ttsTestUrlRef.current = null;
    };
  }, [ttsProvider?.id, ttsAssignment?.model, ttsVoice]);

  useEffect(() => { const firstVoice = ttsVoices[0]; if (firstVoice && !ttsVoices.some((voice) => voice.id === ttsVoice)) setTtsVoice(firstVoice.id); }, [ttsVoices, ttsVoice]);

  useEffect(() => {
    if (!presentationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPresentationOpen(false); setPlaying(false); } };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [presentationOpen]);

  useEffect(() => {
    let disposed = false;
    void api.listAnimationProjects()
      .then((items) => { if (!disposed) setSavedProjects(items); })
      .catch(() => { /* the project menu can retry explicitly */ });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!characterPreview && !projectsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (characterPreview) setCharacterPreview(undefined);
      else setProjectsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    if (characterPreview) requestAnimationFrame(() => characterPreviewCloseRef.current?.focus());
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [characterPreview, projectsOpen]);

  useEffect(() => {
    previewAudioRef.current.forEach((audio) => audio.pause());
    previewAudioRef.current = [];
    if (!playing || !scene) return;
    const previewTimeMs = sequenceMode ? sequenceTimeMs : timeMs;
    const audioEntries = sequenceMode
      ? compositeScenes.flatMap((sequenceScene) => {
        const offsetMs = sceneOffsetMs(sequenceScene.id);
        return sequenceScene.layers.filter((layer) => layer.type === 'audio' && layer.assetId).map((layer) => ({ layer, scene: sequenceScene, startMs: offsetMs + (layer.startMs || 0) }));
      })
      : scene.layers.filter((layer) => layer.type === 'audio' && layer.assetId).map((layer) => ({ layer, scene, startMs: layer.startMs || 0 }));
    const timers: number[] = []; const audioElements = audioEntries.flatMap(({ layer, scene: audioScene, startMs }) => {
      const asset = project.assets.find((item) => item.id === layer.assetId);
      if (!asset) return [];
      const audio = new Audio(); audio.preload = 'auto'; audio.src = asset.uri; audio.load(); const isMusic = asset.tags.some((tag) => /^(?:music|bgm|nhac)$/i.test(tag)); const hasVoiceover = audioScene.layers.some((item) => item.type === 'audio' && item.name.startsWith('Voiceover ·')); audio.volume = Math.max(0, Math.min(1, (layer.volume ?? layer.transform.opacity) * (isMusic && hasVoiceover ? .3 : 1))); const play = () => { audio.currentTime = Math.max(0, (previewTimeMs - startMs) / 1000); void audio.play().catch(() => undefined); }; if (previewTimeMs >= startMs) play(); else timers.push(window.setTimeout(play, startMs - previewTimeMs)); return [audio];
    });
    previewAudioRef.current = audioElements;
    return () => { timers.forEach(clearTimeout); audioElements.forEach((audio) => audio.pause()); };
  }, [playing, sequenceMode]);

  const updateScene = (change: (current: CompositeScene) => CompositeScene) => {
    if (!scene) return;
    setProject((current) => ({ ...current, scenes: current.scenes.map((item) => item.id === scene.id ? change(item as CompositeScene) : item), updatedAt: now() }));
  };
  const updateLayer = (layerId: string, change: Partial<SceneLayer>) => updateScene((current) => ({ ...current, layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, ...change } : layer) }));
  const addScene = () => { const id = makeId('scene'); const preset = project.transitionPreset || { type: 'cut' as const, durationMs: 0 }; const next: CompositeScene = { id, name: `Cảnh ${project.scenes.length + 1}`, order: project.scenes.length, durationMs: 5000, narration: '', transition: preset.type === 'cut' ? { type: 'cut', durationMs: 0 } : preset, renderMode: 'composite', backgroundColor: '#07111f', layers: [], commands: [], camera: { transform: defaultTransform(), commands: [] } }; setProject((current) => ({ ...current, scenes: [...current.scenes, next], updatedAt: now() })); setSceneId(id); setSelectedLayerId(''); setTimeMs(0); };
  const updateTransform = (key: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', value: number) => {
    if (!selectedLayer) return;
    const transform = { ...selectedLayer.transform, position: { ...selectedLayer.transform.position }, scale: { ...selectedLayer.transform.scale }, anchor: { ...selectedLayer.transform.anchor } };
    if (key === 'x' || key === 'y') transform.position[key] = value;
    else if (key === 'scale') transform.scale = { x: value, y: value };
    else transform[key] = value;
    updateLayer(selectedLayer.id, { transform });
  };
  const deleteLayer = () => {
    if (!selectedLayer) return;
    updateScene((current) => ({ ...current, layers: current.layers.filter((layer) => layer.id !== selectedLayer.id), commands: current.commands.filter((command) => command.targetId !== selectedLayer.id) }));
    setSelectedLayerId('');
  };
  const addImage = async (file?: File) => {
    if (!scene || !file || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const uploaded = await api.uploadMedia(file);
      const assetId = makeId('asset');
      const layerId = makeId('image');
      const bitmap = await createImageBitmap(file);
      const naturalWidth = bitmap.width;
      const naturalHeight = bitmap.height;
      const maxWidth = 620;
      const ratio = Math.min(1, maxWidth / naturalWidth);
      bitmap.close();
      const layer: SceneLayer = { id: layerId, name: file.name, type: 'image', assetId, visible: true, locked: false, zIndex: scene.layers.length + 1, width: Math.max(1, Math.round(naturalWidth * ratio)), height: Math.max(1, Math.round(naturalHeight * ratio)), transform: { ...defaultTransform(), position: { x: project.width / 2, y: project.height / 2 } } };
      const asset: AnimationAsset = { id: assetId, type: 'image', name: file.name, uri: animationAssetUrl(uploaded.uploadId), tags: [], width: naturalWidth, height: naturalHeight, createdAt: now() };
      await api.registerAnimationAsset(asset); setLibraryAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      setProject((current) => ({ ...current, assets: [...current.assets, asset], scenes: current.scenes.map((item) => item.id === scene.id && item.renderMode === 'composite' ? { ...item, layers: [...item.layers, layer] } : item), updatedAt: now() }));
      setSelectedLayerId(layerId);
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể thêm ảnh.'), 'error'); }
    finally { setUploading(false); }
  };
  const addAudio = async (file?: File) => {
    if (!scene || !file || !file.type.startsWith('audio/')) return;
    setUploading(true);
    try {
      const uploaded = await api.uploadMedia(file); const assetId = makeId('asset'); const layerId = makeId('audio');
      const asset: AnimationAsset = { id: assetId, type: 'audio', name: file.name, uri: animationAssetUrl(uploaded.uploadId), tags: ['audio'], createdAt: now() };
      await api.registerAnimationAsset(asset); setLibraryAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      setProject((current) => ({ ...current, assets: [...current.assets, asset], scenes: current.scenes.map((item) => item.id === scene.id && item.renderMode === 'composite' ? { ...item, layers: [...item.layers, { id: layerId, name: file.name, type: 'audio', assetId, visible: true, locked: false, zIndex: item.layers.length + 1, width: 1, height: 1, transform: defaultTransform() }] } : item), updatedAt: now() }));
      setSelectedLayerId(layerId);
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể thêm audio.'), 'error'); }
    finally { setUploading(false); }
  };
  const reuseAsset = (asset: AnimationAsset) => {
    if (!scene || !['image', 'background', 'audio'].includes(asset.type)) return;
    const layerId = makeId(asset.type === 'audio' ? 'audio' : 'image'); const isAudio = asset.type === 'audio'; const isBackground = asset.type === 'background';
    const layer: SceneLayer = { id: layerId, name: asset.name, type: isAudio ? 'audio' : asset.type === 'sprite' || asset.sprite ? 'sprite' : 'image', assetId: asset.id, visible: true, locked: isBackground, zIndex: isBackground ? 0 : scene.layers.length + 1, width: isAudio ? 1 : isBackground ? project.width : Math.min(asset.sprite?.frameWidth || asset.width || 560, 760), height: isAudio ? 1 : isBackground ? project.height : Math.min(asset.sprite?.frameHeight || asset.height || 560, 760), animation: asset.animations?.[0] || (asset.sprite ? Object.keys(asset.sprite.clips)[0] : undefined), characterId: asset.type === 'character' ? asset.id : undefined, transform: { ...defaultTransform(), position: { x: project.width / 2, y: project.height / 2 } } };
    setProject((current) => ({ ...current, assets: current.assets.some((item) => item.id === asset.id) ? current.assets : [...current.assets, asset], scenes: current.scenes.map((item) => item.id === scene.id && item.renderMode === 'composite' ? { ...item, layers: [...(isBackground ? item.layers.filter((candidate) => !(candidate.type === 'image' && candidate.locked && candidate.zIndex === 0)) : item.layers), layer] } : item), updatedAt: now() })); setSelectedLayerId(layerId);
  };
  const selectedAssetGeneration = () => {
    const reference = characterReference?.uploadId
      ? { referenceUploadId: characterReference.uploadId }
      : selectedCharacterAssetId ? { referenceAssetId: selectedCharacterAssetId } : {};
    const appearance = Object.keys(reference).length && characterAppearanceLock.trim() ? { characterAppearanceLock: characterAppearanceLock.trim() } : {};
    return usingFlowAgentAssets ? { generator: 'flow-agent' as const, model: 'narwhal', ...reference, ...appearance } : imageProvider ? { provider: imageProvider, model: imageModel, ...reference, ...appearance } : undefined;
  };
  const uploadCharacterReference = async (file?: File) => {
    if (!file?.type.startsWith('image/')) return;
    setPreparingCharacters(true); setDirectorError('');
    try {
      const uploaded = await api.uploadMedia(file);
      setCharacterReference({ uploadId: uploaded.uploadId, name: file.name });
      setCharacterOptions([]); setSelectedCharacterAssetId('');
    } catch (error) { setDirectorError(friendlyErrorMessage(error, 'Không thể tải ảnh nhân vật.')); }
    finally { setPreparingCharacters(false); }
  };
  const prepareCharacterOptions = async () => {
    if (!directorProvider || !directorAssignment?.model) { setDirectorError('Hãy cấu hình provider/model AI trước.'); return; }
    if (imageProviderId === GPT_IMAGE_PROVIDER.id && !ima2GptStatus?.connected) { setDirectorError('GPT Image chưa kết nối. Vào Cài đặt → GPT Image để đăng nhập ChatGPT trước.'); return; }
    const generation = selectedAssetGeneration();
    if (!generation) { setDirectorError('Hãy chọn provider tạo ảnh.'); return; }
    if (!usingFlowAgentAssets && imageProviderId !== GPT_IMAGE_PROVIDER.id) { setDirectorError('Hiện chức năng tạo bộ lựa chọn nhân vật cần Nano Banana 2 hoặc GPT Image đã kết nối.'); return; }
    characterGenerationRef.current?.abort();
    const controller = new AbortController();
    characterGenerationRef.current = controller;
    setPreparingCharacters(true); setDirectorError('');
    try {
      const options = await api.generateAnimationCharacterOptions({ brief, provider: directorProvider, model: directorAssignment.model, assetGeneration: generation, width: project.width, height: project.height }, controller.signal);
      setCharacterOptions(options); setSelectedCharacterAssetId('');
    } catch (error) { if (!controller.signal.aborted) setDirectorError(friendlyErrorMessage(error, 'Không thể tạo bốn lựa chọn nhân vật.')); }
    finally { if (characterGenerationRef.current === controller) { characterGenerationRef.current = null; setPreparingCharacters(false); } }
  };
  const cancelCharacterOptions = () => { characterGenerationRef.current?.abort(); characterGenerationRef.current = null; setPreparingCharacters(false); setDirectorError('Đã dừng lượt tạo nhân vật.'); };
  const generateThumbnails = async () => {
    if (!directorProvider || !directorAssignment?.model) { setDirectorError('Hãy cấu hình provider/model AI trước khi tạo thumbnail.'); return; }
    const generation = selectedAssetGeneration();
    if (!generation) { setDirectorError('Hãy chọn provider tạo ảnh trước khi tạo thumbnail.'); return; }
    if (imageProviderId === GPT_IMAGE_PROVIDER.id && !ima2GptStatus?.connected) { setDirectorError('GPT Image chưa kết nối. Vào Cài đặt → GPT Image để đăng nhập ChatGPT trước.'); return; }
    if (usingFlowAgentAssets && !flowAgent?.connected) { setDirectorError('Nano Banana 2 chưa sẵn sàng. Hãy mở Google Flow rồi thử lại.'); return; }
    if (!videoHasNarration) { setDirectorError('Hãy dựng video có narration trước để AI hiểu toàn bộ nội dung và tạo thumbnail.'); return; }
    setGeneratingThumbnails(true); setDirectorError('');
    try {
      const oldThumbnailIds = new Set(thumbnailAssets.map((asset) => asset.id));
      const assets = await api.generateAnimationThumbnails({ project, brief, provider: directorProvider, model: directorAssignment.model, assetGeneration: generation, count: 3 });
      setLibraryAssets((current) => [
        ...assets,
        ...current.filter((item) => !oldThumbnailIds.has(item.id) && !assets.some((asset) => asset.id === item.id)),
      ]);
      setProject((current) => {
        const kept = current.assets.filter((asset) => !asset.tags?.includes('youtube-thumbnail'));
        return { ...current, assets: [...kept, ...assets], thumbnailAssetId: assets[0]?.id, updatedAt: now() };
      });
      setSetupOpen(true);
      window.requestAnimationFrame(() => document.getElementById('animation-thumbnail-tool')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      onNotice(`Đã tạo ${assets.length} phương án thumbnail từ toàn bộ nội dung video.`);
    } catch (error) { setDirectorError(friendlyErrorMessage(error, 'Không thể tạo thumbnail.')); }
    finally { setGeneratingThumbnails(false); }
  };
  const generateAsset = async () => {
    const generation = selectedAssetGeneration();
    if (!generation) { onNotice('Hãy chọn provider tạo ảnh trước.', 'error'); return; }
    if (usingFlowAgentAssets && !flowAgent?.connected) { onNotice('Flow Agent chưa sẵn sàng. Hãy mở Google Flow và tải lại tab.', 'error'); return; }
    setGeneratingAsset(true);
    try { const ratio = project.width > project.height ? '16:9 landscape' : project.width < project.height ? '9:16 portrait' : '1:1 square'; const asset = await api.generateAnimationAsset({ prompt: `${assetPrompt}. Full-frame ${ratio}, no borders, no letterboxing, no text`, ...generation, type: 'background', width: project.width, height: project.height }); setLibraryAssets((current) => [asset, ...current]); setAssetPrompt(''); reuseAsset(asset); onNotice(`Đã tạo asset đúng tỷ lệ ${ratio.split(' ')[0]} và thêm vào scene.`); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo asset.'), 'error'); }
    finally { setGeneratingAsset(false); }
  };
  const updateAssetMetadata = async (change: Partial<Pick<AnimationAsset, 'name' | 'tags' | 'style' | 'animations'>>) => {
    if (!selectedAsset) return;
    try { await api.registerAnimationAsset(selectedAsset); const asset = await api.updateAnimationAsset(selectedAsset.id, change); setLibraryAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]); setProject((current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? asset : item), updatedAt: now() })); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể cập nhật metadata asset.'), 'error'); }
  };
  const refreshSavedProjects = async () => {
    setLoadingProjects(true);
    try { setSavedProjects(await api.listAnimationProjects()); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể đọc danh sách project đã lưu.'), 'error'); }
    finally { setLoadingProjects(false); }
  };
  const clearDirectorSession = () => {
    setDirectorJob(undefined); setDirectorJobId(''); setDirecting(false); setDirectorError(''); setDirectorWarning('');
    try { localStorage.removeItem('autosub.animation-director-job-id'); } catch { /* optional browser persistence */ }
  };
  const replaceCurrentProject = (nextProject: AnimationProject, isPersisted: boolean) => {
    setProject(nextProject); setSceneId(nextProject.scenes.find((item) => item.renderMode === 'composite')?.id || nextProject.scenes[0]?.id || '');
    setSelectedLayerId(''); setTimeMs(0); setSequenceTimeMs(0); setSequenceMode(false); setPlaying(false);
    setPersisted(isPersisted); setHistoryOpen(false); setProjectsOpen(false); setCharacterReference(undefined); setCharacterOptions([]); setSelectedCharacterAssetId(''); setCharacterPreview(undefined);
    clearDirectorSession();
  };
  const canReplaceCurrentProject = () => persisted || (!brief.trim() && project.scenes.length === 1) || window.confirm('Project hiện tại chưa được lưu. Bạn có muốn đóng và tiếp tục không?');
  const createNewProject = () => {
    if (!canReplaceCurrentProject()) return;
    setBrief(''); replaceCurrentProject(storyboardProject(), false); onNotice('Đã mở project mới.');
  };
  const closeCurrentProject = () => {
    if (!canReplaceCurrentProject()) return;
    setBrief(''); replaceCurrentProject(storyboardProject(), false); onNotice('Đã đóng project hiện tại.');
  };
  const openSavedProject = async (id: string) => {
    if (id === project.id) { setProjectsOpen(false); return; }
    if (!canReplaceCurrentProject()) return;
    setLoadingProjects(true);
    try { const opened = await api.getAnimationProject(id); setBrief(''); replaceCurrentProject(opened, true); onNotice(`Đã mở project “${opened.name}”.`); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể mở project đã lưu.'), 'error'); }
    finally { setLoadingProjects(false); }
  };
  const save = async () => {
    setSaving(true);
    try {
      let value = project;
      if (!persisted) {
        const created = await api.createAnimationProject({ name: project.name, width: project.width, height: project.height, fps: project.fps });
        value = { ...project, id: created.id, createdAt: created.createdAt, updatedAt: created.updatedAt };
      }
      const saved = await api.saveAnimationProject(value);
      setProject(saved); setPersisted(true); void api.listAnimationProjectVersions(saved.id).then(setVersions); void api.listAnimationProjects().then(setSavedProjects); onNotice('Đã lưu project Animation Studio.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể lưu project.'), 'error'); }
    finally { setSaving(false); }
  };
  const direct = async () => {
    const requestedMinutes = Number(targetMinutes.replace(',', '.'));
    if (durationMode === 'fixed' && (!Number.isFinite(requestedMinutes) || requestedMinutes <= 0)) {
      setDirectorError('Hãy nhập thời lượng video lớn hơn 0 phút.');
      return;
    }
    if (!directorProvider || !directorAssignment?.model) {
      const message = 'Hãy cấu hình provider/model AI trong Cài đặt → Default Models.';
      setDirectorError(message);
      return;
    }
    if (autoGenerateAssets && imageProviderId === GPT_IMAGE_PROVIDER.id && !ima2GptStatus?.connected) { setDirectorError('GPT Image chưa kết nối. Vào Cài đặt → GPT Image để đăng nhập ChatGPT trước.'); return; }
    if (!ttsProvider || !ttsAssignment?.model) { setDirectorError('Hãy cấu hình provider/model TTS để tool tự tạo voiceover.'); return; }
    if (ttsProvider.providerType === 'kokoro-local' && isLikelyVietnamese(brief)) { setDirectorError('Kokoro hiện có giọng tiếng Anh. Ý tưởng đang viết bằng tiếng Việt; hãy dùng VieNeu Local hoặc đổi brief sang tiếng Anh.'); return; }
    if (autoGenerateAssets && !characterReference && !selectedCharacterAssetId) { await prepareCharacterOptions(); return; }
    const selectedVoice = ttsVoice || ttsProvider.voices?.[0]?.id || '';
    setDirectorError(''); setDirectorWarning(''); setDirecting(true);
    try {
      const assetGeneration = autoGenerateAssets ? selectedAssetGeneration() : undefined;
      const job = await api.startAnimationDirectorJob({ brief, project, provider: directorProvider, model: directorAssignment.model, ...(durationMode === 'fixed' ? { targetDurationSeconds: Math.round(requestedMinutes * 60) } : {}), narration: { provider: ttsProvider, model: ttsAssignment.model, voice: selectedVoice, speed: 1 }, ...(assetGeneration ? { assetGeneration } : {}) });
      autoOpenDirector.current = true;
      setDirectorJob(job); setDirectorJobId(job.id);
      try { localStorage.setItem('autosub.animation-director-job-id', job.id); } catch { /* server result is still retained */ }
    } catch (error) { setDirectorError(friendlyErrorMessage(error, 'AI Director không thể dựng scene.')); setDirecting(false); }
  };
  const retryMissingImages = async () => {
    const generation = selectedAssetGeneration();
    if (!generation || !directorProvider || !directorAssignment?.model) { setDirectorError('Thiếu cấu hình AI hoặc provider tạo ảnh để tạo lại ảnh lỗi.'); return; }
    if (imageProviderId === GPT_IMAGE_PROVIDER.id && !ima2GptStatus?.connected) { setDirectorError('GPT Image chưa kết nối. Vào Cài đặt → GPT Image để đăng nhập ChatGPT trước.'); return; }
    setRetryingMissingImages(true); setDirectorError('');
    try {
      const result = await api.retryMissingAnimationImages({ project, assetGeneration: generation, provider: directorProvider, model: directorAssignment.model });
      setProject(result.project);
      setDirectorWarning(result.project.generationWarnings?.join('\n') || '');
      onNotice(result.remaining ? `Đã tạo lại ${result.repaired} ảnh; còn ${result.remaining} ảnh lỗi.` : `Đã tạo lại đầy đủ ${result.repaired} ảnh lỗi.`, result.remaining ? 'error' : 'success');
    } catch (error) { setDirectorError(friendlyErrorMessage(error, 'Không thể tạo lại ảnh lỗi.')); }
    finally { setRetryingMissingImages(false); }
  };
  const applyDirectorProject = (directed: AnimationProject) => {
    setProject(directed); setSceneId(directed.scenes[0]?.id || ''); setSelectedLayerId('');
    setTimeMs(0); setSequenceTimeMs(0); setSequenceMode(false); setPlaying(false); setPersisted(false);
    setDirectorWarning(directed.generationWarnings?.filter((warning) => !warning.startsWith('Timing được đo theo từng câu TTS')).join('\n') || '');
    onNotice(`AI Director đã dựng ${directed.scenes.length} scene có thể chỉnh sửa.`);
  };
  const restoreDirectorResult = async () => {
    if (!directorJob) return;
    try { applyDirectorProject(await api.animationDirectorResult(directorJob.id)); }
    catch (error) { setDirectorError(friendlyErrorMessage(error, 'Không đọc được kết quả.')); }
  };
  const resumeDirector = async () => {
    if (!directorJob) return;
    if (directorJob.status === 'interrupted' && !window.confirm('Backend đã dừng giữa chừng. Hãy kiểm tra Flow không còn tác vụ đang chạy hoặc kết quả chưa được tải về. Chỉ tiếp tục sau khi kiểm tra để tránh tạo trùng. Bạn đã kiểm tra chưa?')) return;
    try {
      const input = await api.animationDirectorInput(directorJob.id);
      const currentProvider = (id: string) => { if (id === GPT_IMAGE_PROVIDER.id) return GPT_IMAGE_PROVIDER; const found = providers.find((item) => item.id === id && item.enabled); if (!found) throw new Error('Provider của job không còn sẵn sàng. Kiểm tra Cài đặt.'); return found; };
      input.provider = currentProvider(input.provider.id);
      if (input.narration) input.narration.provider = currentProvider(input.narration.provider.id);
      if (input.assetGeneration?.provider) input.assetGeneration.provider = currentProvider(input.assetGeneration.provider.id);
      const job = await api.startAnimationDirectorJob(input, directorJob.id);
      autoOpenDirector.current = true; setDirectorJob(job); setDirecting(true); setDirectorError('');
      // Resume uses the same id; reset the polling effect explicitly.
      setDirectorPollRevision((value) => value + 1);
    } catch (error) { setDirectorError(friendlyErrorMessage(error, 'Không tiếp tục được job.')); }
  };
  const cancelDirector = async () => {
    if (!directorJob) return;
    try { setDirectorJob(await api.cancelAnimationDirectorJob(directorJob.id)); }
    catch (error) { setDirectorError(friendlyErrorMessage(error, 'Không gửi được yêu cầu dừng.')); }
  };
  const editWithAi = async (mode: 'edit' | 'visual' = 'edit') => {
    if (!scene || !directorProvider || !directorAssignment?.model) { onNotice('Chưa có scene hoặc provider/model AI.', 'error'); return; } setEditingWithAi(true);
    const instruction = mode === 'visual' ? 'Regenerate the visual composition using available AI images while preserving timing and narration. Do not add animation, camera motion, transitions, text, icons or shapes.' : editInstruction;
    try { const edited = await api.editAnimationScene({ instruction, project, sceneId: scene.id, provider: directorProvider, model: directorAssignment.model, mode }); setProject(edited); if (mode === 'edit') setEditInstruction(''); setSelectedLayerId(''); onNotice(mode === 'visual' ? 'Đã đổi hình ảnh, giữ nguyên timing và narration.' : 'AI đã sửa Scene JSON, các layer vẫn chỉnh được.'); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'AI không thể sửa scene.'), 'error'); } finally { setEditingWithAi(false); }
  };
  const checkQuality = async () => { try { const result = await api.checkAnimationQuality(project); setQualityIssues(result.issues); onNotice(result.issues.length ? `Quality Checker tìm thấy ${result.issues.length} vấn đề.` : 'Quality Checker: project đạt kiểm tra cơ bản.', result.issues.some((item) => item.severity === 'error') ? 'error' : 'success'); } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể kiểm tra project.'), 'error'); } };
  const fixQuality = async () => { try { const result = await api.fixAnimationQuality(project); setProject(result.project); setQualityIssues(result.remaining); onNotice(`Đã tự sửa ${result.fixed} vấn đề; còn ${result.remaining.length}.`, result.remaining.some((item) => item.severity === 'error') ? 'error' : 'success'); } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tự sửa project.'), 'error'); } };
  const editWholeProject = async () => { if (!directorProvider || !directorAssignment?.model || editInstruction.trim().length < 4) return; setEditingWithAi(true); try { const edited = await api.editAnimationProject({ instruction: editInstruction, project, provider: directorProvider, model: directorAssignment.model }); setProject(edited); setEditInstruction(''); setSelectedLayerId(''); onNotice('AI đã áp dụng lệnh cho toàn bộ composite scene.'); } catch (error) { onNotice(friendlyErrorMessage(error, 'AI không thể sửa toàn project.'), 'error'); } finally { setEditingWithAi(false); } };
  const relayout = (width: number, height: number) => { const ratioX = width / project.width, ratioY = height / project.height, objectScale = Math.min(ratioX, ratioY); setProject((current) => ({ ...current, width, height, scenes: current.scenes.map((item) => item.renderMode !== 'composite' ? item : { ...item, layers: item.layers.map((layer) => layer.type === 'audio' ? layer : { ...layer, width: layer.type === 'image' && layer.locked ? width : Math.max(1, Math.round(layer.width * (layer.type === 'text' || layer.type === 'chart' ? ratioX : objectScale))), height: layer.type === 'image' && layer.locked ? height : Math.max(1, Math.round(layer.height * objectScale)), fontSize: layer.fontSize ? Math.max(12, Math.round(layer.fontSize * objectScale)) : layer.fontSize, transform: { ...layer.transform, position: { x: Math.round(layer.transform.position.x * ratioX), y: Math.round(layer.transform.position.y * ratioY) } } }), commands: item.commands.map((command) => command.type === 'MOVE' && typeof command.from === 'object' && typeof command.to === 'object' ? { ...command, from: { x: command.from.x * ratioX, y: command.from.y * ratioY }, to: { x: command.to.x * ratioX, y: command.to.y * ratioY } } : command) }), updatedAt: now() })); setSelectedLayerId(''); setTimeMs(0); onNotice(`Đã smart re-layout project sang ${width}:${height}.`); };
  const createVoiceover = async () => { if (!ttsProvider || !ttsAssignment?.model) { onNotice('Hãy cấu hình TTS provider/model.', 'error'); return; } if (ttsProvider.providerType === 'kokoro-local' && project.scenes.some((item) => isLikelyVietnamese(String(item.narration || '')))) { onNotice('Kokoro chỉ có giọng tiếng Anh; narration hiện có vẻ là tiếng Việt. Hãy chọn VieNeu Local hoặc một giọng Việt.', 'error'); return; } setCreatingVoiceover(true); try { const narrated = await api.generateAnimationNarration({ project, provider: ttsProvider, model: ttsAssignment.model, voice: ttsVoice, speed: 1 }); setProject(narrated); onNotice('Đã tạo voiceover và gắn audio layer cho từng scene.'); } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo voiceover.'), 'error'); } finally { setCreatingVoiceover(false); } };
  const testTtsVoice = async () => {
    if (!ttsProvider || !ttsAssignment?.model || !ttsVoice) { onNotice('Hãy chọn provider, model và giọng đọc trước.', 'error'); return; }
    const requestId = ++ttsTestRequestRef.current;
    setTestingTtsVoice(true);
    try {
      const blob = await loadVoicePreview(ttsProvider, ttsAssignment.model, ttsVoice, 1);
      if (requestId !== ttsTestRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsTestAudioRef.current = audio;
      ttsTestUrlRef.current = url;
      const release = () => {
        if (ttsTestAudioRef.current !== audio) return;
        ttsTestAudioRef.current = null;
        ttsTestUrlRef.current = null;
        URL.revokeObjectURL(url);
        setTestingTtsVoice(false);
      };
      audio.onended = release;
      audio.onerror = release;
      await audio.play();
    } catch (error) {
      if (requestId === ttsTestRequestRef.current) {
        setTestingTtsVoice(false);
        onNotice(friendlyErrorMessage(error, 'Không thể tạo bản nghe thử.'), 'error');
      }
    }
  };
  const toggleHistory = async () => { if (!persisted) { onNotice('Hãy lưu project lần đầu để sử dụng lịch sử.', 'error'); return; } const next = !historyOpen; setHistoryOpen(next); if (next) setVersions(await api.listAnimationProjectVersions(project.id)); };
  const restoreVersion = async (versionId: string) => { try { const restored = await api.restoreAnimationProjectVersion(project.id, versionId); setProject(restored); setSceneId(restored.scenes[0]?.id || ''); setSelectedLayerId(''); setTimeMs(0); setHistoryOpen(false); onNotice('Đã khôi phục version project.'); } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể khôi phục version.'), 'error'); } };
  const exportJson = () => { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'animation-project'}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const exportSrt = () => {
    let cueNumber = 1; const cues: string[] = [];
    const renderRanges = buildRenderTimeline(project);
    for (const item of compositeScenes) {
      const range = renderRanges.find((candidate) => candidate.scene.id === item.id);
      const offsetMs = range ? Math.round(range.from / Math.max(1, project.fps) * 1000) : 0;
      const subtitle = item.layers.find((layer) => layer.type === 'text' && layer.name.startsWith('Voiceover · Subtitle'));
      if (subtitle?.captionTimings?.length) {
        for (const timing of subtitle.captionTimings) {
          cues.push(`${cueNumber++}\n${srtTimestamp(offsetMs + timing.startMs)} --> ${srtTimestamp(offsetMs + timing.endMs)}\n${timing.text}\n`);
        }
        continue;
      }
      const words = String(subtitle?.text || item.narration || '').trim().split(/\s+/).filter(Boolean);
      const groups = Array.from({ length: Math.ceil(words.length / 7) }, (_, index) => words.slice(index * 7, index * 7 + 7));
      let usedWords = 0;
      for (const group of groups) {
        const start = offsetMs + Math.round(item.durationMs * usedWords / Math.max(1, words.length));
        usedWords += group.length;
        const end = offsetMs + Math.round(item.durationMs * usedWords / Math.max(1, words.length));
        cues.push(`${cueNumber++}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${group.join(' ')}\n`);
      }
    }
    if (!cues.length) { onNotice('Project chưa có lời dẫn để xuất SRT.', 'error'); return; }
    const blob = new Blob([`\uFEFF${cues.join('\n')}`], { type: 'application/x-subrip;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'autosub-animation'}.srt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotice(`Đã xuất ${cues.length} cue phụ đề SRT.`);
  };
  const renderMp4 = async () => {
    const canvas = canvasRef.current;
    const compositeScenes = project.scenes.filter((item): item is CompositeScene => item.renderMode === 'composite');
    if (!compositeScenes.length) { onNotice('Project chưa có cảnh composite để xuất.', 'error'); return; }
    const renderKey = await animationProjectRenderCacheKey(project, false);
    renderSessionRef.current = { projectId: project.id, cacheKey: renderKey };
    setRendering(true); setRenderProgress(0); setPlaying(false); setSelectedLayerId('');
    try {
      try {
        const mp4 = await api.renderAnimationProjectFrameAccurate(project, false, (progress) => setRenderProgress(progress));
        const url = URL.createObjectURL(mp4); const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'autosub-animation'}.mp4`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        onNotice(`Đã xuất MP4 gồm ${compositeScenes.length} cảnh, ảnh AI tĩnh và voiceover.`);
        return;
      } catch (remotionError) {
        setRenderProgress((progress) => Math.max(progress, 5));
        onNotice(`Renderer mới chưa sẵn sàng, đang chuyển sang chế độ tương thích: ${friendlyErrorMessage(remotionError, 'Lỗi Remotion.')}`, 'error');
      }
      if (!canvas || typeof MediaRecorder === 'undefined') throw new Error('Renderer mới gặp lỗi và trình duyệt không hỗ trợ chế độ ghi Canvas dự phòng.');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const stream = canvas.captureStream(project.fps);
      const audioContext = new AudioContext(); const audioDestination = audioContext.createMediaStreamDestination(); const audioSources: AudioBufferSourceNode[] = [];
      let sceneOffsetSeconds = 0;
      for (const item of compositeScenes) {
        for (const layer of item.layers.filter((candidate) => candidate.type === 'audio' && candidate.assetId)) {
          const asset = project.assets.find((candidate) => candidate.id === layer.assetId); if (!asset) continue;
          const buffer = await fetch(asset.uri).then((response) => { if (!response.ok) throw new Error(`Không tải được audio ${asset.name}.`); return response.arrayBuffer(); }).then((value) => audioContext.decodeAudioData(value));
          const source = audioContext.createBufferSource(); const gain = audioContext.createGain(); const isMusic = asset.tags.some((tag) => /^(?:music|bgm|nhac)$/i.test(tag)); const hasVoiceover = item.layers.some((candidate) => candidate.type === 'audio' && candidate.name.startsWith('Voiceover ·')); gain.gain.value = Math.max(0, Math.min(1, (layer.volume ?? layer.transform.opacity) * (isMusic && hasVoiceover ? .3 : 1))); source.buffer = buffer; source.connect(gain).connect(audioDestination); const when = audioContext.currentTime + sceneOffsetSeconds + (layer.startMs || 0) / 1000; const duration = layer.durationMs ? Math.min(buffer.duration, layer.durationMs / 1000) : buffer.duration; source.start(when, 0, duration); audioSources.push(source);
        }
        sceneOffsetSeconds += item.durationMs / 1000;
      }
      if (audioSources.length) audioDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((value) => MediaRecorder.isTypeSupported(value)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 10_000_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error('Không thể ghi Canvas.')); });
      await audioContext.resume(); recorder.start(250);
      for (const item of compositeScenes) {
        setSceneId(item.id); setTimeMs(0);
        const started = performance.now();
        await new Promise<void>((resolve) => {
          const frame = (timestamp: number) => { const elapsed = timestamp - started; setTimeMs(Math.min(item.durationMs, elapsed)); if (elapsed >= item.durationMs) resolve(); else requestAnimationFrame(frame); };
          requestAnimationFrame(frame);
        });
      }
      recorder.requestData(); await new Promise<void>((resolve) => setTimeout(resolve, 100)); recorder.stop(); await stopped; audioSources.forEach((source) => { try { source.stop(); } catch { /* already ended */ } }); await audioContext.close(); stream.getTracks().forEach((track) => track.stop());
      const recording = new Blob(chunks, { type: 'video/webm' }); if (!recording.size) throw new Error('Trình duyệt không thu được khung hình. Hãy thử lại bằng Chrome hoặc Edge mới nhất.');
      const mp4 = await api.renderAnimationProject(project.id, recording, project, (progress) => setRenderProgress(Math.max(45, progress)));
      const url = URL.createObjectURL(mp4); const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'autosub-animation'}.mp4`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotice(`Đã xuất MP4 gồm ${compositeScenes.length} cảnh, ảnh AI tĩnh và voiceover.`);
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể render MP4.'), 'error'); }
    finally { renderSessionRef.current = undefined; setRendering(false); setRenderProgress(0); }
  };
  const seconds = useMemo(() => (timeMs / 1000).toFixed(1), [timeMs]);
  const sequenceSeconds = useMemo(() => (sequenceTimeMs / 1000).toFixed(1), [sequenceTimeMs]);
  const seekSequenceTime = (nextTimeMs: number) => {
    const point = Math.max(0, Math.min(totalDurationMs, nextTimeMs));
    let offset = 0;
    const target = compositeScenes.find((item) => {
      const inside = point < offset + item.durationMs || item === compositeScenes.at(-1);
      if (!inside) offset += item.durationMs;
      return inside;
    });
    if (!target) return;
    setPlaying(false);
    setSequenceMode(true);
    setSequenceTimeMs(point);
    setSceneId(target.id);
    setSelectedLayerId('');
    setTimeMs(Math.max(0, point - offset));
    if (sequencePlayheadRef.current) sequencePlayheadRef.current.style.left = `${point / Math.max(1, totalDurationMs) * 100}%`;
  };
  const seekSequenceAtPointer = (clientX: number) => {
    const lane = sequencePlayheadRef.current?.parentElement;
    if (!lane || !totalDurationMs) return;
    const rect = lane.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    seekSequenceTime(ratio * totalDurationMs);
  };
  const beginSequenceScrub = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sequenceScrubRef.current = { pointerId: event.pointerId, active: true };
    seekSequenceAtPointer(event.clientX);
  };
  const moveSequenceScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (!sequenceScrubRef.current.active || sequenceScrubRef.current.pointerId !== event.pointerId) return;
    seekSequenceAtPointer(event.clientX);
  };
  const endSequenceScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (sequenceScrubRef.current.pointerId === event.pointerId) sequenceScrubRef.current = { pointerId: -1, active: false };
  };
  const beginSequenceTrackScrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('button,[role="slider"]')) return;
    beginSequenceScrub(event);
  };
  const moveSequenceTrackScrub = (event: ReactPointerEvent<HTMLElement>) => moveSequenceScrub(event);
  const endSequenceTrackScrub = (event: ReactPointerEvent<HTMLElement>) => endSequenceScrub(event);
  const clickSequenceTrack = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('button,[role="slider"]')) return;
    seekSequenceAtPointer(event.clientX);
  };
  const handleSequenceScrubKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 10_000 : 1_000;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekSequenceTime(sequenceTimeMs + (event.key === 'ArrowLeft' ? -step : step));
    }
  };
  const jumpToSequenceScene = (targetId: string) => { const offset = sceneOffsetMs(targetId); seekSequenceTime(offset); };
  const toggleSequencePreview = () => { if (playing && sequenceMode) { setPlaying(false); return; } const restart = sequenceTimeMs >= totalDurationMs; if (restart) { setSequenceTimeMs(0); setSceneId(compositeScenes[0]?.id || sceneId); setTimeMs(0); } setSequenceMode(true); setPlaying(true); };
  const startPresentation = () => { const first = compositeScenes[0]; if (!first) return; setPresentationOpen(true); setSequenceMode(true); setSequenceTimeMs(0); setSceneId(first.id); setSelectedLayerId(''); setTimeMs(0); setPlaying(true); };
  const directorWarningTitle = /thiếu hình|không tạo được ảnh|lỗi phiên flow|ảnh minh họa/i.test(directorWarning)
    ? 'Video còn thiếu ảnh minh họa. Xem chi tiết'
    : /timing|forced alignment|căn thời gian/i.test(directorWarning)
      ? 'Lưu ý căn thời gian phụ đề. Xem chi tiết'
      : 'Có lưu ý chất lượng. Xem chi tiết';
  if (!scene) return <div className="animation-studio-page"><p>Project chưa có composite scene.</p></div>;

  return <section className={`animation-studio-page studio-preview-first${setupOpen ? ' setup-open' : ''}`} aria-label="Animation Studio">
    <header className="animation-toolbar">
      <div className="animation-project-title"><span>AI Storyboard</span><input aria-label="Tên project" value={project.name} onChange={(event) => setProject((current) => ({ ...current, name: event.target.value, updatedAt: now() }))} /></div>
      <div className="animation-toolbar-meta" aria-label="Thông số project"><span>{project.width} × {project.height}</span><span>{project.fps} FPS</span></div>
      <div className="animation-toolbar-actions">
        <div className="animation-project-menu">
          <button className="button quiet" type="button" aria-expanded={projectsOpen} aria-controls="animation-project-browser" onClick={() => { const next = !projectsOpen; setProjectsOpen(next); if (next) void refreshSavedProjects(); }}><BookOpen size={15} aria-hidden="true" /> Dự án{savedProjects.length ? ` (${savedProjects.length})` : ''}</button>
          {projectsOpen && <div id="animation-project-browser" className="animation-project-browser" role="dialog" aria-label="Project Animation Studio đã lưu">
            <div className="animation-project-browser-head"><strong>Project đã lưu</strong><button type="button" aria-label="Đóng danh sách project" onClick={() => setProjectsOpen(false)}><X size={15} aria-hidden="true" /></button></div>
            <div className="animation-project-browser-actions"><button type="button" onClick={createNewProject}><Plus size={14} aria-hidden="true" /> Project mới</button><button type="button" onClick={closeCurrentProject}>Đóng project</button><button type="button" aria-label="Tải lại danh sách project" disabled={loadingProjects} onClick={() => void refreshSavedProjects()}><RefreshCw size={14} aria-hidden="true" /></button></div>
            <div className="animation-project-list">{loadingProjects && !savedProjects.length ? <span>Đang tải project…</span> : savedProjects.length ? savedProjects.map((item) => <button type="button" key={item.id} className={item.id === project.id && persisted ? 'active' : ''} onClick={() => void openSavedProject(item.id)}><strong>{item.name}</strong><small>{item.sceneCount} cảnh · {item.width}×{item.height} · {new Date(item.updatedAt).toLocaleString('vi-VN')}</small>{item.id === project.id && persisted && <em>Đang mở</em>}</button>) : <span>Chưa có project nào được lưu.</span>}</div>
          </div>}
        </div>
        <button className="button quiet" type="button" aria-expanded={setupOpen} aria-controls="animation-setup" onClick={() => setSetupOpen((value) => !value)}><Settings2 size={15} aria-hidden="true" /> Thiết lập AI</button>
        <details className="animation-file-menu"><summary>Thêm <ChevronDown size={14} aria-hidden="true" /></summary><div>
        <button className="button quiet" type="button" onClick={() => void toggleHistory()}>Lịch sử</button>
        <button className="button quiet" type="button" onClick={exportJson}>JSON</button>
        <button className="button quiet" type="button" onClick={exportSrt}><Download size={14} aria-hidden="true" /> SRT</button>
        </div></details>
        <button className="button animation-toolbar-thumbnail" type="button" title={videoHasNarration ? 'Tạo 3 phương án thumbnail từ toàn bộ nội dung video' : 'Dựng video có lời đọc trước để tạo thumbnail'} disabled={generatingThumbnails || directing || !videoHasNarration || (usingFlowAgentAssets && !flowAgent?.connected)} onClick={() => void generateThumbnails()}><Image size={15} aria-hidden="true" /> {generatingThumbnails ? 'Đang tạo thumbnail…' : thumbnailAssets.length ? `Thumbnail (${thumbnailAssets.length})` : 'Tạo thumbnail'}</button>
        <button className="button" type="button" onClick={startPresentation}><Maximize size={15} aria-hidden="true" /> Trình chiếu</button>
        <button className="button animation-export-button" type="button" onClick={() => void renderMp4()} disabled={rendering} aria-live="polite"><Download size={15} aria-hidden="true" /> {rendering ? renderProgress >= 100 ? 'Đang tải video…' : `Đang xuất ${renderProgress > 0 ? `${renderProgress}%` : '…'}` : 'Xuất video hoàn chỉnh'}</button>
        <button className="button primary" type="button" onClick={() => void save()} disabled={saving}><Save size={15} aria-hidden="true" /> {saving ? 'Đang lưu' : 'Lưu'}</button>
      </div>
    </header>
    {characterPreview && <div className="animation-character-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCharacterPreview(undefined); }}>
      <div className="animation-character-preview-dialog" role="dialog" aria-modal="true" aria-label={`Xem nhân vật ${characterPreview.name}`}>
        <div className="animation-character-preview-head"><strong>{characterPreview.name}</strong><button ref={characterPreviewCloseRef} type="button" aria-label="Đóng ảnh nhân vật" onClick={() => setCharacterPreview(undefined)}><X size={18} aria-hidden="true" /></button></div>
        <img src={characterPreview.uri} alt={characterPreview.name} />
        {characterPreview.id && <button className="button primary" type="button" onClick={() => { setCharacterReference(undefined); setSelectedCharacterAssetId(characterPreview.id || ''); setCharacterPreview(undefined); }}>Chọn nhân vật này</button>}
      </div>
    </div>}
    {presentationOpen && <div className="animation-presentation" role="dialog" aria-modal="true" aria-label="Trình chiếu toàn bộ video">
      <div className="animation-canvas-wrap animation-transition-preview">
        <AnimationCanvas scene={scene} assets={project.assets} width={project.width} height={project.height} timeMs={timeMs} showSubtitles={false} interactive={false} onSelect={() => undefined} onMove={() => undefined} />
      </div>
      <div className="animation-presentation-status"><span>{sequenceSeconds}s / {(totalDurationMs / 1000).toFixed(1)}s</span><strong>{scene.name}</strong></div>
      <button type="button" className="animation-presentation-close" aria-label="Đóng trình chiếu" onClick={() => { setPresentationOpen(false); setPlaying(false); }}><X size={20} aria-hidden="true" /></button>
    </div>}
    <aside id="animation-setup" className="animation-setup-panel" aria-label="Thiết lập AI và video" hidden={!setupOpen}>
    <div className="animation-director-bar">
      <div className="animation-director-heading"><span><Sparkles size={16} aria-hidden="true" /> AI Director</span><small>{directorProvider ? `${directorProvider.name} · ${directorAssignment?.model || ''}` : 'Chưa cấu hình AI Director'}</small></div>
      <label className="animation-director-prompt"><span className="sr-only">Ý tưởng hoặc toàn bộ kịch bản</span><textarea value={brief} onChange={(event) => { setBrief(event.target.value); setCharacterOptions([]); setSelectedCharacterAssetId(''); }} placeholder="Nhập toàn bộ nội dung, hoặc một ý tưởng ngắn như: Mèo xâm chiếm ngoài hành tinh…" /></label>
      <div className="animation-director-options">
        <fieldset className="animation-duration-mode"><legend>Thời lượng</legend><label className={durationMode === 'fixed' ? 'selected' : ''}><input type="radio" checked={durationMode === 'fixed'} onChange={() => setDurationMode('fixed')} /><span className="animation-duration-choice-copy"><strong>Khóa theo thời lượng</strong><small>Bám sát mốc bạn chọn</small></span></label><label className={durationMode === 'auto' ? 'selected' : ''}><input type="radio" checked={durationMode === 'auto'} onChange={() => setDurationMode('auto')} /><span className="animation-duration-choice-copy"><strong>Tự động theo nội dung</strong><small>AI tự suy ra độ dài phù hợp</small></span></label></fieldset>
        {durationMode === 'fixed' && <label className="animation-duration"><span>Thời lượng video</span><input aria-label="Thời lượng video tính bằng phút" type="number" min="0.1" step="0.25" value={targetMinutes} onChange={(event) => setTargetMinutes(event.target.value)} /><span>phút</span><small>Director sẽ tạo TTS thử, đo thời lượng thật và tự viết lại narration trước khi tạo ảnh cho tới khi lời đọc gần đầy timeline đã chọn.</small></label>}
        {durationMode === 'auto' && <small className="animation-reference-note">Tự động sẽ suy ra độ dài từ nội dung. Nếu prompt có ghi rõ “60 giây”, “90 seconds”, “2 phút”… Director sẽ ưu tiên mốc đó thay vì tính theo độ dài prompt.</small>}
        <div className="animation-director-voice"><label htmlFor="animation-director-voice">Giọng đọc</label>{ttsVoices.length ? <select id="animation-director-voice" aria-label="Chọn giọng đọc" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} title={ttsProvider?.name}>{ttsVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name || voice.id}{voice.language ? ` · ${voice.language}` : ''}</option>)}</select> : <input id="animation-director-voice" aria-label="Voice ID" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} placeholder={ttsProvider ? 'Nhập Voice ID' : 'Chưa cấu hình TTS'} disabled={!ttsProvider} />}<button type="button" className="button ghost small" disabled={testingTtsVoice || !ttsProvider || !ttsAssignment?.model || !ttsVoice} onClick={() => void testTtsVoice()}>{testingTtsVoice ? <LoaderCircle size={14} className="spin" /> : <CirclePlay size={14} />} {testingTtsVoice ? 'Đang tạo/phát…' : 'Nghe thử'}</button></div>
        {ttsProvider?.providerType === 'kokoro-local' && <small className="animation-reference-note">Kokoro hiện chỉ có giọng tiếng Anh (Mỹ/Anh). Lần nghe thử đầu tải model khoảng 354 MB và cài runtime; audio sẽ tự phát ngay khi tạo xong.</small>}
        <label className="animation-auto-assets"><input type="checkbox" checked={autoGenerateAssets} onChange={(event) => setAutoGenerateAssets(event.target.checked)} /><span>Tạo ảnh theo từng nhịp giải thích</span></label>
        {autoGenerateAssets && <>
          <select className="animation-image-provider" aria-label="Provider tạo ảnh" value={usingFlowAgentAssets ? 'flow-agent' : imageProvider?.id || ''} onChange={(event) => {
            const value = event.target.value;
            setImageProviderId(value);
            if (value === GPT_IMAGE_PROVIDER.id) {
              setGptImageModel(selectedGptImageModel);
              setImageModel(selectedGptImageModel);
            } else {
              setImageModel(value === 'flow-agent' ? 'narwhal' : providers.find((item) => item.id === value)?.models[0]?.id || 'gpt-image-1');
            }
            setCharacterOptions([]); setSelectedCharacterAssetId('');
          }}>
            <option value="flow-agent">Nano Banana 2{flowAgent?.connected ? ' · sẵn sàng' : flowAgent?.extensionConnected ? ' · đang xác thực' : ' · chưa kết nối'}</option>
            {providers.filter((item) => item.enabled && !item.baseUrl.startsWith('local://')).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value={GPT_IMAGE_PROVIDER.id}>GPT Image · ChatGPT{ima2GptStatus?.connected ? ' · sẵn sàng' : ' · cần đăng nhập'}</option>
          </select>
          {imageProviderId === GPT_IMAGE_PROVIDER.id ? <>
            <label className="animation-gpt-model-choice" htmlFor="animation-gpt-image-model">
              <span>Model tạo ảnh</span>
              <select id="animation-gpt-image-model" className="animation-image-provider" value={selectedGptImageModel} onChange={(event) => {
                setGptImageModel(event.target.value);
                setImageModel(event.target.value);
              }}>
                {gptImageModelChoices.map((model) => <option key={model} value={model}>{model}{model === GPT_IMAGE_MODEL ? ' · mặc định' : ''}</option>)}
              </select>
            </label>
            <small className="animation-reference-note">GPT Image dùng đăng nhập ChatGPT trong Cài đặt; hỗ trợ ảnh tham chiếu để giữ nhân vật. Model đã chọn áp dụng cho ảnh tạo mới.</small>
          </> : !usingFlowAgentAssets && <small className="animation-reference-note">Ảnh tham chiếu nhân vật hiện cần Nano Banana 2.</small>}
        </>}
        {autoGenerateAssets && <div className="animation-character-picker">
          <div className="animation-character-picker-head"><span>Nhân vật và phong cách</span>{(characterReference || selectedCharacterAssetId) && <button type="button" onClick={() => { setCharacterReference(undefined); setSelectedCharacterAssetId(''); }}>Đổi lựa chọn</button>}</div>
          {characterReference ? <div className="animation-character-reference"><button type="button" aria-label="Xem lớn ảnh nhân vật tham chiếu" onClick={() => setCharacterPreview({ name: characterReference.name, uri: animationAssetUrl(characterReference.uploadId) })}><img src={animationAssetUrl(characterReference.uploadId)} alt="" /></button><span><b>Ảnh của bạn</b>{characterReference.name}</span></div> : selectedCharacter ? <div className="animation-character-reference"><button type="button" aria-label={`Xem lớn ${selectedCharacter.name}`} onClick={() => setCharacterPreview({ id: selectedCharacter.id, name: selectedCharacter.name, uri: selectedCharacter.uri })}><img src={selectedCharacter.uri} alt="" /></button><span><b>Đã chọn</b>{selectedCharacter.name}</span></div> : <label className="animation-character-upload"><Image size={16} aria-hidden="true" /><span>Tải ảnh nhân vật của bạn</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={preparingCharacters} onChange={(event) => { void uploadCharacterReference(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>}
          {(characterReference || selectedCharacterAssetId) && <label className="animation-character-appearance" htmlFor="animation-character-appearance-lock"><span>Ghi chú thêm cho mascot (không bắt buộc)</span><textarea id="animation-character-appearance-lock" aria-describedby="animation-character-appearance-help" rows={3} value={characterAppearanceLock} onChange={(event) => setCharacterAppearanceLock(event.target.value)} placeholder="Ví dụ: đổi áo mascot sang xanh dương; giữ nguyên các đặc điểm còn lại." /><small id="animation-character-appearance-help">AI dùng trực tiếp ảnh tham chiếu làm chuẩn nhận diện. Để trống để bám ảnh; chỉ nhập nếu muốn ghi đè chi tiết cụ thể. Ghi chú này chỉ áp dụng cho mascot, không áp lên nhân vật phụ.</small></label>}
          {storyCastReferenceAssets.length > 0 && <section className="animation-story-cast-references" aria-label="Ảnh tham chiếu nhân vật phụ"><div><strong>Dàn nhân vật phụ · ảnh tham chiếu AI</strong><small>Mỗi ảnh khóa riêng nhận diện nhân vật; mascot không bị dùng làm mẫu cho họ.</small></div><div className="animation-story-cast-grid">{storyCastReferenceAssets.map((asset) => <button key={asset.id} type="button" aria-label={`Xem lớn ảnh tham chiếu ${asset.name}`} onClick={() => setCharacterPreview({ name: asset.name, uri: asset.uri })}><img src={asset.uri} alt="" /><span>{asset.name}</span></button>)}</div></section>}
          {!characterReference && characterOptions.length === 0 && <button className="button quiet" type="button" disabled={!preparingCharacters && (brief.trim().length < 10 || (usingFlowAgentAssets && !flowAgent?.connected))} onClick={() => preparingCharacters ? cancelCharacterOptions() : void prepareCharacterOptions()}>{preparingCharacters ? 'Dừng tạo 4 nhân vật' : 'Không có ảnh? Tạo 4 nhân vật để chọn'}</button>}
          {!characterReference && characterOptions.length > 0 && <><div className="animation-character-options" role="radiogroup" aria-label="Chọn nhân vật">{characterOptions.map((asset) => <article className={selectedCharacterAssetId === asset.id ? 'selected' : ''} key={asset.id}><button className="animation-character-thumb" type="button" aria-label={`Xem lớn ${asset.name}`} onClick={() => setCharacterPreview({ id: asset.id, name: asset.name, uri: asset.uri })}><img src={asset.uri} alt="" /><span>{asset.name}</span></button><button className="animation-character-select" type="button" role="radio" aria-checked={selectedCharacterAssetId === asset.id} onClick={() => setSelectedCharacterAssetId(asset.id)}>{selectedCharacterAssetId === asset.id ? 'Đã chọn' : 'Chọn'}</button></article>)}</div><button className="animation-character-regenerate" type="button" onClick={() => preparingCharacters ? cancelCharacterOptions() : void prepareCharacterOptions()}>{preparingCharacters ? 'Dừng lượt tạo mới' : 'Tạo lại 4 phương án'}</button></>}
        </div>}
      </div>
      {directorError && <div className="animation-director-error" role="alert"><details><summary>Lỗi hoặc gián đoạn kết nối. Xem chi tiết</summary><p>{directorError}</p></details><button type="button" aria-label="Đóng thông báo lỗi" onClick={() => setDirectorError('')}><X size={14} aria-hidden="true" /></button></div>}
      {directorWarning && <div className="animation-director-error warning" role="status"><details><summary>{directorWarningTitle}</summary><p>{directorWarning}</p></details>{/thiếu hình|không tạo được ảnh|ảnh minh họa/i.test(directorWarning) && <button className="button primary animation-retry-missing" type="button" disabled={retryingMissingImages || !flowAgent?.connected} onClick={() => void retryMissingImages()}><RefreshCw size={14} aria-hidden="true" />{retryingMissingImages ? 'Đang tạo lại…' : 'Tạo lại ảnh lỗi'}</button>}<button type="button" aria-label="Đóng cảnh báo" onClick={() => setDirectorWarning('')}><X size={14} aria-hidden="true" /></button></div>}
    </div>
    <details className="animation-edit-disclosure"><summary>Chỉnh sửa bằng AI <ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="animation-ai-edit-bar">
      <span className="animation-ai-edit-label">Chỉnh bằng AI</span><input aria-label="Yêu cầu chỉnh sửa bằng AI" value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} placeholder="Ví dụ: zoom gần Trái Đất hơn…" /><button className="animation-ai-apply" type="button" disabled={editingWithAi || editInstruction.trim().length < 4} onClick={() => void editWithAi('edit')}>{editingWithAi ? 'Đang sửa…' : 'Áp dụng'}</button>
      <details className="animation-ai-more"><summary><Settings2 size={14} aria-hidden="true" /> Tùy chọn <ChevronDown size={13} aria-hidden="true" /></summary><div><button type="button" disabled={editingWithAi || editInstruction.trim().length < 4} onClick={() => void editWholeProject()}>Áp dụng toàn project</button><button type="button" disabled={editingWithAi} onClick={() => void editWithAi('visual')}>Tạo lại hình ảnh</button><button type="button" onClick={() => void checkQuality()}>Kiểm tra chất lượng</button>{qualityIssues.length > 0 && <button type="button" onClick={() => void fixQuality()}>Tự sửa lỗi</button>}</div></details>
      {qualityIssues.length > 0 && <span className={`animation-quality-badge ${qualityIssues.some((item) => item.severity === 'error') ? 'has-error' : ''}`}>{qualityIssues.length} cảnh báo</span>}
    </div>
    </details>
    <div className="animation-project-settings" aria-label="Thiết lập project">
      <label>Phong cách hình ảnh<select aria-label="Chọn phong cách hình ảnh" value={visualStylePresetId(project.styleProfile?.style)} onChange={(event) => {
        const id = event.target.value;
        const preset = VISUAL_STYLE_PRESETS.find((item) => item.id === id);
        setProject((current) => ({
          ...current,
          styleProfile: {
            ...(current.styleProfile || { name: 'AI Storyboard', style: '', pacing: 'balanced' as const }),
            name: preset?.label || 'Tùy chỉnh',
            style: preset?.prompt || '',
          },
          updatedAt: now(),
        }));
      }}>{VISUAL_STYLE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}<option value="custom">Nhập prompt riêng…</option></select></label>
      {visualStylePresetId(project.styleProfile?.style) === 'custom' && <label>Prompt phong cách tùy chỉnh<input className="animation-style-profile" value={project.styleProfile?.style || ''} onChange={(event) => setProject((current) => ({
        ...current,
        styleProfile: {
          ...(current.styleProfile || { name: 'Tùy chỉnh', style: '', pacing: 'balanced' as const }),
          name: 'Tùy chỉnh',
          style: event.target.value,
        },
        updatedAt: now(),
      }))} placeholder="Mô tả art direction, nhân vật, màu sắc, nét vẽ…" /></label>}
      <label>Phong cách kể chuyện<select aria-label="Chọn phong cách kể chuyện" value={project.styleProfile?.tone || 'balanced'} onChange={(event) => setProject((current) => ({
        ...current,
        styleProfile: {
          ...(current.styleProfile || { name: 'AI Storyboard', style: VISUAL_STYLE_PRESETS[0].prompt, pacing: 'balanced' as const }),
          tone: event.target.value as NonNullable<AnimationProject['styleProfile']>['tone'],
        },
        updatedAt: now(),
      }))}>{STORY_TONE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <small className="animation-reference-note">Phong cách này điều khiển cách viết kịch bản, không đổi voice đã chọn. “Hài hước thông minh” phải có setup, câu quan sát dí dỏm và cú chốt nghe được; vẫn giữ giọng đọc 1.00x, không đọc nhanh hoặc chèn [cười].</small>
      <small className="animation-reference-note">Video dùng ảnh AI tĩnh, cắt thẳng theo từng cue và voiceover nối liên tục. Không thêm chuyển động camera hay lớp hiệu ứng.</small>
      <small className="animation-reference-note">Luật nhất quán: prompt tiếng Việt thì chữ trong ảnh phải là tiếng Việt; mascot mẫu 3D sẽ khóa toàn bộ ảnh 3D, mascot 2D sẽ khóa toàn bộ ảnh 2D.</small>
      <span>Tỷ lệ khung hình</span><div className="animation-ratio-buttons">{([[1080, 1920, '9:16'], [1920, 1080, '16:9'], [1080, 1080, '1:1']] as const).map(([width, height, label]) => <button key={label} type="button" aria-pressed={project.width === width && project.height === height} onClick={() => relayout(width, height)}>{label}</button>)}</div>
      <div className="animation-voiceover"><button type="button" disabled={creatingVoiceover} onClick={() => void createVoiceover()}>{creatingVoiceover ? 'Đang tạo…' : 'Tạo lại voiceover'}</button></div>
    </div>
    <div className="animation-director-actions-bottom" aria-label="Hành động tạo video">
      <button className={`button primary${directing ? ' is-loading' : ''}`} type="button" disabled={directing || preparingCharacters || brief.trim().length < 10 || (autoGenerateAssets && !usingFlowAgentAssets && imageProviderId !== GPT_IMAGE_PROVIDER.id) || Boolean(ttsProvider && ttsProvider.providerType !== 'hiiu-tts' && !ttsVoice.trim())} onClick={() => void direct()}>{directing ? 'Đang dựng video…' : autoGenerateAssets && !characterReference && !selectedCharacterAssetId ? 'Chuẩn bị nhân vật' : 'Bắt đầu tạo video'}</button>
      {directorJob && <div className="animation-director-job">
        <p role="status" aria-live="polite">{directorJob.stage}</p>
        {directorJob.error && <small className="animation-director-job-error" role="alert">{directorJob.error}</small>}
        <div className="animation-director-progress" aria-label={`Tiến trình ${Math.max(0, Math.min(100, directorJob.progressPercent || 0))}%`}>
          <div className="animation-director-progress-head"><span>{directorJob.status === 'completed' && directorJob.progressTotal ? `${directorJob.progressTotal}/${directorJob.progressTotal} ảnh đã xong` : directorJob.progressLabel || (directorJob.progressTotal !== undefined && directorJob.progressCurrent !== undefined ? `${directorJob.progressCurrent}/${directorJob.progressTotal} ảnh đã xong` : 'Đang xử lý')}</span><strong>{Math.max(0, Math.min(100, directorJob.progressPercent || 0))}%</strong></div>
          <div className="animation-director-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, directorJob.progressPercent || 0))}><span style={{ width: `${Math.max(0, Math.min(100, directorJob.progressPercent || 0))}%` }} /></div>
        </div>
        {directing && <button className="button quiet" type="button" onClick={() => void cancelDirector()}>Dừng dựng animation</button>}
        {['failed', 'interrupted', 'cancelled'].includes(directorJob.status) && <button className="button quiet" type="button" onClick={() => void resumeDirector()}>Tiếp tục job đã lưu</button>}
      </div>}
      {directorJob?.hasResult && <button className="button quiet animation-open-saved-result" type="button" onClick={() => void restoreDirectorResult()}>Mở kết quả đã lưu</button>}
      {(videoHasNarration || thumbnailAssets.length > 0) && <div id="animation-thumbnail-tool" className="animation-thumbnail-tool">
        <div className="animation-thumbnail-head"><span><Image size={15} aria-hidden="true" /> Thumbnail video</span><button className="button quiet" type="button" disabled={generatingThumbnails || directing || !videoHasNarration || (usingFlowAgentAssets && !flowAgent?.connected)} onClick={() => void generateThumbnails()}>{generatingThumbnails ? 'Đang tạo 3 thumbnail…' : thumbnailAssets.length ? 'Tạo lại 3 phương án' : 'Tạo 3 phương án'}</button></div>
        <small>AI dùng toàn bộ narration, các cảnh và phong cách hiện tại để nghĩ thumbnail 16:9; có thể dùng chữ ngắn, giá hoặc số khi hữu ích.</small>
        {thumbnailAssets.length > 0 && <div className="animation-thumbnail-grid">{thumbnailAssets.map((asset, index) => <article className={project.thumbnailAssetId === asset.id ? 'selected' : ''} key={asset.id}>
          <button className="animation-thumbnail-preview" type="button" onClick={() => setCharacterPreview({ id: asset.id, name: asset.name, uri: asset.uri })} aria-label={`Xem lớn ${asset.name}`}><img src={asset.uri} alt="" /></button>
          <small className="animation-thumbnail-score">{(asset.tags.find((tag) => tag.startsWith('thumbnail-angle:')) || 'thumbnail-angle:concept').replace('thumbnail-angle:', '')} · {(asset.tags.find((tag) => tag.startsWith('thumbnail-score:')) || 'thumbnail-score:0').replace('thumbnail-score:', '')}/10</small>
          <div><button type="button" className="animation-thumbnail-select" onClick={() => setProject((current) => ({ ...current, thumbnailAssetId: asset.id, updatedAt: now() }))}>{project.thumbnailAssetId === asset.id ? 'Đã chọn' : `Chọn ${index + 1}`}</button><a href={asset.uri} download={`${project.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'video'}-thumbnail-${index + 1}.png`}>Tải PNG</a></div>
        </article>)}</div>}
      </div>}
    </div>
    </aside>
    {historyOpen && <div className="animation-history">{versions.length ? versions.map((version) => <button type="button" key={version.id} onClick={() => void restoreVersion(version.id)}><strong>{new Date(version.createdAt).toLocaleString('vi-VN')}</strong><small>{version.sceneCount} scene · {version.name}</small></button>) : <span>Chưa có version trước.</span>}</div>}
    <div className={`animation-workspace${selectedLayer ? ' has-selection' : ''}`}>
      <aside className="animation-left-panel" aria-label="Scene và layer">
        <div className="animation-panel-heading"><span>SCENES</span><button type="button" aria-label="Thêm scene" onClick={addScene}><Plus size={14} /></button></div>
        <div className="animation-scene-list">{project.scenes.map((item, index) => <button type="button" key={item.id} className={item.id === scene.id ? 'active' : ''} onClick={() => jumpToSequenceScene(item.id)}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{item.name}</strong><small>{(item.durationMs / 1000).toFixed(1)}s · {item.renderMode}</small></span></button>)}</div>
        <details className="animation-asset-library">
          <summary><span>Kho tài nguyên</span><small>{libraryAssets.length}</small><ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="animation-asset-search"><input aria-label="Tìm tài nguyên" value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="Tìm theo tên hoặc tag…" /></div>
          <details className="animation-asset-create"><summary><Plus size={13} aria-hidden="true" /> Tạo ảnh bằng AI</summary><div className="animation-asset-generator"><textarea aria-label="Mô tả ảnh" value={assetPrompt} onChange={(event) => setAssetPrompt(event.target.value)} placeholder="Mô tả ảnh AI cần tạo…" /><input value={imageModel} onChange={(event) => setImageModel(event.target.value)} aria-label="Image model" readOnly={usingFlowAgentAssets || imageProviderId === GPT_IMAGE_PROVIDER.id} /><button type="button" disabled={generatingAsset || assetPrompt.trim().length < 8 || (usingFlowAgentAssets && !flowAgent?.connected) || (imageProviderId === GPT_IMAGE_PROVIDER.id && !ima2GptStatus?.connected)} onClick={() => void generateAsset()}>{generatingAsset ? 'Đang tạo…' : usingFlowAgentAssets ? 'Tạo bằng Flow' : 'Tạo ảnh'}</button></div></details>
          <div className="animation-asset-list">{libraryAssets.filter((asset) => ['image', 'background', 'audio'].includes(asset.type)).map((asset) => <button type="button" key={asset.id} onClick={() => reuseAsset(asset)} title="Thêm ảnh hoặc audio vào scene"><span>{asset.name}</span><small>{asset.type} · {asset.tags.slice(0, 2).join(', ') || 'chưa có tag'}</small></button>)}</div>
        </details>
      </aside>
      <main className="animation-stage-panel">
        <div className="animation-stage-controls"><button type="button" className="animation-play" aria-label={playing ? 'Tạm dừng' : 'Phát cảnh'} onClick={() => { if (playing) { setPlaying(false); setSequenceMode(false); return; } setSequenceMode(false); if (timeMs >= scene.durationMs) setTimeMs(0); setPlaying(true); }}>{playing ? <Pause size={15} /> : <Play size={15} />}</button><span>{seconds}s / {(scene.durationMs / 1000).toFixed(1)}s</span><label>Thời lượng cảnh <input aria-label="Thời lượng cảnh tính bằng giây" type="number" min="0.5" max="60" step="0.1" value={Number((scene.durationMs / 1000).toFixed(1))} onChange={(event) => { const durationMs = Math.round(Math.max(.5, Math.min(60, Number(event.target.value) || .5)) * 1000); updateScene((current) => ({ ...current, durationMs, commands: [], camera: { ...current.camera, commands: [] } })); setTimeMs((value) => Math.min(value, durationMs)); }} /> giây</label><small>{sequenceMode ? `Đang xem toàn bộ · ${sequenceSeconds}s` : 'Ảnh AI tĩnh · voiceover nối liên tục'}</small></div>
        <div className="animation-canvas-wrap animation-transition-preview" data-overlap-owner="canvas-selection">
          <AnimationCanvas scene={scene} assets={project.assets} width={project.width} height={project.height} timeMs={timeMs} selectedLayerId={selectedLayerId} exporting={rendering} showSubtitles={false} onCanvasReady={(canvas) => { canvasRef.current = canvas; }} onSelect={(layerId) => setSelectedLayerId(layerId || '')} onMove={(layerId, x, y) => { const layer = scene.layers.find((item) => item.id === layerId); if (layer) updateLayer(layerId, { transform: { ...layer.transform, position: { x, y } } }); }} />
        </div>
      </main>
      <aside className="animation-inspector" aria-label="Thuộc tính layer">
        <div className="animation-panel-heading"><span>INSPECTOR</span>{selectedLayer && <button type="button" aria-label="Xóa layer" onClick={deleteLayer}><Trash2 size={14} /></button>}</div>
        {selectedLayer ? <div className="animation-inspector-fields">
          <label><span>Tên layer</span><input value={selectedLayer.name} onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value })} /></label>
          <div className="animation-field-row"><label><span>Hiển thị</span><input type="checkbox" checked={selectedLayer.visible} onChange={(event) => updateLayer(selectedLayer.id, { visible: event.target.checked })} /></label><label><span>Khóa</span><input type="checkbox" checked={selectedLayer.locked} onChange={(event) => updateLayer(selectedLayer.id, { locked: event.target.checked })} /></label></div>
          <label><span>Thứ tự layer</span><input type="number" value={selectedLayer.zIndex} onChange={(event) => updateLayer(selectedLayer.id, { zIndex: Number(event.target.value) })} /></label>
          {selectedLayer.type === 'text' && <label><span>Nội dung</span><textarea value={selectedLayer.text || ''} onChange={(event) => { const text = event.target.value; updateLayer(selectedLayer.id, selectedLayer.name.startsWith('Voiceover · Subtitle') ? { text, wordTimings: subtitleWordTimings(text, scene.durationMs) } : { text }); }} /></label>}
          {selectedLayer.type === 'text' && <label><span>Cỡ chữ <b>{selectedLayer.fontSize || 54}px</b></span><input type="range" min="16" max="160" value={selectedLayer.fontSize || 54} onChange={(event) => updateLayer(selectedLayer.id, { fontSize: Number(event.target.value) })} /></label>}
          {selectedLayer.type === 'chart' && <><label><span>Dữ liệu (phân cách dấu phẩy)</span><input value={(selectedLayer.data || []).join(', ')} onChange={(event) => updateLayer(selectedLayer.id, { data: event.target.value.split(',').map(Number).filter(Number.isFinite) })} /></label><label><span>Nhãn</span><input value={(selectedLayer.labels || []).join(', ')} onChange={(event) => updateLayer(selectedLayer.id, { labels: event.target.value.split(',').map((value) => value.trim()) })} /></label></>}
          {selectedLayer.type === 'audio' && <><label><span>Bắt đầu audio (ms)</span><input type="number" min="0" max={scene.durationMs} value={selectedLayer.startMs || 0} onChange={(event) => updateLayer(selectedLayer.id, { startMs: Number(event.target.value) })} /></label><label><span>Thời lượng audio (ms, 0 = hết file)</span><input type="number" min="0" value={selectedLayer.durationMs || 0} onChange={(event) => updateLayer(selectedLayer.id, { durationMs: Number(event.target.value) || undefined })} /></label><label><span>Âm lượng</span><input type="range" min="0" max="1" step="0.01" value={selectedLayer.volume ?? 1} onChange={(event) => updateLayer(selectedLayer.id, { volume: Number(event.target.value) })} /></label></>}
          {selectedAsset && <><label><span>Asset tags</span><input defaultValue={selectedAsset.tags.join(', ')} key={`${selectedAsset.id}-tags-${selectedAsset.tags.join('|')}`} onBlur={(event) => void updateAssetMetadata({ tags: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label><label><span>Style lock</span><input value={selectedAsset.style || ''} onChange={(event) => setProject((current) => ({ ...current, assets: current.assets.map((item) => item.id === selectedAsset.id ? { ...item, style: event.target.value } : item) }))} onBlur={(event) => void updateAssetMetadata({ style: event.target.value })} /></label></>}
          <div className="animation-field-row"><label><span>X</span><input type="number" value={Math.round(selectedLayer.transform.position.x)} onChange={(event) => updateTransform('x', Number(event.target.value))} /></label><label><span>Y</span><input type="number" value={Math.round(selectedLayer.transform.position.y)} onChange={(event) => updateTransform('y', Number(event.target.value))} /></label></div>
          <div className="animation-field-row"><label><span>Rộng</span><input type="number" min="1" value={selectedLayer.width} onChange={(event) => updateLayer(selectedLayer.id, { width: Math.max(1, Number(event.target.value)) })} /></label><label><span>Cao</span><input type="number" min="1" value={selectedLayer.height} onChange={(event) => updateLayer(selectedLayer.id, { height: Math.max(1, Number(event.target.value)) })} /></label></div>
          <label><span>Scale <b>{selectedLayer.transform.scale.x.toFixed(2)}×</b></span><input type="range" min="0.1" max="3" step="0.05" value={selectedLayer.transform.scale.x} onChange={(event) => updateTransform('scale', Number(event.target.value))} /></label>
          <label><span>Rotation <b>{selectedLayer.transform.rotation}°</b></span><input type="range" min="-180" max="180" value={selectedLayer.transform.rotation} onChange={(event) => updateTransform('rotation', Number(event.target.value))} /></label>
          <label><span>Opacity <b>{Math.round(selectedLayer.transform.opacity * 100)}%</b></span><input type="range" min="0" max="1" step="0.01" value={selectedLayer.transform.opacity} onChange={(event) => updateTransform('opacity', Number(event.target.value))} /></label>
          <label><span>Màu</span><input type="color" value={selectedLayer.fill || '#ffffff'} onChange={(event) => updateLayer(selectedLayer.id, { fill: event.target.value })} /></label>
        </div> : <div className="animation-empty-inspector"><Layers3 size={24} /><span>Chọn một layer trên canvas hoặc danh sách để chỉnh sửa.</span></div>}
      </aside>
    </div>
    <div className="animation-timeline" aria-label="Timeline scene">
      <div className="animation-timeline-top"><button type="button" aria-label={playing && sequenceMode ? 'Tạm dừng toàn bộ video' : 'Phát toàn bộ video'} onClick={toggleSequencePreview}>{playing && sequenceMode ? <Pause size={14} /> : <Play size={14} />}</button><strong>TOÀN BỘ VIDEO</strong><span>{sequenceSeconds}s / {(totalDurationMs / 1000).toFixed(1)}s</span></div>
      <div className="animation-sequence-overview" aria-label="Tất cả cảnh trong video" onPointerDown={beginSequenceTrackScrub} onPointerMove={moveSequenceTrackScrub} onPointerUp={endSequenceTrackScrub} onPointerCancel={endSequenceTrackScrub} onClick={clickSequenceTrack}>
        <div className="animation-sequence-lane">
          {compositeScenes.map((item, index) => <button type="button" key={item.id} className={item.id === scene.id ? 'active' : ''} style={{ flexGrow: item.durationMs }} title={`${index + 1}. ${item.name} · ${(item.durationMs / 1000).toFixed(1)}s`} onClick={() => jumpToSequenceScene(item.id)}><b>{String(index + 1).padStart(2, '0')}</b><span>{item.name}</span></button>)}
          <i ref={sequencePlayheadRef} className="animation-sequence-playhead" role="slider" tabIndex={0} aria-label="Vị trí phát toàn bộ video" aria-valuemin={0} aria-valuemax={Math.round(totalDurationMs)} aria-valuenow={Math.round(sequenceTimeMs)} style={{ left: `${sequenceTimeMs / Math.max(1, totalDurationMs) * 100}%` }} onPointerDown={beginSequenceScrub} onPointerMove={moveSequenceScrub} onPointerUp={endSequenceScrub} onPointerCancel={endSequenceScrub} onKeyDown={handleSequenceScrubKeyDown} />
        </div>
      </div>
      <small className="animation-timeline-note">Mỗi ô là một cue ảnh AI; ảnh chỉ đổi khi lời đọc chuyển sang ý mới.</small>
    </div>
  </section>;
}
