import { memo, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { SubtitleCue } from '../types';
import { formatClock, subtitleStats } from '../lib/subtitles';
import { Trash2 } from '../components/Icons';

type SubtitleCardProps = {
  cue: SubtitleCue;
  highlighted: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<SubtitleCue>) => void;
  onDelete: (id: string) => void;
  cueRefs: MutableRefObject<Map<string, HTMLElement>>;
};

const SubtitleCard = memo(function SubtitleCard({ cue, highlighted, onSelect, onChange, onDelete, cueRefs }: SubtitleCardProps) {
  const stats = subtitleStats(cue);

  return <article
    ref={(element) => {
      if (element) cueRefs.current.set(cue.id, element);
      else cueRefs.current.delete(cue.id);
    }}
    className={`cue-card ${highlighted ? 'selected' : ''}`}
    onClick={() => onSelect(cue.id)}
  >
    <div className="cue-meta">
      <span className="cue-index">#{String(cue.index).padStart(2, '0')}</span>
      <button className="cue-delete" onClick={(event) => { event.stopPropagation(); onDelete(cue.id); }} aria-label="Xóa cue"><Trash2 size={14} /></button>
      <span>{formatClock(cue.startMs)} → {formatClock(cue.endMs)}</span>
      <small>{stats.duration} ms</small>
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
    </div>
  </article>;
});

export const SubtitleList = memo(function SubtitleList({ cues, activeCueId, selectedId, onSelect, onChange, onDelete }: { cues: SubtitleCue[]; activeCueId?: string; selectedId?: string; onSelect: (id: string) => void; onChange: (id: string, patch: Partial<SubtitleCue>) => void; onDelete: (id: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const cueRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!activeCueId) return;
    const container = listRef.current;
    const card = cueRefs.current.get(activeCueId);
    if (!container || !card) return;

    const containerRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const topPadding = 10;
    const desiredTopDelta = cardRect.top - containerRect.top - topPadding;
    if (Math.abs(desiredTopDelta) > 1) {
      container.scrollTo({
        top: Math.max(0, container.scrollTop + desiredTopDelta),
        behavior: 'smooth',
      });
    }
  }, [activeCueId]);

  return <div ref={listRef} className="subtitle-list">
    {cues.length === 0 ? <div className="empty-list"><span>01</span><p>Subtitle list đang trống.</p><small>Import SRT/VTT hoặc trích xuất từ video để bắt đầu.</small></div> : cues.map((cue) => <SubtitleCard
      key={cue.id}
      cue={cue}
      highlighted={activeCueId ? activeCueId === cue.id : selectedId === cue.id}
      onSelect={onSelect}
      onChange={onChange}
      onDelete={onDelete}
      cueRefs={cueRefs}
    />)}
  </div>;
});
