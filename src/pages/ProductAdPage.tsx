import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AIProvider, AIVoice, AppSettings, ProductAdJobStatus, ProductAdOutputMode, ProductAdPlatform, ProviderAssignment } from '../types';
import { api, friendlyErrorMessage, productAdVideoUrl } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import { resolvedProviderType } from '../lib/providers';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { Check, CirclePlay, Download, Image as ImageIcon, LoaderCircle, RefreshCw, ShieldCheck, Trash2, Upload, WandSparkles, X } from '../components/Icons';

type ProductImageDraft = {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadId?: string;
  status: 'uploading' | 'ready' | 'failed';
  error?: string;
};

const productAdJobStorageKey = 'autosub.product-ad-job-id';
const activeStates = new Set<ProductAdJobStatus['status']>(['queued', 'analyzing', 'scripting', 'voicing', 'rendering']);
const maxProductImages = 8;
const maxImageBytes = 25 * 1024 * 1024;

function compactJobError(value?: string) {
  if (!value || !/^ffmpeg version/im.test(value)) return value;
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line
    && !/^ffmpeg version/i.test(line)
    && !/^built with /i.test(line)
    && !/^configuration:/i.test(line)
    && !/^libav(?:util|codec|format|device|filter)/i.test(line)
    && !/^libsw(?:scale|resample)/i.test(line)).slice(-12).join('\n');
}

const formatDuration = (milliseconds?: number) => {
  if (!milliseconds) return '—';
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function ProductAdPage({ providers, settings, onNotice }: {
  providers: AIProvider[];
  settings: AppSettings;
  onNotice: (message: string, kind?: 'success' | 'error') => void;
}) {
  const [images, setImages] = useState<ProductImageDraft[]>([]);
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [offer, setOffer] = useState('');
  const [callToAction, setCallToAction] = useState('Xem sản phẩm ở liên kết được gắn');
  const [platform, setPlatform] = useState<ProductAdPlatform>('both');
  const [outputMode, setOutputMode] = useState<ProductAdOutputMode>('veo3-script');
  const [targetDuration, setTargetDuration] = useState(30);
  const [tone, setTone] = useState('UGC chân thật, nhanh gọn, không khoa trương');
  const [customPrompt, setCustomPrompt] = useState('');
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [visionAssignment, setVisionAssignment] = useState<ProviderAssignment>(settings.assignments.vision);
  const [scriptAssignment, setScriptAssignment] = useState<ProviderAssignment>(settings.assignments.translation);
  const [ttsAssignment, setTtsAssignment] = useState<ProviderAssignment>(settings.assignments.tts);
  const [voice, setVoice] = useState('');
  const [voiceSpeed, setVoiceSpeed] = useState(1.1);
  const [cloneVoices, setCloneVoices] = useState<AIVoice[]>([]);
  const [testingVoice, setTestingVoice] = useState(false);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<ProductAdJobStatus>();
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const imagesRef = useRef<ProductImageDraft[]>([]);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewUrlRef = useRef<string | null>(null);
  const voicePreviewRequestRef = useRef(0);

  const visionProvider = providers.find((item) => item.id === visionAssignment.providerId);
  const scriptProvider = providers.find((item) => item.id === scriptAssignment.providerId);
  const ttsProvider = providers.find((item) => item.id === ttsAssignment.providerId);
  const ttsProviderType = ttsProvider ? resolvedProviderType(ttsProvider) : undefined;
  const voiceItems = useMemo(() => ttsProviderType === 'vieneu-local' ? cloneVoices : ttsProviderType === 'hiiu-tts'
    ? (ttsProvider?.models || []).map((model) => ({ id: model.id, name: model.name || model.id, language: '' }))
    : ttsProvider?.voices || [], [cloneVoices, ttsProvider, ttsProviderType]);

  const stopVoicePreview = useCallback(() => {
    voicePreviewRequestRef.current += 1;
    const audio = voicePreviewRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      voicePreviewRef.current = null;
    }
    if (voicePreviewUrlRef.current) {
      URL.revokeObjectURL(voicePreviewUrlRef.current);
      voicePreviewUrlRef.current = null;
    }
  }, []);

  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => {
    uploadControllersRef.current.forEach((controller) => controller.abort());
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    stopVoicePreview();
  }, [stopVoicePreview]);
  useEffect(() => {
    stopVoicePreview();
    setTestingVoice(false);
  }, [stopVoicePreview, ttsAssignment.model, ttsProvider?.id, voice]);
  useEffect(() => {
    const next = ttsProviderType === 'hiiu-tts' ? ttsAssignment.model : voiceItems.some((item) => item.id === voice) ? voice : voiceItems[0]?.id || (ttsProviderType === 'openai-compatible' ? 'alloy' : '');
    if (next !== voice) setVoice(next);
  }, [ttsAssignment.model, ttsProvider?.id, ttsProviderType, voiceItems]);
  useEffect(() => {
    if (ttsProviderType !== 'vieneu-local') return;
    const controller = new AbortController();
    void api.listVieneuVoiceClones(controller.signal).then((result) => setCloneVoices(result.voices)).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) onNotice(friendlyErrorMessage(error, 'Không thể tải danh sách giọng clone.'), 'error');
    });
    return () => controller.abort();
  }, [ttsProviderType]);
  useEffect(() => {
    const savedId = localStorage.getItem(productAdJobStorageKey);
    if (savedId) void api.getProductAdJob(savedId).then(setJob).catch(() => localStorage.removeItem(productAdJobStorageKey));
  }, []);
  useEffect(() => {
    if (!job || !activeStates.has(job.status)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void api.getProductAdJob(job.id, controller.signal).then(setJob).catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) onNotice(friendlyErrorMessage(error, 'Không thể cập nhật product ad job.'), 'error');
      });
    }, 1_500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [job?.id, job?.status]);

  const addImages = (files?: FileList | null) => {
    const available = maxProductImages - images.length;
    if (!files || available <= 0) { onNotice(`Chỉ dùng tối đa ${maxProductImages} ảnh cho một video.`, 'error'); return; }
    const selected = Array.from(files).filter((file) => file.type.startsWith('image/')).slice(0, available);
    if (!selected.length) { onNotice('Hãy chọn file ảnh PNG, JPG hoặc WEBP.', 'error'); return; }
    const valid = selected.filter((file) => {
      if (file.size <= maxImageBytes) return true;
      onNotice(`${file.name} lớn hơn 25 MB.`, 'error');
      return false;
    });
    const drafts = valid.map((file) => ({ id: crypto.randomUUID(), name: file.name, url: URL.createObjectURL(file), size: file.size, status: 'uploading' as const, file }));
    setImages((current) => [...current, ...drafts.map(({ file: _file, ...draft }) => draft)]);
    drafts.forEach((draft) => {
      const controller = new AbortController();
      uploadControllersRef.current.set(draft.id, controller);
      void api.uploadMedia(draft.file, controller.signal).then((stored) => {
        setImages((current) => current.map((item) => item.id === draft.id ? { ...item, uploadId: stored.uploadId, status: 'ready' } : item));
      }).catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setImages((current) => current.map((item) => item.id === draft.id ? { ...item, status: 'failed', error: friendlyErrorMessage(error, 'Không thể lưu ảnh.') } : item));
      }).finally(() => uploadControllersRef.current.delete(draft.id));
    });
  };

  const removeImage = (image: ProductImageDraft) => {
    uploadControllersRef.current.get(image.id)?.abort();
    uploadControllersRef.current.delete(image.id);
    URL.revokeObjectURL(image.url);
    if (image.uploadId) void api.deleteUpload(image.uploadId).catch(() => undefined);
    setImages((current) => current.filter((item) => item.id !== image.id));
  };

  const testVoice = async () => {
    if (!ttsProvider || !ttsAssignment.model || !voice) { onNotice('Hãy chọn đủ TTS Provider, model và voice.', 'error'); return; }
    stopVoicePreview();
    const requestId = voicePreviewRequestRef.current;
    setTestingVoice(true);
    try {
      const blob = await api.testVoice(ttsProvider, ttsAssignment.model, voice, voiceSpeed, 'Một video quảng cáo tốt cần nói rõ lợi ích và trung thực về sản phẩm.');
      if (requestId !== voicePreviewRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      voicePreviewRef.current = audio;
      voicePreviewUrlRef.current = url;
      const release = () => {
        if (voicePreviewRef.current !== audio) return;
        voicePreviewRef.current = null;
        voicePreviewUrlRef.current = null;
        URL.revokeObjectURL(url);
      };
      audio.onended = release;
      audio.onerror = release;
      await audio.play();
    } catch (error) {
      if (requestId === voicePreviewRequestRef.current) onNotice(friendlyErrorMessage(error, 'Không thể thử giọng.'), 'error');
    } finally {
      if (requestId === voicePreviewRequestRef.current) setTestingVoice(false);
    }
  };

  const startJob = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (starting) return;
    const readyImages = images.filter((image) => image.status === 'ready' && image.uploadId);
    if (!readyImages.length || readyImages.length !== images.length) { onNotice('Hãy chờ tất cả ảnh tải xong và xóa ảnh bị lỗi.', 'error'); return; }
    if (!productName.trim() || productDescription.trim().length < 20) { onNotice('Hãy nhập tên và mô tả sản phẩm ít nhất 20 ký tự.', 'error'); return; }
    if (!scriptProvider || !scriptAssignment.model) { onNotice('Cấu hình Script AI còn thiếu.', 'error'); return; }
    if (outputMode === 'render' && (!ttsProvider || !ttsAssignment.model || !voice)) { onNotice('Cấu hình TTS còn thiếu để render MP4.', 'error'); return; }
    setStarting(true);
    try {
      const created = await api.createProductAdJob({
        imageUploadIds: readyImages.map((image) => image.uploadId as string),
        productName,
        productDescription,
        targetAudience,
        offer,
        callToAction,
        platform,
        outputMode,
        targetDurationSeconds: targetDuration,
        tone,
        customPrompt,
        burnSubtitles,
        vision: visionProvider && visionAssignment.model ? { provider: visionProvider, model: visionAssignment.model } : undefined,
        script: { provider: scriptProvider, model: scriptAssignment.model },
        tts: outputMode === 'render' && ttsProvider ? { provider: ttsProvider, model: ttsAssignment.model, voice, speed: voiceSpeed } : undefined,
      });
      localStorage.setItem(productAdJobStorageKey, created.id);
      setJob(created);
      onNotice(outputMode === 'veo3-script' ? 'Đã bắt đầu tạo gói prompt Veo 3.' : 'Đã bắt đầu tạo video quảng cáo sản phẩm.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo product ad job.'), 'error'); }
    finally { setStarting(false); }
  };

  const cancelJob = async () => {
    if (!job) return;
    try { setJob(await api.cancelProductAdJob(job.id)); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể hủy job.'), 'error'); }
  };

  const copyCaption = async () => {
    if (!job?.plan) return;
    const value = [job.plan.caption, job.plan.disclosure, job.plan.hashtags.join(' ')].filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(value); onNotice('Đã sao chép caption và disclosure.'); }
    catch { onNotice('Không thể sao chép caption.', 'error'); }
  };

  const copyVeoPrompts = async (prompt?: string) => {
    if (!job?.veo3Pack) return;
    const value = prompt || job.veo3Pack.clips.map((clip) => [
      `CLIP ${clip.index} · ${clip.durationSeconds}s · ${clip.startSeconds}-${clip.endSeconds}s`,
      clip.prompt,
    ].join('\n')).join('\n\n--------------------\n\n');
    try { await navigator.clipboard.writeText(value); onNotice(prompt ? 'Đã sao chép prompt Veo 3.' : 'Đã sao chép toàn bộ gói prompt Veo 3.'); }
    catch { onNotice('Không thể sao chép prompt Veo 3.', 'error'); }
  };

  const jobRunning = Boolean(job && activeStates.has(job.status));
  const running = starting || jobRunning;
  const uploading = images.some((image) => image.status === 'uploading');
  const canRetry = images.length > 0 && images.every((image) => image.status === 'ready' && image.uploadId);
  const veoClipCount = Math.ceil(targetDuration / 10);

  return <div className="page product-ad-page">
    <header className="page-header"><div><span className="eyebrow">AI PRODUCT AD STUDIO</span><h1>Quảng cáo sản phẩm <span>tự động</span></h1><p>Biến ảnh và mô tả sản phẩm thành video dọc có hook, voice, phụ đề và CTA.</p></div><div className="product-ad-header-badge"><WandSparkles size={17} /><span><strong>Short-form 9:16</strong><small>TikTok · YouTube Shorts · 10–60 giây</small></span></div></header>

    <form className="product-ad-grid" onSubmit={startJob}>
      <div className="product-ad-config-column">
        <section className="review-panel">
          <div className="section-title"><span>01 · THÔNG TIN SẢN PHẨM</span><small>Chỉ nhập thông tin có thể kiểm chứng</small></div>
          <div className="field"><span>Tên sản phẩm</span><input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Ví dụ: Giá đỡ điện thoại xoay 360°" /></div>
          <div className="field"><span>Mô tả, tính năng và điểm khác biệt</span><textarea value={productDescription} onChange={(event) => setProductDescription(event.target.value)} placeholder="Chất liệu, kích thước, cách dùng, ưu/nhược điểm, thông tin từ nhà bán…" /></div>
          <div className="two-fields"><div className="field"><span>Khách hàng mục tiêu</span><input value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)} placeholder="Người hay xem phim trên giường" /></div><div className="field"><span>Ưu đãi hiện có</span><input value={offer} onChange={(event) => setOffer(event.target.value)} placeholder="Để trống nếu chưa chắc giá" /></div></div>
          <div className="field"><span>Lời kêu gọi hành động</span><input value={callToAction} onChange={(event) => setCallToAction(event.target.value)} /></div>
        </section>

        <section className="review-panel">
          <div className="section-title"><span>02 · ẢNH SẢN PHẨM</span><small>{images.length}/{maxProductImages} ảnh</small></div>
          <label className="product-image-dropzone"><ImageIcon size={22} /><span><strong>Chọn nhiều ảnh sản phẩm</strong><small>PNG · JPG · WEBP · tối đa 25 MB/ảnh</small></span><input type="file" accept="image/png,image/jpeg,image/webp,image/bmp" multiple onChange={(event) => { addImages(event.currentTarget.files); event.currentTarget.value = ''; }} /></label>
          {images.length > 0 && <div className="product-image-grid">{images.map((image, index) => <article className={`product-image-card ${image.status}`} key={image.id}><img src={image.url} alt={`Ảnh sản phẩm ${index + 1}: ${image.name}`} /><div><span>{String(index + 1).padStart(2, '0')}</span><small>{image.status === 'uploading' ? 'Đang lưu…' : image.status === 'failed' ? image.error || 'Lỗi upload' : image.name}</small><button type="button" className="icon-button danger-icon" onClick={() => removeImage(image)} aria-label={`Xóa ${image.name}`}><Trash2 size={13} /></button></div></article>)}</div>}
        </section>

        <section className="review-panel">
          <div className="section-title"><span>03 · AI + GIỌNG ĐỌC</span><small>Vision tùy chọn · Script bắt buộc · TTS chỉ dùng cho MP4</small></div>
          <CapabilityAssignmentPicker capability="vision" assignments={capabilityAssignments(settings, 'vision')} providers={providers} value={visionAssignment} onChange={setVisionAssignment} label="Vision · mô tả từng ảnh" />
          {visionProvider && visionAssignment.model && <AssignmentSummary label="Vision đang dùng" assignment={visionAssignment} provider={visionProvider} capability="vision" />}
          <CapabilityAssignmentPicker capability="translation" assignments={capabilityAssignments(settings, 'translation')} providers={providers} value={scriptAssignment} onChange={setScriptAssignment} label="Script · viết hook, lời đọc và CTA" />
          <AssignmentSummary label="Script AI đang dùng" assignment={scriptAssignment} provider={scriptProvider} capability="translation" />
          {outputMode === 'render' && <><CapabilityAssignmentPicker capability="tts" assignments={capabilityAssignments(settings, 'tts')} providers={providers} value={ttsAssignment} onChange={setTtsAssignment} label="TTS · giọng đọc quảng cáo" />
          <AssignmentSummary label="TTS đang dùng" assignment={ttsAssignment} provider={ttsProvider} capability="tts" />
          <div className="field"><span>Voice</span>{voiceItems.length ? <SelectField ariaLabel="Voice quảng cáo" value={voice} onChange={setVoice} options={voiceItems.map((item) => ({ value: item.id, label: item.name || item.id, description: `${item.id}${item.language ? ` · ${item.language}` : ''}` }))} /> : <input value={voice} onChange={(event) => setVoice(event.target.value)} placeholder={ttsProviderType === 'vieneu-local' ? 'Tạo giọng ở mục Clone giọng' : 'Voice ID'} readOnly={ttsProviderType === 'vieneu-local'} />}</div>
          <div className="review-voice-row"><div className="field"><span>Tốc độ <b className="value-badge">{voiceSpeed.toFixed(2)}×</b></span><RangeInput min={0.9} max={1.4} step={0.05} value={voiceSpeed} onChange={(event) => setVoiceSpeed(Number(event.target.value))} /></div><button type="button" className="button ghost" disabled={testingVoice} onClick={() => void testVoice()}>{testingVoice ? <LoaderCircle size={15} className="spin" /> : <CirclePlay size={15} />} Nghe thử</button></div></>}
        </section>

        <section className="review-panel">
          <div className="section-title"><span>04 · ĐẦU RA QUẢNG CÁO</span><small>{outputMode === 'veo3-script' ? `${veoClipCount} prompt · tối đa 10 giây/clip` : 'Xuất MP4 dọc 720 × 1280'}</small></div>
          <div className="field"><span>Kiểu đầu ra</span><SelectField ariaLabel="Kiểu đầu ra quảng cáo" value={outputMode} onChange={(value) => setOutputMode(value as ProductAdOutputMode)} options={[{ value: 'veo3-script', label: 'Gói prompt Veo 3', description: 'Chia thành clip tối đa 10 giây, không render video' }, { value: 'render', label: 'MP4 từ ảnh + giọng đọc', description: 'Dùng ảnh sản phẩm, TTS và FFmpeg như hiện tại' }]} /></div>
          {outputMode === 'veo3-script' && <div className="product-veo-mode-note"><WandSparkles size={15} /><span>Video {targetDuration} giây sẽ được chia thành <strong>{veoClipCount} prompt Veo 3</strong>{targetDuration % 10 ? `; clip cuối dài ${targetDuration % 10} giây` : ''}. Mỗi prompt có 4 micro-shot và khóa hình dáng sản phẩm; tiêu đề cùng voice được giữ riêng để AutoSub hậu kỳ.</span></div>}
          <div className="two-fields"><div className="field"><span>Nền tảng</span><SelectField ariaLabel="Nền tảng đăng" value={platform} onChange={(value) => setPlatform(value as ProductAdPlatform)} options={[{ value: 'both', label: 'TikTok + YouTube Shorts' }, { value: 'tiktok', label: 'TikTok' }, { value: 'youtube-shorts', label: 'YouTube Shorts' }]} /></div><div className="field"><span>Phong cách</span><SelectField ariaLabel="Phong cách quảng cáo" value={tone} onChange={setTone} options={['UGC chân thật, nhanh gọn, không khoa trương', 'Review trực diện, tập trung tính năng', 'Kể chuyện vấn đề → giải pháp', 'Năng động, nhiều hook ngắn'].map((value) => ({ value, label: value }))} /></div></div>
          <div className="field"><span>Thời lượng mục tiêu <b className="value-badge">{targetDuration} giây</b></span><RangeInput min={10} max={60} step={5} value={targetDuration} onChange={(event) => setTargetDuration(Number(event.target.value))} /></div>
          <div className="field"><span>Yêu cầu bổ sung <small>· không bắt buộc</small></span><textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="Ví dụ: mở đầu bằng vấn đề điện thoại rơi khi xem phim trên giường…" /></div>
          {outputMode === 'render' && <label className="toggle-row compact"><input type="checkbox" checked={burnSubtitles} onChange={(event) => setBurnSubtitles(event.target.checked)} /><i /><span>Đốt phụ đề tiếng Việt vào video</span></label>}
          <div className="review-safety-note"><ShieldCheck size={16} /><span>AI được yêu cầu không tự bịa giá, ưu đãi, trải nghiệm hoặc công dụng. Bạn vẫn cần duyệt lại kịch bản và giữ disclosure affiliate khi đăng.</span></div>
          <button type="submit" className="button primary large full" disabled={running || uploading}><WandSparkles size={16} /> {running ? 'Pipeline đang chạy…' : uploading ? 'Đang lưu ảnh…' : outputMode === 'veo3-script' ? 'Tạo gói prompt Veo 3' : 'Tạo video quảng cáo'} <span>→</span></button>
        </section>
      </div>

      <div className="product-ad-result-column">
        <section className="review-panel product-ad-result-panel">
          <div className="section-title"><span>KẾT QUẢ QUẢNG CÁO</span><small>{job ? `JOB ${job.id.slice(0, 8)}` : 'Chưa có job'}</small></div>
          {!job ? <div className="review-empty"><WandSparkles size={28} /><strong>Video hoặc gói prompt Veo 3 sẽ xuất hiện ở đây</strong><small>Thêm ảnh, mô tả sản phẩm và chọn Script AI để bắt đầu.</small></div> : <>
            <div className={`review-status ${job.status}`} role="status" aria-live="polite"><span>{activeStates.has(job.status) && <LoaderCircle size={16} className="spin" />}{job.status === 'completed' && <Check size={16} />}{['failed', 'cancelled'].includes(job.status) && <X size={16} />}</span><div><strong>{job.stage}</strong><small>{compactJobError(job.error) || job.warnings.at(-1)}</small></div><b>{job.progressPercent}%</b></div>
            <div className="progress-track review-progress"><div style={{ width: `${job.progressPercent}%` }} /></div>
            {jobRunning && <button type="button" className="button small ghost danger review-cancel" onClick={() => void cancelJob()}><X size={14} /> Hủy job</button>}
            {job.status === 'failed' && <div className="product-ad-retry"><button type="button" className="button primary" disabled={!canRetry || starting} onClick={() => void startJob()}>{starting ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />} {starting ? 'Đang thử lại…' : 'Thử lại'}</button><small>{canRetry ? 'Dùng lại ảnh và toàn bộ cấu hình hiện tại.' : 'Hãy chọn lại ảnh sản phẩm để thử lại.'}</small></div>}
            {job.status === 'completed' && job.result && <div className="review-result product-ad-video"><video controls playsInline preload="metadata" src={productAdVideoUrl(job.id)} /><div className="review-result-meta"><div><span>Thời lượng</span><strong>{formatDuration(job.result.durationMs)}</strong></div><div><span>Số cảnh</span><strong>{job.plan?.scenes.length || 0}</strong></div><a className="button primary" href={productAdVideoUrl(job.id, true)}><Download size={14} /> Tải MP4</a></div></div>}
            {job.status === 'completed' && job.veo3Pack && <section className="product-veo-pack"><div className="product-veo-pack-heading"><div><strong>{job.veo3Pack.clips.length} prompt Veo 3 · {job.veo3Pack.totalDurationSeconds} giây</strong><small>Mỗi clip tối đa {job.veo3Pack.clipLimitSeconds} giây · 4 micro-shot · chữ và voice hậu kỳ · khung {job.veo3Pack.aspectRatio}</small></div><button type="button" className="button primary small" onClick={() => void copyVeoPrompts()}>Sao chép toàn bộ</button></div><div className="product-veo-prompt-list">{job.veo3Pack.clips.map((clip) => <article key={clip.id}><header><span>CLIP {String(clip.index).padStart(2, '0')}</span><strong>{clip.durationSeconds} giây</strong><small>{clip.startSeconds}s → {clip.endSeconds}s · Ảnh {clip.imageIndex + 1}</small></header><pre>{clip.prompt}</pre><button type="button" className="button small ghost" onClick={() => void copyVeoPrompts(clip.prompt)}>Sao chép prompt này</button></article>)}</div></section>}
            {job.plan && <details className="review-plan" open={job.status === 'completed'}><summary>Kịch bản, caption và danh sách cảnh</summary><div className="review-plan-heading"><strong>{job.plan.title}</strong><p>{job.plan.caption}</p><p><b>Disclosure:</b> {job.plan.disclosure}</p><p>{job.plan.hashtags.join(' ')}</p><button type="button" className="button small ghost product-caption-copy" onClick={() => void copyCaption()}>Sao chép caption</button></div><div className="product-ad-scene-list">{job.plan.scenes.map((scene, index) => <article key={scene.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{scene.headline}</strong><p>{scene.narration}</p></div><small>Ảnh {scene.imageIndex + 1}</small></article>)}</div></details>}
            {job.warnings.length > 0 && <div className="product-ad-warning-list">{job.warnings.map((warning) => <p key={warning}><ShieldCheck size={13} /> {warning}</p>)}</div>}
          </>}
        </section>
      </div>
    </form>
  </div>;
}
