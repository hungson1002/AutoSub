import { useEffect, useMemo, useRef, useState } from 'react';
import type { AIProvider, AppSettings, BlurRegion, DubbingJobStatus, LogoOverlay, PronunciationEntry, ProviderAssignment, SubtitleCue, SubtitleStyle, VideoAsset, VoiceGroup } from '../types';
import { api } from '../lib/api';
import { storage } from '../lib/storage';
import { AudioLines, Captions, Download, Image as ImageIcon, Languages, Plus, Scissors, Settings2, Upload } from '../components/Icons';
import { VideoPlayer } from '../editor/VideoPlayer';
import { SubtitleList } from '../editor/SubtitleList';
import { SubtitleTimeline } from '../editor/SubtitleTimeline';
import { SubtitleStylePanel } from '../editor/SubtitleStylePanel';
import { BlurEditor } from '../editor/BlurEditor';
import { DubbingModal, type DubbingRunOptions, type VoiceConfig } from '../editor/DubbingModal';
import { ExportModal } from '../editor/ExportModal';
import { ProgressModal } from '../components/ProgressModal';
import { cssOutlineShadow } from '../lib/subtitles';
import { LogoModal } from '../editor/LogoModal';

function applyPronunciation(text: string, entries: PronunciationEntry[]) {
  return entries.filter((entry) => entry.enabled && entry.source.trim()).reduce((value, entry) => value.split(entry.source).join(entry.reading), text);
}

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

type EditorProps = {
  providers: AIProvider[];
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  cues: SubtitleCue[];
  onCuesChange: (cues: SubtitleCue[]) => void;
  asset?: VideoAsset;
  onAssetChange: (asset?: VideoAsset) => void;
  onNotice: (message: string, kind?: 'success' | 'error') => void;
};

export function EditorPage({ providers, settings, onSettingsChange, cues, onCuesChange, asset, onAssetChange, onNotice }: EditorProps) {
  const [selectedId, setSelectedId] = useState(cues[0]?.id);
  const [currentTime, setCurrentTime] = useState(0);
  const [panel, setPanel] = useState<'style' | 'none'>('none');
  const [blurOpen, setBlurOpen] = useState(false);
  const [blurEditMode, setBlurEditMode] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const [dubbingOpen, setDubbingOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>([]);
  const [logo, setLogo] = useState<LogoOverlay>();
  const [logoPreview, setLogoPreview] = useState<LogoOverlay>();
  const [pronunciation, setPronunciation] = useState<PronunciationEntry[]>(storage.pronunciation);
  const [fontFile, setFontFile] = useState<File>();
  const [dubTrack, setDubTrack] = useState<Blob>();
  const [dubbingJob, setDubbingJob] = useState<DubbingJobStatus>();
  const dubbingTerminalNoticeRef = useRef('');
  const [working, setWorking] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const selected = cues.find((cue) => cue.id === selectedId);
  const assignments = useMemo<Record<VoiceGroup, ProviderAssignment>>(() => ({ G1: settings.assignments.tts, G2: settings.assignments.tts, G3: settings.assignments.tts }), [settings.assignments.tts]);

  useEffect(() => { storage.savePronunciation(pronunciation); }, [pronunciation]);
  useEffect(() => { if (cues.length && !cues.some((cue) => cue.id === selectedId)) setSelectedId(cues[0]?.id); }, [cues, selectedId]);
  useEffect(() => {
    if (!dubbingJob || !['queued', 'running'].includes(dubbingJob.status)) return;
    let disposed = false;
    const poll = async () => {
      try {
        const next = await api.getDubbingJobStatus(dubbingJob.id);
        if (disposed) return;
        setDubbingJob(next);
        if (['completed', 'completed_with_errors', 'cancelled', 'failed'].includes(next.status) && dubbingTerminalNoticeRef.current !== `${next.id}:${next.status}`) {
          dubbingTerminalNoticeRef.current = `${next.id}:${next.status}`;
          if (next.status === 'completed') {
            const result = await api.getDubbingResult(next.id);
            if (!disposed) {
              const metadataById = new Map(result.metadata.map((item) => [item.cueId, item]));
              onCuesChange(cues.map((cue) => metadataById.has(cue.id) ? { ...cue, dubbing: metadataById.get(cue.id) } : cue));
              onNotice(`Dubbing hoàn tất ${next.doneCues}/${next.totalCues} cue. Dub track được lưu trên server theo job ${next.id}.`, 'success');
            }
          } else if (next.status === 'completed_with_errors') {
            const firstFailure = next.failedCueErrors?.[0];
            const detail = firstFailure ? ` Cue #${firstFailure.index}, bước ${firstFailure.stage}: ${firstFailure.error}` : '';
            onNotice(`Dubbing có ${next.failedCues} cue lỗi.${detail}`, 'error');
          }
          else if (next.status === 'cancelled') onNotice('Dubbing job đã được hủy.', 'success');
          else onNotice(next.warnings.join(' ') || 'Dubbing job thất bại.', 'error');
        }
      } catch (error) { if (!disposed) onNotice(error instanceof Error ? error.message : 'Không thể đọc trạng thái dubbing job.', 'error'); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [dubbingJob?.id, dubbingJob?.status, cues, onCuesChange, onNotice]);

  const dubbingJobAction = async (action: 'pause' | 'resume' | 'cancel' | 'retry-failed') => {
    if (!dubbingJob) return;
    try {
      const next = action === 'pause' ? await api.pauseDubbingJob(dubbingJob.id) : action === 'resume' ? await api.resumeDubbingJob(dubbingJob.id) : action === 'cancel' ? await api.cancelDubbingJob(dubbingJob.id) : await api.retryFailedDubbingJob(dubbingJob.id);
      setDubbingJob(next);
      if (action === 'retry-failed') dubbingTerminalNoticeRef.current = '';
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Không thể điều khiển dubbing job.', 'error'); }
  };

  const changeCue = (id: string, patch: Partial<SubtitleCue>) => onCuesChange(cues.map((cue) => {
    if (cue.id !== id) return cue;
    const next = { ...cue, ...patch };
    if (patch.startMs !== undefined) next.startMs = Math.max(0, Math.min(next.endMs - 1, patch.startMs));
    if (patch.endMs !== undefined) next.endMs = Math.max(next.startMs + 1, patch.endMs);
    return next;
  }));

  const selectCue = (id: string) => { setSelectedId(id); const cue = cues.find((item) => item.id === id); if (cue) setCurrentTime(cue.startMs); };
  const deleteCue = (id: string) => { const next = cues.filter((cue) => cue.id !== id).map((cue, index) => ({ ...cue, index: index + 1 })); onCuesChange(next); if (selectedId === id) setSelectedId(next[0]?.id); };
  const addCue = () => { const last = cues.at(-1); const next: SubtitleCue = { id: crypto.randomUUID(), index: cues.length + 1, startMs: last?.endMs || 0, endMs: (last?.endMs || 0) + 2500, originalText: '', translatedText: '', voiceGroup: 'G1', enabled: true }; onCuesChange([...cues, next]); setSelectedId(next.id); };
  const selectVideo = (file?: File) => { if (!file) return; onAssetChange({ name: file.name, file, url: URL.createObjectURL(file), type: file.type }); onNotice(`Đã gắn video ${file.name}.`, 'success'); };

  const translateAll = async () => {
    const assignment = settings.assignments.translation;
    const provider = providers.find((item) => item.id === assignment.providerId);
    if (!provider || !assignment.model) { onNotice('Chưa có Translation Provider + Model.', 'error'); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    try {
      const result = await api.translate(provider, assignment.model, cues, 'Auto Detect', 'Tiếng Việt', 'Tự nhiên', '', [], controller.signal);
      onCuesChange(cues.map((cue) => ({ ...cue, translatedText: result.items.find((item) => item.id === cue.id)?.translation || cue.translatedText })));
      onNotice('Đã dịch lại toàn bộ cue.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') onNotice('Đã hủy xử lý trong Editor.', 'success');
      else onNotice(error instanceof Error ? error.message : 'Dịch thất bại.', 'error');
    } finally { controllerRef.current = undefined; setWorking(false); }
  };

  const runDubbing = async (configs: Record<VoiceGroup, VoiceConfig>) => {
    const dubbingCues = cues.filter((cue) => cue.enabled && (cue.translatedText || cue.originalText));
    const entries = dubbingCues.map((cue, index) => {
      const config = configs[cue.voiceGroup];
      return { id: cue.id, startMs: cue.startMs, endMs: cue.endMs, originalText: cue.originalText, translatedText: cue.translatedText || cue.originalText, text: applyPronunciation(cue.translatedText || cue.originalText, pronunciation), previousText: dubbingCues[index - 1]?.translatedText || dubbingCues[index - 1]?.originalText || '', nextText: dubbingCues[index + 1]?.translatedText || dubbingCues[index + 1]?.originalText || '', provider: providers.find((provider) => provider.id === config.assignment.providerId), model: config.assignment.model, voice: config.voice, speed: config.speed, volume: config.volume };
    });
    if (entries.some((entry) => !entry.provider || !entry.model || !entry.voice)) { onNotice('Mỗi Voice Group đang dùng phải có Provider, Model và Voice ID.', 'error'); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    setDubbingOpen(false);
    setWorking(true);
    try {
      const result = await api.generateDubTrack(entries as Array<{ id: string; startMs: number; endMs: number; originalText: string; translatedText: string; text: string; previousText: string; nextText: string; provider: AIProvider; model: string; voice: string; speed: number; volume: number }>, controller.signal);
      setDubTrack(result.blob);
      if (result.metadata.length) {
        const metadataById = new Map(result.metadata.map((item) => [item.cueId, item]));
        onCuesChange(cues.map((cue) => metadataById.has(cue.id) ? { ...cue, dubbing: metadataById.get(cue.id) } : cue));
      }
      saveBlob('autosub-dub-track.wav', result.blob);
      const warningText = result.warnings.join(' ');
      const hasHardWarning = result.warnings.some((warning) => /vượt thời lượng|không tạo được audio/i.test(warning));
      onNotice(warningText ? `Đã tạo dub-track.wav. ${warningText}` : 'Đã tạo dub-track.wav và căn audio theo timestamp.', hasHardWarning ? 'error' : 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') onNotice('Đã hủy tạo dub track.', 'success');
      else onNotice(error instanceof Error ? error.message : 'Tạo dub track thất bại.', 'error');
    } finally { controllerRef.current = undefined; setWorking(false); }
  };

  const runDubbingJob = async (configs: Record<VoiceGroup, VoiceConfig>, options: DubbingRunOptions) => {
    const dubbingCues = cues.filter((cue) => cue.enabled && (cue.translatedText || cue.originalText));
    const entries = dubbingCues.map((cue, index) => {
      const config = configs[cue.voiceGroup] || configs.G1;
      const text = applyPronunciation(cue.translatedText || cue.originalText, pronunciation).trim();
      return { id: cue.id, index: cue.index, startMs: cue.startMs, endMs: cue.endMs, originalText: cue.originalText, translatedText: cue.translatedText || cue.originalText, text, previousText: dubbingCues[index - 1]?.translatedText || dubbingCues[index - 1]?.originalText || '', nextText: dubbingCues[index + 1]?.translatedText || dubbingCues[index + 1]?.originalText || '', provider: config ? providers.find((provider) => provider.id === config.assignment.providerId) : undefined, model: config?.assignment.model || '', voice: config?.voice || '', speed: config?.speed ?? 1, volume: config?.volume ?? 1 };
    });
    const duplicateIds = entries.filter((entry, index) => entries.findIndex((item) => item.id === entry.id) !== index);
    const invalid = entries.find((entry) => !entry.provider || !entry.provider.baseUrl || !entry.model || !entry.voice || !entry.text);
    if (duplicateIds.length) { onNotice(`Dubbing không thể bắt đầu: cue ID bị trùng (${duplicateIds[0]?.id || 'không xác định'}).`, 'error'); return; }
    if (invalid) { onNotice(`Dubbing không thể bắt đầu: cue ${invalid.index ?? invalid.id} thiếu Provider, Model, Voice ID hoặc nội dung đọc.`, 'error'); return; }
    const rewriteAssignment = settings.assignments.translation;
    const rewriteProvider = providers.find((provider) => provider.id === rewriteAssignment.providerId);
    const rewrite = rewriteProvider && rewriteAssignment.model
      ? { provider: rewriteProvider, model: rewriteAssignment.model }
      : undefined;
    try {
      const created = await api.createDubbingJob(entries as Array<{ id: string; index?: number; startMs: number; endMs: number; originalText: string; translatedText: string; text: string; previousText: string; nextText: string; provider: AIProvider; model: string; voice: string; speed: number; volume: number }>, { timingMode: 'natural', batchSize: 30, ttsConcurrency: 3, llmConcurrency: 2, maxRetries: 3, audioMix: options.audioMix, ...(rewrite ? { rewrite } : {}) });
      const status = await api.startDubbingJob(created.jobId);
      dubbingTerminalNoticeRef.current = '';
      setDubbingJob(status);
      onNotice(`Đã tạo dubbing job ${created.jobId}. Có thể đóng popup; job vẫn chạy và tự resume sau khi khởi động lại server.`, 'success');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Không thể tạo dubbing job.', 'error'); }
  };

  const styleChange = (patch: Partial<SubtitleStyle>) => onSettingsChange({ ...settings, subtitleStyle: { ...settings.subtitleStyle, ...patch } });
  const previewLogoChange = (patch: Partial<LogoOverlay>) => setLogoPreview((current) => current ? { ...current, ...patch } : current);
  const closeLogoEditor = () => { if (logoPreview?.url && logoPreview.url !== logo?.url && logoPreview.url.startsWith('blob:')) URL.revokeObjectURL(logoPreview.url); setLogoPreview(logo); setLogoOpen(false); };

  return <div className="page editor-page">
    <header className="editor-header"><div><div className="eyebrow">EDITOR / MASTER SEQUENCE</div><h1>Lồng tiếng <span>video</span></h1><p>{cues.length ? `${cues.length} cue đang mở · autosave local` : 'Mở một subtitle sequence để bắt đầu dựng.'}</p></div><label className="button ghost file-button"><Upload size={15} /> {asset ? 'Thay video' : 'Thêm video'}<input type="file" accept="video/*" onChange={(event) => selectVideo(event.target.files?.[0])} /></label></header>
    <div className="editor-toolbar"><button onClick={() => void translateAll()}><Languages size={15} /> Dịch bằng AI</button><button className={blurEditMode ? 'active' : ''} onClick={() => { setBlurEditMode(true); setBlurOpen(true); }}><Scissors size={15} /> Làm mờ</button><button className={logoOpen ? 'active' : ''} onClick={() => { if (logoOpen) closeLogoEditor(); else { setPanel('none'); setLogoPreview(logo ? { ...logo } : undefined); setLogoOpen(true); } }}><ImageIcon size={15} /> Logo</button><button className={panel === 'style' ? 'active' : ''} onClick={() => { if (logoOpen) closeLogoEditor(); setPanel(panel === 'style' ? 'none' : 'style'); }}><Captions size={15} /> Phụ đề</button><button onClick={() => setDubbingOpen(true)}><AudioLines size={15} /> Lồng tiếng</button><button className="toolbar-export" onClick={() => setExportOpen(true)}><Download size={15} /> Xuất file</button></div>
    {blurEditMode && <div className="editor-mode-banner"><Scissors size={14} /> Kéo trực tiếp các vùng blur trên video. Bấm Làm mờ lần nữa để mở bảng điều khiển.</div>}
    <section className="editor-main"><div className="editor-left"><VideoPlayer asset={asset} cues={cues} style={settings.subtitleStyle} blurRegions={blurRegions} logo={logoOpen ? logoPreview : logo} currentTimeMs={currentTime} onTime={setCurrentTime} onStyleChange={styleChange} onLogoChange={previewLogoChange} onBlurRegionsChange={setBlurRegions} blurEditMode={blurEditMode} /><SubtitleTimeline cues={cues} currentTime={currentTime} selectedId={selectedId} onSelect={selectCue} /><div className="editor-footnote"><span><i className="status-dot" /> Autosave local</span><small>SubtitleCue[] là source of truth · {cues.filter((cue) => cue.translatedText).length}/{cues.length} bản dịch</small></div></div><div className="editor-right"><div className="list-heading"><div><span>SUBTITLE LIST</span><b>{cues.length}</b></div><button className="icon-button" onClick={addCue} aria-label="Thêm cue"><Plus size={16} /></button></div><SubtitleList cues={cues} selectedId={selectedId} onSelect={selectCue} onChange={changeCue} onDelete={deleteCue} /></div>{panel === 'style' && <aside className="floating-panel style-floating-panel"><div className="floating-head"><span><Settings2 size={15} /> SUBTITLE STYLE</span><button className="icon-button" onClick={() => setPanel('none')}><span aria-hidden="true">×</span></button></div><SubtitleStylePanel style={settings.subtitleStyle} onChange={styleChange} onFontUpload={setFontFile} /><div className="style-preview"><span>PREVIEW</span><div style={{ color: settings.subtitleStyle.textColor, fontFamily: settings.subtitleStyle.fontFamily, fontSize: `${Math.max(settings.subtitleStyle.fontSize * 0.45, 12)}px`, fontWeight: settings.subtitleStyle.bold ? 700 : 400, fontStyle: settings.subtitleStyle.italic ? 'italic' : 'normal', textShadow: settings.subtitleStyle.background === 'outline' ? cssOutlineShadow(settings.subtitleStyle.outlineColor, settings.subtitleStyle.outlineWidth ?? 2) : 'none', background: settings.subtitleStyle.background === 'box' ? `${settings.subtitleStyle.backgroundColor ?? settings.subtitleStyle.outlineColor}${Math.round(settings.subtitleStyle.backgroundOpacity * 255).toString(16).padStart(2, '0')}` : 'transparent' }}>{selected?.translatedText || selected?.originalText || 'Bản dịch preview'}</div></div></aside>}</section>
    <BlurEditor open={blurOpen} regions={blurRegions} asset={asset} currentTimeMs={currentTime} onClose={() => setBlurOpen(false)} onChange={setBlurRegions} />
    <LogoModal open={logoOpen} logo={logo} externalPosition={logoPreview} onClose={() => setLogoOpen(false)} onPreviewChange={setLogoPreview} onChange={(next) => { if (logo?.url && logo.url !== next.url && logo.url.startsWith('blob:')) URL.revokeObjectURL(logo.url); setLogo(next); setLogoPreview(next); onNotice('Đã cập nhật logo/watermark.', 'success'); }} />
    <DubbingModal open={dubbingOpen} providers={providers} assignments={assignments} cues={cues} pronunciation={pronunciation} job={dubbingJob} onJobAction={(action) => void dubbingJobAction(action)} onClose={() => setDubbingOpen(false)} onPronunciationChange={setPronunciation} onNotice={onNotice} onRun={(configs, options) => void runDubbingJob(configs, options)} />
    <ExportModal open={exportOpen} cues={cues} style={settings.subtitleStyle} asset={asset} logo={logo} fontFile={fontFile} blurRegions={blurRegions} dubTrack={dubTrack} dubbingJobId={dubbingJob?.status === 'completed' ? dubbingJob.id : undefined} dubbingAudioMix={dubbingJob?.config.audioMix} onClose={() => setExportOpen(false)} onNotice={onNotice} onExportVideo={() => onNotice('Video export cần video file được chọn trực tiếp trong Editor.', 'error')} />
    <ProgressModal open={working} title="Đang xử lý audio" message="Provider → FFprobe → atempo → dub-track.wav" onCancel={() => { controllerRef.current?.abort(); setWorking(false); }} />
  </div>;
}
