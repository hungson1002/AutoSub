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

const thumbnailProxyUrl = (item: DouyinBatchItem, download = false) => {
  const query = new URLSearchParams({ url: item.coverUrl || "" });
  if (download) {
    query.set("filename", `${item.title || item.platform || "video"}_thumbnail`);
    query.set("download", "1");
  }
  return `http://127.0.0.1:8787/api/douyin/thumbnail?${query.toString()}`;
};

type DouyinDiscoveryItem = {
  url: string;
  videoId: string;
  title: string;
  author: string;
  coverUrl?: string;
  duration?: number;
  downloadUrl: string;
};

const discoveryThumbnailUrl = (item: DouyinDiscoveryItem) => `http://127.0.0.1:8787/api/douyin/thumbnail?${new URLSearchParams({ url: item.coverUrl || '' }).toString()}`;

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

function formatEta(seconds?: number) {
  if (!seconds || seconds <= 0) return undefined;
  if (seconds < 60) return `còn khoảng ${seconds} giây`;
  return `còn khoảng ${Math.ceil(seconds / 60)} phút`;
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
  const [discovering, setDiscovering] = useState(false);
  const [discoveryItems, setDiscoveryItems] = useState<DouyinDiscoveryItem[]>([]);
  const [selectedDiscoveryUrls, setSelectedDiscoveryUrls] = useState<Set<string>>(new Set());
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
  const batchJobRef = useRef<DouyinBatchJob | undefined>(undefined);
  const deletedItemIdsRef = useRef(new Set<string>());

  useEffect(() => {
    batchJobRef.current = batchJob;
  }, [batchJob]);


  useEffect(() => {
    const matches = inputText.match(VIDEO_SOURCE_URL_PATTERN) || [];
    const cleaned = Array.from(
      new Set(matches.map((url) => url.replace(/[),;。，！？\s]+$/, ""))),
    );
    setDetectedUrls(cleaned);
    setDiscoveryItems([]);
    setSelectedDiscoveryUrls(new Set());
    if (cleaned.length > 0) setSubmitError("");
  }, [inputText]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "autosub.douyin-history",
        JSON.stringify(historyItems),
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
            (entry) =>
              entry.status !== "pending" &&
              entry.status !== "resolving" &&
              entry.status !== "downloading" &&
              !deletedItemIdsRef.current.has(entry.id),
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
          const status = (error as { status?: number } | undefined)?.status;
          if (status === 404) {
            const interruptedJob = batchJobRef.current;
            const interruptedItems = interruptedJob?.items.filter((item) =>
              item.status === "pending" || item.status === "resolving" || item.status === "downloading"
            ) || [];
            if (interruptedItems.length > 0) {
              try {
                const restoredJob = await api.startDouyinBatch(
                  interruptedItems.map((item) => item.originalUrl),
                  interruptedItems[0]?.bilibiliQuality || bilibiliQuality,
                );
                if (cancelled) return;
                setBatchJob(restoredJob);
                setActiveBatchId(restoredJob.id);
                setPollError("");
                onNotice(`Backend vừa khởi động lại. Đã tự tải lại ${restoredJob.totalItems} video bị gián đoạn.`, "success");
                return;
              } catch {
                setInputText(interruptedItems.map((item) => item.originalUrl).join("\n"));
              }
            }
            setActiveBatchId(undefined);
            setBatchJob(undefined);
            setPollError("Phiên tải đã bị gián đoạn khi backend khởi động lại. Các link đã được đưa về ô nhập.");
            return;
          }
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
  }, [activeBatchId, bilibiliQuality, onNotice]);

  const handleStartBatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const urlsToQueue = discoveryItems.length ? Array.from(selectedDiscoveryUrls) : detectedUrls;
    if (urlsToQueue.length === 0) {
      setSubmitError("Chưa tìm thấy link Douyin hoặc Bilibili hợp lệ trong nội dung đã dán.");
      inputRef.current?.focus();
      return;
    }

    setSubmitError("");
    setSubmitting(true);
    try {
      const job = activeBatchId
        ? await api.appendDouyinBatch(activeBatchId, urlsToQueue, bilibiliQuality)
        : await api.startDouyinBatch(urlsToQueue, bilibiliQuality);
      setBatchJob(job);
      if (!activeBatchId) setActiveBatchId(job.id);
      setInputText("");
      onNotice(activeBatchId ? "Đã thêm video vào hàng đợi." : `Đã đưa ${job.totalItems} video vào hàng đợi.`, "success");
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

  const handleRetryItem = (item: DouyinBatchItem) => {
    setBatchJob(undefined);
    setInputText(item.originalUrl);
    setSubmitError("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleDiscover = async () => {
    if (!detectedUrls.length) { setSubmitError('Hãy dán ít nhất một link Douyin hoặc Bilibili công khai.'); inputRef.current?.focus(); return; }
    setDiscovering(true); setSubmitError('');
    try {
      const result = await api.parseDouyinUrls(detectedUrls, true);
      const items = (result.items || []).flatMap((entry, index) => entry.success && entry.info ? [{ ...entry.info, url: result.urls[index] || entry.info.url }] : []);
      setDiscoveryItems(items);
      setSelectedDiscoveryUrls(new Set(items.map((item) => item.url)));
      const failed = (result.items || []).length - items.length;
      if (!items.length) throw new Error('Không đọc được thông tin video nào từ các link đã dán.');
      onNotice(`Đã hiển thị ${items.length} video${failed ? `, ${failed} link không đọc được` : ''}.`, failed ? 'error' : 'success');
    } catch (error) { const message = friendlyErrorMessage(error, 'Không thể hiển thị danh sách video.'); setSubmitError(message); onNotice(message, 'error'); }
    finally { setDiscovering(false); }
  };

  const handleCancelItem = async (item: DouyinBatchItem) => {
    if (!batchJob?.id) return;
    try {
      await api.cancelDouyinBatchItem(batchJob.id, item.id);
      setBatchJob((previous) => previous ? {
        ...previous,
        items: previous.items.map((entry) => entry.id === item.id
          ? { ...entry, status: "cancelled", progressPercent: 0, error: undefined }
          : entry),
      } : undefined);
      onNotice("Đã hủy tải video.", "success");
    } catch (error) {
      onNotice(friendlyErrorMessage(error, "Không thể hủy video này."), "error");
    }
  };

  const handleDownloadAnotherQuality = (item: DouyinBatchItem) => {
    if (item.platform === "bilibili") {
      setBilibiliQuality(item.bilibiliQuality === 16 ? 64 : 16);
    }
    handleRetryItem(item);
  };

  const isDownloading = activeBatchId !== undefined;
  const seenItemIds = new Set<string>();
  const displayItems = [...(batchJob?.items || []), ...historyItems].filter((item) => {
    if (deletedItemIdsRef.current.has(item.id) || seenItemIds.has(item.id)) return false;
    seenItemIds.add(item.id);
    return true;
  });
  const handleDeleteItem = async (item: DouyinBatchItem) => {
    const unfinished = item.status === "pending" || item.status === "resolving" || item.status === "downloading";
    if (unfinished && batchJob?.id) {
      try {
        await api.cancelDouyinBatchItem(batchJob.id, item.id);
      } catch (error) {
        onNotice(friendlyErrorMessage(error, "Không thể dừng video trước khi xóa."), "error");
        return;
      }
    }
    deletedItemIdsRef.current.add(item.id);
    setHistoryItems((items) => items.filter((entry) => entry.id !== item.id));
    setBatchJob((job) => job ? { ...job, items: job.items.filter((entry) => entry.id !== item.id) } : undefined);
    onNotice(unfinished ? "Đã dừng và xóa video khỏi danh sách." : "Đã xóa video khỏi danh sách.", "success");
  };
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
            Dán link chia sẻ Douyin hoặc Bilibili, AutoSub lấy bản MP4 công khai và đưa thẳng vào quy trình hậu kỳ.
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
              disabled={submitting}
            />
            {inputText && !submitting && (
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
              disabled={submitting}
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

          {discoveryItems.length > 0 && <section className="douyin-discovery" aria-label="Danh sách video đã nhận diện">
            <div className="douyin-discovery-head"><div><strong>Video đã nhận diện</strong><small>{selectedDiscoveryUrls.size}/{discoveryItems.length} video được chọn</small></div><button type="button" className="button small ghost" onClick={() => setSelectedDiscoveryUrls(selectedDiscoveryUrls.size === discoveryItems.length ? new Set() : new Set(discoveryItems.map((item) => item.url)))}>{selectedDiscoveryUrls.size === discoveryItems.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button></div>
            <div className="douyin-discovery-grid">{discoveryItems.map((item) => { const selected = selectedDiscoveryUrls.has(item.url); return <article key={item.url} className={selected ? 'is-selected' : ''}>
              <button type="button" className="douyin-discovery-card" aria-pressed={selected} onClick={() => setSelectedDiscoveryUrls((current) => { const next = new Set(current); if (next.has(item.url)) next.delete(item.url); else next.add(item.url); return next; })}>
                <div className="douyin-discovery-cover">{item.coverUrl ? <img src={discoveryThumbnailUrl(item)} alt="" loading="lazy" /> : <Film size={24} />}<span className="douyin-discovery-check">{selected ? <Check size={12} /> : null}</span>{item.duration !== undefined && <small>{formatDuration(item.duration)}</small>}</div>
                <div className="douyin-discovery-copy"><strong>{item.title || `Douyin ${item.videoId}`}</strong><span>{item.author || 'Douyin Creator'}</span></div>
              </button>
              <a className="douyin-discovery-preview" href={item.downloadUrl} target="_blank" rel="noreferrer"><CirclePlay size={12} /> Xem thử</a>
            </article>; })}</div>
          </section>}

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
            <button className="button ghost" type="button" disabled={discovering || submitting || !detectedUrls.length} onClick={() => void handleDiscover()}>{discovering ? <LoaderCircle className="spin" size={16} /> : <CirclePlay size={16} />} {discovering ? 'Đang đọc video…' : 'Hiển thị video'}</button>
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
                ? "Đang thêm vào hàng đợi"
                : isDownloading
                  ? `Thêm ${detectedUrls.length || "video"} vào hàng đợi`
                  : `Tải ${discoveryItems.length ? `${selectedDiscoveryUrls.size} video đã chọn` : detectedUrls.length ? `${detectedUrls.length} video` : "video Douyin/Bilibili"}`}
            </button>
            {isDownloading && (
              <button
                className="button douyin-cancel-button"
                type="button"
                onClick={handleCancelBatch}
              >
                <CircleX size={16} /> Hủy hàng đợi
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
                  Hàng đợi tải
                </h2>
                <p>
                  {displayItems.length} video đã lưu cục bộ
                </p>
              </div>
            </div>
            <div className="douyin-queue-tools">
              {!isDownloading && displayItems.length > 0 && (
                <button
                  className="button small ghost"
                  type="button"
                  onClick={() => {
                    displayItems.forEach((item) => deletedItemIdsRef.current.add(item.id));
                    setHistoryItems([]);
                    setBatchJob(undefined);
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
                      <Film size={25} aria-hidden="true" />
                      {item.coverUrl && (
                        <img
                          key={item.coverUrl}
                          src={thumbnailProxyUrl(item)}
                          alt=""
                          loading="lazy"
                          onError={(event) => { event.currentTarget.hidden = true; }}
                        />
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
                        {item.status === "downloading" && formatBytes(item.downloadedBytes) && (
                          <span>{formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes) || "chưa rõ"}</span>
                        )}
                        {item.status === "downloading" && formatBytes(item.downloadSpeedBytesPerSecond) && (
                          <span>{formatBytes(item.downloadSpeedBytesPerSecond)}/s</span>
                        )}
                        {item.status === "downloading" && formatEta(item.etaSeconds) && (
                          <span>{formatEta(item.etaSeconds)}</span>
                        )}
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

                      {(item.status === "pending" || isWorking) && batchJob && (
                        <div className="douyin-item-actions">
                          <button
                            className="button small ghost"
                            type="button"
                            onClick={() => handleCancelItem(item)}
                          >
                            <CircleX size={13} /> Hủy video này
                          </button>
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
                          <button
                            className="button small ghost"
                            type="button"
                            onClick={() => handleDownloadAnotherQuality(item)}
                          >
                            <RefreshCw size={13} />
                            {item.platform === "bilibili"
                              ? `Tải lại bản ${item.bilibiliQuality === 16 ? "720p" : "360p"}`
                              : "Tải lại từ link"}
                          </button>
                          {item.coverUrl && (
                            <a
                              className="button small ghost"
                              href={thumbnailProxyUrl(item, true)}
                            >
                              <Download size={13} /> Tải thumbnail
                            </a>
                          )}
                        </div>
                      )}
                      <button
                        className="douyin-delete-item"
                        type="button"
                        onClick={() => void handleDeleteItem(item)}
                        aria-label={`${item.status === "pending" || isWorking ? "Dừng và xóa" : "Xóa"} ${item.title || "video"} khỏi danh sách`}
                        title={item.status === "pending" || isWorking ? "Dừng tải và xóa khỏi danh sách" : "Xóa khỏi danh sách"}
                      >
                        <Trash2 size={14} />
                      </button>
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
