import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AIProvider,
  AppSettings,
  BlurRegion,
  DubbingJobStatus,
  DubbingMetadata,
  LogoOverlay,
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
  friendlyErrorMessage,
  MAX_BROWSER_UPLOAD_BYTES,
} from "../lib/api";
import { storage } from "../lib/storage";
import {
  AudioLines,
  Captions,
  ChevronDown,
  Download,
  FileVideo,
  Image as ImageIcon,
  Languages,
  Plus,
  Scissors,
  Settings2,
  Upload,
} from "../components/Icons";
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
  cuesToSrt,
  downloadText,
  parseSubtitle,
  validateCues,
} from "../lib/subtitles";
import {
  capabilityAssignments,
  updateCapabilityAssignments,
} from "../lib/settings";
import { LogoModal } from "../editor/LogoModal";
import { LatestUploadGuard } from "../lib/latestUpload";
import {
  announceDropdownOpen,
  listenForOtherDropdowns,
  type DropdownId,
} from "../lib/dropdowns";
import { videoAssetUploadFile } from "../lib/videoAsset";
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

function cps(text: string, durationMs: number) {
  return text.replace(/\s/g, "").length / Math.max(durationMs / 1000, 0.001);
}

function applyDubbingMetadata(
  cues: SubtitleCue[],
  metadata: DubbingMetadata[],
) {
  const metadataById = new Map(metadata.map((item) => [item.cueId, item]));
  return cues.map((cue) => {
    const item = metadataById.get(cue.id);
    if (!item) return cue;
    const timelineStartMs = Number.isFinite(item.timelineStartMs)
      ? item.timelineStartMs
      : cue.startMs;
    const timelineEndMs = Number.isFinite(item.timelineEndMs)
      ? item.timelineEndMs
      : cue.endMs;
    return {
      ...cue,
      startMs: timelineStartMs as number,
      endMs: Math.max((timelineStartMs as number) + 1, timelineEndMs as number),
      // Dubbing metadata must never overwrite the user's subtitle wording.
      // The spoken result is tracked separately on the cue for preview/export.
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
  const [selectedId, setSelectedId] = useState(cues[0]?.id);
  const currentTimeRef = useRef(0);
  const [activeCueId, setActiveCueId] = useState<string>();
  const [seekRequest, setSeekRequest] = useState<{
    id: number;
    timeMs: number;
  }>();
  const [panel, setPanel] = useState<"style" | "none">("none");
  const [blurOpen, setBlurOpen] = useState(false);
  const [blurEditMode, setBlurEditMode] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const [dubbingOpen, setDubbingOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>([]);
  const [logo, setLogo] = useState<LogoOverlay>();
  const [logoPreview, setLogoPreview] = useState<LogoOverlay>();
  const [pronunciation, setPronunciation] = useState<PronunciationEntry[]>(
    storage.pronunciation,
  );
  const [fontFile, setFontFile] = useState<File>();
  const [dubTrack, setDubTrack] = useState<Blob>();
  const [dubAudioUrl, setDubAudioUrl] = useState<string>();
  const [dubAudioMix, setDubAudioMix] = useState<{
    keepOriginal: boolean;
    originalVolume: number;
    separateVocals?: boolean;
  }>();
  const [dubbingJob, setDubbingJob] = useState<DubbingJobStatus>();
  const [regeneratingCueId, setRegeneratingCueId] = useState<string>();
  const [videoEdit, setVideoEdit] = useState<VideoEditState>(() =>
    storage.videoEdit(asset?.uploadId),
  );
  const dubbingTerminalNoticeRef = useRef("");
  const [working, setWorking] = useState(false);
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
      style: "Phổ thông",
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
  const selected = cues.find((cue) => cue.id === selectedId);
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
  }, [asset?.uploadId]);
  useEffect(() => {
    if (asset?.uploadId) storage.saveVideoEdit(asset.uploadId, videoEdit);
  }, [asset?.uploadId, videoEdit]);
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
            dubbingTerminalNoticeRef.current = `${next.id}:${next.status}`;
            setDubbingJob(next);
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
    if (!dubbingJob || dubbingJob.status !== "completed" || dubAudioUrl) return;
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
    action: "pause" | "resume" | "cancel" | "retry-failed",
  ) => {
    if (!dubbingJob) return;
    try {
      const next =
        action === "pause"
          ? await api.pauseDubbingJob(dubbingJob.id)
          : action === "resume"
            ? await api.resumeDubbingJob(dubbingJob.id)
            : action === "cancel"
              ? await api.cancelDubbingJob(dubbingJob.id)
              : await api.retryFailedDubbingJob(dubbingJob.id);
      setDubbingJob(next);
      if (action === "cancel" && asset?.uploadId)
        storage.removeDubbingJob(asset.uploadId, dubbingJob.id);
      if (action === "retry-failed") dubbingTerminalNoticeRef.current = "";
    } catch (error) {
      onNotice(
        friendlyErrorMessage(error, "Không thể điều khiển dubbing job."),
        "error",
      );
    }
  };

  const regenerateCueVoice = useCallback(
    async (cue: SubtitleCue) => {
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
        currentTimeRef.current = cue.startMs;
        setSeekRequest({ id: ++seekRequestIdRef.current, timeMs: cue.startMs });
      }
    },
    [cues],
  );
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
      const batchSize = setup.mode === "quality" ? 8 : 16;
      const totalBatches = Math.ceil(cues.length / batchSize);
      for (let start = 0; start < cues.length; start += batchSize) {
        const batch = cues.slice(start, start + batchSize);
        const batchNumber = Math.floor(start / batchSize) + 1;
        const target = Math.min(
          94,
          Math.max(8, ((start + batch.length * 0.88) / cues.length) * 100),
        );
        setTranslationStage(
          `Đang gửi batch ${batchNumber}/${totalBatches} · cue ${start + 1}–${start + batch.length}`,
        );
        easeTranslationProgressTo(target);
        const result = await api.translate(
          provider,
          setup.model,
          batch,
          setup.sourceLanguage,
          setup.targetLanguage,
          setup.style,
          setup.customPrompt,
          setup.glossary.filter((entry) => entry.enabled),
          controller.signal,
        );
        clearTranslationProgressTimer();
        for (const item of result.items) {
          const cue = next.find((candidate) => candidate.id === item.id);
          if (cue) cue.translatedText = item.translation;
        }
        const completed = Math.min(
          98,
          ((start + batch.length) / cues.length) * 100,
        );
        setTranslationProgress(completed);
        setTranslationStage(
          `Đã nhận batch ${batchNumber}/${totalBatches} · đang lưu kết quả`,
        );
        onCuesChange([...next]);
      }
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
    const dubbingCues = cues.filter(
      (cue) => cue.enabled && (cue.translatedText || cue.originalText),
    );
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
    const dubbingCues = cues.filter(
      (cue) => cue.enabled && (cue.translatedText || cue.originalText),
    );
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
        speed: config?.speed ?? 1,
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
          timingMode: "natural",
          batchSize: 30,
          ttsConcurrency: 3,
          llmConcurrency: 2,
          maxRetries: 3,
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

  const styleChange = (patch: Partial<SubtitleStyle>) =>
    onSettingsChange({
      ...settings,
      subtitleStyle: { ...settings.subtitleStyle, ...patch },
    });
  const downloadSubtitle = (format: "translated" | "original" | "ass") => {
    const validation = validateCues(cues);
    if (!validation.valid) {
      onNotice(validation.errors[0] || "Subtitle không hợp lệ.", "error");
      return;
    }
    if (format === "ass")
      downloadText(
        "autosub.ass",
        cuesToAss(cues, settings.subtitleStyle),
        "text/x-ass",
      );
    else
      downloadText(
        `autosub-${format}.srt`,
        cuesToSrt(cues, format === "translated"),
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
  const previewLogoChange = (patch: Partial<LogoOverlay>) =>
    setLogoPreview((current) => (current ? { ...current, ...patch } : current));
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
            setPanel(panel === "style" ? "none" : "style");
          }}
        >
          <Captions size={15} /> Phụ đề
        </button>
        <button onClick={() => setDubbingOpen(true)}>
          <AudioLines size={15} /> Lồng tiếng
        </button>
        <button className="toolbar-export" onClick={() => setExportOpen(true)}>
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
          <Scissors size={14} /> Kéo trực tiếp các vùng blur trên video. Bấm Làm
          mờ lần nữa để mở bảng điều khiển.
        </div>
      )}
      <section className="editor-main">
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
            seekRequest={seekRequest}
            onTime={reportEditorTime}
            onActiveCueChange={setActiveCueId}
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
        <div className="editor-right">
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
              <span>SUBTITLE LIST</span>
              <b>{cues.length}</b>
            </div>
            <button
              className="icon-button"
              onClick={addCue}
              aria-label="Thêm cue"
            >
              <Plus size={16} />
            </button>
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
          />
        </div>
        {panel === "style" && (
          <aside className="floating-panel style-floating-panel">
            <div className="floating-head">
              <span>
                <Settings2 size={15} /> SUBTITLE STYLE
              </span>
              <button className="icon-button" onClick={() => setPanel("none")}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <SubtitleStylePanel
              style={settings.subtitleStyle}
              onChange={styleChange}
              onFontUpload={setFontFile}
            />
            <div className="style-preview">
              <span>PREVIEW</span>
              <div className="style-preview-surface">
                <span
                  className="style-preview-text"
                  style={{
                    color: settings.subtitleStyle.textColor,
                    fontFamily: settings.subtitleStyle.fontFamily,
                    fontSize: `${Math.max(settings.subtitleStyle.fontSize * 0.45, 12)}px`,
                    fontWeight: settings.subtitleStyle.bold ? 700 : 400,
                    fontStyle: settings.subtitleStyle.italic
                      ? "italic"
                      : "normal",
                    WebkitTextFillColor: settings.subtitleStyle.textColor,
                    WebkitTextStroke:
                      settings.subtitleStyle.background === "outline"
                        ? `${(settings.subtitleStyle.outlineWidth ?? 2) * (Math.max(settings.subtitleStyle.fontSize * 0.45, 12) / Math.max(settings.subtitleStyle.fontSize, 1))}px ${settings.subtitleStyle.outlineColor}`
                        : "0 transparent",
                    paintOrder: "stroke fill",
                    background:
                      settings.subtitleStyle.background === "box"
                        ? `${settings.subtitleStyle.backgroundColor ?? settings.subtitleStyle.outlineColor}${Math.round(
                            (settings.subtitleStyle.backgroundOpacity ?? 0.72) *
                              255,
                          )
                            .toString(16)
                            .padStart(2, "0")}`
                        : "transparent",
                  }}
                >
                  {selected?.translatedText ||
                    selected?.originalText ||
                    "Bản dịch preview"}
                </span>
              </div>
            </div>
          </aside>
        )}
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
        logo={logo}
        externalPosition={logoPreview}
        onClose={() => setLogoOpen(false)}
        onPreviewChange={setLogoPreview}
        onChange={(next) => {
          if (
            logo?.url &&
            logo.url !== next.url &&
            logo.url.startsWith("blob:")
          )
            URL.revokeObjectURL(logo.url);
          setLogo(next);
          setLogoPreview(next);
          onNotice("Đã cập nhật logo/watermark.", "success");
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
        fontFile={fontFile}
        blurRegions={blurRegions}
        dubTrack={dubTrack}
        dubbingJobId={
          dubbingJob?.status === "completed" ? dubbingJob.id : undefined
        }
        dubbingAudioMix={dubbingJob?.config.audioMix}
        onClose={() => setExportOpen(false)}
        onNotice={onNotice}
      />
      <ProgressModal
        open={working}
        title="Đang xử lý audio"
        message="Provider → FFprobe → atempo → dub-track.wav"
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
