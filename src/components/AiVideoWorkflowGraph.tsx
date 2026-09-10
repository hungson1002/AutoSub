import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AIProvider, AiVideoJobStatus, AiVideoScene, FilmVideoModel, FlowVideoAspectRatio, ProviderAssignment } from '../types';
import { aiVideoCharacterSheetUrl, aiVideoClipUrl, aiVideoStoryboardUrl, aiVideoUrl } from '../lib/api';
import { Check, Download, Film, LoaderCircle, Maximize, Play, Plus, RotateCcw, Settings2, Trash2, WandSparkles, X } from './Icons';
import { CapabilityAssignmentPicker } from './CapabilityAssignmentPicker';
import { SelectField } from './SelectField';

export type WorkflowNoteNode = { id: string; kind: 'direction' | 'continuity' | 'sound'; title: string; value: string };

type Props = {
  job?: AiVideoJobStatus;
  brief: string;
  characterFile?: File;
  aspectRatio: FlowVideoAspectRatio;
  busy: boolean;
  flowConnected: boolean;
  videoReady: boolean;
  canStart: boolean;
  setupOpen: boolean;
  noteNodes: WorkflowNoteNode[];
  providers: AIProvider[];
  directorAssignments: ProviderAssignment[];
  directorAssignment: ProviderAssignment;
  videoModel: FilmVideoModel;
  videoModels: string[];
  imageModel: string;
  automationMode: 'automatic' | 'manual';
  workflowNodes: string[];
  onBriefChange: (value: string) => void;
  onCharacterChange: (file?: File) => void;
  onSetupToggle: () => void;
  onSetupClose: () => void;
  onNewWorkflow: () => void;
  onNoteNodesChange: (nodes: WorkflowNoteNode[]) => void;
  onDirectorAssignmentChange: (value: ProviderAssignment) => void;
  onVideoModelChange: (value: FilmVideoModel) => void;
  onImageModelChange: (value: string) => void;
  onAddWorkflowNode: (nodeId: string) => void;
  onRemoveWorkflowNode: (nodeId: string) => void;
  onApprove: () => void;
  onCancel: () => void;
  onResume: () => void;
  onCompose: () => void;
  onSaveBible: (value: string) => void;
  onSaveScene: (scene: AiVideoScene) => void;
  onRegenerate: (kind: 'character-sheet' | 'storyboard', sceneIndex?: number, characterIndex?: number) => void;
  onRegenerateShot: (sceneIndex: number) => void;
  onAcceptCandidate: (sceneIndex: number) => void;
};

const nodeWidth = 250;
const nodeHeight = 210;
const columns = { input: 45, director: 360, character: 675, storyboard: 1010, shot: 1325, master: 1640 };

function edge(fromX: number, fromY: number, toX: number, toY: number, key: string) {
  const bend = Math.max(70, (toX - fromX) * .45);
  return <path key={key} d={`M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`} />;
}

export function AiVideoWorkflowGraph({ job, brief, characterFile, aspectRatio, busy, flowConnected, videoReady, canStart, setupOpen, noteNodes, providers, directorAssignments, directorAssignment, videoModel, videoModels, imageModel, automationMode, workflowNodes, onBriefChange, onCharacterChange, onSetupToggle, onSetupClose, onNewWorkflow, onNoteNodesChange, onDirectorAssignmentChange, onVideoModelChange, onImageModelChange, onAddWorkflowNode, onRemoveWorkflowNode, onApprove, onCancel, onResume, onCompose, onSaveBible, onSaveScene, onRegenerate, onRegenerateShot, onAcceptCandidate }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const nodeDragRef = useRef<{ id: string; x: number; y: number; left: number; top: number; moved: boolean } | undefined>(undefined);
  const suppressNodeClickRef = useRef<string | undefined>(undefined);
  const [scale, setScale] = useState(.82);
  const [nodePositions, setNodePositions] = useState<Record<string, { left: number; top: number }>>({});
  const [selectedNode, setSelectedNode] = useState<string>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [bibleDraft, setBibleDraft] = useState(job?.productionBible || '');
  const [sceneDraft, setSceneDraft] = useState<AiVideoScene>();
  const [characterPreview, setCharacterPreview] = useState<string>();
  const [mediaPreview, setMediaPreview] = useState<{ type: 'image' | 'video'; src: string; title: string }>();
  const previewDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!mediaPreview) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = previewDialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); previousFocus?.focus(); };
  }, [mediaPreview]);
  const [failedMedia, setFailedMedia] = useState<Set<string>>(() => new Set());
  const sceneCount = job?.scenes.length || 0;
  const planningFailed = Boolean(job?.status === 'failed' && !job.productionBible);
  const designFailed = Boolean(job?.status === 'failed' && job.productionBible);
  const characterRows = job ? (job.characters?.length ? job.characters : [{ index: 1, name: planningFailed ? 'Chưa có dữ liệu nhân vật' : 'Nhân vật chính', description: '', sheetReady: job.characterSheetReady, designDirty: job.characterDesignDirty }]) : [];
  const canvasHeight = Math.max(760, 100 + Math.max(sceneCount, noteNodes.length, characterRows.length) * 260);
  const canvasWidth = job ? 1950 : 1030;
  const sceneRows = useMemo(() => job?.scenes || [], [job?.scenes]);
  const masterY = Math.max(120, (canvasHeight - nodeHeight) / 2);
  const directorY = Math.max(150, masterY - 80);
  const characterY = directorY;
  const isActive = Boolean(job && ['queued', 'planning', 'designing', 'generating', 'composing'].includes(job.status));
  const automatic = (job?.automationMode || automationMode) === 'automatic';
  const characterDesignNeedsRegeneration = Boolean(job?.characterDesignDirty || (job?.characters?.length ? job.characters.some((character) => !character.sheetReady || character.designDirty) : !job?.characterSheetReady));
  const designNeedsRegeneration = Boolean(characterDesignNeedsRegeneration || (!automatic && job?.scenes.some((scene) => scene.designDirty || !scene.storyboardReady)));
  const selectedSceneIndex = selectedNode?.startsWith('story-') || selectedNode?.startsWith('shot-') ? Number(selectedNode.split('-')[1]) : undefined;
  const selectedScene = job?.scenes.find((scene) => scene.index === selectedSceneIndex);
  const selectedNote = noteNodes.find((note) => `note-${note.id}` === selectedNode);
  const nodeVisible = (id: string) => automatic || workflowNodes.includes(id);

  useEffect(() => { setBibleDraft(job?.productionBible || ''); }, [job?.productionBible]);
  useEffect(() => { setSceneDraft(selectedScene ? { ...selectedScene } : undefined); }, [selectedScene?.index, selectedScene?.title, selectedScene?.designDirty]);
  useEffect(() => { if (!characterFile) { setCharacterPreview(undefined); return; } const url = URL.createObjectURL(characterFile); setCharacterPreview(url); return () => URL.revokeObjectURL(url); }, [characterFile]);
  useEffect(() => { if (setupOpen) { setSelectedNode(undefined); setLibraryOpen(false); } }, [setupOpen]);
  useEffect(() => { setFailedMedia(new Set()); }, [job?.updatedAt]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const nextScale = Math.max(.5, Math.min(1.25, Number((scale + (event.deltaY < 0 ? .08 : -.08)).toFixed(2))));
      if (nextScale === scale) return;
      const bounds = viewport.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const canvasX = (viewport.scrollLeft + pointerX) / scale;
      const canvasY = (viewport.scrollTop + pointerY) / scale;
      setScale(nextScale);
      requestAnimationFrame(() => {
        viewport.scrollLeft = canvasX * nextScale - pointerX;
        viewport.scrollTop = canvasY * nextScale - pointerY;
      });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [scale]);

  const zoom = (delta: number) => setScale((value) => Math.max(.5, Math.min(1.25, Number((value + delta).toFixed(2)))));
  const resetView = () => { setScale(.82); setNodePositions({}); if (viewportRef.current) { viewportRef.current.scrollLeft = 0; viewportRef.current.scrollTop = 0; } };
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('a,button,video,.ai-flow-node')) return;
    const viewport = viewportRef.current; if (!viewport) return;
    setSelectedNode(undefined);
    dragRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; const viewport = viewportRef.current; if (!drag || !viewport) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x); viewport.scrollTop = drag.top - (event.clientY - drag.y);
  };
  const stopPan = () => { dragRef.current = undefined; };
  const selectNode = (id: string) => {
    if (suppressNodeClickRef.current === id) { suppressNodeClickRef.current = undefined; return; }
    if (setupOpen) onSetupClose(); setLibraryOpen(false); setSelectedNode(id);
  };
  const position = (id: string, fallback: { left: number; top: number }) => nodePositions[id] || fallback;
  const nodeProps = (id: string, fallback: { left: number; top: number }) => {
    const current = position(id, fallback);
    return {
      style: current,
      role: 'button' as const,
      tabIndex: 0,
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(id); }
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('a,button,input,textarea')) return;
        event.stopPropagation();
        setSelectedNode(undefined);
        setLibraryOpen(false);
        nodeDragRef.current = { id, x: event.clientX, y: event.clientY, left: current.left, top: current.top, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const drag = nodeDragRef.current; if (!drag || drag.id !== id) return;
        event.stopPropagation();
        if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 4) {
          drag.moved = true;
          setSelectedNode(undefined);
          setLibraryOpen(false);
        }
        if (!drag.moved) return;
        setNodePositions((value) => ({ ...value, [id]: { left: Math.max(0, drag.left + (event.clientX - drag.x) / scale), top: Math.max(0, drag.top + (event.clientY - drag.y) / scale) } }));
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        event.stopPropagation();
        if (nodeDragRef.current?.moved) suppressNodeClickRef.current = id;
        nodeDragRef.current = undefined;
      },
    };
  };

  const briefPosition = position('brief', { left: columns.input, top: 75 });
  const referencePosition = position('reference', { left: columns.input, top: 300 });
  const directorPosition = position('director', { left: columns.director, top: directorY });
  const characterPosition = position('character-1', { left: columns.character, top: characterY });
  const masterPosition = position('master', { left: columns.master, top: masterY });

  const inputLines = [
    edge(briefPosition.left + nodeWidth, briefPosition.top + 75, directorPosition.left, directorPosition.top + 58, 'brief-director'),
    edge(referencePosition.left + nodeWidth, referencePosition.top + 75, directorPosition.left, directorPosition.top + 96, 'reference-director'),
    ...noteNodes.map((note, index) => { const notePosition = position(`note-${note.id}`, { left: columns.input, top: 500 + index * 260 }); return edge(notePosition.left + nodeWidth, notePosition.top + 105, directorPosition.left, directorPosition.top + 145, `note-director-${note.id}`); }),
  ];
  const lines = job ? [
    ...inputLines,
    ...(nodeVisible('character') ? characterRows.map((character, index) => { const target = position(`character-${character.index}`, { left: columns.character, top: 70 + index * 260 }); return edge(directorPosition.left + nodeWidth, directorPosition.top + 105, target.left, target.top + 105, `director-character-${character.index}`); }) : []),
    ...sceneRows.flatMap((scene, index) => {
      const y = 70 + index * 260;
      const storyboardPosition = position(`story-${scene?.index || index + 1}`, { left: columns.storyboard, top: y });
      const shotPosition = position(`shot-${scene?.index || index + 1}`, { left: columns.shot, top: y });
      const storyId = `story-${scene.index}`, shotId = `shot-${scene.index}`;
      return [
        ...(nodeVisible('character') && nodeVisible(storyId) ? [edge(characterPosition.left + nodeWidth, characterPosition.top + 105, storyboardPosition.left, storyboardPosition.top + 105, `character-story-${index}`)] : []),
        ...(nodeVisible(storyId) && nodeVisible(shotId) ? [edge(storyboardPosition.left + nodeWidth, storyboardPosition.top + 105, shotPosition.left, shotPosition.top + 105, `story-shot-${index}`)] : []),
        ...(nodeVisible(shotId) && nodeVisible('master') ? [edge(shotPosition.left + nodeWidth, shotPosition.top + 105, masterPosition.left, masterPosition.top + 105, `shot-master-${index}`)] : []),
      ];
    }),
  ] : inputLines;

  const addNoteNode = (kind: WorkflowNoteNode['kind']) => {
    const labels = { direction: 'Chỉ dẫn đạo diễn', continuity: 'Luật continuity', sound: 'Giọng & âm thanh' };
    const node = { id: crypto.randomUUID(), kind, title: labels[kind], value: '' };
    onNoteNodesChange([...noteNodes, node]);
    setSelectedNode(`note-${node.id}`);
    setLibraryOpen(false);
  };

  return (
    <section className="ai-flow-workspace" aria-label="Canvas workflow sản xuất phim AI">
      <header className="ai-flow-toolbar">
        <div><WandSparkles size={16} /><span><strong>AI FILM WORKFLOW</strong><small>{job ? `JOB ${job.id.slice(0, 8)} · ${job.stage}` : 'Thiết kế nhân vật → storyboard → video shot → master'}</small></span></div>
        <div className="ai-flow-actions">
          <span className={`ai-flow-mode ${automatic ? 'automatic' : 'manual'}`}>{automatic ? 'Tự động' : 'Thủ công'}</span>
          <button type="button" className={`button secondary ${setupOpen ? 'active' : ''}`} onClick={() => { setSelectedNode(undefined); setLibraryOpen(false); onSetupToggle(); }}><Settings2 size={14} /> Thiết lập</button>
          <button type="button" className={`button secondary ${libraryOpen ? 'active' : ''}`} onClick={() => { if (setupOpen) onSetupClose(); setSelectedNode(undefined); setLibraryOpen((value) => !value); }}><Plus size={14} /> Thêm node</button>
          {!job && <button type="submit" className="button primary" disabled={busy || !canStart}><Play size={14} /> Bắt đầu</button>}
          {job?.status === 'reviewing' && <button type="button" className="button primary" disabled={busy || !flowConnected || designNeedsRegeneration} title={designNeedsRegeneration ? (automatic ? 'Hãy hoàn tất hình ảnh tất cả nhân vật.' : 'Hãy hoàn tất nhân vật và storyboard.') : undefined} onClick={onApprove}><Play size={14} /> {designNeedsRegeneration ? (automatic ? 'Chưa đủ hình nhân vật' : 'Hoàn tất storyboard') : automatic ? 'Duyệt nhân vật & tự dựng phim' : 'Duyệt & tạo video'}</button>}
          {job && job.scenes.some((scene) => scene.status === 'completed') && <button type="button" className="button secondary" disabled={busy || isActive} onClick={onCompose} title="Ghép các clip đã hoàn thành trên máy, không gọi lại video model">{job.status === 'composing' ? <LoaderCircle className="spin" size={14} /> : <Film size={14} />} {job.status === 'composing' ? 'Đang ghép…' : 'Ghép cảnh đã xong'}</button>}
          {isActive && <button type="button" className="button secondary" onClick={onCancel}><X size={14} /> Dừng</button>}
          {job && ['failed', 'cancelled'].includes(job.status) && <button type="button" className="button secondary" disabled={busy} title="Kiểm tra adapter video và tiếp tục các cảnh chưa hoàn thành" onClick={onResume}>{busy ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />} {busy ? 'Đang kiểm tra…' : 'Tiếp tục'}</button>}
          {job && !isActive && <button type="button" className="button secondary" onClick={onNewWorkflow}><Plus size={14} /> Workflow mới</button>}
          {job && <span className="ai-flow-progress">{job.progressPercent}%</span>}
          <span className="ai-flow-scale">Zoom {Math.round(scale * 100)}%</span>
        </div>
      </header>
      <div className="ai-flow-viewport" ref={viewportRef} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan}>
        <div className="ai-flow-stage-size" style={{ width: canvasWidth * scale, height: canvasHeight * scale }}>
          <div className="ai-flow-stage" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${scale})` }}>
            <svg className="ai-flow-edges" width={canvasWidth} height={canvasHeight} aria-hidden="true">{lines}</svg>
            <article className={`ai-flow-node input ${selectedNode === 'brief' ? 'selected' : ''}`} {...nodeProps('brief', { left: columns.input, top: 75 })} onClick={() => selectNode('brief')}>
              <header><span>INPUT 01</span><i className={brief.trim() || job?.brief ? 'ready' : ''}>{brief.trim() || job?.brief ? <Check size={11} /> : '1'}</i></header>
              <div className="ai-flow-node-copy"><strong>Ý tưởng / kịch bản</strong><p>{brief.trim() || job?.brief || 'Nhập nội dung phim ở bảng thiết lập.'}</p></div>
            </article>
            <article className={`ai-flow-node input ${selectedNode === 'reference' ? 'selected' : ''}`} {...nodeProps('reference', { left: columns.input, top: 300 })} onClick={() => selectNode('reference')}>
              <header><span>INPUT 02</span><i className={characterFile || job?.characterReference ? 'ready' : ''}>{characterFile || job?.characterReference ? <Check size={11} /> : '2'}</i></header>
              {characterPreview ? <img src={characterPreview} alt="Ảnh nhân vật đã chọn" /> : <div className="ai-flow-node-media empty"><Film size={25} /></div>}
              <footer><strong>{characterFile?.name || job?.characterReference?.filename || 'Ảnh nhân vật (tùy chọn)'}</strong><small>{aspectRatio} · nguồn tham chiếu</small></footer>
            </article>
            {noteNodes.map((note, index) => <article key={note.id} className={`ai-flow-node input note ${selectedNode === `note-${note.id}` ? 'selected' : ''}`} {...nodeProps(`note-${note.id}`, { left: columns.input, top: 500 + index * 260 })} onClick={() => selectNode(`note-${note.id}`)}>
              <header><span>{note.kind.toUpperCase()}</span><i className={note.value.trim() ? 'ready' : ''}>{note.value.trim() ? <Check size={11} /> : '+'}</i></header>
              <div className="ai-flow-node-copy"><strong>{note.title}</strong><p>{note.value || 'Chọn node để nhập yêu cầu áp dụng vào kịch bản.'}</p></div>
            </article>)}
            <article className={`ai-flow-node process ${job?.status === 'planning' ? 'running' : ''} ${planningFailed ? 'error' : ''} ${selectedNode === 'director' ? 'selected' : ''}`} {...nodeProps('director', { left: columns.director, top: directorY })} onClick={() => selectNode('director')}>
              <header><span>AI DIRECTOR</span><i>{job?.status === 'planning' ? <LoaderCircle className="spin" size={12} /> : planningFailed ? <X size={11} /> : job?.productionBible ? <Check size={11} /> : '3'}</i></header>
              <div className="ai-flow-node-process">{planningFailed ? <X size={28} /> : <WandSparkles size={28} />}<strong>{planningFailed ? 'Lập kế hoạch thất bại' : 'Production bible'}</strong><small>{planningFailed ? (job?.error || 'Chưa tạo được dữ liệu tiền kỳ') : 'Kịch bản · continuity · shot plan'}</small></div>
            </article>
            {job && nodeVisible('character') && characterRows.map((character, index) => {
              const characterNodeId = `character-${character.index}`;
              const characterUrl = `${aiVideoCharacterSheetUrl(job.id, job.characters?.length ? character.index : undefined)}${job.characters?.length ? '&' : '?'}v=${encodeURIComponent(job.updatedAt)}`;
              const characterFailed = Boolean(!character.sheetReady && (planningFailed || designFailed));
              const canRetryDesign = ['reviewing', 'failed'].includes(job.status);
              return <article key={character.index} className={`ai-flow-node character ${job.status === 'designing' && !character.sheetReady ? 'running' : ''} ${characterFailed ? 'error' : ''} ${character.designDirty ? 'dirty' : ''} ${selectedNode === characterNodeId ? 'selected' : ''}`} {...nodeProps(characterNodeId, { left: columns.character, top: 70 + index * 260 })} onClick={() => selectNode(characterNodeId)}>
                <header><span>CHARACTER {String(character.index).padStart(2, '0')}</span><i>{character.designDirty ? '!' : character.sheetReady ? <Check size={11} /> : job.status === 'designing' ? <LoaderCircle className="spin" size={12} /> : characterFailed ? <X size={11} /> : character.index}</i></header>
                {character.sheetReady ? <button type="button" className="ai-flow-media-open" onClick={(event) => { event.stopPropagation(); setMediaPreview({ type: 'image', src: characterUrl, title: `Character bible · ${character.name}` }); }}><img src={characterUrl} alt={`Character sheet của ${character.name}`} /><Maximize size={14} /></button> : <div className={`ai-flow-node-media empty ${characterFailed ? 'error' : 'pending'}`} title={characterFailed ? job.error : undefined}>{characterFailed ? <X size={25} /> : <Film size={25} />}<small>{characterFailed ? 'Tạo ảnh thất bại · bấm ↻ để thử lại' : 'Đang chờ tạo nhân vật'}</small></div>}
                <footer><span><strong>{character.name}</strong><small>Góc nhìn · biểu cảm · trang phục</small></span><button type="button" title={character.sheetReady ? `Tạo lại ${character.name}` : `Tạo ${character.name}`} disabled={busy || !canRetryDesign || !flowConnected} onClick={(event) => { event.stopPropagation(); onRegenerate('character-sheet', undefined, character.index); }}><RotateCcw size={13} /></button></footer>
              </article>;
            })}
            {sceneRows.map((scene, index) => {
              const y = 70 + index * 260;
              const sceneIndex = scene?.index || index + 1;
              const storyboardReady = Boolean(scene?.storyboardReady);
              const clipReady = scene?.status === 'completed';
              const candidateReady = Boolean(scene?.lastCandidate);
              const clipPreviewReady = clipReady || candidateReady;
              const storyboardFailed = failedMedia.has(`story-${sceneIndex}`);
              const storyboardUrl = job ? `${aiVideoStoryboardUrl(job.id, sceneIndex)}&v=${encodeURIComponent(job.updatedAt)}` : '';
              const clipPreviewBase = job && clipPreviewReady ? aiVideoClipUrl(job.id, sceneIndex, false, clipReady ? undefined : 'last') : '';
              const clipPreviewUrl = clipPreviewBase ? `${clipPreviewBase}${clipPreviewBase.includes('?') ? '&' : '?'}v=${encodeURIComponent(job?.updatedAt || '')}` : '';
              return (
                <div key={sceneIndex}>
                  {nodeVisible(`story-${sceneIndex}`) && <article className={`ai-flow-node storyboard ${storyboardReady ? 'ready' : job?.status === 'designing' ? 'running' : ''} ${scene?.designDirty ? 'dirty' : ''} ${selectedNode === `story-${sceneIndex}` ? 'selected' : ''}`} {...nodeProps(`story-${sceneIndex}`, { left: columns.storyboard, top: y })} onClick={() => selectNode(`story-${sceneIndex}`)}>
                    <header><span>STORYBOARD FRAME {String(sceneIndex).padStart(2, '0')}</span><i>{scene?.designDirty ? '!' : storyboardReady ? <Check size={11} /> : job?.status === 'designing' ? <LoaderCircle className="spin" size={12} /> : sceneIndex}</i></header>
                    {storyboardReady && job && !storyboardFailed ? <button type="button" className="ai-flow-media-open" onClick={(event) => { event.stopPropagation(); setMediaPreview({ type: 'image', src: storyboardUrl, title: `Storyboard ${sceneIndex} · ${scene.title}` }); }}><img src={storyboardUrl} onError={() => setFailedMedia((items) => new Set(items).add(`story-${sceneIndex}`))} alt={`Storyboard ${sceneIndex}`} /><Maximize size={14} /></button> : <div className={`ai-flow-node-media empty ${storyboardFailed ? 'error' : 'pending'}`}>{job?.status === 'designing' && !storyboardFailed ? <LoaderCircle className="spin" size={22} /> : storyboardFailed ? <X size={22} /> : <Film size={24} />}<small>{storyboardFailed ? 'Ảnh bị thiếu · bấm tạo lại' : job?.status === 'designing' ? 'Đang tạo storyboard…' : 'Storyboard chưa được tạo'}</small></div>}
                    <footer><span><strong>{scene?.title || `Cảnh ${sceneIndex}`}</strong><small>{scene?.durationSeconds || job?.shotDurationSeconds || 8} giây · {scene?.shotSize && scene?.lensMm ? `${scene.shotSize} · ${scene.lensMm}mm · ${scene.cameraMovement || 'locked'}` : scene?.dramaticBeat || 'Chờ AI Director'}</small></span><button type="button" title={storyboardReady ? 'Tạo lại storyboard và vô hiệu video phía sau' : 'Chạy node storyboard'} disabled={busy || !['reviewing', 'failed'].includes(job?.status || '') || !flowConnected || !job?.characterSheetReady} onClick={(event) => { event.stopPropagation(); onRegenerate('storyboard', sceneIndex); }}><RotateCcw size={13} /></button></footer>
                  </article>}
                  {nodeVisible(`shot-${sceneIndex}`) && <article className={`ai-flow-node shot ${scene?.status || 'pending'} ${candidateReady && !clipReady ? 'candidate' : ''} ${selectedNode === `shot-${sceneIndex}` ? 'selected' : ''}`} {...nodeProps(`shot-${sceneIndex}`, { left: columns.shot, top: y })} onClick={() => selectNode(`shot-${sceneIndex}`)}>
                    <header><span>VIDEO SHOT {String(sceneIndex).padStart(2, '0')}</span><i>{clipReady ? <Check size={11} /> : candidateReady ? '!' : scene?.status === 'generating' ? <LoaderCircle className="spin" size={12} /> : sceneIndex}</i></header>
                    <div className={`ai-flow-node-media shot-preview ${!clipPreviewReady ? 'pending' : ''} ${candidateReady && !clipReady ? 'candidate' : ''}`}>{clipPreviewReady && job ? <><video controls muted playsInline preload="metadata" src={clipPreviewUrl} /><button type="button" className="ai-flow-video-expand" onClick={(event) => { event.stopPropagation(); setMediaPreview({ type: 'video', src: clipPreviewUrl, title: `${clipReady ? 'Video' : 'Candidate cuối'} shot ${sceneIndex}` }); }}><Maximize size={14} /></button></> : <><Film size={24} /><small>{scene?.status === 'generating' ? `Đang tạo video bằng ${videoModel}…` : storyboardFailed ? 'Storyboard bị thiếu' : storyboardReady ? 'Chưa tạo video · đã có frame duyệt' : 'Chờ storyboard frame'}</small></>}</div>
                    <footer><span><strong>{clipReady ? 'Video đã tạo' : candidateReady ? 'Bản cuối · có cảnh báo' : scene?.status === 'generating' ? 'Đang tạo video…' : storyboardReady ? 'Sẵn sàng tạo video' : 'Chờ storyboard'}</strong><small>{candidateReady && !clipReady ? `Hậu kiểm: ${scene.lastCandidate?.issue || 'cần xem lại'} · ` : ''}{videoModel} · {scene.durationSeconds || job?.shotDurationSeconds || 8} giây · một góc máy</small></span><div className="ai-flow-node-actions">{candidateReady && job && <a className="candidate-download" href={aiVideoClipUrl(job.id, sceneIndex, true, 'last')} title="Tải bản candidate cuối" aria-label={`Tải bản candidate cuối của shot ${sceneIndex}`} onClick={(event) => event.stopPropagation()}><Download size={13} /></a>}<button type="button" className="accept-candidate" title="Dùng bản candidate cuối, không tạo lại" aria-label={`Dùng bản candidate cuối của shot ${sceneIndex}`} disabled={busy || !candidateReady || clipReady} onClick={(event) => { event.stopPropagation(); onAcceptCandidate(sceneIndex); }}><Check size={13} /></button><button type="button" title={clipReady ? 'Tạo lại shot và các node phía sau' : 'Chạy video shot'} disabled={busy || !videoReady || !storyboardReady || !['reviewing', 'completed', 'failed'].includes(job?.status || '')} onClick={(event) => { event.stopPropagation(); onRegenerateShot(sceneIndex); }}><RotateCcw size={13} /></button></div></footer>
                  </article>}
                </div>
              );
            })}
            {job && nodeVisible('master') && <article className={`ai-flow-node master ${job.status === 'completed' ? 'completed' : job.status === 'composing' ? 'running' : ''} ${selectedNode === 'master' ? 'selected' : ''}`} {...nodeProps('master', { left: columns.master, top: masterY })} onClick={() => selectNode('master')}>
              <header><span>MASTER OUTPUT</span><i>{job?.status === 'completed' ? <Check size={11} /> : job?.status === 'composing' ? <LoaderCircle className="spin" size={12} /> : 'MP4'}</i></header>
              {job.status !== 'composing' && job.result ? <video className="ai-flow-master-video" controls muted playsInline preload="metadata" src={aiVideoUrl(job.id)} /> : <div className="ai-flow-node-process"><Film size={30} /><strong>{job.status === 'composing' ? 'Đang ghép phim' : 'Ghép & hậu kiểm'}</strong><small>{job.durationSeconds} giây · {job.scenes.length} shot</small></div>}
              {job?.status !== 'composing' && job.result && <footer className="actions"><button type="button" onClick={(event) => { event.stopPropagation(); setMediaPreview({ type: 'video', src: aiVideoUrl(job.id), title: 'Master output' }); }}><Play size={12} /> Xem lớn</button><a href={aiVideoUrl(job.id, true)}><Download size={12} /> Tải MP4</a></footer>}
            </article>}
          </div>
        </div>
      </div>
      <div className="ai-flow-zoom" aria-label="Điều khiển canvas">
        <button type="button" onClick={() => zoom(.1)} aria-label="Phóng to workflow">+</button>
        <button type="button" onClick={() => zoom(-.1)} aria-label="Thu nhỏ workflow">−</button>
        <button type="button" onClick={resetView} aria-label="Đặt lại khung nhìn"><Maximize size={14} /></button>
      </div>
      {libraryOpen && <aside className="ai-flow-library" aria-label="Thư viện node">
        <header><div><span>NODE LIBRARY</span><strong>Node sản xuất phim</strong></div><button type="button" onClick={() => setLibraryOpen(false)} aria-label="Đóng thư viện node"><X size={15} /></button></header>
        <div className="ai-flow-library-label">PIPELINE</div>
        <button type="button" disabled={!job || automatic || nodeVisible('character')} onClick={() => { onAddWorkflowNode('character'); selectNode('character'); }}><strong>Character bible · Ảnh</strong><small>{!job ? 'Khả dụng sau khi AI Director tạo production bible' : automatic ? 'Chế độ tự động sẽ tự thêm node này' : nodeVisible('character') ? 'Đã có trên canvas' : 'Tạo ảnh nhiều góc, biểu cảm và trang phục'}</small></button>
        <button type="button" disabled={!job || automatic || !job.characterSheetReady || !job.scenes.some((scene) => !nodeVisible(`story-${scene.index}`))} onClick={() => { const scene = job?.scenes.find((item) => !nodeVisible(`story-${item.index}`)); if (scene) { onAddWorkflowNode(`story-${scene.index}`); selectNode(`story-${scene.index}`); } }}><strong>Storyboard · Ảnh cảnh</strong><small>{!job ? 'Khả dụng sau production bible' : automatic ? 'Chế độ tự động sẽ tạo đủ storyboard' : !job.characterSheetReady ? 'Chạy Character bible trước' : 'Thêm storyboard tiếp theo vào canvas'}</small></button>
          <button type="button" disabled={!job || automatic || !job.scenes.some((scene) => scene.storyboardReady && !nodeVisible(`shot-${scene.index}`))} onClick={() => { const scene = job?.scenes.find((item) => item.storyboardReady && !nodeVisible(`shot-${item.index}`)); if (scene) { onAddWorkflowNode(`shot-${scene.index}`); selectNode(`shot-${scene.index}`); } }}><strong>Video Shot · {videoModel}</strong><small>{!job ? 'Khả dụng sau khi có storyboard' : automatic ? 'Chế độ tự động sẽ tự thêm video shot' : 'Tạo hoặc tạo lại từng clip bằng adapter đã chọn'}</small></button>
          <button type="button" disabled={!job || automatic || nodeVisible('master') || !job.scenes.length || !job.scenes.every((scene) => nodeVisible(`shot-${scene.index}`))} onClick={() => { onAddWorkflowNode('master'); selectNode('master'); }}><strong>Master Output · MP4</strong><small>{!job ? 'Khả dụng sau các video shot' : automatic ? 'Chế độ tự động sẽ tự thêm master' : 'Tạo shot còn thiếu, ghép phim và hậu kiểm'}</small></button>
        <div className="ai-flow-library-label">ĐẦU VÀO & CHỈ DẪN</div>
        <button type="button" onClick={() => { setSelectedNode('brief'); setLibraryOpen(false); }}><strong>Kịch bản</strong><small>Nhập ý tưởng hoặc screenplay</small></button>
        <button type="button" onClick={() => { setSelectedNode('reference'); setLibraryOpen(false); }}><strong>Ảnh nhân vật</strong><small>Khóa nhận dạng xuyên suốt</small></button>
        <button type="button" onClick={() => addNoteNode('direction')}><strong>Chỉ dẫn đạo diễn</strong><small>Phong cách, camera, nhịp dựng</small></button>
        <button type="button" onClick={() => addNoteNode('continuity')}><strong>Luật continuity</strong><small>Trục nhìn, đạo cụ, trạng thái</small></button>
        <button type="button" onClick={() => addNoteNode('sound')}><strong>Giọng & âm thanh</strong><small>Voice identity, ambience, SFX</small></button>
      </aside>}
      {selectedNode && <aside className="ai-flow-inspector" aria-label="Chỉnh sửa node đang chọn">
        <header><div><span>NODE INSPECTOR</span><strong>{selectedNote?.title || (selectedNode.startsWith('character-') ? characterRows.find((character) => selectedNode === `character-${character.index}`)?.name || 'Character bible' : selectedScene ? `${String(selectedScene.index).padStart(2, '0')} · ${selectedScene.title}` : selectedNode === 'master' ? 'Master output' : selectedNode === 'director' ? 'AI Director' : 'Nguồn đầu vào')}</strong></div><button type="button" onClick={() => setSelectedNode(undefined)} aria-label="Đóng bảng chỉnh sửa"><X size={15} /></button></header>
        {selectedNode === 'brief' ? <div className="ai-flow-inspector-body">
          <label><span>Ý tưởng hoặc kịch bản phim</span><textarea value={brief} onChange={(event) => onBriefChange(event.target.value)} placeholder="Nhập cốt truyện, nhân vật, bối cảnh, mục tiêu cảm xúc và phong cách mong muốn…" /></label>
          <small>Nội dung này đi trực tiếp vào AI Director. Các node chỉ dẫn bổ sung sẽ được ghép vào production brief khi bắt đầu.</small>
          {job && <button type="button" className="button secondary full" onClick={onNewWorkflow}><Plus size={14} /> Dùng nội dung này cho workflow mới</button>}
        </div> : selectedNode === 'reference' ? <div className="ai-flow-inspector-body">
          <label><span>Ảnh nhân vật gốc</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onCharacterChange(event.target.files?.[0])} /></label>
          <small>{characterFile ? `${characterFile.name} · ảnh này sẽ được gửi lại ở mọi cảnh để khóa nhận dạng.` : job?.characterReference?.filename || 'PNG/JPG/WebP tối đa 20 MB. Nên dùng một nhân vật toàn thân trên nền đơn giản.'}</small>
          {characterFile && <button type="button" className="button secondary full" onClick={() => onCharacterChange(undefined)}><Trash2 size={14} /> Bỏ ảnh đã chọn</button>}
        </div> : selectedNote ? <div className="ai-flow-inspector-body">
          <label><span>Tên node</span><input value={selectedNote.title} onChange={(event) => onNoteNodesChange(noteNodes.map((note) => note.id === selectedNote.id ? { ...note, title: event.target.value } : note))} /></label>
          <label><span>Nội dung áp dụng vào phim</span><textarea value={selectedNote.value} onChange={(event) => onNoteNodesChange(noteNodes.map((note) => note.id === selectedNote.id ? { ...note, value: event.target.value } : note))} placeholder={selectedNote.kind === 'direction' ? 'Ví dụ: máy quay quan sát gần, handheld tiết chế, không dùng chuyển động vô cớ…' : selectedNote.kind === 'continuity' ? 'Ví dụ: nhân vật luôn đeo đồng hồ tay trái; giữ hướng di chuyển trái sang phải…' : 'Ví dụ: cùng một giọng nữ trầm miền Nam; room tone liên tục; không nhạc trailer…'} /></label>
          <small>Node này được ghép vào brief thật khi chạy AI Director, không phải ghi chú trang trí.</small>
          <button type="button" className="button danger full" onClick={() => { onNoteNodesChange(noteNodes.filter((note) => note.id !== selectedNote.id)); setSelectedNode(undefined); }}><Trash2 size={14} /> Xóa node</button>
        </div> : selectedNode === 'director' && !job ? <div className="ai-flow-inspector-body">
          <CapabilityAssignmentPicker capability="translation" assignments={directorAssignments} providers={providers} value={directorAssignment} onChange={onDirectorAssignmentChange} label="Model AI Director" />
          <small>Model này đọc brief, viết production bible, chia cảnh, thiết kế góc quay và continuity.</small>
        </div> : (selectedNode.startsWith('character-') || selectedNode === 'director') && job ? <div className="ai-flow-inspector-body">
          {selectedNode === 'director' && <CapabilityAssignmentPicker capability="translation" assignments={directorAssignments} providers={providers} value={directorAssignment} onChange={onDirectorAssignmentChange} label="Model AI Director" />}
          {selectedNode.startsWith('character-') && <div className="field"><span>Model tạo character sheet</span><SelectField ariaLabel="Model tạo character sheet" value={imageModel} onChange={onImageModelChange} options={[{ value: 'narwhal', label: 'Nano Banana 2', description: 'Flow Agent · tạo ảnh nhân vật và storyboard' }]} /></div>}
          <label><span>Production bible</span><textarea value={bibleDraft} onChange={(event) => setBibleDraft(event.target.value)} /></label>
          <small>Khóa nhận dạng nhân vật, trang phục, đạo cụ, thế giới, ánh sáng và giọng nói xuyên suốt.</small>
          <button type="button" className="button secondary full" disabled={busy || job.status !== 'reviewing'} onClick={() => onSaveBible(bibleDraft)}>Lưu thay đổi</button>
          <button type="button" className="button primary full" disabled={busy || !['reviewing', 'failed'].includes(job.status) || !flowConnected} onClick={() => onRegenerate('character-sheet', undefined, selectedNode.startsWith('character-') ? Number(selectedNode.split('-')[1]) : undefined)}>{busy ? <LoaderCircle className="spin" size={14} /> : <WandSparkles size={14} />} Tạo lại nhân vật này</button>
          {!automatic && selectedNode.startsWith('character-') && <button type="button" className="button danger full" disabled={busy} onClick={() => { onRemoveWorkflowNode('character'); setSelectedNode(undefined); }}><Trash2 size={14} /> Xóa node và các node phía sau</button>}
        </div> : sceneDraft ? <div className="ai-flow-inspector-body">
          {[{ label: 'Kiểm tra storyboard', review: sceneDraft.storyboardReview }, { label: 'Kiểm tra nội dung video', review: sceneDraft.lastCandidate?.contentReview }].map(({ label, review }) => review && <details key={label} open><summary>{label}: {review.status === 'pass' ? 'Đạt tiêu chí đã kiểm tra' : review.status === 'unavailable' ? 'Chưa kiểm tra được' : 'Có điểm cần xem'}</summary>{review.checks.map((check, i) => <p key={i}><strong>{check.criterion} · {check.verdict === 'pass' ? 'Đạt' : check.verdict === 'fail' ? 'Sai lệch' : 'Chưa chắc'}</strong><br />{check.evidence}</p>)}{review.correction && <p>Đề xuất: {review.correction}</p>}</details>)}
          {selectedNode?.startsWith('story-') && <div className="field"><span>Model tạo storyboard</span><SelectField ariaLabel="Model tạo storyboard" value={imageModel} onChange={onImageModelChange} options={[{ value: 'narwhal', label: 'Nano Banana 2', description: 'Flow Agent · image generation' }]} /></div>}
          {selectedNode?.startsWith('shot-') && <div className="field"><span>Model tạo video</span><SelectField ariaLabel="Model tạo video" value={videoModel} onChange={(value) => onVideoModelChange(value as FilmVideoModel)} options={videoModels.map((value) => ({ value, label: value, description: 'Adapter dùng chung continuity và shot contract' }))} /></div>}
          <label><span>Tên cảnh</span><input value={sceneDraft.title} onChange={(event) => setSceneDraft({ ...sceneDraft, title: event.target.value })} /></label>
          <label><span>Mục đích kịch tính</span><textarea value={sceneDraft.dramaticBeat || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, dramaticBeat: event.target.value })} /></label>
          <label><span>Cỡ cảnh</span><select value={sceneDraft.shotSize || 'MS'} onChange={(event) => setSceneDraft({ ...sceneDraft, shotSize: event.target.value as AiVideoScene['shotSize'] })}>{['EWS', 'WS', 'MS', 'MCU', 'CU', 'ECU', 'OTS', 'POV', 'INSERT'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Tiêu cự (12–200mm)</span><input type="number" min="12" max="200" value={sceneDraft.lensMm ?? ''} onChange={(event) => setSceneDraft({ ...sceneDraft, lensMm: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="35" /></label>
          <label><span>Góc và độ cao máy</span><input value={sceneDraft.cameraAngle || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, cameraAngle: event.target.value })} placeholder="Ví dụ: ngang mắt, lệch 3/4 phía trái" /></label>
          <label><span>Chuyển động máy</span><input value={sceneDraft.cameraMovement || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, cameraMovement: event.target.value })} placeholder="locked hoặc một chuyển động có lý do" /></label>
          <label><span>Động cơ cắt dựng</span><select value={sceneDraft.editMotivation || 'action'} onChange={(event) => setSceneDraft({ ...sceneDraft, editMotivation: event.target.value as AiVideoScene['editMotivation'] })}>{['action', 'eyeline', 'sound', 'reveal', 'graphic', 'emotion', 'scene-change'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Nhân vật trong shot</span><input value={sceneDraft.charactersInShot?.join(', ') || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, charactersInShot: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="Tên đúng trong Character bible, cách nhau bằng dấu phẩy" /></label>
          <label><span>Shot plan · góc máy · ống kính</span><textarea value={sceneDraft.shotPlan || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, shotPlan: event.target.value })} /></label>
          <label><span>Prompt hình ảnh</span><textarea value={sceneDraft.visualPrompt} onChange={(event) => setSceneDraft({ ...sceneDraft, visualPrompt: event.target.value })} /></label>
          <label><span>Blocking và hành động nhìn thấy</span><textarea value={sceneDraft.blocking || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, blocking: event.target.value })} /></label>
          <label><span>Continuity vào</span><textarea value={sceneDraft.continuityIn || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, continuityIn: event.target.value })} /></label>
          <label><span>Continuity ra</span><textarea value={sceneDraft.continuityOut || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, continuityOut: event.target.value })} /></label>
          <label><span>Cách nối shot</span><select value={sceneDraft.transition || 'cut'} onChange={(event) => setSceneDraft({ ...sceneDraft, transition: event.target.value as AiVideoScene['transition'] })}><option value="cut">Cut có chủ đích</option><option value="continue">Tiếp diễn hành động</option></select></label>
          <label><span>Thiết kế âm thanh</span><textarea value={sceneDraft.soundDesign || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, soundDesign: event.target.value })} /></label>
          <label><span>Ràng buộc cần tránh</span><textarea value={sceneDraft.negativeConstraints || ''} onChange={(event) => setSceneDraft({ ...sceneDraft, negativeConstraints: event.target.value })} /></label>
          <button type="button" className="button secondary full" disabled={busy || job?.status !== 'reviewing'} onClick={() => onSaveScene(sceneDraft)}>Lưu prompt cảnh</button>
          {selectedNode?.startsWith('story-') && <button type="button" className="button primary full" disabled={busy || !['reviewing', 'failed'].includes(job?.status || '') || !flowConnected} onClick={() => onRegenerate('storyboard', sceneDraft.index)}>{busy ? <LoaderCircle className="spin" size={14} /> : <WandSparkles size={14} />} {sceneDraft.storyboardReady ? 'Tạo lại storyboard này' : 'Chạy node storyboard'}</button>}
          {selectedNode?.startsWith('shot-') && sceneDraft.lastCandidate && sceneDraft.status !== 'completed' && <button type="button" className="button secondary full" disabled={busy} onClick={() => onAcceptCandidate(sceneDraft.index)}><Check size={14} /> Dùng bản candidate cuối (không tốn credit)</button>}
          {selectedNode?.startsWith('shot-') && sceneDraft.lastCandidate && job && <a className="button ghost full" href={aiVideoClipUrl(job.id, sceneDraft.index, true, 'last')}><Download size={14} /> Tải bản candidate cuối</a>}
          {selectedNode?.startsWith('shot-') && <button type="button" className="button primary full" disabled={busy || !videoReady || !sceneDraft.storyboardReady || !['reviewing', 'completed', 'failed'].includes(job?.status || '')} onClick={() => onRegenerateShot(sceneDraft.index)}>{busy ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />} {sceneDraft.status === 'completed' ? 'Tạo lại video shot này' : 'Chạy video shot này'}</button>}
          {!automatic && selectedNode && <button type="button" className="button danger full" disabled={busy} onClick={() => { onRemoveWorkflowNode(selectedNode); setSelectedNode(undefined); }}><Trash2 size={14} /> Xóa node và các node phụ thuộc</button>}
        </div> : <div className="ai-flow-inspector-empty"><Film size={25} /><p>{selectedNode === 'brief' || selectedNode === 'reference' ? 'Chỉnh nguồn đầu vào trong bảng thiết lập trước khi bắt đầu.' : selectedNode === 'master' ? 'Node này tạo các shot còn thiếu, ghép toàn bộ clip, cân âm thanh và hậu kiểm MP4.' : 'AI Director tạo production bible, nhịp dựng, shot plan và continuity trước khi sinh ảnh.'}</p>{selectedNode === 'master' && job?.status === 'reviewing' && <button type="button" className="button primary" disabled={busy || !flowConnected || designNeedsRegeneration} onClick={onApprove}><Play size={14} /> Chạy shot còn thiếu & ghép master</button>}{!automatic && selectedNode === 'master' && <button type="button" className="button danger" onClick={() => { onRemoveWorkflowNode('master'); setSelectedNode(undefined); }}><Trash2 size={14} /> Xóa node</button>}</div>}
      </aside>}
      {mediaPreview && createPortal(<dialog ref={previewDialogRef} className="ai-flow-preview-modal" aria-label={mediaPreview.title} onCancel={() => setMediaPreview(undefined)} onClick={(event) => { if (event.target === event.currentTarget) setMediaPreview(undefined); }}>
        <section><header><strong>{mediaPreview.title}</strong><button autoFocus type="button" onClick={() => setMediaPreview(undefined)} aria-label="Đóng xem trước"><X size={20} /> Đóng</button></header>{mediaPreview.type === 'video' ? <video controls autoPlay playsInline src={mediaPreview.src} /> : <img src={mediaPreview.src} alt={mediaPreview.title} />}</section>
      </dialog>, document.body)}
    </section>
  );
}
