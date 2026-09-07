import { useEffect, useState, type FormEvent } from 'react';
import type { AIProvider, AiVideoJobStatus, AppSettings, FlowVideoAspectRatio, FlowVideoModel, ProviderAssignment } from '../types';
import { aiVideoCharacterSheetUrl, aiVideoClipUrl, aiVideoStoryboardUrl, aiVideoUrl, api, friendlyErrorMessage } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { Check, Download, Film, LoaderCircle, ShieldCheck, WandSparkles, X } from '../components/Icons';
import { AiVideoWorkflowGraph, type WorkflowNoteNode } from '../components/AiVideoWorkflowGraph';

const models: FlowVideoModel[] = ['Flow Agent Auto'];
const active = new Set<AiVideoJobStatus['status']>(['queued', 'planning', 'designing', 'generating', 'composing']);
const storageKey = 'autosub.ai-video-job-id';
const workflowNotesKey = 'autosub.ai-video-workflow-notes';
const workflowNodesKey = 'autosub.ai-video-workflow-nodes';
const professionalShotSeconds = 4;
const maxDurationSeconds = 20 * 60;

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} phút ${remainder} giây` : `${minutes} phút`;
}

export function AiVideoPage({ providers, settings, onNotice }: { providers: AIProvider[]; settings: AppSettings; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [brief, setBrief] = useState('');
  const [characterReference, setCharacterReference] = useState<File>();
  const [durationSeconds, setDurationSeconds] = useState(20);
  const [durationDraft, setDurationDraft] = useState('20');
  const [model, setModel] = useState<FlowVideoModel>('Flow Agent Auto');
  const [imageModel, setImageModel] = useState('narwhal');
  const [aspectRatio, setAspectRatio] = useState<FlowVideoAspectRatio>('9:16');
  const [directionMode, setDirectionMode] = useState<'cinematic' | 'documentary' | 'commercial' | 'social-realism'>('cinematic');
  const [automationMode, setAutomationMode] = useState<'automatic' | 'manual'>('automatic');
  const [scriptAssignment, setScriptAssignment] = useState<ProviderAssignment>(settings.assignments.translation);
  const [flowAgent, setFlowAgent] = useState<Awaited<ReturnType<typeof api.flowAgentStatus>>>();
  const [openingFlow, setOpeningFlow] = useState(false);
  const [job, setJob] = useState<AiVideoJobStatus>();
  const [starting, setStarting] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [workflowNodes, setWorkflowNodes] = useState<string[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(workflowNodesKey) || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
  });
  const [noteNodes, setNoteNodes] = useState<WorkflowNoteNode[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(workflowNotesKey) || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; }
  });
  const scriptProvider = providers.find((item) => item.id === scriptAssignment.providerId);
  const directorAssignments = capabilityAssignments(settings, 'translation');

  useEffect(() => {
    let active = true;
    const refresh = () => void api.flowAgentStatus().then((status) => { if (active) setFlowAgent(status); }).catch(() => { if (active) setFlowAgent(undefined); });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { localStorage.setItem(workflowNotesKey, JSON.stringify(noteNodes)); }, [noteNodes]);
  useEffect(() => { localStorage.setItem(workflowNodesKey, JSON.stringify(workflowNodes)); }, [workflowNodes]);
  useEffect(() => { setDurationDraft(String(durationSeconds)); }, [durationSeconds]);

  useEffect(() => {
    const id = localStorage.getItem(storageKey);
    if (id)
      void api
        .getAiVideoJob(id)
        .then((loaded) => { setJob(loaded); setModel(loaded.model); setImageModel(loaded.imageModel || 'narwhal'); setDurationSeconds(loaded.durationSeconds); setAspectRatio(loaded.aspectRatio); setAutomationMode(loaded.automationMode || 'automatic'); setSetupOpen(false); })
        .catch(() => localStorage.removeItem(storageKey));
  }, []);
  useEffect(() => {
    if (!job || !active.has(job.status)) return;
    const controller = new AbortController();
    const timer = window.setInterval(
      () =>
        void api
          .getAiVideoJob(job.id, controller.signal)
          .then(setJob)
          .catch(() => undefined),
      2500,
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!scriptProvider || !scriptAssignment.model) {
      onNotice('Hãy chọn AI phát triển ý tưởng.', 'error');
      return;
    }
    if (characterReference && characterReference.size > 20 * 1024 * 1024) {
      onNotice('Ảnh nhân vật không được vượt quá 20 MB.', 'error');
      return;
    }
    setStarting(true);
    let characterReferenceUploadId: string | undefined;
    try {
      if (characterReference) characterReferenceUploadId = (await api.uploadMedia(characterReference)).uploadId;
      const supplementalBrief = noteNodes.filter((node) => node.value.trim()).map((node) => `${node.title.toUpperCase()}: ${node.value.trim()}`).join('\n');
      const created = await api.createAiVideoJob({
        brief: supplementalBrief ? `${brief.trim()}\n\nYÊU CẦU SẢN XUẤT BỔ SUNG:\n${supplementalBrief}` : brief,
        durationSeconds,
        model,
        imageModel,
        aspectRatio,
        directionMode,
        workflowMode: 'review-first',
        automationMode,
        characterReferenceUploadId,
        script: { provider: scriptProvider, model: scriptAssignment.model },
      });
      setJob(created);
      setWorkflowNodes([]);
      setSetupOpen(false);
      localStorage.setItem(storageKey, created.id);
      onNotice('Đã bắt đầu tiền kỳ. AutoSub sẽ tạo character sheet và storyboard trước khi dùng credit video.');
    } catch (error) {
      onNotice(friendlyErrorMessage(error, 'Không thể tạo video AI.'), 'error');
    } finally {
      if (characterReferenceUploadId) void api.deleteUpload(characterReferenceUploadId);
      setStarting(false);
    }
  };

  const commitDuration = () => {
    const parsed = Math.round(Number(durationDraft));
    const next = Number.isFinite(parsed) ? Math.max(4, Math.min(maxDurationSeconds, parsed)) : durationSeconds;
    setDurationSeconds(next);
    setDurationDraft(String(next));
  };

  const running = starting || Boolean(job && active.has(job.status));
  const awaitingApproval = job?.status === 'reviewing';
  const startNewWorkflow = () => { localStorage.removeItem(storageKey); localStorage.removeItem(workflowNodesKey); setJob(undefined); setWorkflowNodes([]); setSetupOpen(true); };
  const openFlow = async () => {
    setOpeningFlow(true);
    try {
      setFlowAgent(await api.openFlowAgent());
      onNotice('Đã mở Google Flow cùng extension Flow Agent.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể mở Google Flow.'), 'error'); }
    finally { setOpeningFlow(false); }
  };
  const resumeFailedJob = async () => {
    if (!job) return;
    if (!scriptProvider || !scriptAssignment.model) {
      onNotice('Hãy chọn AI phát triển ý tưởng.', 'error');
      return;
    }
    setStarting(true);
    try {
      const resumed = await api.resumeAiVideoJob(job.id, model, { provider: scriptProvider, model: scriptAssignment.model });
      setJob(resumed);
      onNotice(job.scenes.length ? `Đang tiếp tục cảnh lỗi bằng ${model}.` : 'Đang tạo lại kế hoạch phim ở dạng JSON gọn.');
    } catch (error) {
      onNotice(friendlyErrorMessage(error, 'Không thể tiếp tục job.'), 'error');
    } finally {
      setStarting(false);
    }
  };
  const approvePreproduction = async () => {
    if (!job) return;
    setStarting(true);
    try {
      setJob(await api.approveAiVideoJob(job.id));
      onNotice(job.automationMode === 'manual' ? 'Đã khóa thiết kế. Flow bắt đầu tạo từng shot video.' : 'Đã duyệt nhân vật. AutoSub sẽ tự tạo storyboard, các shot Flow và bản master.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể duyệt tiền kỳ.'), 'error'); }
    finally { setStarting(false); }
  };
  const savePreproduction = async (input: Parameters<typeof api.updateAiVideoPreproduction>[1]) => {
    if (!job) return;
    setStarting(true);
    try { setJob(await api.updateAiVideoPreproduction(job.id, input)); onNotice('Đã lưu chỉnh sửa. Node thay đổi cần được tạo lại trước khi duyệt.'); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể lưu chỉnh sửa tiền kỳ.'), 'error'); }
    finally { setStarting(false); }
  };
  const regenerateDesign = async (kind: 'character-sheet' | 'storyboard', sceneIndex?: number, characterIndex?: number) => {
    if (!job) return;
    setStarting(true);
    try { setJob(await api.regenerateAiVideoDesign(job.id, { kind, sceneIndex, characterIndex })); onNotice(kind === 'character-sheet' ? `Đang tạo lại hình ảnh ${job.characters?.find((character) => character.index === characterIndex)?.name || 'nhân vật'}.` : `Đang tạo lại storyboard ${sceneIndex}; video phụ thuộc sẽ được tạo lại.`); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo lại thiết kế.'), 'error'); }
    finally { setStarting(false); }
  };
  const regenerateShot = async (sceneIndex: number) => {
    if (!job) return;
    setStarting(true);
    try { setJob(await api.regenerateAiVideoShot(job.id, sceneIndex)); onNotice(`Flow đang tạo shot ${sceneIndex}. Các shot phụ thuộc phía sau sẽ được tạo lại.`); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo Flow shot.'), 'error'); }
    finally { setStarting(false); }
  };
  const changeImageModel = (value: string) => { setImageModel(value); if (job?.status === 'reviewing') void savePreproduction({ imageModel: value }); };
  const changeVideoModel = (value: FlowVideoModel) => { setModel(value); if (job?.status === 'reviewing') void savePreproduction({ model: value }); };
  const addWorkflowNode = (nodeId: string) => setWorkflowNodes((nodes) => nodes.includes(nodeId) ? nodes : [...nodes, nodeId]);
  const removeWorkflowNode = (nodeId: string) => setWorkflowNodes((nodes) => nodes.filter((id) => {
    if (nodeId === 'character') return !['character', 'master'].includes(id) && !id.startsWith('story-') && !id.startsWith('shot-');
    if (nodeId.startsWith('story-')) { const index = nodeId.split('-')[1]; return id !== nodeId && id !== `shot-${index}` && id !== 'master'; }
    if (nodeId.startsWith('shot-')) return id !== nodeId && id !== 'master';
    return id !== nodeId;
  }));
  const cancelJob = async () => {
    if (!job) return;
    try {
      const cancelled = await api.cancelAiVideoJob(job.id);
      setJob(cancelled);
      onNotice('Đã dừng tác vụ video AI.');
    } catch (error) {
      onNotice(friendlyErrorMessage(error, 'Không thể dừng tác vụ.'), 'error');
    }
  };
  return (
    <div className="page ai-video-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">AI VIDEO PRODUCTION</span>
          <h1>
            Kịch bản thành <span>video AI</span>
          </h1>
          <p>AI phát triển ý tưởng, chia cảnh, đạo diễn prompt và dùng Google Flow để dựng video dọc.</p>
        </div>
        <div className="ai-video-header-badge">
          <Film size={18} aria-hidden="true" />
          <span>
            <strong>Flow production line</strong>
            <small>Ý tưởng · cảnh · kiểm tra · MP4</small>
          </span>
        </div>
      </header>
      <form className={`ai-video-grid ${setupOpen ? 'setup' : 'workspace'}`} onSubmit={submit}>
        <div className="ai-video-config" hidden={!setupOpen}>
          <button type="button" className="ai-video-config-close" onClick={() => setSetupOpen(false)} aria-label="Đóng thiết lập"><X size={16} /></button>
          <section className="review-panel ai-video-mode-panel">
            <div className="section-title"><span>CHẾ ĐỘ WORKFLOW</span><small>{automationMode === 'automatic' ? 'Tự dựng chuỗi sản xuất' : 'Tự thêm và chạy từng node'}</small></div>
            <div className="ai-video-mode-switch" role="group" aria-label="Chế độ chạy workflow">
              <button type="button" className={automationMode === 'automatic' ? 'active' : ''} onClick={() => setAutomationMode('automatic')}><strong>Tự động</strong><small>AI tạo từng nhân vật để bạn duyệt; sau đó tự làm storyboard, shot và master.</small></button>
              <button type="button" className={automationMode === 'manual' ? 'active' : ''} onClick={() => setAutomationMode('manual')}><strong>Thủ công</strong><small>Chỉ tạo production bible trước; thêm và chạy từng node theo ý bạn.</small></button>
            </div>
          </section>
          <section className="review-panel ai-video-format">
            <div className="section-title">
              <span>FLOW AGENT LOCAL</span>
              <small>{flowAgent?.connected ? 'Đã sẵn sàng' : flowAgent?.installed ? 'Chưa kết nối Google Flow' : 'Chưa chạy backend'}</small>
            </div>
            <div className="ai-video-cost-note">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>{flowAgent?.connected ? `Backend ${flowAgent.url} đã kết nối extension qua ${flowAgent.transport}.` : flowAgent?.installed ? 'Backend đã chạy. Hãy bật extension Flow Agent trong Opera GX, mở Google Flow và tải lại tab.' : 'Cài Flow Agent, chạy lệnh “flow”, sau đó bật extension của repo trong Opera GX.'}</span>
            </div>
            <div className="ai-video-flow-actions">
              <button type="button" className="button secondary" disabled={openingFlow} onClick={() => void openFlow()}>{openingFlow ? <LoaderCircle className="spin" size={15} /> : <Film size={15} />} {openingFlow ? 'Đang mở…' : 'Mở Google Flow'}</button>
              <button type="button" className="button ghost" onClick={() => window.open('https://github.com/kodelyx/flow-agent', '_blank', 'noopener,noreferrer')}>Hướng dẫn Flow Agent</button>
            </div>
          </section>
          <section className="review-panel">
            <div className="section-title">
              <span>01 · KỊCH BẢN / Ý TƯỞNG</span>
              <small>AI sẽ giữ mạch hình ảnh giữa các cảnh</small>
            </div>
            <div className="field">
              <span>Nội dung video</span>
              <textarea className="ai-video-brief" value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Dán kịch bản hoàn chỉnh hoặc mô tả ý tưởng, nhân vật, bối cảnh và phong cách mong muốn…" />
            </div>
            <small className="field-help">Tối thiểu 20 ký tự. Không cần tự viết prompt tiếng Anh cho từng cảnh.</small>
            <label className="field">
              <span>
                Ảnh nhân vật gốc <small>(khuyên dùng)</small>
              </span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setCharacterReference(event.target.files?.[0])} />
            </label>
            <small className="field-help">Một nhân vật, toàn thân, nền đơn giản; PNG/JPG/WebP tối đa 20 MB. Ảnh được khóa và gửi lại ở mọi cảnh.</small>
          </section>
          <section className="review-panel">
            <div className="section-title">
              <span>02 · ĐẠO DIỄN & FLOW AGENT</span>
              <small>
                khoảng {Math.ceil(durationSeconds / professionalShotSeconds)} shot · một góc máy/shot
              </small>
            </div>
            <CapabilityAssignmentPicker capability="translation" assignments={capabilityAssignments(settings, 'translation')} providers={providers} value={scriptAssignment} onChange={setScriptAssignment} label="AI phát triển ý tưởng và chia cảnh" />
            <div className="field">
              <span>Phong cách đạo diễn</span>
              <SelectField ariaLabel="Phong cách đạo diễn phim" value={directionMode} onChange={(value) => setDirectionMode(value as typeof directionMode)} options={[
                { value: 'cinematic', label: 'Điện ảnh kể chuyện', description: 'Blocking, coverage và nhịp cảm xúc có chủ đích.' },
                { value: 'documentary', label: 'Tài liệu quan sát', description: 'Chân thực, ánh sáng tự nhiên và âm thanh hiện trường.' },
                { value: 'commercial', label: 'Phim thương hiệu', description: 'Hình ảnh cao cấp, tiết tấu gọn và payoff rõ.' },
                { value: 'social-realism', label: 'Đời thường', description: 'Diễn xuất tự nhiên, góc máy gần gũi, không phô trương.' },
              ]} />
            </div>
            <div className="field">
              <span>Model tạo video</span>
              <SelectField
                ariaLabel="Model Google Flow"
                value={model}
                onChange={(value) => setModel(value as FlowVideoModel)}
                options={models.map((value) => ({
                  value,
                  label: value,
                  description: 'Flow Agent tự chọn model phù hợp với thời lượng cảnh',
                }))}
              />
            </div>
            <div className="field">
              <span>
                Độ dài video <b className="value-badge">{formatDuration(durationSeconds)}</b>
              </span>
              <div className="ai-video-duration-control">
                <input aria-label="Độ dài video tính bằng giây" type="number" min="4" max={maxDurationSeconds} step="1" disabled={Boolean(job)} value={durationDraft} onChange={(event) => setDurationDraft(event.target.value)} onBlur={commitDuration} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitDuration(); } }} />
                <span>giây · tối đa 20 phút</span>
              </div>
              <RangeInput min={4} max={maxDurationSeconds} step={1} disabled={Boolean(job)} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} />
            </div>
            <div className="ai-video-cost-note">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                Chế độ điện ảnh tạo một lượt Flow cho mỗi shot khoảng {professionalShotSeconds} giây. Video {durationSeconds} giây cần khoảng <strong>{Math.ceil(durationSeconds / professionalShotSeconds)} lượt</strong>. Số lượt nhiều hơn chế độ cũ 8 giây nhưng cho storyboard và góc máy riêng; job dừng ngay nếu một shot thất bại.
              </span>
            </div>
            <button className="button primary large full" disabled={running || awaitingApproval || brief.trim().length < 20}>
              {running ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />} {running ? (job && ['generating', 'composing'].includes(job.status) ? 'Đang sản xuất video…' : 'Đang làm tiền kỳ…') : awaitingApproval ? (automationMode === 'automatic' ? 'Đang chờ duyệt nhân vật' : 'Đang chờ duyệt storyboard') : automationMode === 'manual' ? 'Tạo production bible' : 'Tạo hình ảnh nhân vật'} <span>→</span>
            </button>
            <small className="field-help">{automationMode === 'manual' ? 'Chế độ thủ công chỉ chạy AI Director trước. Sau đó mở Thêm node để dựng và chạy từng bước.' : 'Bước này tạo riêng character bible cho từng nhân vật. Sau khi bạn duyệt, storyboard và video sẽ chạy tự động.'}</small>
            {!flowAgent?.connected && <small className="field-help">Bạn vẫn có thể bấm tạo. AutoSub sẽ kiểm tra phiên Flow trước khi gửi cảnh và báo cách khắc phục nếu phiên chưa sẵn sàng.</small>}
          </section>
          <section className="review-panel ai-video-format">
            <div className="section-title">
              <span>03 · KHUNG HÌNH</span>
              <small>Được gửi trực tiếp tới Flow</small>
            </div>
            <div className="field">
              <span>Tỷ lệ video</span>
              <SelectField
                ariaLabel="Tỷ lệ video AI"
                value={aspectRatio}
                onChange={(value) => setAspectRatio(value as FlowVideoAspectRatio)}
                options={[
                  {
                    value: '9:16',
                    label: '9:16 · Video dọc',
                    description: 'TikTok, Reels, YouTube Shorts',
                  },
                  {
                    value: '16:9',
                    label: '16:9 · Video ngang',
                    description: 'YouTube, màn hình rộng',
                  },
                ]}
              />
            </div>
          </section>
        </div>
        <section className="review-panel ai-video-output">
          <div className="section-title">
            <span>NODE WORKFLOW</span>
            <small>{job ? `JOB ${job.id.slice(0, 8)}` : 'Chưa bắt đầu'}</small>
          </div>
          <AiVideoWorkflowGraph
            job={job}
            brief={brief}
            characterFile={characterReference}
            aspectRatio={aspectRatio}
            busy={starting}
            flowConnected={Boolean(flowAgent?.connected)}
            canStart={brief.trim().length >= 20}
            setupOpen={setupOpen}
            noteNodes={noteNodes}
            providers={providers}
            directorAssignments={directorAssignments}
            directorAssignment={scriptAssignment}
            videoModel={model}
            imageModel={imageModel}
            automationMode={automationMode}
            workflowNodes={workflowNodes}
            onBriefChange={setBrief}
            onCharacterChange={setCharacterReference}
            onSetupToggle={() => setSetupOpen((value) => !value)}
            onSetupClose={() => setSetupOpen(false)}
            onNewWorkflow={startNewWorkflow}
            onNoteNodesChange={setNoteNodes}
            onDirectorAssignmentChange={setScriptAssignment}
            onVideoModelChange={changeVideoModel}
            onImageModelChange={changeImageModel}
            onAddWorkflowNode={addWorkflowNode}
            onRemoveWorkflowNode={removeWorkflowNode}
            onApprove={() => void approvePreproduction()}
            onCancel={() => void cancelJob()}
            onResume={() => void resumeFailedJob()}
            onSaveBible={(value) => void savePreproduction({ productionBible: value })}
            onSaveScene={(scene) => void savePreproduction({ scene })}
            onRegenerate={(kind, sceneIndex) => void regenerateDesign(kind, sceneIndex)}
            onRegenerateShot={(sceneIndex) => void regenerateShot(sceneIndex)}
          />
          <div className="ai-video-output-legacy" hidden>
          {!job ? (
            <div className="ai-video-workflow-preview">
              <div className="ai-video-preview-sheet">
                <span>CHARACTER SHEET</span>
                <div>{['FRONT', '3/4', 'SIDE', 'BACK'].map((label) => <i key={label}><Film size={18} /><small>{label}</small></i>)}</div>
              </div>
              <div className="ai-video-preview-board">
                <span>STORYBOARD</span>
                <div>{[1, 2, 3, 4, 5, 6].map((number) => <i key={number}><b>{String(number).padStart(2, '0')}</b></i>)}</div>
              </div>
              <div className="ai-video-preview-copy">
                <WandSparkles size={22} />
                <div><strong>Ảnh sản xuất sẽ hiện trực tiếp trong workflow</strong><small>Character sheet trước, storyboard sau; bạn duyệt xong mới tạo các shot video.</small></div>
              </div>
            </div>
          ) : (
            <>
              <div className={`review-status ${job.status}`}>
                <span>{active.has(job.status) ? <LoaderCircle className="spin" size={16} /> : ['completed', 'reviewing'].includes(job.status) ? <Check size={16} /> : <X size={16} />}</span>
                <div>
                  <strong>{job.stage}</strong>
                  <small>{job.error || `${job.model} · ${job.durationSeconds} giây`}</small>
                </div>
                <b>{job.progressPercent}%</b>
              </div>
              <div className="progress-track review-progress">
                <div style={{ width: `${job.progressPercent}%` }} />
              </div>
              {['designing', 'reviewing'].includes(job.status) && (
                <div className="ai-video-preproduction">
                  <header>
                    <div>
                      <span className="eyebrow">DESIGN CHECKPOINT</span>
                      <h2>{job.status === 'reviewing' ? (job.automationMode === 'manual' ? 'Duyệt thiết kế tiền kỳ' : 'Duyệt hình ảnh nhân vật') : 'Đang tự động dựng phim'}</h2>
                      <p>{job.status === 'reviewing' ? (job.automationMode === 'manual' ? 'Kiểm tra nhân vật và storyboard trước khi chạy từng shot.' : 'Kiểm tra riêng từng nhân vật. Nếu chưa đúng, tạo lại nhân vật đó; storyboard và video chỉ chạy sau khi bạn duyệt.') : 'Ảnh hoàn thành tới đâu sẽ xuất hiện ngay tới đó. AutoSub đang giữ nhận dạng nhân vật xuyên suốt các khung hình.'}</p>
                    </div>
                    {job.status === 'reviewing' ? <ShieldCheck size={22} aria-hidden="true" /> : <LoaderCircle className="spin" size={22} aria-hidden="true" />}
                  </header>
                  <section className="ai-video-character-sheet">
                    <div className="ai-video-design-heading">
                      <div><span>01</span><strong>Character bible</strong></div>
                      <small>Turnaround · biểu cảm · tư thế · đạo cụ</small>
                    </div>
                    <div className="ai-video-character-grid">
                      {(job.characters?.length ? job.characters : [{ index: 1, name: 'Nhân vật chính', description: '', sheetReady: job.characterSheetReady }]).map((character) => {
                        const src = `${aiVideoCharacterSheetUrl(job.id, job.characters?.length ? character.index : undefined)}${job.characters?.length ? '&' : '?'}v=${encodeURIComponent(job.updatedAt)}`;
                        return <article key={character.index}>
                          {character.sheetReady ? <img src={src} alt={`Bảng thiết kế ${character.name}`} /> : <div className="ai-video-design-skeleton"><LoaderCircle className="spin" size={22} /><span>Đang tạo {character.name}…</span></div>}
                          <div><strong>{character.name}</strong><small>{character.description || 'Turnaround · biểu cảm · tư thế · đạo cụ'}</small></div>
                          {job.status === 'reviewing' && <button type="button" className="button secondary" disabled={starting || !flowAgent?.connected} onClick={() => void regenerateDesign('character-sheet', undefined, character.index)}>Tạo lại nhân vật này</button>}
                        </article>;
                      })}
                    </div>
                    {job.productionBible && <details><summary>Xem production bible</summary><p>{job.productionBible}</p></details>}
                  </section>
                  {(job.automationMode === 'manual' || job.status !== 'reviewing') && <section>
                    <div className="ai-video-design-heading">
                      <div><span>02</span><strong>Storyboard</strong></div>
                      <small>{job.scenes.length} shot được khống chế liên tục</small>
                    </div>
                    <div className="ai-video-storyboard-grid">
                      {job.scenes.map((scene) => (
                        <article key={scene.index}>
                          {scene.storyboardReady ? <img src={`${aiVideoStoryboardUrl(job.id, scene.index)}&v=${encodeURIComponent(job.updatedAt)}`} alt={`Storyboard cảnh ${scene.index}: ${scene.title}`} /> : <div className="ai-video-frame-skeleton"><span>{String(scene.index).padStart(2, '0')}</span></div>}
                          <div><span>{String(scene.index).padStart(2, '0')}</span><strong>{scene.title}</strong></div>
                          <p>{scene.dramaticBeat || scene.narration}</p>
                          {scene.shotPlan && <small>{scene.shotPlan}</small>}
                        </article>
                      ))}
                    </div>
                  </section>}
                  {job.status === 'reviewing' && <footer>
                    <div><strong>{job.automationMode === 'manual' ? 'Duyệt tiền kỳ trước khi tạo video' : 'Chỉ cần duyệt hình ảnh nhân vật'}</strong><small>{job.automationMode === 'manual' ? 'Character sheet và storyboard sẽ được khóa.' : 'Sau bước này AutoSub tự tạo storyboard, shot Flow và bản master.'}</small></div>
                    <button type="button" className="button primary" disabled={starting || !flowAgent?.connected} onClick={() => void approvePreproduction()}>
                      {starting ? <LoaderCircle className="spin" size={15} /> : <Film size={15} />} {job.automationMode === 'manual' ? 'Khóa thiết kế & tạo video' : 'Duyệt nhân vật & tự dựng phim'}
                    </button>
                  </footer>}
                </div>
              )}
              {job.scenes.length > 0 && job.status !== 'reviewing' && (
                <div className="ai-video-scenes">
                  {job.scenes.map((scene) => (
                    <article key={scene.index} className={scene.status}>
                      <span>{String(scene.index).padStart(2, '0')}</span>
                      <div>
                        <strong>{scene.title}</strong>
                        <p>{scene.narration || scene.visualPrompt}</p>
                      </div>
                      <div className="ai-video-scene-actions">
                        {scene.status === 'completed' ? (
                          <>
                            <a className="button small ghost" href={aiVideoClipUrl(job.id, scene.index)} target="_blank" rel="noreferrer">
                              <Film size={12} /> Xem
                            </a>
                            <a className="button small ghost" href={aiVideoClipUrl(job.id, scene.index, true)}>
                              <Download size={12} /> Tải
                            </a>
                          </>
                        ) : (
                          <small>{scene.status === 'pending' ? 'Chờ' : scene.status === 'generating' ? 'Đang tạo' : 'Lỗi'}</small>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {active.has(job.status) && (
                <button type="button" className="button secondary full" onClick={() => void cancelJob()}>
                  <X size={15} /> Dừng tác vụ
                </button>
              )}
              {['failed', 'cancelled'].includes(job.status) && (
                <button type="button" className="button secondary full" disabled={starting || !flowAgent?.connected} onClick={() => void resumeFailedJob()}>
                  {starting ? <LoaderCircle className="spin" size={15} /> : <WandSparkles size={15} />} Tiếp tục từ cảnh lỗi
                </button>
              )}
              {job.status === 'completed' && job.result && (
                <div className="review-result">
                  <video controls playsInline preload="metadata" src={aiVideoUrl(job.id)} />
                  <div className="review-result-meta">
                    <div>
                      <span>Thời lượng</span>
                      <strong>{Math.round(job.result.durationMs / 1000)} giây</strong>
                    </div>
                    <div>
                      <span>Số cảnh</span>
                      <strong>{job.scenes.length}</strong>
                    </div>
                    <a className="button primary" href={aiVideoUrl(job.id, true)}>
                      <Download size={14} /> Tải MP4
                    </a>
                  </div>
                </div>
              )}
            </>
          )}
          </div>
        </section>
      </form>
    </div>
  );
}
