import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelBatchJob,
  createBatchJob,
  douyinResponseProblem,
  extractDouyinUrls,
  getBatchJob,
  isLikelyMp4Header,
} from './douyinDownloader';
import { douyinMediaFromDetail } from './douyinExtractor';

test('extractDouyinUrls extracts short links and web links from text', () => {
  const sampleText = `
    7.11 02/05 o@v.cn 7.14 复制打开抖音，看看【xxx的作品】 https://v.douyin.com/iABCxyz/ 01/18
    Xem thêm: https://www.douyin.com/video/7391234567890123456 và link ảnh https://www.douyin.com/note/7391234567890123457
    Trùng lặp: https://v.douyin.com/iABCxyz/
  `;

  const urls = extractDouyinUrls(sampleText);
  assert.equal(urls.length, 3);
  assert.ok(urls.includes('https://v.douyin.com/iABCxyz/'));
  assert.ok(urls.includes('https://www.douyin.com/video/7391234567890123456'));
  assert.ok(urls.includes('https://www.douyin.com/note/7391234567890123457'));
});

test('createBatchJob creates and tracks batch state', () => {
  const urls = [
    'https://v.douyin.com/iTest1/',
    'https://v.douyin.com/iTest2/',
  ];

  const job = createBatchJob(urls, { autoStart: false });
  assert.ok(job.id);
  assert.equal(job.totalItems, 2);
  assert.equal(job.items.length, 2);

  const found = getBatchJob(job.id);
  assert.ok(found);
  assert.equal(found.id, job.id);

  const cancelled = cancelBatchJob(job.id);
  assert.equal(cancelled, true);
  assert.equal(job.status, 'cancelled');
});

test('douyinMediaFromDetail prefers a complete MP4 stream and keeps metadata', () => {
  const info = douyinMediaFromDetail('7660061608801996068', {
    aweme_id: '7660061608801996068',
    desc: 'Video thử nghiệm',
    duration: 65_945,
    author: {
      nickname: 'Tác giả',
      avatar_thumb: { url_list: ['https://cdn.example/avatar.jpeg'] },
    },
    video: {
      cover: { url_list: ['https://cdn.example/cover.jpeg'] },
      bit_rate: [
        {
          format: 'dash',
          bit_rate: 4_000_000,
          play_addr: { data_size: 40_000_000, url_list: ['https://cdn.example/video-only.mp4'] },
        },
        {
          format: 'mp4',
          bit_rate: 3_000_000,
          play_addr: { data_size: 27_000_000, url_list: ['https://cdn.example/complete.mp4'] },
        },
      ],
    },
  });

  assert.equal(info.downloadUrl, 'https://cdn.example/complete.mp4');
  assert.equal(info.expectedBytes, 27_000_000);
  assert.equal(info.duration, 66);
  assert.equal(info.title, 'Video thử nghiệm');
  assert.equal(info.author, 'Tác giả');
  assert.equal(info.isNote, false);
});

test('download validation rejects empty or non-video responses', () => {
  const empty = new Response('', { headers: { 'content-length': '0' } });
  assert.match(douyinResponseProblem(empty) || '', /0 byte/);

  const challenge = new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '22' } });
  assert.match(douyinResponseProblem(challenge) || '', /thay vì video/);

  const media = new Response('video', { headers: { 'content-type': 'video/mp4', 'content-length': '5' } });
  assert.equal(douyinResponseProblem(media), undefined);
});

test('MP4 signature validation checks the ftyp box', () => {
  assert.equal(isLikelyMp4Header(Buffer.from('000000206674797069736f6d00000200', 'hex')), true);
  assert.equal(isLikelyMp4Header(Buffer.from('<html>blocked</html>')), false);
});
