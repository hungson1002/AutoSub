import { useEffect, useState } from 'react';
import type { AIProvider, AppSettings, SubtitleCue, VideoAsset } from './types';
import { storage } from './lib/storage';
import { Layout, type Page } from './components/Layout';
import { TranslatePage } from './pages/TranslatePage';
import { ExtractPage } from './pages/ExtractPage';
import { EditorPage } from './pages/EditorPage';
import { SettingsPage } from './pages/SettingsPage';
import { X, Check } from './components/Icons';
import { createCapCutTtsProvider } from './lib/providers';

export default function App() {
  const [page, setPage] = useState<Page>('translate'); const [providers, setProviders] = useState<AIProvider[]>(() => storage.providers()); const [settings, setSettings] = useState<AppSettings>(storage.settings); const [cues, setCues] = useState<SubtitleCue[]>(storage.cues); const [asset, setAsset] = useState<VideoAsset | undefined>(storage.asset); const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' }>();
  useEffect(() => { storage.saveCues(cues); }, [cues]); useEffect(() => { storage.saveSettings(settings); }, [settings]); useEffect(() => { storage.saveProviders(providers); }, [providers]); useEffect(() => { storage.saveAsset(asset); }, [asset]); useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(undefined), 4300); return () => window.clearTimeout(id); }, [toast]);
  useEffect(() => { setProviders((current) => current.some((provider) => provider.providerType === 'capcut-tts' || provider.id === 'capcut-tts-local') ? current : [...current, createCapCutTtsProvider()]); }, []);
  const notice = (message: string, kind: 'success' | 'error' = 'success') => setToast({ message, kind });
  const openEditor = () => setPage('editor');
  return <><Layout page={page} setPage={setPage} cueCount={cues.length} providerCount={providers.length}>{page === 'translate' && <TranslatePage providers={providers} settings={settings} cues={cues} onCuesChange={setCues} onOpenEditor={openEditor} onNotice={notice} />}{page === 'extract' && <ExtractPage providers={providers} settings={settings} onCuesChange={setCues} onAssetChange={setAsset} onOpenEditor={openEditor} onNotice={notice} />}{page === 'editor' && <EditorPage providers={providers} settings={settings} onSettingsChange={setSettings} cues={cues} onCuesChange={setCues} asset={asset} onAssetChange={setAsset} onNotice={notice} />}{page === 'settings' && <SettingsPage providers={providers} onProvidersChange={setProviders} settings={settings} onSettingsChange={setSettings} onNotice={notice} />}</Layout>{toast && <div className={`toast ${toast.kind}`}><span className="toast-mark">{toast.kind === 'success' ? <Check size={14} /> : <X size={14} />}</span><span className="toast-message">{toast.message}</span><button className="icon-button" onClick={() => setToast(undefined)}><X size={14} /></button></div>}</>;
}
