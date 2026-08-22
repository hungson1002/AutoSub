import { type FormEvent, useEffect, useRef, useState } from "react";
import type { VideoAsset, DouyinBatchItem, DouyinBatchJob, BilibiliQuality } from "../types";
import { api, friendlyErrorMessage } from "../lib/api";
import { SelectField } from "../components/SelectField";
import {
  ArrowDownToLine,
  AudioLines,
  Check,
  CirclePlay,
  CircleX,
  Clapperboard,
  Download,
  FileVideo,
  Film,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "../components/Icons";

const VIDEO_SOURCE_URL_PATTERN =
  /https?:\/\/(?:v\.douyin\.com\/[A-Za-z0-9_-]+\/?|(?:www\.|ies\.|m\.)?douyin\.com\/(?:video|note|share\/video)\/\d+|(?:www\.)?b23\.tv\/[A-Za-z0-9_-]+\/?|(?:(?:www|m)\.)?bilibili\.com\/video\/(?:BV[0-9A-Za-z]+|av\d+))[^\s]*/gi;

const itemStatusLabel: Record<DouyinBatchItem["status"], string> = {
  pending: "Đang chờ",
  resolving: "Đang xác thực",
  downloading: "Đang tải",
  completed: "Hoàn tất",
  failed: "Có lỗi",
  cancelled: "Đã hủy",
};

const batchStatusCopy: Record<DouyinBatchJob["status"], string> = {
  queued: "Đang chuẩn bị hàng đợi",
  running: "Đang lấy và kiểm tra video",
  completed: "Đã tải xong toàn bộ video",
  completed_with_errors: "Đã hoàn tất, một số link có lỗi",
  cancelled: "Hàng đợi đã được hủy",
  failed: "Không tải được video nào",
};

function formatDuration(seconds?: number) {
  if (seconds === undefined) return undefined;
  const safeSeconds = Math.max(0, Math.round(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function formatBytes(bytes?: number) {
  if (!bytes) return undefined;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function DouyinPage({
  onAssetChange,
  onOpenExtract,
  onOpenReview,
  onOpenEditor,
  onNotice,
}: {
  onAssetChange: (asset?: VideoAsset) => void;
  onOpenExtract: (asset: VideoAsset) => void;
  onOpenReview: (asset: VideoAsset) => void;
  onOpenEditor: (asset: VideoAsset) => void;
  onNotice: (message: string, kind?: "success" | "error") => void;
}) {
  const [inputText, setInputText] = useState("");
  const [detectedUrls, setDetectedUrls] = useState<string[]>([]);
  const [batchJob, setBatchJob] = useState<DouyinBatchJob>();
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [bilibiliQuality, setBilibiliQuality] = useState<BilibiliQuality>(64);
  const [submitError, setSubmitError] = useState("");
  const [pollError, setPollError] = useState("");
  const [historyItems, setHistoryItems] = useState<DouyinBatchItem[]>(() => {
    try {
      const saved = localStorage.getItem("autosub.douyin-history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const pollTimerRef = useRef<number | undefined>(undefined);
  const isPollingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const matches = inputText.match(VIDEO_SOURCE_URL_PATTERN) || [];
    const cleaned = Array.from(
      new Set(matches.map((url) => url.replace(/[),;。，！？\s]+$/, ""))),
    );
    setDetectedUrls(cleaned);
    if (cleaned.length > 0) setSubmitError("");
  }, [inputText]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "autosub.douyin-history",
        JSON.stringify(historyItems.slice(0, 50)),
      );
    } catch {
      // History is a convenience only. Downloading still works if storage is unavailable.
    }
  }, [historyItems]);

  useEffect(
    () => () => {
      if (pollTimerRef.current !== undefined)
        window.clearTimeout(pollTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!activeBatchId) return;

    let cancelled = false;
    const poll = async () => {
      if (cancelled || isPollingRef.current) return;
      isPollingRef.current = true;
      try {
        const job = await api.getDouyinBatchStatus(activeBatchId);
        if (cancelled) return;
        setPollError("");
        setBatchJob(job);
        setHistoryItems((previous) => {
          const merged = [...previous];
          for (const item of job.items.filter(
            (entry) => entry.status === "completed",
          )) {
            const index = merged.findIndex(
              (entry) =>
                entry.id === item.id ||
                (entry.uploadId && entry.uploadId === item.uploadId),
            );
            if (index >= 0) merged[index] = item;
            else merged.unshift(item);
          }
          return merged;
        });

        if (job.status === "running" || job.status === "queued") {
          pollTimerRef.current = window.setTimeout(poll, 700);
          return;
        }

        setActiveBatchId(undefined);
        if (job.status === "completed") {
          onNotice(
            `Đã tải thành công ${job.completedItems} video.`,
            "success",
          );
        } else if (job.status === "completed_with_errors") {
          onNotice(
            `Đã tải ${job.completedItems}/${job.totalItems} video. ${job.failedItems} link có lỗi.`,
            "error",
          );
        } else if (job.status === "failed") {
          onNotice(
            "Không tải được video. Xem lỗi trong từng mục để thử lại.",
            "error",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setPollError(
            friendlyErrorMessage(
              error,
              "Mất kết nối với hàng đợi tải. AutoSub sẽ thử lại.",
            ),
          );
          pollTimerRef.current = window.setTimeout(poll, 1500);
        }
      } finally {
        isPollingRef.current = false;
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (pollTimerRef.current !== undefined) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = undefined;
      }
    };
  }, [activeBatchId, onNotice]);

  const handleStartBatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (detectedUrls.length === 0) {
      setSubmitError("Chưa tìm thấy link Douyin hoặc Bilibili hợp lệ trong nội dung đã dán.");
      inputRef.current?.focus();
      return;
    }

    setSubmitError("");
    setSubmitting(true);
    try {
      const job = await api.startDouyinBatch(detectedUrls, bilibiliQuality);
      setBatchJob(job);
      setActiveBatchId(job.id);
      setInputText("");
      onNotice(`Đã đưa ${job.totalItems} video vào hàng đợi.`, "success");
    } catch (error) {
      const message = friendlyErrorMessage(
        error,
        "Không thể bắt đầu tải video.",
      );
      setSubmitError(message);
      onNotice(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelBatch = async () => {
    if (!batchJob?.id) return;
    try {
      await api.cancelDouyinBatch(batchJob.id);
      setActiveBatchId(undefined);
      setBatchJob((previous) =>
        previous ? { ...previous, status: "cancelled" } : undefined,
      );
      onNotice("Đã hủy hàng đợi tải.", "success");
    } catch (error) {
      onNotice(friendlyErrorMessage(error, "Không thể hủy hàng đợi."), "error");
    }
  };

  const makeAssetFromItem = (item: DouyinBatchItem): VideoAsset => ({
    name: item.filename || `${item.title || "source_video"}.mp4`,
    url: `http://127.0.0.1:8787/api/uploads/${item.uploadId}/media`,
    type: "video/mp4",
    uploadId: item.uploadId,
    storedPath: item.storedPath,
    size: item.fileSize,
    durationMs: item.duration ? item.duration * 1000 : undefined,
    sourceMode: "copied",
  });

  const openAsset = (
    item: DouyinBatchItem,
    destination: "extract" | "review" | "editor",
  ) => {
    if (!item.uploadId) return;
    const asset = makeAssetFromItem(item);
    onAssetChange(asset);
    if (destination === "extract") onOpenExtract(asset);
    if (destination === "review") onOpenReview(asset);
    if (destination === "editor") onOpenEditor(asset);
  };

  const handleDownloadFile = (item: DouyinBatchItem) => {
    if (!item.uploadId) return;
    const anchor = document.createElement("a");
    anchor.href = `http://127.0.0.1:8787/api/uploads/${item.uploadId}/media?download=1`;
    anchor.download = item.filename || `${item.title || item.platform || "video"}.mp4`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const thumbnailDownloadUrl = (item: DouyinBatchItem) =>
    `http://127.0.0.1:8787/api/douyin/thumbnail?url=${encodeURIComponent(item.coverUrl || "")}&filename=${encodeURIComponent(`${item.title || item.platform || "video"}_thumbnail`)}`;

  const handleRetryItem = (item: DouyinBatchItem) => {
    setBatchJob(undefined);
    setInputText(item.originalUrl);
    setSubmitError("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const isDownloading = activeBatchId !== undefined;
  const canCloseBatch = Boolean(batchJob && !isDownloading);
  const displayItems = batchJob ? batchJob.items : historyItems;
  const processedItems = batchJob
    ? batchJob.completedItems + batchJob.failedItems
    : 0;
  const batchProgress = batchJob
    ? batchJob.status !== "queued" && batchJob.status !== "running"
      ? 100
      : Math.round(
          batchJob.items.reduce(
            (total, item) => total + item.progressPercent,
            0,
          ) / Math.max(1, batchJob.totalItems),
        )
    : 0;

  return (
    <main className="page douyin-page">
      <header className="douyin-hero">
        <div className="douyin-hero-copy">
          <span className="eyebrow">DOUYIN + BILIBILI INGEST</span>
          <h1>
            Thu video Douyin &amp; Bilibili. <span>Sẵn sàng để dựng.</span>
          </h1>
          <p>
            Dán link chia sẻ Douyin hoặc Bilibili, AutoSub lấy bản MP4 công khai và đưa thẳng
            vào quy trình hậu kỳ.
          </p>
        </div>
        <div className="douyin-trust" aria-label="Thông tin xử lý">
          <ShieldCheck size={19} aria-hidden="true" />
          <div>
            <strong>Kiểm tra file trước khi lưu</strong>
            <span>Không còn báo hoàn tất với file rỗng hoặc sai định dạng</span>
          </div>
        </div>
      </header>

      <div className="douyin-workspace">
        <form
          className="douyin-panel douyin-ingest"
          onSubmit={handleStartBatch}
          noValidate
        >
          <div className="douyin-panel-head">
            <div>
              <span className="douyin-step">01</span>
              <div>
                <h2>Thêm link</h2>
                <p>Mỗi dòng một link, hoặc dán nguyên nội dung chia sẻ.</p>
              </div>
            </div>
            <span
              className={`douyin-detection${detectedUrls.length ? " is-ready" : ""}`}
            >
              {detectedUrls.length ? (
                <Check size={13} aria-hidden="true" />
              ) : (
                <RefreshCw size={13} aria-hidden="true" />
              )}
              {detectedUrls.length
                ? `${detectedUrls.length} link hợp lệ`
                : "Chờ nội dung"}
            </span>
          </div>

          <label className="douyin-input-label" htmlFor="douyin-links">
            Link hoặc nội dung chia sẻ
          </label>
          <div className="douyin-input-shell">
            <textarea
              id="douyin-links"
              ref={inputRef}
              rows={9}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder={
                "https://v.douyin.com/xxxxxx/\nhttps://www.bilibili.com/video/BVxxxxxx\n\nBạn cũng có thể dán nguyên nội dung chia sẻ."
              }
              aria-describedby="douyin-link-help douyin-input-error"
              aria-invalid={Boolean(submitError)}
              disabled={isDownloading || submitting}
            />
            {inputText && !isDownloading && !submitting && (
              <button
                className="douyin-input-clear"
                type="button"
                onClick={() => {
                  setInputText("");
                  setSubmitError("");
                }}
                aria-label="Xóa nội dung đã dán"
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <p id="douyin-link-help" className="douyin-field-help">
            Hỗ trợ video công khai từ douyin.com, bilibili.com và link rút gọn b23.tv.
          </p>

          <div className="field douyin-quality-field">
            <span>Chất lượng Bilibili</span>
            <SelectField
              ariaLabel="Chất lượng tải Bilibili"
              value={String(bilibiliQuality)}
              onChange={(value) => setBilibiliQuality(Number(value) as BilibiliQuality)}
              disabled={isDownloading || submitting}
              options={[
                { value: "64", label: "720p — chất lượng tốt", description: "Tải song song tối đa 8 kết nối" },
                { value: "16", label: "360p — siêu tốc", description: "File nhỏ hơn, phù hợp video dài" },
              ]}
            />
            <small className="douyin-field-help">AutoSub lấy luồng MP4 trực tiếp và không chèn logo. Logo hoặc watermark đã nằm sẵn trong video của tác giả vẫn được giữ nguyên.</small>
          </div>

          {detectedUrls.length > 0 && (
            <div
              className="douyin-link-preview"
              aria-label="Các link đã nhận diện"
            >
              {detectedUrls.slice(0, 4).map((url, index) => (
                <span key={url}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {url}
                </span>
              ))}
              {detectedUrls.length > 4 && (
                <small>Thêm {detectedUrls.length - 4} link khác</small>
              )}
            </div>
          )}

          {submitError && (
            <div
              id="douyin-input-error"
              className="douyin-inline-alert is-error"
              role="alert"
            >
              <CircleX size={15} />
              {submitError}
            </div>
          )}

          <div className="douyin-submit-row">
            {isDownloading ? (
              <button
                className="button douyin-cancel-button"
                type="button"
                onClick={handleCancelBatch}
              >
                <CircleX size={16} /> Hủy hàng đợi
              </button>
            ) : (
              <button
                className="button primary douyin-submit-button"
                type="submit"
                disabled={submitting}
              >
                {submitting ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <ArrowDownToLine size={17} />
                )}
                {submitting
                  ? "Đang tạo hàng đợi"
                  : `Tải ${detectedUrls.length ? `${detectedUrls.length} video` : "video Douyin/Bilibili"}`}
              </button>
            )}
          </div>

          <div className="douyin-capabilities">
            <div>
              <Zap size={16} />
              <span>
                <strong>Tự động</strong>
                <small>Lấy bản MP4 tốt nhất</small>
              </span>
            </div>
            <div>
              <ShieldCheck size={16} />
              <span>
                <strong>An toàn</strong>
                <small>Xác minh dung lượng và định dạng</small>
              </span>
            </div>
            <div>
              <Sparkles size={16} />
              <span>
                <strong>Liền mạch</strong>
                <small>Mở ngay trong AutoSub</small>
              </span>
            </div>
          </div>
        </form>

        <section
          className="douyin-panel douyin-queue"
          aria-labelledby="douyin-queue-title"
        >
          <div className="douyin-panel-head">
            <div>
              <span className="douyin-step">02</span>
              <div>
                <h2 id="douyin-queue-title">
                  {batchJob ? "Hàng đợi tải" : "Video gần đây"}
                </h2>
                <p>
                  {batchJob
                    ? `${batchJob.totalItems} mục trong phiên này`
                    : `${historyItems.length} video đã lưu cục bộ`}
                </p>
              </div>
            </div>
            <div className="douyin-queue-tools">
              {canCloseBatch && (
                <button
                  className="button small ghost"
                  type="button"
                  onClick={() => setBatchJob(undefined)}
                >
                  Xem lịch sử
                </button>
              )}
              {!batchJob && historyItems.length > 0 && (
                <button
                  className="button small ghost"
                  type="button"
                  onClick={() => {
                    setHistoryItems([]);
                    onNotice("Đã xóa danh sách video gần đây.", "success");
                  }}
                >
                  <Trash2 size={13} /> Xóa danh sách
                </button>
              )}
            </div>
          </div>

          {pollError && (
            <div className="douyin-inline-alert is-warning" role="alert">
              <RefreshCw size={15} />
              {pollError}
            </div>
          )}

          {batchJob && (
            <div
              className={`douyin-batch-summary status-${batchJob.status}`}
              aria-live="polite"
            >
              <div className="douyin-batch-copy">
                <span className="douyin-batch-icon">
                  {isDownloading ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : batchJob.status === "completed" ? (
                    <Check size={17} />
                  ) : (
                    <CircleX size={17} />
                  )}
                </span>
                <div>
                  <strong>{batchStatusCopy[batchJob.status]}</strong>
                  <small>
                    {processedItems}/{batchJob.totalItems} mục đã xử lý
                  </small>
                </div>
              </div>
              <span className="douyin-batch-percent">{batchProgress}%</span>
              <div
                className="douyin-progress"
                role="progressbar"
                aria-label="Tiến trình hàng đợi"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={batchProgress}
              >
                <span style={{ width: `${batchProgress}%` }} />
              </div>
            </div>
          )}

          {displayItems.length === 0 ? (
            <div className="douyin-empty">
              <span>
                <FileVideo size={25} />
              </span>
              <h3>Hàng đợi đang trống</h3>
              <p>Dán link ở bảng bên trái để tải video đầu tiên.</p>
            </div>
          ) : (
            <div className="douyin-items">
              {displayItems.map((item) => {
                const isWorking =
                  item.status === "resolving" || item.status === "downloading";
                return (
                  <article
                    className={`douyin-item status-${item.status}`}
                    key={item.id}
                  >
                    <div className="douyin-thumb">
                      {item.coverUrl ? (
                        <img src={item.coverUrl} alt="" loading="lazy" />
                      ) : (
                        <Film size={25} aria-hidden="true" />
                      )}
                      {item.duration !== undefined && (
                        <span>{formatDuration(item.duration)}</span>
                      )}
                    </div>
                    <div className="douyin-item-main">
                      <div className="douyin-item-title-row">
                        <h3 title={item.title || item.originalUrl}>
                          {item.title || item.originalUrl}
                        </h3>
                        <span className="douyin-status">
                          <i />
                          {itemStatusLabel[item.status]}
                          {item.status === "downloading"
                            ? ` ${item.progressPercent}%`
                            : ""}
                        </span>
                      </div>
                      <div className="douyin-item-meta">
                        {item.author && <span>{item.author}</span>}
                        {item.platform && <span>{item.platform === "bilibili" ? "Bilibili" : "Douyin"}</span>}
                        {formatBytes(item.fileSize) && (
                          <span>{formatBytes(item.fileSize)}</span>
                        )}
                        {item.videoId && <span>ID {item.videoId}</span>}
                      </div>

                      {isWorking && (
                        <div
                          className="douyin-item-progress"
                          role="progressbar"
                          aria-label={`Tiến trình ${item.title || "video"}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={item.progressPercent}
                        >
                          <span style={{ width: `${item.progressPercent}%` }} />
                        </div>
                      )}
                      {item.error && (
                        <div className="douyin-item-error" role="alert">
                          <CircleX size={14} />
                          {item.error}
                        </div>
                      )}

                      {item.status === "failed" && !isDownloading && (
                        <div className="douyin-item-actions">
                          <button
                            className="button small ghost"
                            type="button"
                            onClick={() => handleRetryItem(item)}
                          >
                            <RefreshCw size={13} /> Thử lại link này
                          </button>
                        </div>
                      )}

                      {item.status === "completed" && item.uploadId && (
                        <div className="douyin-item-actions">
                          <button
                            className="button small primary"
                            type="button"
                            onClick={() => openAsset(item, "extract")}
                          >
                            <Clapperboard size={13} /> Trích xuất phụ đề
                          </button>
                          <button
                            className="button small secondary"
                            type="button"
                            onClick={() => openAsset(item, "review")}
                          >
                            <CirclePlay size={13} /> Review AI
                          </button>
                          <button
                            className="button small secondary"
                            type="button"
                            onClick={() => openAsset(item, "editor")}
                          >
                            <AudioLines size={13} /> Lồng tiếng
                          </button>
                          <button
                            className="button small ghost"
                            type="button"
                            onClick={() => handleDownloadFile(item)}
                          >
                            <Download size={13} /> Lưu MP4
                          </button>
                          {item.coverUrl && (
                            <a
                              className="button small ghost"
                              href={thumbnailDownloadUrl(item)}
                            >
                              <Download size={13} /> Tải thumbnail
                            </a>
                          )}
                          {!batchJob && (
                            <button
                              className="douyin-delete-item"
                              type="button"
                              onClick={() =>
                                setHistoryItems((items) =>
                                  items.filter((entry) => entry.id !== item.id),
                                )
                              }
                              aria-label={`Xóa ${item.title || "video"} khỏi danh sách`}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
