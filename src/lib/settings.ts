import type { AppSettings, Capability, CapabilityAssignments, ProviderAssignment } from '../types';
import { defaultSettings } from '../types';

export const capabilities: Capability[] = ['translation', 'vision', 'stt', 'tts'];

export const emptyAssignment = (): ProviderAssignment => ({ providerId: '', model: '' });

const assignmentKey = (assignment: ProviderAssignment) => `${assignment.providerId}::${assignment.model}`;

function validAssignment(value: unknown): value is ProviderAssignment {
  return Boolean(value && typeof value === 'object' && typeof (value as ProviderAssignment).providerId === 'string' && typeof (value as ProviderAssignment).model === 'string');
}

function uniqueAssignments(values: ProviderAssignment[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!validAssignment(value)) return false;
    const key = assignmentKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Return the configured choices for a capability, with legacy fallback. */
export function capabilityAssignments(settings: AppSettings, capability: Capability): ProviderAssignment[] {
  const configured = settings.providersByCapability?.[capability];
  if (Array.isArray(configured) && configured.length) return uniqueAssignments(configured);
  const legacy = settings.assignments?.[capability];
  return validAssignment(legacy) && (legacy.providerId || legacy.model) ? [legacy] : [];
}

/**
 * Migrate localStorage settings written before multi-provider capability
 * choices existed. The first configured choice remains the default.
 */
export function normalizeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const rawAssignments = (value?.assignments || {}) as Partial<AppSettings['assignments']>;
  const rawLists = (value?.providersByCapability || {}) as Partial<CapabilityAssignments>;
  const assignments = { ...defaultSettings.assignments };
  const providersByCapability: CapabilityAssignments = { translation: [], vision: [], stt: [], tts: [] };

  for (const capability of capabilities) {
    const legacy = validAssignment(rawAssignments[capability]) ? rawAssignments[capability] : emptyAssignment();
    const configured = Array.isArray(rawLists[capability]) ? uniqueAssignments(rawLists[capability]) : [];
    const choices = configured.length ? configured : (legacy.providerId || legacy.model ? [legacy] : []);
    providersByCapability[capability] = choices;
    assignments[capability] = legacy.providerId || legacy.model ? legacy : choices[0] || emptyAssignment();
  }

  const rawStyle = (value?.subtitleStyle || {}) as Partial<AppSettings['subtitleStyle']>;
  const subtitleStyle = {
    ...defaultSettings.subtitleStyle,
    ...rawStyle,
    // Older localStorage snapshots could contain "true"/"false" strings.
    // Keep the preview and ASS/libass export on the same boolean state.
    bold: rawStyle.bold === true,
    italic: rawStyle.italic === true,
  };

  return {
    ...defaultSettings,
    ...value,
    assignments,
    providersByCapability,
    subtitleStyle,
  };
}

export function updateCapabilityAssignments(settings: AppSettings, capability: Capability, choices: ProviderAssignment[]): AppSettings {
  const nextChoices = uniqueAssignments(choices);
  return {
    ...settings,
    assignments: { ...settings.assignments, [capability]: nextChoices[0] || emptyAssignment() },
    providersByCapability: { ...settings.providersByCapability, [capability]: nextChoices },
  };
}
