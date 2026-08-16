import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AIProvider, AIVoice, AppSettings, ProviderAssignment, ReviewAspectRatio, ReviewJobStatus, VideoAsset } from '../types';
import { api, friendlyErrorMessage, MAX_BROWSER_UPLOAD_BYTES, reviewVideoUrl } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import { resolvedProviderType } from '../lib/providers';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { SelectField } from '../components/SelectField';
import { RangeInput } from '../components/RangeInput';
import { Check, CirclePlay, FileVideo, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Upload, WandSparkles, X } from '../components/Icons';

type YouTubeConnection = { connected: boolean; channelId?: string; channelTitle?: string; error?: string };
type MediaAction = 'idle' | 'uploading' | 'picking';

const reviewJobStorageKey = 'autosub.review-job-id';
const activeReviewStates = new Set<ReviewJobStatus['status']>(['queued', 'transcribing', 'scripting', 'voicing', 'rendering']);
const activeYouTubeStates = new Set(['uploading', 'processing']);

const formatDuration = (milliseconds?: number) => {
  if (!milliseconds) return '—';
  const total = Math.round(milliseconds / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const formatTargetDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining ? `${minutes} phút ${remaining} giây` : `${minutes} phút`;
};

const youtubeStateLabel: Record<ReviewJobStatus['youtube']['state'], string> = {
  idle: 'Chưa tải lên',
  uploading: 'Đang tải riêng tư',
  processing: 'YouTube đang xử lý',
  manual_check_required: 'Cần xác nhận trong Studio',
  passed: 'Không thấy claim khi kiểm tra',
  claimed: 'Đã phát hiện claim',
  rejected: 'YouTube từ chối video',
  failed: 'Kiểm tra thất bại',
};

export function ReviewPage({ providers, settings, initialAsset, onAssetChange, onNotice }: {
  providers: AIProvider[];
  settings: AppSettings;
  initialAsset?: VideoAsset;
  onAssetChange: (asset?: VideoAsset) => void;
  onNotice: (message: string, kind?: 'success' | 'error') => void;
}) {
  const [asset, setAsset] = useState<VideoAsset | undefined>(initialAsset);
  const [mediaAction, setMediaAction] = useState<MediaAction>('idle');
  const [sttAssignment, setSttAssignment] = useState<ProviderAssignment>(settings.assignments.stt);
  const [visionAssignment, setVisionAssignment] = useState<ProviderAssignment>(settings.assignments.vision);
  const [scriptAssignment, setScriptAssignment] = useState<ProviderAssignment>(settings.assignments.translation);
  const [ttsAssignment, setTtsAssignment] = useState<ProviderAssignment>(settings.assignments.tts);
  const [sourceLanguage, setSourceLanguage] = useState('zh');
  const [movieTitle, setMovieTitle] = useState('');
  const [characterGuide, setCharacterGuide] = useState('');
  const [tone, setTone] = useState('Kể chuyện tự nhiên, nhanh gọn, tập trung cốt truyện');
  const [customPrompt, setCustomPrompt] = useState('');
  const [targetDuration, setTargetDuration] = useState(24 * 60);
  const [aspectRatio, setAspectRatio] = useState<ReviewAspectRatio>('original');
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [voice, setVoice] = useState('');
  const [voiceSpeed, setVoiceSpeed] = useState(1.15);
  const [testingVoice, setTestingVoice] = useState(false);
  const [cloneVoices, setCloneVoices] = useState<AIVoice[]>([]);
  const [job, setJob] = useState<ReviewJobStatus>();
  const [youtube, setYoutube] = useState<YouTubeConnection>({ connected: false });
  const [youtubeClientId, setYoutubeClientId] = useState('');
  const [youtubeClientSecret, setYoutubeClientSecret] = useState('');
  const [youtubeWorking, setYoutubeWorking] = useState(false);
  const uploadControllerRef = useRef<AbortController | undefined>(undefined);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewUrlRef = useRef<string | null>(null);
  const voicePreviewRequestRef = useRef(0);

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

  const sttProvider = providers.find((item) => item.id === sttAssignment.providerId);
  const visionProvider = providers.find((item) => item.id === visionAssignment.providerId);
  const scriptProvider = providers.find((item) => item.id === scriptAssignment.providerId);
  const ttsProvider = providers.find((item) => item.id === ttsAssignment.providerId);
  const ttsProviderType = ttsProvider ? resolvedProviderType(ttsProvider) : undefined;
  const voiceItems = useMemo(() => ttsProviderType === 'vieneu-local' ? cloneVoices : ttsProviderType === 'hiiu-tts'
    ? (ttsProvider?.models || []).map((model) => ({ id: model.id, name: model.name || model.id, language: '' }))
    : ttsProvider?.voices || [], [cloneVoices, ttsProvider, ttsProviderType]);

  useEffect(() => { setAsset(initialAsset); }, [initialAsset?.uploadId]);
  useEffect(() => () => {
    uploadControllerRef.current?.abort();
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
    void api.listVieneuVoiceClones(controller.signal).then((result) => {
      setCloneVoices(result.voices);
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) onNotice(friendlyErrorMessage(error, 'Không thể tải danh sách giọng clone.'), 'error');
    });
    return () => controller.abort();
  }, [ttsProviderType]);

  useEffect(() => {
    void api.youtubeStatus().then(setYoutube).catch((error) => setYoutube({ connected: false, error: friendlyErrorMessage(error) }));
    const savedId = localStorage.getItem(reviewJobStorageKey);
    if (savedId) void api.getReviewJob(savedId).then(setJob).catch(() => localStorage.removeItem(reviewJobStorageKey));
  }, []);

  useEffect(() => {
    if (!job || (!activeReviewStates.has(job.status) && !activeYouTubeStates.has(job.youtube.state))) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void api.getReviewJob(job.id, controller.signal).then(setJob).catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) onNotice(friendlyErrorMessage(error, 'Không thể cập nhật review job.'), 'error');
      });
    }, activeReviewStates.has(job.status) ? 1_500 : 4_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [job?.id, job?.status, job?.youtube.state]);

  const selectFile = (file?: File) => {
    if (!file) return;
    if (file.size > MAX_BROWSER_UPLOAD_BYTES) { onNotice('File lớn hơn 4 GiB. Hãy dùng “Mở file lớn trên máy”.', 'error'); return; }
    uploadControllerRef.current?.abort();
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    const nextAsset: VideoAsset = { name: file.name, url: URL.createObjectURL(file), type: file.type, file, size: file.size };
    setAsset(nextAsset);
    setMediaAction('uploading');
    void api.uploadMedia(file, controller.signal).then((stored) => {
      const uploaded = { ...nextAsset, uploadId: stored.uploadId, storedPath: stored.storedPath, path: stored.storedPath, sourceMode: stored.sourceMode || 'copied' as const };
      setAsset(uploaded);
      onAssetChange(uploaded);
      onNotice('Đã lưu video nguồn trên máy.');
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) onNotice(friendlyErrorMessage(error, 'Không thể lưu video nguồn.'), 'error');
    }).finally(() => setMediaAction('idle'));
  };

  const importLocalFile = async () => {
    setMediaAction('picking');
    try {
      const result = await api.importLocalMedia('video');
      if ('cancelled' in result) return;
      const next: VideoAsset = { name: result.filename, url: `/api/uploads/${encodeURIComponent(result.uploadId)}/media`, type: result.contentType, uploadId: result.uploadId, storedPath: result.storedPath, path: result.storedPath, size: result.size, sourceMode: result.sourceMode || 'linked' };
      setAsset(next);
      onAssetChange(next);
      onNotice('Đã liên kết video local.');
    } catch (error) {
      onNotice(friendlyErrorMessage(error, 'Không thể mở video local.'), 'error');
    } finally { setMediaAction('idle'); }
  };

  const clearFile = () => {
    uploadControllerRef.current?.abort();
    if (asset?.uploadId) void api.deleteUpload(asset.uploadId).catch(() => undefined);
    setAsset(undefined);
    onAssetChange(undefined);
  };

  const testVoice = async () => {
    if (!ttsProvider || !ttsAssignment.model || !voice) { onNotice('Hãy chọn đủ TTS Provider, model và voice.', 'error'); return; }
    stopVoicePreview();
    const requestId = voicePreviewRequestRef.current;
    setTestingVoice(true);
    try {
      const blob = await api.testVoice(ttsProvider, ttsAssignment.model, voice, voiceSpeed, 'Đây là bản thử giọng cho video review của AutoSub.');
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
      if (requestId === voicePreviewRequestRef.current) {
        setTestingVoice(false);
        stopVoicePreview();
        onNotice(friendlyErrorMessage(error, 'Không thể thử giọng.'), 'error');
      }
    } finally {
      if (requestId === voicePreviewRequestRef.current) setTestingVoice(false);
    }
  };

  const startJob = async () => {
    if (!asset?.uploadId) { onNotice('Hãy chọn video và chờ lưu xong trước.', 'error'); return; }
    if (!sttProvider || !visionProvider || !scriptProvider || !ttsProvider || !sttAssignment.model || !visionAssignment.model || !scriptAssignment.model || !ttsAssignment.model) { onNotice('Cấu hình STT, Vision, Script hoặc TTS còn thiếu.', 'error'); return; }
    if (!voice) { onNotice('Hãy chọn Voice ID cho phần lồng tiếng.', 'error'); return; }
    try {
      const created = await api.createReviewJob({
        uploadId: asset.uploadId,
        sourceLanguage,
        movieTitle,
        characterGuide,
        targetDurationSeconds: targetDuration,
        tone,
        customPrompt,
        aspectRatio,
        burnSubtitles,
        stt: { provider: sttProvider, model: sttAssignment.model },
        vision: { provider: visionProvider, model: visionAssignment.model },
        script: { provider: scriptProvider, model: scriptAssignment.model },
        tts: { provider: ttsProvider, model: ttsAssignment.model, voice, speed: voiceSpeed },
      });
      localStorage.setItem(reviewJobStorageKey, created.id);
      setJob(created);
      onNotice('Đã bắt đầu dựng video review tự động.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tạo review job.'), 'error'); }
  };

  const cancelJob = async () => {
    if (!job) return;
    try { setJob(await api.cancelReviewJob(job.id)); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể hủy job.'), 'error'); }
  };

  const readGoogleCredentials = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { installed?: { client_id?: string; client_secret?: string }; web?: { client_id?: string; client_secret?: string } };
      const credentials = parsed.installed || parsed.web;
      if (!credentials?.client_id || !credentials.client_secret) throw new Error('File không có client_id/client_secret.');
      setYoutubeClientId(credentials.client_id);
      setYoutubeClientSecret(credentials.client_secret);
      onNotice('Đã đọc Google OAuth credentials.');
    } catch (error) { onNotice(friendlyErrorMessage(error, 'File OAuth JSON không hợp lệ.'), 'error'); }
  };

  const connectYouTube = async () => {
    setYoutubeWorking(true);
    try {
      const result = await api.connectYouTube(youtubeClientId, youtubeClientSecret);
      window.open(result.authUrl, 'autosub-youtube-oauth', 'popup,width=620,height=760');
      const started = Date.now();
      const timer = window.setInterval(() => {
        void api.youtubeStatus().then((status) => {
          setYoutube(status);
          if (status.connected || Date.now() - started > 120_000) { window.clearInterval(timer); setYoutubeWorking(false); }
        }).catch(() => undefined);
      }, 2_000);
    } catch (error) {
      setYoutubeWorking(false);
      onNotice(friendlyErrorMessage(error, 'Không thể kết nối YouTube.'), 'error');
    }
  };

  const uploadToYouTube = async () => {
    if (!job) return;
    setYoutubeWorking(true);
    try { setJob(await api.uploadReviewToYouTube(job.id)); onNotice('Đang tải video riêng tư lên kênh test.'); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể tải lên YouTube.'), 'error'); }
    finally { setYoutubeWorking(false); }
  };

  const refreshYouTube = async () => {
    if (!job) return;
    setYoutubeWorking(true);
    try { setJob(await api.refreshReviewYouTube(job.id)); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể cập nhật trạng thái YouTube.'), 'error'); }
    finally { setYoutubeWorking(false); }
  };

  const markYouTube = async (decision: 'passed' | 'claimed') => {
    if (!job) return;
    try { setJob(await api.markReviewYouTube(job.id, decision)); }
    catch (error) { onNotice(friendlyErrorMessage(error, 'Không thể lưu kết quả kiểm tra.'), 'error'); }
  };

  const running = Boolean(job && activeReviewStates.has(job.status));
  const youtubeNeedsManualCheck = job?.youtube.state === 'manual_check_required';

  return <div className="page review-page">
    <header className="page-header"><div><span className="eyebrow">AI REVIEW PIPELINE</span><h1>Review phim <span>tự động</span></h1><p>Viết kịch bản mới, cắt cảnh, lồng tiếng và tải riêng tư lên kênh test.</p></div><div className="review-header-badge"><ShieldCheck size={17} /><span><strong>Có bước duyệt thủ công</strong><small>Không tự kết luận “sạch bản quyền”</small></span></div></header>

    <section className="review-grid">
      <div className="review-config-column">
        <section className="review-panel">
          <div className="section-title"><span>01 · VIDEO NGUỒN</span><small>{asset?.uploadId ? 'Sẵn sàng' : mediaAction === 'uploading' ? 'Đang lưu' : 'Chưa chọn'}</small></div>
          <label className={`dropzone compact ${asset ? 'loaded' : ''}`}><input type="file" accept="video/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; selectFile(file); }} />{asset ? <><div className="file-icon"><FileVideo size={18} /></div><div><strong>{asset.name}</strong><small>{asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB · ` : ''}<button type="button" onClick={(event) => { event.preventDefault(); clearFile(); }}>Đổi file</button></small></div><span className="replace-file">Đã chọn</span></> : <><div className="upload-icon"><Upload size={19} /></div><div><strong>Thả video phim gốc vào đây</strong><small>MP4 · MOV · MKV</small></div></>}</label>
          <button className="button small ghost review-local-button" disabled={mediaAction !== 'idle'} onClick={() => void importLocalFile()}><FileVideo size={14} /> {mediaAction === 'picking' ? 'Đang chọn file…' : 'Mở file lớn trên máy'}</button>
        </section>

        <section className="review-panel">
          <div className="section-title"><span>02 · AI PIPELINE</span><small>STT + Vision → Script → TTS</small></div>
          <CapabilityAssignmentPicker capability="stt" assignments={capabilityAssignments(settings, 'stt')} providers={providers} value={sttAssignment} onChange={setSttAssignment} label="STT · nhận dạng lời Trung" />
          <AssignmentSummary label="STT đang dùng" assignment={sttAssignment} provider={sttProvider} capability="stt" />
          <CapabilityAssignmentPicker capability="vision" assignments={capabilityAssignments(settings, 'vision')} providers={providers} value={visionAssignment} onChange={setVisionAssignment} label="Vision · xem cảnh và tìm nhân vật chính" />
          <AssignmentSummary label="Vision đang dùng" assignment={visionAssignment} provider={visionProvider} capability="vision" />
          <CapabilityAssignmentPicker capability="translation" assignments={capabilityAssignments(settings, 'translation')} providers={providers} value={scriptAssignment} onChange={setScriptAssignment} label="Script · viết bài review Việt" />
          <AssignmentSummary label="Script AI đang dùng" assignment={scriptAssignment} provider={scriptProvider} capability="translation" />
          <CapabilityAssignmentPicker capability="tts" assignments={capabilityAssignments(settings, 'tts')} providers={providers} value={ttsAssignment} onChange={setTtsAssignment} label="TTS · giọng đọc tiếng Việt" />
          <AssignmentSummary label="TTS đang dùng" assignment={ttsAssignment} provider={ttsProvider} capability="tts" />
          <div className="field"><span>Voice</span>{voiceItems.length ? <SelectField ariaLabel="Voice lồng tiếng" value={voice} onChange={setVoice} options={voiceItems.map((item) => ({ value: item.id, label: item.name || item.id, description: `${item.id}${item.language ? ` · ${item.language}` : ''}` }))} /> : <input value={voice} onChange={(event) => setVoice(event.target.value)} placeholder={ttsProviderType === 'vieneu-local' ? 'Chưa có giọng · tạo ở mục Clone giọng' : 'Ví dụ: alloy hoặc Voice ID'} readOnly={ttsProviderType === 'vieneu-local'} />}</div>
          {ttsProviderType === 'vieneu-local' && !voiceItems.length && <div className="review-safety-note"><ShieldCheck size={15} /><span>Chưa có hồ sơ VieNeu. Mở mục Clone giọng ở thanh bên, tạo mẫu rồi quay lại đây.</span></div>}
          <div className="review-voice-row"><div className="field"><span>Tốc độ <b className="value-badge">{voiceSpeed.toFixed(2)}×</b></span><RangeInput min={0.9} max={1.5} step={0.05} value={voiceSpeed} onChange={(event) => setVoiceSpeed(Number(event.target.value))} /><small className="field-help">Mặc định 1.15× cho nhịp kể gọn hơn; pipeline đo chính giọng đã chọn trước khi viết kịch bản.</small></div><button className="button ghost" disabled={testingVoice} onClick={() => void testVoice()}>{testingVoice ? <LoaderCircle size={15} className="spin" /> : <CirclePlay size={15} />} Nghe thử</button></div>
        </section>

        <section className="review-panel">
          <div className="section-title"><span>03 · PHONG CÁCH DỰNG</span><small>Ưu tiên tóm tắt cốt truyện</small></div>
          <div className="field-grid"><div className="field"><span>Ngôn ngữ nguồn</span><SelectField ariaLabel="Ngôn ngữ nguồn" value={sourceLanguage} onChange={setSourceLanguage} options={[{ value: 'zh', label: 'Tiếng Trung' }, { value: 'en', label: 'Tiếng Anh' }, { value: 'auto', label: 'Tự nhận diện' }]} /></div><div className="field"><span>Tỉ lệ khung hình</span><SelectField ariaLabel="Tỉ lệ khung hình" value={aspectRatio} onChange={(value) => setAspectRatio(value as ReviewAspectRatio)} options={[{ value: 'original', label: 'Giữ tỉ lệ · tối đa 1080p' }, { value: '9:16', label: 'Dọc 9:16' }, { value: '16:9', label: 'Ngang 16:9' }]} /></div></div>
          <div className="field"><span>Tên phim <small>· không bắt buộc, chỉ sửa khi AI nhận sai</small></span><input value={movieTitle} onChange={(event) => setMovieTitle(event.target.value)} placeholder="Để trống để AI tự xác định từ hình ảnh và lời thoại" /></div>
          <div className="field"><span>Tên nhân vật và quan hệ <small>· không bắt buộc</small></span><textarea value={characterGuide} onChange={(event) => setCharacterGuide(event.target.value)} placeholder="Chỉ nhập nếu muốn sửa tên AI phiên âm sai" /></div>
          <div className="field"><span>Giọng văn</span><SelectField ariaLabel="Giọng văn" value={tone} onChange={setTone} options={['Kể chuyện tự nhiên, nhanh gọn, tập trung cốt truyện', 'Kịch tính, giàu cảm xúc nhưng không khoa trương', 'Hài hước, nhanh và dễ nghe', 'Điềm tĩnh, rõ ràng, rất ít bình luận'].map((value) => ({ value, label: value }))} /></div>
          <div className="field"><span>Thời lượng mục tiêu <b className="value-badge">{formatTargetDuration(targetDuration)}</b></span><RangeInput min={300} max={2700} step={60} value={targetDuration} onChange={(event) => setTargetDuration(Number(event.target.value))} /><small className="field-help">Pipeline đo thời lượng giọng thật, tự viết lại nếu thiếu nhiều và chỉ render khi đã bám sát mốc này.</small></div>
          <div className="field"><span>Yêu cầu thêm <small>· không bắt buộc</small></span><textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="Ví dụ: tập trung vào diễn xuất, tránh spoil đoạn kết…" /></div>
          <label className="toggle-row compact"><input type="checkbox" checked={burnSubtitles} onChange={(event) => setBurnSubtitles(event.target.checked)} /><i /><span>Đốt phụ đề tiếng Việt vào video</span></label>
          <div className="review-safety-note"><ShieldCheck size={16} /><span>AutoSub dùng đoạn hình để minh họa cho bài bình luận mới. Hệ thống không lật hình, tăng tốc hay cắt vụn nhằm né Content ID.</span></div>
          <button className="button primary large full" disabled={running || mediaAction !== 'idle'} onClick={() => void startJob()}><WandSparkles size={16} /> {running ? 'Pipeline đang chạy…' : 'Tạo video review'} <span>→</span></button>
        </section>
      </div>

      <div className="review-result-column">
        <section className="review-panel review-job-panel">
          <div className="section-title"><span>TIẾN TRÌNH</span><small>{job ? `JOB ${job.id.slice(0, 8)}` : 'Chưa có job'}</small></div>
          {!job ? <div className="review-empty"><WandSparkles size={28} /><strong>Video hoàn chỉnh sẽ xuất hiện ở đây</strong><small>Chọn video và cấu hình ba provider để bắt đầu.</small></div> : <>
            <div className={`review-status ${job.status}`}><span>{activeReviewStates.has(job.status) && <LoaderCircle size={16} className="spin" />}{job.status === 'completed' && <Check size={16} />}{['failed', 'cancelled'].includes(job.status) && <X size={16} />}</span><div><strong>{job.stage}</strong><small>{job.error || job.warnings.at(-1)}</small></div><b>{job.progressPercent}%</b></div>
            <div className="progress-track review-progress"><div style={{ width: `${job.progressPercent}%` }} /></div>
            {running && <button className="button small ghost danger review-cancel" onClick={() => void cancelJob()}><X size={14} /> Hủy job</button>}
            {job.status === 'completed' && <div className="review-result"><video controls preload="metadata" src={reviewVideoUrl(job.id)} /><div className="review-result-meta"><div><span>Thời lượng</span><strong>{formatDuration(job.result?.durationMs)}</strong></div><div><span>Số cảnh</span><strong>{job.plan?.segments.length || 0}</strong></div><a className="button primary" href={reviewVideoUrl(job.id, true)}>Tải MP4</a></div></div>}
            {job.plan && <details className="review-plan" open={job.status === 'completed'}><summary>Kịch bản và danh sách cảnh</summary><div className="review-plan-heading"><strong>{job.plan.title}</strong>{job.plan.movieTitle && <p><b>Phim:</b> {job.plan.movieTitle}</p>}<p>{job.plan.description}</p>{job.plan.characters?.length ? <p><b>Nhân vật:</b> {job.plan.characters.map((character) => `${character.name} – ${character.role}`).join('; ')}</p> : null}{job.plan.lesson && <p><b>Ghi chú cuối:</b> {job.plan.lesson}</p>}</div><div className="review-segment-list">{job.plan.segments.map((segment, index) => <div key={segment.id}><span>{String(index + 1).padStart(2, '0')}</span><p>{segment.narration}</p><small>{formatDuration(segment.sourceStartMs)} → {formatDuration(segment.sourceEndMs)}</small></div>)}</div></details>}
          </>}
        </section>

        <section className="review-panel youtube-panel">
          <div className="section-title"><span>YOUTUBE TEST</span><small>Luôn tải ở chế độ Private</small></div>
          {youtube.connected ? <div className="youtube-connected"><div><span className="status-dot" /><strong>{youtube.channelTitle || 'Đã kết nối YouTube'}</strong><small>{youtube.channelId || 'OAuth hoạt động'}</small></div><button className="button small ghost" onClick={() => void api.disconnectYouTube().then(() => setYoutube({ connected: false }))}>Ngắt kết nối</button></div> : <div className="youtube-connect-form">
            <p>Tải file OAuth Desktop app JSON từ Google Cloud, hoặc nhập Client ID và Client Secret.</p>
            <label className="button ghost youtube-json-button"><Upload size={14} /> Chọn OAuth JSON<input type="file" accept="application/json,.json" onChange={(event) => { void readGoogleCredentials(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
            <div className="field"><span>Google OAuth Client ID</span><input value={youtubeClientId} onChange={(event) => setYoutubeClientId(event.target.value)} placeholder="….apps.googleusercontent.com" /></div>
            <div className="field"><span>Client Secret</span><input type="password" value={youtubeClientSecret} onChange={(event) => setYoutubeClientSecret(event.target.value)} placeholder="GOCSPX-…" /></div>
            <button className="button secondary full" disabled={youtubeWorking || !youtubeClientId || !youtubeClientSecret} onClick={() => void connectYouTube()}><LockKeyhole size={15} /> {youtubeWorking ? 'Đang chờ Google…' : 'Kết nối kênh test'}</button>
            {youtube.error && <small className="youtube-error">{youtube.error}</small>}
          </div>}

          {job?.status === 'completed' && youtube.connected && <div className={`youtube-check-state ${job.youtube.state}`}><div className="youtube-state-head"><span><LockKeyhole size={15} /></span><div><strong>{youtubeStateLabel[job.youtube.state]}</strong><small>{job.youtube.rejectionReason ? `Lý do: ${job.youtube.rejectionReason}` : job.youtube.error || 'Video không bao giờ được tự chuyển sang Public.'}</small></div></div>
            {job.youtube.state === 'idle' && <button className="button primary full" disabled={youtubeWorking} onClick={() => void uploadToYouTube()}><Upload size={15} /> Tải Private & kiểm tra ban đầu</button>}
            {activeYouTubeStates.has(job.youtube.state) && <div className="youtube-processing"><LoaderCircle size={16} className="spin" /><span>YouTube đang upload/xử lý. Có thể tiếp tục dùng app.</span></div>}
            {job.youtube.videoId && <div className="youtube-actions"><a className="button secondary" href={job.youtube.studioUrl} target="_blank" rel="noreferrer">Mở YouTube Studio</a><button className="button ghost" disabled={youtubeWorking} onClick={() => void refreshYouTube()}><RefreshCw size={14} /> Làm mới</button></div>}
            {youtubeNeedsManualCheck && <div className="youtube-manual"><p>API không đọc được chi tiết Content ID. Mở Studio → Restrictions/Checks, rồi xác nhận kết quả tại đây.</p><div><button className="button ghost" onClick={() => void markYouTube('claimed')}><X size={14} /> Có claim</button><button className="button secondary" onClick={() => void markYouTube('passed')}><Check size={14} /> Không thấy claim</button></div></div>}
            {job.youtube.blockedRegions && job.youtube.blockedRegions.length > 0 && <small className="youtube-warning">Bị hạn chế tại {job.youtube.blockedRegions.length} khu vực. Hãy kiểm tra chi tiết trong Studio.</small>}
          </div>}
          <div className="youtube-limit-note"><ShieldCheck size={15} /><span>“Không thấy claim” chỉ là kết quả tại thời điểm kiểm tra, không phải giấy phép sử dụng hay bảo đảm video sẽ không bị khiếu nại sau này.</span></div>
        </section>
      </div>
    </section>
  </div>;
}
