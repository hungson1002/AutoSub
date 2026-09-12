import React, { useState } from 'react';
import { ExternalLink, Heart, MessageCircle, Share2 } from 'lucide-react';
import type { api } from '../lib/api';

type Item = Awaited<ReturnType<typeof api.searchDouyin>>['items'][number];
export function durationLabel(seconds: number) {
  if (!seconds) return 'Chưa rõ thời lượng';
  const total = Math.floor(seconds), minutes = Math.floor(total / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` : `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function compactMetric(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))} T`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))} Tr`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))} N`;
  return value.toLocaleString('vi-VN');
}

export function DouyinVideoCard({ item, selected, onSelect, assessment }: { item: Item; selected: boolean; onSelect: () => void; assessment?: { verdict: string; reason: string } }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <article className={`douyin-video-card${selected ? ' is-selected' : ''}`}>
    <div className="douyin-video-media" data-overlap-owner="douyin-card-media">
      <a className="douyin-video-cover" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Xem trên Douyin: ${item.title}`}>
        {item.coverUrl && !imageFailed ? <img src={item.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : <span className="douyin-search-no-cover">Không có ảnh xem trước</span>}
      </a>
      <label className="douyin-video-select"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Chọn video: ${item.title}`} /><span>{selected ? 'Đã chọn' : 'Chọn'}</span></label>
      {assessment && <details className={`douyin-card-assessment verdict-${assessment.verdict}`}><summary>{assessment.verdict === 'match' ? 'Sát chủ đề' : assessment.verdict === 'off-topic' ? 'Lệch chủ đề' : 'Chưa chắc'}</summary><p>{assessment.reason}</p></details>}
      <div className="douyin-video-media-meta"><span><Heart size={14} aria-hidden="true" />{compactMetric(item.likes)}</span><time>{durationLabel(item.duration)}</time></div>
    </div>
    <div className="douyin-video-body">
      <h3 className="douyin-video-title-clamped" title={item.title}>{item.title}</h3>
      <div className="douyin-video-byline"><p className="douyin-video-author">{item.author || 'Douyin'}{item.publishedAt > 0 && <> · <time dateTime={new Date(item.publishedAt * 1000).toISOString()}>{new Date(item.publishedAt * 1000).toLocaleDateString('vi-VN')}</time></>}</p><a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Mở trên Douyin: ${item.title}`}><ExternalLink size={14} aria-hidden="true" /></a></div>
      <div className="douyin-video-stats" aria-label="Tương tác video">
        <span title="Bình luận"><MessageCircle size={13} aria-hidden="true" />{compactMetric(item.comments)}</span>
        <span title="Chia sẻ"><Share2 size={13} aria-hidden="true" />{compactMetric(item.shares)}</span>
        {item.views !== null && item.views !== undefined && <span className="views" title="Lượt xem">{compactMetric(item.views)} lượt xem</span>}
      </div>
    </div>
  </article>;
}
