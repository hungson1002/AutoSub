import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type {
  AIProvider,
  AppSettings,
  BlurRegion,
  DubbingJobStatus,
  DubbingMetadata,
  LogoOverlay,
  OriginalAudioMode,
  PronunciationEntry,
  ProviderAssignment,
  SubtitleCue,
  SubtitleStyle,
  VideoAsset,
  VideoEditState,
  VoiceGroup,
} from "../types";
import {
  api,
  buildTranslationMemory,
  friendlyErrorMessage,
  MAX_BROWSER_UPLOAD_BYTES,
} from "../lib/api";
import { storage } from "../lib/storage";
import { translationBatchSize, translationConcurrency } from "../lib/translationConfig";
import {
  AudioLines,
  Captions,
  ChevronDown,
  Download,
  FileVideo,
  Image as ImageIcon,
  Languages,
  LayoutList,
  Plus,
  Scissors,
  Settings2,
  Upload,
  Volume2,
  X,
} from "../components/Icons";
import { RangeInput } from "../components/RangeInput";
import { VideoPlayer } from "../editor/VideoPlayer";
import { SubtitleList } from "../editor/SubtitleList";
import { SubtitleStylePanel } from "../editor/SubtitleStylePanel";
import { BlurEditor } from "../editor/BlurEditor";
import {
  DubbingModal,
  type DubbingRunOptions,
  type VoiceConfig,
} from "../editor/DubbingModal";
import { ExportModal } from "../editor/ExportModal";
import { ProgressModal } from "../components/ProgressModal";
import {
  TranslationSetupModal,
  type TranslationSetup,
} from "../components/TranslationSetupModal";
import {
  cuesToAss,
  cuesForDubbingTimeline,
  cuesToSrt,
  downloadText,
  isDubbableSubtitleCue,
  parseSubtitle,
  validateCues,
} from "../lib/subtitles";
import {
  capabilityAssignments,
  updateCapabilityAssignments,
} from "../lib/settings";
import { LogoModal } from "../editor/LogoModal";
import { subtitleTextCss } from "../editor/subtitleCss";
import { LatestUploadGuard } from "../lib/latestUpload";
import {
  announceDropdownOpen,
  listenForOtherDropdowns,
  type DropdownId,
} from "../lib/dropdowns";
import { videoAssetUploadFile } from "../lib/videoAsset";
import {
  addSubtitleFont,
  loadSubtitleFonts,
  type UploadedSubtitleFont,
} from "../lib/fontLibrary";
import { isCapabilityModelPassed } from "../lib/modelTests";

function applyPronunciation(text: string, entries: PronunciationEntry[]) {
  return entries
    .filter((entry) => entry.enabled && entry.source.trim())
    .reduce(
      (value, entry) => value.split(entry.source).join(entry.reading),
      text,
    );
}

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Logo image could not be read."));
    reader.onerror = () => reject(reader.error || new Error("Logo image could not be read."));
    reader.readAsDataURL(file);
  });
}

function cps(text: string, durationMs: number) {
  return text.replace(/\s/g, "").length / Math.max(durationMs / 1000, 0.001);
}

function splitTextAtRatio(text: string, ratio: number): [string, string] {
  const value = text.trim();
  if (!value) return ["", ""];
  const words = value.split(/\s+/);
  if (words.length > 1) {
    const cut = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)));
    return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
  }
  const cut = Math.max(1, Math.min(value.length - 1, Math.round(value.length * ratio)));
  return [value.slice(0, cut), value.slice(cut)];
}

function applyDubbingMetadata(
  cues: SubtitleCue[],
  metadata: DubbingMetadata[],
) {
  const metadataById = new Map(metadata.map((item) => [item.cueId, item]));
  return cues.map((cue) => {
    const item = metadataById.get(cue.id);
    if (!item) return cue;
    return {
      ...cue,
      // Dubbing metadata must never overwrite the user's subtitle wording.
      // Source timestamps also stay canonical. Preview/export read the expanded
      // dubbing timeline from metadata without feeding it into the next job.
      dubbing: item,
    };
  });
}

type EditorProps = {
  providers: AIProvider[];
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  cues: SubtitleCue[];
  onCuesChange: (cues: SubtitleCue[]) => void;
  asset?: VideoAsset;
  onAssetChange: (asset?: VideoAsset) => void;
  onNotice: (message: string, kind?: "success" | "error") => void;
};

export function EditorPage({
  providers,
  settings,
  onSettingsChange,
  cues,
  onCuesChange,
  asset,
  onAssetChange,
  onNotice,
}: EditorProps) {
  const editorWorkspaceRef = useRef<HTMLElement>(null);
  const editorLayout = useMemo(() => {
    const fallback = { tools: 248, inspector: 340, preview: 430 };
    try {
      const saved = JSON.parse(localStorage.getItem("autosub.editor-layout") || "null");
      return {
        tools: Number.isFinite(saved?.tools) ? saved.tools : fallback.tools,
        inspector: Number.isFinite(saved?.inspector) ? saved.inspector : fallback.inspector,
        preview: Number.isFinite(saved?.preview) ? saved.preview : fallback.preview,
      };
    } catch {
      return fallback;
    }
  }, []);
  const [selectedId, setSelectedId] = useState(cues[0]?.id);
  const currentTimeRef = useRef(0);
  const [activeCueId, setActiveCueId] = useState<string>();
  const [seekRequest, setSeekRequest] = useState<{
    id: number;
    timeMs: number;
  }>();
  const [panel, setPanel] = useState<"style" | "audio" | "none">("style");
  const [cueListOpen, setCueListOpen] = useState(false);
  const cueListTriggerRef = useRef<HTMLButtonElement>(null);
  const cueListCloseRef = useRef<HTMLButtonElement>(null);
  const [blurOpen, setBlurOpen] = useState(false);
  const [blurEditMode, setBlurEditMode] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const [dubbingOpen, setDubbingOpen] = useState(false);
  const [dubbingInitialAudioMode, setDubbingInitialAudioMode] =
    useState<OriginalAudioMode>("mute");
  const [exportOpen, setExportOpen] = useState(false);
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>(() =>
    storage.blurRegions(asset?.uploadId),
  );
  const [logo, setLogo] = useState<LogoOverlay | undefined>(() =>
    storage.logo(asset?.uploadId),
  );
  const [logoPreview, setLogoPreview] = useState<LogoOverlay>();
  const [decorationsUploadId, setDecorationsUploadId] = useState(
    asset?.uploadId,
  );
  const [pronunciation, setPronunciation] = useState<PronunciationEntry[]>(
    storage.pronunciation,
  );
  const [fontUploads, setFontUploads] = useState<UploadedSubtitleFont[]>([]);
  const [dubTrack, setDubTrack] = useState<Blob>();
  const [dubAudioUrl, setDubAudioUrl] = useState<string>();
  const [dubAudioMix, setDubAudioMix] = useState<{
    keepOriginal: boolean;
    originalVolume: number;
    dubVolume?: number;
    separateVocals?: boolean;
  }>();
  const [dubbingJob, setDubbingJob] = useState<DubbingJobStatus>();
  const [regeneratingCueId, setRegeneratingCueId] = useState<string>();
  const [videoEdit, setVideoEdit] = useState<VideoEditState>(() =>
    storage.videoEdit(asset?.uploadId),
  );
  const dubbingTerminalNoticeRef = useRef("");
  const [working, setWorking] = useState(false);
  const [workingTitle, setWorkingTitle] = useState("Đang xử lý audio");
  const [workingMessage, setWorkingMessage] = useState("Provider → FFprobe → atempo → dub-track.wav");
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationWorking, setTranslationWorking] = useState(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [translationStage, setTranslationStage] = useState(
    "Chuẩn bị dịch subtitle",
  );
  const [translationSetup, setTranslationSetup] = useState<TranslationSetup>(
    () => ({
      providerId: settings.assignments.translation.providerId,
      model: settings.assignments.translation.model,
      mode: "quality",
      style: "Review phim",
      customPrompt: "",
      sourceLanguage: "Auto Detect",
      targetLanguage: "Tiếng Việt",
      glossary: storage.glossary(),
    }),
  );
  const [videoAction, setVideoAction] = useState<
    "idle" | "uploading" | "picking"
  >("idle");
  const uploadingVideo = videoAction === "uploading";
  const pickingLocalVideo = videoAction === "picking";
  const [subtitleDownloadOpen, setSubtitleDownloadOpen] = useState(false);
  const subtitleDownloadRef = useRef<HTMLDivElement>(null);
  const subtitleDownloadId = useRef<DropdownId>({});
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const translationControllerRef = useRef<AbortController | undefined>(
    undefined,
  );
  const translationProgressTimerRef = useRef<number | undefined>(undefined);
  const seekRequestIdRef = useRef(0);
  const subtitleImportRequestRef = useRef(0);
  const uploadGuardRef = useRef(new LatestUploadGuard());
  const assetRef = useRef(asset);
  useEffect(() => {
    let disposed = false;
    void loadSubtitleFonts().then((fonts) => {
      if (disposed) {
        fonts.forEach((font) => URL.revokeObjectURL(font.url));
        return;
      }
      setFontUploads((current) => {
        const known = new Set(current.map((font) => font.family));
        const fresh = fonts.filter((font) => !known.has(font.family));
        fonts.filter((font) => known.has(font.family)).forEach((font) => URL.revokeObjectURL(font.url));
        return fresh.length ? [...current, ...fresh] : current;
      });
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  const uploadSubtitleFont = async (file: File, family: string) => {
    const font = await addSubtitleFont(file, family);
    setFontUploads((current) => {
      const previous = current.find((item) => item.family === family);
      if (previous) URL.revokeObjectURL(previous.url);
      return [...current.filter((item) => item.family !== family), font];
    });
  };
  const selected = cues.find((cue) => cue.id === selectedId);
  const effectiveDubAudioMix = {
    keepOriginal: Boolean(dubAudioMix?.keepOriginal && !dubAudioMix.separateVocals),
    originalVolume: dubAudioMix?.originalVolume ?? 0.25,
    dubVolume: dubAudioMix?.dubVolume ?? 1,
    separateVocals: Boolean(dubAudioMix?.separateVocals),
  };
  const updateDubAudioMix = (patch: Partial<typeof effectiveDubAudioMix>) => {
    setDubAudioMix((current) => ({
      keepOriginal: current?.keepOriginal ?? false,
      originalVolume: current?.originalVolume ?? 0.25,
      dubVolume: current?.dubVolume ?? 1,
      separateVocals: current?.separateVocals,
      ...patch,
    }));
  };
  const editorMetrics = useMemo(() => {
    const enabled = cues.filter((cue) => cue.enabled);
    const average = (values: number[]) =>
      values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
    const original = average(
      enabled.map((cue) => cps(cue.originalText, cue.endMs - cue.startMs)),
    );
    const translated = average(
      enabled.map((cue) =>
        cps(cue.translatedText || cue.originalText, cue.endMs - cue.startMs),
      ),
    );
    const groups = (["G1", "G2", "G3"] as const).map((group) => {
      const groupCues = enabled.filter((cue) => cue.voiceGroup === group);
      return {
        group,
        value: average(
          groupCues.map((cue) =>
            cps(
              cue.translatedText || cue.originalText,
              cue.endMs - cue.startMs,
            ),
          ),
        ),
      };
    });
    const standard = groups.reduce(
      (best, current) =>
        Math.abs(current.value - 18) < Math.abs(best.value - 18)
          ? current
          : best,
      groups[0] || { group: "G1", value: 0 },
    );
    return { original, translated, groups, standard };
  }, [cues]);
  const assignments = useMemo<Record<VoiceGroup, ProviderAssignment>>(
    () => ({
      G1: settings.assignments.tts,
      G2: settings.assignments.tts,
      G3: settings.assignments.tts,
    }),
    [settings.assignments.tts],
  );

  useEffect(() => {
    storage.savePronunciation(pronunciation);
  }, [pronunciation]);
  useEffect(
    () =>
      listenForOtherDropdowns(subtitleDownloadId.current, () =>
        setSubtitleDownloadOpen(false),
      ),
    [],
  );
  useEffect(() => {
    const close = (event: globalThis.PointerEvent) => {
      if (!subtitleDownloadRef.current?.contains(event.target as Node))
        setSubtitleDownloadOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    assetRef.current = asset;
  }, [asset]);
  useEffect(() => {
    setVideoEdit(storage.videoEdit(asset?.uploadId));
    const savedLogo = storage.logo(asset?.uploadId);
    setBlurRegions(storage.blurRegions(asset?.uploadId));
    setLogo(savedLogo);
    setLogoPreview(savedLogo);
    setBlurEditMode(false);
    setDecorationsUploadId(asset?.uploadId);
  }, [asset?.uploadId]);
  useEffect(() => {
    if (asset?.uploadId) storage.saveVideoEdit(asset.uploadId, videoEdit);
  }, [asset?.uploadId, videoEdit]);
  useEffect(() => {
    if (asset?.uploadId && decorationsUploadId === asset.uploadId)
      storage.saveBlurRegions(asset.uploadId, blurRegions);
  }, [asset?.uploadId, blurRegions, decorationsUploadId]);
  useEffect(() => {
    if (asset?.uploadId && decorationsUploadId === asset.uploadId)
      storage.saveLogo(asset.uploadId, logo);
  }, [asset?.uploadId, logo, decorationsUploadId]);
  useEffect(() => {
    const uploadId = asset?.uploadId;
    setDubTrack(undefined);
    setDubAudioUrl(undefined);
    setDubAudioMix(undefined);
    setDubbingJob(undefined);
    dubbingTerminalNoticeRef.current = "";
    if (!uploadId) return;
    const savedJobId = storage.dubbingJob(uploadId);
    let disposed = false;
    void (async () => {
      let job: DubbingJobStatus | undefined;
      if (savedJobId) {
        try {
          job = await api.getDubbingJobStatus(savedJobId);
        } catch {
          storage.removeDubbingJob(uploadId, savedJobId);
        }
      }
      if (!job) job = (await api.getLatestDubbingJobForVideo(uploadId)).job;
      if (disposed || !job) return;
      if (job.videoId && job.videoId !== uploadId) return;
      storage.saveDubbingJob(uploadId, job.id);
      setDubbingJob(job);
    })().catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [asset?.uploadId]);
  useEffect(
    () => () => {
      uploadGuardRef.current.cancel();
      subtitleImportRequestRef.current += 1;
      translationControllerRef.current?.abort();
      if (translationProgressTimerRef.current !== undefined)
        window.clearInterval(translationProgressTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (!translationSetup.model && settings.assignments.translation.model)
      setTranslationSetup((current) => ({
        ...current,
        providerId: settings.assignments.translation.providerId,
        model: settings.assignments.translation.model,
      }));
  }, [
    settings.assignments.translation.providerId,
    settings.assignments.translation.model,
    translationSetup.model,
  ]);
  useEffect(() => {
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)
      console.info(
        `[EDITOR STATE] ${JSON.stringify({ cueCount: cues.length, cues: cues.slice(0, 5).map((cue) => ({ text: cue.originalText, startMs: cue.startMs, endMs: cue.endMs })) })}`,
      );
  }, [cues]);
  useEffect(() => {
    if (cues.length && !cues.some((cue) => cue.id === selectedId))
      setSelectedId(cues[0]?.id);
  }, [cues, selectedId]);
  useEffect(() => {
    if (!dubbingJob || !["queued", "running"].includes(dubbingJob.status))
      return;
    let disposed = false;
    let inFlight = false;
    let consecutiveFailures = 0;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api.getDubbingJobStatus(dubbingJob.id);
        if (disposed) return;
        consecutiveFailures = 0;
        if (
          [
            "completed",
            "completed_with_errors",
            "cancelled",
            "failed",
          ].includes(next.status) &&
          dubbingTerminalNoticeRef.current !== `${next.id}:${next.status}`
        ) {
          if (next.status === "completed") {
            const result = await api.getDubbingResult(next.id);
            if (disposed) return;
            dubbingTerminalNoticeRef.current = `${next.id}:${next.status}`;
            setDubbingJob(next);
            onCuesChange(applyDubbingMetadata(cues, result.metadata));
            setDubAudioUrl(
              `${result.audioUrl}?v=${encodeURIComponent(next.updatedAt)}`,
            );
            setRegeneratingCueId(undefined);
            setDubAudioMix({
              keepOriginal: next.config.audioMix.keepOriginal,
              originalVolume: next.config.audioMix.originalVolume,
              separateVocals: next.config.audioMix.separateVocals,
            });
            onNotice(
              `Dubbing hoàn tất ${next.doneCues}/${next.totalCues} cue. Dub track được lưu trên server theo job ${next.id}.`,
              "success",
            );
          } else if (next.status === "completed_with_errors") {
            const result = next.result ? await api.getDubbingResult(next.id) : undefined;
            if (disposed) return;
            dubbingTerminalNoticeRef.current = `${next.id}:${next.status}`;
            setDubbingJob(next);
            if (result) {
              onCuesChange(applyDubbingMetadata(cues, result.metadata));
              setDubAudioUrl(
                `${result.audioUrl}?v=${encodeURIComponent(next.updatedAt)}`,
              );
              setDubAudioMix({
                keepOriginal: next.config.audioMix.keepOriginal,
                originalVolume: next.config.audioMix.originalVolume,
                separateVocals: next.config.audioMix.separateVocals,
              });
            }
            setRegeneratingCueId(undefined);
            const firstFailure = next.failedCueErrors?.[0];
            const detail = firstFailure
              ? ` Cue #${firstFailure.index}, bước ${firstFailure.stage}: ${friendlyErrorMessage(new Error(firstFailure.error), firstFailure.error)}`
              : "";
            onNotice(
              `Dubbing có ${next.failedCues} cue lỗi.${detail}`,
              "error",
            );
          } else if (next.status === "cancelled") {
            dubbingTerminalNoticeRef.current = `${next.id}:${next.status}`;
            setDubbingJob(next);
            onNotice("Dubbing job đã được hủy.", "success");
          } else {
            dubbingTerminalNoticeRef.current = `${next.id}:${next.status}`;
            setDubbingJob(next);
            onNotice(
              next.warnings
                .map((warning) =>
                  friendlyErrorMessage(new Error(warning), warning),
                )
                .join(" ") || "Dubbing job thất bại.",
              "error",
            );
          }
        } else {
          setDubbingJob(next);
        }
      } catch {
        consecutiveFailures += 1;
        if (!disposed && consecutiveFailures === 3)
          onNotice(
            "Backend đang khởi động hoặc tạm thời mất kết nối. AutoSub vẫn tiếp tục thử lại job.",
            "error",
          );
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [dubbingJob?.id, dubbingJob?.status, cues, onCuesChange, onNotice]);
  useEffect(() => {
    if (!dubbingJob?.result || !["completed", "completed_with_errors"].includes(dubbingJob.status) || dubAudioUrl) return;
    let disposed = false;
    void api
      .getDubbingResult(dubbingJob.id)
      .then((result) => {
        if (disposed) return;
        onCuesChange(applyDubbingMetadata(cues, result.metadata));
        setDubAudioUrl(
          `${result.audioUrl}?v=${encodeURIComponent(dubbingJob.updatedAt)}`,
        );
        setDubAudioMix({
          keepOriginal: dubbingJob.config.audioMix.keepOriginal,
          originalVolume: dubbingJob.config.audioMix.originalVolume,
          separateVocals: dubbingJob.config.audioMix.separateVocals,
        });
      })
      .catch((error) => {
        if (!disposed)
          onNotice(
            friendlyErrorMessage(error, "Không thể tải bản preview dubbing."),
            "error",
          );
      });
    return () => {
      disposed = true;
    };
  }, [
    dubbingJob?.id,
    dubbingJob?.status,
    dubAudioUrl,
    cues,
    onCuesChange,
    onNotice,
  ]);

  const dubbingJobAction = async (
    action: "pause" | "resume" | "cancel" | "retry-failed" | "rebuild",
  ) => {
    if (!dubbingJob) return;
    const retryCues = action === "retry-failed"
      ? (dubbingJob.failedCueIds || []).flatMap((failedId) => {
          const cueIndex = cues.findIndex((cue) => cue.id === failedId);
          const cue = cues[cueIndex];
          if (!cue) return [];
          const text = applyPronunciation(cue.translatedText || cue.originalText, pronunciation).trim();
          return text ? [{
            id: cue.id,
            startMs: cue.startMs,
            endMs: cue.endMs,
            originalText: cue.originalText,
            translatedText: cue.translatedText,
            text,
            previousText: cues[cueIndex - 1]?.translatedText || cues[cueIndex - 1]?.originalText || "",
            nextText: cues[cueIndex + 1]?.translatedText || cues[cueIndex + 1]?.originalText || "",
          }] : [];
        })
      : [];
    if (action === "retry-failed" && retryCues.length !== dubbingJob.failedCues) {
      onNotice("Cue lỗi vẫn chưa có nội dung subtitle để tạo giọng.", "error");
      return;
    }
    try {
      const next =
        action === "pause"
          ? await api.pauseDubbingJob(dubbingJob.id)
          : action === "resume"
            ? await api.resumeDubbingJob(dubbingJob.id)
            : action === "cancel"
              ? await api.cancelDubbingJob(dubbingJob.id)
              : action === "rebuild"
                ? await api.rebuildDubbingJobResult(dubbingJob.id)
                : await api.retryFailedDubbingJob(dubbingJob.id, retryCues);
      setDubbingJob(next);
      if (action === "cancel" && asset?.uploadId)
        storage.removeDubbingJob(asset.uploadId, dubbingJob.id);
      if (action === "retry-failed") dubbingTerminalNoticeRef.current = "";
      if (action === "rebuild") {
        setDubAudioUrl(undefined);
        setDubAudioMix(undefined);
        dubbingTerminalNoticeRef.current = "";
        onNotice("Đang dựng lại dub track từ cache, không gọi lại TTS.", "success");
      }
    } catch (error) {
      onNotice(
        friendlyErrorMessage(error, "Không thể điều khiển dubbing job."),
        "error",
      );
    }
  };

  const regenerateCueVoice = useCallback(
    async (cue: SubtitleCue) => {
      if (cue.sourceKind === "onscreen-text") {
        onNotice("Cue này là chữ trên màn hình, không phải phụ đề nên sẽ không được lồng tiếng.", "error");
        return;
      }
      if (!dubbingJob || dubbingJob.status !== "completed") {
        onNotice(
          "Hãy tạo một dub track hoàn chỉnh trước khi tạo lại voice riêng cho cue.",
          "error",
        );
        return;
      }
      const cueIndex = cues.findIndex((item) => item.id === cue.id);
      const spokenText = applyPronunciation(
        cue.translatedText || cue.originalText,
        pronunciation,
      ).trim();
      if (!spokenText) {
        onNotice(`Cue #${cue.index} chưa có nội dung để đọc.`, "error");
        return;
      }
      setRegeneratingCueId(cue.id);
      setDubAudioUrl(undefined);
      dubbingTerminalNoticeRef.current = "";
      try {
        const next = await api.regenerateDubbingCue(dubbingJob.id, {
          id: cue.id,
          startMs: cue.startMs,
          endMs: cue.endMs,
          originalText: cue.originalText,
          translatedText: cue.translatedText,
          text: spokenText,
          previousText:
            cues[cueIndex - 1]?.translatedText ||
            cues[cueIndex - 1]?.originalText ||
            "",
          nextText:
            cues[cueIndex + 1]?.translatedText ||
            cues[cueIndex + 1]?.originalText ||
            "",
        });
        setDubbingJob(next);
        onNotice(
          `Đang tạo lại voice riêng cho cue #${cue.index}. Các cue khác được giữ nguyên.`,
          "success",
        );
      } catch (error) {
        setRegeneratingCueId(undefined);
        onNotice(
          friendlyErrorMessage(
            error,
            `Không thể tạo lại voice cho cue #${cue.index}.`,
          ),
          "error",
        );
      }
    },
    [cues, dubbingJob, onNotice, pronunciation],
  );

  const changeCue = useCallback(
    (id: string, patch: Partial<SubtitleCue>) =>
      onCuesChange(
        cues.map((cue) => {
          if (cue.id !== id) return cue;
          const next = { ...cue, ...patch };
          if (patch.startMs !== undefined)
            next.startMs = Math.max(0, Math.min(next.endMs - 1, patch.startMs));
          if (patch.endMs !== undefined)
            next.endMs = Math.max(next.startMs + 1, patch.endMs);
          return next;
        }),
      ),
    [cues, onCuesChange],
  );

  const reportEditorTime = useCallback((nextTimeMs: number) => {
    currentTimeRef.current = nextTimeMs;
  }, []);
  const selectCue = useCallback(
    (id: string) => {
      setSelectedId(id);
      const cue = cues.find((item) => item.id === id);
      if (cue) {
        if (cue.sourceKind === "onscreen-text") {
          // Text objects are edited at the current playhead. Seeking back to
          // their start on every selection made canvas/timeline drag and even
          // inspector edits appear to jump backwards.
          setPanel("style");
        } else {
          currentTimeRef.current = cue.startMs;
          setSeekRequest({ id: ++seekRequestIdRef.current, timeMs: cue.startMs });
        }
      }
    },
    [cues],
  );
  const focusCue = useCallback((id: string) => {
    setSelectedId(id);
    const cue = cues.find((item) => item.id === id);
    if (cue?.sourceKind === "onscreen-text") setPanel("style");
  }, [cues]);
  const deleteCue = useCallback(
    (id: string) => {
      const next = cues
        .filter((cue) => cue.id !== id)
        .map((cue, index) => ({ ...cue, index: index + 1 }));
      onCuesChange(next);
      if (selectedId === id) setSelectedId(next[0]?.id);
    },
    [cues, onCuesChange, selectedId],
  );
  const deleteCues = useCallback((ids: string[]) => {
    const removed = new Set(ids);
    const next = cues
      .filter((cue) => !removed.has(cue.id))
      .map((cue, index) => ({ ...cue, index: index + 1 }));
    onCuesChange(next);
    if (selectedId && removed.has(selectedId)) setSelectedId(next[0]?.id);
  }, [cues, onCuesChange, selectedId]);
  const splitCueAtTime = useCallback((timeMs: number) => {
    const point = Math.round(timeMs);
    const selectedCue = selectedId ? cues.find((cue) => cue.id === selectedId) : undefined;
    const target = selectedCue && point > selectedCue.startMs + 80 && point < selectedCue.endMs - 80
      ? selectedCue
      : cues.find((cue) => point > cue.startMs + 80 && point < cue.endMs - 80);
    if (!target) {
      onNotice("Không có cue nào đủ dài tại playhead để tách.", "error");
      return;
    }
    const ratio = (point - target.startMs) / Math.max(1, target.endMs - target.startMs);
    const [leftOriginal, rightOriginal] = target.sourceKind === "onscreen-text"
      ? [target.originalText, target.originalText]
      : splitTextAtRatio(target.originalText, ratio);
    const [leftTranslated, rightTranslated] = target.sourceKind === "onscreen-text"
      ? [target.translatedText, target.translatedText]
      : splitTextAtRatio(target.translatedText, ratio);
    const first: SubtitleCue = {
      ...target,
      endMs: point,
      originalText: leftOriginal,
      translatedText: leftTranslated,
      dubbing: undefined,
    };
    const second: SubtitleCue = {
      ...target,
      id: crypto.randomUUID(),
      startMs: point,
      originalText: rightOriginal,
      translatedText: rightTranslated,
      dubbing: undefined,
    };
    const next = cues
      .flatMap((cue) => cue.id === target.id ? [first, second] : [cue])
      .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
      .map((cue, index) => ({ ...cue, index: index + 1 }));
    onCuesChange(next);
    setSelectedId(second.id);
    currentTimeRef.current = point;
    setSeekRequest({ id: ++seekRequestIdRef.current, timeMs: point });
    onNotice(`Đã tách cue #${target.index} tại ${Math.round(point / 1000)}s. Voice cache của cue này đã được bỏ để tránh đọc sai.`, "success");
  }, [cues, onCuesChange, onNotice, selectedId]);
  const duplicateCue = useCallback((id: string) => {
    const target = cues.find((cue) => cue.id === id);
    if (!target) return;
    const duration = Math.max(160, target.endMs - target.startMs);
    const duplicate: SubtitleCue = {
      ...target,
      id: crypto.randomUUID(),
      startMs: target.endMs,
      endMs: target.endMs + duration,
      dubbing: undefined,
    };
    const next = [...cues, duplicate]
      .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
      .map((cue, index) => ({ ...cue, index: index + 1 }));
    onCuesChange(next);
    setSelectedId(duplicate.id);
    setSeekRequest({ id: ++seekRequestIdRef.current, timeMs: duplicate.startMs });
    onNotice(`Đã nhân bản cue #${target.index}.`, "success");
  }, [cues, onCuesChange, onNotice]);
  const openDubbingWithAudioMode = useCallback((mode: OriginalAudioMode) => {
    setDubbingInitialAudioMode(mode);
    setDubbingOpen(true);
    if (mode === "background")
      onNotice("Đã mở Lồng tiếng ở chế độ Bỏ lời: Demucs giữ nhạc + hiệu ứng khi tạo dub.", "success");
  }, [onNotice]);
  const exportStemAudio = useCallback(async (stem: "vocals" | "background") => {
    if (!asset?.uploadId) {
      onNotice("Cần video đã upload lên app trước khi tách giọng/nhạc.", "error");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorkingTitle(stem === "vocals" ? "Đang giữ lời" : "Đang bỏ lời");
    setWorkingMessage(stem === "vocals"
      ? "Demucs đang tách track chỉ còn giọng nói từ video."
      : "Demucs đang tách nhạc nền + hiệu ứng và loại lời nói.");
    setWorking(true);
    try {
      const blob = await api.exportStemAudio({
        uploadId: asset.uploadId,
        stem,
        trimStartMs: videoEdit.trimStartMs,
        trimEndMs: videoEdit.trimEndMs,
      }, controller.signal);
      saveBlob(stem === "vocals" ? "autosub-vocals.wav" : "autosub-background.wav", blob);
      onNotice(stem === "vocals"
        ? "Đã tách và tải track chỉ còn giọng nói."
        : "Đã tách và tải track nhạc nền/hiệu ứng không lời.",
      "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        onNotice("Đã hủy tách audio.", "success");
      else
        onNotice(friendlyErrorMessage(error, "Tách audio thất bại."), "error");
    } finally {
      controllerRef.current = undefined;
      setWorking(false);
    }
  }, [asset?.uploadId, onNotice, videoEdit.trimEndMs, videoEdit.trimStartMs]);
  const addCue = useCallback(() => {
    const last = cues.at(-1);
    const next: SubtitleCue = {
      id: crypto.randomUUID(),
      index: cues.length + 1,
      startMs: last?.endMs || 0,
      endMs: (last?.endMs || 0) + 2500,
      originalText: "",
      translatedText: "",
      voiceGroup: "G1",
      enabled: true,
    };
    onCuesChange([...cues, next]);
    setSelectedId(next.id);
  }, [cues, onCuesChange]);
  const addTextCue = useCallback((timeMs = currentTimeRef.current) => {
    const startMs = Math.max(0, Math.round(timeMs));
    const next: SubtitleCue = {
      id: crypto.randomUUID(),
      index: cues.length + 1,
      startMs,
      endMs: startMs + 2500,
      originalText: "Văn bản mới",
      translatedText: "",
      sourceKind: "onscreen-text",
      textOrigin: "manual",
      screenPosition: { xPercent: 50, yPercent: 50 },
      voiceGroup: "G1",
      enabled: true,
    };
    const sorted = [...cues, next]
      .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
      .map((cue, index) => ({ ...cue, index: index + 1 }));
    onCuesChange(sorted);
    setSelectedId(next.id);
    setPanel("style");
  }, [cues, onCuesChange]);
  const uploadVideoAsset = (nextAsset: VideoAsset, recovering = false) => {
    const assetSize = nextAsset.file?.size ?? nextAsset.size ?? 0;
    if (assetSize > MAX_BROWSER_UPLOAD_BYTES) {
      uploadGuardRef.current.cancel();
      setVideoAction("idle");
      onNotice(
        "Video lớn hơn 4 GiB không thể upload qua trình duyệt. Hãy bấm “Mở video lớn” để liên kết trực tiếp file trên máy.",
        "error",
      );
      return;
    }
    uploadGuardRef.current.cancel();
    const request = uploadGuardRef.current.begin();
    assetRef.current = nextAsset;
    onAssetChange(nextAsset);
    setVideoAction("uploading");
    onNotice(
      recovering
        ? "Đang khôi phục liên kết video cho chức năng lồng tiếng…"
        : `Đang lưu video ${nextAsset.name} trên máy…`,
      "success",
    );
    void videoAssetUploadFile(nextAsset, request.controller.signal)
      .then((file) =>
        api
          .uploadMedia(file, request.controller.signal)
          .then((stored) => ({ file, stored })),
      )
      .then(({ file, stored }) => {
        if (!uploadGuardRef.current.isCurrent(request)) {
          void api.deleteUpload(stored.uploadId).catch(() => undefined);
          return;
        }
        if (assetRef.current?.url !== nextAsset.url) {
          void api.deleteUpload(stored.uploadId).catch(() => undefined);
          return;
        }
        const uploadedAsset = {
          ...nextAsset,
          file,
          uploadId: stored.uploadId,
          storedPath: stored.storedPath,
          path: stored.storedPath,
          size: stored.size,
          sourceMode: stored.sourceMode || ("copied" as const),
        };
        assetRef.current = uploadedAsset;
        onAssetChange(uploadedAsset);
        onNotice(
          recovering
            ? "Đã khôi phục video cho lồng tiếng và tách vocal."
            : `Đã lưu video ${file.name} trên máy.`,
          "success",
        );
      })
      .catch((error) => {
        if (!uploadGuardRef.current.isCurrent(request)) return;
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        onNotice(
          friendlyErrorMessage(
            error,
            recovering
              ? "Không thể khôi phục video. Hãy bấm Thay video và chọn lại file nguồn."
              : "Không thể lưu video trên máy.",
          ),
          "error",
        );
      })
      .finally(() => {
        if (uploadGuardRef.current.complete(request)) setVideoAction("idle");
      });
  };

  const selectVideo = (file?: File) => {
    if (!file) return;
    if (file.size > MAX_BROWSER_UPLOAD_BYTES) {
      onNotice(
        "Video lớn hơn 4 GiB. Hãy dùng “Mở video lớn” để AutoSub đọc trực tiếp mà không upload hoặc sao chép.",
        "error",
      );
      return;
    }
    const previousAsset = assetRef.current;
    if (previousAsset?.uploadId) {
      storage.removeDubbingJob(previousAsset.uploadId);
      void api.deleteUpload(previousAsset.uploadId).catch(() => undefined);
    }
    if (previousAsset?.url.startsWith("blob:"))
      URL.revokeObjectURL(previousAsset.url);
    setDubAudioUrl(undefined);
    setDubAudioMix(undefined);
    setDubbingJob(undefined);
    dubbingTerminalNoticeRef.current = "";
    uploadVideoAsset({
      name: file.name,
      file,
      url: URL.createObjectURL(file),
      type: file.type,
      size: file.size,
      sourceMode: "copied",
    });
  };

  const importLocalVideo = async () => {
    if (pickingLocalVideo) {
      uploadGuardRef.current.cancel();
      setVideoAction("idle");
      return;
    }
    uploadGuardRef.current.cancel();
    const request = uploadGuardRef.current.begin();
    setVideoAction("picking");
    try {
      const result = await api.importLocalMedia(
        "video",
        request.controller.signal,
      );
      if ("cancelled" in result) return;
      if (!uploadGuardRef.current.isCurrent(request)) {
        await api.deleteUpload(result.uploadId).catch(() => undefined);
        return;
      }
      const previousAsset = assetRef.current;
      if (previousAsset?.uploadId) {
        storage.removeDubbingJob(previousAsset.uploadId);
        void api.deleteUpload(previousAsset.uploadId).catch(() => undefined);
      }
      if (previousAsset?.url.startsWith("blob:"))
        URL.revokeObjectURL(previousAsset.url);
      const linkedAsset: VideoAsset = {
        name: result.filename,
        type: result.contentType,
        url: `/api/uploads/${encodeURIComponent(result.uploadId)}/media`,
        uploadId: result.uploadId,
        storedPath: result.storedPath,
        path: result.storedPath,
        size: result.size,
        sourceMode: "linked",
      };
      assetRef.current = linkedAsset;
      setDubAudioUrl(undefined);
      setDubAudioMix(undefined);
      setDubbingJob(undefined);
      dubbingTerminalNoticeRef.current = "";
      onAssetChange(linkedAsset);
      onNotice(
        `Đã liên kết ${result.filename} mà không sao chép video.`,
        "success",
      );
    } catch (error) {
      if (
        uploadGuardRef.current.isCurrent(request) &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        onNotice(
          friendlyErrorMessage(error, "Không thể mở video local."),
          "error",
        );
    } finally {
      if (uploadGuardRef.current.complete(request)) setVideoAction("idle");
    }
  };

  useEffect(() => {
    if (!asset || asset.uploadId || videoAction !== "idle") return;
    uploadVideoAsset(asset, true);
    // The upload function intentionally owns cancellation/latest-request checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.url, asset?.uploadId, videoAction]);

  const clearTranslationProgressTimer = () => {
    if (translationProgressTimerRef.current !== undefined) {
      window.clearInterval(translationProgressTimerRef.current);
      translationProgressTimerRef.current = undefined;
    }
  };

  const easeTranslationProgressTo = (ceiling: number) => {
    clearTranslationProgressTimer();
    translationProgressTimerRef.current = window.setInterval(() => {
      setTranslationProgress((current) => {
        if (current >= ceiling - 0.2) return current;
        return Math.min(
          ceiling,
          current + Math.max(0.12, (ceiling - current) * 0.045),
        );
      });
    }, 120);
  };

  const translateAll = async (setup: TranslationSetup) => {
    const assignment = { providerId: setup.providerId, model: setup.model };
    const provider = providers.find(
      (item) => item.id === assignment.providerId,
    );
    if (!provider || !setup.model) {
      onNotice("Chưa có Translation Provider + Model.", "error");
      return;
    }
    if (!cues.length) {
      onNotice("Chưa có cue để dịch.", "error");
      return;
    }
    if (
      !isCapabilityModelPassed(
        storage.modelPreferences(),
        provider.id,
        "translation",
        setup.model,
      )
    ) {
      onNotice(
        `Model ${setup.model} chưa test Translation thành công.`,
        "error",
      );
      return;
    }
    const configuredTranslations = capabilityAssignments(
      settings,
      "translation",
    );
    onSettingsChange(
      updateCapabilityAssignments(settings, "translation", [
        assignment,
        ...configuredTranslations.filter(
          (item) =>
            item.providerId !== assignment.providerId ||
            item.model !== assignment.model,
        ),
      ]),
    );
    setTranslationSetup(setup);
    storage.saveGlossary(setup.glossary);
    const controller = new AbortController();
    translationControllerRef.current = controller;
    setTranslationOpen(false);
    setTranslationWorking(true);
    setTranslationProgress(2);
    setTranslationStage("Đang chuẩn bị dữ liệu dịch");
    try {
      const next = [...cues];
      let translationGuide = "";
      if (setup.style === "Review phim") {
        setTranslationStage("Đang lập translation bible cho nhân vật và thuật ngữ");
        try {
          translationGuide = (
            await api.translationGuide(
              provider,
              setup.model,
              cues,
              setup.sourceLanguage,
              setup.targetLanguage,
              setup.style,
              setup.customPrompt,
              setup.glossary.filter((entry) => entry.enabled),
              controller.signal,
            )
          ).guide;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
        }
      }
      const batchSize = translationBatchSize(setup.mode);
      const totalBatches = Math.ceil(cues.length / batchSize);
      const starts = Array.from({ length: totalBatches }, (_, index) => index * batchSize);
      let cursor = 0;
      let completedCues = 0;
      const workers = Array.from({ length: Math.min(starts.length, translationConcurrency(setup.mode)) }, async () => {
        for (;;) {
          const queueIndex = cursor++;
          if (queueIndex >= starts.length) return;
          const start = starts[queueIndex] ?? 0;
          const batch = cues.slice(start, start + batchSize);
          const batchNumber = queueIndex + 1;
          setTranslationStage(`Đang dịch song song ${Math.min(starts.length, translationConcurrency(setup.mode))} batch · batch ${batchNumber}/${totalBatches}`);
          const result = await api.translate(
            provider, setup.model, batch, setup.sourceLanguage, setup.targetLanguage,
            setup.style, setup.customPrompt, setup.glossary.filter((entry) => entry.enabled),
            controller.signal, cues, buildTranslationMemory(cues, batch[0]?.id || "", 24), translationGuide,
          );
          for (const item of result.items) {
            const cue = next.find((candidate) => candidate.id === item.id);
            if (cue) cue.translatedText = item.translation;
          }
          completedCues += batch.length;
          clearTranslationProgressTimer();
          setTranslationProgress(Math.min(98, (completedCues / cues.length) * 100));
          setTranslationStage(`Đã dịch ${completedCues}/${cues.length} cue · đang lưu kết quả`);
          onCuesChange([...next]);
        }
      });
      await Promise.all(workers);
      setTranslationProgress(100);
      setTranslationStage("Đã hoàn tất dịch toàn bộ subtitle");
      onNotice(
        `Đã dịch lại ${next.filter((cue) => cue.translatedText.trim()).length}/${next.length} cue.`,
        "success",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setTranslationStage("Đã hủy dịch subtitle");
        onNotice("Đã hủy xử lý trong Editor.", "success");
      } else {
        setTranslationStage("Dịch thất bại");
        onNotice(friendlyErrorMessage(error, "Dịch thất bại."), "error");
      }
    } finally {
      clearTranslationProgressTimer();
      translationControllerRef.current = undefined;
      window.setTimeout(() => setTranslationWorking(false), 450);
    }
  };

  const runDubbing = async (configs: Record<VoiceGroup, VoiceConfig>) => {
    const dubbingCues = cues.filter(isDubbableSubtitleCue);
    if (!dubbingCues.length) {
      onNotice("Không có cue phụ đề nào để lồng tiếng.", "error");
      return;
    }
    const entries = dubbingCues.map((cue, index) => {
      const config = configs[cue.voiceGroup];
      return {
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        originalText: cue.originalText,
        translatedText: cue.translatedText || cue.originalText,
        text: applyPronunciation(
          cue.translatedText || cue.originalText,
          pronunciation,
        ),
        previousText:
          dubbingCues[index - 1]?.translatedText ||
          dubbingCues[index - 1]?.originalText ||
          "",
        nextText:
          dubbingCues[index + 1]?.translatedText ||
          dubbingCues[index + 1]?.originalText ||
          "",
        provider: providers.find(
          (provider) => provider.id === config.assignment.providerId,
        ),
        model: config.assignment.model,
        voice: config.voice,
        speed: config.speed,
        volume: config.volume,
      };
    });
    if (
      entries.some((entry) => !entry.provider || !entry.model || !entry.voice)
    ) {
      onNotice(
        "Mỗi Voice Group đang dùng phải có Provider, Model và Voice ID.",
        "error",
      );
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setDubbingOpen(false);
    setWorkingTitle("Đang xử lý audio");
    setWorkingMessage("Provider → FFprobe → atempo → dub-track.wav");
    setWorking(true);
    try {
      const result = await api.generateDubTrack(
        entries as Array<{
          id: string;
          startMs: number;
          endMs: number;
          originalText: string;
          translatedText: string;
          text: string;
          previousText: string;
          nextText: string;
          provider: AIProvider;
          model: string;
          voice: string;
          speed: number;
          volume: number;
        }>,
        controller.signal,
      );
      setDubTrack(result.blob);
      if (result.metadata.length) {
        onCuesChange(applyDubbingMetadata(cues, result.metadata));
      }
      saveBlob("autosub-dub-track.wav", result.blob);
      const warningText = result.warnings.join(" ");
      const hasHardWarning = result.warnings.some((warning) =>
        /vượt thời lượng|không tạo được audio/i.test(warning),
      );
      onNotice(
        warningText
          ? `Đã tạo dub-track.wav. ${warningText}`
          : "Đã tạo dub-track.wav và căn audio theo timestamp.",
        hasHardWarning ? "error" : "success",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        onNotice("Đã hủy tạo dub track.", "success");
      else
        onNotice(
          friendlyErrorMessage(error, "Tạo dub track thất bại."),
          "error",
        );
    } finally {
      controllerRef.current = undefined;
      setWorking(false);
    }
  };

  const runDubbingJob = async (
    configs: Record<VoiceGroup, VoiceConfig>,
    options: DubbingRunOptions,
  ) => {
    const dubbingCues = cues.filter(isDubbableSubtitleCue);
    if (!dubbingCues.length) {
      onNotice("Không có cue phụ đề nào để lồng tiếng.", "error");
      return;
    }
    const entries = dubbingCues.map((cue, index) => {
      const config = configs[cue.voiceGroup] || configs.G1;
      const text = applyPronunciation(
        cue.translatedText || cue.originalText,
        pronunciation,
      ).trim();
      return {
        id: cue.id,
        index: cue.index,
        startMs: cue.startMs,
        endMs: cue.endMs,
        originalText: cue.originalText,
        translatedText: cue.translatedText || cue.originalText,
        text,
        previousText:
          dubbingCues[index - 1]?.translatedText ||
          dubbingCues[index - 1]?.originalText ||
          "",
        nextText:
          dubbingCues[index + 1]?.translatedText ||
          dubbingCues[index + 1]?.originalText ||
          "",
        provider: config
          ? providers.find(
              (provider) => provider.id === config.assignment.providerId,
            )
          : undefined,
        model: config?.assignment.model || "",
        voice: config?.voice || "",
        speed: options.slowVideoToMatchSpeech ? 1 : (config?.speed ?? 1),
        volume: config?.volume ?? 1,
      };
    });
    const duplicateIds = entries.filter(
      (entry, index) =>
        entries.findIndex((item) => item.id === entry.id) !== index,
    );
    const invalid = entries.find(
      (entry) =>
        !entry.provider ||
        !entry.provider.baseUrl ||
        !entry.model ||
        !entry.voice ||
        !entry.text,
    );
    if (duplicateIds.length) {
      onNotice(
        `Dubbing không thể bắt đầu: cue ID bị trùng (${duplicateIds[0]?.id || "không xác định"}).`,
        "error",
      );
      return;
    }
    if (invalid) {
      onNotice(
        `Dubbing không thể bắt đầu: cue ${invalid.index ?? invalid.id} thiếu Provider, Model, Voice ID hoặc nội dung đọc.`,
        "error",
      );
      return;
    }
    try {
      setDubAudioUrl(undefined);
      setDubAudioMix(undefined);
      const created = await api.createDubbingJob(
        entries as Array<{
          id: string;
          index?: number;
          startMs: number;
          endMs: number;
          originalText: string;
          translatedText: string;
          text: string;
          previousText: string;
          nextText: string;
          provider: AIProvider;
          model: string;
          voice: string;
          speed: number;
          volume: number;
        }>,
        {
          videoId: asset?.uploadId,
          // The imported SRT already marks real speech and silence accurately.
          // Keep its text and windows strict; group fitting handles long speech.
          timingMode: "strict",
          batchSize: 30,
          ttsConcurrency: 6,
          llmConcurrency: 3,
          maxRetries: 3,
          slowVideoToMatchSpeech: options.slowVideoToMatchSpeech,
          audioMix: options.audioMix,
        },
      );
      if (asset?.uploadId)
        storage.saveDubbingJob(asset.uploadId, created.jobId);
      const status = await api.startDubbingJob(created.jobId);
      dubbingTerminalNoticeRef.current = "";
      setDubbingJob(status);
      onNotice(
        `Đã tạo dubbing job ${created.jobId}. Có thể đóng popup; job vẫn chạy và tự resume sau khi khởi động lại server.`,
        "success",
      );
    } catch (error) {
      onNotice(
        friendlyErrorMessage(error, "Không thể tạo dubbing job."),
        "error",
      );
    }
  };

  const editingTextCue = selected?.sourceKind === "onscreen-text";
  const styleEditorValue: SubtitleStyle = editingTextCue && selected
    ? { ...settings.subtitleStyle, ...selected.styleOverrides }
    : settings.subtitleStyle;
  const textCuePosition = editingTextCue && selected
    ? selected.screenPosition ?? {
        xPercent: styleEditorValue.customX ?? 50,
        yPercent: styleEditorValue.customY ?? 50,
      }
    : undefined;
  const changeTextPosition = (patch: Partial<{ xPercent: number; yPercent: number }>) => {
    if (!editingTextCue || !selected || !textCuePosition) return;
    changeCue(selected.id, {
      screenPosition: {
        xPercent: Math.max(0, Math.min(100, patch.xPercent ?? textCuePosition.xPercent)),
        yPercent: Math.max(0, Math.min(100, patch.yPercent ?? textCuePosition.yPercent)),
      },
    });
  };
  const styleChange = (patch: Partial<SubtitleStyle>) => {
    if (editingTextCue && selected) {
      changeCue(selected.id, { styleOverrides: { ...selected.styleOverrides, ...patch } });
      return;
    }
    onSettingsChange({
      ...settings,
      subtitleStyle: { ...settings.subtitleStyle, ...patch },
    });
    if (cues.some((cue) => cue.sourceKind !== "onscreen-text" && (cue.styleOverrides || cue.screenPosition))) {
      onCuesChange(cues.map((cue) => cue.sourceKind === "onscreen-text"
        ? cue
        : { ...cue, styleOverrides: undefined, screenPosition: undefined }));
    }
  };
  const downloadSubtitle = (format: "translated" | "original" | "ass") => {
    const validation = validateCues(cues);
    if (!validation.valid) {
      onNotice(validation.errors[0] || "Subtitle không hợp lệ.", "error");
      return;
    }
    const useRetimedTimeline = dubbingJob?.config.slowVideoToMatchSpeech === true;
    const subtitleCues = cuesForDubbingTimeline(cues, useRetimedTimeline);
    const retimedSuffix = useRetimedTimeline ? "-retimed" : "";
    if (format === "ass")
      downloadText(
        `autosub${retimedSuffix}.ass`,
        cuesToAss(subtitleCues, settings.subtitleStyle),
        "text/x-ass",
      );
    else
      downloadText(
        `autosub-${format}${retimedSuffix}.srt`,
        cuesToSrt(subtitleCues, format === "translated"),
        "application/x-subrip",
      );
    setSubtitleDownloadOpen(false);
    onNotice(
      `Đã tải ${format === "ass" ? "ASS styled" : format === "translated" ? "SRT bản dịch" : "SRT bản gốc"}.`,
      "success",
    );
  };
  const importSubtitle = async (file?: File) => {
    if (!file) return;
    if (
      dubbingJob &&
      ["queued", "running", "paused"].includes(dubbingJob.status)
    ) {
      onNotice(
        "Hãy hoàn tất hoặc hủy dubbing job hiện tại trước khi thay subtitle.",
        "error",
      );
      return;
    }
    if (!/\.(srt|vtt)$/i.test(file.name)) {
      onNotice("Editor chỉ nhận file phụ đề .SRT hoặc .VTT.", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onNotice("File phụ đề lớn hơn 10 MB nên không thể nạp.", "error");
      return;
    }
    const request = ++subtitleImportRequestRef.current;
    try {
      const parsed = parseSubtitle(await file.text(), file.name);
      if (request !== subtitleImportRequestRef.current) return;
      if (!parsed.length) {
        onNotice(`Không đọc được cue hợp lệ từ ${file.name}.`, "error");
        return;
      }
      const validation = validateCues(parsed);
      if (!validation.valid) {
        onNotice(
          validation.errors[0] || "File phụ đề có timestamp không hợp lệ.",
          "error",
        );
        return;
      }
      onCuesChange(parsed);
      setSelectedId(parsed[0]?.id);
      currentTimeRef.current = parsed[0]?.startMs || 0;
      setSeekRequest({
        id: ++seekRequestIdRef.current,
        timeMs: parsed[0]?.startMs || 0,
      });
      setDubTrack(undefined);
      setDubAudioUrl(undefined);
      setDubAudioMix(undefined);
      if (asset?.uploadId) storage.removeDubbingJob(asset.uploadId);
      setDubbingJob(undefined);
      dubbingTerminalNoticeRef.current = "";
      onNotice(
        `Đã nạp ${parsed.length} cue từ ${file.name}. Dub-track cũ đã được tách khỏi preview.`,
        "success",
      );
    } catch (error) {
      if (request !== subtitleImportRequestRef.current) return;
      onNotice(
        friendlyErrorMessage(error, `Không thể đọc ${file.name}.`),
        "error",
      );
    }
  };
  const previewLogoChange = (patch: Partial<LogoOverlay>) => {
    if (logoOpen)
      setLogoPreview((current) =>
        current ? { ...current, ...patch } : current,
      );
    else
      setLogo((current) => (current ? { ...current, ...patch } : current));
  };
  const closeLogoEditor = () => {
    if (
      logoPreview?.url &&
      logoPreview.url !== logo?.url &&
      logoPreview.url.startsWith("blob:")
    )
      URL.revokeObjectURL(logoPreview.url);
    setLogoPreview(logo);
    setLogoOpen(false);
  };
  const closeCueList = useCallback(() => {
    setCueListOpen(false);
    requestAnimationFrame(() => cueListTriggerRef.current?.focus());
  }, []);

  const resizeEditorPane = useCallback((kind: "tools" | "inspector" | "preview", event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const workspace = editorWorkspaceRef.current;
    if (!workspace) return;
    const bounds = workspace.getBoundingClientRect();
    const computed = getComputedStyle(workspace);
    const startTools = Number.parseFloat(computed.getPropertyValue("--editor-tools-width")) || 248;
    const startInspector = Number.parseFloat(computed.getPropertyValue("--editor-inspector-width")) || 340;
    const startPreview = Number.parseFloat(computed.getPropertyValue("--editor-preview-height")) || 430;
    const startX = event.clientX;
    const startY = event.clientY;
    document.body.classList.add("editor-resizing", `editor-resizing-${kind === "preview" ? "row" : "column"}`);

    const setValue = (value: number) => {
      const property = kind === "tools" ? "--editor-tools-width" : kind === "inspector" ? "--editor-inspector-width" : "--editor-preview-height";
      workspace.style.setProperty(property, `${Math.round(value)}px`);
    };
    let pendingValue: number | undefined;
    let resizeFrame: number | undefined;
    const queueValue = (value: number) => {
      pendingValue = value;
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        if (pendingValue === undefined) return;
        setValue(pendingValue);
        pendingValue = undefined;
      });
    };
    const move = (pointer: PointerEvent) => {
      if (kind === "tools") {
        const maximum = Math.min(420, bounds.width - startInspector - 470);
        queueValue(Math.max(184, Math.min(maximum, startTools + pointer.clientX - startX)));
      } else if (kind === "inspector") {
        const maximum = Math.min(520, bounds.width - startTools - 470);
        queueValue(Math.max(270, Math.min(maximum, startInspector - pointer.clientX + startX)));
      } else {
        const maximum = Math.max(250, bounds.height - 205);
        queueValue(Math.max(220, Math.min(maximum, startPreview + pointer.clientY - startY)));
      }
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      if (pendingValue !== undefined) setValue(pendingValue);
      document.body.classList.remove("editor-resizing", "editor-resizing-row", "editor-resizing-column");
      const next = getComputedStyle(workspace);
      try {
        localStorage.setItem("autosub.editor-layout", JSON.stringify({
          tools: Number.parseFloat(next.getPropertyValue("--editor-tools-width")) || startTools,
          inspector: Number.parseFloat(next.getPropertyValue("--editor-inspector-width")) || startInspector,
          preview: Number.parseFloat(next.getPropertyValue("--editor-preview-height")) || startPreview,
        }));
      } catch { /* Layout persistence is optional. */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, []);

  const nudgeEditorPane = useCallback((kind: "tools" | "inspector" | "preview", delta: number) => {
    const workspace = editorWorkspaceRef.current;
    if (!workspace) return;
    const computed = getComputedStyle(workspace);
    const property = kind === "tools" ? "--editor-tools-width" : kind === "inspector" ? "--editor-inspector-width" : "--editor-preview-height";
    const current = Number.parseFloat(computed.getPropertyValue(property));
    const minimum = kind === "tools" ? 184 : kind === "inspector" ? 270 : 220;
    const maximum = kind === "preview" ? Math.max(250, workspace.clientHeight - 205) : kind === "tools" ? 420 : 520;
    workspace.style.setProperty(property, `${Math.max(minimum, Math.min(maximum, current + delta))}px`);
  }, []);

  useEffect(() => {
    if (!cueListOpen) return;
    requestAnimationFrame(() => cueListCloseRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCueList();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeCueList, cueListOpen]);

  return (
    <div className="page editor-page">
      <header className="editor-header">
        <div>
          <div className="eyebrow">EDITOR / MASTER SEQUENCE</div>
          <h1>
            Lồng tiếng <span>video</span>
          </h1>
          <p>
            {cues.length
              ? `${cues.length} cue đang mở · autosave local`
              : "Mở một subtitle sequence để bắt đầu dựng."}
          </p>
        </div>
        <div className="editor-header-actions">
          <label className="button ghost file-button">
            <Captions size={15} /> Nạp SRT
            <input
              type="file"
              accept=".srt,.vtt,text/vtt,application/x-subrip"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void importSubtitle(file);
              }}
            />
          </label>
          <button
            type="button"
            className={`button ghost ${pickingLocalVideo ? "active" : ""}`}
            title={
              pickingLocalVideo
                ? "Hủy hộp thoại chọn video"
                : "Đọc trực tiếp video lớn trên máy, không upload hoặc sao chép"
            }
            onClick={() => void importLocalVideo()}
          >
            <FileVideo size={15} />{" "}
            {pickingLocalVideo ? "Hủy chọn video" : "Mở video lớn"}
          </button>
          <label className="button ghost file-button">
            <Upload size={15} />{" "}
            {uploadingVideo ? "Đang lưu…" : asset ? "Thay video" : "Chọn video"}
            <input
              type="file"
              accept="video/*"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                selectVideo(file);
              }}
            />
          </label>
        </div>
      </header>
      <div className="editor-toolbar">
        <button
          onClick={() => setTranslationOpen(true)}
          disabled={translationWorking}
        >
          <Languages size={15} /> Dịch bằng AI
        </button>
        <button
          className={blurEditMode ? "active" : ""}
          onClick={() => {
            setBlurEditMode(true);
            setBlurOpen(true);
          }}
        >
          <Scissors size={15} /> Làm mờ
        </button>
        <button
          className={logoOpen ? "active" : ""}
          onClick={() => {
            if (logoOpen) closeLogoEditor();
            else {
              setPanel("none");
              setLogoPreview(logo ? { ...logo } : undefined);
              setLogoOpen(true);
            }
          }}
        >
          <ImageIcon size={15} /> Logo
        </button>
        <button
          className={panel === "style" ? "active" : ""}
          onClick={() => {
            if (logoOpen) closeLogoEditor();
            setCueListOpen(false);
            setPanel(panel === "style" ? "none" : "style");
          }}
        >
          <Captions size={15} /> {editingTextCue ? "Văn bản" : "Phụ đề"}
        </button>
        <button onClick={() => {
          setDubbingInitialAudioMode("mute");
          setDubbingOpen(true);
        }}>
          <AudioLines size={15} /> Lồng tiếng
        </button>
        <button
          className={panel === "audio" ? "active" : ""}
          disabled={!dubAudioUrl}
          title={dubAudioUrl ? "Trộn giọng gốc và giọng lồng tiếng" : "Hãy tạo bản lồng tiếng trước"}
          aria-expanded={panel === "audio"}
          onClick={() => {
            if (logoOpen) closeLogoEditor();
            setCueListOpen(false);
            setPanel(panel === "audio" ? "none" : "audio");
          }}
        >
          <Volume2 size={15} /> Âm thanh
        </button>
        <button
          ref={cueListTriggerRef}
          type="button"
          className={cueListOpen ? "active cue-list-trigger" : "cue-list-trigger"}
          aria-controls="editor-cue-drawer"
          aria-expanded={cueListOpen}
          onClick={() => {
            if (logoOpen) closeLogoEditor();
            setPanel("none");
            setCueListOpen((value) => !value);
          }}
        >
          <LayoutList size={15} /> Danh sách cue <b>{cues.length}</b>
        </button>
        <button className="toolbar-export" onClick={() => {
          // The logo editor previews every change immediately. Export the
          // exact state currently visible even when the user has not pressed
          // the modal's Save button yet.
          if (logoOpen && logoPreview) {
            setLogo(logoPreview);
            setLogoOpen(false);
          }
          setExportOpen(true);
        }}>
          <Download size={15} /> Xuất file
        </button>
      </div>
      <div className="subtitle-download-bar">
        <span>
          <Download size={14} /> Tải phụ đề
        </span>
        <div className="subtitle-download-control" ref={subtitleDownloadRef}>
          <button
            type="button"
            className="button small ghost"
            onClick={() => {
              if (!subtitleDownloadOpen)
                announceDropdownOpen(subtitleDownloadId.current);
              setSubtitleDownloadOpen((value) => !value);
            }}
          >
            <span>Chọn định dạng</span>
            <ChevronDown
              size={14}
              className={subtitleDownloadOpen ? "rotated" : ""}
            />
          </button>
          {subtitleDownloadOpen && (
            <div className="subtitle-download-menu">
              <button
                type="button"
                onClick={() => downloadSubtitle("translated")}
              >
                <span>SRT bản dịch</span>
                <small>.srt</small>
              </button>
              <button
                type="button"
                onClick={() => downloadSubtitle("original")}
              >
                <span>SRT bản gốc</span>
                <small>.srt</small>
              </button>
              <button type="button" onClick={() => downloadSubtitle("ass")}>
                <span>ASS styled</span>
                <small>.ass</small>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="preview-audio-bar">
        <div>
          <span>PREVIEW AUDIO</span>
          <small>
            {dubAudioUrl
              ? "Đang phát bản lồng tiếng mới nhất"
              : "Chưa có bản lồng tiếng · video nguồn chỉ dùng để dựng"}
          </small>
        </div>
        {dubAudioUrl && (
          <strong className="preview-audio-status">DUB MỚI NHẤT</strong>
        )}
      </div>
      {blurEditMode && (
        <div className="editor-mode-banner">
          <Scissors size={14} />
          <span>Kéo trực tiếp vùng làm mờ trên video. Bấm Làm mờ để mở lại bảng điều khiển.</span>
          <button type="button" className="button small ghost" onClick={() => setBlurEditMode(false)}>Xong</button>
        </div>
      )}
      <section
        ref={editorWorkspaceRef}
        className="editor-main"
        style={{
          "--editor-tools-width": `${editorLayout.tools}px`,
          "--editor-inspector-width": `${editorLayout.inspector}px`,
          "--editor-preview-height": `${editorLayout.preview}px`,
        } as CSSProperties}
      >
        <aside className="editor-tool-panel" aria-label="Công cụ biên tập">
          <div className="editor-side-heading">
            <div>
              <span>CÔNG CỤ</span>
              <strong>Biên tập video</strong>
            </div>
            <small>{cues.length} cue</small>
          </div>
          <div className="editor-file-actions">
            <label className="editor-side-action file-button">
              <Upload size={16} />
              <span><b>{asset ? "Thay video" : "Mở video"}</b><small>Tải video vào project</small></span>
              <input
                type="file"
                accept="video/*"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  selectVideo(file);
                }}
              />
            </label>
            <button type="button" className="editor-side-action" onClick={() => void importLocalVideo()}>
              <FileVideo size={16} />
              <span><b>{pickingLocalVideo ? "Hủy chọn video" : "Mở video lớn"}</b><small>Đọc trực tiếp từ máy</small></span>
            </button>
            <label className="editor-side-action file-button">
              <Captions size={16} />
              <span><b>Nạp phụ đề</b><small>SRT hoặc VTT</small></span>
              <input
                type="file"
                accept=".srt,.vtt,text/vtt,application/x-subrip"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void importSubtitle(file);
                }}
              />
            </label>
          </div>
          <div className="editor-side-section">
            <span>XỬ LÝ</span>
            <button type="button" onClick={() => setTranslationOpen(true)} disabled={translationWorking}><Languages size={16} /><b>Dịch bằng AI</b><small>Dịch toàn bộ cue</small></button>
            <button type="button" className={blurEditMode ? "active" : ""} onClick={() => { setBlurEditMode(true); setBlurOpen(true); }}><Scissors size={16} /><b>Làm mờ</b><small>Che hoặc tái tạo vùng</small></button>
            <button type="button" className={logoOpen ? "active" : ""} onClick={() => { if (logoOpen) closeLogoEditor(); else { setPanel("none"); setLogoPreview(logo ? { ...logo } : undefined); setLogoOpen(true); } }}><ImageIcon size={16} /><b>Logo / watermark</b><small>Ảnh hoặc chữ</small></button>
            <button type="button" onClick={() => { setDubbingInitialAudioMode("mute"); setDubbingOpen(true); }}><AudioLines size={16} /><b>Lồng tiếng</b><small>Tạo giọng theo cue</small></button>
          </div>
          <div className="editor-side-section editor-side-library">
            <span>DỮ LIỆU</span>
            <button ref={cueListTriggerRef} type="button" className={cueListOpen ? "active" : ""} aria-controls="editor-cue-drawer" aria-expanded={cueListOpen} onClick={() => { if (logoOpen) closeLogoEditor(); setCueListOpen((value) => !value); }}><LayoutList size={16} /><b>Danh sách cue</b><small>Mở bảng nội dung</small></button>
            <button type="button" onClick={() => setPanel("style")}><Captions size={16} /><b>Kiểu phụ đề</b><small>Font, viền và vị trí</small></button>
            <button type="button" onClick={() => setPanel(dubAudioUrl ? "audio" : "style")} disabled={!dubAudioUrl}><Volume2 size={16} /><b>Âm thanh</b><small>Trộn bản gốc và dub</small></button>
          </div>
          <div className="editor-side-output">
            <button type="button" className="button ghost" disabled={!cues.length} onClick={() => downloadSubtitle("translated")}><Captions size={15} /> Tải SRT</button>
            <button type="button" className="button primary" onClick={() => {
              if (logoOpen && logoPreview) {
                setLogo(logoPreview);
                setLogoOpen(false);
              }
              setExportOpen(true);
            }}><Download size={15} /> Xuất video</button>
          </div>
          <div className="editor-side-status">
            <i className="status-dot" />
            <span>{dubAudioUrl ? "Preview đang dùng bản dub mới nhất" : "Preview đang dùng âm thanh nguồn"}</span>
          </div>
        </aside>
        <div
          className="editor-splitter editor-column-splitter editor-tools-splitter"
          role="separator"
          aria-label="Thay đổi chiều rộng bảng công cụ"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => resizeEditorPane("tools", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              nudgeEditorPane("tools", event.key === "ArrowLeft" ? -16 : 16);
            }
          }}
        />
        <div className="editor-left">
          <VideoPlayer
            asset={asset}
            cues={cues}
            style={settings.subtitleStyle}
            blurRegions={blurRegions}
            logo={logoOpen ? logoPreview : logo}
            dubAudioUrl={dubAudioUrl}
            audioMode={dubAudioUrl ? "dubbed" : "original"}
            dubAudioMix={dubAudioMix}
            slowVideoToMatchSpeech={dubbingJob?.config.slowVideoToMatchSpeech === true}
            seekRequest={seekRequest}
            onTime={reportEditorTime}
            onActiveCueChange={setActiveCueId}
            selectedCueId={selectedId}
            onCueSelect={selectCue}
            onCueFocus={focusCue}
            onCueChange={changeCue}
            onAddTextCue={addTextCue}
            onDeleteCue={deleteCue}
            onDeleteCues={deleteCues}
            onSplitCueAtTime={splitCueAtTime}
            onDuplicateCue={duplicateCue}
            onExportStem={exportStemAudio}
            onOpenAudioMix={() => setPanel(dubAudioUrl ? "audio" : "none")}
            onOpenDubbingAudioMode={openDubbingWithAudioMode}
            onStyleChange={styleChange}
            onLogoChange={previewLogoChange}
            onBlurRegionsChange={setBlurRegions}
            blurEditMode={blurEditMode}
            videoEdit={videoEdit}
            onVideoEditChange={setVideoEdit}
          />
          <div className="editor-footnote">
            <span>
              <i className="status-dot" /> Autosave local
            </span>
            <small>
              SubtitleCue[] là source of truth ·{" "}
              {cues.filter((cue) => cue.translatedText).length}/{cues.length}{" "}
              bản dịch
            </small>
          </div>
        </div>
        <div
          className="editor-splitter editor-column-splitter editor-inspector-splitter"
          role="separator"
          aria-label="Thay đổi chiều rộng bảng thuộc tính"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => resizeEditorPane("inspector", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              nudgeEditorPane("inspector", event.key === "ArrowLeft" ? 16 : -16);
            }
          }}
        />
        {cueListOpen && <button type="button" className="editor-cue-drawer-backdrop" aria-label="Đóng danh sách cue" onClick={closeCueList} />}
        <aside
          id="editor-cue-drawer"
          className={`editor-right editor-cue-drawer ${cueListOpen ? "open" : ""}`}
          aria-label="Danh sách cue"
          aria-hidden={!cueListOpen}
          inert={!cueListOpen}
        >
          <div className="editor-metrics">
            <div className="editor-metric">
              <span>TỐC ĐỘ</span>
              <strong>
                Gốc: <b>{editorMetrics.original.toFixed(1)}</b> c/s · Dịch:{" "}
                <b>{editorMetrics.translated.toFixed(1)}</b> c/s
              </strong>
              <small>TB tốc độ thoại theo cue</small>
            </div>
            <div className="editor-metric">
              <span>CPS CHUẨN</span>
              <strong>
                G1: <b>{editorMetrics.groups[0]?.value.toFixed(1)}</b> · G2:{" "}
                <b>{editorMetrics.groups[1]?.value.toFixed(1)}</b> · G3:{" "}
                <b>{editorMetrics.groups[2]?.value.toFixed(1)}</b>
              </strong>
              <small>
                Chuẩn: {editorMetrics.standard.group} ·{" "}
                {editorMetrics.standard.value.toFixed(1)} c/s
              </small>
            </div>
          </div>
          <div className="list-heading">
            <div>
              <span>NỘI DUNG</span>
              <b>{cues.length}</b>
            </div>
            <div className="cue-drawer-actions">
              <button className="icon-button" onClick={addCue} aria-label="Thêm cue"><Plus size={16} /></button>
              <button ref={cueListCloseRef} className="icon-button" onClick={closeCueList} aria-label="Đóng danh sách cue"><X size={16} /></button>
            </div>
          </div>
          <SubtitleList
            cues={cues}
            activeCueId={activeCueId}
            selectedId={selectedId}
            onSelect={selectCue}
            onChange={changeCue}
            onDelete={deleteCue}
            onRegenerateVoice={regenerateCueVoice}
            regeneratingCueId={regeneratingCueId}
            voiceReady={dubbingJob?.status === "completed"}
            slowVideoToMatchSpeech={dubbingJob?.config.slowVideoToMatchSpeech === true}
          />
        </aside>
        <aside className="editor-inspector" aria-label="Thuộc tính">
          <div className="editor-inspector-tabs" role="tablist" aria-label="Nhóm thuộc tính">
            <button type="button" role="tab" aria-selected={panel === "style"} className={panel === "style" ? "active" : ""} onClick={() => setPanel("style")}><Captions size={15} /> Chữ</button>
            <button type="button" role="tab" aria-selected={panel === "audio"} className={panel === "audio" ? "active" : ""} disabled={!dubAudioUrl} onClick={() => setPanel("audio")}><Volume2 size={15} /> Âm thanh</button>
          </div>
          {panel === "none" && (
            <div className="editor-inspector-empty">
              <Settings2 size={22} />
              <strong>Chọn đối tượng để chỉnh</strong>
              <small>Chọn phụ đề trên preview hoặc timeline để mở thuộc tính.</small>
              <button type="button" className="button small ghost" onClick={() => setPanel("style")}>Mở chỉnh chữ</button>
            </div>
          )}
        {panel === "style" && (
          <aside className="floating-panel style-floating-panel">
            <div className="floating-head">
              <span>
                <Settings2 size={15} /> {editingTextCue ? "TEXT STYLE" : "SUBTITLE STYLE"}
              </span>
              <button className="icon-button" onClick={() => setPanel("none")}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {editingTextCue && selected && textCuePosition && (
              <section className="text-inspector" aria-label="Chỉnh văn bản đã chọn">
                <div className="text-inspector-status">
                  <span>TEXT #{String(selected.index).padStart(2, "0")}</span>
                  <small>Chỉ áp dụng cho cue đang chọn</small>
                </div>
                <label className="field text-content-field">
                  <span>Nội dung gốc / hiển thị</span>
                  <textarea value={selected.originalText} rows={3} onChange={(event) => changeCue(selected.id, { originalText: event.target.value })} />
                </label>
                <label className="field text-content-field">
                  <span>Bản dịch <small>để trống nếu không cần</small></span>
                  <textarea value={selected.translatedText} rows={2} placeholder="Chưa có bản dịch" onChange={(event) => changeCue(selected.id, { translatedText: event.target.value })} />
                </label>
                <div className="text-position-editor">
                  <div className="text-position-heading"><span>Vị trí trên khung hình</span><b>X {Math.round(textCuePosition.xPercent)}% · Y {Math.round(textCuePosition.yPercent)}%</b></div>
                  <div className="text-position-body">
                    <div className="position-pad" aria-label="Vị trí nhanh">
                      {[10, 50, 90].flatMap((y) => [10, 50, 90].map((x) => (
                        <button type="button" key={`${x}-${y}`} className={Math.abs(textCuePosition.xPercent - x) < 2 && Math.abs(textCuePosition.yPercent - y) < 2 ? "active" : ""} aria-label={`Đặt văn bản tại X ${x}%, Y ${y}%`} onClick={() => changeTextPosition({ xPercent: x, yPercent: y })} />
                      )))}
                    </div>
                    <div className="position-sliders">
                      <label><span>X</span><RangeInput min={0} max={100} value={textCuePosition.xPercent} onChange={(event) => changeTextPosition({ xPercent: Number(event.target.value) })} /></label>
                      <label><span>Y</span><RangeInput min={0} max={100} value={textCuePosition.yPercent} onChange={(event) => changeTextPosition({ yPercent: Number(event.target.value) })} /></label>
                    </div>
                  </div>
                  <small>Kéo trực tiếp chữ trên video để đặt chính xác hơn.</small>
                </div>
              </section>
            )}
            <SubtitleStylePanel
              style={styleEditorValue}
              onChange={styleChange}
              uploadedFonts={fontUploads}
              onFontUpload={uploadSubtitleFont}
              mode={editingTextCue ? "text" : "subtitle"}
            />
            <div className="style-preview">
              <span>PREVIEW</span>
              <div className="style-preview-surface">
                <span
                  className="style-preview-text"
                  style={subtitleTextCss(styleEditorValue, 0.45, 12)}
                >
                  {selected?.translatedText ||
                    selected?.originalText ||
                    "Bản dịch preview"}
                </span>
              </div>
            </div>
          </aside>
        )}
        {panel === "audio" && dubAudioUrl && (
          <aside
            className="floating-panel style-floating-panel audio-mix-floating-panel"
            aria-label="Điều chỉnh âm thanh"
          >
            <div className="floating-head">
              <span>
                <Volume2 size={15} /> AUDIO MIX
              </span>
              <button className="icon-button" onClick={() => setPanel("none")}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="audio-mix-intro">
              <strong>Bản phối đầu ra</strong>
              <small>Nghe thử và video xuất dùng đúng các mức âm lượng bên dưới.</small>
            </div>
            <label
              className={`toggle-row audio-source-toggle ${effectiveDubAudioMix.separateVocals ? "disabled" : ""}`}
            >
              <span>
                Bật giọng gốc
                <small>Phát âm thanh nguồn cùng bản lồng tiếng</small>
              </span>
              <input
                type="checkbox"
                checked={effectiveDubAudioMix.keepOriginal}
                disabled={effectiveDubAudioMix.separateVocals}
                onChange={(event) => updateDubAudioMix({ keepOriginal: event.target.checked })}
              />
              <i aria-hidden="true" />
            </label>
            {effectiveDubAudioMix.separateVocals && (
              <div className="audio-mix-warning">
                Bản lồng tiếng này đã trộn sẵn nhạc nền. Muốn bật giọng gốc riêng, hãy tạo lại bản lồng tiếng với tùy chọn giữ âm thanh gốc.
              </div>
            )}
            <div className={`audio-level-control ${effectiveDubAudioMix.keepOriginal ? "" : "disabled"}`}>
              <div>
                <span>Giọng gốc</span>
                <b>{Math.round(effectiveDubAudioMix.originalVolume * 100)}%</b>
              </div>
              <RangeInput
                min={0}
                max={1}
                step={0.01}
                value={effectiveDubAudioMix.originalVolume}
                disabled={!effectiveDubAudioMix.keepOriginal}
                aria-label="Âm lượng giọng gốc"
                onChange={(event) => updateDubAudioMix({ originalVolume: Number(event.target.value) })}
              />
            </div>
            <div className="audio-level-control">
              <div>
                <span>Giọng lồng tiếng</span>
                <b>{Math.round(effectiveDubAudioMix.dubVolume * 100)}%</b>
              </div>
              <RangeInput
                min={0}
                max={1}
                step={0.01}
                value={effectiveDubAudioMix.dubVolume}
                aria-label="Âm lượng giọng lồng tiếng"
                onChange={(event) => updateDubAudioMix({ dubVolume: Number(event.target.value) })}
              />
            </div>
            <div className="audio-mix-summary">
              <span>PREVIEW = EXPORT</span>
              <small>Mức trộn này được áp dụng cả khi xem trước và khi xuất MP4.</small>
            </div>
          </aside>
        )}
        </aside>
        <div
          className="editor-splitter editor-row-splitter"
          role="separator"
          aria-label="Thay đổi chiều cao timeline"
          aria-orientation="horizontal"
          tabIndex={0}
          onPointerDown={(event) => resizeEditorPane("preview", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              nudgeEditorPane("preview", event.key === "ArrowUp" ? -16 : 16);
            }
          }}
        />
      </section>
      <BlurEditor
        open={blurOpen}
        regions={blurRegions}
        asset={asset}
        currentTimeMs={currentTimeRef.current}
        onClose={() => setBlurOpen(false)}
        onChange={setBlurRegions}
      />
      <TranslationSetupModal
        open={translationOpen}
        provider={providers.find(
          (item) => item.id === translationSetup.providerId,
        )}
        providers={providers}
        assignments={capabilityAssignments(settings, "translation")}
        cues={cues}
        setup={translationSetup}
        onChange={(patch) =>
          setTranslationSetup((current) => ({ ...current, ...patch }))
        }
        onClose={() => setTranslationOpen(false)}
        onStart={(setup) => void translateAll(setup)}
      />
      <LogoModal
        open={logoOpen}
        logo={logoOpen ? logoPreview : logo}
        externalPosition={logoPreview}
        uploadedFonts={fontUploads}
        onFontUpload={uploadSubtitleFont}
        onClose={() => setLogoOpen(false)}
        onPreviewChange={setLogoPreview}
        onChange={(next) => {
          void (async () => {
            let saved = next;
            if (next.kind === "image" && next.file) {
              try {
                saved = { ...next, url: await fileToDataUrl(next.file) };
              } catch {
                onNotice(
                  "Đã cập nhật logo, nhưng không thể lưu ảnh logo qua reload.",
                  "error",
                );
              }
            }
          if (
            logo?.url &&
            logo.url !== saved.url &&
            logo.url.startsWith("blob:")
          )
            URL.revokeObjectURL(logo.url);
          setLogo(saved);
          setLogoPreview(saved);
          onNotice("Đã cập nhật logo/watermark.", "success");
          })();
        }}
      />
      <DubbingModal
        open={dubbingOpen}
        providers={providers}
        assignments={assignments}
        availableAssignments={capabilityAssignments(settings, "tts")}
        cues={cues}
        pronunciation={pronunciation}
        sourceVideoReady={Boolean(asset?.uploadId)}
        sourceVideoUploading={videoAction !== "idle"}
        job={dubbingJob}
        onJobAction={(action) => void dubbingJobAction(action)}
        onClose={() => setDubbingOpen(false)}
        initialSourceAudioMode={dubbingInitialAudioMode}
        onPronunciationChange={setPronunciation}
        onNotice={onNotice}
        onRun={(configs, options) => void runDubbingJob(configs, options)}
      />
      <ExportModal
        open={exportOpen}
        cues={cues}
        style={settings.subtitleStyle}
        asset={asset}
        videoEdit={videoEdit}
        logo={logo}
        fontUpload={fontUploads.find((font) => font.family === settings.subtitleStyle.fontFamily)}
        logoFontUpload={fontUploads.find((font) => font.family === (logoOpen ? logoPreview : logo)?.fontFamily)}
        blurRegions={blurRegions}
        dubTrack={dubTrack}
        dubbingJobId={
          dubbingJob?.result && ["completed", "completed_with_errors"].includes(dubbingJob.status)
            ? dubbingJob.id
            : undefined
        }
        dubbingAudioMix={dubAudioMix}
        slowVideoToMatchSpeech={dubbingJob?.config.slowVideoToMatchSpeech === true}
        onClose={() => setExportOpen(false)}
        onNotice={onNotice}
      />
      <ProgressModal
        open={working}
        title={workingTitle}
        message={workingMessage}
        onCancel={() => {
          controllerRef.current?.abort();
          setWorking(false);
        }}
      />
      <ProgressModal
        open={translationWorking}
        title="Đang dịch subtitle"
        message={translationStage}
        value={translationProgress}
        onCancel={() => {
          translationControllerRef.current?.abort();
          clearTranslationProgressTimer();
        }}
      />
    </div>
  );
}
