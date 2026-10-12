import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, Download, Image, Layers3, LoaderCircle, Pause, Play, Plus, Save, Sparkles, Trash2, Type, Upload, Volume2 } from '../components/Icons';
import type { AIProvider, AppSettings } from '../types';
import { api, friendlyErrorMessage } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import {
  createCanvasObject,
  createCanvasProject,
  createCanvasScene,
  type CanvasAnimationAction,
  type CanvasAnimationBeat,
  type CanvasBackgroundPreset,
  type CanvasCameraMotion,
  type CanvasCharacterPose,
  type CanvasExpression,
  type CanvasFacing,
  type CanvasMotion,
  type CanvasShotType,
  type CanvasObjectKind,
  type CanvasStudioObject,
  type CanvasStudioProject,
  type CanvasStudioScene,
} from '../canvasAnimationStudio/types';
import { preloadCanvasSceneImages } from '../canvasAnimationStudio/renderer';
import {renderCanvasSceneWithTransition} from '../canvasAnimationStudio/sceneTransition';
import { recordPureCanvasProject } from '../canvasAnimationStudio/canvasExporter';
import { CANVAS_BEAT_ACTIONS, clampBeatToScene, createCanvasBeat, validateCanvasBeat } from '../../shared/canvasBeats';
import { evaluateCanvasCamera, evaluateCanvasObject, projectDurationMs, resolveProjectTime } from '../canvasAnimationStudio/runtime';
import { applyRecipeToBrief, FILM_RECIPES, filmRecipeById } from '../../shared/filmRecipes';
import {readVectorStyleReference} from '../lib/vectorStyleReferences';
import { loadVoicePreview } from '../lib/voicePreview';
import './CanvasAnimationStudioPage.css';
import { CanvasAudioPanel } from '../canvasAnimationStudio/CanvasAudioPanel';
import {compileCanvasProjectLayout} from '../../shared/canvasLayoutCompiler';

const STORAGE_KEY = 'autosub.canvas-animation-studio.v1';

const MOTIONS: { value: CanvasMotion; label: string }[] = [
  { value: 'none', label: 'Không chuyển động' },
  { value: 'slide-left', label: 'Trượt từ trái' },
  { value: 'slide-right', label: 'Trượt từ phải' },
  { value: 'slide-up', label: 'Trượt từ dưới' },
  { value: 'pop', label: 'Pop in' },
  { value: 'float', label: 'Lơ lửng' },
  { value: 'shake', label: 'Rung' },
  { value: 'drift-left', label: 'Trôi sang trái' },
  { value: 'drift-right', label: 'Trôi sang phải' },
  { value: 'pulse', label: 'Nhịp/pulse' },
  { value: 'bounce', label: 'Nảy' },
  { value: 'walk-left', label: 'Đi sang trái' },
  { value: 'walk-right', label: 'Đi sang phải' },
  { value: 'hit', label: 'Va đập' },
  { value: 'tilt-left', label: 'Nghiêng trái' },
  { value: 'tilt-right', label: 'Nghiêng phải' },
  { value: 'fall', label: 'Ngã / rơi' },
];


const POSES: { value: CanvasCharacterPose; label: string }[] = [
  {value:'struggle',label:'Vùng vẫy'},
  {value:'float-body',label:'Nằm toàn thân'},
  {value:'sit',label:'Ngồi'},
  {value:'reach',label:'Lấy / chạm vật'},
  {value:'wipe',label:'Lau'},
  {value:'write',label:'Viết'},
  {value:'tie',label:'Buộc dây'},
  {value:'aid',label:'Chăm sóc chân bị thương'},
  {value:'assist',label:'Dìu người'},
  { value: 'idle', label: 'Đứng' },
  { value: 'talk', label: 'Nói / gesturing' },
  { value: 'gesture', label: 'Giải thích nhẹ' },
  { value: 'nod', label: 'Gật đầu' },
  { value: 'point', label: 'Chỉ tay' },
  { value: 'run', label: 'Chạy' },
  { value: 'row', label: 'Chèo' },
  { value: 'brace', label: 'Chống / giữ thăng bằng' },
  { value: 'celebrate', label: 'Ăn mừng' },
  { value: 'lie-down', label: 'Nằm dưới chăn' },
  { value: 'cover-face', label: 'Kéo chăn che mặt' },
];

const BEAT_ACTION_LABELS: Record<CanvasAnimationAction, string> = {
  grab:'Nắm / túm',pull:'Kéo ngã',release:'Thả / thu lại',struggle:'Vùng vẫy',sink:'Chìm xuống',surface:'Trồi lên',
  reach:'Lấy / chạm vật',wipe:'Lau',write:'Viết',tie:'Buộc dây',aid:'Chăm sóc chân',assist:'Dìu người',
  talk: 'Nói',
  gesture: 'Giải thích nhẹ',
  nod: 'Gật đầu',
  point: 'Chỉ tay',
  react: 'Giật mình',
  celebrate: 'Ăn mừng',
  brace: 'Chống đỡ',
  run: 'Chạy',
  row: 'Chèo',
  reveal: 'Hiện ra',
  impact: 'Va đập',
  float: 'Lơ lửng',
  pulse: 'Nhịp',
};

const SHOTS: { value: CanvasShotType; label: string }[] = [
  { value: 'wide', label: 'Wide' },
  { value: 'medium', label: 'Medium' },
  { value: 'close-up', label: 'Close-up' },
  { value: 'extreme-close-up', label: 'Extreme close-up' },
  { value: 'pov', label: 'POV' },
  { value: 'diagram', label: 'Diagram' },
  { value: 'split', label: 'Split comparison' },
];

const CAMERA_MOTIONS: { value: CanvasCameraMotion; label: string }[] = [
  { value: 'none', label: 'Tĩnh' },
  { value: 'push-in', label: 'Push in' },
  { value: 'pull-out', label: 'Pull out' },
  { value: 'pan-left', label: 'Pan trái' },
  { value: 'pan-right', label: 'Pan phải' },
  { value: 'follow', label: 'Follow' },
  { value: 'impact', label: 'Impact' },
];

const BACKGROUNDS: { value: CanvasBackgroundPreset; label: string }[] = [
  { value: 'river', label: 'Sông / chiến trận' },
  { value: 'field', label: 'Đồng cỏ' },
  { value: 'paper', label: 'Giấy / giải thích' },
  { value: 'night', label: 'Ban đêm' },
  { value: 'room', label: 'Trong phòng' },
  { value: 'city', label: 'Thành phố' },
  { value: 'underwater', label: 'Dưới nước' },
  { value: 'map', label: 'Bản đồ chiến thuật' },
];

const EXPRESSIONS: { value: CanvasExpression; label: string }[] = [
  { value: 'neutral', label: 'Bình thường' },
  { value: 'happy', label: 'Vui' },
  { value: 'angry', label: 'Giận dữ' },
  { value: 'surprised', label: 'Bất ngờ' },
  { value: 'sad', label: 'Buồn' },
  { value: 'afraid', label: 'Sợ hãi / nín thở' },
];

function loadInitialProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createCanvasProject();
    const parsed = JSON.parse(raw) as CanvasStudioProject;
    if (parsed?.version !== 1 || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return createCanvasProject();
    return parsed;
  } catch {
    return createCanvasProject();
  }
}

function sceneStartMs(project: CanvasStudioProject, sceneId: string) {
  let start = 0;
  for (const scene of project.scenes) {
    if (scene.id === sceneId) return start;
    start += scene.durationMs;
  }
  return 0;
}

function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

function cloneScene(scene: CanvasStudioScene): CanvasStudioScene {
  const stamp = Date.now();
  return {
    ...scene,
    id: `scene-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${scene.name} copy`,
    objects: scene.objects.map((object, index) => ({
      ...object,
      id: `obj-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    })),
  };
}

function CanvasStage({
  scene,
  previousScene,
  timeMs,
  width,
  height,
  selectedObjectId,
  onSelect,
  onMove,
}: {
  scene: CanvasStudioScene;
  previousScene?:CanvasStudioScene;
  timeMs: number;
  width: number;
  height: number;
  selectedObjectId: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [assetRevision, setAssetRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.all([scene,previousScene].filter((item):item is CanvasStudioScene=>!!item).map(item=>preloadCanvasSceneImages(item))).then(() => {
      if (active) setAssetRevision((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [scene,previousScene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderCanvasSceneWithTransition(ctx,scene,previousScene,timeMs,width,height);
    const selected = scene.objects.find((object) => object.id === selectedObjectId);
    if (selected) {
      const transform = evaluateCanvasObject(selected, scene, timeMs);
      const camera = evaluateCanvasCamera(scene, timeMs, width, height);
      ctx.save();
      ctx.translate(camera.offsetX, camera.offsetY);
      ctx.translate(camera.focusX, camera.focusY);
      ctx.rotate((camera.rotation * Math.PI) / 180);
      ctx.scale(camera.scale, camera.scale);
      ctx.translate(-camera.focusX, -camera.focusY);
      ctx.translate(transform.x, transform.y);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.scale, transform.scale);
      ctx.strokeStyle = '#6ee7f7';
      ctx.lineWidth = 3 / Math.max(0.2, transform.scale);
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(-selected.width / 2 - 8, -selected.height / 2 - 8, selected.width + 16, selected.height + 16);
      ctx.restore();
    }
  }, [scene, timeMs, width, height, selectedObjectId, assetRevision,previousScene]);

  const pointerToScene = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    const screenX = ((event.clientX - bounds.left) / bounds.width) * width;
    const screenY = ((event.clientY - bounds.top) / bounds.height) * height;
    const camera = evaluateCanvasCamera(scene, timeMs, width, height);
    const x0 = screenX - camera.offsetX - camera.focusX;
    const y0 = screenY - camera.offsetY - camera.focusY;
    const angle = (-camera.rotation * Math.PI) / 180;
    const rotatedX = x0 * Math.cos(angle) - y0 * Math.sin(angle);
    const rotatedY = x0 * Math.sin(angle) + y0 * Math.cos(angle);
    return {
      x: rotatedX / camera.scale + camera.focusX,
      y: rotatedY / camera.scale + camera.focusY,
    };
  };

  const hitTest = (x: number, y: number) => {
    const ordered = [...scene.objects].sort((a, b) => b.zIndex - a.zIndex);
    return ordered.find((object) => {
      const transform = evaluateCanvasObject(object, scene, timeMs);
      const halfW = (object.width * transform.scale) / 2;
      const halfH = (object.height * transform.scale) / 2;
      return x >= transform.x - halfW && x <= transform.x + halfW && y >= transform.y - halfH && y <= transform.y + halfH;
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointerToScene(event);
    const hit = hitTest(point.x, point.y);
    if (!hit) {
      onSelect('');
      return;
    }
    const transform = evaluateCanvasObject(hit, scene, timeMs);
    onSelect(hit.id);
    dragRef.current = { id: hit.id, offsetX: point.x - transform.x, offsetY: point.y - transform.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointerToScene(event);
    onMove(drag.id, point.x - drag.offsetX, point.y - drag.offsetY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <canvas
      ref={canvasRef}
      className="canvas-studio-stage"
      style={{ aspectRatio: `${width} / ${height}`, '--canvas-aspect-ratio': width / height } as CSSProperties}
      width={width}
      height={height}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-label="Canvas preview"
    />
  );
}

export function CanvasAnimationStudioPage({
  providers,
  settings,
  onNotice,
}: {
  providers: AIProvider[];
  settings: AppSettings;
  onNotice: (message: string, kind?: 'success' | 'error') => void;
}) {
  const [project, setProject] = useState<CanvasStudioProject>(() => loadInitialProject());
  const [projectTimeMs, setProjectTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [generatorExpanded, setGeneratorExpanded] = useState(true);
  const [selectedSceneId, setSelectedSceneId] = useState(() => project.scenes[0]?.id || '');
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [brief, setBrief] = useState('');
  const [generationAspect, setGenerationAspect] = useState<'16:9'|'9:16'>(() => project.height > project.width ? '9:16' : '16:9');
  const [generating, setGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState('');
  const [renderProgress, setRenderProgress] = useState(0);
  const [ttsVoices, setTtsVoices] = useState<Array<{ id: string; name?: string; language?: string }>>([]);
  const [ttsVoice, setTtsVoice] = useState('');
  const [recipeId, setRecipeId] = useState('vui-ve');
  const [styleReferences,setStyleReferences]=useState<string[]>([]);
  const [styleReferenceName,setStyleReferenceName]=useState('');
  const [readingReference,setReadingReference]=useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [buildingAudio,setBuildingAudio]=useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const directorAssignment = capabilityAssignments(settings, 'translation')[0];
  const directorProvider = providers.find((item) => item.id === directorAssignment?.providerId);
  const ttsAssignment = capabilityAssignments(settings, 'tts')[0];
  const ttsProvider = providers.find((item) => item.id === ttsAssignment?.providerId);

  const totalDuration = useMemo(() => projectDurationMs(project.scenes), [project.scenes]);
  const resolved = useMemo(
    () => resolveProjectTime(project.scenes, projectTimeMs),
    [project.scenes, projectTimeMs],
  );
  const activeScene = resolved.scene || project.scenes[0];
  const directedProject=useMemo(()=>compileCanvasProjectLayout(project),[project]);
  const previewScene=directedProject.scenes.find(scene=>scene.id===activeScene?.id)||activeScene;
  const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId) || activeScene;
  const selectedObject = selectedScene?.objects.find((object) => object.id === selectedObjectId);

  useEffect(() => {
    if (!ttsProvider) { setTtsVoices([]); setTtsVoice(''); return; }
    const fallback = ttsProvider.providerType === 'hiiu-tts'
      ? ttsProvider.models.map((model) => ({ id: model.id, name: model.name }))
      : (ttsProvider.voices || []);
    setTtsVoices(fallback);
    if (fallback[0]) setTtsVoice((current) => fallback.some((voice) => voice.id === current) ? current : fallback[0]!.id);
    const controller = new AbortController();
    void api.listVoices(ttsProvider, controller.signal).then(({ voices }) => {
      if (!voices.length) return;
      setTtsVoices(voices);
      setTtsVoice((current) => voices.some((voice) => voice.id === current) ? current : voices[0]!.id);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [ttsProvider]);

  useEffect(() => {
    const current = previewAudioRef.current;
    if (current) { current.pause(); previewAudioRef.current = null; }
    if (!playing || !activeScene?.audioUrl) return;
    const audio = new Audio(activeScene.audioUrl);
    previewAudioRef.current = audio;
    audio.currentTime = Math.max(0, resolved.localTimeMs / 1000);
    void audio.play().catch(() => undefined);
    return () => { audio.pause(); if (previewAudioRef.current === audio) previewAudioRef.current = null; };
  }, [playing, activeScene?.id, activeScene?.audioUrl]);

  useEffect(() => {
    if (resolved.scene && resolved.scene.id !== selectedSceneId && playing) {
      setSelectedSceneId(resolved.scene.id);
      setSelectedObjectId('');
    }
  }, [playing, resolved.scene, selectedSceneId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      } catch {
        // Ignore storage quota/private-mode failures. JSON export remains available.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      if(document.hidden){setPlaying(false);return;}
      const elapsed=now-previous;
      if(elapsed<1000/Math.min(30,project.fps)){frame=requestAnimationFrame(tick);return;}
      const delta = elapsed;
      previous = now;
      setProjectTimeMs((current) => {
        const next = current + delta;
        if (next >= totalDuration) {
          setPlaying(false);
          return totalDuration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, totalDuration,project.fps]);

  useEffect(() => {
    if (projectTimeMs > totalDuration) setProjectTimeMs(totalDuration);
  }, [projectTimeMs, totalDuration]);

  if (!activeScene || !selectedScene) {
    return <section className="canvas-studio-page"><p>Animation Studio chưa có scene.</p></section>;
  }

  const updateScene = (sceneId: string, updater: (scene: CanvasStudioScene) => CanvasStudioScene) => {
    setProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => (scene.id === sceneId ? updater(scene) : scene)),
    }));
  };

  const updateSelectedObject = (patch: Partial<CanvasStudioObject>) => {
    if (!selectedObject) return;
    updateScene(selectedScene.id, (scene) => ({
      ...scene,
      objects: scene.objects.map((object) => (object.id === selectedObject.id ? { ...object, ...patch } : object)),
    }));
  };

  const selectScene = (scene: CanvasStudioScene) => {
    setPlaying(false);
    setSelectedSceneId(scene.id);
    setSelectedObjectId('');
    setProjectTimeMs(sceneStartMs(project, scene.id));
  };

  const addScene = () => {
    const scene = createCanvasScene(project.scenes.length);
    setProject((current) => ({ ...current, scenes: [...current.scenes, scene] }));
    setSelectedSceneId(scene.id);
    setSelectedObjectId('');
    setProjectTimeMs(totalDuration);
  };

  const duplicateSelectedScene = () => {
    const copy = cloneScene(selectedScene);
    const index = project.scenes.findIndex((scene) => scene.id === selectedScene.id);
    setProject((current) => {
      const scenes = [...current.scenes];
      scenes.splice(index + 1, 0, copy);
      return { ...current, scenes };
    });
    setSelectedSceneId(copy.id);
    setSelectedObjectId('');
    setProjectTimeMs(sceneStartMs(project, selectedScene.id) + selectedScene.durationMs);
  };

  const deleteSelectedScene = () => {
    if (project.scenes.length <= 1) {
      onNotice('Animation Studio cần ít nhất 1 scene.', 'error');
      return;
    }
    const index = project.scenes.findIndex((scene) => scene.id === selectedScene.id);
    const nextScenes = project.scenes.filter((scene) => scene.id !== selectedScene.id);
    const nextScene = nextScenes[Math.min(index, nextScenes.length - 1)];
    if (!nextScene) return;
    setProject((current) => ({ ...current, scenes: nextScenes }));
    setSelectedSceneId(nextScene.id);
    setSelectedObjectId('');
    setProjectTimeMs(sceneStartMs({ ...project, scenes: nextScenes }, nextScene.id));
  };

  const addObject = (kind: CanvasObjectKind) => {
    const object = createCanvasObject(kind, {
      x: kind === 'text' ? 640 : 560,
      y: kind === 'text' ? 120 : 390,
      zIndex: kind === 'text' ? 30 : 20,
    });
    updateScene(selectedScene.id, (scene) => ({ ...scene, objects: [...scene.objects, object] }));
    setSelectedObjectId(object.id);
  };

  const removeSelectedObject = () => {
    if (!selectedObject) return;
    updateScene(selectedScene.id, (scene) => ({
      ...scene,
      objects: scene.objects.filter((object) => object.id !== selectedObject.id),
    }));
    setSelectedObjectId('');
  };

  const moveObject = (id: string, x: number, y: number) => {
    updateScene(activeScene.id, (scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        object.id === id
          ? {
              ...object,
              x: Math.round(Math.max(-object.width, Math.min(project.width + object.width, x))),
              y: Math.round(Math.max(-object.height, Math.min(project.height + object.height, y))),
            }
          : object,
      ),
    }));
  };

  const importImage = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!imageUrl) return;
      const object = createCanvasObject('image', {
        label: file.name,
        imageUrl,
        x: 640,
        y: 360,
        zIndex: 18,
        motion: 'pop',
      });
      updateScene(selectedScene.id, (scene) => ({ ...scene, objects: [...scene.objects, object] }));
      setSelectedObjectId(object.id);
      onNotice('Đã thêm ảnh vào Canvas scene.');
    };
    reader.readAsDataURL(file);
  };

  const saveNow = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      onNotice('Đã lưu Animation Studio trên máy.');
    } catch {
      onNotice('Không thể lưu project vào localStorage. Hãy xuất JSON để giữ project.', 'error');
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'animation-studio'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openJson = () => {
    setJsonDraft(JSON.stringify(project, null, 2));
    setJsonOpen(true);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as CanvasStudioProject;
      if (parsed?.version !== 1 || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        throw new Error('Project JSON không đúng schema Canvas Studio v1.');
      }
      const normalized = parsed;
      const firstScene = normalized.scenes[0];
      if (!firstScene) throw new Error('Project JSON cần ít nhất 1 scene.');
      setProject(normalized);
      setSelectedSceneId(firstScene.id);
      setSelectedObjectId('');
      setProjectTimeMs(0);
      setPlaying(false);
      setJsonOpen(false);
      onNotice('Đã áp dụng scene JSON.');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'JSON không hợp lệ.', 'error');
    }
  };

  const renderAndDownload = async (target: CanvasStudioProject) => {
    setGenerationStage('Đang render MP4 từ Canvas…');
    setRenderProgress(0);
    const blob = await api.renderCanvasAnimationProject(target, setRenderProgress);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${target.name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'animation-studio'}.mp4`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const testVoice = async () => {
    if (!ttsProvider || !ttsAssignment?.model || !ttsVoice || testingVoice) return;
    setTestingVoice(true);
    try {
      const blob = await loadVoicePreview(ttsProvider, ttsAssignment.model, ttsVoice, 1);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setTestingVoice(false); };
      audio.onerror = () => { URL.revokeObjectURL(url); setTestingVoice(false); };
      await audio.play();
    } catch (error) {
      setTestingVoice(false);
      onNotice(friendlyErrorMessage(error, 'Không thể tạo bản nghe thử.'), 'error');
    }
  };

  const setCastVoice=(key:string,voice:string)=>setProject(current=>({
    ...current,castVoices:{...current.castVoices,[key]:voice},
    scenes:current.scenes.map(scene=>scene.dialogue?.some(line=>(line.characterKey||line.speaker)===key)?{
      ...scene,audioMixKey:undefined,dialogue:scene.dialogue.map(line=>({...line,atMs:undefined})),
    }:scene),
  }));
  const buildSceneAudio=async()=>{
    if(buildingAudio||!selectedScene)return;
    const voice=ttsVoice||ttsProvider?.voices?.[0]?.id;
    if(!ttsProvider||!ttsAssignment?.model||!voice){onNotice('Hãy chọn TTS và giọng đọc trước.','error');return;}
    setBuildingAudio(true);setPlaying(false);
    const id=selectedScene.id;
    try {
      const result=await api.buildCanvasAudio({project:{...project,scenes:[selectedScene]},narration:{provider:ttsProvider,model:ttsAssignment.model,voice,speed:filmRecipeById(recipeId).narrationSpeed},autoSound:true});
      const audioScene=result.scenes[0]!;
      setProject(current=>({...current,castVoices:{...current.castVoices,...result.castVoices},scenes:current.scenes.map(scene=>scene.id===id?{
        ...scene,durationMs:Math.max(scene.durationMs,audioScene.durationMs),audioUrl:audioScene.audioUrl,sourceAudioUrl:audioScene.sourceAudioUrl,audioMixKey:audioScene.audioMixKey,
        dialogue:audioScene.dialogue,soundEffects:audioScene.soundEffects,lipSync:audioScene.lipSync,
        animationBeats:[...(scene.animationBeats||[]).filter(beat=>!beat.id.startsWith('voice-')).map(beat=>{
          const submitted=selectedScene.animationBeats?.find(item=>item.id===beat.id);
          const aligned=audioScene.animationBeats?.find(item=>item.id===beat.id);
          return aligned&&JSON.stringify(submitted)===JSON.stringify(beat)?aligned:beat;
        }),...(audioScene.animationBeats||[]).filter(beat=>beat.id.startsWith('voice-'))],
      }:scene)}));
      onNotice('Đã dựng giọng từng vai và tiếng động của cảnh.','success');
    } catch(error){onNotice(friendlyErrorMessage(error,'Không thể dựng âm thanh; audio cũ vẫn được giữ.'),'error');}
    finally {setBuildingAudio(false);}
  };

  const generateCompleteVideo = async () => {
    if (generating||readingReference) return;
    if (brief.trim().length < 8) { onNotice('Hãy nhập ý tưởng video rõ hơn.', 'error'); return; }
    if (!directorProvider || !directorAssignment?.model) { onNotice('Hãy cấu hình AI dùng cho Translation/Chat trong Cài đặt.', 'error'); return; }
    if (!ttsProvider || !ttsAssignment?.model) { onNotice('Hãy cấu hình TTS trong Cài đặt.', 'error'); return; }
    const selectedVoice = ttsVoice || ttsProvider.voices?.[0]?.id || (ttsProvider.providerType === 'hiiu-tts' ? ttsAssignment.model : '');
    if (!selectedVoice) { onNotice('TTS chưa có giọng đọc khả dụng.', 'error'); return; }
    const recipe = filmRecipeById(recipeId);
    setGenerating(true);
    setPlaying(false);
    setGenerationStage('AI đang dựng cảnh, tạo hình và kiểm tra ảnh render…');
    setRenderProgress(0);
    try {
      const outputSize = generationAspect === '9:16' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
      const generationBrief=applyRecipeToBrief(brief.trim(),recipe,recipe.visualMode==='procedural'?'code-vector':undefined);
      const generated = await api.generateCanvasAnimationVideo({
        brief:generationBrief,
        ...(styleReferences.length?{referenceImages:styleReferences,refineVisuals:project.sourcePrompt===generationBrief&&project.width===outputSize.width&&project.height===outputSize.height&&project.scenes.every(scene=>scene.vectorScene)&&JSON.stringify(styleReferences)!==JSON.stringify(project.vectorStyleReferences)}:{}),
        ...(project.sourcePrompt===generationBrief&&project.width===outputSize.width&&project.height===outputSize.height&&project.scenes.every(scene=>scene.vectorScene)?{project}:{}),
        width: outputSize.width,
        height: outputSize.height,
        provider: directorProvider,
        model: directorAssignment.model,
        narration: { provider: ttsProvider, model: ttsAssignment.model, voice: selectedVoice, speed: recipe.narrationSpeed },
        audioProduction: {enabled:true,autoSound:true},
        visualMode: recipe.visualMode==='procedural'?'code-vector':recipe.visualMode,
        ...(recipe.visualMode === 'ai-fallback' ? {
          assetGeneration: { enabled: true as const, quality: 'professional' as const, generator: 'flow-agent' as const, model: 'narwhal' },
        } : {}),
      });
      const first = generated.scenes[0];
      if (!first) throw new Error('AI không tạo được scene nào.');
      setProject(generated);
      setProjectTimeMs(0);
      setSelectedSceneId(first.id);
      setSelectedObjectId('');
      const assets = generated.assetPipeline;
      setGenerationStage(assets
        ? `Asset fallback: ${assets.approved} đạt · ${assets.rejected} loại. Đang render ${generated.scenes.length} scene…`
        : generated.vectorReview?.pass===false
          ? `Đang xuất bản nháp · còn ${generated.vectorReview.issues?.length||0} điểm cần xem lại…`
        : generated.vectorReview?.pass
          ? `Đã kiểm tra ảnh render của ${generated.scenes.length} cảnh. Đang xuất video…`
          : `Đã dựng ${generated.scenes.length} cảnh và giọng đọc. Đang xuất video…`);
      await renderAndDownload(generated);
      setGenerationStage(generated.vectorReview?.pass===false?'Bản nháp MP4 đã sẵn sàng · xem các điểm cần kiểm tra bên dưới':'Hoàn tất · MP4 đã sẵn sàng');
      onNotice(generated.vectorReview?.pass===false?`Đã xuất bản nháp MP4; còn ${generated.vectorReview.issues?.length||0} điểm cần xem lại.`:assets
        ? `Đã tạo video với fallback asset và xuất MP4.`
        : `Đã dựng ${generated.scenes.length} cảnh và xuất MP4.`);
    } catch (error) {
      setGenerationStage('');
      onNotice(friendlyErrorMessage(error, 'Không thể tạo video Animation Studio.'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const exportCurrentMp4 = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      await renderAndDownload(project);
      setGenerationStage('Hoàn tất · MP4 đã sẵn sàng');
      onNotice('Đã xuất MP4 từ Canvas project hiện tại.');
    } catch (error) {
      setGenerationStage('');
      onNotice(friendlyErrorMessage(error, 'Không thể xuất MP4.'), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const exportPureCanvasDraft = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      // Phase 1: thuần JS + HTML Canvas, không qua Remotion/Chrome headless.
      setGenerationStage('Đang ghi thuần Canvas (JS + captureStream)…');
      setRenderProgress(0);
      const recording = await recordPureCanvasProject(project, {
        onProgress: (doneMs, totalMs) => setRenderProgress(Math.round((doneMs / Math.max(1, totalMs)) * 60)),
      });
      // Dùng lại hàng đợi transcode webm→mp4 sẵn có, không cần backend mới.
      setGenerationStage('Đang chuyển webm thuần sang MP4…');
      const mp4 = await api.renderAnimationProject(project.id, recording, undefined, (progress) => {
        setRenderProgress(60 + Math.round(progress * 0.4));
      });
      const url = URL.createObjectURL(mp4);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${project.name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'canvas-thuan'}-pure.mp4`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setGenerationStage('Hoàn tất · MP4 thuần Canvas đã sẵn sàng');
      onNotice('Đã xuất MP4 thuần Canvas (Beta).');
    } catch (error) {
      // Fallback giữ nguyên pipeline Remotion để không gãy job đang chạy.
      onNotice(`${friendlyErrorMessage(error, 'Xuất thuần thất bại.')} Đang thử lại bằng Remotion…`);
      try {
        await renderAndDownload(project);
        setGenerationStage('Hoàn tất · MP4 Remotion đã sẵn sàng');
      } catch (fallbackError) {
        setGenerationStage('');
        onNotice(friendlyErrorMessage(fallbackError, 'Không thể xuất MP4.'), 'error');
      }
    } finally {
      setGenerating(false);
    }
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (projectTimeMs >= totalDuration - 1) setProjectTimeMs(0);
    setPlaying(true);
  };

  return (
    <section className="canvas-studio-page" aria-label="Animation Studio Canvas">
      <header className="canvas-studio-toolbar">
        <div className="canvas-studio-title">
          <span className="canvas-studio-kicker"><Layers3 size={15} /> Animation Studio</span>
          <input
            aria-label="Tên Canvas project"
            value={project.name}
            onChange={(event) => setProject((current) => ({ ...current, name: event.target.value }))}
          />
          <small>{project.width} × {project.height} · {project.fps} fps</small>
        </div>
        <div className="canvas-studio-toolbar-actions">
          <details className="canvas-project-tools" data-overlap-owner="project-tools">
            <summary>Công cụ <ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="canvas-project-tools-menu">
              <button className="button quiet" type="button" onClick={openJson}>Chỉnh JSON</button>
              <button className="button quiet" type="button" onClick={exportJson}><Download size={15} /> Xuất JSON</button>
              <button className="button quiet" type="button" disabled={generating} onClick={() => void exportPureCanvasDraft()} title="Ghi trực tiếp từ JS Canvas, không qua Remotion"><Download size={15} /> Xuất thuần Canvas</button>
            </div>
          </details>
          <button className="button quiet" type="button" disabled={generating} onClick={() => void exportCurrentMp4()}><Download size={15} /> Xuất MP4</button>
          <button className="button primary" type="button" onClick={saveNow}><Save size={15} /> Lưu</button>
        </div>
      </header>

      <section className="canvas-ai-generator" aria-label="AI tự tạo video hoàn chỉnh">
        <div className="canvas-ai-generator-copy">
          <strong><Sparkles size={16} aria-hidden="true" /> Tạo video từ ý tưởng</strong>
          <button className="canvas-generator-toggle" type="button" aria-expanded={generatorExpanded} aria-controls="canvas-generator-fields" onClick={() => setGeneratorExpanded((value) => !value)}>
            {generatorExpanded ? 'Thu gọn' : 'Mở ý tưởng'} <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>

        <div id="canvas-generator-fields" className="canvas-generator-fields" hidden={!generatorExpanded}>
        <div className="canvas-ai-generator-input">
          <label className="canvas-generator-sr-only" htmlFor="canvas-video-brief">Ý tưởng của bạn</label>
          <textarea
            id="canvas-video-brief"
            rows={2}
            maxLength={12000}
            value={brief}
            disabled={generating}
            onChange={(event) => setBrief(event.target.value)}
            placeholder={recipeId === 'ma-xo'
              ? 'Một chuyến lên bản làm thuê và lời dặn kỳ lạ. Kể chậm, dài 60 giây…'
              : 'Kể chuyện trận Bạch Đằng trong 60 giây, vui và dễ hiểu…'}
            aria-label="Prompt tạo video Animation Studio"
            aria-describedby="canvas-brief-hint"
          />
          <div className="canvas-brief-footer" id="canvas-brief-hint">
            <span>Nêu chủ đề, thời lượng và cách kể.</span>
            <span className="canvas-prompt-count">{brief.length.toLocaleString('vi-VN')} / 12.000</span>
          </div>
        </div>

        <label className="field" style={{marginBottom:12}}>
          <span>Hình hoặc video mẫu (tùy chọn)</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,video/*" disabled={generating||readingReference} style={{position:'static',width:'100%',height:'auto',opacity:1}} onChange={async event=>{
            const file=event.currentTarget.files?.[0];if(!file)return;
            setReadingReference(true);
            try{setStyleReferences(await readVectorStyleReference(file));setStyleReferenceName(file.name);}
            catch(error){onNotice(friendlyErrorMessage(error,'Không đọc được hình mẫu.'),'error');}
            finally{setReadingReference(false);}
          }}/>
          {readingReference?<small>Đang lấy khung hình mẫu…</small>:styleReferenceName?<small>{styleReferenceName} · {styleReferences.length} khung hình</small>:null}
        </label>
        <fieldset className="canvas-film-styles" disabled={generating}>
          <legend className="canvas-generator-sr-only">Phong cách video</legend>
          <div className="canvas-film-style-options">
            {FILM_RECIPES.map((recipe) => (
              <label key={recipe.id} className={`canvas-film-style ${recipeId === recipe.id ? 'selected' : ''}`} title={recipe.description}>
                <input type="radio" name="canvas-film-recipe" value={recipe.id} checked={recipeId === recipe.id} onChange={() => setRecipeId(recipe.id)} aria-describedby="canvas-style-help" />
                <strong>{recipe.name}</strong>
              </label>
            ))}
          </div>
          <p id="canvas-style-help" className="canvas-style-description canvas-generator-sr-only">{filmRecipeById(recipeId).description}</p>
        </fieldset>

        <div className="canvas-ai-generator-actions">
          <div className="canvas-aspect-control" aria-label="Tỷ lệ khung hình video">
            <span>Tỷ lệ</span>
            <div>
              {(['16:9','9:16'] as const).map((ratio) => (
                <button key={ratio} type="button" aria-pressed={generationAspect === ratio} disabled={generating} onClick={() => setGenerationAspect(ratio)}>{ratio}</button>
              ))}
            </div>
          </div>
          <label className="field canvas-ai-field" htmlFor="canvas-tts-voice">
            <span>Giọng đọc</span>
            <select
              id="canvas-tts-voice"
              aria-label="Chọn giọng đọc"
              value={ttsVoice}
              disabled={generating || !ttsVoices.length}
              onChange={(event) => setTtsVoice(event.target.value)}
            >
              {ttsVoices.length
                ? ttsVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name || voice.id}{voice.language ? ` · ${voice.language}` : ''}
                  </option>
                ))
                : <option value="">Chọn TTS trong Cài đặt</option>}
            </select>
          </label>
          <button
            type="button"
            className="button ghost"
            disabled={generating || testingVoice || !ttsProvider || !ttsAssignment?.model || !ttsVoice}
            onClick={() => void testVoice()}
          >
            {testingVoice ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}
            {testingVoice ? 'Đang phát…' : 'Nghe thử'}
          </button>
          <button className="button primary canvas-generate-video" type="button" disabled={generating || brief.trim().length < 8} onClick={() => void generateCompleteVideo()}>
            {generating ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
            {generating ? 'Đang tạo video…' : 'Tạo video'}
          </button>
        </div>
        </div>

        {(generationStage || generating) && <div className="canvas-generation-status" role="status">
          <div><span>{generationStage || 'Đang chuẩn bị…'}</span>{renderProgress > 0 && <b>{renderProgress}%</b>}</div>
          <i><em style={{ width: `${renderProgress > 0 ? renderProgress : generating ? 18 : 0}%` }} /></i>
        </div>}
        {project.vectorReview?.pass===false&&Boolean(project.vectorReview.issues?.length)&&<details className="canvas-generation-status">
          <summary>Cần xem lại {project.vectorReview.issues!.length} điểm trong bản nháp</summary>
          <ul>{project.vectorReview.issues!.map((issue,index)=><li key={`${issue.sceneId}-${index}`}>
            <strong>{project.scenes.find(scene=>scene.id===issue.sceneId)?.name||'Cảnh phim'}:</strong> {issue.problem} {issue.fix}
          </li>)}</ul>
        </details>}
      </section>

      <div className="canvas-studio-workspace">
        <aside className="canvas-studio-scenes">
          <div className="canvas-panel-head">
            <div><strong>Cảnh phim</strong><small>{project.scenes.length} cảnh · {formatTime(totalDuration)}</small></div>
            <button type="button" aria-label="Thêm scene" onClick={addScene}><Plus size={15} /></button>
          </div>
          <div className="canvas-scene-list">
            {project.scenes.map((scene, index) => {
              const thumbnail = scene.backgroundImageUrl || scene.objects.find((object) => object.imageUrl)?.imageUrl;
              return (
                <button
                  type="button"
                  key={scene.id}
                  className={scene.id === selectedScene.id ? 'active' : ''}
                  onClick={() => selectScene(scene)}
                >
                  <span className="canvas-scene-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="canvas-scene-thumb">
                    {thumbnail ? <img src={thumbnail} alt="" /> : <Layers3 size={16} />}
                  </span>
                  <div><strong>{scene.name}</strong><small>{(scene.durationMs / 1000).toFixed(1)}s · {scene.objects.length} layer</small></div>
                </button>
              );
            })}
          </div>
          <div className="canvas-scene-actions">
            <button type="button" onClick={duplicateSelectedScene}>Nhân bản</button>
            <button type="button" onClick={deleteSelectedScene}><Trash2 size={13} /> Xóa</button>
          </div>
        </aside>

        <main className="canvas-studio-center">
          <div className="canvas-stage-topbar">
            <div className="canvas-stage-title">
              <b>Cảnh {String(Math.max(1, project.scenes.findIndex((scene) => scene.id === activeScene.id) + 1)).padStart(2, '0')} / {String(project.scenes.length).padStart(2, '0')}</b>
              <span>{activeScene.name}</span>
            </div>
            <div className="canvas-stage-specs">
              <span>{project.width} × {project.height} · {project.height > project.width ? '9:16' : '16:9'}</span>
              <span>{project.fps} FPS</span>
            </div>
          </div>
          <div className="canvas-studio-stage-shell">
            <CanvasStage
              scene={previewScene || activeScene}
              previousScene={playing?project.scenes[resolved.sceneIndex-1]:undefined}
              timeMs={resolved.localTimeMs}
              width={project.width}
              height={project.height}
              selectedObjectId={activeScene.id === selectedScene.id ? selectedObjectId : ''}
              onSelect={(id) => {
                setSelectedSceneId(activeScene.id);
                setSelectedObjectId(id);
              }}
              onMove={moveObject}
            />
          </div>

          <div className="canvas-studio-transport">
            <button className="canvas-play" type="button" onClick={togglePlay} aria-label={playing ? 'Tạm dừng' : 'Phát'}>
              {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
            </button>
            <span>{formatTime(projectTimeMs)}</span>
            <input
              aria-label="Timeline"
              type="range"
              min={0}
              max={Math.max(1, totalDuration)}
              step={1000 / project.fps}
              value={Math.min(projectTimeMs, totalDuration)}
              onChange={(event) => {
                setPlaying(false);
                const value = Number(event.target.value);
                setProjectTimeMs(value);
                const next = resolveProjectTime(project.scenes, value);
                if (next.scene) {
                  setSelectedSceneId(next.scene.id);
                  setSelectedObjectId('');
                }
              }}
            />
            <span>{formatTime(totalDuration)}</span>
          </div>

          <div className="canvas-studio-addbar">
            <span>Thêm lớp</span>
            <button type="button" onClick={() => addObject('character')}><Plus size={13} /> Nhân vật</button>
            <button type="button" onClick={() => addObject('ship')}><Plus size={13} /> Thuyền</button>
            <button type="button" onClick={() => addObject('stake')}><Plus size={13} /> Cọc</button>
            <button type="button" onClick={() => addObject('shape')}><Plus size={13} /> Hình</button>
            <button type="button" onClick={() => addObject('prop')}><Plus size={13} /> Đạo cụ</button>
            <button type="button" onClick={() => addObject('text')}><Type size={13} /> Chữ</button>
            <button type="button" onClick={() => uploadRef.current?.click()}><Image size={13} /> Ảnh</button>
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                importImage(event.target.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </div>

          <div className="canvas-studio-timeline">
            {project.scenes.map((scene, index) => {
              const width = Math.max(8, (scene.durationMs / Math.max(1, totalDuration)) * 100);
              return (
                <button
                  type="button"
                  key={scene.id}
                  className={scene.id === selectedScene.id ? 'active' : ''}
                  style={{ width: `${width}%` }}
                  onClick={() => selectScene(scene)}
                  title={`${scene.name} · ${(scene.durationMs / 1000).toFixed(1)}s`}
                >
                  <b>{index + 1}</b>
                  <span>{scene.name}</span>
                </button>
              );
            })}
          </div>
        </main>

        <aside className="canvas-studio-inspector">
          <div className="canvas-panel-head">
            <div><strong>Thuộc tính</strong><small>{selectedObject ? selectedObject.label : selectedScene.name}</small></div>
          </div>

          {!selectedObject ? (
            <div className="canvas-inspector-form">
              <section className="canvas-inspector-section">
                <div className="canvas-inspector-section-title"><span>Thông tin cảnh</span></div>
                <div className="canvas-two-columns">
                  <label>
                    <span>Tên cảnh</span>
                    <input value={selectedScene.name} onChange={(event) => updateScene(selectedScene.id, (scene) => ({ ...scene, name: event.target.value }))} />
                  </label>
                  <label>
                    <span>Thời lượng (giây)</span>
                    <input
                      type="number"
                      min={0.5}
                      max={120}
                      step={0.1}
                      value={(selectedScene.durationMs / 1000).toFixed(1)}
                      onChange={(event) => updateScene(selectedScene.id, (scene) => ({ ...scene, durationMs: Math.max(500, Number(event.target.value || 0) * 1000) }))}
                    />
                  </label>
                </div>
              </section>

              <section className="canvas-inspector-section">
                <div className="canvas-inspector-section-title"><span>Hình nền</span></div>
                <label>
                  <select value={selectedScene.background} onChange={(event) => updateScene(selectedScene.id, (scene) => ({ ...scene, background: event.target.value as CanvasBackgroundPreset }))}>
                    {BACKGROUNDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </section>

              <section className="canvas-inspector-section">
                <div className="canvas-inspector-section-title"><span>Camera</span></div>
                <div className="canvas-two-columns">
                  <label>
                    <span>Shot</span>
                    <select value={selectedScene.camera?.shot || 'wide'} onChange={(event) => updateScene(selectedScene.id, (scene) => ({ ...scene, camera: { ...(scene.camera || { shot: 'wide', motion: 'none', focusX: project.width / 2, focusY: project.height / 2, zoom: 1 }), shot: event.target.value as CanvasShotType } }))}>
                      {SHOTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Hướng camera</span>
                    <select value={selectedScene.camera?.motion || 'none'} onChange={(event) => updateScene(selectedScene.id, (scene) => ({ ...scene, camera: { ...(scene.camera || { shot: 'wide', motion: 'none', focusX: project.width / 2, focusY: project.height / 2, zoom: 1 }), motion: event.target.value as CanvasCameraMotion } }))}>
                      {CAMERA_MOTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                </div>
                <label>
                  <span>Zoom · {(selectedScene.camera?.zoom || 1).toFixed(2)}×</span>
                  <input type="range" min={0.9} max={1.35} step={0.01} value={selectedScene.camera?.zoom || 1} onChange={(event) => updateScene(selectedScene.id, (scene) => ({ ...scene, camera: { ...(scene.camera || { shot: 'wide', motion: 'none', focusX: project.width / 2, focusY: project.height / 2, zoom: 1 }), zoom: Number(event.target.value) } }))} />
                </label>
              </section>

              <section className="canvas-inspector-section canvas-layer-section">
                <div className="canvas-inspector-section-title">
                  <span>Lớp hình ({selectedScene.objects.length})</span>
                </div>
                <div className="canvas-layer-list">
                  {selectedScene.objects.map((object) => (
                    <button key={object.id} type="button" onClick={() => setSelectedObjectId(object.id)}>
                      <span className="canvas-layer-dot" />
                      <span>{object.label || object.kind}</span>
                      <small>{object.kind}</small>
                    </button>
                  ))}
                </div>
              </section>

              <CanvasAudioPanel key={selectedScene.id} project={project} scene={selectedScene} voices={ttsVoices} busy={buildingAudio}
                patch={change=>updateScene(selectedScene.id,scene=>({...scene,...change}))} castVoice={setCastVoice} build={()=>void buildSceneAudio()}/>
              <section className="canvas-inspector-section">
                <div className="canvas-inspector-section-title">
                  <span>Beats diễn xuất ({(selectedScene.animationBeats || []).length})</span>
                  <button
                    type="button"
                    onClick={() => updateScene(selectedScene.id, (scene) => ({
                      ...scene,
                      animationBeats: [...(scene.animationBeats || []), clampBeatToScene(scene, createCanvasBeat(scene))],
                    }))}
                    disabled={!selectedScene.objects.length}
                    title={selectedScene.objects.length ? 'Thêm beat talk/point/impact' : 'Cần ít nhất 1 object để gắn beat'}
                  >
                    <Plus size={13} /> Thêm beat
                  </button>
                </div>
                {(selectedScene.animationBeats || []).map((beat) => {
                  const issues = validateCanvasBeat(selectedScene, beat);
                  const patchBeat = (patch: Partial<CanvasAnimationBeat>) => updateScene(selectedScene.id, (scene) => ({
                    ...scene,
                    animationBeats: (scene.animationBeats || []).map((item) => (
                      item.id === beat.id ? clampBeatToScene(scene, { ...item, ...patch }) : item
                    )),
                  }));
                  return (
                    <div key={beat.id} className="canvas-beat-row">
                      <div className="canvas-two-columns">
                        <label>
                          <span>Hành động</span>
                          <select value={beat.action} onChange={(event) => patchBeat({ action: event.target.value as CanvasAnimationAction })}>
                            {CANVAS_BEAT_ACTIONS.map((action) => (
                              <option key={action} value={action}>{BEAT_ACTION_LABELS[action]}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Mục tiêu</span>
                          <select
                            value={beat.targetIds[0] || ''}
                            onChange={(event) => patchBeat({ targetIds: event.target.value ? [event.target.value] : [] })}
                          >
                            <option value="">— chọn —</option>
                            {selectedScene.objects.map((object) => (
                              <option key={object.id} value={object.id}>{object.label || object.kind}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="canvas-two-columns">
                        <label>
                          <span>Bắt đầu (giây)</span>
                          <input
                            type="number" min={0} step={0.1}
                            value={(beat.atMs / 1000).toFixed(1)}
                            onChange={(event) => patchBeat({ atMs: Math.max(0, Number(event.target.value || 0) * 1000) })}
                          />
                        </label>
                        <label>
                          <span>Dài (giây)</span>
                          <input
                            type="number" min={0.2} step={0.1}
                            value={(beat.durationMs / 1000).toFixed(1)}
                            onChange={(event) => patchBeat({ durationMs: Math.max(120, Number(event.target.value || 0) * 1000) })}
                          />
                        </label>
                      </div>
                      {issues.length > 0 && <small className="canvas-beat-error">{issues[0]}</small>}
                      <button
                        type="button"
                        onClick={() => updateScene(selectedScene.id, (scene) => ({
                          ...scene,
                          animationBeats: (scene.animationBeats || []).filter((item) => item.id !== beat.id),
                        }))}
                      >
                        <Trash2 size={13} /> Xóa beat
                      </button>
                    </div>
                  );
                })}
                {!(selectedScene.animationBeats || []).length && (
                  <small>Beat talk tạo nhịp miệng dừng/nghỉ tự nhiên; beat point/impact dựng cảnh Bạch Đằng.</small>
                )}
              </section>
            </div>
          ) : (
            <div className="canvas-inspector-form">
              <div className="canvas-object-heading">
                <span className="canvas-kind-badge">{selectedObject.kind}</span>
                <button type="button" onClick={removeSelectedObject}><Trash2 size={14} /> Xóa layer</button>
              </div>
              <label>
                <span>Tên layer</span>
                <input value={selectedObject.label} onChange={(event) => updateSelectedObject({ label: event.target.value })} />
              </label>
              {selectedObject.kind === 'text' && (
                <label>
                  <span>Nội dung</span>
                  <textarea rows={3} value={selectedObject.text || ''} onChange={(event) => updateSelectedObject({ text: event.target.value })} />
                </label>
              )}
              {selectedObject.kind === 'character' && (
                <>
                  <label><span>Giọng nhân vật</span>
                    <select disabled={buildingAudio} value={project.castVoices?.[selectedObject.characterKey||selectedObject.label]||''} onChange={event=>setCastVoice(selectedObject.characterKey||selectedObject.label,event.target.value)}>
                      <option value="">Tự chọn theo vai</option>{ttsVoices.map(voice=><option key={voice.id} value={voice.id}>{voice.name||voice.id}</option>)}
                    </select>
                  </label>
                  <button className="button ghost small" type="button" onClick={()=>setSelectedObjectId('')}><Volume2 size={14}/>Lời thoại & tiếng động của cảnh</button>
                  <label>
                    <span>Biểu cảm</span>
                    <select value={selectedObject.expression || 'neutral'} onChange={(event) => updateSelectedObject({ expression: event.target.value as CanvasExpression })}>
                      {EXPRESSIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <div className="canvas-two-columns">
                    <label>
                      <span>Pose</span>
                      <select value={selectedObject.pose || 'idle'} onChange={(event) => updateSelectedObject({ pose: event.target.value as CanvasCharacterPose })}>
                        {POSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Hướng</span>
                      <select value={selectedObject.facing || 'right'} onChange={(event) => updateSelectedObject({ facing: event.target.value as CanvasFacing })}>
                        <option value="right">Phải</option>
                        <option value="left">Trái</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
              <label>
                <span>Animation</span>
                <select value={selectedObject.motion} onChange={(event) => updateSelectedObject({ motion: event.target.value as CanvasMotion })}>
                  {MOTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <div className="canvas-two-columns">
                <label><span>X</span><input type="number" value={Math.round(selectedObject.x)} onChange={(event) => updateSelectedObject({ x: Number(event.target.value) })} /></label>
                <label><span>Y</span><input type="number" value={Math.round(selectedObject.y)} onChange={(event) => updateSelectedObject({ y: Number(event.target.value) })} /></label>
              </div>
              <div className="canvas-two-columns">
                <label><span>Rộng</span><input type="number" min={10} value={selectedObject.width} onChange={(event) => updateSelectedObject({ width: Math.max(10, Number(event.target.value)) })} /></label>
                <label><span>Cao</span><input type="number" min={10} value={selectedObject.height} onChange={(event) => updateSelectedObject({ height: Math.max(10, Number(event.target.value)) })} /></label>
              </div>
              <label>
                <span>Scale · {selectedObject.scale.toFixed(2)}×</span>
                <input type="range" min={0.2} max={3} step={0.05} value={selectedObject.scale} onChange={(event) => updateSelectedObject({ scale: Number(event.target.value) })} />
              </label>
              <label>
                <span>Rotation · {selectedObject.rotation.toFixed(0)}°</span>
                <input type="range" min={-180} max={180} step={1} value={selectedObject.rotation} onChange={(event) => updateSelectedObject({ rotation: Number(event.target.value) })} />
              </label>
              <label>
                <span>Opacity · {Math.round(selectedObject.opacity * 100)}%</span>
                <input type="range" min={0} max={1} step={0.05} value={selectedObject.opacity} onChange={(event) => updateSelectedObject({ opacity: Number(event.target.value) })} />
              </label>
              <div className="canvas-two-columns canvas-color-row">
                <label><span>Màu chính</span><input type="color" value={selectedObject.color} onChange={(event) => updateSelectedObject({ color: event.target.value })} /></label>
                <label><span>Nét / accent</span><input type="color" value={selectedObject.accent} onChange={(event) => updateSelectedObject({ accent: event.target.value })} /></label>
              </div>
              <label>
                <span>Z-index</span>
                <input type="number" value={selectedObject.zIndex} onChange={(event) => updateSelectedObject({ zIndex: Number(event.target.value) })} />
              </label>
              {selectedObject.kind === 'image' && (
                <button className="button quiet canvas-replace-image" type="button" onClick={() => uploadRef.current?.click()}>
                  <Upload size={14} /> Thêm ảnh khác
                </button>
              )}
            </div>
          )}

          <section className="canvas-engine-note">
            <strong>Canvas engine v1</strong>
            <p>Mọi frame được vẽ lại bằng JavaScript Canvas. AI Director hiện tự sinh visual beat, focal subject, shot, camera, acting, FX và voice; editor này chỉ dùng để tinh chỉnh khi cần.</p>
          </section>
        </aside>
      </div>

      {jsonOpen && (
        <div className="canvas-json-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setJsonOpen(false); }}>
          <section className="canvas-json-dialog" role="dialog" aria-modal="true" aria-label="Scene JSON">
            <header>
              <div><strong>Scene JSON</strong><small>Schema Canvas Studio v1</small></div>
              <button type="button" onClick={() => setJsonOpen(false)}>Đóng</button>
            </header>
            <textarea spellCheck={false} value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} />
            <footer>
              <span>Chỉnh JSON trực tiếp để test output của AI Director.</span>
              <button className="button primary" type="button" onClick={applyJson}>Áp dụng JSON</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
