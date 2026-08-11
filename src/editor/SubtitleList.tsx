import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SubtitleCue } from '../types';
import { formatClock, subtitleStats } from '../lib/subtitles';
import { RefreshCw, Trash2 } from '../components/Icons';

type SubtitleCardProps = {
  cue: SubtitleCue;
  highlighted: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<SubtitleCue>) => void;
  onDelete: (id: string) => void;
  onRegenerateVoice?: (cue: SubtitleCue) => void;
  regenerating: boolean;
  voiceReady: boolean;
};

const SubtitleCard = memo(function SubtitleCard({ cue, highlighted, onSelect, onChange, onDelete, onRegenerateVoice, regenerating, voiceReady }: SubtitleCardProps) {
  const stats = subtitleStats(cue);

  return <article className={`cue-card ${highlighted ? 'selected' : ''} ${cue.enabled ? '' : 'disabled'}`} onClick={() => onSelect(cue.id)}>
    <div className="cue-meta">
      <span className="cue-index">#{String(cue.index).padStart(2, '0')}</span>
      <button type="button" className={`cue-enable ${cue.enabled ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); onChange(cue.id, { enabled: !cue.enabled }); }}>{cue.enabled ? 'ON' : 'OFF'}</button>
      <button className="cue-delete" onClick={(event) => { event.stopPropagation(); onDelete(cue.id); }} aria-label="Xóa cue"><Trash2 size={14} /></button>
      <span>{formatClock(cue.startMs)} → {formatClock(cue.endMs)}</span>
      <small>{stats.duration} ms</small>
      {cue.dubbing && <span className="cue-voice-badge">VOICE {cue.dubbing.speedApplied.toFixed(2)}×</span>}
    </div>
    <div className="cue-row">
      <span>BẢN GỐC</span>
      <textarea value={cue.originalText} onChange={(event) => onChange(cue.id, { originalText: event.target.value })} onClick={(event) => event.stopPropagation()} />
    </div>
    <div className="cue-row translation-row">
      <span>BẢN DỊCH</span>
      <textarea value={cue.translatedText} placeholder="Chưa có bản dịch" onChange={(event) => onChange(cue.id, { translatedText: event.target.value })} onClick={(event) => event.stopPropagation()} />
    </div>
    <div className="cue-bottom">
      <label>START <input value={cue.startMs} type="number" onChange={(event) => onChange(cue.id, { startMs: Number(event.target.value) })} onClick={(event) => event.stopPropagation()} /></label>
      <label>END <input value={cue.endMs} type="number" onChange={(event) => onChange(cue.id, { endMs: Number(event.target.value) })} onClick={(event) => event.stopPropagation()} /></label>
      <div className={`cps ${stats.cps >= 20 ? 'danger' : stats.cps >= 17 ? 'warn' : ''}`}>CPS <b>{stats.cps.toFixed(1)}</b></div>
      <div className="voice-pills">
        {(['G1', 'G2', 'G3'] as const).map((group) => <button key={group} className={cue.voiceGroup === group ? 'active' : ''} onClick={(event) => { event.stopPropagation(); onChange(cue.id, { voiceGroup: group }); }}>{group}</button>)}
      </div>
      <button type="button" className="cue-regenerate" disabled={!voiceReady || regenerating} title={voiceReady ? 'Tạo lại voice riêng cho cue này' : 'Hãy tạo dub track trước'} onClick={(event) => { event.stopPropagation(); onRegenerateVoice?.(cue); }}><RefreshCw size={11} className={regenerating ? 'spinning' : ''} /> {regenerating ? 'Đang tạo' : 'Tạo voice'}</button>
    </div>
  </article>;
});

const CUE_SLOT_HEIGHT = 232;
const OVERSCAN_ITEMS = 5;

export const SubtitleList = memo(function SubtitleList({ cues, activeCueId, selectedId, onSelect, onChange, onDelete, onRegenerateVoice, regeneratingCueId, voiceReady = false }: { cues: SubtitleCue[]; activeCueId?: string; selectedId?: string; onSelect: (id: string) => void; onChange: (id: string, patch: Partial<SubtitleCue>) => void; onDelete: (id: string) => void; onRegenerateVoice?: (cue: SubtitleCue) => void; regeneratingCueId?: string; voiceReady?: boolean }) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  const cuePositions = useMemo(() => new Map(cues.map((cue, index) => [cue.id, index])), [cues]);

  const updateViewport = useCallback(() => {
    if (scrollFrameRef.current !== undefined) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      const list = listRef.current;
      if (!list) return;
      const next = { scrollTop: list.scrollTop, height: list.clientHeight || 600 };
      setViewport((current) => current.scrollTop === next.scrollTop && current.height === next.height ? current : next);
    });
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(updateViewport);
    observer.observe(list);
    updateViewport();
    return () => {
      observer.disconnect();
      if (scrollFrameRef.current !== undefined) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = undefined;
    };
  }, [updateViewport]);

  useEffect(() => {
    if (!activeCueId) return;
    const container = listRef.current;
    const position = cuePositions.get(activeCueId);
    if (!container || position === undefined) return;
    const itemTop = position * CUE_SLOT_HEIGHT;
    const itemBottom = itemTop + CUE_SLOT_HEIGHT;
    const padding = 10;
    if (itemTop < container.scrollTop + padding || itemBottom > container.scrollTop + container.clientHeight - padding) {
      container.scrollTo({ top: Math.max(0, itemTop - padding), behavior: 'auto' });
    }
  }, [activeCueId, cuePositions]);

  const start = Math.max(0, Math.floor(viewport.scrollTop / CUE_SLOT_HEIGHT) - OVERSCAN_ITEMS);
  const end = Math.min(cues.length, Math.ceil((viewport.scrollTop + viewport.height) / CUE_SLOT_HEIGHT) + OVERSCAN_ITEMS);
  const visibleCues = cues.slice(start, end);

  return <div ref={listRef} className="subtitle-list" onScroll={updateViewport}>
    {cues.length === 0 ? <div className="empty-list"><span>01</span><p>Subtitle list đang trống.</p><small>Import SRT/VTT hoặc trích xuất từ video để bắt đầu.</small></div> : <div className="subtitle-list-virtual-space" style={{ height: `${cues.length * CUE_SLOT_HEIGHT}px` }}>
      {visibleCues.map((cue, offset) => <div key={cue.id} className="subtitle-list-item" style={{ height: `${CUE_SLOT_HEIGHT}px`, transform: `translateY(${(start + offset) * CUE_SLOT_HEIGHT}px)` }}><SubtitleCard
        cue={cue}
        highlighted={activeCueId ? activeCueId === cue.id : selectedId === cue.id}
        onSelect={onSelect}
        onChange={onChange}
        onDelete={onDelete}
        onRegenerateVoice={onRegenerateVoice}
        regenerating={regeneratingCueId === cue.id}
        voiceReady={voiceReady}
      /></div>)}
    </div>}
  </div>;
});
