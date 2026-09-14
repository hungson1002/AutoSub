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
import { mapTranslationBatches, translationBatchSize, translationConcurrency } from '../lib/translationConfig';
import { mergeSmartExtractionCues } from '../lib/smartExtraction';

export function ExtractPage({ providers, settings, initialAsset, onCuesChange, onAssetChange, onOpenEditor, onNotice }: { providers: AIProvider[]; settings: AppSettings; initialAsset?: VideoAsset; onCuesChange: (cues: SubtitleCue[]) => void; onAssetChange: (asset?: VideoAsset) => void; onOpenEditor: () => void; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [tab, setTab] = useState<'ocr' | 'stt' | 'smart'>('ocr');
  const [file, setFile] = useState<File>();
  const [asset, setAsset] = useState<VideoAsset | undefined>(() => initialAsset || storage.asset());
  const [roi, setRoi] = useState({ x: 0, y: 75, w: 100, h: 25 });
  const [sourceLanguage, setSourceLanguage] = useState('Auto Detect');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [filterWatermark, setFilterWatermark] = useState(false);
  const [includeAllVisibleText, setIncludeAllVisibleText] = useState(false);
  const [samplingFps, setSamplingFps] = useState(4);
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
  const visionAssignment = activeAssignments.vision;
  const sttAssignment = activeAssignments.stt;
  const visionProvider = providers.find((item) => item.id === visionAssignment.providerId);
  const sttProvider = providers.find((item) => item.id === sttAssignment.providerId);
  const fullFrameOcr = roi.x <= 2 && roi.y <= 2 && roi.w >= 96 && roi.h >= 96;

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

  const pollExtractionProgress = async (progressId: string, controller: AbortController) => {
    const { signal } = controller;
    try {
      const status = await api.getExtractionProgress(progressId, signal);
      setProgress(status.percent);
      setProgressStage(status.stage);
      if (status.status === 'failed') {
        controller.abort(new Error(status.error || 'Tác vụ STT đã bị ngắt. Hãy chạy lại.'));
        return;
      }
      if (status.status === 'cancelled') {
        controller.abort();
        return;
      }
      if (status.status === 'running' && !signal.aborted) progressPollRef.current = window.setTimeout(() => void pollExtractionProgress(progressId, controller), 250);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError') && !signal.aborted) progressPollRef.current = window.setTimeout(() => void pollExtractionProgress(progressId, controller), 500);
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
      const result = await api.importLocalMedia(tab === 'stt' ? 'media' : 'video', uploadController.signal);
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
    if (!asset) { onNotice(tab === 'stt' ? 'Hãy chọn video hoặc audio trước khi bắt đầu STT.' : 'Hãy chọn video trước khi bắt đầu.', 'error'); return; }
    if (mediaAction !== 'idle' || !asset?.uploadId) { onNotice(pickingLocalFile ? 'Hãy chọn hoặc hủy hộp thoại file trước khi chạy.' : 'File vẫn đang được lưu trên máy. Hãy chờ upload hoàn tất rồi thử lại.', 'error'); return; }
    if (tab === 'smart') {
      if (!visionProvider || !sttProvider) { onNotice('Chế độ Thông minh cần cả Vision Provider và STT Provider.', 'error'); return; }
      if (!visionProvider.enabled || !sttProvider.enabled) { onNotice('Vision Provider hoặc STT Provider đang bị tắt.', 'error'); return; }
      if (!visionAssignment.model || !sttAssignment.model) { onNotice('Hãy chọn đủ model Vision và STT.', 'error'); return; }
      if (!isCapabilityModelPassed(storage.modelPreferences(), visionProvider.id, 'vision', visionAssignment.model) || !isCapabilityModelPassed(storage.modelPreferences(), sttProvider.id, 'stt', sttAssignment.model)) { onNotice('Model Vision và STT phải được test thành công trước khi chạy.', 'error'); return; }
    }
    if (tab !== 'smart' && !provider) { onNotice(`Chưa có ${tab === 'ocr' ? 'Vision' : 'STT'} Provider trong Cài đặt.`, 'error'); return; }
    if (tab === 'smart') {
      const controller = new AbortController();
      controllerRef.current = controller;
      clearProgressTimers();
      updateRunState({ status: 'running', mode: tab, fileName: asset.name, updatedAt: Date.now() });
      setWorking(true); setProgress(8); setProgressStage('Đang nhận dạng lời nói từ audio');
      try {
        const sttResult = await api.extractStt(asset.uploadId, sttProvider!, sttAssignment.model, sourceLanguage, controller.signal, crypto.randomUUID());
        setProgress(42); setProgressStage(`STT xong · ${sttResult.cues.length} cue · đang quét chữ trên hình`);
        const ocrResult = await api.extractOcr(asset.uploadId, visionProvider!, visionAssignment.model, roi, samplingFps, filterWatermark, controller.signal, crypto.randomUUID(), sourceLanguage, includeAllVisibleText ? 'all' : 'subtitles');
        let nextCues = mergeSmartExtractionCues(sttResult.cues, ocrResult.cues);
        setProgress(70); setProgressStage(`Đã hợp nhất ${nextCues.length} cue không trùng`);
        if (autoTranslate) {
          if (!translationProvider || !translationAssignment.model || !isCapabilityModelPassed(storage.modelPreferences(), translationProvider.id, 'translation', translationAssignment.model)) throw new Error('Chưa chọn model Translation đã test thành công.');
          const translatable = nextCues.filter((cue) => cue.sourceKind !== 'onscreen-text');
          if (translatable.length) {
            let guide = '';
            try { guide = (await api.translationGuide(translationProvider, translationAssignment.model, translatable, sourceLanguage, 'Tiếng Việt', 'Review phim', '', storage.glossary().filter((entry) => entry.enabled), controller.signal)).guide; } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; }
            const batches = Array.from({ length: Math.ceil(translatable.length / translationBatchSize('quality')) }, (_, index) => translatable.slice(index * translationBatchSize('quality'), (index + 1) * translationBatchSize('quality')));
            const translations = new Map<string, string>();
            await mapTranslationBatches(batches, translationConcurrency('quality'), async (batch, batchIndex) => {
              setProgressStage(`Đang dịch · batch ${batchIndex + 1}/${batches.length}`);
              const translated = await api.translate(translationProvider, translationAssignment.model, batch, sourceLanguage, 'Tiếng Việt', 'Review phim', '', storage.glossary().filter((entry) => entry.enabled), controller.signal, nextCues, buildTranslationMemory(nextCues, batch[0]?.id || '', 24), guide);
              for (const item of translated.items) translations.set(item.id, item.translation);
            });
            nextCues = nextCues.map((cue) => ({ ...cue, translatedText: translations.get(cue.id) ?? cue.translatedText }));
          }
        }
        onAssetChange(asset); onCuesChange(nextCues);
        updateRunState({ status: 'completed', mode: tab, fileName: asset.name, cueCount: nextCues.length, updatedAt: Date.now() });
        setProgress(100); setProgressStage('Chuyển ngữ thông minh hoàn tất');
        onNotice(`Đã hợp nhất STT + OCR thành ${nextCues.length} cue${autoTranslate ? ' và dịch xong' : ''}.`, 'success');
        setTimeout(onOpenEditor, 450);
      } catch (error) {
        const cancelled = error instanceof DOMException && error.name === 'AbortError';
        updateRunState({ status: cancelled ? 'cancelled' : 'failed', mode: tab, fileName: asset.name, updatedAt: Date.now() });
        onNotice(cancelled ? 'Đã hủy pipeline.' : friendlyErrorMessage(error, 'Pipeline thông minh thất bại.'), cancelled ? 'success' : 'error');
      } finally { controllerRef.current = undefined; setTimeout(() => setWorking(false), 450); }
      return;
    }
    if (!provider) return;
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
    const progressId = crypto.randomUUID();
    let openEditorWhenDone = false;
    try {
      if (tab === 'stt') {
        const extraction = api.extractStt(asset.uploadId, provider, assignment.model, sourceLanguage, controller.signal, progressId);
        progressPollRef.current = window.setTimeout(() => void pollExtractionProgress(progressId, controller), 300);
        const result = await extraction;
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
            const batchSize = translationBatchSize('quality');
            const totalBatches = Math.ceil(result.cues.length / batchSize);
            const batches = Array.from({ length: totalBatches }, (_, index) => result.cues.slice(index * batchSize, (index + 1) * batchSize));
            let translatedCount = 0;
            await mapTranslationBatches(batches, translationConcurrency('quality'), async (batch, batchIndex) => {
              setProgressStage(`Đang dịch song song · batch ${batchIndex + 1}/${totalBatches}`);
              const translated = await api.translate(translationProvider, translationAssignment.model, batch, sourceLanguage, 'Tiếng Việt', 'Review phim', '', storage.glossary().filter((entry) => entry.enabled), controller.signal, translatedCues, buildTranslationMemory(translatedCues, batch[0]?.id || '', 24), translationGuide);
              for (const item of translated.items) {
                const cue = translatedCues.find((candidate) => candidate.id === item.id);
                if (cue) cue.translatedText = item.translation;
              }
              translatedCount += batch.length;
              setProgress(Math.min(90, 65 + (translatedCount / Math.max(result.cues.length, 1)) * 25));
            });
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
        const extraction = api.extractOcr(asset.uploadId, provider, assignment.model, roi, samplingFps, filterWatermark, controller.signal, progressId, sourceLanguage, includeAllVisibleText ? 'all' : 'subtitles');
        progressPollRef.current = window.setTimeout(() => void pollExtractionProgress(progressId, controller), 300);
        const result = await extraction;
        clearProgressTimers();
        setProgress(95);
        setProgressStage(`Đã nhận OCR · ${result.cues.length} cue, đang lưu kết quả`);
        onAssetChange(asset);
        onCuesChange(result.cues);
        openEditorWhenDone = result.cues.length > 0;
        updateRunState({ status: 'completed', mode: tab, fileName: asset.name, cueCount: result.cues.length, updatedAt: Date.now() });
        onNotice(`Đã OCR ${result.cues.length} cue vào Bản gốc. Đang mở timeline để bạn chỉnh thời gian.`, 'success');
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
      setTimeout(() => {
        setWorking(false);
        if (openEditorWhenDone) onOpenEditor();
      }, 450);
    }
  };

  const currentStatus: ExtractionRunStatus = runState.mode && runState.mode !== tab ? 'idle' : runState.status;
  const statusLabels: Record<ExtractionRunStatus, string> = { idle: 'Chưa chạy', uploading: 'Đang tải file', ready: 'Sẵn sàng trích xuất', running: 'Đang xử lý', completed: 'Đã hoàn thành', failed: 'Thất bại', cancelled: 'Đã hủy' };

  return <div className="page extract-page">
    <header className="page-header"><div><div className="eyebrow">EXTRACTION LAB / 03</div><h1>Trích xuất <span>phụ đề</span></h1><p>Đưa video hoặc âm thanh vào, lấy ra một SubtitleCue[] sạch để chỉnh sửa tiếp.</p></div></header>
    <div className="tab-bar"><button className={tab === 'smart' ? 'active' : ''} onClick={() => setTab('smart')}><WandSparkles size={16} /> Thông minh</button><button className={tab === 'ocr' ? 'active' : ''} onClick={() => setTab('ocr')}><Video size={16} /> OCR (Video)</button><button className={tab === 'stt' ? 'active' : ''} onClick={() => setTab('stt')}><AudioLines size={16} /> Trích xuất từ âm thanh</button></div>
    <section className="extract-grid"><div className="extract-left">
      <label className={`dropzone compact ${asset ? 'loaded' : ''}`}><input type="file" accept={tab === 'stt' ? 'video/*,audio/*' : 'video/*'} onChange={(event) => { const next = event.currentTarget.files?.[0]; event.currentTarget.value = ''; selectFile(next); }} />{asset ? <><div className="file-icon">{tab === 'stt' ? <FileAudio size={18} /> : <FileVideo size={18} />}</div><div><strong>{asset.name}</strong><small>{asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB · ` : ''}{asset.sourceMode === 'linked' ? 'Đọc trực tiếp, không sao chép · ' : ''}<button type="button" onClick={clearFile}>Thay file</button></small></div></> : <><div className="upload-icon"><Upload size={19} /></div><div><strong>{tab === 'stt' ? 'Thả video hoặc audio vào đây' : 'Thả video vào đây'}</strong><small>{tab === 'stt' ? '.mp4 · .mp3 · .wav' : '.mp4 · .mkv · .mov'}</small></div></>}</label>
      <div className="local-file-import"><button type="button" className={`button ghost ${pickingLocalFile ? 'active' : ''}`} disabled={working} onClick={() => void importLocalFile()}><FileVideo size={15} /> {pickingLocalFile ? 'Hủy chọn file' : 'Mở file lớn trên máy'}</button><small>{pickingLocalFile ? 'Hộp thoại chọn file đang mở phía trước ứng dụng.' : 'Không upload hoặc sao chép; nên dùng cho file lớn hơn 4 GiB.'}</small></div>
      {tab !== 'stt' && <div className="ocr-stage"><VideoPlayer asset={asset} cues={[]} style={defaultStyle} roi={roi} onRoiChange={setRoi} showMediaTimeline={false} /><div className="roi-caption"><span><i /> {tab === 'smart' ? 'STT + OCR cùng một video' : fullFrameOcr ? 'OCR toàn màn hình' : 'OCR vùng chọn'}</span><small>{includeAllVisibleText ? 'Lấy tất cả chữ trong vùng quét' : 'Chỉ lấy nội dung được nhận diện là phụ đề'}</small></div></div>}
      {tab === 'stt' && <div className="audio-callout"><div className="audio-callout-icon"><AudioLines size={20} /></div><div><strong>STT sẽ tách audio bằng FFmpeg</strong><p>Chỉ gửi audio đã tách tới endpoint /audio/transcriptions của Provider. Capability STT được kiểm tra trong Cài đặt.</p></div></div>}
    </div><div className="extract-config">
      <div className="section-title"><span>{tab === 'smart' ? 'SMART TRANSLATION' : tab === 'ocr' ? 'OCR CONFIGURATION' : 'STT CONFIGURATION'}</span><span className="local-pill">LOCAL PIPELINE</span></div>
      <div className="field"><span>Ngôn ngữ gốc</span><SelectField ariaLabel="Ngôn ngữ gốc" value={sourceLanguage} onChange={setSourceLanguage} options={[{ value: 'Auto Detect', label: 'Auto Detect' }, { value: 'vi', label: 'Tiếng Việt' }, { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'ko', label: '한국어' }]} /></div>
      {tab === 'smart' ? <div className="smart-provider-stack"><div><CapabilityAssignmentPicker capability="stt" assignments={capabilityAssignments(settings, 'stt')} providers={providers} value={sttAssignment} onChange={(value) => setActiveAssignments((current) => ({ ...current, stt: value }))} label="1 · Nhận lời nói" /><TestedModelSelect provider={sttProvider} capability="stt" value={sttAssignment.model} onChange={(model) => setActiveAssignments((current) => ({ ...current, stt: { ...current.stt, model } }))} candidateModelIds={capabilityAssignments(settings, 'stt').filter((item) => item.providerId === sttProvider?.id).map((item) => item.model)} /></div><div><CapabilityAssignmentPicker capability="vision" assignments={capabilityAssignments(settings, 'vision')} providers={providers} value={visionAssignment} onChange={(value) => setActiveAssignments((current) => ({ ...current, vision: value }))} label="2 · Đọc chữ trên hình" /><TestedModelSelect provider={visionProvider} capability="vision" value={visionAssignment.model} onChange={(model) => setActiveAssignments((current) => ({ ...current, vision: { ...current.vision, model } }))} candidateModelIds={capabilityAssignments(settings, 'vision').filter((item) => item.providerId === visionProvider?.id).map((item) => item.model)} /></div></div> : <><CapabilityAssignmentPicker capability={capability} assignments={configuredAssignments} providers={providers} value={assignment} onChange={(value) => setActiveAssignments((current) => ({ ...current, [capability]: value }))} /><TestedModelSelect provider={provider} capability={capability} value={assignment.model} onChange={(model) => setActiveAssignments((current) => ({ ...current, [capability]: { ...current[capability], model } }))} candidateModelIds={configuredAssignments.filter((item) => item.providerId === provider?.id).map((item) => item.model)} /><AssignmentSummary label={tab === 'ocr' ? 'Vision Provider đang dùng' : 'STT Provider đang dùng'} assignment={assignment} provider={provider} capability={capability} /></>}
      {tab !== 'stt' ? <><div className="field"><span>Phạm vi nhận chữ</span><div className="segmented"><button type="button" className={!fullFrameOcr ? 'active' : ''} onClick={() => setRoi({ x: 0, y: 75, w: 100, h: 25 })}>Vùng phụ đề</button><button type="button" className={fullFrameOcr ? 'active' : ''} onClick={() => setRoi({ x: 0, y: 0, w: 100, h: 100 })}>Toàn màn hình</button></div></div><label className="toggle-row"><span>{includeAllVisibleText ? 'Tất cả chữ trong vùng quét' : 'Chỉ lấy phụ đề'}</span><input type="checkbox" checked={includeAllVisibleText} onChange={(event) => setIncludeAllVisibleText(event.target.checked)} aria-label="Chuyển giữa chỉ phụ đề và tất cả chữ" /><i /></label><div className="two-fields"><label className="field"><span>Sampling <b className="value-badge">{samplingFps} FPS</b></span><RangeInput min={1} max={4} step={1} value={samplingFps} onChange={(event) => setSamplingFps(Number(event.target.value))} /></label><div className="field"><span>ROI</span><div className="coordinate-readout">{roi.x.toFixed(0)}% × {roi.y.toFixed(0)}% · {roi.w.toFixed(0)}% × {roi.h.toFixed(0)}%</div></div></div><label className="toggle-row"><span>Lọc logo / watermark khỏi OCR</span><input type="checkbox" checked={filterWatermark} onChange={(event) => setFilterWatermark(event.target.checked)} /><i /></label></> : null}
      {tab !== 'ocr' && <label className="toggle-row"><span>Dịch tự động sau khi trích xuất</span><input type="checkbox" checked={autoTranslate} onChange={(event) => setAutoTranslate(event.target.checked)} /><i /></label>}
      {autoTranslate && tab !== 'ocr' && <><CapabilityAssignmentPicker capability="translation" assignments={capabilityAssignments(settings, 'translation')} providers={providers} value={translationAssignment} onChange={setTranslationAssignment} label="3 · Dịch phụ đề" /><TestedModelSelect provider={translationProvider} capability="translation" value={translationAssignment.model} onChange={(model) => setTranslationAssignment((current) => ({ ...current, model }))} candidateModelIds={capabilityAssignments(settings, 'translation').filter((item) => item.providerId === translationProvider?.id).map((item) => item.model)} label="Mô hình dịch" /><div className="auto-translation-note"><Languages size={15} /> Giữ timestamp STT, loại OCR trùng và không đưa logo/chữ cảnh vào lồng tiếng.</div></>}
      <button className="button primary large full" onClick={() => void run()} disabled={working || mediaAction !== 'idle'}><WandSparkles size={16} /> {pickingLocalFile ? 'Đang chọn file…' : uploading ? 'Đang lưu file…' : working ? 'Đang chạy pipeline…' : tab === 'smart' ? 'Chuyển ngữ thông minh' : tab === 'ocr' ? 'Bắt đầu OCR' : 'Bắt đầu trích xuất'} <span>→</span></button>
      <div className={`extraction-status-badge ${currentStatus}`} role="status"><span className="extraction-status-dot" /><strong>{statusLabels[currentStatus]}</strong>{currentStatus === 'completed' && runState.cueCount !== undefined && <small>· {runState.cueCount} cue</small>}{currentStatus !== 'idle' && runState.updatedAt && <time>{new Date(runState.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div>
      <div className="pipeline-steps"><span className="done"><Check size={13} /> {tab === 'smart' ? 'STT' : tab === 'ocr' ? 'Crop ROI' : 'Tách audio'}</span><span>→</span><span>{tab === 'smart' ? 'OCR + hợp nhất' : tab === 'ocr' ? 'Frame change' : 'STT endpoint'}</span><span>→</span><span>SubtitleCue[]</span></div><button className="text-button full" onClick={onOpenEditor}>Mở Editor hiện tại →</button>
    </div></section>
    <ProgressModal open={working} title={tab === 'smart' ? 'Đang chuyển ngữ thông minh' : tab === 'ocr' ? 'Đang OCR video' : 'Đang nhận dạng giọng nói'} message={progressStage} value={progress} onCancel={() => controllerRef.current?.abort()} />
  </div>;
}
