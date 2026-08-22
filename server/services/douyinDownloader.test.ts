import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cancelBatchJob,
  createBatchJob,
  downloadTurboStream,
  douyinResponseProblem,
  extractDouyinUrls,
  getBatchJob,
  isLikelyMp4Header,
  recommendedBilibiliConnections,
} from './douyinDownloader';
import { douyinMediaFromDetail } from './douyinExtractor';

test('extractDouyinUrls extracts Douyin and Bilibili links from text', () => {
  const sampleText = `
    7.11 02/05 o@v.cn 7.14 复制打开抖音，看看【xxx的作品】 https://v.douyin.com/iABCxyz/ 01/18
    Xem thêm: https://www.douyin.com/video/7391234567890123456 và link ảnh https://www.douyin.com/note/7391234567890123457
    Trùng lặp: https://v.douyin.com/iABCxyz/
    Bilibili: https://www.bilibili.com/video/BV1xx411c7mD?p=1 và https://b23.tv/abcXYZ
  `;

  const urls = extractDouyinUrls(sampleText);
  assert.equal(urls.length, 5);
  assert.ok(urls.includes('https://v.douyin.com/iABCxyz/'));
  assert.ok(urls.includes('https://www.douyin.com/video/7391234567890123456'));
  assert.ok(urls.includes('https://www.douyin.com/note/7391234567890123457'));
  assert.ok(urls.includes('https://www.bilibili.com/video/BV1xx411c7mD?p=1'));
  assert.ok(urls.includes('https://b23.tv/abcXYZ'));
});

test('createBatchJob creates and tracks batch state', () => {
  const urls = [
    'https://v.douyin.com/iTest1/',
    'https://v.douyin.com/iTest2/',
  ];

  const job = createBatchJob(urls, { autoStart: false, bilibiliQuality: 16 });
  assert.ok(job.id);
  assert.equal(job.totalItems, 2);
  assert.equal(job.items.length, 2);
  assert.equal(job.items[0].bilibiliQuality, 16);

  const found = getBatchJob(job.id);
  assert.ok(found);
  assert.equal(found.id, job.id);

  const cancelled = cancelBatchJob(job.id);
  assert.equal(cancelled, true);
  assert.equal(job.status, 'cancelled');
});

test('Bilibili turbo profile uses more connections for ordinary files and backs off for huge files', () => {
  assert.equal(recommendedBilibiliConnections(16 * 1024 * 1024), 4);
  assert.equal(recommendedBilibiliConnections(512 * 1024 * 1024), 8);
  assert.equal(recommendedBilibiliConnections(2 * 1024 * 1024 * 1024), 6);
  assert.equal(recommendedBilibiliConnections(5 * 1024 * 1024 * 1024), 4);
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

test('parallel downloader resumes a Bilibili range after a terminated stream', async () => {
  const originalFetch = globalThis.fetch;
  const totalBytes = 6 * 1024 * 1024;
  const bytes = Buffer.alloc(totalBytes, 7);
  let interrupted = false;
  let throttled = false;
  globalThis.fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get('range') || '';
    const match = range.match(/bytes=(\d+)-(\d+)/);
    assert.ok(match);
    const start = Number(match[1]);
    const end = Number(match[2]);

    if (start === 0 && !throttled) {
      throttled = true;
      return new Response('gateway timeout', { status: 504 });
    }

    if (start === 0 && !interrupted) {
      interrupted = true;
      const partial = bytes.subarray(0, 256 * 1024);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(partial);
          controller.error(new Error('terminated'));
        },
      }), { status: 206 });
    }

    return new Response(bytes.subarray(start, end + 1), { status: 206 });
  };

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'autosub-bilibili-'));
  const target = path.join(tempDir, 'video.mp4');
  try {
    const downloaded = await downloadTurboStream(
      'https://cdn.example/video.mp4',
      target,
      totalBytes,
      {},
      new AbortController().signal,
      () => undefined,
      3,
    );
    assert.equal(downloaded, totalBytes);
    assert.deepEqual(await readFile(target), bytes);
    assert.equal(throttled, true);
    assert.equal(interrupted, true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});
