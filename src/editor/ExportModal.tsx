import { useRef, useState } from "react";
import type {
  BlurRegion,
  LogoOverlay,
  SubtitleCue,
  SubtitleStyle,
  VideoAsset,
  VideoEditState,
} from "../types";
import { Modal } from "../components/Modal";
import { Check, Download } from "../components/Icons";
import {
  cuesToAss,
  cuesForDubbingTimeline,
  cuesToSrt,
  downloadText,
  validateCues,
} from "../lib/subtitles";
import { api, friendlyErrorMessage } from "../lib/api";
import { ProgressModal } from "../components/ProgressModal";

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Keep the object URL alive while Windows/browser still has a Save As
  // dialog open. Immediate revocation can discard a large completed download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const renderedVideoName = () =>
  `autosub-final-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;

export function ExportModal({
  open,
  cues,
  style,
  asset,
  videoEdit = { aspectRatio: "original", trimStartMs: 0 },
  logo,
  fontFile,
  blurRegions = [],
  dubTrack,
  dubbingJobId,
  dubbingAudioMix,
  slowVideoToMatchSpeech = false,
  onClose,
  onNotice,
}: {
  open: boolean;
  cues: SubtitleCue[];
  style: SubtitleStyle;
  asset?: VideoAsset;
  videoEdit?: VideoEditState;
  logo?: LogoOverlay;
  fontFile?: File;
  blurRegions?: BlurRegion[];
  dubTrack?: Blob;
  dubbingJobId?: string;
  dubbingAudioMix?: {
    keepOriginal: boolean;
    originalVolume: number;
    separateVocals?: boolean;
  };
  slowVideoToMatchSpeech?: boolean;
  onClose: () => void;
  onNotice?: (message: string, kind?: "success" | "error") => void;
}) {
  const [format, setFormat] = useState<
    "translated" | "original" | "ass" | "video" | "audio" | "retimed-original-audio"
  >("translated");
  const [working, setWorking] = useState(false);
  const [renderProgress, setRenderProgress] = useState<number | undefined>(0);
  const [renderStage, setRenderStage] = useState("Đang chuẩn bị render");
  const [renderedVideo, setRenderedVideo] = useState<Blob>();
  const hasDub = Boolean(dubTrack || dubbingJobId);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  const validateBeforeAction = () => {
    const validation = validateCues(cues);
    if (!validation.valid)
      onNotice?.(validation.errors[0] || "Subtitle không hợp lệ.", "error");
    return validation.valid;
  };

  const download = async () => {
    if (!validateBeforeAction()) return;
    if (format === "video") return;
    try {
      const timelineCues = cuesForDubbingTimeline(cues, slowVideoToMatchSpeech);
      if (format === "ass") downloadText("autosub-retimed.ass", cuesToAss(timelineCues, style), "text/x-ass");
      else downloadText(`autosub-${format}${slowVideoToMatchSpeech ? '-retimed' : ''}.srt`, cuesToSrt(timelineCues, format === "translated"), "application/x-subrip");
    } catch (error) {
      onNotice?.(friendlyErrorMessage(error, "Không thể lấy timeline dubbing để xuất subtitle."), "error");
    }
  };

  const exportVideo = async () => {
    if (!validateBeforeAction()) return;
    if (!asset?.uploadId && !asset?.file) {
      onNotice?.(
        "Video chưa được lưu trên máy. Hãy chọn lại video và chờ upload hoàn tất.",
        "error",
      );
      return;
    }
    const trimStartMs = Math.max(0, Math.round(videoEdit.trimStartMs || 0));
    const trimEndMs = videoEdit.trimEndMs
      ? Math.round(videoEdit.trimEndMs)
      : undefined;
    if (trimEndMs !== undefined && trimEndMs <= trimStartMs) {
      onNotice?.("Điểm kết thúc phải nằm sau điểm bắt đầu.", "error");
      return;
    }
    const exportCues = cuesForDubbingTimeline(cues, slowVideoToMatchSpeech)
      .filter(
        (cue) =>
          cue.endMs > trimStartMs &&
          (trimEndMs === undefined || cue.startMs < trimEndMs),
      )
      .map((cue) => ({
        ...cue,
        startMs: Math.max(0, cue.startMs - trimStartMs),
        endMs: Math.max(
          1,
          Math.min(cue.endMs, trimEndMs ?? cue.endMs) - trimStartMs,
        ),
      }));
    const exportBlurRegions = blurRegions
      .map((region) => ({
        ...region,
        startMs: Math.max(0, region.startMs - trimStartMs),
        endMs: Math.max(
          0,
          Math.min(region.endMs, trimEndMs ?? region.endMs) - trimStartMs,
        ),
      }))
      .filter((region) => region.endMs > region.startMs);

    const controller = new AbortController();
    const exportId = `export-${Date.now()}-${crypto.randomUUID()}`;
    controllerRef.current = controller;
    setWorking(true);
    setRenderProgress(1);
    setRenderStage("Đang tải video lên máy");
    const poll = window.setInterval(() => {
      void api
        .getExportProgress(exportId, controller.signal)
        .then((status) => {
          setRenderProgress(status.percent);
          setRenderStage(status.stage);
        })
        .catch(() => undefined);
    }, 500);
    try {
      const blob = await api.exportVideo(
        asset?.file,
        exportCues,
        style,
        {
          exportId,
          uploadId: asset?.uploadId,
          resolution: "original",
          crf: 20,
          // A dub track is already the selected audio mix. Re-adding the
          // source video's audio here would bring the original dialogue back
          // and create the same two-speaker echo as the old preview.
          keepAudio: hasDub ? false : true,
          originalVolume: dubbingAudioMix?.originalVolume ?? 0.25,
          burnSubtitles: Boolean(style.visible),
          separateVocals: false,
          blurRegions: exportBlurRegions,
          videoEdit,
          logo,
          dubTrack: hasDub ? dubTrack : undefined,
          dubbingJobId: hasDub ? dubbingJobId : undefined,
          fontFile,
        },
        controller.signal,
      );
      setRenderedVideo(blob);
      saveBlob(renderedVideoName(), blob);
      setRenderProgress(100);
      onNotice?.("Đã render xong. Nếu Windows từ chối ghi file, hãy chọn Tải lại video đã render.", "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        onNotice?.("Đã hủy render video.", "success");
      else
        onNotice?.(
          friendlyErrorMessage(error, "Video export thất bại."),
          "error",
        );
    } finally {
      window.clearInterval(poll);
      controllerRef.current = undefined;
      setWorking(false);
    }
  };

  const exportAudio = async () => {
    const exportingRetimedOriginal = format === "retimed-original-audio";
    const trimStartMs = Math.max(0, Math.round(videoEdit.trimStartMs || 0));
    const trimEndMs = videoEdit.trimEndMs
      ? Math.round(videoEdit.trimEndMs)
      : undefined;
    if (trimEndMs !== undefined && trimEndMs <= trimStartMs) {
      onNotice?.("Điểm kết thúc phải nằm sau điểm bắt đầu.", "error");
      return;
    }
    if (!exportingRetimedOriginal && !dubbingJobId && dubTrack?.size) {
      if (trimStartMs > 0 || trimEndMs !== undefined) {
        onNotice?.(
          "Bản dub cũ không hỗ trợ cắt trực tiếp. Hãy tạo dub job mới hoặc bỏ phạm vi cắt.",
          "error",
        );
        return;
      }
      saveBlob("autosub-current-audio.wav", dubTrack);
      onNotice?.("Đã tải audio lồng tiếng hiện tại.", "success");
      onClose();
      return;
    }
    if ((!dubbingJobId || exportingRetimedOriginal) && !asset?.uploadId) {
      onNotice?.(
        "Video chưa được lưu trên máy. Hãy chọn lại video và chờ upload hoàn tất.",
        "error",
      );
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setRenderProgress(undefined);
    setRenderStage(
      dubbingJobId
        ? exportingRetimedOriginal ? "Đang kéo giãn audio gốc theo video" : "Đang chuẩn bị audio lồng tiếng hiện tại"
        : "Đang tách audio từ video hiện tại",
    );
    try {
      const blob = await api.exportAudio(
        {
          uploadId: asset?.uploadId,
          dubbingJobId,
          trimStartMs,
          trimEndMs,
          audioSource: exportingRetimedOriginal ? "original-retimed" : dubbingJobId ? "dub" : "original",
        },
        controller.signal,
      );
      saveBlob(exportingRetimedOriginal ? "autosub-original-retimed.wav" : "autosub-current-audio.wav", blob);
      onNotice?.(
        exportingRetimedOriginal
          ? "Đã xuất audio gốc khớp timeline video chậm."
          : dubbingJobId
          ? "Đã tải audio lồng tiếng hiện tại."
          : "Đã tách và tải audio của video hiện tại.",
        "success",
      );
      onClose();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        onNotice?.("Đã hủy xuất audio.", "success");
      else
        onNotice?.(
          friendlyErrorMessage(error, "Xuất audio thất bại."),
          "error",
        );
    } finally {
      controllerRef.current = undefined;
      setWorking(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        title="Xuất file"
        eyebrow="FINAL OUTPUT"
        onClose={onClose}
      >
        <div className="export-list">
          <button
            className={format === "translated" ? "selected" : ""}
            onClick={() => setFormat("translated")}
          >
            <span>
              <Check size={14} /> SRT bản dịch
            </span>
            <small>.srt</small>
          </button>
          <button
            className={format === "original" ? "selected" : ""}
            onClick={() => setFormat("original")}
          >
            <span>
              <Check size={14} /> SRT bản gốc
            </span>
            <small>.srt</small>
          </button>
          <button
            className={format === "ass" ? "selected" : ""}
            onClick={() => setFormat("ass")}
          >
            <span>
              <Check size={14} /> ASS styled
            </span>
            <small>.ass</small>
          </button>
          {asset && (
            <button
              className={format === "video" ? "selected" : ""}
              onClick={() => setFormat("video")}
            >
              <span>
                <Check size={14} /> Video hiện tại
              </span>
              <small>.mp4</small>
            </button>
          )}
          {(asset || hasDub) && (
            <button
              className={format === "audio" ? "selected" : ""}
              onClick={() => setFormat("audio")}
            >
              <span>
                <Check size={14} /> Audio hiện tại
              </span>
              <small>.wav</small>
            </button>
          )}
          {asset && dubbingJobId && slowVideoToMatchSpeech && (
            <button
              className={format === "retimed-original-audio" ? "selected" : ""}
              onClick={() => setFormat("retimed-original-audio")}
            >
              <span><Check size={14} /> Audio gốc đã khớp video chậm</span>
              <small>.wav</small>
            </button>
          )}
        </div>
        <div className="modal-actions">
          <button className="button ghost" onClick={onClose}>
            Hủy
          </button>
          {format === "video" && renderedVideo && (
            <button className="button ghost" onClick={() => void exportVideo()}>
              Render lại
            </button>
          )}
          <button
            className="button primary"
            disabled={working}
            onClick={() => {
              if (format === "video" && renderedVideo) saveBlob(renderedVideoName(), renderedVideo);
              else if (format === "video") void exportVideo();
              else if (format === "audio" || format === "retimed-original-audio") void exportAudio();
              else void download();
            }}
          >
            <Download size={15} />{" "}
            {working
              ? format === "audio" || format === "retimed-original-audio"
                ? "Đang xuất audio…"
                : "Đang render…"
              : format === "video"
                ? renderedVideo ? "Tải lại video đã render" : "Bắt đầu xuất"
                : "Tải xuống"}
          </button>
        </div>
      </Modal>
      <ProgressModal
        open={working}
        title={format === "audio" || format === "retimed-original-audio" ? "Đang xuất audio" : "Đang render video"}
        message={renderStage}
        value={renderProgress}
        onCancel={() => {
          controllerRef.current?.abort();
          setWorking(false);
        }}
      />
    </>
  );
}
