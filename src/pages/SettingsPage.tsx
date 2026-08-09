import { useEffect, useRef, useState } from 'react';
import type { AIProvider, AppSettings, Capability } from '../types';
import { api, friendlyErrorMessage } from '../lib/api';
import { storage } from '../lib/storage';
import { Modal } from '../components/Modal';
import { ProviderSelector } from '../components/ProviderSelector';
import { ProviderConfigForm, type ProviderConfigMode } from '../components/ProviderConfigForm';
import { CapabilityProvidersPanel } from '../components/CapabilityProvidersPanel';
import { Check, ChevronDown, CirclePlay, LoaderCircle, Plus, RefreshCw, Settings2, Trash2, X, Zap } from '../components/Icons';
import { normalizeProvider, presetCapabilities, resolvedProviderType } from '../lib/providers';
import { capabilityAssignments, updateCapabilityAssignments } from '../lib/settings';

const emptyProvider = (): AIProvider => ({ id: crypto.randomUUID(), name: '', baseUrl: '', apiKey: '', enabled: true, models: [], providerType: 'auto', authType: 'bearer', capabilities: presetCapabilities('openai-compatible') });
const normalizeProviderBaseUrl = (value: string) => value.trim().replace(/\/(?:audio\/(?:speech|transcriptions|translations)|chat\/completions|models)\/?$/i, '');
const providerErrorMessage = friendlyErrorMessage;
const capabilityLabels: Array<[Capability, string, string]> = [['translation', 'Translation', 'Dịch batch subtitle'], ['vision', 'OCR / Vision', 'Nhận dạng text trong ROI'], ['stt', 'STT', 'Trích xuất từ âm thanh'], ['tts', 'TTS', 'Lồng tiếng theo cue']];
type BatchState = { providerName: string; capability: Capability; total: number; current: number; passed: number; failed: number; phase: 'loading' | 'testing' };

function BatchProgress({ batch, batchKey, onCancel }: { batch: BatchState; batchKey: string; onCancel: () => void }) {
  const percent = batch.total ? Math.round((batch.current / batch.total) * 100) : 0;
  const label = capabilityLabels.find(([key]) => key === batch.capability)?.[1] || batch.capability;
  return <div className="batch-progress-card assignment-batch-progress" aria-live="polite">
    <div className="batch-progress-head">
      <div><strong><LoaderCircle className="spin" size={13} /> {batch.phase === 'loading' ? 'Đang tải danh sách model' : `Đang test ${label}`}</strong><small>{batch.phase === 'loading' ? 'Đang chuẩn bị danh sách model…' : `${batch.current}/${batch.total} model`}</small></div>
      <div className="batch-progress-stats"><span className="passed">{batch.passed} pass</span><span className="failed">{batch.failed} lỗi</span><button className="icon-button" title={`Hủy test ${batchKey}`} onClick={onCancel}><X size={13} /></button></div>
    </div>
    <div className="batch-progress-track"><div className={batch.phase === 'loading' ? 'indeterminate' : undefined} style={{ width: `${batch.phase === 'loading' ? 34 : percent}%` }} /></div>
  </div>;
}

export function SettingsPage({ providers, onProvidersChange, settings, onSettingsChange, onNotice }: { providers: AIProvider[]; onProvidersChange: (providers: AIProvider[]) => void; settings: AppSettings; onSettingsChange: (settings: AppSettings) => void; onNotice: (message: string, kind?: 'success' | 'error') => void }) {
  const [providerDraft, setProviderDraft] = useState<AIProvider>();
  const [system, setSystem] = useState<{ ffmpeg: boolean; ffprobe: boolean; workdir: string }>();
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [configMode, setConfigMode] = useState<ProviderConfigMode>('simple');
  const [showCapabilityProviders, setShowCapabilityProviders] = useState(false);
  const [cleaningTemporaryFiles, setCleaningTemporaryFiles] = useState(false);
  const [batches, setBatches] = useState<Record<string, BatchState>>({});
  const batchControllers = useRef<Record<string, AbortController>>({});

  useEffect(() => { void api.system().then(setSystem).catch(() => setSystem({ ffmpeg: false, ffprobe: false, workdir: settings.workdir })); }, [settings.workdir]);

  const openProvider = (provider: AIProvider) => { setProviderDraft(provider); setConfigMode('simple'); };

  const saveProvider = () => {
    if (!providerDraft?.name.trim() || !providerDraft.baseUrl.trim()) { onNotice('Tên và Base URL là bắt buộc.', 'error'); return; }
    const normalized = normalizeProvider({ ...providerDraft, baseUrl: normalizeProviderBaseUrl(providerDraft.baseUrl) });
    const next = providers.some((item) => item.id === normalized.id) ? providers.map((item) => item.id === normalized.id ? normalized : item) : [...providers, normalized];
    onProvidersChange(next); storage.saveProviders(next); setProviderDraft(undefined); onNotice(`Đã lưu provider ${normalized.name}.`, 'success');
  };

  const updateProvider = (provider: AIProvider) => { const next = providers.map((item) => item.id === provider.id ? provider : item); onProvidersChange(next); storage.saveProviders(next); };
  const toggleProvider = (provider: AIProvider) => updateProvider({ ...provider, enabled: !provider.enabled });

  const testConnection = async (provider: AIProvider) => {
    setTesting(true);
    const normalized = { ...provider, baseUrl: normalizeProviderBaseUrl(provider.baseUrl) };
    setProviderDraft(normalized);
    try {
      const result = await api.testProvider(normalized);
      setProviderDraft((current) => current?.id === provider.id ? normalized : current);
      onNotice(result.warning || 'Kết nối provider thành công.', 'success');
    } catch (error) { onNotice(providerErrorMessage(error, 'Test connection thất bại.'), 'error'); }
    finally { setTesting(false); }
  };

  const loadModels = async (provider: AIProvider) => {
    setLoadingModels(true);
    const normalized = { ...provider, baseUrl: normalizeProviderBaseUrl(provider.baseUrl) };
    try {
      const result = await api.listModels(normalized);
      let voices = normalized.voices;
      if (resolvedProviderType(normalized) === 'elevenlabs' || resolvedProviderType(normalized) === 'capcut-tts') {
        try { voices = (await api.listVoices(normalized)).voices; } catch (error) { onNotice(providerErrorMessage(error, 'Không thể lấy voices.'), 'error'); }
      }
      const models = result.warning && !result.models.length ? normalized.models : result.models;
      const nextProvider = { ...normalized, models, voices };
      setProviderDraft((current) => current?.id === provider.id ? nextProvider : current);
      if (providers.some((item) => item.id === provider.id)) updateProvider(nextProvider);
      onNotice(result.warning || `Đã tải ${models.length} model.`, 'success');
    } catch (error) { onNotice(providerErrorMessage(error, 'Lấy models thất bại.'), 'error'); }
    finally { setLoadingModels(false); }
  };

  const refresh = async (provider: AIProvider) => {
    try {
      const normalized = { ...provider, baseUrl: normalizeProviderBaseUrl(provider.baseUrl) };
      const result = await api.listModels(normalized);
      let voices = normalized.voices;
      if (resolvedProviderType(normalized) === 'elevenlabs' || resolvedProviderType(normalized) === 'capcut-tts') { try { voices = (await api.listVoices(normalized)).voices; } catch { /* model refresh vẫn dùng được nếu voice endpoint tạm lỗi */ } }
      const models = result.warning && !result.models.length ? normalized.models : result.models;
      updateProvider({ ...normalized, models, voices });
      onNotice(result.warning || `Đã refresh ${models.length} model.`, 'success');
    } catch (error) { onNotice(providerErrorMessage(error, 'Refresh models thất bại.'), 'error'); }
  };

  const testAll = async (provider: AIProvider, capability: Capability = 'translation') => {
    const batchKey = `${provider.id}::${capability}`;
    setBatches((previous) => ({ ...previous, [batchKey]: { providerName: provider.name, capability, total: provider.models.length, current: 0, passed: 0, failed: 0, phase: 'loading' } }));
    const controller = new AbortController();
    batchControllers.current[batchKey] = controller;
    let target = provider;
    try {
      const result = await api.listModels(provider, controller.signal);
      target = { ...provider, models: result.warning && !result.models.length ? provider.models : result.models };
      updateProvider(target);
    } catch (error) {
      if (controller.signal.aborted) { delete batchControllers.current[batchKey]; setBatches((current) => { const next = { ...current }; delete next[batchKey]; return next; }); return; }
      if (!provider.models.length) { delete batchControllers.current[batchKey]; setBatches((current) => { const next = { ...current }; delete next[batchKey]; return next; }); onNotice(providerErrorMessage(error, 'Không thể lấy models từ provider.'), 'error'); return; }
      onNotice(`Không refresh được models; sẽ test ${provider.models.length} model đang lưu.`, 'error');
    }
    const models = target.models;
    if (!models.length) { delete batchControllers.current[batchKey]; setBatches((current) => { const next = { ...current }; delete next[batchKey]; return next; }); onNotice('Provider chưa có model. Hãy kiểm tra lại Base URL.', 'error'); return; }
    let passed = 0;
    let failed = 0;
    let completed = 0;
    let cursor = 0;
    const updateBatch = () => setBatches((previous) => ({ ...previous, [batchKey]: { providerName: provider.name, capability, total: models.length, current: completed, passed, failed, phase: 'testing' } }));
    const saveStatus = (modelId: string, status: 'passed' | 'failed', error?: string) => {
      const current = storage.modelPreferences();
      const key = `${provider.id}::${capability}::${modelId}`;
      storage.saveModelPreferences({ ...current, [key]: { ...(current[key] || { bookmarked: false, status: 'unknown' }), status, lastTestedAt: Date.now(), error } });
    };
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = cursor;
        cursor += 1;
        const model = models[index];
        if (!model) return;
        try {
          await api.testModel(target, model.id, controller.signal, capability);
          passed += 1;
          saveStatus(model.id, 'passed');
        } catch (error) {
          if (controller.signal.aborted) return;
          failed += 1;
          saveStatus(model.id, 'failed', providerErrorMessage(error, 'Test thất bại.'));
        } finally {
          completed += 1;
          updateBatch();
        }
      }
    };
    updateBatch();
    try {
      await Promise.all(Array.from({ length: Math.min(4, models.length) }, () => worker()));
      if (controller.signal.aborted) onNotice(`Đã hủy test ${provider.name} · ${capability} · ${passed} pass, ${failed} lỗi.`, 'error');
      else onNotice(`Đã test ${models.length} model · ${capability} · ${passed} chạy được, ${failed} lỗi.`, failed ? 'error' : 'success');
    } finally {
      delete batchControllers.current[batchKey];
      setBatches((current) => { const next = { ...current }; delete next[batchKey]; return next; });
    }
  };

  const cleanupTemporaryStorage = async () => {
    if (!window.confirm('Dọn cache và file xử lý trung gian? Video đã tải lên và kết quả lồng tiếng đang lưu sẽ được giữ lại.')) return;
    setCleaningTemporaryFiles(true);
    try {
      const cleaned = await api.cleanupTemporaryFiles();
      const megabytes = cleaned.freedBytes / 1024 / 1024;
      const size = megabytes >= 1024 ? `${(megabytes / 1024).toFixed(2)} GB` : `${megabytes.toFixed(1)} MB`;
      const skipped = cleaned.skippedActiveJobs || cleaned.skippedRecentFiles ? ` Đã bỏ qua ${cleaned.skippedActiveJobs} job đang hoạt động và ${cleaned.skippedRecentFiles} mục mới tạo.` : '';
      onNotice(`Đã dọn ${cleaned.removedFiles} file, giải phóng ${size}.${skipped}`, 'success');
    } catch (error) {
      onNotice(providerErrorMessage(error, 'Không thể dọn bộ nhớ tạm.'), 'error');
    } finally {
      setCleaningTemporaryFiles(false);
    }
  };

  return <div className="page settings-page">
    <Modal open={!!providerDraft} title={providerDraft?.id && providers.some((item) => item.id === providerDraft.id) ? 'Sửa provider' : 'Thêm provider'} eyebrow="AI PROVIDER" className="provider-config-modal" onClose={() => setProviderDraft(undefined)}>
      {providerDraft && <ProviderConfigForm
        provider={providerDraft}
        mode={configMode}
        onModeChange={setConfigMode}
        onChange={setProviderDraft}
        testing={testing}
        loadingModels={loadingModels}
        onTestConnection={() => { if (providerDraft) void testConnection(providerDraft); }}
        onLoadModels={() => { if (providerDraft) void loadModels(providerDraft); }}
      />}
      <div className="modal-actions">
        <button className="button ghost" onClick={() => setProviderDraft(undefined)}>Hủy</button>
        <button className="button primary" onClick={saveProvider}><Check size={15} /> Lưu provider</button>
      </div>
    </Modal>
    <header className="page-header"><div><div className="eyebrow">SYSTEM / LOCAL CONFIG</div><h1>Cài <span>đặt</span></h1><p>Provider, model mặc định và trạng thái media trên máy này.</p></div><button className="button primary" onClick={() => openProvider(emptyProvider())}><Plus size={16} /> Thêm provider</button></header>
    <section className="settings-section"><div className="settings-heading"><div><h2>AI Providers</h2><p>Mỗi provider chỉ lưu trên localStorage. API key không được ghi vào log.</p></div><span className="count-label">{providers.length} provider</span></div><div className="provider-list">
      {providers.length === 0 ? <div className="empty-settings"><div className="empty-glyph"><Zap size={22} /></div><h3>Chưa có provider</h3><p>Thêm Base URL và API Key của provider bạn muốn sử dụng.</p><button className="button secondary" onClick={() => openProvider(emptyProvider())}><Plus size={15} /> Thêm provider đầu tiên</button></div> : providers.map((provider) => <div className="provider-card" key={provider.id}><div className="provider-card-icon"><Settings2 size={17} /></div><div className="provider-card-main"><div className="provider-card-title"><strong>{provider.name}</strong><span className={provider.enabled ? 'enabled' : 'disabled'}><i /> {provider.enabled ? 'Enabled' : 'Disabled'}</span></div><p>{provider.baseUrl}</p><small>{provider.models.length ? `${provider.models.length} model đã tải` : 'Chưa tải model'}</small></div><div className="provider-card-actions"><button className="icon-button" onClick={() => void refresh(provider)} title="Refresh models"><RefreshCw size={15} /></button><button className="button small ghost" onClick={() => toggleProvider(provider)}>{provider.enabled ? 'Tắt' : 'Bật'}</button><button className="button small ghost" onClick={() => openProvider(provider)}>Sửa</button><button className="icon-button danger-icon" onClick={() => { if (!window.confirm(`Xóa ${provider.name}?`)) return; const next = providers.filter((item) => item.id !== provider.id); onProvidersChange(next); storage.saveProviders(next); }}><Trash2 size={15} /></button></div></div>)}
    </div></section>
    <section className="settings-section"><div className="settings-heading"><div><h2>Default Models</h2><p>Chọn riêng provider mặc định cho từng capability. Mỗi nút test chỉ gọi đúng capability đang cấu hình.</p></div></div><div className="assignment-grid">{capabilityLabels.map(([key, label, description]) => { const selectedProvider = providers.find((item) => item.id === settings.assignments[key].providerId); const running = batches[`${selectedProvider?.id || ''}::${key}`]; const batchKey = `${selectedProvider?.id || ''}::${key}`; return <div className="assignment-card" key={key}><div className="assignment-card-heading"><div><span>{label}</span><small>{description}</small></div></div><ProviderSelector providers={providers} value={settings.assignments[key]} onChange={(value) => onSettingsChange(updateCapabilityAssignments(settings, key, [value, ...capabilityAssignments(settings, key).filter((item) => item.providerId !== value.providerId || item.model !== value.model)]))} label="Provider" capability={key} onNotice={onNotice} /><div className={`assignment-test-zone ${running ? 'running' : ''}`}><div className="assignment-test-action"><span className="assignment-test-caption"><CirclePlay size={13} /> Kiểm tra tất cả model</span>{selectedProvider ? <button className="button small ghost" disabled={!!running} onClick={() => void testAll(selectedProvider, key)}>{running ? <LoaderCircle className="spin" size={12} /> : <CirclePlay size={12} />} {running ? 'Đang chạy…' : 'Test tất cả'}</button> : <span className="assignment-test-muted">Chọn provider trước</span>}</div>{running ? <BatchProgress batch={running} batchKey={batchKey} onCancel={() => batchControllers.current[batchKey]?.abort()} /> : <small className="assignment-test-hint">Test thật capability này trên toàn bộ model đã tải.</small>}</div></div>; })}</div></section>
    <div className={`settings-assignment-toggle ${showCapabilityProviders ? 'open' : ''}`}><button className="button ghost" onClick={() => setShowCapabilityProviders((current) => !current)}><span><strong>Capability Providers</strong><small>Danh sách provider bổ sung cho từng chức năng</small></span><ChevronDown size={16} /></button></div>
    {showCapabilityProviders && <CapabilityProvidersPanel providers={providers} settings={settings} onSettingsChange={onSettingsChange} onNotice={onNotice} />}
    <section className="settings-section system-section"><div className="settings-heading"><div><h2>System</h2><p>Ứng dụng dùng child_process.spawn với argument array để chạy media.</p></div></div><div className="system-grid"><div className="system-row"><span>FFmpeg</span><strong className={system?.ffmpeg ? 'system-ok' : 'system-bad'}><i /> {system ? system.ffmpeg ? 'Sẵn sàng' : 'Chưa cài / chưa có trong PATH' : 'Đang kiểm tra…'}</strong></div><div className="system-row"><span>FFprobe</span><strong className={system?.ffprobe ? 'system-ok' : 'system-bad'}><i /> {system ? system.ffprobe ? 'Sẵn sàng' : 'Chưa cài / chưa có trong PATH' : 'Đang kiểm tra…'}</strong></div><div className="system-row"><span>Workdir</span><code>{system?.workdir || settings.workdir}</code></div><button className="button ghost" disabled={cleaningTemporaryFiles} onClick={() => void cleanupTemporaryStorage()}>{cleaningTemporaryFiles ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} {cleaningTemporaryFiles ? 'Đang dọn…' : 'Dọn file tạm'}</button></div></section>
  </div>;
}
