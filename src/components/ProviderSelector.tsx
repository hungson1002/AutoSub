import { useEffect, useMemo, useRef, useState } from 'react';
import type { AIModel, AIProvider, Capability, ModelPreference, ModelPreferences, ProviderAssignment, ProviderCapability } from '../types';
import { api } from '../lib/api';
import { storage } from '../lib/storage';
import { Bookmark, Bot, BrainCircuit, Check, ChevronDown, CircleCheck, CirclePlay, CircleX, Cpu, LoaderCircle, Search, Sparkles } from './Icons';

const preferenceKey = (providerId: string, modelId: string, capability: Capability) => `${providerId}::${capability}::${modelId}`;
const legacyPreferenceKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;
const defaultPreference: ModelPreference = { bookmarked: false, status: 'unknown' };

function modelFamily(modelId: string) {
  const id = modelId.toLowerCase();
  if (id.includes('claude')) return 'claude';
  if (id.includes('gemini')) return 'gemini';
  if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'openai';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('qwen')) return 'qwen';
  return 'generic';
}

function ModelGlyph({ modelId, size = 16 }: { modelId: string; size?: number }) {
  const family = modelFamily(modelId);
  const Icon = family === 'claude' || family === 'gemini' ? Sparkles : family === 'openai' ? BrainCircuit : family === 'deepseek' ? Bot : Cpu;
  return <span className={`model-glyph model-glyph-${family}`}><Icon size={size} /></span>;
}

function ProviderGlyph({ provider }: { provider?: AIProvider }) {
  return <span className="provider-glyph">{provider?.name.trim().slice(0, 1).toUpperCase() || 'A'}</span>;
}

function StatusMark({ status }: { status: ModelPreference['status'] }) {
  if (status === 'passed') return <span className="model-status-mark passed" title="Model đã test và hoạt động"><CircleCheck size={14} /></span>;
  if (status === 'failed') return <span className="model-status-mark failed" title="Model test thất bại"><CircleX size={14} /></span>;
  return null;
}

function capabilityLabel(capability: Capability) {
  return capability === 'vision' ? 'Vision' : capability === 'stt' ? 'STT' : capability === 'tts' ? 'TTS' : 'Chat';
}

function modelCapabilityState(model: AIModel, capability: ProviderCapability) {
  if (model.capabilities?.[capability] === true) return 'Đã xác định';
  if (model.capabilities?.[capability] === false) return 'Không hỗ trợ';
  return 'Chưa xác định';
}

export function ProviderSelector({ providers, value, onChange, label = 'Provider', capability = 'translation', onNotice }: { providers: AIProvider[]; value: ProviderAssignment; onChange: (value: ProviderAssignment) => void; label?: string; capability?: Capability; onNotice?: (message: string, kind?: 'success' | 'error') => void }) {
  const provider = providers.find((item) => item.id === value.providerId);
  const providerCapability: ProviderCapability = capability === 'translation' ? 'chat' : capability;
  const enabledProviders = providers.filter((item) => item.enabled);
  const providerRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState('');
  const [query, setQuery] = useState('');
  const [preferences, setPreferences] = useState<ModelPreferences>(() => storage.modelPreferences());
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [modelFilter, setModelFilter] = useState<'all' | 'passed' | 'failed' | 'bookmarked'>('all');
  const capabilityName = capabilityLabel(capability);

  const readPreference = (modelId: string) => {
    const current = preferences[preferenceKey(provider?.id || '', modelId, capability)];
    const legacy = preferences[legacyPreferenceKey(provider?.id || '', modelId)];
    return current || { ...defaultPreference, bookmarked: legacy?.bookmarked || false };
  };

  useEffect(() => {
    const sync = () => setPreferences(storage.modelPreferences());
    window.addEventListener('autosub:model-preferences-changed', sync);
    return () => window.removeEventListener('autosub:model-preferences-changed', sync);
  }, []);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!providerRef.current?.contains(target)) setProviderOpen(false);
      if (!modelRef.current?.contains(target)) setModelOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const visibleProviders = useMemo(() => {
    const needle = providerQuery.trim().toLowerCase();
    return enabledProviders.filter((item) => `${item.name} ${item.baseUrl}`.toLowerCase().includes(needle));
  }, [enabledProviders, providerQuery]);

  const sortedModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (provider?.models || [])
      .filter((model) => !needle || `${model.id} ${model.name || ''}`.toLowerCase().includes(needle))
      .filter((model) => {
        const preference = readPreference(model.id);
        return modelFilter === 'all' || (modelFilter === 'passed' && preference.status === 'passed') || (modelFilter === 'failed' && preference.status === 'failed') || (modelFilter === 'bookmarked' && preference.bookmarked);
      })
      .sort((a, b) => {
        const aPreference = readPreference(a.id);
        const bPreference = readPreference(b.id);
        return Number(b.id === value.model) - Number(a.id === value.model) || Number(bPreference.bookmarked) - Number(aPreference.bookmarked) || a.id.localeCompare(b.id);
      });
  }, [capability, modelFilter, preferences, provider, providerCapability, query, value.model]);

  const selectedModel = provider?.models.find((model) => model.id === value.model);
  const selectedPreference = value.model ? readPreference(value.model) : defaultPreference;
  const manualQuery = query.trim();
  const hasExactModel = Boolean(provider?.models.some((model) => model.id.toLowerCase() === manualQuery.toLowerCase()));

  const selectProvider = (providerId: string) => {
    onChange({ providerId, model: '' });
    setProviderOpen(false);
    setProviderQuery('');
  };

  const updatePreference = (modelId: string, patch: Partial<ModelPreference>) => {
    if (!provider) return;
    const key = preferenceKey(provider.id, modelId, capability);
    const legacy = preferences[legacyPreferenceKey(provider.id, modelId)];
    const current = preferences[key] || { ...defaultPreference, bookmarked: legacy?.bookmarked || false };
    const next = { ...preferences, [key]: { ...current, ...patch } };
    setPreferences(next);
    storage.saveModelPreferences(next);
  };

  const selectModel = (modelId: string) => {
    onChange({ ...value, model: modelId });
    setQuery('');
    setModelOpen(false);
  };

  const chooseModel = (model: AIModel) => {
    if (readPreference(model.id).status === 'failed') {
      onNotice?.(`${model.id} không hỗ trợ capability ${capabilityName}. Hãy chọn model có trạng thái Chạy được.`, 'error');
      return;
    }
    selectModel(model.id);
  };

  const testModel = async (model: AIModel) => {
    if (!provider) return;
    const key = preferenceKey(provider.id, model.id, capability);
    setTesting((current) => ({ ...current, [key]: true }));
    try {
      const result = await api.testModel(provider, model.id, undefined, capability);
      updatePreference(model.id, { status: 'passed', lastTestedAt: Date.now(), error: undefined });
      onNotice?.(`${model.id} · ${capabilityName} hoạt động · ${result.latencyMs}ms`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test model thất bại.';
      updatePreference(model.id, { status: 'failed', lastTestedAt: Date.now(), error: message });
      onNotice?.(`${model.id} · ${capabilityName}: ${message}`, 'error');
    } finally {
      setTesting((current) => ({ ...current, [key]: false }));
    }
  };

  const toggleModelPicker = () => {
    const nextOpen = !modelOpen;
    if (nextOpen && provider) {
      const hasPassed = provider.models.some((model) => readPreference(model.id).status === 'passed');
      setModelFilter(selectedPreference.status === 'failed' ? 'all' : hasPassed ? 'passed' : 'all');
    }
    setModelOpen(nextOpen);
    setQuery('');
    setProviderOpen(false);
  };

  return <div className="field-grid">
    <div className="field" ref={providerRef}><span>{label}</span><div className="provider-picker">
      <button type="button" className={`provider-picker-trigger ${providerOpen ? 'open' : ''}`} disabled={!enabledProviders.length} onClick={() => { setProviderOpen((current) => !current); setProviderQuery(''); setModelOpen(false); }}><ProviderGlyph provider={provider} /><span className="provider-trigger-copy"><strong>{provider?.name || (enabledProviders.length ? 'Chọn provider' : 'Chưa có provider bật')}</strong>{provider && <small>{provider.baseUrl}</small>}</span><ChevronDown className="provider-chevron" size={16} /></button>
      {providerOpen && <div className="provider-popover"><div className="provider-search"><Search size={15} /><input autoFocus value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder="Tìm provider…" /></div><div className="provider-option-list">{visibleProviders.map((item) => { const capabilityState = item.capabilities?.[providerCapability] === true ? 'ready' : item.capabilities?.[providerCapability] === false ? 'unsupported' : 'unknown'; const capabilityText = capabilityState === 'ready' ? 'Sẵn sàng' : capabilityState === 'unsupported' ? `Không hỗ trợ ${capabilityName}` : 'Chưa xác định'; return <button type="button" className={`provider-option ${item.id === value.providerId ? 'selected' : ''}`} key={item.id} onClick={() => selectProvider(item.id)}><ProviderGlyph provider={item} /><span className="provider-option-copy"><strong>{item.name}</strong><small>{item.baseUrl}</small></span><span className={`provider-capability-status ${capabilityState}`}>{capabilityText}</span><span className={`provider-enabled-dot ${capabilityState}`} />{item.id === value.providerId && <Check size={15} />}</button>; })}{!visibleProviders.length && <div className="provider-empty">Không tìm thấy provider bật.</div>}</div><div className="provider-popover-foot">Hiển thị mọi provider Enabled. “Chưa xác định” chỉ là trạng thái; provider vẫn có thể được chọn và test.</div></div>}
    </div></div>
    <div className="field" ref={modelRef}><span>Model <small>· test {capabilityName}</small></span><div className="model-picker">
      <button type="button" className={`model-picker-trigger ${modelOpen ? 'open' : ''}`} disabled={!provider} onClick={toggleModelPicker}>{value.model ? <ModelGlyph modelId={value.model} /> : <span className="model-glyph model-glyph-generic"><Cpu size={16} /></span>}<span className="model-trigger-copy"><strong>{selectedModel?.name || value.model || (provider ? 'Chọn hoặc nhập model' : 'Chọn provider trước')}</strong>{value.model && <small>{selectedModel?.name ? selectedModel.id : 'Model ID thủ công'}</small>}</span><StatusMark status={selectedPreference.status} /><ChevronDown className="model-chevron" size={16} /></button>
      {modelOpen && provider && <div className="model-popover"><div className="model-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && manualQuery && !hasExactModel) selectModel(manualQuery); }} placeholder="Tìm model hoặc nhập Model ID…" /><kbd>⌘ K</kbd></div><div className="model-popover-head"><span>{sortedModels.length} model · bookmark sẽ lên đầu</span>{selectedPreference.status === 'passed' && value.model && <span className="model-ready"><CircleCheck size={13} /> Đã kiểm tra {capabilityName}</span>}</div><div className="model-filters"><button type="button" className={modelFilter === 'all' ? 'active' : ''} onClick={() => setModelFilter('all')}>Tất cả</button><button type="button" className={modelFilter === 'passed' ? 'active' : ''} onClick={() => setModelFilter('passed')}><CircleCheck size={12} /> Chạy được</button><button type="button" className={modelFilter === 'failed' ? 'active' : ''} onClick={() => setModelFilter('failed')}><CircleX size={12} /> Lỗi</button><button type="button" className={modelFilter === 'bookmarked' ? 'active' : ''} onClick={() => setModelFilter('bookmarked')}><Bookmark size={12} /> Bookmark</button></div><div className="model-list">{manualQuery && !hasExactModel && <div className="model-manual-row" role="button" tabIndex={0} onClick={() => selectModel(manualQuery)} onKeyDown={(event) => { if (event.key === 'Enter') selectModel(manualQuery); }}><Bot size={16} /><span><strong>Dùng Model ID này</strong><small>{manualQuery}</small></span><Check size={15} /></div>}{sortedModels.map((model) => { const key = preferenceKey(provider.id, model.id, capability); const preference = readPreference(model.id); const isTesting = Boolean(testing[key]); const capabilityState = modelCapabilityState(model, providerCapability); return <div className={`model-option ${value.model === model.id ? 'selected' : ''} ${preference.status === 'failed' ? 'unsupported' : ''}`} key={model.id} role="option" aria-selected={value.model === model.id} tabIndex={0} onClick={() => chooseModel(model)} onKeyDown={(event) => { if (event.key === 'Enter') chooseModel(model); }}><ModelGlyph modelId={model.id} /><span className="model-option-copy"><strong>{model.name || model.id}</strong><small>{model.name ? model.id : 'OpenAI-compatible model'} · {capabilityName}: {capabilityState}</small></span><StatusMark status={preference.status} /><button type="button" className={`model-bookmark ${preference.bookmarked ? 'active' : ''}`} title={preference.bookmarked ? 'Bỏ bookmark' : 'Bookmark model'} onClick={(event) => { event.stopPropagation(); updatePreference(model.id, { bookmarked: !preference.bookmarked }); }}><Bookmark size={15} fill={preference.bookmarked ? 'currentColor' : 'none'} /></button><button type="button" className="model-test" disabled={isTesting} title={`Test ${capabilityName}`} onClick={(event) => { event.stopPropagation(); void testModel(model); }}>{isTesting ? <LoaderCircle className="spin" size={15} /> : preference.status === 'passed' ? <CircleCheck size={15} /> : preference.status === 'failed' ? <CircleX size={15} /> : <CirclePlay size={15} />}</button></div>; })}{!sortedModels.length && !manualQuery && <div className="model-empty">Provider chưa có model. Nhập Model ID ở ô tìm kiếm.</div>}</div><div className="model-popover-foot"><Sparkles size={13} /> Test thật capability <b>{capabilityName}</b>, không chỉ kiểm tra danh sách model.</div></div>}
    </div></div>
  </div>;
}
