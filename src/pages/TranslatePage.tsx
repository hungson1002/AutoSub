import { useEffect, useMemo, useRef, useState } from 'react';
import type { AIProvider, AppSettings, GlossaryEntry, ProviderAssignment, SubtitleCue } from '../types';
import { api, buildTranslationMemory, friendlyErrorMessage } from '../lib/api';
import { storage, translationStatusStorage, type TranslationRunState, type TranslationRunStatus } from '../lib/storage';
import { cuesToSrt, downloadText, formatClock, parseSubtitle } from '../lib/subtitles';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { BookOpen, Check, Download, Languages, Plus, Upload, WandSparkles, X } from '../components/Icons';
import { Modal } from '../components/Modal';
import { ProgressModal } from '../components/ProgressModal';
import { SelectField } from '../components/SelectField';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { capabilityAssignments } from '../lib/settings';
import { TestedModelSelect } from '../components/TestedModelSelect';
import { isCapabilityModelPassed } from '../lib/modelTests';
import { translationBatchSize, translationLanguages, translationModes, translationStyles, type TranslationMode } from '../lib/translationConfig';

const defaultTranslationStyle = translationStyles.find((item) => item.value === 'Review phim')?.value ?? translationStyles[0]?.value ?? 'Phổ thông';

export function TranslatePage({ providers, settings, cues, onCuesChange, onOpenEditor, onNotice }: { providers: AIProvider[]; settings: AppSettings; cues: SubtitleCue[]; onCuesChange: (cues: SubtitleCue[]) => void; onOpenEditor: () => void; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [runState, setRunState] = useState<TranslationRunState>(() => {
    const saved = translationStatusStorage.load();
    if (saved.status === 'running') return { ...saved, status: 'failed', message: 'Lần dịch trước bị gián đoạn. Các batch đã hoàn thành vẫn được giữ lại; hãy chọn model rồi bấm Dịch tiếp.', updatedAt: Date.now() };
    return saved;
  });
  const [fileName, setFileName] = useState(() => runState.fileName || '');
  const [sourceLanguage, setSourceLanguage] = useState('Auto Detect');
  const [targetLanguage, setTargetLanguage] = useState('Tiếng Việt');
  const [mode, setMode] = useState<TranslationMode>('quality');
  const [style, setStyle] = useState(defaultTranslationStyle);
  const [customPrompt, setCustomPrompt] = useState('');
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>(storage.glossary);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(() => runState.progress || 0);
  const [progressStage, setProgressStage] = useState(() => runState.stage || 'Chuẩn bị dịch subtitle');
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const progressTimerRef = useRef<number | undefined>(undefined);
  const configuredAssignments = capabilityAssignments(settings, 'translation');
  const [activeAssignment, setActiveAssignment] = useState<ProviderAssignment>(settings.assignments.translation);
  const assignment = activeAssignment;
  const provider = providers.find((item) => item.id === assignment.providerId);
  const ready = cues.length > 0 && !!provider?.enabled && isCapabilityModelPassed(storage.modelPreferences(), provider.id, 'translation', assignment.model);
  const translatedCount = useMemo(() => cues.filter((cue) => cue.translatedText.trim()).length, [cues]);
  const untranslatedCount = cues.length - translatedCount;
  const hasPartialTranslation = translatedCount > 0 && untranslatedCount > 0;
  const translationStatus: TranslationRunStatus = working
    ? 'running'
    : cues.length > 0 && untranslatedCount === 0
      ? 'completed'
      : hasPartialTranslation && runState.status !== 'failed' && runState.status !== 'cancelled'
        ? 'ready'
      : runState.status === 'completed'
        ? 'ready'
        : runState.status;
  const translationStatusLabels: Record<TranslationRunStatus, string> = {
    idle: 'Chưa dịch',
    ready: hasPartialTranslation ? `Còn ${untranslatedCount} cue` : 'Sẵn sàng dịch',
    running: 'Đang dịch',
    completed: 'Đã hoàn thành',
    failed: 'Dịch thất bại',
    cancelled: 'Đã tạm dừng',
  };
  const translationFailure = ((runState.status === 'failed' || runState.status === 'cancelled') || hasPartialTranslation) && untranslatedCount > 0
    ? { remaining: untranslatedCount, message: runState.message || 'Đã phát hiện bản dịch dang dở. Các cue đã dịch được giữ lại; hãy chọn model rồi tiếp tục phần còn thiếu.' }
    : undefined;

  const updateRunState = (next: TranslationRunState) => {
    setRunState(next);
    translationStatusStorage.save(next);
  };

  useEffect(() => { storage.saveGlossary(glossary); }, [glossary]);
  useEffect(() => { setActiveAssignment(settings.assignments.translation); }, [settings.assignments.translation.providerId, settings.assignments.translation.model]);
  useEffect(() => () => { controllerRef.current?.abort(); if (progressTimerRef.current !== undefined) window.clearInterval(progressTimerRef.current); }, []);

  const loadFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseSubtitle(text, file.name);
    if (!parsed.length) { onNotice('Không đọc được cue từ file này.', 'error'); return; }
    setFileName(file.name);
    onCuesChange(parsed);
    updateRunState({ status: 'ready', fileName: file.name, total: parsed.length, translated: 0, remaining: parsed.length, progress: 0, stage: 'Sẵn sàng dịch', updatedAt: Date.now() });
    onNotice(`Đã nạp ${parsed.length} cue từ ${file.name}.`, 'success');
  };

  const clearFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setFileName('');
    onCuesChange([]);
    updateRunState({ status: 'idle' });
  };

  const clearProgressTimer = () => {
    if (progressTimerRef.current !== undefined) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = undefined;
    }
  };

  const easeProgressTo = (ceiling: number) => {
    clearProgressTimer();
    progressTimerRef.current = window.setInterval(() => {
      setProgress((current) => current >= ceiling - 0.2 ? current : Math.min(ceiling, current + Math.max(0.12, (ceiling - current) * 0.045)));
    }, 120);
  };

  const runTranslation = async (onlyMissing = false) => {
    if (!provider) { onNotice('Chưa có Translation Provider trong Cài đặt.', 'error'); return; }
    if (!provider.enabled) { onNotice(`Provider ${provider.name} đang bị tắt trong Cài đặt.`, 'error'); return; }
    if (!assignment.model) { onNotice(`Provider ${provider.name} đã chọn nhưng chưa có Model trong Cài đặt.`, 'error'); return; }
    if (!isCapabilityModelPassed(storage.modelPreferences(), provider.id, 'translation', assignment.model)) { onNotice(`Model ${assignment.model} chưa test Translation thành công. Hãy chọn model có trạng thái Chạy được trong Cài đặt.`, 'error'); return; }
    if (!cues.length) { onNotice('Hãy import SRT hoặc VTT trước.', 'error'); return; }
    const queue = onlyMissing ? cues.filter((cue) => !cue.translatedText.trim()) : cues;
    if (!queue.length) { onNotice('Tất cả cue đã có bản dịch.', 'success'); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setProgress(5);
    setProgressStage('Đang chuẩn bị dữ liệu dịch');
    updateRunState({ status: 'running', fileName, total: cues.length, translated: translatedCount, remaining: queue.length, progress: 5, stage: 'Đang chuẩn bị dữ liệu dịch', updatedAt: Date.now() });
    try {
      const next = cues.map((cue) => onlyMissing ? { ...cue } : { ...cue, translatedText: '' });
      let lastWarning = '';
      let translationGuide = '';
      if (style === 'Review phim') {
        setProgressStage('Đang lập translation bible cho nhân vật và thuật ngữ');
        try {
          translationGuide = (await api.translationGuide(provider, assignment.model, cues, sourceLanguage, targetLanguage, style, customPrompt, glossary.filter((entry) => entry.enabled), controller.signal)).guide;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
        }
      }
      const batchSize = translationBatchSize(mode);
      const totalBatches = Math.ceil(queue.length / batchSize);
      for (let start = 0; start < queue.length; start += batchSize) {
        const batch = queue.slice(start, start + batchSize);
        const batchNumber = Math.floor(start / batchSize) + 1;
        setProgressStage(`Đang gửi batch ${batchNumber}/${totalBatches} · cue ${start + 1}–${start + batch.length}`);
        easeProgressTo(Math.min(94, Math.max(8, ((start + batch.length * 0.88) / queue.length) * 100)));
        let result: { items: Array<{ id: string; translation: string }>; pendingCueIds?: string[]; warning?: string };
        try {
          const translationMemory = buildTranslationMemory(next, batch[0]?.id || '', 24);
          result = await api.translate(provider, assignment.model, batch, sourceLanguage, targetLanguage, style, customPrompt, glossary.filter((entry) => entry.enabled), controller.signal, next, translationMemory, translationGuide);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          const remaining = queue.length - start;
          const message = friendlyErrorMessage(error, 'Batch dịch này chưa hoàn tất.');
          onCuesChange([...next]);
          setProgressStage(`Đã lưu các batch trước · còn ${remaining} cue chưa dịch`);
          updateRunState({ status: 'failed', fileName, total: next.length, translated: next.filter((cue) => cue.translatedText.trim()).length, remaining, message, progress, stage: `Đã lưu các batch trước · còn ${remaining} cue chưa dịch`, updatedAt: Date.now() });
          onNotice(`Đã lưu ${next.filter((cue) => cue.translatedText.trim()).length}/${next.length} cue. ${remaining} cue còn lại có thể dịch tiếp.`, 'error');
          return;
        }
        clearProgressTimer();
        for (const item of result.items) {
          const cue = next.find((candidate) => candidate.id === item.id);
          if (cue) cue.translatedText = item.translation;
        }
        if (result.warning) lastWarning = result.warning;
        setProgress(Math.min(98, ((start + batch.length) / queue.length) * 100));
        setProgressStage(`Đã nhận batch ${batchNumber}/${totalBatches} · đang lưu kết quả`);
        onCuesChange([...next]);
        const translated = next.filter((cue) => cue.translatedText.trim()).length;
        updateRunState({ status: 'running', fileName, total: next.length, translated, remaining: next.length - translated, progress: Math.min(98, ((start + batch.length) / queue.length) * 100), stage: `Đã nhận batch ${batchNumber}/${totalBatches} · đang lưu kết quả`, updatedAt: Date.now() });
      }
      const translated = next.filter((cue) => cue.translatedText.trim()).length;
      const remaining = next.length - translated;
      setProgress(100);
      if (remaining > 0) {
        const stage = `Đã lưu ${translated}/${next.length} cue · còn ${remaining} cue cần dịch tiếp`;
        setProgressStage(stage);
        updateRunState({ status: 'failed', fileName, total: next.length, translated, remaining, message: lastWarning || `Còn ${remaining} cue chưa có bản dịch hợp lệ.`, progress: 100, stage, updatedAt: Date.now() });
        onNotice(stage, 'error');
      } else {
        setProgressStage('Đã hoàn tất dịch toàn bộ subtitle');
        updateRunState({ status: 'completed', fileName, total: next.length, translated, remaining: 0, progress: 100, stage: 'Đã hoàn tất dịch toàn bộ subtitle', updatedAt: Date.now() });
        onNotice(`Đã dịch ${translated}/${next.length} cue.`, 'success');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        const remaining = cues.filter((cue) => !cue.translatedText.trim()).length;
        setProgressStage('Đã tạm dừng dịch subtitle');
        updateRunState({ status: 'cancelled', fileName, total: cues.length, translated: cues.length - remaining, remaining, message: 'Đã tạm dừng. Các batch hoàn thành vẫn được giữ lại và có thể dịch tiếp.', progress, stage: 'Đã tạm dừng dịch subtitle', updatedAt: Date.now() });
        onNotice('Đã tạm dừng dịch subtitle. Kết quả đã làm vẫn được giữ lại.', 'success');
      }
      else {
        const message = friendlyErrorMessage(error, 'Dịch thất bại.');
        const remaining = cues.filter((cue) => !cue.translatedText.trim()).length;
        setProgressStage('Dịch thất bại');
        updateRunState({ status: 'failed', fileName, total: cues.length, translated: cues.length - remaining, remaining, message, progress, stage: 'Dịch thất bại', updatedAt: Date.now() });
        onNotice(message, 'error');
      }
    } finally {
      clearProgressTimer();
      controllerRef.current = undefined;
      setTimeout(() => setWorking(false), 450);
    }
  };

  return <div className="page translate-page">
    <header className="page-header"><div><div className="eyebrow">TRANSLATION DESK / 02</div><h1>Dịch phụ đề <span>AI</span></h1><p>Giữ timestamp nguyên bản. Dịch theo batch để câu chữ còn mạch phim.</p></div><div className="header-actions">{cues.length > 0 && <button className="button ghost" onClick={() => downloadText('autosub-translated.srt', cuesToSrt(cues, true), 'application/x-subrip')}><Download size={15} /> Export SRT</button>}<button className="button ghost" onClick={() => setGlossaryOpen(true)}><BookOpen size={15} /> Từ điển <span className="button-count">{glossary.length}</span></button></div></header>
    <section className="dropzone-section"><label className={`dropzone ${fileName ? 'loaded' : ''}`}><input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" onChange={(event) => void loadFile(event.target.files?.[0])} />{fileName ? <><div className="file-icon"><Check size={18} /></div><div><strong>{fileName}</strong><small>{cues.length} cue · {translatedCount} đã dịch · <button type="button" onClick={clearFile}>Xóa file</button></small></div><span className="replace-file">Thay file</span></> : <><div className="upload-icon"><Upload size={20} /></div><div><strong>Thả file phụ đề vào đây</strong><small>hoặc click để chọn · .SRT / .VTT</small></div><span className="browse-label">Browse</span></>}</label></section>
    {cues.length > 0 ? <section className="translation-workbench">
      <div className="config-column">
        <div className="section-title">
          <span>CẤU HÌNH DỊCH</span>
          <span className={`translation-status-badge ${translationStatus}`} role="status"><i /><strong>{translationStatusLabels[translationStatus]}</strong>{translationStatus === 'completed' && <small>{translatedCount}/{cues.length} cue</small>}</span>
        </div>
        <div className="translation-page-config-grid">
          <CapabilityAssignmentPicker capability="translation" assignments={configuredAssignments} providers={providers} value={assignment} onChange={setActiveAssignment} />
          <TestedModelSelect provider={provider} capability="translation" value={assignment.model} onChange={(model) => setActiveAssignment((current) => ({ ...current, model }))} candidateModelIds={configuredAssignments.filter((item) => item.providerId === provider?.id).map((item) => item.model)} />
          <div className="field"><span>Chế độ</span><SelectField ariaLabel="Chế độ dịch" value={mode} onChange={(value) => setMode(value as TranslationMode)} options={translationModes} /></div>
          <div className="field"><span>Ngôn ngữ nguồn</span><SelectField ariaLabel="Ngôn ngữ nguồn" value={sourceLanguage} onChange={setSourceLanguage} options={translationLanguages.map((language) => ({ value: language, label: language }))} /></div>
          <div className="field"><span>Ngôn ngữ đích</span><SelectField ariaLabel="Ngôn ngữ đích" value={targetLanguage} onChange={setTargetLanguage} options={translationLanguages.filter((language) => language !== 'Auto Detect').map((language) => ({ value: language, label: language }))} /></div>
          <div className="field translation-page-style"><span>Phong cách dịch</span><SelectField ariaLabel="Phong cách dịch" value={style} onChange={setStyle} options={translationStyles} /></div>
        </div>
        <AssignmentSummary label="Translation Provider đang dùng" assignment={assignment} provider={provider} capability="translation" />
        {style === 'Tùy chỉnh' && <label className="field"><span>Prompt phong cách tùy chỉnh</span><textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="Ví dụ: Giữ cách xưng hô thân mật, câu ngắn, tự nhiên như lời thoại phim..." /></label>}
        <button className="button primary large full" onClick={() => void runTranslation(hasPartialTranslation)} disabled={working || !ready}><WandSparkles size={16} /> {working ? 'Đang dịch…' : hasPartialTranslation ? `Dịch tiếp ${untranslatedCount} cue` : untranslatedCount === 0 ? 'Dịch lại toàn bộ' : 'Bắt đầu dịch'} <span>→</span></button>
        {translationFailure && <div className="translation-recovery" role="status"><strong>Còn {translationFailure.remaining} cue chưa dịch</strong><span>{translationFailure.message}</span><button className="button ghost small" onClick={() => void runTranslation(true)} disabled={working || !ready}>Dịch tiếp {untranslatedCount} cue →</button></div>}
        <div className="translation-note"><Languages size={15} /><span>Đang dùng batch {translationBatchSize(mode)} cue. Timestamp luôn lấy từ file gốc.</span></div>
      </div>
      <div className="cue-preview"><div className="section-title"><span>PREVIEW / {cues.length} CUE</span><button className="text-button" onClick={onOpenEditor}>Mở Editor →</button></div><div className="mini-cues">{cues.slice(0, 7).map((cue) => <div className="mini-cue" key={cue.id}><span>{String(cue.index).padStart(2, '0')}</span><div><small>{formatClock(cue.startMs)} — {formatClock(cue.endMs)}</small><p>{cue.originalText}</p><strong>{cue.translatedText || <em>Chưa dịch</em>}</strong></div></div>)}{cues.length > 7 && <div className="more-cues">+ {cues.length - 7} cue trong Editor</div>}</div></div>
    </section> : <div className="empty-workspace"><div className="empty-glyph"><Languages size={26} /></div><h2>Bắt đầu từ một file phụ đề</h2><p>Import SRT/VTT để mở cấu hình dịch và preview.</p></div>}
    <ProgressModal open={working} title="Đang dịch subtitle" message={progressStage} value={progress} onCancel={() => controllerRef.current?.abort()} />
    <Modal open={glossaryOpen} title="Từ điển dịch" eyebrow="GLOSSARY" onClose={() => setGlossaryOpen(false)}><div className="modal-intro">Glossary được gửi kèm prompt dịch. Chỉ các dòng đang bật mới có hiệu lực.</div><div className="glossary-table"><div className="glossary-head"><span>TỪ GỐC</span><span>BẢN DỊCH</span><span /></div>{glossary.map((entry) => <div className="glossary-row" key={entry.id}><input value={entry.source} onChange={(event) => setGlossary(glossary.map((item) => item.id === entry.id ? { ...item, source: event.target.value } : item))} placeholder="Xiao Yan" /><span>→</span><input value={entry.target} onChange={(event) => setGlossary(glossary.map((item) => item.id === entry.id ? { ...item, target: event.target.value } : item))} placeholder="Tiêu Viêm" /><label className="tiny-switch"><input type="checkbox" checked={entry.enabled} onChange={(event) => setGlossary(glossary.map((item) => item.id === entry.id ? { ...item, enabled: event.target.checked } : item))} /><i /></label><button className="icon-button" onClick={() => setGlossary(glossary.filter((item) => item.id !== entry.id))}><X size={14} /></button></div>)}</div><button className="button ghost full" onClick={() => setGlossary([...glossary, { id: crypto.randomUUID(), source: '', target: '', enabled: true }])}><Plus size={15} /> Thêm thuật ngữ</button><div className="modal-actions"><button className="button primary" onClick={() => setGlossaryOpen(false)}>Lưu từ điển</button></div></Modal>
  </div>;
}
