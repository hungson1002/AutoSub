import test from 'node:test';
import assert from 'node:assert/strict';
import { isBilibiliUrl, resolveBilibiliUrl } from './bilibiliExtractor';

test('isBilibiliUrl accepts supported public video hosts', () => {
  assert.equal(isBilibiliUrl('https://www.bilibili.com/video/BV1xx411c7mD'), true);
  assert.equal(isBilibiliUrl('https://b23.tv/abcXYZ'), true);
  assert.equal(isBilibiliUrl('https://example.com/video/BV1xx411c7mD'), false);
});

test('resolveBilibiliUrl reads metadata and a public MP4 stream', async () => {
  const originalFetch = globalThis.fetch;
  let requestedPlayUrl = '';
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/x/web-interface/view?')) {
      return Response.json({
        code: 0,
        data: {
          aid: 2,
          bvid: 'BV1xx411c7mD',
          cid: 62131,
          title: 'Video thử nghiệm',
          pic: 'http://cdn.example/cover.jpg',
          duration: 120,
          owner: { name: 'Tác giả', face: '//cdn.example/avatar.jpg' },
          pages: [{ cid: 62131, page: 1, part: 'Phần 1', duration: 120 }],
        },
      });
    }
    if (url.includes('/x/player/playurl?')) {
      requestedPlayUrl = url;
      return Response.json({
        code: 0,
        data: {
          durl: [{
            url: 'https://cdn.example/video.mp4',
            backup_url: ['https://backup.example/video.mp4'],
            size: 12_345,
            length: 120_000,
          }],
          timelength: 120_000,
        },
      });
    }
    return new Response('', { status: 404 });
  };

  try {
    const info = await resolveBilibiliUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=1', undefined, 16);
    assert.equal(info.platform, 'bilibili');
    assert.equal(info.videoId, 'BV1xx411c7mD');
    assert.equal(info.title, 'Video thử nghiệm');
    assert.equal(info.author, 'Tác giả');
    assert.equal(info.coverUrl, 'https://cdn.example/cover.jpg');
    assert.equal(info.downloadUrl, 'https://cdn.example/video.mp4');
    assert.deepEqual(info.backupUrls, ['https://backup.example/video.mp4']);
    assert.deepEqual(info.backupUrls, ['https://backup.example/video.mp4']);
    assert.equal(info.expectedBytes, 12_345);
    assert.match(requestedPlayUrl, /[?&]qn=16(?:&|$)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveBilibiliUrl rejects a paid preview before downloading', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/x/web-interface/view?')) {
      return Response.json({
        code: 0,
        data: {
          aid: 3,
          bvid: 'BV1PaidPreview',
          cid: 33,
          title: 'Video trả phí',
          duration: 17_506,
          pages: [{ cid: 33, duration: 17_506 }],
        },
      });
    }
    return Response.json({
      code: 0,
      data: {
        timelength: 35 * 60_000,
        durl: [{
          url: 'https://cdn.example/preview.mp4',
          size: 260_000_000,
          length: 35 * 60_000,
        }],
      },
    });
  };

  try {
    await assert.rejects(
      resolveBilibiliUrl('https://www.bilibili.com/video/BV1PaidPreview'),
      /yêu cầu trả phí.*35 phút/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
