import { useEffect, useRef, useState } from 'react';
import type { AIProvider, AppSettings, ProviderAssignment, SubtitleCue, VideoAsset } from '../types';
import { defaultStyle } from '../types';
import { api, buildTranslationMemory, friendlyErrorMessage, MAX_BROWSER_UPLOAD_BYTES } from '../lib/api';
import { extractionStatusStorage, storage, type ExtractionRunState, type ExtractionRunStatus } from '../lib/storage';
import { AudioLines, Check, FileAudio, FileVideo, Languages, Upload, Video, WandSparkles } from '../components/Icons';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { capabilityAssignments } from '../lib/settings';
import { ProgressModal } from '../components/ProgressModal';
import { VideoPlayer } from '../editor/VideoPlayer';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { TestedModelSelect } from '../components/TestedModelSelect';
import { isCapabilityModelPassed } from '../lib/modelTests';

export function ExtractPage({ providers, settings, initialAsset, onCuesChange, onAssetChange, onOpenEditor, onNotice }: { providers: AIProvider[]; settings: AppSettings; initialAsset?: VideoAsset; onCuesChange: (cues: SubtitleCue[]) => void; onAssetChange: (asset?: VideoAsset) => void; onOpenEditor: () => void; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [tab, setTab] = useState<'ocr' | 'stt'>('ocr');
  const [file, setFile] = useState<File>();
  const [asset, setAsset] = useState<VideoAsset | undefined>(() => initialAsset || storage.asset());
  const [roi, setRoi] = useState({ x: 0, y: 75, w: 100, h: 25 });
  const [sourceLanguage, setSourceLanguage] = useState('Auto Detect');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [filterWatermark, setFilterWatermark] = useState(false);
  const [samplingFps, setSamplingFps] = useState(2);
  const [working, setWorking] = useState(false);
  const [mediaAction, setMediaAction] = useState<'idle' | 'uploading' | 'picking'>('idle');
  const uploading = mediaAction === 'uploading';
  const pickingLocalFile = mediaAction === 'picking';
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('Chuẩn bị pipeline');
  const [runState, setRunState] = useState<ExtractionRunState>(() => extractionStatusStorage.load());
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const progressPollRef = useRef<number | undefined>(undefined);
  const progressTimerRef = useRef<number | undefined>(undefined);
  const mediaRequestRef = useRef(0);
  const uploadControllerRef = useRef<AbortController | undefined>(undefined);
  const [activeAssignments, setActiveAssignments] = useState<Record<'vision' | 'stt', ProviderAssignment>>({ vision: settings.assignments.vision, stt: settings.assignments.stt });
  const [translationAssignment, setTranslationAssignment] = useState<ProviderAssignment>(settings.assignments.translation);
  const capability = tab === 'ocr' ? 'vision' : 'stt';
  const configuredAssignments = capabilityAssignments(settings, capability);
  const assignment = activeAssignments[capability];
  const provider = providers.find((item) => item.id === assignment.providerId);
  const translationProvider = providers.find((item) => item.id === translationAssignment.providerId);

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

  useEffect(() => () => { controllerRef.current?.abort(); uploadControllerRef.current?.abort(); clearProgressTimers(); }, []);
  useEffect(() => { setActiveAssignments((current) => ({ ...current, vision: settings.assignments.vision, stt: settings.assignments.stt })); setTranslationAssignment(settings.assignments.translation); }, [settings.assignments.vision.providerId, settings.assignments.vision.model, settings.assignments.stt.providerId, settings.assignments.stt.model, settings.assignments.translation.providerId, settings.assignments.translation.model]);

  const updateRunState = (next: ExtractionRunState) => {
    setRunState(next);
    extractionStatusStorage.save(next);
  };

  const selectFile = (next?: File) => {
    if (!next) return;
    if (next.size > MAX_BROWSER_UPLOAD_BYTES) {
      onNotice('File lớn hơn 4 GiB. Hãy dùng “Mở file lớn trên máy” để AutoSub đọc trực tiếp mà không upload hoặc sao chép.', 'error');
      return;
    }
    uploadControllerRef.current?.abort();
    const requestId = ++mediaRequestRef.current;
    const uploadController = new AbortController();
    uploadControllerRef.current = uploadController;
    if (asset?.uploadId) void api.deleteUpload(asset.uploadId);
    if (asset?.url.startsWith('blob:')) URL.revokeObjectURL(asset.url);
    updateRunState({ status: 'uploading', mode: tab, fileName: next.name, updatedAt: Date.now() });
    setFile(next);
    const nextAsset: VideoAsset = { name: next.name, file: next, url: URL.createObjectURL(next), type: next.type, size: next.size, sourceMode: 'copied' };
    setAsset(nextAsset);
    onAssetChange(nextAsset);
    setMediaAction('uploading');
    void api.uploadMedia(next, uploadController.signal).then((stored) => {
      if (mediaRequestRef.current !== requestId) { void api.deleteUpload(stored.uploadId).catch(() => undefined); return; }
      const uploadedAsset = { ...nextAsset, uploadId: stored.uploadId, storedPath: stored.storedPath, path: stored.storedPath, size: stored.size, sourceMode: stored.sourceMode || 'copied' };
      setAsset(uploadedAsset);
      onAssetChange(uploadedAsset);
      updateRunState({ status: 'ready', mode: tab, fileName: next.name, updatedAt: Date.now() });
      onNotice(`Đã lưu ${next.name} trên máy.`, 'success');
    }).catch((error) => {
      if (mediaRequestRef.current === requestId && !(error instanceof DOMException && error.name === 'AbortError')) {
        updateRunState({ status: 'failed', mode: tab, fileName: next.name, updatedAt: Date.now() });
        onNotice(friendlyErrorMessage(error, 'Không thể lưu file trên máy.'), 'error');
      }
    }).finally(() => {
      if (mediaRequestRef.current === requestId) { uploadControllerRef.current = undefined; setMediaAction('idle'); }
    });
  };

  const importLocalFile = async () => {
    if (pickingLocalFile) {
      uploadControllerRef.current?.abort();
      uploadControllerRef.current = undefined;
      mediaRequestRef.current += 1;
      setMediaAction('idle');
      return;
    }
    uploadControllerRef.current?.abort();
    const requestId = ++mediaRequestRef.current;
    const uploadController = new AbortController();
    uploadControllerRef.current = uploadController;
    setMediaAction('picking');
    try {
      const result = await api.importLocalMedia(tab === 'ocr' ? 'video' : 'media', uploadController.signal);
      if ('cancelled' in result) return;
      if (mediaRequestRef.current !== requestId) {
        await api.deleteUpload(result.uploadId).catch(() => undefined);
        return;
      }
      const previousAsset = asset;
      if (previousAsset?.uploadId) void api.deleteUpload(previousAsset.uploadId).catch(() => undefined);
      if (previousAsset?.url.startsWith('blob:')) URL.revokeObjectURL(previousAsset.url);
      const linkedAsset: VideoAsset = {
        name: result.filename,
        type: result.contentType,
        url: `/api/uploads/${encodeURIComponent(result.uploadId)}/media`,
        uploadId: result.uploadId,
        storedPath: result.storedPath,
        path: result.storedPath,
        size: result.size,
        sourceMode: 'linked',
      };
      setFile(undefined);
      setAsset(linkedAsset);
      onAssetChange(linkedAsset);
      updateRunState({ status: 'ready', mode: tab, fileName: result.filename, updatedAt: Date.now() });
      onNotice(`Đã liên kết ${result.filename} mà không sao chép file.`, 'success');
    } catch (error) {
      if (mediaRequestRef.current === requestId && !(error instanceof DOMException && error.name === 'AbortError')) onNotice(friendlyErrorMessage(error, 'Không thể mở file local.'), 'error');
    } finally {
      if (mediaRequestRef.current === requestId) { uploadControllerRef.current = undefined; setMediaAction('idle'); }
    }
  };

  const clearFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (asset?.url.startsWith('blob:')) URL.revokeObjectURL(asset.url);
    if (asset?.uploadId) void api.deleteUpload(asset.uploadId);
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = undefined;
    mediaRequestRef.current += 1;
    setMediaAction('idle');
    updateRunState({ status: 'idle' });
    setFile(undefined);
    setAsset(undefined);
    onAssetChange(undefined);
  };

  const run = async () => {
    if (!asset) { onNotice(tab === 'ocr' ? 'Hãy chọn video trước khi bắt đầu OCR.' : 'Hãy chọn video hoặc audio trước khi bắt đầu STT.', 'error'); return; }
    if (mediaAction !== 'idle' || !asset?.uploadId) { onNotice(pickingLocalFile ? 'Hãy chọn hoặc hủy hộp thoại file trước khi chạy.' : 'File vẫn đang được lưu trên máy. Hãy chờ upload hoàn tất rồi thử lại.', 'error'); return; }
    if (!provider) { onNotice(`Chưa có ${tab === 'ocr' ? 'Vision' : 'STT'} Provider trong Cài đặt.`, 'error'); return; }
    if (!provider.enabled) { onNotice(`Provider ${provider.name} đang bị tắt trong Cài đặt.`, 'error'); return; }
    if (!assignment.model) { onNotice(`Provider ${provider.name} đã chọn nhưng chưa có Model. Hãy chọn Model trong Cài đặt.`, 'error'); return; }
    const capability = tab === 'ocr' ? 'vision' : 'stt';
    if (!isCapabilityModelPassed(storage.modelPreferences(), provider.id, capability, assignment.model)) { onNotice(`Model ${assignment.model} chưa test ${capability.toUpperCase()} thành công. Hãy chọn model có trạng thái Chạy được trong Cài đặt.`, 'error'); return; }

    const controller = new AbortController();
    controllerRef.current = controller;
    clearProgressTimers();
    updateRunState({ status: 'running', mode: tab, fileName: asset.name, updatedAt: Date.now() });
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
          if (!translationProvider || !translationAssignment.model || !isCapabilityModelPassed(storage.modelPreferences(), translationProvider.id, 'translation', translationAssignment.model)) {
            onNotice('STT đã xong; auto-translation bị bỏ qua vì chưa chọn model Translation đã test thành công.', 'error');
          } else {
            setProgressStage('Đang lập translation bible cho nhân vật và thuật ngữ');
            easeProgressTo(88);
            let translationGuide = '';
            try {
              translationGuide = (await api.translationGuide(translationProvider, translationAssignment.model, result.cues, sourceLanguage, 'Tiếng Việt', 'Review phim', '', storage.glossary().filter((entry) => entry.enabled), controller.signal)).guide;
            } catch (error) {
              if (error instanceof DOMException && error.name === 'AbortError') throw error;
            }
            const translatedCues = result.cues.map((cue) => ({ ...cue }));
            const batchSize = 8;
            const totalBatches = Math.ceil(result.cues.length / batchSize);
            for (let start = 0; start < result.cues.length; start += batchSize) {
              const batch = result.cues.slice(start, start + batchSize);
              const batchNumber = Math.floor(start / batchSize) + 1;
              setProgressStage(`Đang dịch batch ${batchNumber}/${totalBatches} · cue ${start + 1}–${start + batch.length}`);
              const translated = await api.translate(translationProvider, translationAssignment.model, batch, sourceLanguage, 'Tiếng Việt', 'Review phim', '', storage.glossary().filter((entry) => entry.enabled), controller.signal, translatedCues, buildTranslationMemory(translatedCues, batch[0]?.id || '', 24), translationGuide);
              for (const item of translated.items) {
                const cue = translatedCues.find((candidate) => candidate.id === item.id);
                if (cue) cue.translatedText = item.translation;
              }
              setProgress(Math.min(90, 65 + ((start + batch.length) / Math.max(result.cues.length, 1)) * 25));
            }
            clearProgressTimers();
            nextCues = translatedCues;
            setProgress(90);
            setProgressStage('Đã dịch xong · đang lưu SubtitleCue[]');
          }
        }
        // Re-assert the server-backed asset together with the extraction result.
        // This prevents a transient File/blob asset from surviving navigation/HMR
        // without the uploadId required by dubbing and vocal separation.
        onAssetChange(asset);
        onCuesChange(nextCues);
        updateRunState({ status: 'completed', mode: tab, fileName: asset.name, cueCount: nextCues.length, updatedAt: Date.now() });
        onNotice(`Đã trích xuất ${nextCues.length} cue${autoTranslate ? ' và xử lý auto-translation.' : '.'}`, 'success');
      } else {
        const result = await api.extractOcr(asset.uploadId, provider, assignment.model, roi, samplingFps, filterWatermark, controller.signal, progressId);
        clearProgressTimers();
        setProgress(95);
        setProgressStage(`Đã nhận OCR · ${result.cues.length} cue, đang lưu kết quả`);
        onAssetChange(asset);
        onCuesChange(result.cues);
        updateRunState({ status: 'completed', mode: tab, fileName: asset.name, cueCount: result.cues.length, updatedAt: Date.now() });
        onNotice(`Đã OCR ${result.cues.length} cue.`, 'success');
      }
      setProgress(100);
      setProgressStage(tab === 'ocr' ? 'OCR hoàn tất' : 'Trích xuất hoàn tất');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        clearProgressTimers();
        setProgressStage('Đã hủy pipeline');
        updateRunState({ status: 'cancelled', mode: tab, fileName: asset.name, updatedAt: Date.now() });
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
        updateRunState({ status: 'failed', mode: tab, fileName: asset.name, updatedAt: Date.now() });
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
      <label className={`dropzone compact ${asset ? 'loaded' : ''}`}><input type="file" accept={tab === 'ocr' ? 'video/*' : 'video/*,audio/*'} onChange={(event) => { const next = event.currentTarget.files?.[0]; event.currentTarget.value = ''; selectFile(next); }} />{asset ? <><div className="file-icon">{tab === 'ocr' ? <FileVideo size={18} /> : <FileAudio size={18} />}</div><div><strong>{asset.name}</strong><small>{asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB · ` : ''}{asset.sourceMode === 'linked' ? 'Đọc trực tiếp, không sao chép · ' : ''}<button type="button" onClick={clearFile}>Thay file</button></small></div></> : <><div className="upload-icon"><Upload size={19} /></div><div><strong>{tab === 'ocr' ? 'Thả video vào đây' : 'Thả video hoặc audio vào đây'}</strong><small>{tab === 'ocr' ? '.mp4 · .mkv · .mov' : '.mp4 · .mp3 · .wav'}</small></div></>}</label>
      <div className="local-file-import"><button type="button" className={`button ghost ${pickingLocalFile ? 'active' : ''}`} disabled={working} onClick={() => void importLocalFile()}><FileVideo size={15} /> {pickingLocalFile ? 'Hủy chọn file' : 'Mở file lớn trên máy'}</button><small>{pickingLocalFile ? 'Hộp thoại chọn file đang mở phía trước ứng dụng.' : 'Không upload hoặc sao chép; nên dùng cho file lớn hơn 4 GiB.'}</small></div>
      {tab === 'ocr' && <div className="ocr-stage"><VideoPlayer asset={asset} cues={[]} style={defaultStyle} roi={roi} onRoiChange={setRoi} /><div className="roi-caption"><span><i /> OCR region</span><small>Mặc định: x=0%, y=75%, w=100%, h=25% · kéo khung hoặc các góc để chỉnh</small></div></div>}
      {tab === 'stt' && <div className="audio-callout"><div className="audio-callout-icon"><AudioLines size={20} /></div><div><strong>STT sẽ tách audio bằng FFmpeg</strong><p>Chỉ gửi audio đã tách tới endpoint /audio/transcriptions của Provider. Capability STT được kiểm tra trong Cài đặt.</p></div></div>}
    </div><div className="extract-config">
      <div className="section-title"><span>{tab === 'ocr' ? 'OCR CONFIGURATION' : 'STT CONFIGURATION'}</span><span className="local-pill">LOCAL PIPELINE</span></div>
      <div className="field"><span>Ngôn ngữ gốc</span><SelectField ariaLabel="Ngôn ngữ gốc" value={sourceLanguage} onChange={setSourceLanguage} options={[{ value: 'Auto Detect', label: 'Auto Detect' }, { value: 'vi', label: 'Tiếng Việt' }, { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'ko', label: '한국어' }]} /></div>
      <CapabilityAssignmentPicker capability={capability} assignments={configuredAssignments} providers={providers} value={assignment} onChange={(value) => setActiveAssignments((current) => ({ ...current, [capability]: value }))} />
      <TestedModelSelect provider={provider} capability={capability} value={assignment.model} onChange={(model) => setActiveAssignments((current) => ({ ...current, [capability]: { ...current[capability], model } }))} candidateModelIds={configuredAssignments.filter((item) => item.providerId === provider?.id).map((item) => item.model)} />
      <AssignmentSummary label={tab === 'ocr' ? 'Vision Provider đang dùng' : 'STT Provider đang dùng'} assignment={assignment} provider={provider} capability={capability} />
      {tab === 'ocr' ? <><div className="two-fields"><label className="field"><span>Sampling <b className="value-badge">{samplingFps} FPS</b></span><RangeInput min={1} max={4} step={1} value={samplingFps} onChange={(event) => setSamplingFps(Number(event.target.value))} /></label><div className="field"><span>ROI</span><div className="coordinate-readout">{roi.x.toFixed(0)}% × {roi.y.toFixed(0)}% · {roi.w.toFixed(0)}% × {roi.h.toFixed(0)}%</div></div></div><label className="toggle-row"><span>Lọc logo / watermark khỏi OCR</span><input type="checkbox" checked={filterWatermark} onChange={(event) => setFilterWatermark(event.target.checked)} /><i /></label></> : <label className="toggle-row"><span>Dịch tự động sau khi trích xuất</span><input type="checkbox" checked={autoTranslate} onChange={(event) => setAutoTranslate(event.target.checked)} /><i /></label>}
      {autoTranslate && tab === 'stt' && <><CapabilityAssignmentPicker capability="translation" assignments={capabilityAssignments(settings, 'translation')} providers={providers} value={translationAssignment} onChange={setTranslationAssignment} label="Translation Provider sau STT" /><TestedModelSelect provider={translationProvider} capability="translation" value={translationAssignment.model} onChange={(model) => setTranslationAssignment((current) => ({ ...current, model }))} candidateModelIds={capabilityAssignments(settings, 'translation').filter((item) => item.providerId === translationProvider?.id).map((item) => item.model)} label="Mô hình dịch sau STT" /><div className="auto-translation-note"><Languages size={15} /> Sau STT, app chỉ dùng model Translation đã test thành công và giữ timestamp của STT.</div></>}
      <button className="button primary large full" onClick={() => void run()} disabled={working || mediaAction !== 'idle'}><WandSparkles size={16} /> {pickingLocalFile ? 'Đang chọn file…' : uploading ? 'Đang lưu file…' : working ? 'Đang chạy pipeline…' : tab === 'ocr' ? 'Bắt đầu OCR' : 'Bắt đầu trích xuất'} <span>→</span></button>
      <div className={`extraction-status-badge ${currentStatus}`} role="status"><span className="extraction-status-dot" /><strong>{statusLabels[currentStatus]}</strong>{currentStatus === 'completed' && runState.cueCount !== undefined && <small>· {runState.cueCount} cue</small>}{currentStatus !== 'idle' && runState.updatedAt && <time>{new Date(runState.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div>
      <div className="pipeline-steps"><span className="done"><Check size={13} /> {tab === 'ocr' ? 'Crop ROI' : 'Tách audio'}</span><span>→</span><span>{tab === 'ocr' ? 'Frame change' : 'STT endpoint'}</span><span>→</span><span>SubtitleCue[]</span></div><button className="text-button full" onClick={onOpenEditor}>Mở Editor hiện tại →</button>
    </div></section>
    <ProgressModal open={working} title={tab === 'ocr' ? 'Đang OCR video' : 'Đang nhận dạng giọng nói'} message={progressStage} value={progress} onCancel={() => controllerRef.current?.abort()} />
  </div>;
}
