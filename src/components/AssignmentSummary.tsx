import { useEffect, useState } from 'react';
import type { AIProvider, Capability, ProviderAssignment } from '../types';
import { storage } from '../lib/storage';
import { Settings2 } from './Icons';

export function AssignmentSummary({ label, assignment, provider, capability = 'translation' }: { label: string; assignment: ProviderAssignment; provider?: AIProvider; capability?: Capability }) {
  const [preferences, setPreferences] = useState(storage.modelPreferences);
  useEffect(() => {
    const sync = () => setPreferences(storage.modelPreferences());
    window.addEventListener('autosub:model-preferences-changed', sync);
    return () => window.removeEventListener('autosub:model-preferences-changed', sync);
  }, []);
  const preference = provider && assignment.model ? preferences[`${provider.id}::${capability}::${assignment.model}`] : undefined;
  const status = !provider || !assignment.model ? 'missing' : preference?.status === 'failed' ? 'unsupported' : preference?.status === 'passed' ? 'tested' : 'unknown';
  const statusText = status === 'missing' ? 'Thiếu cấu hình' : status === 'unsupported' ? 'Không hỗ trợ' : status === 'tested' ? 'Đã kiểm tra' : 'Chưa kiểm tra';
  return <div className="assignment-summary">
    <div className="assignment-summary-icon"><Settings2 size={16} /></div>
    <div className="assignment-summary-copy"><span>{label}</span><strong>{provider?.name || 'Chưa cấu hình'}</strong><small>{assignment.model || 'Chọn Provider + Model trong Cài đặt → Default Models'}</small></div>
    <span className={`assignment-summary-status ${status}`}>{statusText}</span>
  </div>;
}
