import {useEffect, useRef, useState} from 'react';
import {api, backgroundExportVideoUrl, type BackgroundExportJob} from '../lib/api';
import {Download, Film, X} from './Icons';
import './BackgroundExports.css';

const labels: Record<BackgroundExportJob['status'], string> = {
  queued: 'Đang chờ', running: 'Đang chạy', completed: 'Hoàn tất', failed: 'Thất bại', cancelled: 'Đã hủy',
};

export function BackgroundExports() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [jobs, setJobs] = useState<BackgroundExportJob[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [cancelling, setCancelling] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    async function refresh() {
      clearTimeout(timer);
      if (controller.signal.aborted || fetching) return;
      if (!document.hidden) {
        fetching = true;
        try {
          const current = await api.listBackgroundExports(controller.signal);
          if (!controller.signal.aborted) {setJobs(current); setLoaded(true); setError('');}
        } catch {
          if (!controller.signal.aborted) setError('Không kết nối được backend. Danh sách có thể chưa cập nhật.');
        } finally {fetching = false;}
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 3000);
    }
    void refresh();
    const onVisible = () => {if (!document.hidden) void refresh();};
    document.addEventListener('visibilitychange', onVisible);
    return () => {controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible);};
  }, []);

  const active = jobs.filter(job => ['queued', 'running'].includes(job.status));
  const recent = jobs.filter(job => !['queued', 'running'].includes(job.status));
  const running = active.filter(job => job.status === 'running').length;
  const summary = error ? 'Chưa cập nhật' : !loaded ? 'Đang kiểm tra…' : active.length ? `${running} đang chạy · ${active.length - running} đang chờ` : 'Không có tác vụ đang chạy';
  async function cancel(job: BackgroundExportJob) {
    setCancelling(current => new Set(current).add(job.id));
    try {
      await api.cancelBackgroundExport(job);
      setJobs(await api.listBackgroundExports());
      setError('');
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Không hủy được tác vụ. Vui lòng thử lại.');}
    finally {setCancelling(current => {const next = new Set(current); next.delete(job.id); return next;});}
  }
  function row(job: BackgroundExportJob) {
    const active = ['queued', 'running'].includes(job.status);
    const percent = Math.round(Math.min(100, Math.max(0, Number(job.progress) || 0)));
    return <li key={`${job.kind}:${job.id}`} className="background-export-row">
      <div className="background-export-info">
        <strong>{job.name}</strong>
        <div className="background-export-meta"><span>{job.kind === 'video-export' ? 'Xuất video' : 'Animation Studio'}</span><span>{new Date(job.createdAt).toLocaleString('vi-VN')}</span></div>
        <p><b className={`background-export-status ${job.status}`}>{labels[job.status]}</b>{active && <span>{percent}%</span>}</p>
        {active && <progress max={100} value={percent} aria-label={`Tiến độ ${job.name}`} />}
        {(job.error || job.stage) && <small>{job.error || job.stage}</small>}
      </div>
      {active ? <button type="button" className="button secondary background-export-cancel" disabled={cancelling.has(job.id)} onClick={() => void cancel(job)} aria-label={`Hủy ${job.name}`}>{cancelling.has(job.id) ? 'Đang hủy…' : 'Hủy xuất'}</button>
        : job.status === 'completed' && <a className="button secondary" href={backgroundExportVideoUrl(job)} download aria-label={`Tải ${job.name}`}><Download size={14} />Tải video</a>}
    </li>;
  }
  return <>
    <button type="button" className={`background-export-trigger ${active.length ? 'has-active' : ''}`} onClick={() => dialog.current?.showModal()} aria-label={`Tiến trình xuất. ${summary}`} title={`Tiến trình xuất: ${summary}`}>
      <Film size={18} /><span><b>Tiến trình xuất</b><small>{summary}</small></span>{active.length > 0 && <em>{active.length}</em>}
    </button>
    <dialog ref={dialog} className="background-export-dialog" aria-labelledby="background-export-title">
      <div className="modal-head"><div><h2 id="background-export-title">Tiến trình xuất</h2><p className="background-export-summary" aria-live="polite">{summary}</p></div><button type="button" className="icon-button" aria-label="Đóng tiến trình xuất" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      {error && <p className="background-export-error" role="alert">{error}</p>}
      {active.length ? <ul className="background-export-list">{active.map(row)}</ul> : <p className="background-export-empty">{loaded ? 'Không có lượt xuất đang chạy hoặc chờ.' : 'Đang lấy danh sách tiến trình…'}</p>}
      {recent.length > 0 && <details className="background-export-recent"><summary>Gần đây ({recent.length})</summary><ul className="background-export-list">{recent.map(row)}</ul></details>}
    </dialog>
  </>;
}
