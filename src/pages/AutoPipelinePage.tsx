import { useEffect, useRef, useState } from 'react';
import type { AIProvider, AppSettings, ProviderAssignment, SubtitleCue, VideoAsset } from '../types';
import { api, buildTranslationMemory, friendlyErrorMessage, MAX_BROWSER_UPLOAD_BYTES } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import { parseSubtitle } from '../lib/subtitles';
import { storage } from '../lib/storage';
import { translationBatchSize } from '../lib/translationConfig';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { TestedModelSelect } from '../components/TestedModelSelect';
import { SelectField } from '../components/SelectField';
import { Check, FileVideo, LoaderCircle, Upload, WandSparkles, X } from '../components/Icons';

type StepKey = 'extract' | 'translate' | 'dub' | 'export';
type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
const stepLabels: Record<StepKey, string> = { extract: 'Trích xuất STT', translate: 'Dịch phụ đề', dub: 'Lồng tiếng', export: 'Xuất video' };
const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

export function AutoPipelinePage({ providers, settings, cues, asset, onCuesChange, onAssetChange, onOpenEditor, onNotice }: {
  providers: AIProvider[]; settings: AppSettings; cues: SubtitleCue[]; asset?: VideoAsset;
  onCuesChange: (cues: SubtitleCue[]) => void; onAssetChange: (asset?: VideoAsset) => void;
  onOpenEditor: () => void; onNotice: (message: string, kind?: 'success' | 'error') => void;
}) {
  const [steps, setSteps] = useState<Record<StepKey, boolean>>({ extract: true, translate: true, dub: true, export: true });
  const [stt, setStt] = useState<ProviderAssignment>(settings.assignments.stt);
  const [translation, setTranslation] = useState<ProviderAssignment>(settings.assignments.translation);
  const [tts, setTts] = useState<ProviderAssignment>(settings.assignments.tts);
  const [voice, setVoice] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('Auto Detect');
  const [targetLanguage, setTargetLanguage] = useState('Tiếng Việt');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [activeStep, setActiveStep] = useState<StepKey>();
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Chọn nguyên liệu và cấu hình pipeline.');
  const [voices, setVoices] = useState<NonNullable<AIProvider['voices']>>([]);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const sttProvider = providers.find((item) => item.id === stt.providerId);
  const translationProvider = providers.find((item) => item.id === translation.providerId);
  const ttsProvider = providers.find((item) => item.id === tts.providerId);
  useEffect(() => {
    if (!ttsProvider || !steps.dub) { setVoices([]); return; }
    const controller = new AbortController();
    setVoices(ttsProvider.voices || []);
    void api.listVoices(ttsProvider, controller.signal).then((result) => setVoices(result.voices)).catch(() => undefined);
    return () => controller.abort();
  }, [ttsProvider?.id, tts.model, steps.dub]);

  const toggleStep = (key: StepKey) => setSteps((current) => ({ ...current, [key]: !current[key] }));
  const selectVideo = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_BROWSER_UPLOAD_BYTES) { onNotice('File lớn hơn 4 GiB; hãy nạp qua trang Trích xuất trước.', 'error'); return; }
    setMessage(`Đang lưu ${file.name}…`);
    try {
      const stored = await api.uploadMedia(file);
      const next: VideoAsset = { name: file.name, file, url: URL.createObjectURL(file), type: file.type, size: stored.size, uploadId: stored.uploadId, storedPath: stored.storedPath, path: stored.storedPath, sourceMode: stored.sourceMode || 'copied' };
      onAssetChange(next); onNotice('Đã nạp video cho pipeline.', 'success'); setMessage('Nguyên liệu đã sẵn sàng.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể nạp video.'), 'error'); }
  };
  const selectSubtitle = async (file?: File) => {
    if (!file) return;
    const parsed = parseSubtitle(await file.text(), file.name);
    if (!parsed.length) { onNotice('Không đọc được cue từ file subtitle.', 'error'); return; }
    onCuesChange(parsed); setSteps((current) => ({ ...current, extract: false }));
    onNotice(`Đã nạp ${parsed.length} cue và bỏ qua bước trích xuất.`, 'success');
  };

  const requireProvider = (assignment: ProviderAssignment, provider: AIProvider | undefined, label: string) => {
    if (!provider || !assignment.model) throw new Error(`Chưa chọn đầy đủ provider/model ${label}.`);
    if (!provider.enabled) throw new Error(`Provider ${provider.name} đang bị tắt.`);
    return provider;
  };
  const setStage = (step: StepKey, percent: number, text: string) => { setActiveStep(step); setProgress(percent); setMessage(text); };

  const run = async () => {
    if (!Object.values(steps).some(Boolean)) { onNotice('Hãy bật ít nhất một bước.', 'error'); return; }
    const controller = new AbortController(); controllerRef.current = controller;
    setStatus('running'); setProgress(2);
    try {
      let nextCues = cues.map((cue) => ({ ...cue }));
      if (steps.extract) {
        if (!asset?.uploadId) throw new Error('Bước trích xuất cần video/audio đã nạp.');
        const provider = requireProvider(stt, sttProvider, 'STT');
        setStage('extract', 10, 'Đang tách audio và nhận dạng giọng nói…');
        nextCues = (await api.extractStt(asset.uploadId, provider, stt.model, sourceLanguage, controller.signal, crypto.randomUUID())).cues;
        onCuesChange(nextCues); setProgress(30);
      } else if (!nextCues.length && (steps.translate || steps.dub || steps.export)) throw new Error('Đã bỏ trích xuất nhưng chưa có subtitle/cue làm nguyên liệu.');

      if (steps.translate) {
        const provider = requireProvider(translation, translationProvider, 'dịch');
        setStage('translate', 35, 'Đang tạo hướng dẫn dịch nhất quán…');
        let guide = '';
        try { guide = (await api.translationGuide(provider, translation.model, nextCues, sourceLanguage, targetLanguage, 'Tự nhiên, phù hợp lồng tiếng', '', storage.glossary().filter((item) => item.enabled), controller.signal)).guide; } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; }
        const batchSize = translationBatchSize('quality');
        for (let start = 0; start < nextCues.length; start += batchSize) {
          const batch = nextCues.slice(start, start + batchSize);
          setMessage(`Đang dịch cue ${start + 1}–${start + batch.length}/${nextCues.length}…`);
          const result = await api.translate(provider, translation.model, batch, sourceLanguage, targetLanguage, 'Tự nhiên, phù hợp lồng tiếng', '', storage.glossary().filter((item) => item.enabled), controller.signal, nextCues, buildTranslationMemory(nextCues, batch[0]?.id || '', 24), guide);
          for (const item of result.items) { const cue = nextCues.find((candidate) => candidate.id === item.id); if (cue) cue.translatedText = item.translation; }
          setProgress(35 + ((start + batch.length) / Math.max(nextCues.length, 1)) * 25);
        }
        onCuesChange(nextCues);
      }

      let dubbingJobId: string | undefined;
      if (steps.dub) {
        const provider = requireProvider(tts, ttsProvider, 'TTS');
        if (!voice) throw new Error('Chưa chọn giọng lồng tiếng.');
        setStage('dub', 62, 'Đang tạo dubbing job…');
        const enabled = nextCues.filter((cue) => cue.enabled);
        const entries = enabled.map((cue, index) => ({ id: cue.id, index: cue.index, startMs: cue.startMs, endMs: cue.endMs, originalText: cue.originalText, translatedText: cue.translatedText, text: cue.translatedText || cue.originalText, previousText: enabled[index - 1]?.translatedText || enabled[index - 1]?.originalText || '', nextText: enabled[index + 1]?.translatedText || enabled[index + 1]?.originalText || '', provider, model: tts.model, voice, speed: 1, volume: 1 }));
        const created = await api.createDubbingJob(entries, { videoId: asset?.uploadId, timingMode: 'strict', batchSize: 30, ttsConcurrency: 3, llmConcurrency: 2, maxRetries: 3, audioMix: { mode: 'background', keepOriginal: true, originalVolume: .18 } }, controller.signal);
        dubbingJobId = created.jobId; if (asset?.uploadId) storage.saveDubbingJob(asset.uploadId, dubbingJobId);
        await api.startDubbingJob(dubbingJobId, controller.signal);
        for (;;) {
          await delay(1200, controller.signal);
          const job = await api.getDubbingJobStatus(dubbingJobId, controller.signal);
          setProgress(62 + job.progressPercent * .25); setMessage(`Đang lồng tiếng ${job.doneCues}/${job.totalCues} cue…`);
          if (job.status === 'completed') break;
          if (job.status === 'completed_with_errors') throw new Error(`Lồng tiếng lỗi ${job.failedCues}/${job.totalCues} cue. Mở Editor để xử lý.`);
          if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.warnings.join(' ') || 'Dubbing job không hoàn thành.');
        }
      }

      if (steps.export) {
        if (!asset?.uploadId) throw new Error('Bước xuất video cần video nguồn.');
        if (steps.dub && !dubbingJobId) throw new Error('Chưa có dubbing job để xuất.');
        setStage('export', 90, 'Đang render video cuối…');
        const blob = await api.exportVideo(asset.file, nextCues, settings.subtitleStyle, { exportId: crypto.randomUUID(), uploadId: asset.uploadId, resolution: 'original', crf: 20, keepAudio: true, originalVolume: steps.dub ? .18 : 1, burnSubtitles: true, separateVocals: false, dubbingJobId }, controller.signal);
        saveBlob(`autosub-${asset.name.replace(/\.[^.]+$/, '')}.mp4`, blob);
      }
      setActiveStep(undefined); setProgress(100); setStatus('completed'); setMessage('Pipeline đã hoàn thành.');
      onNotice('Pipeline 1 chạm đã hoàn thành.', 'success');
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      setStatus(cancelled ? 'cancelled' : 'failed'); setMessage(cancelled ? 'Đã hủy pipeline.' : friendlyErrorMessage(error, 'Pipeline thất bại.'));
      onNotice(cancelled ? 'Đã hủy pipeline.' : friendlyErrorMessage(error, 'Pipeline thất bại.'), cancelled ? 'success' : 'error');
    } finally { controllerRef.current = undefined; }
  };

  return <div className="page auto-pipeline-page">
    <header className="page-header"><div><div className="eyebrow">ONE-CLICK WORKFLOW</div><h1>Pipeline <span>1 chạm</span></h1><p>Chọn công nghệ một lần, sau đó chạy tuần tự từ nguyên liệu đến video hoàn chỉnh.</p></div><div className={`pipeline-run-badge ${status}`}>{status === 'running' ? <LoaderCircle className="spin" size={16} /> : status === 'completed' ? <Check size={16} /> : status === 'failed' ? <X size={16} /> : <WandSparkles size={16} />}<span>{message}</span></div></header>
    <div className="auto-pipeline-grid"><section className="pipeline-panel"><div className="section-title"><span>1 · NGUYÊN LIỆU</span></div><div className="pipeline-materials"><label className="button ghost"><FileVideo size={15} /> Nạp video/audio<input hidden type="file" accept="video/*,audio/*" onChange={(event) => { void selectVideo(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label><label className="button ghost"><Upload size={15} /> Nạp SRT/VTT có sẵn<input hidden type="file" accept=".srt,.vtt,text/vtt" onChange={(event) => { void selectSubtitle(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label></div><div className="pipeline-source-summary"><strong>{asset?.name || 'Chưa có video/audio'}</strong><small>{cues.length ? `${cues.length} cue đang có` : 'Chưa có subtitle'}</small></div></section>
      <section className="pipeline-panel"><div className="section-title"><span>2 · CÁC BƯỚC SẼ CHẠY</span></div><div className="pipeline-step-list">{(Object.keys(stepLabels) as StepKey[]).map((key, index) => <label className={`pipeline-step-card ${steps[key] ? 'enabled' : 'skipped'} ${activeStep === key ? 'active' : ''}`} key={key}><b>{index + 1}</b><span><strong>{stepLabels[key]}</strong><small>{steps[key] ? 'Sẽ chạy tự động' : 'Bỏ qua bước này'}</small></span><input type="checkbox" checked={steps[key]} onChange={() => toggleStep(key)} /><i /></label>)}</div></section>
      <section className="pipeline-panel pipeline-tech"><div className="section-title"><span>3 · CÔNG NGHỆ / MODEL / GIỌNG</span></div>{steps.extract && <><div className="two-fields"><label className="field"><span>Ngôn ngữ nguồn</span><SelectField ariaLabel="Ngôn ngữ nguồn" value={sourceLanguage} onChange={setSourceLanguage} options={[{ value: 'Auto Detect', label: 'Auto Detect' }, { value: 'vi', label: 'Tiếng Việt' }, { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'ko', label: '한국어' }]} /></label></div><CapabilityAssignmentPicker capability="stt" assignments={capabilityAssignments(settings, 'stt')} providers={providers} value={stt} onChange={setStt} /><TestedModelSelect provider={sttProvider} capability="stt" value={stt.model} onChange={(model) => setStt((current) => ({ ...current, model }))} /></>}{steps.translate && <><label className="field"><span>Ngôn ngữ đích</span><input value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} /></label><CapabilityAssignmentPicker capability="translation" assignments={capabilityAssignments(settings, 'translation')} providers={providers} value={translation} onChange={setTranslation} /><TestedModelSelect provider={translationProvider} capability="translation" value={translation.model} onChange={(model) => setTranslation((current) => ({ ...current, model }))} /></>}{steps.dub && <><CapabilityAssignmentPicker capability="tts" assignments={capabilityAssignments(settings, 'tts')} providers={providers} value={tts} onChange={(value) => { setTts(value); setVoice(''); }} /><TestedModelSelect provider={ttsProvider} capability="tts" value={tts.model} onChange={(model) => setTts((current) => ({ ...current, model }))} /><label className="field"><span>Giọng lồng tiếng</span>{voices.length ? <SelectField ariaLabel="Giọng lồng tiếng" value={voice} onChange={setVoice} options={[{ value: '', label: 'Chọn giọng…' }, ...voices.map((item) => ({ value: item.id, label: item.name || item.id, description: item.language }))]} /> : <input value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="Voice ID" />}</label></>}</section>
    </div><section className="pipeline-launch"><div><div className="progress-copy"><span>{message}</span><strong>{Math.round(progress)}%</strong></div><div className="progress-track"><div style={{ width: `${progress}%` }} /></div></div><button className="button primary large" disabled={status === 'running'} onClick={() => void run()}><WandSparkles size={16} /> {status === 'running' ? 'Đang chạy tuần tự…' : 'Chạy toàn bộ pipeline'}</button>{status === 'running' ? <button className="button ghost" onClick={() => controllerRef.current?.abort()}>Hủy</button> : cues.length > 0 && <button className="button ghost" onClick={onOpenEditor}>Mở Editor</button>}</section>
  </div>;
}
