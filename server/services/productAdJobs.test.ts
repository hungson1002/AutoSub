import assert from 'node:assert/strict';
import test from 'node:test';
import { assessProductAdVideoQuality, buildVeo3PromptPack, parseProductAdPlan, summarizeProductAdError } from './productAdJobs';

test('parseProductAdPlan normalizes a usable short-form plan', () => {
  const narration = 'Sản phẩm này giúp giữ điện thoại ổn định khi xem video, có thể điều chỉnh góc nhìn và sử dụng thuận tiện trên bàn làm việc mỗi ngày.';
  const plan = parseProductAdPlan({
    title: 'Giá đỡ điện thoại cho góc xem gọn hơn',
    caption: 'Một lựa chọn gọn cho bàn làm việc.',
    disclosure: 'Video có chứa liên kết tiếp thị liên kết.',
    hashtags: ['giadodienthoai', '#goclamviec'],
    scenes: [
      { imageIndex: 0, headline: 'Cầm máy quá lâu?', narration },
      { imageIndex: 1, headline: 'Điều chỉnh góc nhìn', narration },
      { imageIndex: 9, headline: 'Xem mẫu đang dùng', narration },
    ],
  }, 2, 75);
  assert.equal(plan.scenes.length, 3);
  assert.equal(plan.scenes[2].imageIndex, 1);
  assert.deepEqual(plan.hashtags, ['#giadodienthoai', '#goclamviec']);
});

test('parseProductAdPlan rejects a script far below the target duration', () => {
  assert.throws(() => parseProductAdPlan({
    title: 'Quá ngắn',
    scenes: [
      { imageIndex: 0, headline: 'Hook', narration: 'Một câu rất ngắn.' },
      { imageIndex: 0, headline: 'CTA', narration: 'Xem sản phẩm ngay.' },
    ],
}, 1, 90), /chưa bám thời lượng/);
});

test('parseProductAdPlan accepts one complete Veo scene for a 10-second ad', () => {
  const plan = parseProductAdPlan({
    title: 'Quảng cáo 10 giây',
    scenes: [{
      imageIndex: 0,
      headline: 'Xem sản phẩm rõ hơn',
      narration: 'Sản phẩm được giới thiệu ngắn gọn, đúng tính năng đã cung cấp và kết thúc bằng lời kêu gọi xem liên kết.',
      visualPrompt: 'A realistic vertical product demonstration with a slow camera push-in.',
      continuity: 'Keep the exact orange product, dark desk and warm studio lighting.',
    }],
  }, 1, 20, 1);
  assert.equal(plan.scenes.length, 1);
});

test('summarizeProductAdError removes the FFmpeg build banner', () => {
  const error = new Error([
    'ffmpeg version 9.0 Copyright FFmpeg',
    '  built with gcc',
    '  configuration: --enable-gpl',
    '  libavutil 61.1.100',
    'Fontconfig error: Cannot load default config file',
  ].join('\n'));
  assert.equal(summarizeProductAdError(error), 'Fontconfig error: Cannot load default config file');
});

test('assessProductAdVideoQuality accepts a healthy vertical video', () => {
  const result = assessProductAdVideoQuality({
    format: { duration: '9.8' },
    streams: [
      { codec_type: 'video', width: 720, height: 1280 },
      { codec_type: 'audio' },
    ],
  }, [], 10);
  assert.deepEqual(result, { durationMs: 9800, width: 720, height: 1280, warnings: [] });
});

test('assessProductAdVideoQuality rejects broken output before completion', () => {
  assert.throws(() => assessProductAdVideoQuality({
    format: { duration: '10' },
    streams: [{ codec_type: 'video', width: 1280, height: 720 }, { codec_type: 'audio' }],
  }, [], 10), /sai tỷ lệ dọc/);
  assert.throws(() => assessProductAdVideoQuality({
    format: { duration: '10' },
    streams: [{ codec_type: 'video', width: 720, height: 1280 }, { codec_type: 'audio' }],
  }, [3.2], 10), /hình đen/);
});

test('buildVeo3PromptPack splits duration into clips no longer than 10 seconds', () => {
  const pack = buildVeo3PromptPack({
    title: 'Quảng cáo sản phẩm',
    caption: 'Caption',
    disclosure: 'Có liên kết tiếp thị liên kết.',
    hashtags: ['#sanpham'],
    scenes: [1, 2, 3].map((index) => ({
      id: `scene-${index}`,
      imageIndex: index - 1,
      headline: `Cảnh ${index}`,
      narration: `Đây là lời thoại tiếng Việt cho cảnh số ${index}.`,
      visualPrompt: `A realistic product shot for scene ${index}.`,
      continuity: 'Orange product on a clean dark desk, soft warm key light.',
    })),
  }, 25, 'Sản phẩm mẫu');

  assert.equal(pack.clips.length, 3);
  assert.deepEqual(pack.clips.map((clip) => clip.durationSeconds), [10, 10, 5]);
  assert.deepEqual(pack.clips.map((clip) => [clip.startSeconds, clip.endSeconds]), [[0, 10], [10, 20], [20, 25]]);
  assert.match(pack.clips[0].prompt, /vertical 9:16/);
  assert.match(pack.clips[0].prompt, /four deliberate hard-cut micro-shots/);
  assert.match(pack.clips[0].prompt, /attached product image/);
  assert.match(pack.clips[0].prompt, /never morph/);
  assert.match(pack.clips[0].prompt, /do not generate on-screen text/i);
  assert.doesNotMatch(pack.clips[0].prompt, /voice-over says exactly/);
  assert.doesNotMatch(pack.clips[0].prompt, /supplied image \d+/);
  assert.equal(pack.clips[0].narration, 'Đây là lời thoại tiếng Việt cho cảnh số 1.');
});
