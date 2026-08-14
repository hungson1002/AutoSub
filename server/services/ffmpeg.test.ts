import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupTemporaryFiles } from './ffmpeg';

test('temporary cleanup preserves uploads, final results and active jobs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autosub-cleanup-'));
  const completed = path.join(root, 'jobs', 'completed-job');
  const active = path.join(root, 'jobs', 'active-job');
  const completedReview = path.join(root, 'review-jobs', 'completed-review');
  try {
    await Promise.all([
      mkdir(path.join(root, 'uploads', 'source'), { recursive: true }),
      mkdir(path.join(root, 'frames'), { recursive: true }),
      mkdir(path.join(completed, 'cache'), { recursive: true }),
      mkdir(path.join(completed, 'timeline'), { recursive: true }),
      mkdir(path.join(completed, 'result'), { recursive: true }),
      mkdir(path.join(active, 'cache'), { recursive: true }),
      mkdir(path.join(completedReview, 'clips'), { recursive: true }),
      mkdir(path.join(completedReview, 'result'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, 'uploads', 'source', 'video.mp4'), 'source'),
      writeFile(path.join(root, 'frames', 'frame.jpg'), 'frame'),
      writeFile(path.join(completed, 'job.json'), JSON.stringify({ status: 'completed' })),
      writeFile(path.join(completed, 'cache', 'raw.wav'), 'cache'),
      writeFile(path.join(completed, 'timeline', 'batch.wav'), 'timeline'),
      writeFile(path.join(completed, 'result', 'dub-track.wav'), 'result'),
      writeFile(path.join(active, 'job.json'), JSON.stringify({ status: 'running' })),
      writeFile(path.join(active, 'cache', 'raw.wav'), 'active'),
      writeFile(path.join(completedReview, 'job.json'), JSON.stringify({ status: 'completed' })),
      writeFile(path.join(completedReview, 'clips', 'segment.mp4'), 'clip'),
      writeFile(path.join(completedReview, 'result', 'review.mp4'), 'review'),
    ]);

    const result = await cleanupTemporaryFiles(root, 0);
    assert.ok(result.removedFiles >= 3);
    assert.equal(await readFile(path.join(root, 'uploads', 'source', 'video.mp4'), 'utf8'), 'source');
    assert.equal(await readFile(path.join(completed, 'result', 'dub-track.wav'), 'utf8'), 'result');
    assert.equal(await readFile(path.join(active, 'cache', 'raw.wav'), 'utf8'), 'active');
    assert.equal(await readFile(path.join(completedReview, 'result', 'review.mp4'), 'utf8'), 'review');
    await assert.rejects(() => stat(path.join(root, 'frames', 'frame.jpg')));
    await assert.rejects(() => stat(path.join(completed, 'cache')));
    await assert.rejects(() => stat(path.join(completedReview, 'clips')));
    assert.equal(result.skippedActiveJobs, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
