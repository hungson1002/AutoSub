import type { AIProvider, Capability, ProviderAssignment } from '../types';
import { configuredAssignmentChoices } from '../lib/settings';
import { SelectField } from './SelectField';

export function CapabilityAssignmentPicker({ capability, assignments, providers, value, onChange, label = 'Provider + Model' }: {
  capability: Capability;
  assignments: ProviderAssignment[];
  providers: AIProvider[];
  value: ProviderAssignment;
  onChange: (value: ProviderAssignment) => void;
  label?: string;
}) {
  const configured = configuredAssignmentChoices(assignments);
  const selectedIndex = configured.findIndex((item) => item.providerId === value.providerId && item.model === value.model);
  const providerFallbackIndex = configured.findIndex((item) => item.providerId === value.providerId);
  const choices = selectedIndex >= 0 || (!value.providerId && !value.model) || (!value.model && providerFallbackIndex >= 0)
    ? configured
    : [value, ...configured];
  const exactChoiceIndex = choices.findIndex((item) => item.providerId === value.providerId && item.model === value.model);
  const activeIndex = !choices.length
    ? -1
    : exactChoiceIndex >= 0
      ? exactChoiceIndex
      : Math.max(0, choices.findIndex((item) => item.providerId === value.providerId));
  const options = choices.map((assignment, index) => {
    const provider = providers.find((item) => item.id === assignment.providerId);
    return {
      value: String(index),
      label: provider?.name || 'Chưa chọn provider',
      description: `${assignment.model || 'Chưa chọn model'} · ${capability === 'vision' ? 'Vision' : capability === 'stt' ? 'STT' : capability === 'tts' ? 'TTS' : 'Translation'}`,
    };
  });

  return <div className="capability-assignment-picker">
    <div className="field"><span>{label}</span><SelectField ariaLabel={label} value={activeIndex >= 0 ? String(activeIndex) : ''} onChange={(index) => { const next = choices[Number(index)]; if (next) onChange(next); }} options={options} disabled={!options.length} /></div>
    {!options.length && <small className="field-help">Hãy thêm provider/model cho capability này trong Cài đặt → Default Models.</small>}
  </div>;
}
