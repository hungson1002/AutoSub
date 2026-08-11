import { useEffect, useMemo, useState } from 'react';
import type { AIProvider, Capability } from '../types';
import { storage } from '../lib/storage';
import { passedModelOptions } from '../lib/modelTests';
import { SelectField } from './SelectField';

export function TestedModelSelect({ provider, capability, value, onChange, candidateModelIds = [], label = 'Mô hình AI' }: {
  provider?: AIProvider;
  capability: Capability;
  value: string;
  onChange: (model: string) => void;
  candidateModelIds?: string[];
  label?: string;
}) {
  const [preferences, setPreferences] = useState(storage.modelPreferences);
  useEffect(() => {
    const sync = () => setPreferences(storage.modelPreferences());
    window.addEventListener('autosub:model-preferences-changed', sync);
    return () => window.removeEventListener('autosub:model-preferences-changed', sync);
  }, []);
  const modelOptions = useMemo(
    () => passedModelOptions(provider, capability, preferences, [...candidateModelIds, value]),
    [candidateModelIds, capability, preferences, provider, value],
  );

  useEffect(() => {
    if (modelOptions.some((option) => option.value === value)) return;
    const nextModel = modelOptions[0]?.value || '';
    if (nextModel !== value) onChange(nextModel);
  }, [modelOptions, onChange, value]);

  const capabilityLabel = capability === 'vision' ? 'Vision' : capability === 'stt' ? 'STT' : capability === 'tts' ? 'TTS' : 'Translation';
  return <div className="field tested-model-field">
    <span>{label}</span>
    <SelectField ariaLabel={label} value={value} onChange={onChange} options={modelOptions} disabled={!modelOptions.length} />
    {!modelOptions.length && <small className="field-help">Chỉ hiện model đã test {capabilityLabel} thành công trong Cài đặt.</small>}
  </div>;
}
