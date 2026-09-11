import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { DouyinVideoCard, durationLabel } from './DouyinVideoCard';

test('video card separates edge-to-edge media from padded metadata', () => {
  const html = renderToStaticMarkup(<DouyinVideoCard item={{ id: '12345', title: '<unsafe>', author: 'Author', url: 'https://www.douyin.com/video/12345', duration: 3661, likes: 12, comments: 3, shares: 4, views: null, publishedAt: 0 }} selected={true} onSelect={() => {}} />);
  assert.ok(html.indexOf('douyin-video-cover') < html.indexOf('douyin-video-body'));
  assert.ok(html.includes('Không công khai'));
  assert.ok(html.includes('&lt;unsafe&gt;'));
  assert.ok(html.includes('is-selected'));
  assert.ok(html.includes('1:01:01'));
});

test('duration labels include hours without rounding short videos up', () => {
  assert.equal(durationLabel(3601), '1:00:01');
  assert.equal(durationLabel(59.9), '0:59');
  assert.equal(durationLabel(0), 'Chưa rõ thời lượng');
});
