import type { AIProvider, ProviderCapability, ProviderType } from '../types';
import { CircleCheck, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck, WandSparkles } from './Icons';
import { detectProviderType, hasKnownPreset, isPresetProvider, presetAuth, presetBaseUrl, presetCapabilities, presetEndpoints, providerTypeOptions, resolvedProviderType } from '../lib/providers';
import { SelectField } from './SelectField';

export type ProviderConfigMode = 'simple' | 'advanced';

const capabilityOptions: Array<[ProviderCapability, string]> = [['chat', 'Chat'], ['vision', 'Vision'], ['stt', 'STT'], ['tts', 'TTS']];
const authOptions = [['bearer', 'Bearer token'], ['xi-api-key', 'xi-api-key'], ['x-api-key', 'x-api-key'], ['api-key', 'api-key'], ['query-param', 'Query parameter'], ['none', 'Không authentication'], ['custom-header', 'Header tùy chỉnh']] as const;
const endpointOptions = ['models', 'voices', 'chat', 'vision', 'stt', 'tts'] as const;

function patchType(provider: AIProvider, nextType: ProviderType): AIProvider {
  const detected = nextType === 'auto' ? detectProviderType(provider.baseUrl) : nextType;
  const resolved = detected || 'openai-compatible';
  const knownPreset = Boolean(detected && isPresetProvider(detected));
  const auth = presetAuth(resolved);
  return {
    ...provider,
    providerType: nextType,
    baseUrl: nextType === 'groq' || nextType === 'elevenlabs' || nextType === 'hiiu-tts' ? presetBaseUrl(nextType, provider.baseUrl) : provider.baseUrl,
    ...auth,
    capabilities: knownPreset ? presetCapabilities(resolved) : nextType === 'openai-compatible' ? { chat: true } : {},
    overrideAuthentication: nextType === 'custom',
    overrideCapabilities: nextType === 'openai-compatible' || nextType === 'custom' || (nextType !== 'auto' && !knownPreset),
    overrideEndpoints: nextType === 'custom',
    endpoints: nextType === 'custom' ? provider.endpoints : undefined,
  };
}

export function ProviderConfigForm({ provider, mode, onModeChange, onChange, testing, loadingModels, onTestConnection, onLoadModels }: { provider: AIProvider; mode: ProviderConfigMode; onModeChange: (mode: ProviderConfigMode) => void; onChange: (provider: AIProvider) => void; testing: boolean; loadingModels: boolean; onTestConnection: () => void; onLoadModels: () => void }) {
  const resolved = resolvedProviderType(provider);
  const detected = provider.providerType === 'auto' ? detectProviderType(provider.baseUrl) : provider.providerType;
  const knownPreset = hasKnownPreset(provider);
  const canEditAuth = provider.providerType === 'custom' || Boolean(provider.overrideAuthentication);
  const canEditCapabilities = !knownPreset || Boolean(provider.overrideCapabilities);
  const canEditEndpoints = provider.providerType === 'custom' || Boolean(provider.overrideEndpoints);
  const auth = presetAuth(resolved);
  const preset = presetEndpoints(resolved);
  const update = (patch: Partial<AIProvider>) => onChange({ ...provider, ...patch });
  const updateBaseUrl = (baseUrl: string) => {
    if (provider.providerType !== 'auto') return update({ baseUrl });
    const nextDetected = detectProviderType(baseUrl);
    const nextResolved = nextDetected || 'openai-compatible';
    const nextKnownPreset = Boolean(nextDetected && isPresetProvider(nextDetected));
    onChange({ ...provider, baseUrl, ...presetAuth(nextResolved), capabilities: nextKnownPreset ? presetCapabilities(nextResolved) : {}, overrideAuthentication: false, overrideCapabilities: false, overrideEndpoints: false });
  };
  const updateEndpoint = (key: keyof NonNullable<AIProvider['endpoints']>, value: string) => onChange({ ...provider, overrideEndpoints: true, endpoints: { ...provider.endpoints, [key]: value } });
  const toggleCapability = (capability: ProviderCapability) => onChange({ ...provider, overrideCapabilities: true, capabilities: { ...provider.capabilities, [capability]: !provider.capabilities?.[capability] } });
  const resetPreset = () => {
    const type = provider.providerType === 'auto' ? detected : provider.providerType;
    if (!type || !isPresetProvider(type)) return onChange({ ...provider, overrideAuthentication: false, overrideCapabilities: true, overrideEndpoints: false, endpoints: undefined });
    onChange({ ...provider, baseUrl: presetBaseUrl(type, provider.baseUrl), ...presetAuth(type), capabilities: presetCapabilities(type), overrideAuthentication: false, overrideCapabilities: false, overrideEndpoints: false, endpoints: undefined });
  };

  return <div className="provider-config-form">
    <div className="provider-mode-switch" role="tablist" aria-label="Chế độ cấu hình provider">
      <button type="button" className={mode === 'simple' ? 'active' : ''} onClick={() => onModeChange('simple')}>Cơ bản<span>Thiết lập nhanh</span></button>
      <button type="button" className={mode === 'advanced' ? 'active' : ''} onClick={() => onModeChange('advanced')}>Chi tiết<span>Auth · capability · endpoint</span></button>
    </div>

    <div className="provider-form">
      <label className="field"><span>Tên</span><input autoFocus value={provider.name} placeholder="My Provider" onChange={(event) => update({ name: event.target.value })} /></label>
      <div className="field"><span>Provider type</span><SelectField ariaLabel="Provider type" value={provider.providerType} onChange={(value) => onChange(patchType(provider, value as ProviderType))} options={providerTypeOptions.map(([value, label]) => ({ value, label }))} /></div>
      <label className="field"><span>Base URL</span><input value={provider.baseUrl} placeholder={resolved === 'groq' ? 'https://api.groq.com/openai/v1' : resolved === 'elevenlabs' ? 'https://api.elevenlabs.io/v1' : 'https://example.com/v1'} onChange={(event) => updateBaseUrl(event.target.value)} /></label>
      <label className="field"><span>API Key <small>được lưu local trên máy này</small></span><input type="password" value={provider.apiKey || ''} placeholder="••••••••••••" onChange={(event) => update({ apiKey: event.target.value })} /></label>
      <label className="toggle-row"><span>Provider đang bật</span><input type="checkbox" checked={provider.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><i /></label>

      {mode === 'advanced' && <div className="provider-advanced-panel">
        <div className="provider-detail-banner"><ShieldCheck size={16} /><div><strong>{knownPreset ? `${resolved === 'groq' ? 'Groq' : resolved === 'elevenlabs' ? 'ElevenLabs' : 'HiiuTTS'} preset đang hoạt động` : provider.providerType === 'auto' ? 'Chưa xác định preset' : 'Cấu hình tùy chỉnh'}</strong><small>{knownPreset ? 'Auth, endpoint và capability đang lấy theo chuẩn provider.' : 'Bật capability cần dùng và nhập endpoint nếu provider không theo chuẩn.'}</small></div></div>

        <div className="provider-detail-block"><div className="provider-detail-label"><span>Authentication</span><small>{canEditAuth ? 'Bạn đang ghi đè cấu hình auth preset.' : 'Preset tự chọn header đúng cho provider.'}</small></div>
          {!canEditAuth ? <div className="provider-readonly-value"><LockKeyhole size={14} /><span>{auth.authType === 'custom-header' ? `${auth.authHeaderName}: API key` : 'Authorization: Bearer API key'}</span><label><input type="checkbox" checked={false} onChange={() => update({ overrideAuthentication: true })} /> Ghi đè authentication</label></div> : <div className="provider-detail-grid"><div className="field"><span>Authentication</span><SelectField ariaLabel="Authentication" value={provider.authType} onChange={(value) => update({ overrideAuthentication: true, authType: value as AIProvider['authType'] })} options={authOptions.map(([value, label]) => ({ value, label }))} /></div><label className="field"><span>Auth prefix <small>tùy chọn</small></span><input value={provider.authPrefix || ''} placeholder="Bearer" onChange={(event) => update({ overrideAuthentication: true, authPrefix: event.target.value })} /></label>{provider.authType === 'custom-header' && <label className="field"><span>Custom header name</span><input value={provider.authHeaderName || ''} placeholder="xi-api-key" onChange={(event) => update({ overrideAuthentication: true, authHeaderName: event.target.value })} /></label>}{provider.authType === 'query-param' && <label className="field"><span>Query parameter name</span><input value={provider.queryParamName || ''} placeholder="api_key" onChange={(event) => update({ overrideAuthentication: true, queryParamName: event.target.value })} /></label>}</div>}
        </div>

        <div className="provider-detail-block"><div className="provider-detail-label"><span>Capabilities</span><small>{canEditCapabilities ? 'Chọn đúng khả năng provider/model thực sự hỗ trợ.' : 'Capabilities đang khóa theo preset.'}</small></div>{canEditCapabilities ? <div className="capability-checks">{capabilityOptions.map(([key, label]) => <label key={key} className={provider.capabilities?.[key] ? 'checked' : ''}><input type="checkbox" checked={provider.capabilities?.[key] ?? false} onChange={() => toggleCapability(key)} /><span><CircleCheck size={13} /> {label}</span></label>)}</div> : <div className="capability-preset-list">{capabilityOptions.map(([key, label]) => <span className={provider.capabilities?.[key] ? 'enabled' : ''} key={key}><CircleCheck size={12} /> {label}</span>)}<label><input type="checkbox" checked={false} onChange={() => update({ overrideCapabilities: true })} /> Ghi đè capability</label></div>}</div>

        <div className="provider-detail-block"><div className="provider-detail-label"><span>Endpoint overrides</span><small>{canEditEndpoints ? 'Các endpoint dưới đây sẽ được dùng thay preset.' : 'Preset endpoint đang được dùng; không cần sửa trong cấu hình thường.'}</small></div>{canEditEndpoints ? <div className="endpoint-grid">{endpointOptions.map((key) => <label className="field" key={key}><span>{key}</span><input value={provider.endpoints?.[key] || ''} placeholder={preset[key] || `/${key}`} onChange={(event) => updateEndpoint(key, event.target.value)} /></label>)}</div> : <div className="provider-readonly-value"><LockKeyhole size={14} /><span>{Object.entries(preset).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'Không có preset endpoint'}</span><label><input type="checkbox" checked={false} onChange={() => update({ overrideEndpoints: true })} /> Ghi đè endpoint mặc định</label></div>}</div>

        {knownPreset && (provider.overrideAuthentication || provider.overrideCapabilities || provider.overrideEndpoints) && <button type="button" className="button small ghost provider-reset-button" onClick={resetPreset}><RotateCcw size={13} /> Khôi phục mặc định provider</button>}
      </div>}

      <div className="provider-model-status"><div><span>Models đã tải</span><strong>{provider.models.length}</strong></div><small>{provider.models.length ? 'Model đã cache trên provider này.' : 'Không có model cache — vẫn có thể nhập Model ID thủ công ở dropdown.'}</small></div>
      <div className="provider-connection-actions"><button className="button ghost" type="button" disabled={testing || loadingModels} onClick={onTestConnection}><ShieldCheck size={15} /> {testing ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}</button><button className="button secondary" type="button" disabled={testing || loadingModels} onClick={onLoadModels}><WandSparkles size={15} /> {loadingModels ? <><LoaderCircle className="spin" size={14} /> Đang lấy models…</> : 'Lấy models'}</button></div>
    </div>
  </div>;
}
