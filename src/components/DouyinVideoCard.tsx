import { useState } from 'react';
import type { api } from '../lib/api';

type Item = Awaited<ReturnType<typeof api.searchDouyin>>['items'][number];
export function durationLabel(seconds: number) {
  if (!seconds) return 'Chưa rõ thời lượng';
  const total = Math.floor(seconds), minutes = Math.floor(total / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` : `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function DouyinVideoCard({ item, selected, onSelect, assessment }: { item: Item; selected: boolean; onSelect: () => void; assessment?: { verdict: string; reason: string } }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return <article className={`douyin-video-card${selected ? ' is-selected' : ''}`}>
    <a className="douyin-video-cover" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Xem trên Douyin: ${item.title}`}>
      {item.coverUrl && !imageFailed ? <img src={item.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : <span className="douyin-search-no-cover">Không có ảnh xem trước · Mở trên Douyin ↗</span>}
    </a>
    <div className="douyin-video-body">
      <div className="douyin-video-card-toolbar"><label><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Chọn video: ${item.title}`} />Chọn</label><span>{durationLabel(item.duration)}</span></div>
      <h3 className={expanded ? '' : 'douyin-video-title-clamped'}>{item.title}</h3>
      {item.title.length > 65 && <button type="button" className="douyin-video-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Thu gọn' : 'Xem đầy đủ tiêu đề'}</button>}
      <p className="douyin-video-author">{item.author || 'Douyin'}{item.publishedAt > 0 && <> · <time dateTime={new Date(item.publishedAt * 1000).toISOString()}>{new Date(item.publishedAt * 1000).toLocaleDateString('vi-VN')}</time></>}</p>
      {assessment && <details className="douyin-card-assessment"><summary>AI: {assessment.verdict === 'match' ? 'Sát chủ đề' : assessment.verdict === 'off-topic' ? 'Lệch chủ đề' : 'Chưa chắc'}</summary><p>{assessment.reason}</p></details>}
      <dl className="douyin-video-stats">
        <div><dt>Lượt xem</dt><dd>{item.views === null || item.views === undefined ? 'Không công khai' : item.views.toLocaleString('vi-VN')}</dd></div>
        <div><dt>Lượt thích</dt><dd>{item.likes.toLocaleString('vi-VN')}</dd></div>
        <div><dt>Bình luận</dt><dd>{item.comments.toLocaleString('vi-VN')}</dd></div>
        <div><dt>Chia sẻ</dt><dd>{item.shares.toLocaleString('vi-VN')}</dd></div>
      </dl>
      <a href={item.url} target="_blank" rel="noopener noreferrer">Mở trên Douyin ↗</a>
    </div>
  </article>;
}
