import { useEffect, useRef, useState } from 'react';
import type { AIProvider, AppSettings, ProviderAssignment, SubtitleCue, VideoAsset } from '../types';
import { defaultStyle } from '../types';
import { api, friendlyErrorMessage } from '../lib/api';
import { extractionStatusStorage, storage, type ExtractionRunState, type ExtractionRunStatus } from '../lib/storage';
import { AudioLines, Check, FileAudio, FileVideo, Languages, Upload, Video, WandSparkles } from '../components/Icons';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { capabilityAssignments } from '../lib/settings';
import { ProgressModal } from '../components/ProgressModal';
import { VideoPlayer } from '../editor/VideoPlayer';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';

export function ExtractPage({ providers, settings, onCuesChange, onAssetChange, onOpenEditor, onNotice }: { providers: AIProvider[]; settings: AppSettings; onCuesChange: (cues: SubtitleCue[]) => void; onAssetChange: (asset?: VideoAsset) => void; onOpenEditor: () => void; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [tab, setTab] = useState<'ocr' | 'stt'>('ocr');
  const [file, setFile] = useState<File>();
  const [asset, setAsset] = useState<VideoAsset>();
  const [roi, setRoi] = useState({ x: 0, y: 75, w: 100, h: 25 });
  const [sourceLanguage, setSourceLanguage] = useState('Auto Detect');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [filterWatermark, setFilterWatermark] = useState(false);
  const [samplingFps, setSamplingFps] = useState(2);
  const [working, setWorking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('Chuẩn bị pipeline');
  const [runState, setRunState] = useState<ExtractionRunState>(() => extractionStatusStorage.load());
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const progressPollRef = useRef<number | undefined>(undefined);
  const progressTimerRef = useRef<number | undefined>(undefined);
  const selectedFileRef = useRef<File | undefined>(undefined);
  const [activeAssignments, setActiveAssignments] = useState<Record<'vision' | 'stt', ProviderAssignment>>({ vision: settings.assignments.vision, stt: settings.assignments.stt });
  const [translationAssignment, setTranslationAssignment] = useState<ProviderAssignment>(settings.assignments.translation);
  const capability = tab === 'ocr' ? 'vision' : 'stt';
  const configuredAssignments = capabilityAssignments(settings, capability);
  const assignment = activeAssignments[capability];
  const provider = providers.find((item) => item.id === assignment.providerId);

  const clearProgressTimers = () => {
    if (progressPollRef.current !== undefined) { window.clearTimeout(progressPollRef.current); progressPollRef.current = undefined; }
    if (progressTimerRef.current !== undefined) { window.clearInterval(progressTimerRef.current); progressTimerRef.current = undefined; }
  };

  const easeProgressTo = (ceiling: number) => {
    if (progressTimerRef.current !== undefined) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => {
      setProgress((current) => current >= ceiling - 0.2 ? current : Math.min(ceiling, current + Math.max(0.12, (ceiling - current) * 0.04)));
    }, 120);
  };

  const pollExtractionProgress = async (progressId: string, signal: AbortSignal) => {
    try {
      const status = await api.getExtractionProgress(progressId, signal);
      setProgress(status.percent);
      setProgressStage(status.stage);
      if (status.status === 'running' && !signal.aborted) progressPollRef.current = window.setTimeout(() => void pollExtractionProgress(progressId, signal), 250);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError') && !signal.aborted) progressPollRef.current = window.setTimeout(() => void pollExtractionProgress(progressId, signal), 500);
    }
  };

  useEffect(() => () => { controllerRef.current?.abort(); clearProgressTimers(); }, []);
  useEffect(() => { setActiveAssignments((current) => ({ ...current, vision: settings.assignments.vision, stt: settings.assignments.stt })); setTranslationAssignment(settings.assignments.translation); }, [settings.assignments.vision.providerId, settings.assignments.vision.model, settings.assignments.stt.providerId, settings.assignments.stt.model, settings.assignments.translation.providerId, settings.assignments.translation.model]);

  const updateRunState = (next: ExtractionRunState) => {
    setRunState(next);
    extractionStatusStorage.save(next);
  };

  const selectFile = (next?: File) => {
    if (!next) return;
    if (asset?.uploadId) void api.deleteUpload(asset.uploadId);
    updateRunState({ status: 'uploading', mode: tab, fileName: next.name, updatedAt: Date.now() });
    selectedFileRef.current = next;
    setFile(next);
    const nextAsset: VideoAsset = { name: next.name, file: next, url: URL.createObjectURL(next), type: next.type };
    setAsset(nextAsset);
    onAssetChange(nextAsset);
    setUploading(true);
    void api.uploadMedia(next).then((stored) => {
      if (selectedFileRef.current !== next) return;
      const uploadedAsset = { ...nextAsset, uploadId: stored.uploadId, storedPath: stored.storedPath, path: stored.storedPath };
      setAsset(uploadedAsset);
      onAssetChange(uploadedAsset);
      updateRunState({ status: 'ready', mode: tab, fileName: next.name, updatedAt: Date.now() });
      onNotice(`Đã lưu ${next.name} trên máy.`, 'success');
    }).catch((error) => {
      if (selectedFileRef.current === next) {
        updateRunState({ status: 'failed', mode: tab, fileName: next.name, updatedAt: Date.now() });
        onNotice(friendlyErrorMessage(error, 'Không thể lưu file trên máy.'), 'error');
      }
    }).finally(() => {
      if (selectedFileRef.current === next) setUploading(false);
    });
  };

  const clearFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (asset?.url.startsWith('blob:')) URL.revokeObjectURL(asset.url);
    if (asset?.uploadId) void api.deleteUpload(asset.uploadId);
    selectedFileRef.current = undefined;
    updateRunState({ status: 'idle' });
    setFile(undefined);
    setAsset(undefined);
    onAssetChange(undefined);
  };

  const run = async () => {
    if (!file) { onNotice(tab === 'ocr' ? 'Hãy chọn video trước khi bắt đầu OCR.' : 'Hãy chọn video hoặc audio trước khi bắt đầu STT.', 'error'); return; }
    if (uploading || !asset?.uploadId) { onNotice('File vẫn đang được lưu trên máy. Hãy chờ upload hoàn tất rồi thử lại.', 'error'); return; }
    if (!provider) { onNotice(`Chưa có ${tab === 'ocr' ? 'Vision' : 'STT'} Provider trong Cài đặt.`, 'error'); return; }
    if (!provider.enabled) { onNotice(`Provider ${provider.name} đang bị tắt trong Cài đặt.`, 'error'); return; }
    if (!assignment.model) { onNotice(`Provider ${provider.name} đã chọn nhưng chưa có Model. Hãy chọn Model trong Cài đặt.`, 'error'); return; }
    const capability = tab === 'ocr' ? 'vision' : 'stt';
    const tested = storage.modelPreferences()[`${provider.id}::${capability}::${assignment.model}`];
    if (tested?.status === 'failed') { onNotice(`Model ${assignment.model} không hỗ trợ ${capability.toUpperCase()}. Hãy chọn model có trạng thái Chạy được trong Cài đặt.`, 'error'); return; }

    const controller = new AbortController();
    controllerRef.current = controller;
    clearProgressTimers();
    updateRunState({ status: 'running', mode: tab, fileName: file.name, updatedAt: Date.now() });
    setWorking(true);
    setProgress(10);
    setProgressStage(tab === 'ocr' ? 'Đang khởi tạo OCR progress' : autoTranslate ? 'FFmpeg → STT → Translation' : 'FFmpeg → STT provider');
    const progressId = tab === 'ocr' ? crypto.randomUUID() : undefined;
    if (progressId) void pollExtractionProgress(progressId, controller.signal);
    else easeProgressTo(autoTranslate ? 58 : 60);
    try {
      if (tab === 'stt') {
        const result = await api.extractStt(asset.uploadId, provider, assignment.model, sourceLanguage, controller.signal);
        if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.info(`[FRONTEND RECEIVED] ${JSON.stringify({ cueCount: result.cues.length, cues: result.cues.slice(0, 5).map((cue) => ({ text: cue.originalText, startMs: cue.startMs, endMs: cue.endMs })) })}`);
        clearProgressTimers();
        setProgress(65);
        setProgressStage(`STT hoàn tất · nhận ${result.cues.length} cue`);
        let nextCues = result.cues;
        if (autoTranslate) {
          const translationProvider = providers.find((item) => item.id === translationAssignment.providerId);
          if (!translationProvider || !translationAssignment.model) {
            onNotice('STT đã xong; auto-translation bị bỏ qua vì chưa có Translation Provider + Model.', 'error');
          } else {
            setProgressStage('Đang dịch các cue vừa nhận');
            easeProgressTo(92);
            const translated = await api.translate(translationProvider, translationAssignment.model, result.cues, sourceLanguage, 'Tiếng Việt', 'Tự nhiên', '', storage.glossary().filter((entry) => entry.enabled), controller.signal);
            clearProgressTimers();
            nextCues = result.cues.map((cue) => ({ ...cue, translatedText: translated.items.find((item) => item.id === cue.id)?.translation || cue.translatedText }));
            setProgress(90);
            setProgressStage('Đã dịch xong · đang lưu SubtitleCue[]');
          }
        }
        // Re-assert the server-backed asset together with the extraction result.
        // This prevents a transient File/blob asset from surviving navigation/HMR
        // without the uploadId required by dubbing and vocal separation.
        onAssetChange(asset);
        onCuesChange(nextCues);
        updateRunState({ status: 'completed', mode: tab, fileName: file.name, cueCount: nextCues.length, updatedAt: Date.now() });
        onNotice(`Đã trích xuất ${nextCues.length} cue${autoTranslate ? ' và xử lý auto-translation.' : '.'}`, 'success');
      } else {
        const result = await api.extractOcr(asset.uploadId, provider, assignment.model, roi, samplingFps, filterWatermark, controller.signal, progressId);
        clearProgressTimers();
        setProgress(95);
        setProgressStage(`Đã nhận OCR · ${result.cues.length} cue, đang lưu kết quả`);
        onAssetChange(asset);
        onCuesChange(result.cues);
        updateRunState({ status: 'completed', mode: tab, fileName: file.name, cueCount: result.cues.length, updatedAt: Date.now() });
        onNotice(`Đã OCR ${result.cues.length} cue.`, 'success');
      }
      setProgress(100);
      setProgressStage(tab === 'ocr' ? 'OCR hoàn tất' : 'Trích xuất hoàn tất');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        clearProgressTimers();
        setProgressStage('Đã hủy pipeline');
        updateRunState({ status: 'cancelled', mode: tab, fileName: file.name, updatedAt: Date.now() });
        onNotice('Đã hủy extraction.', 'success');
      }
      else {
        clearProgressTimers();
        setProgressStage('Pipeline thất bại');
        const message = friendlyErrorMessage(error, 'Pipeline thất bại.');
        if (provider && assignment.model && /không hỗ trợ|does not support|not supported/i.test(message)) {
          const current = storage.modelPreferences();
          const key = `${provider.id}::${tab === 'ocr' ? 'vision' : 'stt'}::${assignment.model}`;
          storage.saveModelPreferences({ ...current, [key]: { ...(current[key] || { bookmarked: false, status: 'unknown' }), status: 'failed', lastTestedAt: Date.now(), error: message } });
        }
        updateRunState({ status: 'failed', mode: tab, fileName: file.name, updatedAt: Date.now() });
        onNotice(message, 'error');
      }
    } finally {
      clearProgressTimers();
      controllerRef.current = undefined;
      setTimeout(() => setWorking(false), 450);
    }
  };

  const currentStatus: ExtractionRunStatus = runState.mode && runState.mode !== tab ? 'idle' : runState.status;
  const statusLabels: Record<ExtractionRunStatus, string> = { idle: 'Chưa chạy', uploading: 'Đang tải file', ready: 'Sẵn sàng trích xuất', running: 'Đang xử lý', completed: 'Đã hoàn thành', failed: 'Thất bại', cancelled: 'Đã hủy' };

  return <div className="page extract-page">
    <header className="page-header"><div><div className="eyebrow">EXTRACTION LAB / 03</div><h1>Trích xuất <span>phụ đề</span></h1><p>Đưa video hoặc âm thanh vào, lấy ra một SubtitleCue[] sạch để chỉnh sửa tiếp.</p></div></header>
    <div className="tab-bar"><button className={tab === 'ocr' ? 'active' : ''} onClick={() => setTab('ocr')}><Video size={16} /> OCR (Video)</button><button className={tab === 'stt' ? 'active' : ''} onClick={() => setTab('stt')}><AudioLines size={16} /> Trích xuất từ âm thanh</button></div>
    <section className="extract-grid"><div className="extract-left">
      <label className={`dropzone compact ${file ? 'loaded' : ''}`}><input type="file" accept={tab === 'ocr' ? 'video/*' : 'video/*,audio/*'} onChange={(event) => selectFile(event.target.files?.[0])} />{file ? <><div className="file-icon">{tab === 'ocr' ? <FileVideo size={18} /> : <FileAudio size={18} />}</div><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB · <button type="button" onClick={clearFile}>Thay file</button></small></div></> : <><div className="upload-icon"><Upload size={19} /></div><div><strong>{tab === 'ocr' ? 'Thả video vào đây' : 'Thả video hoặc audio vào đây'}</strong><small>{tab === 'ocr' ? '.mp4 · .mkv · .mov' : '.mp4 · .mp3 · .wav'}</small></div></>}</label>
      {tab === 'ocr' && <div className="ocr-stage"><VideoPlayer asset={asset} cues={[]} style={defaultStyle} roi={roi} onRoiChange={setRoi} /><div className="roi-caption"><span><i /> OCR region</span><small>Mặc định: x=0%, y=75%, w=100%, h=25% · kéo khung hoặc các góc để chỉnh</small></div></div>}
      {tab === 'stt' && <div className="audio-callout"><div className="audio-callout-icon"><AudioLines size={20} /></div><div><strong>STT sẽ tách audio bằng FFmpeg</strong><p>Chỉ gửi audio đã tách tới endpoint /audio/transcriptions của Provider. Capability STT được kiểm tra trong Cài đặt.</p></div></div>}
    </div><div className="extract-config">
      <div className="section-title"><span>{tab === 'ocr' ? 'OCR CONFIGURATION' : 'STT CONFIGURATION'}</span><span className="local-pill">LOCAL PIPELINE</span></div>
      <div className="field"><span>Ngôn ngữ gốc</span><SelectField ariaLabel="Ngôn ngữ gốc" value={sourceLanguage} onChange={setSourceLanguage} options={[{ value: 'Auto Detect', label: 'Auto Detect' }, { value: 'vi', label: 'Tiếng Việt' }, { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'ko', label: '한국어' }]} /></div>
      <CapabilityAssignmentPicker capability={capability} assignments={configuredAssignments} providers={providers} value={assignment} onChange={(value) => setActiveAssignments((current) => ({ ...current, [capability]: value }))} />
      <AssignmentSummary label={tab === 'ocr' ? 'Vision Provider đang dùng' : 'STT Provider đang dùng'} assignment={assignment} provider={provider} capability={capability} />
      {tab === 'ocr' ? <><div className="two-fields"><label className="field"><span>Sampling <b className="value-badge">{samplingFps} FPS</b></span><RangeInput min={1} max={4} step={1} value={samplingFps} onChange={(event) => setSamplingFps(Number(event.target.value))} /></label><div className="field"><span>ROI</span><div className="coordinate-readout">{roi.x.toFixed(0)}% × {roi.y.toFixed(0)}% · {roi.w.toFixed(0)}% × {roi.h.toFixed(0)}%</div></div></div><label className="toggle-row"><span>Lọc logo / watermark khỏi OCR</span><input type="checkbox" checked={filterWatermark} onChange={(event) => setFilterWatermark(event.target.checked)} /><i /></label></> : <label className="toggle-row"><span>Dịch tự động sau khi trích xuất</span><input type="checkbox" checked={autoTranslate} onChange={(event) => setAutoTranslate(event.target.checked)} /><i /></label>}
      {autoTranslate && tab === 'stt' && <><CapabilityAssignmentPicker capability="translation" assignments={capabilityAssignments(settings, 'translation')} providers={providers} value={translationAssignment} onChange={setTranslationAssignment} label="Translation Provider sau STT" /><div className="auto-translation-note"><Languages size={15} /> Sau STT, app dùng Translation Provider đã chọn và giữ timestamp của STT.</div></>}
      <button className="button primary large full" onClick={() => void run()} disabled={working || uploading}><WandSparkles size={16} /> {uploading ? 'Đang lưu file…' : working ? 'Đang chạy pipeline…' : tab === 'ocr' ? 'Bắt đầu OCR' : 'Bắt đầu trích xuất'} <span>→</span></button>
      <div className={`extraction-status-badge ${currentStatus}`} role="status"><span className="extraction-status-dot" /><strong>{statusLabels[currentStatus]}</strong>{currentStatus === 'completed' && runState.cueCount !== undefined && <small>· {runState.cueCount} cue</small>}{currentStatus !== 'idle' && runState.updatedAt && <time>{new Date(runState.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div>
      <div className="pipeline-steps"><span className="done"><Check size={13} /> {tab === 'ocr' ? 'Crop ROI' : 'Tách audio'}</span><span>→</span><span>{tab === 'ocr' ? 'Frame change' : 'STT endpoint'}</span><span>→</span><span>SubtitleCue[]</span></div><button className="text-button full" onClick={onOpenEditor}>Mở Editor hiện tại →</button>
    </div></section>
    <ProgressModal open={working} title={tab === 'ocr' ? 'Đang OCR video' : 'Đang nhận dạng giọng nói'} message={progressStage} value={progress} onCancel={() => controllerRef.current?.abort()} />
  </div>;
}
