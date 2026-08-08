import type { AIProvider, AppSettings, Capability, ProviderAssignment } from '../types';
import { capabilityAssignments, emptyAssignment, updateCapabilityAssignments } from '../lib/settings';
import { ProviderSelector } from './ProviderSelector';
import { Plus, Trash2 } from './Icons';

const labels: Array<[Capability, string, string]> = [
  ['translation', 'Translation', 'Các provider dùng cho dịch subtitle'],
  ['vision', 'OCR / Vision', 'Các provider nhận dạng chữ trong video'],
  ['stt', 'STT', 'Các provider nhận dạng âm thanh'],
  ['tts', 'TTS', 'Các provider lồng tiếng theo cue'],
];

export function CapabilityProvidersPanel({ providers, settings, onSettingsChange, onNotice }: {
  providers: AIProvider[];
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onNotice: (message: string, kind?: 'success' | 'error') => void;
}) {
  const update = (capability: Capability, choices: ProviderAssignment[]) => onSettingsChange(updateCapabilityAssignments(settings, capability, choices));

  return <section className="settings-section capability-providers-section">
    <div className="settings-heading"><div><h2>Capability Providers</h2><p>Thêm nhiều provider cho từng chức năng. Khi chạy Translation, OCR, STT hoặc TTS, bạn có thể chọn một cấu hình trong danh sách này.</p></div></div>
    <div className="capability-provider-grid">{labels.map(([capability, label, description]) => {
      const configured = capabilityAssignments(settings, capability);
      const rows = configured.length ? configured : [emptyAssignment()];
      return <div className="capability-provider-card" key={capability}>
        <div className="capability-provider-heading"><div><strong>{label}</strong><small>{description}</small></div><span>{configured.length} provider</span></div>
        <div className="capability-provider-list">{rows.map((assignment, index) => <div className="capability-provider-row" key={`${assignment.providerId}:${assignment.model}:${index}`}>
          <div className="capability-provider-row-main"><ProviderSelector providers={providers} value={assignment} onChange={(value) => update(capability, rows.map((item, itemIndex) => itemIndex === index ? value : item))} capability={capability} onNotice={onNotice} /></div>
          <button type="button" className="icon-button danger-icon capability-provider-remove" title="Xóa cấu hình provider này" onClick={() => update(capability, rows.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
        </div>)}</div>
        <button type="button" className="button small ghost capability-provider-add" onClick={() => update(capability, [...configured, emptyAssignment()])}><Plus size={14} /> Thêm provider</button>
      </div>;
    })}</div>
  </section>;
}
