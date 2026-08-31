import { useCallback, useEffect, useState } from "react";
import type { AIProvider, AppSettings, SubtitleCue, VideoAsset } from "./types";
import { storage } from "./lib/storage";
import { Layout, type Page } from "./components/Layout";
import { TranslatePage } from "./pages/TranslatePage";
import { ExtractPage } from "./pages/ExtractPage";
import { EditorPage } from "./pages/EditorPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReviewPage } from "./pages/ReviewPage";
import { VoiceClonePage } from "./pages/VoiceClonePage";
import { DouyinPage } from "./pages/DouyinPage";
import { ProductAdPage } from "./pages/ProductAdPage";
import { AutoPipelinePage } from "./pages/AutoPipelinePage";
import { AiVideoPage } from "./pages/AiVideoPage";
import { X, Check } from "./components/Icons";
import { ensureBuiltInProviders } from "./lib/providers";
import {
  capabilityAssignments,
  updateCapabilityAssignments,
} from "./lib/settings";

export default function App() {
  const [page, setPage] = useState<Page>("translate");
  const [providers, setProviders] = useState<AIProvider[]>(() =>
    storage.providers(),
  );
  const [settings, setSettings] = useState<AppSettings>(storage.settings);
  const [cues, setCues] = useState<SubtitleCue[]>(storage.cues);
  const [asset, setAsset] = useState<VideoAsset | undefined>(storage.asset);
  const [toast, setToast] = useState<{
    message: string;
    kind: "success" | "error";
  }>();
  useEffect(() => {
    storage.saveCues(cues);
  }, [cues]);
  useEffect(() => {
    storage.saveSettings(settings);
  }, [settings]);
  useEffect(() => {
    storage.saveProviders(providers);
  }, [providers]);
  useEffect(() => {
    storage.saveAsset(asset);
  }, [asset]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(undefined), 4300);
    return () => window.clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    setProviders((current) => ensureBuiltInProviders(current));
  }, []);
  const notice = useCallback(
    (message: string, kind: "success" | "error" = "success") =>
      setToast({ message, kind }),
    [],
  );
  const openEditor = () => setPage("editor");
  const syncVieneuVoices = (voices: AIProvider["voices"]) =>
    setProviders((current) =>
      current.map((provider) => {
        if (
          provider.id !== "vieneu-local" &&
          provider.providerType !== "vieneu-local"
        )
          return provider;
        const nextVoices = voices || [];
        const hasPresets = nextVoices.some(
          (voice) =>
            voice.source === "preset" || voice.id.startsWith("preset:"),
        );
        const storedPresets = (provider.voices || []).filter(
          (voice) =>
            voice.source === "preset" || voice.id.startsWith("preset:"),
        );
        const merged = hasPresets
          ? nextVoices
          : [...storedPresets, ...nextVoices];
        return {
          ...provider,
          voices: [
            ...new Map(merged.map((voice) => [voice.id, voice])).values(),
          ],
        };
      }),
    );
  const enableVieneuTts = () =>
    setSettings((current) => {
      const assignment = {
        providerId:
          providers.find(
            (provider) =>
              provider.providerType === "vieneu-local" ||
              provider.id === "vieneu-local",
          )?.id || "vieneu-local",
        model: "vieneu-v3-turbo",
      };
      const choices = capabilityAssignments(current, "tts");
      if (
        choices.some(
          (item) =>
            item.providerId === assignment.providerId &&
            item.model === assignment.model,
        )
      )
        return current;
      return updateCapabilityAssignments(current, "tts", [
        ...choices,
        assignment,
      ]);
    });
  return (
    <>
      <Layout
        page={page}
        setPage={setPage}
        cueCount={cues.length}
        providerCount={providers.length}
      >
        {page === "pipeline" && (
          <AutoPipelinePage
            providers={providers}
            settings={settings}
            cues={cues}
            asset={asset}
            onCuesChange={setCues}
            onAssetChange={setAsset}
            onOpenEditor={openEditor}
            onNotice={notice}
          />
        )}
        <div className="route-keepalive" hidden={page !== "translate"}>
          <TranslatePage
            providers={providers}
            settings={settings}
            cues={cues}
            onCuesChange={setCues}
            onOpenEditor={openEditor}
            onNotice={notice}
          />
        </div>
        <div className="route-keepalive" hidden={page !== "extract"}>
          <ExtractPage
            providers={providers}
            settings={settings}
            initialAsset={asset}
            onCuesChange={setCues}
            onAssetChange={setAsset}
            onOpenEditor={openEditor}
            onNotice={notice}
          />
        </div>
        {page === "editor" && (
          <EditorPage
            providers={providers}
            settings={settings}
            onSettingsChange={setSettings}
            cues={cues}
            onCuesChange={setCues}
            asset={asset}
            onAssetChange={setAsset}
            onNotice={notice}
          />
        )}
        {page === "review" && (
          <ReviewPage
            providers={providers}
            settings={settings}
            initialAsset={asset}
            onAssetChange={setAsset}
            onNotice={notice}
          />
        )}
        {page === "product-ads" && (
          <ProductAdPage
            providers={providers}
            settings={settings}
            onNotice={notice}
          />
        )}
        {page === "ai-video" && <AiVideoPage providers={providers} settings={settings} onNotice={notice} />}
        {page === "voice-clone" && (
          <VoiceClonePage
            providers={providers}
            settings={settings}
            onVoicesChange={syncVieneuVoices}
            onEnableForTts={enableVieneuTts}
            onOpenEditor={openEditor}
            onNotice={notice}
          />
        )}
        {page === "douyin" && (
          <DouyinPage
            onAssetChange={setAsset}
            onOpenExtract={(a) => {
              setAsset(a);
              setPage("extract");
            }}
            onOpenReview={(a) => {
              setAsset(a);
              setPage("review");
            }}
            onOpenEditor={(a) => {
              setAsset(a);
              setPage("editor");
            }}
            onNotice={notice}
          />
        )}
        {page === "settings" && (
          <SettingsPage
            providers={providers}
            onProvidersChange={setProviders}
            settings={settings}
            onSettingsChange={setSettings}
            onNotice={notice}
          />
        )}
      </Layout>
      {toast && (
        <div className={`toast ${toast.kind}`}>
          <span className="toast-mark">
            {toast.kind === "success" ? <Check size={14} /> : <X size={14} />}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button className="icon-button" onClick={() => setToast(undefined)}>
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
