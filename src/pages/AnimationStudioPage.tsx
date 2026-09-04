import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AnimationAsset, AnimationCommandType, AnimationProject, CompositeScene, SceneLayer } from '../../shared/animationStudio';
import { ANIMATION_PROJECT_VERSION, defaultTransform } from '../../shared/animationStudio';
import { AnimationCanvas } from '../animationStudio/AnimationCanvas';
import { ChevronDown, Download, Image, Layers3, Maximize, Pause, Play, Plus, Save, Settings2, Sparkles, Square, Trash2, Type, Volume2, X } from '../components/Icons';
import { animationAssetUrl, api, friendlyErrorMessage } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import type { AIProvider, AppSettings } from '../types';

const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function demoProject(): AnimationProject {
  const createdAt = now();
  return {
    schemaVersion: ANIMATION_PROJECT_VERSION, id: crypto.randomUUID(), name: 'Điều gì xảy ra nếu Mặt Trăng biến mất?',
    width: 1080, height: 1920, fps: 30, createdAt, updatedAt: createdAt,
    assets: [
      { id: 'space-bg', type: 'background', name: 'Không gian sâu', uri: '/animation-assets/moon-demo/space-background.png', tags: ['space', 'background'], width: 1024, height: 1792, createdAt },
      { id: 'earth-asset', type: 'object', name: 'Trái Đất', uri: '/animation-assets/moon-demo/earth.png', tags: ['earth', 'planet'], width: 1280, height: 1280, createdAt },
      { id: 'moon-asset', type: 'object', name: 'Mặt Trăng', uri: '/animation-assets/moon-demo/moon.png', tags: ['moon', 'space'], width: 1280, height: 1280, createdAt },
    ],
    scenes: [{
      id: 'scene-001', name: 'Mặt Trăng biến mất', order: 0, durationMs: 5000,
      narration: 'Nếu Mặt Trăng đột nhiên biến mất...', renderMode: 'composite', backgroundColor: '#07111f',
      layers: [
        { id: 'space', name: 'Bối cảnh không gian', type: 'image', assetId: 'space-bg', visible: true, locked: true, zIndex: 0, width: 1080, height: 1920, transform: { ...defaultTransform(), position: { x: 540, y: 960 } } },
        { id: 'earth-glow', name: 'Hào quang Trái Đất', type: 'shape', shape: 'ellipse', visible: true, locked: true, zIndex: 1, width: 790, height: 790, fill: '#126ca8', transform: { ...defaultTransform(), opacity: 0.28, position: { x: 475, y: 1245 } } },
        { id: 'earth', name: 'Trái Đất', type: 'image', assetId: 'earth-asset', visible: true, locked: false, zIndex: 2, width: 720, height: 720, transform: { ...defaultTransform(), position: { x: 475, y: 1245 } } },
        { id: 'moon', name: 'Mặt Trăng', type: 'image', assetId: 'moon-asset', visible: true, locked: false, zIndex: 3, width: 245, height: 245, transform: { ...defaultTransform(), position: { x: 810, y: 645 } } },
        { id: 'eyebrow', name: 'Nhãn chủ đề', type: 'text', text: 'GIẢ THUYẾT VŨ TRỤ', visible: true, locked: false, zIndex: 4, width: 690, height: 60, fill: '#74c9ff', fontSize: 34, transform: { ...defaultTransform(), opacity: 0, position: { x: 540, y: 235 } } },
        { id: 'title', name: 'Câu hỏi mở đầu', type: 'text', text: 'NẾU MẶT TRĂNG\nBIẾN MẤT?', visible: true, locked: false, zIndex: 5, width: 780, height: 220, fill: '#f7fbff', fontSize: 78, transform: { ...defaultTransform(), opacity: 0, position: { x: 540, y: 320 } } },
        { id: 'caption-bg', name: 'Nền lời dẫn', type: 'shape', shape: 'rectangle', visible: true, locked: false, zIndex: 6, width: 820, height: 104, fill: '#07111f', transform: { ...defaultTransform(), opacity: 0, position: { x: 540, y: 1690 } } },
        { id: 'caption', name: 'Lời dẫn', type: 'text', text: 'Chỉ sau một đêm, thế giới sẽ thay đổi mãi mãi.', visible: true, locked: false, zIndex: 7, width: 740, height: 80, fill: '#ffffff', fontSize: 34, transform: { ...defaultTransform(), opacity: 0, position: { x: 540, y: 1702 } } },
      ],
      commands: [
        { id: 'eyebrow-in', type: 'FADE_IN', targetId: 'eyebrow', startMs: 150, durationMs: 650, easing: 'ease-out' },
        { id: 'title-in', type: 'FADE_IN', targetId: 'title', startMs: 350, durationMs: 900, easing: 'ease-out' },
        { id: 'moon-drift', type: 'MOVE', targetId: 'moon', startMs: 0, durationMs: 3000, easing: 'ease-in-out', from: { x: 845, y: 680 }, to: { x: 790, y: 620 } },
        { id: 'moon-scale', type: 'SCALE', targetId: 'moon', startMs: 0, durationMs: 3000, easing: 'ease-in-out', from: { x: 0.92, y: 0.92 }, to: { x: 1.08, y: 1.08 } },
        { id: 'moon-fade', type: 'FADE_OUT', targetId: 'moon', startMs: 2450, durationMs: 900, easing: 'ease-in-out' },
        { id: 'earth-move', type: 'MOVE', targetId: 'earth', startMs: 0, durationMs: 5000, easing: 'ease-in-out', from: { x: 450, y: 1280 }, to: { x: 500, y: 1215 } },
        { id: 'earth-scale', type: 'SCALE', targetId: 'earth', startMs: 0, durationMs: 5000, easing: 'ease-in-out', from: { x: 0.96, y: 0.96 }, to: { x: 1.07, y: 1.07 } },
        { id: 'caption-bg-in', type: 'FADE_IN', targetId: 'caption-bg', startMs: 3000, durationMs: 550, easing: 'ease-out' },
        { id: 'caption-in', type: 'FADE_IN', targetId: 'caption', startMs: 3150, durationMs: 650, easing: 'ease-out' },
      ],
      camera: { transform: defaultTransform(), commands: [{ id: 'camera-zoom', type: 'ZOOM_IN', targetId: 'camera', startMs: 0, durationMs: 5000, easing: 'ease-in-out', from: { x: 1, y: 1 }, to: { x: 1.06, y: 1.06 } }] },
    }],
  };
}

export function AnimationStudioPage({ providers, settings, onNotice }: { providers: AIProvider[]; settings: AppSettings; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [project, setProject] = useState(demoProject);
  const [sceneId, setSceneId] = useState('scene-001');
  const [selectedLayerId, setSelectedLayerId] = useState('');
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sequenceMode, setSequenceMode] = useState(false);
  const [sequenceTimeMs, setSequenceTimeMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [brief, setBrief] = useState('Điều gì xảy ra nếu Mặt Trăng biến mất?');
  const [directing, setDirecting] = useState(false);
  const [targetMinutes, setTargetMinutes] = useState(1);
  const [directorError, setDirectorError] = useState('');
  const [directorWarning, setDirectorWarning] = useState('');
  const [batching, setBatching] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState<AnimationAsset[]>([]);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetPrompt, setAssetPrompt] = useState('');
  const [imageModel, setImageModel] = useState('narwhal');
  const [imageProviderId, setImageProviderId] = useState('flow-agent');
  const [flowAgent, setFlowAgent] = useState<Awaited<ReturnType<typeof api.flowAgentStatus>>>();
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const [autoGenerateAssets, setAutoGenerateAssets] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const [editingWithAi, setEditingWithAi] = useState(false);
  const [qualityIssues, setQualityIssues] = useState<Array<{ severity: 'error' | 'warning'; code: string; sceneId: string; layerId?: string; message: string }>>([]);
  const [selectedCommandId, setSelectedCommandId] = useState('');
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsVoices, setTtsVoices] = useState<Array<{ id: string; name?: string; language?: string }>>([]);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [creatingVoiceover, setCreatingVoiceover] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; createdAt: string; name: string; sceneCount: number }>>([]);
  const [spriteColumns, setSpriteColumns] = useState(4);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement[]>([]);
  const commandDragRef = useRef<{ id: string; startX: number; startMs: number; durationMs: number; mode: 'move' | 'resize'; laneWidth: number } | undefined>(undefined);
  const startedAt = useRef(0);
  const scene = project.scenes.find((item): item is CompositeScene => item.id === sceneId && item.renderMode === 'composite') || project.scenes.find((item): item is CompositeScene => item.renderMode === 'composite');
  const selectedLayer = scene?.layers.find((layer) => layer.id === selectedLayerId);
  const selectedAsset = selectedLayer?.assetId ? project.assets.find((asset) => asset.id === selectedLayer.assetId) : undefined;
  const selectedCommand = scene?.commands.find((command) => command.id === selectedCommandId);
  const directorAssignment = capabilityAssignments(settings, 'translation')[0];
  const directorProvider = providers.find((item) => item.id === directorAssignment?.providerId);
  const usingFlowAgentAssets = imageProviderId === 'flow-agent';
  const imageProvider = usingFlowAgentAssets ? undefined : providers.find((item) => item.id === imageProviderId)
    || providers.find((item) => item.enabled && item.models.some((model) => model.id === imageModel))
    || directorProvider;
  const ttsAssignment = capabilityAssignments(settings, 'tts')[0]; const ttsProvider = providers.find((item) => item.id === ttsAssignment?.providerId);
  const compositeScenes = project.scenes.filter((item): item is CompositeScene => item.renderMode === 'composite');
  const totalDurationMs = compositeScenes.reduce((total, item) => total + item.durationMs, 0);
  const sceneOffsetMs = (targetId: string) => compositeScenes.slice(0, Math.max(0, compositeScenes.findIndex((item) => item.id === targetId))).reduce((total, item) => total + item.durationMs, 0);

  useEffect(() => { void api.listAnimationAssets(assetQuery).then(setLibraryAssets).catch(() => setLibraryAssets([])); }, [assetQuery]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => void api.flowAgentStatus().then((status) => { if (mounted) setFlowAgent(status); }).catch(() => { if (mounted) setFlowAgent(undefined); });
    refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { if (!persisted) return; const timer = setTimeout(() => { void api.saveAnimationProject(project).catch(() => undefined); }, 1500); return () => clearTimeout(timer); }, [persisted, project]);

  useEffect(() => {
    if (!playing || !scene) return;
    startedAt.current = performance.now() - (sequenceMode ? sequenceTimeMs : timeMs);
    let frame = 0;
    const tick = (timestamp: number) => {
      const next = timestamp - startedAt.current;
      if (sequenceMode) {
        if (next >= totalDurationMs) { setSequenceTimeMs(totalDurationMs); setTimeMs(scene.durationMs); setPlaying(false); return; }
        let offset = 0; const active = compositeScenes.find((item) => { const inside = next < offset + item.durationMs; if (!inside) offset += item.durationMs; return inside; });
        if (active) { if (active.id !== scene.id) { setSceneId(active.id); setSelectedLayerId(''); } setTimeMs(next - offset); setSequenceTimeMs(next); }
        frame = requestAnimationFrame(tick); return;
      }
      if (next >= scene.durationMs) { setTimeMs(scene.durationMs); setPlaying(false); return; }
      setTimeMs(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, scene?.id, sequenceMode, totalDurationMs]);

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

  useEffect(() => { const firstVoice = ttsVoices[0]; if (firstVoice && !ttsVoices.some((voice) => voice.id === ttsVoice)) setTtsVoice(firstVoice.id); }, [ttsVoices, ttsVoice]);

  useEffect(() => {
    if (!presentationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPresentationOpen(false); setPlaying(false); } };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [presentationOpen]);

  useEffect(() => {
    previewAudioRef.current.forEach((audio) => audio.pause());
    previewAudioRef.current = [];
    if (!playing || !scene) return;
    const timers: number[] = []; const audioElements = scene.layers.filter((layer) => layer.type === 'audio' && layer.assetId).flatMap((layer) => {
      const asset = project.assets.find((item) => item.id === layer.assetId);
      if (!asset) return [];
      const audio = new Audio(asset.uri); const startMs = layer.startMs || 0; const isMusic = asset.tags.some((tag) => /^(?:music|bgm|nhac)$/i.test(tag)); const hasVoiceover = scene.layers.some((item) => item.type === 'audio' && item.name.startsWith('Voiceover ·')); audio.volume = Math.max(0, Math.min(1, (layer.volume ?? layer.transform.opacity) * (isMusic && hasVoiceover ? .3 : 1))); const play = () => { audio.currentTime = Math.max(0, (timeMs - startMs) / 1000); void audio.play().catch(() => undefined); }; if (timeMs >= startMs) play(); else timers.push(window.setTimeout(play, startMs - timeMs)); return [audio];
    });
    previewAudioRef.current = audioElements;
    return () => { timers.forEach(clearTimeout); audioElements.forEach((audio) => audio.pause()); };
  }, [playing, scene?.id]);

  const updateScene = (change: (current: CompositeScene) => CompositeScene) => {
    if (!scene) return;
    setProject((current) => ({ ...current, scenes: current.scenes.map((item) => item.id === scene.id ? change(item as CompositeScene) : item), updatedAt: now() }));
  };
  const updateLayer = (layerId: string, change: Partial<SceneLayer>) => updateScene((current) => ({ ...current, layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, ...change } : layer) }));
  const addScene = () => { const id = makeId('scene'); const next: CompositeScene = { id, name: `Cảnh ${project.scenes.length + 1}`, order: project.scenes.length, durationMs: 5000, narration: '', renderMode: 'composite', backgroundColor: '#07111f', layers: [], commands: [], camera: { transform: defaultTransform(), commands: [] } }; setProject((current) => ({ ...current, scenes: [...current.scenes, next], updatedAt: now() })); setSceneId(id); setSelectedLayerId(''); setTimeMs(0); };
  const addCommand = (type: AnimationCommandType) => {
    if (!selectedLayer || !scene) return; const durationMs = Math.min(1000, Math.max(0, scene.durationMs - timeMs));
    const base = { id: makeId('command'), type, targetId: selectedLayer.id, startMs: Math.round(timeMs), durationMs: Math.round(durationMs), easing: 'ease-in-out' as const };
    const command = type === 'MOVE' ? { ...base, from: { ...selectedLayer.transform.position }, to: { x: selectedLayer.transform.position.x + 160, y: selectedLayer.transform.position.y } } : type === 'SCALE' ? { ...base, from: { ...selectedLayer.transform.scale }, to: { x: selectedLayer.transform.scale.x * 1.15, y: selectedLayer.transform.scale.y * 1.15 } } : type === 'ROTATE' ? { ...base, from: selectedLayer.transform.rotation, to: selectedLayer.transform.rotation + 45 } : type === 'PLAY_ANIMATION' ? { ...base, animation: selectedLayer.animation } : type === 'LOOK_AT' ? { ...base, target: scene.layers.find((layer) => layer.id !== selectedLayer.id)?.id } : base;
    updateScene((current) => ({ ...current, commands: [...current.commands, command] })); setSelectedCommandId(command.id);
  };
  const updateCommand = (change: { startMs?: number; durationMs?: number; easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'; target?: string }) => { if (!selectedCommand) return; updateScene((current) => ({ ...current, commands: current.commands.map((command) => command.id === selectedCommand.id ? { ...command, ...change } : command) })); };
  const dragCommand = (event: ReactPointerEvent<HTMLButtonElement>) => { const drag = commandDragRef.current; if (!drag || !scene) return; const deltaMs = (event.clientX - drag.startX) / drag.laneWidth * scene.durationMs; updateScene((current) => ({ ...current, commands: current.commands.map((command) => { if (command.id !== drag.id) return command; return drag.mode === 'move' ? { ...command, startMs: Math.round(Math.max(0, Math.min(scene.durationMs - drag.durationMs, drag.startMs + deltaMs))) } : { ...command, durationMs: Math.round(Math.max(0, Math.min(scene.durationMs - drag.startMs, drag.durationMs + deltaMs))) }; }) })); };
  const updateTransform = (key: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', value: number) => {
    if (!selectedLayer) return;
    const transform = { ...selectedLayer.transform, position: { ...selectedLayer.transform.position }, scale: { ...selectedLayer.transform.scale }, anchor: { ...selectedLayer.transform.anchor } };
    if (key === 'x' || key === 'y') transform.position[key] = value;
    else if (key === 'scale') transform.scale = { x: value, y: value };
    else transform[key] = value;
    updateLayer(selectedLayer.id, { transform });
  };
  const addLayer = (type: 'shape' | 'text' | 'diagram' | 'chart' | 'particle') => {
    if (!scene) return;
    const layerId = makeId(type);
    const base = { id: layerId, visible: true, locked: false, zIndex: scene.layers.length + 1, fill: type === 'text' ? '#ffffff' : '#ff8a45', transform: { ...defaultTransform(), position: { x: project.width / 2, y: project.height / 2 } } };
    const layer: SceneLayer = type === 'text'
      ? { ...base, name: 'Text mới', type, text: 'Nội dung mới', fontSize: 52, width: 520, height: 100 }
      : type === 'chart' ? { ...base, name: 'Biểu đồ mới', type, data: [20, 45, 75], labels: ['A', 'B', 'C'], width: 620, height: 420 }
      : type === 'diagram' ? { ...base, name: 'Mũi tên giải thích', type, width: 440, height: 130 }
      : type === 'particle' ? { ...base, name: 'Hiệu ứng hạt', type, width: 620, height: 620 }
      : { ...base, name: 'Shape mới', type, shape: 'rectangle', width: 280, height: 180 };
    updateScene((current) => ({ ...current, layers: [...current.layers, layer] }));
    setSelectedLayerId(layerId);
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
  const addSprite = async (file?: File) => {
    if (!scene || !file || !file.type.startsWith('image/')) return; setUploading(true);
    try { const uploaded = await api.uploadMedia(file); const bitmap = await createImageBitmap(file); const columns = Math.max(1, Math.min(32, Math.round(spriteColumns))); const frameWidth = Math.floor(bitmap.width / columns); const frameHeight = bitmap.height; bitmap.close(); const assetId = makeId('sprite');
      const asset: AnimationAsset = { id: assetId, type: 'sprite', name: file.name, uri: animationAssetUrl(uploaded.uploadId), tags: ['character', 'sprite'], animations: ['idle'], sprite: { frameWidth, frameHeight, columns, frameCount: columns, clips: { idle: { from: 0, to: columns - 1, fps: 8, loop: true } } }, width: frameWidth, height: frameHeight, createdAt: now(), source: 'upload' };
      await api.registerAnimationAsset(asset); setLibraryAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]); reuseAsset(asset); onNotice('Đã lưu sprite sheet với clip idle.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể thêm sprite sheet.'), 'error'); } finally { setUploading(false); }
  };
  const reuseAsset = (asset: AnimationAsset) => {
    if (!scene || !['image', 'background', 'object', 'icon', 'character', 'effect', 'audio'].includes(asset.type)) return;
    const layerId = makeId(asset.type === 'audio' ? 'audio' : 'image'); const isAudio = asset.type === 'audio';
    const layer: SceneLayer = { id: layerId, name: asset.name, type: isAudio ? 'audio' : asset.type === 'sprite' || asset.sprite ? 'sprite' : 'image', assetId: asset.id, visible: true, locked: false, zIndex: scene.layers.length + 1, width: isAudio ? 1 : Math.min(asset.sprite?.frameWidth || asset.width || 560, 760), height: isAudio ? 1 : Math.min(asset.sprite?.frameHeight || asset.height || 560, 760), animation: asset.animations?.[0] || (asset.sprite ? Object.keys(asset.sprite.clips)[0] : undefined), characterId: asset.type === 'character' ? asset.id : undefined, transform: { ...defaultTransform(), position: { x: project.width / 2, y: project.height / 2 } } };
    setProject((current) => ({ ...current, assets: current.assets.some((item) => item.id === asset.id) ? current.assets : [...current.assets, asset], scenes: current.scenes.map((item) => item.id === scene.id && item.renderMode === 'composite' ? { ...item, layers: [...item.layers, layer] } : item), updatedAt: now() })); setSelectedLayerId(layerId);
  };
  const selectedAssetGeneration = () => usingFlowAgentAssets ? { generator: 'flow-agent' as const, model: 'narwhal' } : imageProvider ? { provider: imageProvider, model: imageModel } : undefined;
  const generateAsset = async () => {
    const generation = selectedAssetGeneration();
    if (!generation) { onNotice('Hãy chọn provider tạo ảnh trước.', 'error'); return; }
    if (usingFlowAgentAssets && !flowAgent?.connected) { onNotice('Flow Agent chưa sẵn sàng. Hãy mở Google Flow và tải lại tab.', 'error'); return; }
    setGeneratingAsset(true);
    try { const asset = await api.generateAnimationAsset({ prompt: assetPrompt, ...generation, type: 'image' }); setLibraryAssets((current) => [asset, ...current]); setAssetPrompt(''); reuseAsset(asset); onNotice('Đã tạo, lưu và thêm asset vào scene.'); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo asset.'), 'error'); }
    finally { setGeneratingAsset(false); }
  };
  const updateAssetMetadata = async (change: Partial<Pick<AnimationAsset, 'name' | 'tags' | 'style' | 'animations'>>) => {
    if (!selectedAsset) return;
    try { await api.registerAnimationAsset(selectedAsset); const asset = await api.updateAnimationAsset(selectedAsset.id, change); setLibraryAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]); setProject((current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? asset : item), updatedAt: now() })); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể cập nhật metadata asset.'), 'error'); }
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
      setProject(saved); setPersisted(true); void api.listAnimationProjectVersions(saved.id).then(setVersions); onNotice('Đã lưu project Animation Studio.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể lưu project.'), 'error'); }
    finally { setSaving(false); }
  };
  const direct = async () => {
    if (!directorProvider || !directorAssignment?.model) {
      const message = 'Hãy cấu hình provider/model AI trong Cài đặt → Default Models.';
      setDirectorError(message);
      return;
    }
    if (!ttsProvider || !ttsAssignment?.model) { setDirectorError('Hãy cấu hình provider/model TTS để tool tự tạo voiceover.'); return; }
    const selectedVoice = ttsVoice || ttsProvider.voices?.[0]?.id || '';
    setDirectorError(''); setDirectorWarning(''); setDirecting(true);
    try {
      const assetGeneration = autoGenerateAssets ? selectedAssetGeneration() : undefined;
      const directed = await api.directAnimationProject({ brief, project, provider: directorProvider, model: directorAssignment.model, targetDurationSeconds: Math.round(targetMinutes * 60), narration: { provider: ttsProvider, model: ttsAssignment.model, voice: selectedVoice, speed: 1 }, ...(assetGeneration ? { assetGeneration } : {}) });
      setProject(directed);
      setSceneId(directed.scenes[0]?.id || '');
      setSelectedLayerId('');
      setTimeMs(0);
      setSequenceTimeMs(0);
      setSequenceMode(false);
      setPlaying(false);
      setPersisted(false);
      setDirectorWarning(directed.generationWarnings?.join('\n') || '');
      onNotice(`AI Director đã dựng ${directed.scenes.length} scene có thể chỉnh sửa.`);
    } catch (error) { setDirectorError(friendlyErrorMessage(error, 'AI Director không thể dựng scene.')); }
    finally { setDirecting(false); }
  };
  const directBatch = async () => {
    if (!directorProvider || !directorAssignment?.model) { onNotice('Hãy cấu hình provider/model AI.', 'error'); return; }
    if (autoGenerateAssets && usingFlowAgentAssets && !flowAgent?.connected) { onNotice('Flow Agent chưa sẵn sàng. Hãy mở Google Flow và tải lại tab.', 'error'); return; }
    const briefs = brief.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (briefs.length < 2) { onNotice('Batch cần ít nhất 2 chủ đề, mỗi dòng một chủ đề.', 'error'); return; }
    setBatching(true);
    try {
      const assetGeneration = autoGenerateAssets ? selectedAssetGeneration() : undefined;
      const result = await api.batchDirectAnimationProjects({ briefs, template: project, provider: directorProvider, model: directorAssignment.model, ...(assetGeneration ? { assetGeneration } : {}) });
      const first = result.results.find((item) => item.project)?.project;
      if (first) { setProject(first); setSceneId(first.scenes[0]?.id || ''); setPersisted(true); }
      onNotice(`Batch hoàn tất ${result.completed}/${result.total} project${result.failed ? `, lỗi ${result.failed}` : ''}.`, result.failed ? 'error' : 'success');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo batch project.'), 'error'); }
    finally { setBatching(false); }
  };
  const editWithAi = async (mode: 'edit' | 'animation' | 'visual' = 'edit') => {
    if (!scene || !directorProvider || !directorAssignment?.model) { onNotice('Chưa có scene hoặc provider/model AI.', 'error'); return; } setEditingWithAi(true);
    const instruction = mode === 'animation' ? 'Regenerate the animation and camera direction for stronger pacing and retention.' : mode === 'visual' ? 'Regenerate the visual composition using available assets while preserving timing and narration.' : editInstruction;
    try { const edited = await api.editAnimationScene({ instruction, project, sceneId: scene.id, provider: directorProvider, model: directorAssignment.model, mode }); setProject(edited); if (mode === 'edit') setEditInstruction(''); setSelectedLayerId(''); onNotice(mode === 'animation' ? 'Đã đổi animation, giữ nguyên asset/layer.' : mode === 'visual' ? 'Đã đổi visual, giữ nguyên timing/narration.' : 'AI đã sửa Scene JSON, các layer vẫn chỉnh được.'); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'AI không thể sửa scene.'), 'error'); } finally { setEditingWithAi(false); }
  };
  const checkQuality = async () => { try { const result = await api.checkAnimationQuality(project); setQualityIssues(result.issues); onNotice(result.issues.length ? `Quality Checker tìm thấy ${result.issues.length} vấn đề.` : 'Quality Checker: project đạt kiểm tra cơ bản.', result.issues.some((item) => item.severity === 'error') ? 'error' : 'success'); } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể kiểm tra project.'), 'error'); } };
  const fixQuality = async () => { try { const result = await api.fixAnimationQuality(project); setProject(result.project); setQualityIssues(result.remaining); onNotice(`Đã tự sửa ${result.fixed} vấn đề; còn ${result.remaining.length}.`, result.remaining.some((item) => item.severity === 'error') ? 'error' : 'success'); } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tự sửa project.'), 'error'); } };
  const editWholeProject = async () => { if (!directorProvider || !directorAssignment?.model || editInstruction.trim().length < 4) return; setEditingWithAi(true); try { const edited = await api.editAnimationProject({ instruction: editInstruction, project, provider: directorProvider, model: directorAssignment.model }); setProject(edited); setEditInstruction(''); setSelectedLayerId(''); onNotice('AI đã áp dụng lệnh cho toàn bộ composite scene.'); } catch (error) { onNotice(friendlyErrorMessage(error, 'AI không thể sửa toàn project.'), 'error'); } finally { setEditingWithAi(false); } };
  const relayout = (width: number, height: number) => { const ratioX = width / project.width, ratioY = height / project.height, objectScale = Math.min(ratioX, ratioY); setProject((current) => ({ ...current, width, height, scenes: current.scenes.map((item) => item.renderMode !== 'composite' ? item : { ...item, layers: item.layers.map((layer) => layer.type === 'audio' ? layer : { ...layer, width: layer.type === 'image' && layer.locked ? width : Math.max(1, Math.round(layer.width * (layer.type === 'text' || layer.type === 'chart' ? ratioX : objectScale))), height: layer.type === 'image' && layer.locked ? height : Math.max(1, Math.round(layer.height * objectScale)), fontSize: layer.fontSize ? Math.max(12, Math.round(layer.fontSize * objectScale)) : layer.fontSize, transform: { ...layer.transform, position: { x: Math.round(layer.transform.position.x * ratioX), y: Math.round(layer.transform.position.y * ratioY) } } }), commands: item.commands.map((command) => command.type === 'MOVE' && typeof command.from === 'object' && typeof command.to === 'object' ? { ...command, from: { x: command.from.x * ratioX, y: command.from.y * ratioY }, to: { x: command.to.x * ratioX, y: command.to.y * ratioY } } : command) }), updatedAt: now() })); setSelectedLayerId(''); setTimeMs(0); onNotice(`Đã smart re-layout project sang ${width}:${height}.`); };
  const createVoiceover = async () => { if (!ttsProvider || !ttsAssignment?.model) { onNotice('Hãy cấu hình TTS provider/model.', 'error'); return; } setCreatingVoiceover(true); try { const narrated = await api.generateAnimationNarration({ project, provider: ttsProvider, model: ttsAssignment.model, voice: ttsVoice, speed: 1 }); setProject(narrated); onNotice('Đã tạo voiceover và gắn audio layer cho từng scene.'); } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo voiceover.'), 'error'); } finally { setCreatingVoiceover(false); } };
  const toggleHistory = async () => { if (!persisted) { onNotice('Hãy lưu project lần đầu để sử dụng lịch sử.', 'error'); return; } const next = !historyOpen; setHistoryOpen(next); if (next) setVersions(await api.listAnimationProjectVersions(project.id)); };
  const restoreVersion = async (versionId: string) => { try { const restored = await api.restoreAnimationProjectVersion(project.id, versionId); setProject(restored); setSceneId(restored.scenes[0]?.id || ''); setSelectedLayerId(''); setTimeMs(0); setHistoryOpen(false); onNotice('Đã khôi phục version project.'); } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể khôi phục version.'), 'error'); } };
  const exportJson = () => { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'animation-project'}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const renderMp4 = async () => {
    const canvas = canvasRef.current;
    const compositeScenes = project.scenes.filter((item): item is CompositeScene => item.renderMode === 'composite');
    if (!canvas || !compositeScenes.length || typeof MediaRecorder === 'undefined') { onNotice('Trình duyệt hiện tại không hỗ trợ ghi Canvas.', 'error'); return; }
    setRendering(true); setPlaying(false); setSelectedLayerId('');
    try {
      const quality = await api.checkAnimationQuality(project); setQualityIssues(quality.issues); const blockers = quality.issues.filter((item) => item.severity === 'error'); if (blockers.length) throw new Error(`Quality Checker chặn render: ${blockers.map((item) => item.message).join(' ')}`);
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
      const mp4 = await api.renderAnimationProject(project.id, recording, project);
      const url = URL.createObjectURL(mp4); const link = document.createElement('a'); link.href = url; link.download = `${project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'autosub-animation'}.mp4`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      onNotice(`Đã xuất MP4 hoàn chỉnh gồm ${compositeScenes.length} cảnh${showSubtitles ? ', voice và phụ đề' : ' và voice, không phụ đề'}.`);
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể render MP4.'), 'error'); }
    finally { setRendering(false); }
  };
  const seconds = useMemo(() => (timeMs / 1000).toFixed(1), [timeMs]);
  const sequenceSeconds = useMemo(() => (sequenceTimeMs / 1000).toFixed(1), [sequenceTimeMs]);
  const jumpToSequenceScene = (targetId: string) => { const offset = sceneOffsetMs(targetId); setPlaying(false); setSequenceMode(true); setSequenceTimeMs(offset); setSceneId(targetId); setSelectedLayerId(''); setTimeMs(0); };
  const toggleSequencePreview = () => { if (playing && sequenceMode) { setPlaying(false); return; } const restart = sequenceTimeMs >= totalDurationMs; if (restart) { setSequenceTimeMs(0); setSceneId(compositeScenes[0]?.id || sceneId); setTimeMs(0); } setSequenceMode(true); setPlaying(true); };
  const startPresentation = () => { const first = compositeScenes[0]; if (!first) return; setPresentationOpen(true); setSequenceMode(true); setSequenceTimeMs(0); setSceneId(first.id); setSelectedLayerId(''); setTimeMs(0); setPlaying(true); };
  if (!scene) return <div className="animation-studio-page"><p>Project chưa có composite scene.</p></div>;

  return <section className="animation-studio-page" aria-label="Animation Studio">
    <header className="animation-toolbar">
      <div className="animation-project-title"><span>Animation Studio</span><input aria-label="Tên project" value={project.name} onChange={(event) => setProject((current) => ({ ...current, name: event.target.value, updatedAt: now() }))} /></div>
      <div className="animation-toolbar-meta" aria-label="Thông số project"><span>{project.width} × {project.height}</span><span>{project.fps} FPS</span></div>
      <div className="animation-toolbar-actions">
        <button className="button quiet" type="button" onClick={() => void toggleHistory()}>Lịch sử</button>
        <button className="button quiet" type="button" onClick={exportJson}>JSON</button>
        <button className="button" type="button" onClick={startPresentation}><Maximize size={15} aria-hidden="true" /> Trình chiếu</button>
        <button className="button" type="button" onClick={() => void renderMp4()} disabled={rendering}><Download size={15} aria-hidden="true" /> {rendering ? 'Đang xuất toàn bộ…' : 'Xuất video hoàn chỉnh'}</button>
        <button className="button primary" type="button" onClick={() => void save()} disabled={saving}><Save size={15} aria-hidden="true" /> {saving ? 'Đang lưu' : 'Lưu'}</button>
      </div>
    </header>
    {presentationOpen && <div className="animation-presentation" role="dialog" aria-modal="true" aria-label="Trình chiếu toàn bộ video">
      <AnimationCanvas scene={scene} assets={project.assets} width={project.width} height={project.height} timeMs={timeMs} showSubtitles={showSubtitles} onSelect={() => undefined} onMove={() => undefined} />
      <div className="animation-presentation-status"><span>{sequenceSeconds}s / {(totalDurationMs / 1000).toFixed(1)}s</span><strong>{scene.name}</strong></div>
      <button type="button" className="animation-presentation-close" aria-label="Đóng trình chiếu" onClick={() => { setPresentationOpen(false); setPlaying(false); }}><X size={20} aria-hidden="true" /></button>
    </div>}
    <div className="animation-director-bar">
      <div className="animation-director-heading"><span><Sparkles size={16} aria-hidden="true" /> AI Director</span><small>{directorProvider ? `${directorProvider.name} · ${directorAssignment?.model || ''}` : 'Chưa cấu hình AI Director'}</small></div>
      <label className="animation-director-prompt"><span className="sr-only">Ý tưởng hoặc kịch bản</span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Mô tả video bạn muốn tạo…" /></label>
      <div className="animation-director-options"><label className="animation-duration"><span>Thời lượng video</span><input aria-label="Thời lượng video tính bằng phút" type="number" min="0.5" max="10" step="0.5" value={targetMinutes} onChange={(event) => setTargetMinutes(Math.max(.5, Math.min(10, Number(event.target.value) || 1)))} /><span>phút</span></label><label className="animation-director-voice"><span>Giọng đọc</span>{ttsVoices.length ? <select aria-label="Chọn giọng đọc" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} title={ttsProvider?.name}>{ttsVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name || voice.id}{voice.language ? ` · ${voice.language}` : ''}</option>)}</select> : <input aria-label="Voice ID" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} placeholder={ttsProvider ? 'Nhập Voice ID' : 'Chưa cấu hình TTS'} disabled={!ttsProvider} />}</label><label className="animation-subtitle-toggle"><input type="checkbox" checked={showSubtitles} onChange={(event) => setShowSubtitles(event.target.checked)} /><span>Phụ đề</span></label><label className="animation-auto-assets"><input type="checkbox" checked={autoGenerateAssets} onChange={(event) => setAutoGenerateAssets(event.target.checked)} /><span>Tự tạo asset thiếu</span></label>{autoGenerateAssets && <select className="animation-image-provider" aria-label="Provider tạo ảnh" value={usingFlowAgentAssets ? 'flow-agent' : imageProvider?.id || ''} onChange={(event) => { const value = event.target.value; setImageProviderId(value); setImageModel(value === 'flow-agent' ? 'narwhal' : providers.find((item) => item.id === value)?.models[0]?.id || 'gpt-image-1'); }}><option value="flow-agent">Flow Agent · Nano Banana 2{flowAgent?.connected ? ' · sẵn sàng' : ' · chưa kết nối'}</option>{providers.filter((item) => item.enabled && !item.baseUrl.startsWith('local://')).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<button className="button quiet" type="button" disabled={batching || directing} onClick={() => void directBatch()}>{batching ? 'Đang chạy…' : 'Tạo hàng loạt'}</button><button className="button primary" type="button" disabled={directing || batching || brief.trim().length < 10 || (autoGenerateAssets && usingFlowAgentAssets && !flowAgent?.connected) || Boolean(ttsProvider && ttsProvider.providerType !== 'hiiu-tts' && !ttsVoice.trim())} onClick={() => void direct()}>{directing ? 'Đang viết kịch bản và tạo voice…' : 'Dựng video hoàn chỉnh'}</button></div>
      {directorError && <div className="animation-director-error" role="alert"><span><strong>Không thể dựng video.</strong> {directorError}</span><button type="button" aria-label="Đóng thông báo lỗi" onClick={() => setDirectorError('')}><X size={14} aria-hidden="true" /></button></div>}
      {directorWarning && <div className="animation-director-error warning" role="status"><span><strong>Video đã được dựng với asset thay thế.</strong> {directorWarning}</span><button type="button" aria-label="Đóng cảnh báo" onClick={() => setDirectorWarning('')}><X size={14} aria-hidden="true" /></button></div>}
    </div>
    <div className="animation-ai-edit-bar">
      <span className="animation-ai-edit-label">Chỉnh bằng AI</span><input aria-label="Yêu cầu chỉnh sửa bằng AI" value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} placeholder="Ví dụ: zoom gần Trái Đất hơn…" /><button className="animation-ai-apply" type="button" disabled={editingWithAi || editInstruction.trim().length < 4} onClick={() => void editWithAi('edit')}>{editingWithAi ? 'Đang sửa…' : 'Áp dụng'}</button>
      <details className="animation-ai-more"><summary><Settings2 size={14} aria-hidden="true" /> Tùy chọn <ChevronDown size={13} aria-hidden="true" /></summary><div><button type="button" disabled={editingWithAi || editInstruction.trim().length < 4} onClick={() => void editWholeProject()}>Áp dụng toàn project</button><button type="button" disabled={editingWithAi} onClick={() => void editWithAi('animation')}>Tạo lại chuyển động</button><button type="button" disabled={editingWithAi} onClick={() => void editWithAi('visual')}>Tạo lại hình ảnh</button><button type="button" onClick={() => void checkQuality()}>Kiểm tra chất lượng</button>{qualityIssues.length > 0 && <button type="button" onClick={() => void fixQuality()}>Tự sửa lỗi</button>}</div></details>
      {qualityIssues.length > 0 && <span className={`animation-quality-badge ${qualityIssues.some((item) => item.severity === 'error') ? 'has-error' : ''}`}>{qualityIssues.length} cảnh báo</span>}
    </div>
    <div className="animation-project-settings" aria-label="Thiết lập project"><input className="animation-style-profile" value={project.styleProfile?.style || ''} onChange={(event) => setProject((current) => ({ ...current, styleProfile: { name: current.styleProfile?.name || 'Kênh mặc định', style: event.target.value, pacing: current.styleProfile?.pacing || 'balanced' }, updatedAt: now() }))} placeholder="Phong cách: pixel, doodle…" /><div className="animation-ratio-buttons"><button type="button" onClick={() => relayout(1080, 1920)}>9:16</button><button type="button" onClick={() => relayout(1920, 1080)}>16:9</button><button type="button" onClick={() => relayout(1080, 1080)}>1:1</button></div><div className="animation-voiceover"><button type="button" disabled={creatingVoiceover} onClick={() => void createVoiceover()}>{creatingVoiceover ? 'Đang tạo…' : 'Tạo lại voiceover'}</button></div></div>
    {historyOpen && <div className="animation-history">{versions.length ? versions.map((version) => <button type="button" key={version.id} onClick={() => void restoreVersion(version.id)}><strong>{new Date(version.createdAt).toLocaleString('vi-VN')}</strong><small>{version.sceneCount} scene · {version.name}</small></button>) : <span>Chưa có version trước.</span>}</div>}
    <div className={`animation-workspace${selectedLayer ? ' has-selection' : ''}`}>
      <aside className="animation-left-panel" aria-label="Scene và layer">
        <div className="animation-panel-heading"><span>SCENES</span><button type="button" aria-label="Thêm scene" onClick={addScene}><Plus size={14} /></button></div>
        <div className="animation-scene-list">{project.scenes.map((item, index) => <button type="button" key={item.id} className={item.id === scene.id ? 'active' : ''} onClick={() => jumpToSequenceScene(item.id)}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{item.name}</strong><small>{(item.durationMs / 1000).toFixed(1)}s · {item.renderMode}</small></span></button>)}</div>
        <div className="animation-panel-heading layer-heading"><span>LAYERS</span><div><label className={`animation-add-image ${uploading ? 'disabled' : ''}`} aria-label="Thêm ảnh"><Image size={14} /><input type="file" accept="image/*" disabled={uploading} onChange={(event) => { void addImage(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label><label className={`animation-add-image ${uploading ? 'disabled' : ''}`} aria-label="Thêm sprite sheet"><Layers3 size={14} /><input type="file" accept="image/*" disabled={uploading} onChange={(event) => { void addSprite(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label><label className={`animation-add-image ${uploading ? 'disabled' : ''}`} aria-label="Thêm audio"><Volume2 size={14} /><input type="file" accept="audio/*" disabled={uploading} onChange={(event) => { void addAudio(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label><button type="button" aria-label="Thêm shape" onClick={() => addLayer('shape')}><Square size={14} /></button><button type="button" aria-label="Thêm text" onClick={() => addLayer('text')}><Type size={14} /></button><button type="button" aria-label="Thêm biểu đồ" onClick={() => addLayer('chart')}>▥</button><button type="button" aria-label="Thêm diagram" onClick={() => addLayer('diagram')}>→</button><button type="button" aria-label="Thêm particle" onClick={() => addLayer('particle')}>✦</button></div></div>
        <div className="animation-layer-list">{[...scene.layers].sort((a, b) => b.zIndex - a.zIndex).map((layer) => <button type="button" key={layer.id} className={layer.id === selectedLayerId ? 'active' : ''} onClick={() => setSelectedLayerId(layer.id)}><Layers3 size={14} aria-hidden="true" /><span>{layer.name}</span><small>{layer.type}</small></button>)}</div>
        <details className="animation-asset-library">
          <summary><span>Kho tài nguyên</span><small>{libraryAssets.length}</small><ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="animation-asset-search"><input aria-label="Tìm tài nguyên" value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="Tìm theo tên hoặc tag…" /></div>
          <details className="animation-asset-create"><summary><Plus size={13} aria-hidden="true" /> Tạo asset bằng AI</summary><div className="animation-asset-generator"><textarea aria-label="Mô tả asset" value={assetPrompt} onChange={(event) => setAssetPrompt(event.target.value)} placeholder="Mô tả asset cần tạo…" /><input value={imageModel} onChange={(event) => setImageModel(event.target.value)} aria-label="Image model" readOnly={usingFlowAgentAssets} /><button type="button" disabled={generatingAsset || assetPrompt.trim().length < 8 || (usingFlowAgentAssets && !flowAgent?.connected)} onClick={() => void generateAsset()}>{generatingAsset ? 'Đang tạo…' : usingFlowAgentAssets ? 'Tạo bằng Flow' : 'Tạo asset'}</button><label title="Số cột khi tải sprite sheet"><span>Sprite columns</span><input type="number" min="1" max="32" value={spriteColumns} onChange={(event) => setSpriteColumns(Number(event.target.value))} /></label></div></details>
          <div className="animation-asset-list">{libraryAssets.map((asset) => <button type="button" key={asset.id} onClick={() => reuseAsset(asset)} title="Thêm asset vào scene"><span>{asset.name}</span><small>{asset.type} · {asset.tags.slice(0, 2).join(', ') || 'chưa có tag'}</small></button>)}</div>
        </details>
      </aside>
      <main className="animation-stage-panel">
        <div className="animation-stage-controls"><button type="button" className="animation-play" aria-label={playing ? 'Tạm dừng' : 'Phát cảnh'} onClick={() => { if (playing) { setPlaying(false); setSequenceMode(false); return; } setSequenceMode(false); if (timeMs >= scene.durationMs) setTimeMs(0); setPlaying(true); }}>{playing ? <Pause size={15} /> : <Play size={15} />}</button><span>{seconds}s / {(scene.durationMs / 1000).toFixed(1)}s</span><label>Thời lượng cảnh <input aria-label="Thời lượng cảnh tính bằng giây" type="number" min="0.5" max="60" step="0.1" value={Number((scene.durationMs / 1000).toFixed(1))} onChange={(event) => { const durationMs = Math.round(Math.max(.5, Math.min(60, Number(event.target.value) || .5)) * 1000); updateScene((current) => ({ ...current, durationMs, commands: current.commands.filter((command) => command.startMs + command.durationMs <= durationMs), camera: { ...current.camera, commands: current.camera.commands.filter((command) => command.startMs + command.durationMs <= durationMs) } })); setTimeMs((value) => Math.min(value, durationMs)); }} /> giây</label><small>{sequenceMode ? `Đang xem toàn bộ · ${sequenceSeconds}s` : 'Kéo trực tiếp layer để đổi vị trí'}</small></div>
        <div className="animation-canvas-wrap" data-overlap-owner="canvas-selection"><AnimationCanvas scene={scene} assets={project.assets} width={project.width} height={project.height} timeMs={timeMs} selectedLayerId={selectedLayerId} exporting={rendering} showSubtitles={showSubtitles} onCanvasReady={(canvas) => { canvasRef.current = canvas; }} onSelect={(layerId) => setSelectedLayerId(layerId || '')} onMove={(layerId, x, y) => { const layer = scene.layers.find((item) => item.id === layerId); if (layer) updateLayer(layerId, { transform: { ...layer.transform, position: { x, y } } }); }} /></div>
      </main>
      <aside className="animation-inspector" aria-label="Thuộc tính layer">
        <div className="animation-panel-heading"><span>INSPECTOR</span>{selectedLayer && <button type="button" aria-label="Xóa layer" onClick={deleteLayer}><Trash2 size={14} /></button>}</div>
        {selectedLayer ? <div className="animation-inspector-fields">
          <label><span>Tên layer</span><input value={selectedLayer.name} onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value })} /></label>
          <div className="animation-field-row"><label><span>Hiển thị</span><input type="checkbox" checked={selectedLayer.visible} onChange={(event) => updateLayer(selectedLayer.id, { visible: event.target.checked })} /></label><label><span>Khóa</span><input type="checkbox" checked={selectedLayer.locked} onChange={(event) => updateLayer(selectedLayer.id, { locked: event.target.checked })} /></label></div>
          <label><span>Thứ tự layer</span><input type="number" value={selectedLayer.zIndex} onChange={(event) => updateLayer(selectedLayer.id, { zIndex: Number(event.target.value) })} /></label>
          {selectedLayer.type === 'text' && <label><span>Nội dung</span><textarea value={selectedLayer.text || ''} onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })} /></label>}
          {selectedLayer.type === 'chart' && <><label><span>Dữ liệu (phân cách dấu phẩy)</span><input value={(selectedLayer.data || []).join(', ')} onChange={(event) => updateLayer(selectedLayer.id, { data: event.target.value.split(',').map(Number).filter(Number.isFinite) })} /></label><label><span>Nhãn</span><input value={(selectedLayer.labels || []).join(', ')} onChange={(event) => updateLayer(selectedLayer.id, { labels: event.target.value.split(',').map((value) => value.trim()) })} /></label></>}
          {selectedLayer.type === 'audio' && <><label><span>Bắt đầu audio (ms)</span><input type="number" min="0" max={scene.durationMs} value={selectedLayer.startMs || 0} onChange={(event) => updateLayer(selectedLayer.id, { startMs: Number(event.target.value) })} /></label><label><span>Thời lượng audio (ms, 0 = hết file)</span><input type="number" min="0" value={selectedLayer.durationMs || 0} onChange={(event) => updateLayer(selectedLayer.id, { durationMs: Number(event.target.value) || undefined })} /></label><label><span>Âm lượng</span><input type="range" min="0" max="1" step="0.01" value={selectedLayer.volume ?? 1} onChange={(event) => updateLayer(selectedLayer.id, { volume: Number(event.target.value) })} /></label></>}
          {selectedAsset && <><label><span>Asset tags</span><input defaultValue={selectedAsset.tags.join(', ')} key={`${selectedAsset.id}-tags-${selectedAsset.tags.join('|')}`} onBlur={(event) => void updateAssetMetadata({ tags: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label><label><span>Style lock</span><input value={selectedAsset.style || ''} onChange={(event) => setProject((current) => ({ ...current, assets: current.assets.map((item) => item.id === selectedAsset.id ? { ...item, style: event.target.value } : item) }))} onBlur={(event) => void updateAssetMetadata({ style: event.target.value })} /></label></>}
          {selectedAsset?.sprite && <label><span>Sprite animation</span><select value={selectedLayer.animation || ''} onChange={(event) => updateLayer(selectedLayer.id, { animation: event.target.value })}>{Object.keys(selectedAsset.sprite.clips).map((clip) => <option key={clip} value={clip}>{clip}</option>)}</select></label>}
          <div className="animation-field-row"><label><span>X</span><input type="number" value={Math.round(selectedLayer.transform.position.x)} onChange={(event) => updateTransform('x', Number(event.target.value))} /></label><label><span>Y</span><input type="number" value={Math.round(selectedLayer.transform.position.y)} onChange={(event) => updateTransform('y', Number(event.target.value))} /></label></div>
          <div className="animation-field-row"><label><span>Rộng</span><input type="number" min="1" value={selectedLayer.width} onChange={(event) => updateLayer(selectedLayer.id, { width: Math.max(1, Number(event.target.value)) })} /></label><label><span>Cao</span><input type="number" min="1" value={selectedLayer.height} onChange={(event) => updateLayer(selectedLayer.id, { height: Math.max(1, Number(event.target.value)) })} /></label></div>
          <label><span>Scale <b>{selectedLayer.transform.scale.x.toFixed(2)}×</b></span><input type="range" min="0.1" max="3" step="0.05" value={selectedLayer.transform.scale.x} onChange={(event) => updateTransform('scale', Number(event.target.value))} /></label>
          <label><span>Rotation <b>{selectedLayer.transform.rotation}°</b></span><input type="range" min="-180" max="180" value={selectedLayer.transform.rotation} onChange={(event) => updateTransform('rotation', Number(event.target.value))} /></label>
          <label><span>Opacity <b>{Math.round(selectedLayer.transform.opacity * 100)}%</b></span><input type="range" min="0" max="1" step="0.01" value={selectedLayer.transform.opacity} onChange={(event) => updateTransform('opacity', Number(event.target.value))} /></label>
          <label><span>Màu</span><input type="color" value={selectedLayer.fill || '#ffffff'} onChange={(event) => updateLayer(selectedLayer.id, { fill: event.target.value })} /></label>
          <div className="animation-command-add"><span>Thêm command tại {seconds}s</span>{(['MOVE', 'FADE_IN', 'FADE_OUT', 'SCALE', 'ROTATE', 'PLAY_ANIMATION', 'TALK', 'POINT', 'LOOK_AT'] as AnimationCommandType[]).map((type) => <button key={type} type="button" onClick={() => addCommand(type)}>{type}</button>)}</div>
          {selectedCommand && <div className="animation-command-editor"><strong>{selectedCommand.type}</strong><label><span>Bắt đầu (ms)</span><input type="number" min="0" max={scene.durationMs - selectedCommand.durationMs} value={selectedCommand.startMs} onChange={(event) => updateCommand({ startMs: Math.max(0, Math.min(scene.durationMs - selectedCommand.durationMs, Number(event.target.value))) })} /></label><label><span>Thời lượng (ms)</span><input type="number" min="0" max={scene.durationMs - selectedCommand.startMs} value={selectedCommand.durationMs} onChange={(event) => updateCommand({ durationMs: Math.max(0, Math.min(scene.durationMs - selectedCommand.startMs, Number(event.target.value))) })} /></label><label><span>Easing</span><select value={selectedCommand.easing || 'linear'} onChange={(event) => updateCommand({ easing: event.target.value as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' })}><option value="linear">linear</option><option value="ease-in">ease-in</option><option value="ease-out">ease-out</option><option value="ease-in-out">ease-in-out</option></select></label>{selectedCommand.type === 'LOOK_AT' && <label><span>Nhìn vào layer</span><select value={selectedCommand.target || ''} onChange={(event) => updateCommand({ target: event.target.value })}>{scene.layers.filter((layer) => layer.id !== selectedCommand.targetId).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>}<button type="button" onClick={() => { updateScene((current) => ({ ...current, commands: current.commands.filter((command) => command.id !== selectedCommand.id) })); setSelectedCommandId(''); }}>Xóa command</button></div>}
        </div> : <div className="animation-empty-inspector"><Layers3 size={24} /><span>Chọn một layer trên canvas hoặc danh sách để chỉnh sửa.</span></div>}
      </aside>
    </div>
    <div className="animation-timeline" aria-label="Timeline scene">
      <div className="animation-timeline-top"><button type="button" aria-label={playing && sequenceMode ? 'Tạm dừng toàn bộ video' : 'Phát toàn bộ video'} onClick={toggleSequencePreview}>{playing && sequenceMode ? <Pause size={14} /> : <Play size={14} />}</button><strong>TOÀN BỘ VIDEO</strong><span>{sequenceSeconds}s / {(totalDurationMs / 1000).toFixed(1)}s</span></div>
      <div className="animation-sequence-overview" aria-label="Tất cả cảnh trong video">
        <div className="animation-sequence-lane">
          {compositeScenes.map((item, index) => <button type="button" key={item.id} className={item.id === scene.id ? 'active' : ''} style={{ flexGrow: item.durationMs }} title={`${index + 1}. ${item.name} · ${(item.durationMs / 1000).toFixed(1)}s`} onClick={() => jumpToSequenceScene(item.id)}><b>{String(index + 1).padStart(2, '0')}</b><span>{item.name}</span></button>)}
          <i className="animation-sequence-playhead" aria-hidden="true" style={{ left: `${sequenceTimeMs / Math.max(1, totalDurationMs) * 100}%` }} />
        </div>
      </div>
      <div className="animation-ruler">{Array.from({ length: Math.ceil(scene.durationMs / 1000) + 1 }, (_, index) => <span key={index} style={{ left: `${index * 1000 / scene.durationMs * 100}%` }}>{index}s</span>)}</div>
      <div className="animation-tracks">{scene.layers.map((layer) => <div className="animation-track" key={layer.id}><button type="button" onClick={() => setSelectedLayerId(layer.id)}>{layer.name}</button><div className="animation-track-lane" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setTimeMs(Math.max(0, Math.min(scene.durationMs, (event.clientX - rect.left) / rect.width * scene.durationMs))); }}>{scene.commands.filter((command) => command.targetId === layer.id).map((command) => <button type="button" key={command.id} className={`animation-command-block${command.id === selectedCommandId ? ' active' : ''}`} style={{ left: `${command.startMs / scene.durationMs * 100}%`, width: `${Math.max(2, command.durationMs / scene.durationMs * 100)}%` }} onClick={(event) => { event.stopPropagation(); setSelectedLayerId(layer.id); setSelectedCommandId(command.id); }} onPointerDown={(event) => { event.stopPropagation(); const lane = event.currentTarget.parentElement?.getBoundingClientRect(); const block = event.currentTarget.getBoundingClientRect(); if (!lane) return; commandDragRef.current = { id: command.id, startX: event.clientX, startMs: command.startMs, durationMs: command.durationMs, laneWidth: lane.width, mode: block.right - event.clientX < 10 ? 'resize' : 'move' }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={dragCommand} onPointerUp={() => { commandDragRef.current = undefined; }} onPointerCancel={() => { commandDragRef.current = undefined; }}>{command.type}<i aria-hidden="true" /></button>)}<i className="animation-playhead" style={{ left: `${timeMs / scene.durationMs * 100}%` }} /></div></div>)}</div>
      <input className="animation-scrubber" aria-label="Vị trí phát" type="range" min="0" max={scene.durationMs} step={1000 / project.fps} value={timeMs} onChange={(event) => { setPlaying(false); setSequenceMode(false); setTimeMs(Number(event.target.value)); }} />
    </div>
  </section>;
}
