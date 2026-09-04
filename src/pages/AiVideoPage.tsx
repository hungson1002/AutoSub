import { useEffect, useState, type FormEvent } from 'react';
import type { AIProvider, AiVideoJobStatus, AppSettings, FlowVideoAspectRatio, FlowVideoModel, ProviderAssignment } from '../types';
import { aiVideoClipUrl, aiVideoUrl, api, friendlyErrorMessage } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { Check, Download, Film, LoaderCircle, ShieldCheck, WandSparkles, X } from '../components/Icons';

const models: FlowVideoModel[] = ['Flow Agent Auto'];
const active = new Set<AiVideoJobStatus['status']>(['queued', 'planning', 'generating', 'composing']);
const storageKey = 'autosub.ai-video-job-id';
const flowClipSeconds = 8;

export function AiVideoPage({ providers, settings, onNotice }: { providers: AIProvider[]; settings: AppSettings; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [brief, setBrief] = useState('');
  const [characterReference, setCharacterReference] = useState<File>();
  const [durationSeconds, setDurationSeconds] = useState(20);
  const [model, setModel] = useState<FlowVideoModel>('Flow Agent Auto');
  const [aspectRatio, setAspectRatio] = useState<FlowVideoAspectRatio>('9:16');
  const [scriptAssignment, setScriptAssignment] = useState<ProviderAssignment>(settings.assignments.translation);
  const [flowAgent, setFlowAgent] = useState<Awaited<ReturnType<typeof api.flowAgentStatus>>>();
  const [openingFlow, setOpeningFlow] = useState(false);
  const [job, setJob] = useState<AiVideoJobStatus>();
  const [starting, setStarting] = useState(false);
  const scriptProvider = providers.find((item) => item.id === scriptAssignment.providerId);

  useEffect(() => {
    let active = true;
    const refresh = () => void api.flowAgentStatus().then((status) => { if (active) setFlowAgent(status); }).catch(() => { if (active) setFlowAgent(undefined); });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const id = localStorage.getItem(storageKey);
    if (id)
      void api
        .getAiVideoJob(id)
        .then(setJob)
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
      const created = await api.createAiVideoJob({
        brief,
        durationSeconds,
        model,
        aspectRatio,
        characterReferenceUploadId,
        script: { provider: scriptProvider, model: scriptAssignment.model },
      });
      setJob(created);
      localStorage.setItem(storageKey, created.id);
      onNotice('Đã bắt đầu sản xuất video AI.');
    } catch (error) {
      onNotice(friendlyErrorMessage(error, 'Không thể tạo video AI.'), 'error');
    } finally {
      if (characterReferenceUploadId) void api.deleteUpload(characterReferenceUploadId);
      setStarting(false);
    }
  };

  const running = starting || Boolean(job && active.has(job.status));
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
      <form className="ai-video-grid" onSubmit={submit}>
        <div className="ai-video-config">
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
                {Math.ceil(durationSeconds / flowClipSeconds)} cảnh · tối đa {flowClipSeconds} giây/cảnh
              </small>
            </div>
            <CapabilityAssignmentPicker capability="translation" assignments={capabilityAssignments(settings, 'translation')} providers={providers} value={scriptAssignment} onChange={setScriptAssignment} label="AI phát triển ý tưởng và chia cảnh" />
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
                Độ dài video <b className="value-badge">{durationSeconds} giây</b>
              </span>
              <RangeInput min={4} max={120} step={1} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} />
            </div>
            <div className="ai-video-cost-note">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                Mỗi cảnh là một lượt tạo Flow, tối đa {flowClipSeconds} giây. Video {durationSeconds} giây cần khoảng <strong>{Math.ceil(durationSeconds / flowClipSeconds)} lượt</strong>. Job dừng ngay nếu một cảnh thất bại.
              </span>
            </div>
            <button className="button primary large full" disabled={running || brief.trim().length < 20 || !flowAgent?.connected}>
              {running ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />} {running ? 'Đang sản xuất…' : 'Tạo video AI'} <span>→</span>
            </button>
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
            <span>TIẾN ĐỘ SẢN XUẤT</span>
            <small>{job ? `JOB ${job.id.slice(0, 8)}` : 'Chưa bắt đầu'}</small>
          </div>
          {job && (
            <div className="ai-video-stage-strip">
              {[
                { key: 'planning', label: 'Kịch bản' },
                { key: 'generating', label: 'Hình + giọng + hiệu ứng' },
                { key: 'composing', label: 'Ghép phim' },
                { key: 'completed', label: 'Hậu kiểm' },
              ].map((step, index) => {
                const current = job.status === 'queued' ? -1 : job.status === 'planning' ? 0 : job.status === 'generating' ? 1 : job.status === 'composing' ? 2 : job.status === 'completed' ? 3 : job.scenes.length > 0 ? 1 : 0;
                const state = index < current || job.status === 'completed' ? 'done' : index === current && job.status !== 'failed' ? 'active' : job.status === 'failed' && index === current ? 'failed' : 'waiting';
                return (
                  <div key={step.key} className={state}>
                    <i>{state === 'active' ? <LoaderCircle className="spin" size={13} /> : state === 'done' ? <Check size={13} /> : state === 'failed' ? <X size={13} /> : index + 1}</i>
                    <span>
                      <strong>{step.label}</strong>
                      <small>{step.key === 'generating' ? 'Flow tạo đồng thời audio' : state === 'active' ? 'Đang chạy' : state === 'done' ? 'Đã xong' : state === 'failed' ? 'Bị lỗi' : 'Chờ'}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {!job ? (
            <div className="review-empty">
              <Film size={30} />
              <strong>Storyboard sẽ xuất hiện ở đây</strong>
              <small>Nhập ý tưởng, chọn thời lượng và bắt đầu sản xuất.</small>
            </div>
          ) : (
            <>
              <div className={`review-status ${job.status}`}>
                <span>{active.has(job.status) ? <LoaderCircle className="spin" size={16} /> : job.status === 'completed' ? <Check size={16} /> : <X size={16} />}</span>
                <div>
                  <strong>{job.stage}</strong>
                  <small>{job.error || `${job.model} · ${job.durationSeconds} giây`}</small>
                </div>
                <b>{job.progressPercent}%</b>
              </div>
              <div className="progress-track review-progress">
                <div style={{ width: `${job.progressPercent}%` }} />
              </div>
              {job.scenes.length > 0 && (
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
        </section>
      </form>
    </div>
  );
}
