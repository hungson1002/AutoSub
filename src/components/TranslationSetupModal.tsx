import { useState } from 'react';
import type { AIProvider, GlossaryEntry, ProviderAssignment, SubtitleCue } from '../types';
import { BookOpen, Languages, Plus, WandSparkles, X } from './Icons';
import { Modal } from './Modal';
import { SelectField } from './SelectField';
import { CapabilityAssignmentPicker } from './CapabilityAssignmentPicker';
import { TestedModelSelect } from './TestedModelSelect';
import { translationLanguages, translationModes, translationStyles, type TranslationMode } from '../lib/translationConfig';
import { storage } from '../lib/storage';
import { isCapabilityModelPassed } from '../lib/modelTests';

export { translationStyles } from '../lib/translationConfig';
export type { TranslationMode } from '../lib/translationConfig';

export interface TranslationSetup {
  providerId: string;
  model: string;
  mode: TranslationMode;
  style: string;
  customPrompt: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossary: GlossaryEntry[];
}

export function TranslationSetupModal({ open, provider, providers, assignments, cues, setup, onChange, onClose, onStart }: {
  open: boolean;
  provider?: AIProvider;
  providers: AIProvider[];
  assignments: ProviderAssignment[];
  cues: SubtitleCue[];
  setup: TranslationSetup;
  onChange: (patch: Partial<TranslationSetup>) => void;
  onClose: () => void;
  onStart: (setup: TranslationSetup) => void;
}) {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const canStart = Boolean(provider?.enabled && setup.model && cues.length && isCapabilityModelPassed(storage.modelPreferences(), provider.id, 'translation', setup.model));
  const updateGlossary = (id: string, patch: Partial<GlossaryEntry>) => onChange({ glossary: setup.glossary.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) });

  return <Modal open={open} title="Thiết lập Dịch AI" eyebrow="TRANSLATION WORKFLOW" wide className="translation-setup-modal" onClose={onClose}>
    <div className="translation-setup-grid">
      <CapabilityAssignmentPicker capability="translation" assignments={assignments} providers={providers} value={{ providerId: setup.providerId, model: setup.model }} onChange={(assignment) => onChange({ providerId: assignment.providerId, model: assignment.model })} />
      <TestedModelSelect provider={provider} capability="translation" value={setup.model} onChange={(model) => onChange({ model })} candidateModelIds={assignments.filter((item) => item.providerId === provider?.id).map((item) => item.model)} />
      <div className="field"><span>Chế độ</span><SelectField ariaLabel="Chế độ dịch" value={setup.mode} onChange={(mode) => onChange({ mode: mode as TranslationMode })} options={translationModes} /></div>
      <div className="field"><span>Ngôn ngữ nguồn</span><SelectField ariaLabel="Ngôn ngữ nguồn" value={setup.sourceLanguage} onChange={(sourceLanguage) => onChange({ sourceLanguage })} options={translationLanguages.map((value) => ({ value, label: value }))} /></div>
      <div className="field"><span>Ngôn ngữ đích</span><SelectField ariaLabel="Ngôn ngữ đích" value={setup.targetLanguage} onChange={(targetLanguage) => onChange({ targetLanguage })} options={translationLanguages.filter((value) => value !== 'Auto Detect').map((value) => ({ value, label: value }))} /></div>
      <div className="field translation-setup-full"><span>Phong cách dịch</span><SelectField ariaLabel="Phong cách dịch" value={setup.style} onChange={(style) => onChange({ style })} options={translationStyles} /></div>
    </div>
    {setup.style === 'Tùy chỉnh' && <label className="field translation-custom-prompt"><span>Prompt phong cách tùy chỉnh</span><textarea value={setup.customPrompt} onChange={(event) => onChange({ customPrompt: event.target.value })} placeholder="Ví dụ: Giữ cách xưng hô thân mật, câu ngắn, tự nhiên như lời thoại phim..." /></label>}
    <button type="button" className="translation-glossary-toggle" onClick={() => setGlossaryOpen((value) => !value)}><BookOpen size={16} /><strong>Từ điển &amp; Danh sách nhân vật ({setup.glossary.length})</strong><span>{glossaryOpen ? '⌃' : '›'}</span></button>
    {glossaryOpen && <div className="translation-glossary"><div className="translation-glossary-head"><span>TỪ GỐC</span><span>BẢN DỊCH</span><span /></div>{setup.glossary.map((entry) => <div className="translation-glossary-row" key={entry.id}><input value={entry.source} onChange={(event) => updateGlossary(entry.id, { source: event.target.value })} placeholder="Tên / thuật ngữ" /><span>→</span><input value={entry.target} onChange={(event) => updateGlossary(entry.id, { target: event.target.value })} placeholder="Bản dịch" /><button type="button" className="icon-button" onClick={() => onChange({ glossary: setup.glossary.filter((item) => item.id !== entry.id) })} aria-label="Xóa thuật ngữ"><X size={14} /></button></div>)}<button type="button" className="button ghost full" onClick={() => onChange({ glossary: [...setup.glossary, { id: crypto.randomUUID(), source: '', target: '', enabled: true }] })}><Plus size={14} /> Thêm thuật ngữ</button></div>}
    <div className="translation-cost-card"><Languages size={17} /><div><strong>Ước tính xử lý</strong><span>{cues.length} dòng × 1 ngôn ngữ · {provider?.name || 'chưa chọn provider'}</span><b>{provider ? 'Không tính credit trong AutoSub local' : 'Cần chọn Translation Provider'}</b></div></div>
    <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Hủy</button><button type="button" className="button primary" disabled={!canStart} onClick={() => onStart(setup)}><WandSparkles size={15} /> Bắt đầu dịch toàn bộ <span>→</span></button></div>
  </Modal>;
}
