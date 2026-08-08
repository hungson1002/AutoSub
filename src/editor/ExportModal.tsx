import { useEffect, useRef, useState } from 'react';
import type { BlurRegion, LogoOverlay, SubtitleCue, SubtitleStyle, VideoAsset } from '../types';
import { Modal } from '../components/Modal';
import { Check, Download } from '../components/Icons';
import { cuesToAss, cuesToSrt, downloadText, validateCues } from '../lib/subtitles';
import { api } from '../lib/api';
import { ProgressModal } from '../components/ProgressModal';
import { SelectField } from '../components/SelectField';

function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportModal({
  open,
  cues,
  style,
  asset,
  logo,
  fontFile,
  blurRegions = [],
  dubTrack,
  dubbingJobId,
  dubbingAudioMix,
  onClose,
  onExportVideo,
  onNotice,
}: {
  open: boolean;
  cues: SubtitleCue[];
  style: SubtitleStyle;
  asset?: VideoAsset;
  logo?: LogoOverlay;
  fontFile?: File;
  blurRegions?: BlurRegion[];
  dubTrack?: Blob;
  dubbingJobId?: string;
  dubbingAudioMix?: { keepOriginal: boolean; originalVolume: number };
  onClose: () => void;
  onExportVideo?: () => void;
  onNotice?: (message: string, kind?: 'success' | 'error') => void;
}) {
  const [format, setFormat] = useState<'translated' | 'original' | 'ass' | 'video'>('translated');
  const [burn, setBurn] = useState(false);
  const [blur, setBlur] = useState(blurRegions.length > 0);
  const [dub, setDub] = useState(false);
  const [keepAudio, setKeepAudio] = useState(true);
  const [originalVolume, setOriginalVolume] = useState(dubbingAudioMix?.originalVolume ?? 0.25);
  const [separateVocals, setSeparateVocals] = useState(false);
  const [demucsAvailable, setDemucsAvailable] = useState<boolean>();
  const [resolution, setResolution] = useState<'original' | '1080' | '720'>('original');
  const [crf, setCrf] = useState(20);
  const [working, setWorking] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('Đang chuẩn bị render');
  const controllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => { if (blurRegions.length > 0) setBlur(true); }, [blurRegions.length]);
  useEffect(() => { if (dubbingAudioMix) { setKeepAudio(dubbingAudioMix.keepOriginal); setOriginalVolume(dubbingAudioMix.originalVolume); } }, [dubbingAudioMix]);
  useEffect(() => {
    if (!open) return;
    void api.system().then((system) => setDemucsAvailable(system.demucs)).catch(() => setDemucsAvailable(false));
  }, [open]);

  const validateBeforeAction = () => {
    const validation = validateCues(cues);
    if (!validation.valid) onNotice?.(validation.errors[0] || 'Subtitle không hợp lệ.', 'error');
    return validation.valid;
  };

  const download = () => {
    if (!validateBeforeAction()) return;
    if (format === 'video') return;
    if (format === 'ass') downloadText('autosub.ass', cuesToAss(cues, style), 'text/x-ass');
    else downloadText(`autosub-${format}.srt`, cuesToSrt(cues, format === 'translated'), 'application/x-subrip');
  };

  const exportVideo = async () => {
    if (!validateBeforeAction()) return;
    if (!asset?.file) {
      onExportVideo?.();
      return;
    }
    if (blur && !blurRegions.length) {
      onNotice?.('Bạn đã bật blur nhưng chưa tạo Blur Region.', 'error');
      return;
    }
    if (dub && !dubTrack && !dubbingJobId) {
      onNotice?.('Bạn đã bật dubbing nhưng chưa tạo dub track.', 'error');
      return;
    }

    const controller = new AbortController();
    const exportId = `export-${Date.now()}-${crypto.randomUUID()}`;
    controllerRef.current = controller;
    setWorking(true);
    setRenderProgress(1);
    setRenderStage('Đang tải video lên máy');
    const poll = window.setInterval(() => {
      void api.getExportProgress(exportId, controller.signal).then((status) => {
        setRenderProgress(status.percent);
        setRenderStage(status.stage);
      }).catch(() => undefined);
    }, 500);
    try {
      const blob = await api.exportVideo(
        asset.file,
        cues,
        style,
        { exportId, resolution, crf, keepAudio, originalVolume, burnSubtitles: burn, separateVocals: keepAudio && separateVocals, blurRegions: blur ? blurRegions : [], logo, dubTrack: dub ? dubTrack : undefined, dubbingJobId: dub ? dubbingJobId : undefined, fontFile },
        controller.signal,
      );
      saveBlob('autosub-final.mp4', blob);
      setRenderProgress(100);
      onNotice?.('Đã render video hoàn chỉnh bằng FFmpeg.', 'success');
      onClose();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') onNotice?.('Đã hủy render video.', 'success');
      else onNotice?.(error instanceof Error ? error.message : 'Video export thất bại.', 'error');
    } finally {
      window.clearInterval(poll);
      controllerRef.current = undefined;
      setWorking(false);
    }
  };

  return <>
    <Modal open={open} title="Xuất file" eyebrow="FINAL OUTPUT" onClose={onClose}>
      <div className="export-list">
        <button className={format === 'translated' ? 'selected' : ''} onClick={() => setFormat('translated')}><span><Check size={14} /> SRT bản dịch</span><small>.srt</small></button>
        <button className={format === 'original' ? 'selected' : ''} onClick={() => setFormat('original')}><span><Check size={14} /> SRT bản gốc</span><small>.srt</small></button>
        <button className={format === 'ass' ? 'selected' : ''} onClick={() => setFormat('ass')}><span><Check size={14} /> ASS styled</span><small>.ass</small></button>
        {asset && <button className={format === 'video' ? 'selected' : ''} onClick={() => { setFormat('video'); setBurn(true); setDub(Boolean(dubTrack || dubbingJobId)); }}><span><Check size={14} /> Video hoàn chỉnh</span><small>.mp4</small></button>}
      </div>
      {asset && <div className="export-options">
        <div className="section-title"><span>VIDEO OPTIONS</span><small>Re-encode một lần ở bước cuối</small></div>
        <label className="check-row"><input type="checkbox" checked={blur} onChange={(event) => setBlur(event.target.checked)} /> Làm mờ subtitle cũ</label>
        <label className="check-row"><input type="checkbox" checked={burn} onChange={(event) => setBurn(event.target.checked)} /> Burn subtitle mới</label>
        <label className="check-row"><input type="checkbox" checked={dub} onChange={(event) => setDub(event.target.checked)} /> Lồng tiếng</label>
        <label className="check-row"><input type="checkbox" checked={keepAudio} onChange={(event) => setKeepAudio(event.target.checked)} /> Giữ audio gốc</label>
        {dub && keepAudio && <label className={`check-row${demucsAvailable === false ? ' disabled' : ''}`}><input type="checkbox" checked={separateVocals} disabled={demucsAvailable === false} onChange={(event) => setSeparateVocals(event.target.checked)} /> Tách lời gốc, chỉ giữ nhạc nền {demucsAvailable === false && <small>· cần cài requirements-audio.txt</small>}</label>}
        {dub && keepAudio && <label className="field"><span>Âm lượng {separateVocals ? 'nhạc nền' : 'audio gốc'} <b className="value-badge">{Math.round(originalVolume * 100)}%</b></span><input type="range" min={0} max={1} step={0.05} value={originalVolume} onChange={(event) => setOriginalVolume(Number(event.target.value))} /></label>}
        <div className="field"><span>Resolution</span><SelectField ariaLabel="Độ phân giải video" value={resolution} onChange={(value) => setResolution(value as typeof resolution)} options={[{ value: 'original', label: 'Giữ nguyên', description: 'Không đổi kích thước video' }, { value: '1080', label: '1080p', description: 'Full HD · 1920 × 1080' }, { value: '720', label: '720p', description: 'HD · 1280 × 720' }]} /></div>
        <label className="field"><span>Quality · CRF <b className="value-badge">{crf}</b></span><input type="range" min={16} max={35} value={crf} onChange={(event) => setCrf(Number(event.target.value))} /></label>
      </div>}
      <div className="modal-actions"><button className="button ghost" onClick={onClose}>Hủy</button><button className="button primary" disabled={working} onClick={() => { if (format === 'video') void exportVideo(); else download(); }}><Download size={15} /> {working ? 'Đang render…' : format === 'video' ? 'Bắt đầu xuất' : 'Tải xuống'}</button></div>
    </Modal>
    <ProgressModal open={working} title="Đang render video" message={renderStage} value={renderProgress} onCancel={() => { controllerRef.current?.abort(); setWorking(false); }} />
  </>;
}
