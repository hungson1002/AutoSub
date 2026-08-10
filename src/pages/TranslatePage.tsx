import { useEffect, useMemo, useRef, useState } from 'react';
import type { AIProvider, AppSettings, GlossaryEntry, ProviderAssignment, SubtitleCue } from '../types';
import { api, friendlyErrorMessage } from '../lib/api';
import { storage } from '../lib/storage';
import { cuesToSrt, downloadText, formatClock, parseSubtitle } from '../lib/subtitles';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { BookOpen, Check, Download, Languages, Plus, Upload, WandSparkles, X } from '../components/Icons';
import { Modal } from '../components/Modal';
import { ProgressModal } from '../components/ProgressModal';
import { SelectField } from '../components/SelectField';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { capabilityAssignments } from '../lib/settings';

const styles = ['Phổ thông', 'Tự nhiên', 'Đời thường', 'Trang trọng', 'Phim hiện đại', 'Phim cổ trang', 'Hoạt hình', 'Tùy chỉnh'];
const languages = ['Auto Detect', 'Tiếng Việt', 'English', '中文', '한국어', '日本語'];

export function TranslatePage({ providers, settings, cues, onCuesChange, onOpenEditor, onNotice }: { providers: AIProvider[]; settings: AppSettings; cues: SubtitleCue[]; onCuesChange: (cues: SubtitleCue[]) => void; onOpenEditor: () => void; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [fileName, setFileName] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('Auto Detect');
  const [targetLanguage, setTargetLanguage] = useState('Tiếng Việt');
  const [style, setStyle] = useState(styles[0] ?? 'Phổ thông');
  const [customPrompt, setCustomPrompt] = useState('');
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>(storage.glossary);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('Chuẩn bị dịch subtitle');
  const [translationFailure, setTranslationFailure] = useState<{ remaining: number; message: string } | undefined>(undefined);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const progressTimerRef = useRef<number | undefined>(undefined);
  const configuredAssignments = capabilityAssignments(settings, 'translation');
  const [activeAssignment, setActiveAssignment] = useState<ProviderAssignment>(settings.assignments.translation);
  const assignment = activeAssignment;
  const provider = providers.find((item) => item.id === assignment.providerId);
  const ready = cues.length > 0 && !!provider && !!assignment.model;
  const translatedCount = useMemo(() => cues.filter((cue) => cue.translatedText.trim()).length, [cues]);
  const untranslatedCount = cues.length - translatedCount;

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
    onNotice(`Đã nạp ${parsed.length} cue từ ${file.name}.`, 'success');
  };

  const clearFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setFileName('');
    onCuesChange([]);
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
    const tested = storage.modelPreferences()[`${provider.id}::translation::${assignment.model}`];
    if (tested?.status === 'failed') { onNotice(`Model ${assignment.model} không chạy được Translation. Hãy chọn model có trạng thái Chạy được trong Cài đặt.`, 'error'); return; }
    if (!cues.length) { onNotice('Hãy import SRT hoặc VTT trước.', 'error'); return; }
    const queue = onlyMissing ? cues.filter((cue) => !cue.translatedText.trim()) : cues;
    if (!queue.length) { onNotice('Tất cả cue đã có bản dịch.', 'success'); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setTranslationFailure(undefined);
    setProgress(5);
    setProgressStage('Đang chuẩn bị dữ liệu dịch');
    try {
      const next = cues.map((cue) => ({ ...cue }));
      const batchSize = 12;
      const totalBatches = Math.ceil(queue.length / batchSize);
      for (let start = 0; start < queue.length; start += batchSize) {
        const batch = queue.slice(start, start + batchSize);
        const batchNumber = Math.floor(start / batchSize) + 1;
        setProgressStage(`Đang gửi batch ${batchNumber}/${totalBatches} · cue ${start + 1}–${start + batch.length}`);
        easeProgressTo(Math.min(94, Math.max(8, ((start + batch.length * 0.88) / queue.length) * 100)));
        let result: { items: Array<{ id: string; translation: string }> };
        try {
          result = await api.translate(provider, assignment.model, batch, sourceLanguage, targetLanguage, style, customPrompt, glossary.filter((entry) => entry.enabled), controller.signal);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          const remaining = queue.length - start;
          const message = friendlyErrorMessage(error, 'Batch dịch này chưa hoàn tất.');
          onCuesChange([...next]);
          setTranslationFailure({ remaining, message });
          setProgressStage(`Đã lưu các batch trước · còn ${remaining} cue chưa dịch`);
          onNotice(`Đã lưu ${next.filter((cue) => cue.translatedText.trim()).length}/${next.length} cue. ${remaining} cue còn lại có thể dịch tiếp.`, 'error');
          return;
        }
        clearProgressTimer();
        for (const item of result.items) {
          const cue = next.find((candidate) => candidate.id === item.id);
          if (cue) cue.translatedText = item.translation;
        }
        setProgress(Math.min(98, ((start + batch.length) / queue.length) * 100));
        setProgressStage(`Đã nhận batch ${batchNumber}/${totalBatches} · đang lưu kết quả`);
        onCuesChange([...next]);
      }
      setProgress(100);
      setProgressStage('Đã hoàn tất dịch toàn bộ subtitle');
      onNotice(`Đã dịch ${next.filter((cue) => cue.translatedText.trim()).length}/${next.length} cue.`, 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { setProgressStage('Đã hủy dịch subtitle'); onNotice('Đã hủy dịch subtitle.', 'success'); }
      else { setProgressStage('Dịch thất bại'); onNotice(friendlyErrorMessage(error, 'Dịch thất bại.'), 'error'); }
    } finally {
      clearProgressTimer();
      controllerRef.current = undefined;
      setTimeout(() => setWorking(false), 450);
    }
  };

  return <div className="page translate-page">
    <header className="page-header"><div><div className="eyebrow">TRANSLATION DESK / 02</div><h1>Dịch phụ đề <span>AI</span></h1><p>Giữ timestamp nguyên bản. Dịch theo batch để câu chữ còn mạch phim.</p></div><div className="header-actions">{cues.length > 0 && <button className="button ghost" onClick={() => downloadText('autosub-translated.srt', cuesToSrt(cues, true), 'application/x-subrip')}><Download size={15} /> Export SRT</button>}<button className="button ghost" onClick={() => setGlossaryOpen(true)}><BookOpen size={15} /> Từ điển <span className="button-count">{glossary.length}</span></button></div></header>
    <section className="dropzone-section"><label className={`dropzone ${fileName ? 'loaded' : ''}`}><input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" onChange={(event) => void loadFile(event.target.files?.[0])} />{fileName ? <><div className="file-icon"><Check size={18} /></div><div><strong>{fileName}</strong><small>{cues.length} cue · {translatedCount} đã dịch · <button type="button" onClick={clearFile}>Xóa file</button></small></div><span className="replace-file">Thay file</span></> : <><div className="upload-icon"><Upload size={20} /></div><div><strong>Thả file phụ đề vào đây</strong><small>hoặc click để chọn · .SRT / .VTT</small></div><span className="browse-label">Browse</span></>}</label></section>
    {cues.length > 0 ? <section className="translation-workbench"><div className="config-column"><div className="section-title"><span>CẤU HÌNH DỊCH</span><span className={`ready-chip ${ready ? 'has-config' : ''}`}><i /> {ready ? 'Cấu hình đã nạp' : 'Thiếu cấu hình'}</span></div><div className="two-fields"><div className="field"><span>Ngôn ngữ nguồn</span><SelectField ariaLabel="Ngôn ngữ nguồn" value={sourceLanguage} onChange={setSourceLanguage} options={languages.map((language) => ({ value: language, label: language }))} /></div><div className="field"><span>Ngôn ngữ đích</span><SelectField ariaLabel="Ngôn ngữ đích" value={targetLanguage} onChange={setTargetLanguage} options={languages.filter((language) => language !== 'Auto Detect').map((language) => ({ value: language, label: language }))} /></div></div><CapabilityAssignmentPicker capability="translation" assignments={configuredAssignments} providers={providers} value={assignment} onChange={setActiveAssignment} /><AssignmentSummary label="Translation Provider đang dùng" assignment={assignment} provider={provider} capability="translation" /><div className="field"><span>Phong cách dịch</span><div className="style-chips">{styles.map((item) => <button key={item} className={style === item ? 'active' : ''} onClick={() => setStyle(item)}>{item}</button>)}</div></div>{style === 'Tùy chỉnh' && <label className="field"><span>Prompt tùy chỉnh</span><textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="Ví dụ: Giữ cách xưng hô thân mật, không dịch tên riêng..." /></label>}<button className="button primary large full" onClick={() => void runTranslation()} disabled={working}><WandSparkles size={16} /> {working ? 'Đang dịch…' : 'Bắt đầu dịch'} <span>→</span></button>{translationFailure && <div className="translation-recovery" role="status"><strong>Còn {translationFailure.remaining} cue chưa dịch</strong><span>{translationFailure.message}</span><button className="button ghost small" onClick={() => void runTranslation(true)} disabled={working}>Dịch tiếp {untranslatedCount} cue →</button></div>}<div className="translation-note"><Languages size={15} /><span>AI nhận mỗi batch tối đa 12 cue. Timestamp luôn lấy từ file gốc.</span></div></div><div className="cue-preview"><div className="section-title"><span>PREVIEW / {cues.length} CUE</span><button className="text-button" onClick={onOpenEditor}>Mở Editor →</button></div><div className="mini-cues">{cues.slice(0, 7).map((cue) => <div className="mini-cue" key={cue.id}><span>{String(cue.index).padStart(2, '0')}</span><div><small>{formatClock(cue.startMs)} — {formatClock(cue.endMs)}</small><p>{cue.originalText}</p><strong>{cue.translatedText || <em>Chưa dịch</em>}</strong></div></div>)}{cues.length > 7 && <div className="more-cues">+ {cues.length - 7} cue trong Editor</div>}</div></div></section> : <div className="empty-workspace"><div className="empty-glyph"><Languages size={26} /></div><h2>Bắt đầu từ một file phụ đề</h2><p>Import SRT/VTT để mở cấu hình dịch và preview.</p></div>}
    <ProgressModal open={working} title="Đang dịch subtitle" message={progressStage} value={progress} onCancel={() => controllerRef.current?.abort()} />
    <Modal open={glossaryOpen} title="Từ điển dịch" eyebrow="GLOSSARY" onClose={() => setGlossaryOpen(false)}><div className="modal-intro">Glossary được gửi kèm prompt dịch. Chỉ các dòng đang bật mới có hiệu lực.</div><div className="glossary-table"><div className="glossary-head"><span>TỪ GỐC</span><span>BẢN DỊCH</span><span /></div>{glossary.map((entry) => <div className="glossary-row" key={entry.id}><input value={entry.source} onChange={(event) => setGlossary(glossary.map((item) => item.id === entry.id ? { ...item, source: event.target.value } : item))} placeholder="Xiao Yan" /><span>→</span><input value={entry.target} onChange={(event) => setGlossary(glossary.map((item) => item.id === entry.id ? { ...item, target: event.target.value } : item))} placeholder="Tiêu Viêm" /><label className="tiny-switch"><input type="checkbox" checked={entry.enabled} onChange={(event) => setGlossary(glossary.map((item) => item.id === entry.id ? { ...item, enabled: event.target.checked } : item))} /><i /></label><button className="icon-button" onClick={() => setGlossary(glossary.filter((item) => item.id !== entry.id))}><X size={14} /></button></div>)}</div><button className="button ghost full" onClick={() => setGlossary([...glossary, { id: crypto.randomUUID(), source: '', target: '', enabled: true }])}><Plus size={15} /> Thêm thuật ngữ</button><div className="modal-actions"><button className="button primary" onClick={() => setGlossaryOpen(false)}>Lưu từ điển</button></div></Modal>
  </div>;
}
