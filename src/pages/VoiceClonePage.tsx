import { useEffect, useMemo, useRef, useState } from 'react';
import type { AIProvider, AIVoice, AppSettings, VoiceCloneProfile } from '../types';
import { api, friendlyErrorMessage } from '../lib/api';
import { capabilityAssignments } from '../lib/settings';
import { resolvedProviderType } from '../lib/providers';
import { RangeInput } from '../components/RangeInput';
import { AudioLines, Check, CirclePlay, Cpu, Download, FileAudio, LoaderCircle, Pause, Play, RefreshCw, ShieldCheck, Trash2, Upload, Volume2 } from '../components/Icons';

const modelId = 'vieneu-v3-turbo';

const formatDuration = (durationMs: number) => `${(durationMs / 1000).toFixed(1)} giây`;
const formatPlaybackTime = (value: number) => {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const formatCreatedAt = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
};

export function VoiceClonePage({ providers, settings, onVoicesChange, onEnableForTts, onOpenEditor, onNotice }: {
  providers: AIProvider[];
  settings: AppSettings;
  onVoicesChange: (voices: AIVoice[]) => void;
  onEnableForTts: () => void;
  onOpenEditor: () => void;
  onNotice: (message: string, kind?: 'success' | 'error') => void;
}) {
  const [profiles, setProfiles] = useState<VoiceCloneProfile[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [previewText, setPreviewText] = useState('Xin chào, đây là bản thử giọng lồng tiếng tiếng Việt của AutoSub.');
  const [speed, setSpeed] = useState(1.1);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string | undefined>(undefined);
  const provider = providers.find((item) => resolvedProviderType(item) === 'vieneu-local');
  const ttsEnabled = capabilityAssignments(settings, 'tts').some((item) => item.providerId === provider?.id && item.model === modelId);
  const selectedProfile = useMemo(() => profiles.find((item) => item.id === selectedId), [profiles, selectedId]);

  const replaceProfiles = (nextProfiles: VoiceCloneProfile[], voices: AIVoice[]) => {
    setProfiles(nextProfiles);
    onVoicesChange(voices);
    setSelectedId((current) => nextProfiles.some((item) => item.id === current) ? current : nextProfiles[0]?.id || '');
  };

  const loadProfiles = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await api.listVieneuVoiceClones(signal);
      replaceProfiles(result.profiles, result.voices);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) onNotice(friendlyErrorMessage(error, 'Không thể tải danh sách giọng clone.'), 'error');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void loadProfiles(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  useEffect(() => {
    setPreviewPlaying(false);
    setPreviewTime(0);
    setPreviewDuration(0);
  }, [previewUrl]);

  const createClone = async () => {
    if (!name.trim()) { onNotice('Hãy đặt tên cho giọng clone.', 'error'); return; }
    if (!file) { onNotice('Hãy chọn mẫu giọng sạch dài khoảng 3 đến 8 giây.', 'error'); return; }
    if (!consent) { onNotice('Bạn cần xác nhận quyền sử dụng giọng trước khi clone.', 'error'); return; }
    setCreating(true);
    try {
      const created = await api.createVieneuVoiceClone(name.trim(), file, consent);
      const nextProfiles = [created.profile, ...profiles.filter((item) => item.id !== created.profile.id)];
      replaceProfiles(nextProfiles, [created.voice, ...nextProfiles.filter((item) => item.id !== created.profile.id).map((item) => ({ id: item.id, name: item.name, language: item.language }))]);
      setSelectedId(created.profile.id);
      setName('');
      setFile(undefined);
      setConsent(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onEnableForTts();
      onNotice('Đã tạo giọng clone và thêm VieNeu vào danh sách TTS lồng tiếng.', 'success');
    } catch (error) {
      onNotice(friendlyErrorMessage(error, 'Không thể tạo giọng clone.'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const deleteClone = async (profile: VoiceCloneProfile) => {
    if (!window.confirm(`Xóa giọng “${profile.name}” khỏi máy?`)) return;
    setDeletingId(profile.id);
    try {
      await api.deleteVieneuVoiceClone(profile.id);
      const nextProfiles = profiles.filter((item) => item.id !== profile.id);
      replaceProfiles(nextProfiles, nextProfiles.map((item) => ({ id: item.id, name: item.name, language: item.language })));
      if (selectedId === profile.id && audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = undefined;
        setPreviewUrl(undefined);
      }
      onNotice('Đã xóa hồ sơ giọng clone.', 'success');
    } catch (error) {
      onNotice(friendlyErrorMessage(error, 'Không thể xóa giọng clone.'), 'error');
    } finally {
      setDeletingId(undefined);
    }
  };

  const testVoice = async () => {
    if (!provider) { onNotice('Không tìm thấy provider VieNeu Local.', 'error'); return; }
    if (!selectedId) { onNotice('Hãy chọn một giọng clone để nghe thử.', 'error'); return; }
    if (!previewText.trim()) { onNotice('Hãy nhập câu cần đọc thử.', 'error'); return; }
    setTesting(true);
    try {
      const blob = await api.testVoice(provider, modelId, selectedId, speed, previewText.trim());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setPreviewUrl(url);
      onNotice('Đã dựng xong bản thử giọng.', 'success');
    } catch (error) {
      onNotice(friendlyErrorMessage(error, 'Không thể tạo bản thử giọng.'), 'error');
    } finally {
      setTesting(false);
    }
  };

  const enableForDubbing = () => {
    onEnableForTts();
    onNotice(ttsEnabled ? 'VieNeu đã có trong danh sách TTS.' : 'Đã thêm VieNeu vào bộ chọn TTS của Review và Lồng tiếng video.', 'success');
  };

  const togglePreviewPlayback = () => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration) audio.currentTime = 0;
      void audio.play().catch(() => setPreviewPlaying(false));
    } else {
      audio.pause();
    }
  };

  const seekPreview = (nextTime: number) => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.currentTime = nextTime;
    setPreviewTime(nextTime);
  };

  return <div className="page voice-clone-page">
    <header className="page-header voice-clone-page-header"><div><span className="eyebrow">LOCAL VOICE STUDIO</span><h1>Clone <span>giọng nói</span></h1><p>Tạo giọng Việt cục bộ một lần, sau đó dùng lại cho Review và Lồng tiếng video.</p></div><div className="voice-clone-runtime"><Cpu size={17} /><span><strong>VieNeu v3 Turbo</strong><small>CPU + ONNX · không API key</small></span></div></header>

    <div className="voice-clone-workbench">
      <section className="voice-clone-card voice-clone-create-card">
        <div className="section-title"><span>01 · TẠO HỒ SƠ GIỌNG</span><small>Mẫu sạch 3 đến 8 giây</small></div>
        <div className="field"><span>Tên giọng</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Giọng kể của tôi" /></div>
        <label className={`voice-clone-dropzone ${file ? 'loaded' : ''}`}>
          <input ref={fileInputRef} type="file" accept="audio/*,video/*" onChange={(event) => setFile(event.currentTarget.files?.[0])} />
          <span className="voice-clone-file-icon">{file ? <Check size={19} /> : <FileAudio size={19} />}</span>
          <span><strong>{file?.name || 'Chọn file mẫu giọng'}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · sẵn sàng xử lý` : 'Audio hoặc video · tối đa 25 MB'}</small></span>
          <b>{file ? 'Đổi file' : 'Duyệt file'}</b>
        </label>
        <div className="voice-clone-sample-guide"><span><b>01</b>Một người nói</span><span><b>02</b>Không nhạc nền</span><span><b>03</b>Âm lượng rõ</span></div>
        <label className="voice-clone-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Tôi sở hữu giọng này hoặc đã được người nói cho phép dùng để tạo giọng tổng hợp.</span></label>
        <button type="button" className="button primary large full" disabled={creating || !name.trim() || !file || !consent} onClick={() => void createClone()}>{creating ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />} {creating ? 'Đang chuẩn hóa mẫu...' : 'Tạo giọng clone'}</button>
        <div className="voice-clone-warning"><ShieldCheck size={15} /><span>Chỉ clone giọng có sự đồng ý. Nếu dùng giọng của người khác, hãy khai báo nội dung tổng hợp khi nền tảng yêu cầu.</span></div>
      </section>

      <section className="voice-clone-card voice-clone-library-card">
        <div className="section-title"><span>02 · THƯ VIỆN GIỌNG</span><button type="button" className="icon-button" title="Tải lại danh sách" disabled={loading} onClick={() => void loadProfiles()}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
        {loading ? <div className="voice-clone-empty"><LoaderCircle size={25} className="spin" /><strong>Đang tải thư viện giọng</strong></div> : profiles.length ? <div className="voice-clone-profile-list">{profiles.map((profile) => <div key={profile.id} className={`voice-clone-profile ${selectedId === profile.id ? 'selected' : ''}`}>
          <button type="button" className="voice-clone-profile-main" onClick={() => setSelectedId(profile.id)}><span className="voice-clone-avatar">{profile.name.trim().slice(0, 2).toUpperCase()}</span><span><strong>{profile.name}</strong><small>{formatDuration(profile.durationMs)} · {formatCreatedAt(profile.createdAt)}</small><em>{profile.sourceName}</em></span>{selectedId === profile.id && <Check size={15} />}</button>
          <button type="button" className="icon-button danger" aria-label={`Xóa ${profile.name}`} disabled={deletingId === profile.id} onClick={() => void deleteClone(profile)}>{deletingId === profile.id ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}</button>
        </div>)}</div> : <div className="voice-clone-empty"><Volume2 size={27} /><strong>Chưa có giọng clone</strong><small>Tạo hồ sơ đầu tiên từ mẫu giọng ở bên trái.</small></div>}
      </section>

      <section className="voice-clone-card voice-clone-preview-card">
        <div className="section-title"><span>03 · NGHE THỬ</span><small>{selectedProfile?.name || 'Chưa chọn giọng'}</small></div>
        <div className="field"><span>Nội dung thử</span><textarea rows={4} maxLength={600} value={previewText} onChange={(event) => setPreviewText(event.target.value)} /></div>
        <div className="field"><span>Tốc độ <b className="value-badge">{speed.toFixed(2)}x</b></span><RangeInput min={0.9} max={1.5} step={0.05} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></div>
        <button type="button" className="button secondary full" disabled={testing || !selectedId || !previewText.trim()} onClick={() => void testVoice()}>{testing ? <LoaderCircle size={15} className="spin" /> : <CirclePlay size={16} />} {testing ? 'Đang dựng giọng...' : 'Tạo bản nghe thử'}</button>
        {previewUrl && <div className="voice-clone-audio">
          <audio ref={previewAudioRef} autoPlay preload="metadata" src={previewUrl} onLoadedMetadata={(event) => setPreviewDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onDurationChange={(event) => setPreviewDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} onPlay={() => setPreviewPlaying(true)} onPause={() => setPreviewPlaying(false)} onEnded={() => setPreviewPlaying(false)} />
          <button type="button" className="voice-clone-audio-play" onClick={togglePreviewPlayback} aria-label={previewPlaying ? 'Tạm dừng bản nghe thử' : 'Phát bản nghe thử'}>{previewPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
          <div className="voice-clone-audio-track"><div><span>BẢN NGHE THỬ</span><time>{formatPlaybackTime(previewTime)} <i>/</i> {formatPlaybackTime(previewDuration)}</time></div><RangeInput aria-label="Vị trí phát bản nghe thử" min={0} max={previewDuration || 0.01} step={0.01} value={Math.min(previewTime, previewDuration || 0)} onChange={(event) => seekPreview(Number(event.target.value))} /></div>
          <a className="icon-button voice-clone-audio-download" href={previewUrl} download={`${selectedProfile?.name || 'voice-preview'}.wav`} title="Tải WAV" aria-label="Tải bản nghe thử dạng WAV"><Download size={15} /></a>
        </div>}
        <div className="voice-clone-use-card"><AudioLines size={17} /><div><strong>Dùng cho lồng tiếng phim</strong><small>Trong Lồng tiếng video, chọn TTS Provider VieNeu Local Clone rồi chọn tên giọng này.</small></div><button type="button" className={`button small ${ttsEnabled ? 'ghost' : 'primary'}`} disabled={!profiles.length} onClick={enableForDubbing}>{ttsEnabled ? <Check size={14} /> : <Volume2 size={14} />} {ttsEnabled ? 'Đã bật TTS' : 'Bật cho TTS'}</button></div>
        <button type="button" className="text-button voice-clone-open-editor" disabled={!profiles.length} onClick={onOpenEditor}>Mở trang Lồng tiếng video →</button>
      </section>
    </div>

    <div className="voice-clone-disclaimer"><ShieldCheck size={16} /><span>Clone giọng chỉ thay phần thuyết minh. Nó không xóa Content ID hoặc quyền sở hữu đối với hình ảnh, âm thanh và nội dung phim nguồn.</span></div>
  </div>;
}
