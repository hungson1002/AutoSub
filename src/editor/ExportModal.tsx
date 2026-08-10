import { useRef, useState } from 'react';
import type { BlurRegion, LogoOverlay, SubtitleCue, SubtitleStyle, VideoAsset, VideoEditState } from '../types';
import { Modal } from '../components/Modal';
import { Check, Download } from '../components/Icons';
import { cuesToAss, cuesToSrt, downloadText, validateCues } from '../lib/subtitles';
import { api, friendlyErrorMessage } from '../lib/api';
import { ProgressModal } from '../components/ProgressModal';

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
  videoEdit = { aspectRatio: 'original', trimStartMs: 0 },
  logo,
  fontFile,
  blurRegions = [],
  dubTrack,
  dubbingJobId,
  dubbingAudioMix,
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
  dubbingAudioMix?: { keepOriginal: boolean; originalVolume: number; separateVocals?: boolean };
  onClose: () => void;
  onNotice?: (message: string, kind?: 'success' | 'error') => void;
}) {
  const [format, setFormat] = useState<'translated' | 'original' | 'ass' | 'video'>('translated');
  const [working, setWorking] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('Đang chuẩn bị render');
  const hasDub = Boolean(dubTrack || dubbingJobId);
  const dubbingJobAlreadyMixed = Boolean(dubbingJobId && dubbingAudioMix?.keepOriginal && dubbingAudioMix?.separateVocals);
  const controllerRef = useRef<AbortController | undefined>(undefined);

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
    if (!asset?.uploadId && !asset?.file) {
      onNotice?.('Video chưa được lưu trên máy. Hãy chọn lại video và chờ upload hoàn tất.', 'error');
      return;
    }
    const trimStartMs = Math.max(0, Math.round(videoEdit.trimStartMs || 0));
    const trimEndMs = videoEdit.trimEndMs ? Math.round(videoEdit.trimEndMs) : undefined;
    if (trimEndMs !== undefined && trimEndMs <= trimStartMs) {
      onNotice?.('Điểm kết thúc phải nằm sau điểm bắt đầu.', 'error');
      return;
    }
    const exportCues = cues
      .filter((cue) => cue.endMs > trimStartMs && (trimEndMs === undefined || cue.startMs < trimEndMs))
      .map((cue) => ({ ...cue, startMs: Math.max(0, cue.startMs - trimStartMs), endMs: Math.max(1, Math.min(cue.endMs, trimEndMs ?? cue.endMs) - trimStartMs) }));
    const exportBlurRegions = blurRegions.map((region) => ({
      ...region,
      startMs: Math.max(0, region.startMs - trimStartMs),
      endMs: Math.max(0, Math.min(region.endMs, trimEndMs ?? region.endMs) - trimStartMs),
    })).filter((region) => region.endMs > region.startMs);

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
        exportCues,
        style,
        {
          exportId,
          uploadId: asset.uploadId,
          resolution: 'original',
          crf: 20,
          keepAudio: dubbingJobAlreadyMixed ? false : hasDub ? (dubbingAudioMix?.keepOriginal ?? true) : true,
          originalVolume: dubbingAudioMix?.originalVolume ?? 0.25,
          burnSubtitles: true,
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
      saveBlob('autosub-final.mp4', blob);
      setRenderProgress(100);
      onNotice?.('Đã render video hoàn chỉnh bằng FFmpeg.', 'success');
      onClose();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') onNotice?.('Đã hủy render video.', 'success');
      else onNotice?.(friendlyErrorMessage(error, 'Video export thất bại.'), 'error');
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
        {asset && <button className={format === 'video' ? 'selected' : ''} onClick={() => setFormat('video')}><span><Check size={14} /> Video mới nhất</span><small>.mp4</small></button>}
      </div>
      <div className="modal-actions"><button className="button ghost" onClick={onClose}>Hủy</button><button className="button primary" disabled={working} onClick={() => { if (format === 'video') void exportVideo(); else download(); }}><Download size={15} /> {working ? 'Đang render…' : format === 'video' ? 'Bắt đầu xuất' : 'Tải xuống'}</button></div>
    </Modal>
    <ProgressModal open={working} title="Đang render video" message={renderStage} value={renderProgress} onCancel={() => { controllerRef.current?.abort(); setWorking(false); }} />
  </>;
}
