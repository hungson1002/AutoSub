import { useCallback, useEffect, useRef, useState } from 'react';
import type { AIProvider, DubbingJobStatus, OriginalAudioMode, PronunciationEntry, ProviderAssignment, SubtitleCue, VoiceGroup } from '../types';
import { api, friendlyErrorMessage } from '../lib/api';
import { AssignmentSummary } from '../components/AssignmentSummary';
import { Modal } from '../components/Modal';
import { Check, ChevronDown, CirclePlay, LoaderCircle, Pause, Play, Plus, RotateCcw, Search, Trash2, X } from '../components/Icons';
import { resolvedProviderType } from '../lib/providers';
import { RangeInput } from '../components/RangeInput';
import { announceDropdownOpen, listenForOtherDropdowns, type DropdownId } from '../lib/dropdowns';
import { CapabilityAssignmentPicker } from '../components/CapabilityAssignmentPicker';

const groups: VoiceGroup[] = ['G1', 'G2', 'G3'];
export type VoiceConfig = { assignment: ProviderAssignment; voice: string; speed: number; volume: number };
export type DubbingRunOptions = { audioMix: { mode: OriginalAudioMode; keepOriginal: boolean; originalVolume: number; separateVocals: boolean } };

type VoiceItem = { id: string; name?: string; language?: string; source?: 'preset' | 'clone'; description?: string };

export function DubbingModal({ open, providers, assignments, availableAssignments, cues, pronunciation, sourceVideoReady = false, sourceVideoUploading = false, onClose, onPronunciationChange, onRun, onNotice, job, onJobAction }: { open: boolean; providers: AIProvider[]; assignments: Record<VoiceGroup, ProviderAssignment>; availableAssignments: ProviderAssignment[]; cues: SubtitleCue[]; pronunciation: PronunciationEntry[]; sourceVideoReady?: boolean; sourceVideoUploading?: boolean; onClose: () => void; onPronunciationChange: (entries: PronunciationEntry[]) => void; onRun: (configs: Record<VoiceGroup, VoiceConfig>, options: DubbingRunOptions) => void; onNotice?: (message: string, kind?: 'success' | 'error') => void; job?: DubbingJobStatus; onJobAction?: (action: 'pause' | 'resume' | 'cancel' | 'retry-failed') => void }) {
  const [active, setActive] = useState<VoiceGroup>('G1');
  const [mode, setMode] = useState<'voices' | 'dictionary'>('voices');
  const [testing, setTesting] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceQuery, setVoiceQuery] = useState('');
  const [previewingVoice, setPreviewingVoice] = useState<string>();
  const [loadedVoices, setLoadedVoices] = useState<Record<string, VoiceItem[]>>({});
  const [configs, setConfigs] = useState<Record<VoiceGroup, VoiceConfig>>(() => ({
    G1: { assignment: assignments.G1, voice: '', speed: 1, volume: 1 },
    G2: { assignment: assignments.G2, voice: '', speed: 1, volume: 1 },
    G3: { assignment: assignments.G3, voice: '', speed: 1, volume: 1 },
  }));
  const [sourceAudioMode, setSourceAudioMode] = useState<OriginalAudioMode>('mute');
  const [originalVolume, setOriginalVolume] = useState(0.25);
  const [demucsAvailable, setDemucsAvailable] = useState<boolean>();
  const voicePickerRef = useRef<HTMLDivElement>(null);
  const voiceDropdownId = useRef<DropdownId>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);
  const previewCacheRef = useRef(new Map<string, Blob>());
  const assignmentOptions = availableAssignments.length ? availableAssignments : [assignments.G1];
  const current = configs[active];
  const currentProvider = providers.find((item) => item.id === current.assignment.providerId);
  const providerType = currentProvider ? resolvedProviderType(currentProvider) : undefined;
  const isGroq = providerType === 'groq';
  const isElevenLabs = providerType === 'elevenlabs';
  const isHiiuTts = providerType === 'hiiu-tts';
  const isCapCutTts = providerType === 'capcut-tts';
  const isEdgeTts = providerType === 'edge-tts';
  const isVieneuLocal = providerType === 'vieneu-local';
  const voiceItems = (isHiiuTts ? (currentProvider?.models || []).map((model) => ({ id: model.id, name: model.name || model.id })) : currentProvider ? loadedVoices[currentProvider.id] || currentProvider.voices || [] : []) as VoiceItem[];
  const voiceSource = (voice: VoiceItem) => voice.source || (isVieneuLocal ? (voice.id.startsWith('preset:') ? 'preset' : 'clone') : undefined);
  const filteredVoices = voiceItems.filter((voice) => `${voice.name || ''} ${voice.id} ${voice.language || ''} ${voice.description || ''}`.toLowerCase().includes(voiceQuery.trim().toLowerCase()));
  const selectedVoice = voiceItems.find((voice) => voice.id === current.voice);
  const sourceAudioEnabled = sourceAudioMode !== 'mute';
  const needsStemMix = sourceAudioMode === 'background';
  const notify = (message: string, kind: 'success' | 'error' = 'success') => onNotice?.(message, kind);
  const patchCurrent = (patch: Partial<VoiceConfig>) => setConfigs((value) => ({ ...value, [active]: { ...value[active], ...patch } }));
  const addPronunciation = () => onPronunciationChange([...pronunciation, { id: crypto.randomUUID(), source: '', reading: '', enabled: true }]);

  const stopPreview = useCallback(() => {
    previewRequestRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setPreviewingVoice(undefined);
  }, []);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);
  useEffect(() => () => stopPreview(), [stopPreview]);
  useEffect(() => {
    if (!open) return;
    setConfigs((currentConfigs) => Object.fromEntries(groups.map((group) => {
      const currentConfig = currentConfigs[group];
      const fallback = assignments[group];
      const available = assignmentOptions.some((item) => item.providerId === currentConfig.assignment.providerId && item.model === currentConfig.assignment.model);
      const assignment = available ? currentConfig.assignment : fallback;
      const selectedProvider = providers.find((item) => item.id === assignment.providerId);
      const voice = selectedProvider && resolvedProviderType(selectedProvider) === 'hiiu-tts' ? assignment.model : currentConfig.voice;
      return [group, { ...currentConfig, assignment, voice }];
    })) as Record<VoiceGroup, VoiceConfig>);
  }, [open]);
  useEffect(() => { setVoiceOpen(false); setVoiceQuery(''); }, [active, current.assignment.providerId]);
  useEffect(() => {
    if (!open) return;
    void api.system().then((system) => setDemucsAvailable(system.demucs)).catch(() => setDemucsAvailable(false));
  }, [open]);
  useEffect(() => {
    if (!open || !currentProvider || (!isVieneuLocal && !isEdgeTts)) return;
    const controller = new AbortController();
    void api.listVoices(currentProvider, controller.signal).then(({ voices }) => {
      setLoadedVoices((current) => ({ ...current, [currentProvider.id]: voices }));
      setConfigs((currentConfigs) => Object.fromEntries(groups.map((group) => {
        const config = currentConfigs[group];
        const voice = config.assignment.providerId === currentProvider.id && !voices.some((item) => item.id === config.voice) ? voices[0]?.id || '' : config.voice;
        return [group, voice === config.voice ? config : { ...config, voice }];
      })) as Record<VoiceGroup, VoiceConfig>);
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(friendlyErrorMessage(error, isEdgeTts ? 'Không thể tải danh sách giọng Edge TTS.' : 'Không thể tải danh sách giọng clone.'), 'error');
    });
    return () => controller.abort();
  }, [open, active, currentProvider?.id, isEdgeTts, isVieneuLocal]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!voicePickerRef.current?.contains(event.target as Node)) setVoiceOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => listenForOtherDropdowns(voiceDropdownId.current, () => setVoiceOpen(false)), []);

  const playVoice = async (voiceId: string) => {
    if (!current.assignment.providerId || !current.assignment.model) { notify('Cấu hình TTS còn thiếu provider hoặc model.', 'error'); return; }
    if (!voiceId || !currentProvider) { notify('Hãy chọn Voice ID trước khi nghe thử.', 'error'); return; }
    stopPreview();
    const previewRequest = previewRequestRef.current;
    setPreviewingVoice(voiceId);
    try {
      const previewText = isGroq ? 'Hello, this is a voice test.' : 'Xin chào, đây là giọng thử.';
      const cacheKey = [currentProvider.id, current.assignment.model, voiceId, current.speed.toFixed(2), previewText].join('::');
      let blob = previewCacheRef.current.get(cacheKey);
      const cached = Boolean(blob);
      if (!blob) {
        blob = await api.testVoice(currentProvider, current.assignment.model, voiceId, current.speed, previewText);
        previewCacheRef.current.set(cacheKey, blob);
        while (previewCacheRef.current.size > 24) previewCacheRef.current.delete(previewCacheRef.current.keys().next().value as string);
      }
      if (previewRequestRef.current !== previewRequest) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      const finish = () => { if (audioRef.current === audio) stopPreview(); else URL.revokeObjectURL(url); };
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
      if (previewRequestRef.current !== previewRequest) return;
      notify(cached ? `Phát ngay bản thử đã lưu của ${voiceId}.` : `Đã lưu bản thử giọng ${voiceId} để nghe lại nhanh.`);
    } catch (error) {
      if (previewRequestRef.current !== previewRequest) return;
      stopPreview();
      notify(friendlyErrorMessage(error, 'Test voice thất bại.'), 'error');
    }
  };

  const testVoice = async () => {
    if (!current.voice) { notify('Model TTS này yêu cầu chọn Voice.', 'error'); return; }
    setTesting(true);
    try { await playVoice(current.voice); } finally { setTesting(false); }
  };

  return <Modal open={open} title="Lồng tiếng video" eyebrow="DUB WORKFLOW" onClose={onClose} wide className="dubbing-modal">
    <div className="modal-tabs"><button className={mode === 'voices' ? 'active' : ''} onClick={() => setMode('voices')}>Cấu hình giọng</button><button className={mode === 'dictionary' ? 'active' : ''} onClick={() => setMode('dictionary')}>Từ điển phát âm</button></div>
    {mode === 'voices' ? <>
      <div className="voice-tabs">{groups.map((group) => <button className={active === group ? 'active' : ''} key={group} onClick={() => setActive(group)}><strong>{group}</strong><small>{cues.filter((cue) => cue.voiceGroup === group).length} cue</small></button>)}</div>
      <div className="voice-config">
        <div className="voice-heading"><div className="voice-avatar">{active}</div><div><h3>Voice group {active}</h3><p>Ưu tiên video · giữ nguyên thời lượng gốc</p></div></div>
        <CapabilityAssignmentPicker capability="tts" assignments={assignmentOptions} providers={providers} value={current.assignment} onChange={(assignment) => { const nextProvider = providers.find((item) => item.id === assignment.providerId); patchCurrent({ assignment, voice: nextProvider && resolvedProviderType(nextProvider) === 'hiiu-tts' ? assignment.model : '' }); }} label="TTS Provider + Model" />
        <AssignmentSummary label="TTS Provider đang dùng" assignment={current.assignment} provider={currentProvider} capability="tts" />
        <div className="field"><span>{isHiiuTts ? 'Giọng đọc · HiiuTTS' : isCapCutTts ? 'Giọng đọc · CapCut TTS' : isEdgeTts ? 'Giọng đọc · Microsoft Edge TTS' : isVieneuLocal ? 'Giọng đọc · VieNeu Local' : `Voice ${isElevenLabs ? '· ElevenLabs' : 'ID'}`}</span>
          {(isElevenLabs || isHiiuTts || isCapCutTts || isEdgeTts || isVieneuLocal) && voiceItems.length ? <div className="voice-picker" ref={voicePickerRef}>
            <div className="voice-picker-control">
              <button type="button" className={`voice-picker-trigger ${voiceOpen ? 'active' : ''}`} onClick={() => { if (!voiceOpen) announceDropdownOpen(voiceDropdownId.current); setVoiceOpen((value) => !value); }}>
                <span className="voice-picker-star">★</span><span className="voice-picker-selected"><strong>{selectedVoice?.name || current.voice || 'Chọn giọng đọc'}</strong><small>{selectedVoice?.id || 'Mở danh sách voice'}</small></span><ChevronDown size={15} className={voiceOpen ? 'rotated' : ''} />
              </button>
              <button type="button" className="voice-picker-play" aria-label="Nghe thử voice đang chọn" disabled={!current.voice || previewingVoice === current.voice} onClick={() => void playVoice(current.voice)}>{previewingVoice === current.voice ? <LoaderCircle size={16} className="spin" /> : <CirclePlay size={18} />}</button>
            </div>
            {voiceOpen && <div className="voice-picker-menu">
              <label className="voice-picker-search"><Search size={15} /><input autoFocus value={voiceQuery} onChange={(event) => setVoiceQuery(event.target.value)} placeholder="Tìm tên hoặc Voice ID..." /></label>
              <div className="voice-picker-meta">{filteredVoices.length} voice · chọn để dùng, nút play để nghe thử</div>
              <div className="voice-picker-list">{filteredVoices.length ? filteredVoices.map((voice) => <div className={`voice-picker-option ${voice.id === current.voice ? 'selected' : ''}`} key={voice.id} role="option" aria-selected={voice.id === current.voice}>
                <button type="button" className="voice-picker-option-main" onClick={() => { patchCurrent({ voice: voice.id, ...(isHiiuTts ? { assignment: { ...current.assignment, model: voice.id } } : {}) }); setVoiceOpen(false); }}><span className="voice-picker-star">★</span><span><strong>{voice.name || voice.id}</strong><small>{voice.description || `${voice.id}${voice.language ? ` · ${voice.language}` : ''}`}</small></span>{voiceSource(voice) && <em className={`voice-picker-source ${voiceSource(voice)}`}>{voiceSource(voice) === 'preset' ? 'CÓ SẴN' : 'CLONE'}</em>}</button>
                <button type="button" className="voice-picker-option-play" aria-label={`Nghe thử ${voice.name || voice.id}`} onClick={() => void playVoice(voice.id)}>{previewingVoice === voice.id ? <LoaderCircle size={16} className="spin" /> : <CirclePlay size={17} />}</button>
                {voice.id === current.voice && <Check size={15} className="voice-picker-check" />}
              </div>) : <div className="voice-picker-empty">Không tìm thấy voice phù hợp.</div>}</div>
            </div>}
          </div> : isEdgeTts ? <div className="provider-readonly-value"><span>Đang tải danh sách giọng Việt của Edge TTS.</span></div> : isVieneuLocal ? <div className="provider-readonly-value"><span>Chưa có giọng clone. Hãy tạo một hồ sơ trong mục Clone giọng ở thanh bên.</span></div> : isHiiuTts || isCapCutTts ? <div className="provider-readonly-value"><span>Chưa có danh sách giọng. Hãy bấm “Lấy models” ở Cài đặt để tải voice {isCapCutTts ? 'CapCut TTS' : 'HiiuTTS'}.</span></div> : <input value={current.voice} onChange={(event) => patchCurrent({ voice: event.target.value })} placeholder={isGroq ? 'Ví dụ: troy, hannah, austin' : 'Nhập Voice ID của provider'} />}
          {isGroq && <small className="field-help">Groq Orpheus hiện dành cho giọng English/Arabic; test voice dùng câu tiếng Anh.</small>}
          {isElevenLabs && !voiceItems.length && <small className="field-help">Chưa có voice cache. Hãy lấy voices trong Cài đặt hoặc nhập Voice ID thủ công.</small>}
        </div>
        <div className="two-fields"><div className="field"><span>Tốc độ TTS <b className="value-badge">{current.speed.toFixed(2)}x</b></span><RangeInput min={0.9} max={1.2} step={0.05} value={current.speed} onChange={(event) => patchCurrent({ speed: Number(event.target.value) })} /></div><div className="field"><span>Âm lượng <b className="value-badge">{Math.round(current.volume * 100)}%</b></span><RangeInput min={0} max={2} step={0.05} value={current.volume} onChange={(event) => patchCurrent({ volume: Number(event.target.value) })} /><small className="field-help">100% là mức chuẩn hóa; có thể tăng đến 200% cho riêng nhóm giọng này.</small></div></div>
        <button className="button ghost" disabled={testing || Boolean(previewingVoice)} onClick={() => void testVoice()}><CirclePlay size={15} /> {testing ? 'Đang test…' : 'Nghe thử voice'}</button>
      </div>
      <div className="audio-mix">
        <div className="section-title"><span>AUDIO MIX</span><small>{sourceAudioMode === 'mute' ? 'Chỉ dùng giọng lồng tiếng mới' : sourceAudioMode === 'original' ? 'Giữ toàn bộ audio gốc' : 'Giữ nhạc nền và hiệu ứng, bỏ lời gốc'}</small></div>
        <div className="audio-component-grid" aria-label="Chọn cách dùng audio gốc">
          {([
            ['mute', 'Tắt audio gốc', 'Chỉ phát giọng lồng tiếng mới.'],
            ['original', 'Giữ audio gốc', 'Giữ nguyên lời thoại, nhạc và hiệu ứng.'],
            ['background', 'Giữ nhạc + hiệu ứng', 'Loại lời thoại gốc; giữ phần nền bằng Demucs.'],
          ] as const).map(([modeValue, label, description]) => <label className={`audio-component ${sourceAudioMode === modeValue ? 'active' : ''}`} key={modeValue}>
            <input type="radio" name="source-audio-mode" checked={sourceAudioMode === modeValue} onChange={() => setSourceAudioMode(modeValue)} />
            <span className="audio-component-check"><Check size={13} /></span>
            <span><strong>{label}</strong><small>{description}</small></span>
          </label>)}
        </div>
        {sourceAudioEnabled && <div className="field"><span>Âm lượng audio gốc <b className="value-badge">{Math.round(originalVolume * 100)}%</b></span><RangeInput min={0} max={1} step={0.05} value={originalVolume} onChange={(event) => setOriginalVolume(Number(event.target.value))} /></div>}
        {sourceAudioMode === 'original' && <div className="info-note warning">Audio gốc có lời thoại sẽ phát cùng giọng mới và có thể tạo tiếng vọng. Hãy chọn Tắt audio gốc hoặc Giữ nhạc + hiệu ứng để giọng trong hơn.</div>}
        {needsStemMix && <div className="info-note">AutoSub sẽ tách stem trước khi trộn. Cần Demucs và video nguồn đã upload.{demucsAvailable === false ? ' Hiện máy chưa có Demucs.' : sourceVideoUploading ? ' Video đang được khôi phục.' : !sourceVideoReady ? ' Cần video nguồn đã upload.' : ''}</div>}
      </div>
    </> : <div className="dictionary"><div className="section-title"><span>THAY TEXT ĐẦU VÀO TTS</span><button className="button small ghost" onClick={addPronunciation}><Plus size={14} /> Thêm từ</button></div><p className="muted-copy">Chỉ thay cách đọc khi gửi sang TTS, không sửa bản dịch trong editor.</p>{pronunciation.map((entry, index) => <div className="dictionary-row" key={entry.id}><span>{String(index + 1).padStart(2, '0')}</span><input placeholder="Từ gốc" value={entry.source} onChange={(event) => onPronunciationChange(pronunciation.map((item) => item.id === entry.id ? { ...item, source: event.target.value } : item))} /><span>→</span><input placeholder="Đọc thành" value={entry.reading} onChange={(event) => onPronunciationChange(pronunciation.map((item) => item.id === entry.id ? { ...item, reading: event.target.value } : item))} /><button className="icon-button" onClick={() => onPronunciationChange(pronunciation.filter((item) => item.id !== entry.id))}><Trash2 size={14} /></button></div>)}</div>}
    {job && <div className="dubbing-job-progress"><div className="dubbing-job-head"><div><span>JOB {job.id}</span><strong>{job.status === 'completed' ? 'Đã hoàn tất' : job.status === 'completed_with_errors' ? 'Hoàn tất với cue lỗi' : job.status === 'paused' ? 'Đã tạm dừng' : job.status === 'cancelled' ? 'Đã hủy' : job.status === 'failed' ? 'Thất bại' : 'Đang xử lý'}</strong></div><b>{job.progressPercent}%</b></div><div className="dubbing-job-track"><div style={{ width: `${job.progressPercent}%` }} /></div><div className="dubbing-job-stats"><span>{job.doneCues}/{job.totalCues} cue xong</span><span>{job.failedCues} cue lỗi</span><span>Batch {job.currentBatch}</span></div>{job.warnings.length > 0 && <small className="dubbing-job-warning">{job.warnings.slice(-2).join(' ')}</small>}{job.failedCueErrors?.length > 0 && <div className="dubbing-cue-errors"><strong>{job.failedCueErrors.length} cue cần xử lý</strong><small>Provider TTS đã thử xong nhưng không tạo được audio hợp lệ cho các cue này.</small>{job.failedCueErrors.slice(0, 2).map((failure) => <div className="dubbing-cue-error" key={failure.id}><span>Cue #{failure.index} · bước {failure.stage} · lần thử {failure.attempts}</span><p>{failure.error}</p></div>)}{job.failedCueErrors.length > 2 && <details><summary>Xem thêm {job.failedCueErrors.length - 2} cue lỗi</summary>{job.failedCueErrors.slice(2).map((failure) => <div className="dubbing-cue-error" key={failure.id}><span>Cue #{failure.index} · bước {failure.stage} · lần thử {failure.attempts}</span><p>{failure.error}</p></div>)}</details>}</div>}<div className="dubbing-job-actions">{job.status === 'running' && <button className="button small ghost" onClick={() => onJobAction?.('pause')}><Pause size={14} /> Tạm dừng</button>}{job.status === 'paused' && <button className="button small ghost" onClick={() => onJobAction?.('resume')}><Play size={14} /> Tiếp tục</button>}{['queued', 'running', 'paused'].includes(job.status) && <button className="button small ghost danger" onClick={() => onJobAction?.('cancel')}><X size={14} /> Hủy job</button>}{job.failedCues > 0 && job.status === 'completed_with_errors' && <button className="button small ghost" onClick={() => onJobAction?.('retry-failed')}><RotateCcw size={14} /> Retry cue lỗi</button>}</div></div>}
    <div className="modal-actions"><button className="button ghost" onClick={onClose}>Đóng</button><button className="button primary" disabled={Boolean(job && ['queued', 'running', 'paused'].includes(job.status)) || (needsStemMix && (demucsAvailable === false || !sourceVideoReady))} onClick={() => onRun(configs, { audioMix: { mode: sourceAudioMode, keepOriginal: sourceAudioEnabled, originalVolume: sourceAudioEnabled ? originalVolume : 0, separateVocals: needsStemMix } })}>{job && ['queued', 'running', 'paused'].includes(job.status) ? 'Job đang chạy…' : 'Tạo dub track'} <span>→</span></button></div>
  </Modal>;
}
