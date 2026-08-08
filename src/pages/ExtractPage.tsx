import { useRef, useState } from 'react';
import type { AIProvider, AppSettings, SubtitleCue, VideoAsset } from '../types';
import { defaultStyle } from '../types';
import { api } from '../lib/api';
import { storage } from '../lib/storage';
import { AudioLines, Check, FileAudio, FileVideo, Languages, Upload, Video, WandSparkles } from '../components/Icons';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { ProgressModal } from '../components/ProgressModal';
import { VideoPlayer } from '../editor/VideoPlayer';
import { SelectField } from '../components/SelectField';

export function ExtractPage({ providers, settings, onCuesChange, onAssetChange, onOpenEditor, onNotice }: { providers: AIProvider[]; settings: AppSettings; onCuesChange: (cues: SubtitleCue[]) => void; onAssetChange: (asset?: VideoAsset) => void; onOpenEditor: () => void; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [tab, setTab] = useState<'ocr' | 'stt'>('ocr');
  const [file, setFile] = useState<File>();
  const [asset, setAsset] = useState<VideoAsset>();
  const [roi, setRoi] = useState({ x: 18, y: 70, w: 64, h: 16 });
  const [sourceLanguage, setSourceLanguage] = useState('Auto Detect');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [filterWatermark, setFilterWatermark] = useState(false);
  const [samplingFps, setSamplingFps] = useState(2);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const assignment = tab === 'ocr' ? settings.assignments.vision : settings.assignments.stt;
  const provider = providers.find((item) => item.id === assignment.providerId);

  const selectFile = (next?: File) => {
    if (!next) return;
    setFile(next);
    const nextAsset: VideoAsset = { name: next.name, file: next, url: URL.createObjectURL(next), type: next.type };
    setAsset(nextAsset);
    onAssetChange(nextAsset);
  };

  const clearFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setFile(undefined);
    setAsset(undefined);
    onAssetChange(undefined);
  };

  const run = async () => {
    if (!file) { onNotice(tab === 'ocr' ? 'Hãy chọn video trước khi bắt đầu OCR.' : 'Hãy chọn video hoặc audio trước khi bắt đầu STT.', 'error'); return; }
    if (!provider) { onNotice(`Chưa có ${tab === 'ocr' ? 'Vision' : 'STT'} Provider trong Cài đặt.`, 'error'); return; }
    if (!provider.enabled) { onNotice(`Provider ${provider.name} đang bị tắt trong Cài đặt.`, 'error'); return; }
    if (!assignment.model) { onNotice(`Provider ${provider.name} đã chọn nhưng chưa có Model. Hãy chọn Model trong Cài đặt.`, 'error'); return; }
    const capability = tab === 'ocr' ? 'vision' : 'stt';
    const tested = storage.modelPreferences()[`${provider.id}::${capability}::${assignment.model}`];
    if (tested?.status === 'failed') { onNotice(`Model ${assignment.model} không hỗ trợ ${capability.toUpperCase()}. Hãy chọn model có trạng thái Chạy được trong Cài đặt.`, 'error'); return; }

    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setProgress(10);
    try {
      if (tab === 'stt') {
        const result = await api.extractStt(file, provider, assignment.model, sourceLanguage, controller.signal);
        setProgress(65);
        let nextCues = result.cues;
        if (autoTranslate) {
          const translationAssignment = settings.assignments.translation;
          const translationProvider = providers.find((item) => item.id === translationAssignment.providerId);
          if (!translationProvider || !translationAssignment.model) {
            onNotice('STT đã xong; auto-translation bị bỏ qua vì chưa có Translation Provider + Model.', 'error');
          } else {
            const translated = await api.translate(translationProvider, translationAssignment.model, result.cues, sourceLanguage, 'Tiếng Việt', 'Tự nhiên', '', storage.glossary().filter((entry) => entry.enabled), controller.signal);
            nextCues = result.cues.map((cue) => ({ ...cue, translatedText: translated.items.find((item) => item.id === cue.id)?.translation || cue.translatedText }));
            setProgress(90);
          }
        }
        onCuesChange(nextCues);
        onNotice(`Đã trích xuất ${nextCues.length} cue${autoTranslate ? ' và xử lý auto-translation.' : '.'}`, 'success');
      } else {
        const result = await api.extractOcr(file, provider, assignment.model, roi, samplingFps, filterWatermark, controller.signal);
        setProgress(95);
        onCuesChange(result.cues);
        onNotice(`Đã OCR ${result.cues.length} cue.`, 'success');
      }
      setProgress(100);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') onNotice('Đã hủy extraction.', 'success');
      else {
        const message = error instanceof Error ? error.message : 'Pipeline thất bại.';
        if (provider && assignment.model && /không hỗ trợ|does not support|not supported/i.test(message)) {
          const current = storage.modelPreferences();
          const key = `${provider.id}::${tab === 'ocr' ? 'vision' : 'stt'}::${assignment.model}`;
          storage.saveModelPreferences({ ...current, [key]: { ...(current[key] || { bookmarked: false, status: 'unknown' }), status: 'failed', lastTestedAt: Date.now(), error: message } });
        }
        onNotice(message, 'error');
      }
    } finally {
      controllerRef.current = undefined;
      setTimeout(() => setWorking(false), 450);
    }
  };

  return <div className="page extract-page">
    <header className="page-header"><div><div className="eyebrow">EXTRACTION LAB / 03</div><h1>Trích xuất <span>phụ đề</span></h1><p>Đưa video hoặc âm thanh vào, lấy ra một SubtitleCue[] sạch để chỉnh sửa tiếp.</p></div></header>
    <div className="tab-bar"><button className={tab === 'ocr' ? 'active' : ''} onClick={() => setTab('ocr')}><Video size={16} /> OCR (Video)</button><button className={tab === 'stt' ? 'active' : ''} onClick={() => setTab('stt')}><AudioLines size={16} /> Trích xuất từ âm thanh</button></div>
    <section className="extract-grid"><div className="extract-left">
      <label className={`dropzone compact ${file ? 'loaded' : ''}`}><input type="file" accept={tab === 'ocr' ? 'video/*' : 'video/*,audio/*'} onChange={(event) => selectFile(event.target.files?.[0])} />{file ? <><div className="file-icon">{tab === 'ocr' ? <FileVideo size={18} /> : <FileAudio size={18} />}</div><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB · <button type="button" onClick={clearFile}>Thay file</button></small></div></> : <><div className="upload-icon"><Upload size={19} /></div><div><strong>{tab === 'ocr' ? 'Thả video vào đây' : 'Thả video hoặc audio vào đây'}</strong><small>{tab === 'ocr' ? '.mp4 · .mkv · .mov' : '.mp4 · .mp3 · .wav'}</small></div></>}</label>
      {tab === 'ocr' && <div className="ocr-stage"><VideoPlayer asset={asset} cues={[]} style={defaultStyle} roi={roi} onRoiChange={setRoi} /><div className="roi-caption"><span><i /> OCR region</span><small>Kéo khung để chọn đúng vùng subtitle · tọa độ theo %</small></div></div>}
      {tab === 'stt' && <div className="audio-callout"><div className="audio-callout-icon"><AudioLines size={20} /></div><div><strong>STT sẽ tách audio bằng FFmpeg</strong><p>Chỉ gửi audio đã tách tới endpoint /audio/transcriptions của Provider. Capability STT được kiểm tra trong Cài đặt.</p></div></div>}
    </div><div className="extract-config">
      <div className="section-title"><span>{tab === 'ocr' ? 'OCR CONFIGURATION' : 'STT CONFIGURATION'}</span><span className="local-pill">LOCAL PIPELINE</span></div>
      <div className="field"><span>Ngôn ngữ gốc</span><SelectField ariaLabel="Ngôn ngữ gốc" value={sourceLanguage} onChange={setSourceLanguage} options={['Auto Detect', 'Tiếng Việt', '中文', 'English', '한국어'].map((language) => ({ value: language, label: language }))} /></div>
      <AssignmentSummary label={tab === 'ocr' ? 'Vision Provider · lấy từ Cài đặt' : 'STT Provider · lấy từ Cài đặt'} assignment={assignment} provider={provider} capability={tab === 'ocr' ? 'vision' : 'stt'} />
      {tab === 'ocr' ? <><div className="two-fields"><label className="field"><span>Sampling <b className="value-badge">{samplingFps} FPS</b></span><input type="range" min={1} max={4} step={1} value={samplingFps} onChange={(event) => setSamplingFps(Number(event.target.value))} /></label><div className="field"><span>ROI</span><div className="coordinate-readout">{roi.x.toFixed(0)}% × {roi.y.toFixed(0)}%</div></div></div><label className="toggle-row"><span>Lọc logo / watermark khỏi OCR</span><input type="checkbox" checked={filterWatermark} onChange={(event) => setFilterWatermark(event.target.checked)} /><i /></label></> : <label className="toggle-row"><span>Dịch tự động sau khi trích xuất</span><input type="checkbox" checked={autoTranslate} onChange={(event) => setAutoTranslate(event.target.checked)} /><i /></label>}
      {autoTranslate && tab === 'stt' && <div className="auto-translation-note"><Languages size={15} /> Sau STT, app dùng Translation Provider riêng và giữ timestamp của STT.</div>}
      <button className="button primary large full" onClick={() => void run()} disabled={working}><WandSparkles size={16} /> {working ? 'Đang chạy pipeline…' : tab === 'ocr' ? 'Bắt đầu OCR' : 'Bắt đầu trích xuất'} <span>→</span></button>
      <div className="pipeline-steps"><span className="done"><Check size={13} /> {tab === 'ocr' ? 'Crop ROI' : 'Tách audio'}</span><span>→</span><span>{tab === 'ocr' ? 'Frame change' : 'STT endpoint'}</span><span>→</span><span>SubtitleCue[]</span></div><button className="text-button full" onClick={onOpenEditor}>Mở Editor hiện tại →</button>
    </div></section>
    <ProgressModal open={working} title={tab === 'ocr' ? 'Đang OCR video' : 'Đang nhận dạng giọng nói'} message={tab === 'ocr' ? 'Frame change → Vision provider' : autoTranslate ? 'FFmpeg → STT → Translation' : 'FFmpeg → STT provider'} value={progress} onCancel={() => controllerRef.current?.abort()} />
  </div>;
}
