import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AIProvider, AIVoice, AppSettings, ProductAdJobStatus, ProductAdOutputMode, ProductAdPlatform, ProviderAssignment } from '../types';
import { animationAssetUrl, api, friendlyErrorMessage, productAdSubtitleUrl, productAdVideoUrl } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import { resolvedProviderType } from '../lib/providers';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { Check, CirclePlay, Download, Image as ImageIcon, LoaderCircle, RefreshCw, ShieldCheck, Trash2, Upload, WandSparkles, X } from '../components/Icons';
import { loadVoicePreview, primeVoicePreview, VI_VOICE_PREVIEW_TEXT } from '../lib/voicePreview';

type ProductImageDraft = {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadId?: string;
  status: 'uploading' | 'ready' | 'failed';
  error?: string;
};

type ProductSubtitleStyle = {
  fontSize: number; positionPercent: number; textColor: string; backgroundColor: string;
  backgroundOpacity: number; outlineWidth: number; maxCharsPerLine: number;
  textAlign: 'left' | 'center' | 'right'; bold: boolean;
};

const productAdJobStorageKey = 'autosub.product-ad-job-id';
const productAdImagesStorageKey = 'autosub.product-ad-images';
const activeStates = new Set<ProductAdJobStatus['status']>(['queued', 'analyzing', 'scripting', 'voicing', 'rendering']);
const maxProductImages = 8;
const maxImageBytes = 25 * 1024 * 1024;
const defaultSubtitleStyle: ProductSubtitleStyle = { fontSize: 30, positionPercent: 76, textColor: '#FFFFFF', backgroundColor: '#101010', backgroundOpacity: 0.55, outlineWidth: 2, maxCharsPerLine: 32, textAlign: 'center', bold: false };

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
  const [images, setImages] = useState<ProductImageDraft[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(productAdImagesStorageKey) || '[]') as Array<Pick<ProductImageDraft, 'id' | 'name' | 'size' | 'uploadId'>>;
      return stored.filter((image) => image.uploadId).map((image) => ({ ...image, url: animationAssetUrl(image.uploadId as string), status: 'ready' }));
    } catch { return []; }
  });
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [offer, setOffer] = useState('');
  const [callToAction, setCallToAction] = useState('Xem sản phẩm ở liên kết được gắn');
  const [platform, setPlatform] = useState<ProductAdPlatform>('both');
  const [outputMode] = useState<ProductAdOutputMode>('render');
  const [targetDuration, setTargetDuration] = useState(30);
  const [tone, setTone] = useState('UGC chân thật, nhanh gọn, không khoa trương');
  const [creativeMode, setCreativeMode] = useState<'professional' | 'everyday' | 'ugc' | 'direct-response'>('everyday');
  const [customPrompt, setCustomPrompt] = useState('');
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState(defaultSubtitleStyle);
  const [subtitleTexts, setSubtitleTexts] = useState<string[]>([]);
  const [visualMode, setVisualMode] = useState<'local' | 'flow-image' | 'flow-video'>('local');
  const [flowAgent, setFlowAgent] = useState<Awaited<ReturnType<typeof api.flowAgentStatus>>>();
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
  const subtitleSourceJobRef = useRef('');

  const visionProvider = providers.find((item) => item.id === visionAssignment.providerId);
  const scriptProvider = providers.find((item) => item.id === scriptAssignment.providerId);
  const ttsProvider = providers.find((item) => item.id === ttsAssignment.providerId);
  const ttsProviderType = ttsProvider ? resolvedProviderType(ttsProvider) : undefined;
  const useFlowAgentVisuals = visualMode === 'flow-image';
  const useFlowAgentMotion = visualMode === 'flow-video';
  const needsFlowAgent = visualMode !== 'local';
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
  useEffect(() => {
    const stored = images.filter((image) => image.status === 'ready' && image.uploadId).map(({ id, name, size, uploadId }) => ({ id, name, size, uploadId }));
    localStorage.setItem(productAdImagesStorageKey, JSON.stringify(stored));
  }, [images]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => void api.flowAgentStatus().then((status) => { if (mounted) setFlowAgent(status); }).catch(() => { if (mounted) setFlowAgent(undefined); });
    refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
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
    const timer = window.setTimeout(() => primeVoicePreview(ttsProvider, ttsAssignment.model, voice, voiceSpeed), 250);
    return () => window.clearTimeout(timer);
  }, [ttsProvider?.id, ttsAssignment.model, voice, voiceSpeed]);
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
    if (savedId) void api.getProductAdJob(savedId).then((savedJob) => {
      setJob(savedJob);
      if (!imagesRef.current.length && savedJob.imageUploadIds?.length) setImages(savedJob.imageUploadIds.map((uploadId, index) => ({
        id: uploadId,
        name: savedJob.imageNames[index] || `Ảnh sản phẩm ${index + 1}`,
        url: animationAssetUrl(uploadId),
        size: 0,
        uploadId,
        status: 'ready',
      })));
    }).catch(() => localStorage.removeItem(productAdJobStorageKey));
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
  useEffect(() => {
    if (!job?.plan || subtitleSourceJobRef.current === job.id) return;
    subtitleSourceJobRef.current = job.id;
    setSubtitleTexts(job.plan.scenes.map((scene) => scene.narration));
  }, [job?.id, job?.plan]);

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
      const blob = await loadVoicePreview(ttsProvider, ttsAssignment.model, voice, voiceSpeed, VI_VOICE_PREVIEW_TEXT);
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
    if (needsFlowAgent && !flowAgent?.connected) { onNotice('Flow Agent chưa sẵn sàng. Hãy mở Google Flow và tải lại tab.', 'error'); return; }
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
        creativeMode,
        customPrompt,
        burnSubtitles,
        subtitleStyle,
        useFlowAgentVisuals,
        useFlowAgentMotion,
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

  const createFlowPreview = async () => {
    if (!job?.id) return;
    setStarting(true);
    try {
      setJob(await api.createProductAdFlowPreview(job.id));
      onNotice('Đã tạo video AI thử nghiệm bằng Google Flow.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo video Google Flow.'), 'error'); }
    finally { setStarting(false); }
  };

  const applySubtitleStyle = async (burnOverride = burnSubtitles) => {
    if (!job?.id || job.status !== 'completed' || !job.result) { onNotice('Hãy tạo xong video trước khi áp dụng lại phụ đề.', 'error'); return; }
    setStarting(true);
    try {
      const updated = await api.rerenderProductAdSubtitles(job.id, burnOverride, subtitleStyle, subtitleTexts);
      setJob(updated);
      onNotice(burnOverride ? 'Đang áp dụng phụ đề vào video đã tạo.' : 'Đang tạo bản video sạch không phụ đề.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể áp dụng lại phụ đề.'), 'error'); }
    finally { setStarting(false); }
  };

  const changeBurnSubtitles = (next: boolean) => {
    setBurnSubtitles(next);
    if (job?.status === 'completed' && job.result) void applySubtitleStyle(next);
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
          <div className="section-title"><span>04 · ĐẦU RA QUẢNG CÁO</span><small>Xuất MP4 dọc 720 × 1280</small></div>
          <div className="product-veo-mode-note"><WandSparkles size={15} /><span>AutoSub sẽ tạo lời đọc, dựng chuyển động từ ảnh sản phẩm, đốt phụ đề nếu bật và xuất trực tiếp video MP4 hoàn chỉnh.</span></div>
          <div className="two-fields"><div className="field"><span>Nền tảng</span><SelectField ariaLabel="Nền tảng đăng" value={platform} onChange={(value) => setPlatform(value as ProductAdPlatform)} options={[{ value: 'both', label: 'TikTok + YouTube Shorts' }, { value: 'tiktok', label: 'TikTok' }, { value: 'youtube-shorts', label: 'YouTube Shorts' }]} /></div><div className="field"><span>Chế độ đạo diễn</span><SelectField ariaLabel="Chế độ đạo diễn quảng cáo" value={creativeMode} onChange={(value) => setCreativeMode(value as typeof creativeMode)} options={[{ value: 'professional', label: 'Chuyên nghiệp', description: 'Brand film sạch, cao cấp, giàu chi tiết.' }, { value: 'everyday', label: 'Đời thường', description: 'Tình huống gần gũi, tự nhiên, dễ đồng cảm.' }, { value: 'ugc', label: 'UGC chân thật', description: 'Ngôn ngữ creator và camera điện thoại.' }, { value: 'direct-response', label: 'Bán hàng hiệu quả', description: 'Hook, demo, xử lý băn khoăn và CTA.' }]} /></div></div>
          <div className="field"><span>Giọng điệu bổ sung</span><SelectField ariaLabel="Giọng điệu quảng cáo" value={tone} onChange={setTone} options={['UGC chân thật, nhanh gọn, không khoa trương', 'Review trực diện, tập trung tính năng', 'Kể chuyện vấn đề → giải pháp', 'Năng động, nhiều hook ngắn'].map((value) => ({ value, label: value }))} /></div>
          <div className="field"><span>Thời lượng mục tiêu <b className="value-badge">{targetDuration} giây</b></span><RangeInput min={10} max={60} step={5} value={targetDuration} onChange={(event) => setTargetDuration(Number(event.target.value))} /></div>
          <div className="field"><span>Kiểu hình ảnh</span><SelectField ariaLabel="Kiểu hình ảnh quảng cáo" value={visualMode} onChange={(value) => setVisualMode(value as typeof visualMode)} options={[
            { value: 'local', label: 'Ảnh chuyển động nhẹ', description: 'Không tốn credit Flow; pan và zoom ảnh sản phẩm.' },
            { value: 'flow-image', label: 'Ảnh AI từ Flow', description: 'Nano Banana 2 tạo ảnh mới cho từng cảnh.' },
            { value: 'flow-video', label: 'Clip chuyển động AI', description: 'Flow Agent tạo video thật cho từng cảnh; có dùng credit.' },
          ]} /></div>
          {needsFlowAgent && <div className="product-veo-mode-note"><ShieldCheck size={15} /><span>{flowAgent?.connected ? useFlowAgentMotion ? `Flow Agent sẵn sàng · khoảng ${Math.ceil(targetDuration / 8)} lượt clip, chỉ gửi khi bạn bấm Tạo.` : 'Flow Agent sẵn sàng · Nano Banana 2 sẽ giữ hình dáng sản phẩm từ ảnh gốc.' : 'Flow Agent chưa kết nối. Mở Google Flow và tải lại tab trước khi dựng.'}</span></div>}
          <div className="field"><span>Yêu cầu bổ sung <small>· không bắt buộc</small></span><textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="Ví dụ: mở đầu bằng vấn đề điện thoại rơi khi xem phim trên giường…" /></div>
          {outputMode === 'render' && <label className="toggle-row compact"><input type="checkbox" checked={burnSubtitles} disabled={running} onChange={(event) => changeBurnSubtitles(event.target.checked)} /><i /><span>Đốt phụ đề tiếng Việt vào video</span></label>}
          {outputMode === 'render' && <details className="product-subtitle-editor" open>
            <summary><span>Tùy chỉnh phụ đề</span><small>Cỡ chữ · vị trí · màu · nền · xuống dòng</small></summary>
            <div className="product-subtitle-editor-body">
              <div className="product-subtitle-preview" aria-label="Xem trước kiểu phụ đề"><span style={{ top: `${subtitleStyle.positionPercent}%`, color: subtitleStyle.textColor, backgroundColor: `${subtitleStyle.backgroundColor}${Math.round(subtitleStyle.backgroundOpacity * 255).toString(16).padStart(2, '0')}`, fontSize: `${12 + (subtitleStyle.fontSize - 18) / 38 * 14}px`, WebkitTextStroke: `${Math.min(2, subtitleStyle.outlineWidth / 2)}px #101010`, textAlign: subtitleStyle.textAlign, fontWeight: subtitleStyle.bold ? 800 : 400 }}>{subtitleTexts[0] || 'Phụ đề sẽ được AutoSub thêm sau khi tạo video'}</span></div>
              <label><span>Cỡ chữ <b>{subtitleStyle.fontSize}</b></span><RangeInput min={18} max={56} step={1} value={subtitleStyle.fontSize} onChange={(event) => setSubtitleStyle((current) => ({ ...current, fontSize: Number(event.target.value) }))} /></label>
              <label><span>Vị trí dọc <b>{subtitleStyle.positionPercent}%</b></span><RangeInput min={12} max={90} step={1} value={subtitleStyle.positionPercent} onChange={(event) => setSubtitleStyle((current) => ({ ...current, positionPercent: Number(event.target.value) }))} /></label>
              <div className="product-subtitle-colors"><label><span>Màu chữ</span><input type="color" value={subtitleStyle.textColor} onChange={(event) => setSubtitleStyle((current) => ({ ...current, textColor: event.target.value.toUpperCase() }))} /></label><label><span>Màu nền</span><input type="color" value={subtitleStyle.backgroundColor} onChange={(event) => setSubtitleStyle((current) => ({ ...current, backgroundColor: event.target.value.toUpperCase() }))} /></label></div>
              <label><span>Độ đậm nền <b>{Math.round(subtitleStyle.backgroundOpacity * 100)}%</b></span><RangeInput min={0} max={0.9} step={0.05} value={subtitleStyle.backgroundOpacity} onChange={(event) => setSubtitleStyle((current) => ({ ...current, backgroundOpacity: Number(event.target.value) }))} /></label>
              <label><span>Độ dày viền <b>{subtitleStyle.outlineWidth}px</b></span><RangeInput min={0} max={6} step={1} value={subtitleStyle.outlineWidth} onChange={(event) => setSubtitleStyle((current) => ({ ...current, outlineWidth: Number(event.target.value) }))} /></label>
              <label><span>Ký tự mỗi dòng <b>{subtitleStyle.maxCharsPerLine}</b></span><RangeInput min={18} max={48} step={1} value={subtitleStyle.maxCharsPerLine} onChange={(event) => setSubtitleStyle((current) => ({ ...current, maxCharsPerLine: Number(event.target.value) }))} /></label>
              <div className="product-subtitle-align" aria-label="Căn lề phụ đề">{(['left', 'center', 'right'] as const).map((value) => <button type="button" key={value} aria-pressed={subtitleStyle.textAlign === value} onClick={() => setSubtitleStyle((current) => ({ ...current, textAlign: value }))}>{value === 'left' ? 'Trái' : value === 'right' ? 'Phải' : 'Giữa'}</button>)}</div>
              <label className="toggle-row compact"><input type="checkbox" checked={subtitleStyle.bold} onChange={(event) => setSubtitleStyle((current) => ({ ...current, bold: event.target.checked }))} /><i /><span>Chữ đậm</span></label>
              {job?.plan && <div className="product-subtitle-copy"><div><strong>Nội dung phụ đề từng cảnh</strong><small>Đổi chữ không làm thay đổi giọng đọc; để trống nếu muốn ẩn riêng cảnh đó.</small></div>{job.plan.scenes.map((scene, index) => <label key={scene.id}><span>{String(index + 1).padStart(2, '0')} · {scene.headline}</span><textarea value={subtitleTexts[index] ?? scene.narration} onChange={(event) => setSubtitleTexts((current) => { const next = [...current]; next[index] = event.target.value; return next; })} /></label>)}</div>}
              <button className="button small ghost" type="button" onClick={() => setSubtitleStyle(defaultSubtitleStyle)}>Đặt lại mặc định</button>
              <button className="button primary" type="button" disabled={running || job?.status !== 'completed' || !job.result} onClick={() => void applySubtitleStyle()}>Áp dụng vào video đã tạo</button>
              <small className="product-subtitle-reuse-note">Chỉ render lại chữ từ clip và voice đã lưu, không tạo ảnh/video AI và không tốn thêm credit Flow.</small>
            </div>
          </details>}
          <div className="review-safety-note"><ShieldCheck size={16} /><span>AI được yêu cầu không tự bịa giá, ưu đãi, trải nghiệm hoặc công dụng. Bạn vẫn cần duyệt lại kịch bản và giữ disclosure affiliate khi đăng.</span></div>
          <button type="submit" className="button primary large full" disabled={running || uploading || (needsFlowAgent && !flowAgent?.connected)}><WandSparkles size={16} /> {running ? 'Pipeline đang chạy…' : uploading ? 'Đang lưu ảnh…' : useFlowAgentMotion ? 'Tạo quảng cáo chuyển động AI' : useFlowAgentVisuals ? 'Tạo quảng cáo bằng ảnh Flow' : 'Tạo video quảng cáo'} <span>→</span></button>
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
            {job.result && <div className="review-result product-ad-video"><video controls playsInline preload="metadata" src={`${productAdVideoUrl(job.id)}?v=${encodeURIComponent(job.result.videoFile)}`} /><div className="review-result-meta"><div><span>Thời lượng</span><strong>{formatDuration(job.result.durationMs)}</strong></div><div><span>Số cảnh</span><strong>{job.plan?.scenes.length || 0}</strong></div><a className="button" href={productAdSubtitleUrl(job.id)}><Download size={14} /> Tải SRT</a><a className="button primary" href={productAdVideoUrl(job.id, true)}><Download size={14} /> Tải MP4</a></div></div>}
            {job.status === 'completed' && job.veo3Pack && <section className="product-veo-pack"><div className="product-veo-pack-heading"><div><strong>{job.veo3Pack.clips.length} prompt Veo 3 · {job.veo3Pack.totalDurationSeconds} giây</strong><small>Mỗi clip tối đa {job.veo3Pack.clipLimitSeconds} giây · 4 micro-shot · chữ và voice hậu kỳ · khung {job.veo3Pack.aspectRatio}</small></div><div><button type="button" className="button primary small" disabled={starting} onClick={() => void createFlowPreview()}>{starting ? 'Flow đang tạo…' : 'Tạo thử video Flow 4s'}</button> <button type="button" className="button small" onClick={() => void copyVeoPrompts()}>Sao chép toàn bộ</button></div></div><div className="product-veo-prompt-list">{job.veo3Pack.clips.map((clip) => <article key={clip.id}><header><span>CLIP {String(clip.index).padStart(2, '0')}</span><strong>{clip.durationSeconds} giây</strong><small>{clip.startSeconds}s → {clip.endSeconds}s · Ảnh {clip.imageIndex + 1}</small></header><pre>{clip.prompt}</pre><button type="button" className="button small ghost" onClick={() => void copyVeoPrompts(clip.prompt)}>Sao chép prompt này</button></article>)}</div></section>}
            {job.plan && <details className="review-plan" open={job.status === 'completed'}><summary>Kịch bản, caption và danh sách cảnh</summary><div className="review-plan-heading"><strong>{job.plan.title}</strong><p>{job.plan.caption}</p><p><b>Disclosure:</b> {job.plan.disclosure}</p><p>{job.plan.hashtags.join(' ')}</p><button type="button" className="button small ghost product-caption-copy" onClick={() => void copyCaption()}>Sao chép caption</button></div><div className="product-ad-scene-list">{job.plan.scenes.map((scene, index) => <article key={scene.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{scene.headline}</strong><p>{scene.narration}</p></div><small>Ảnh {scene.imageIndex + 1}</small></article>)}</div></details>}
            {job.warnings.length > 0 && <div className="product-ad-warning-list">{job.warnings.map((warning) => <p key={warning}><ShieldCheck size={13} /> {warning}</p>)}</div>}
          </>}
        </section>
      </div>
    </form>
  </div>;
}
