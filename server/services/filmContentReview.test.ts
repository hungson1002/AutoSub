import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFilmReview, reviewFilmContent, configureFilmReviewer } from './filmContentReview';
import { run } from './ffmpeg';
import type { AIProvider } from '../types';

test('review does not turn uncertain observations into a pass or a definite defect', () => {
  const review = parseFilmReview(JSON.stringify({ checks: [{ criterion: 'action', verdict: 'uncertain', evidence: 'Contact happens between sampled frames.' }] }));
  assert.equal(review.status, 'needs-review');
  assert.equal(review.checks.some((check) => check.verdict === 'fail'), false);
});
test('review rejects invented verdicts and observations without evidence', () => {
  assert.throws(() => parseFilmReview('{"checks":[{"criterion":"props","verdict":"pass","evidence":""}]}'));
  assert.throws(() => parseFilmReview('{"checks":[{"criterion":"props","verdict":"perfect","evidence":"fine"}]}'));
});
test('a concrete mismatch retains the correction', () => {
  const review = parseFilmReview('```json\n{"checks":[{"criterion":"props","verdict":"fail","evidence":"Frame 4 has no headphones."}],"correction":"Keep headphones over both ears."}\n```');
  assert.equal(review.status, 'needs-review');
  assert.match(review.correction, /headphones/);
});
test('missing reviewer is explicitly unavailable without touching media or spending tokens', async () => {
  const review = await reviewFilmContent('unconfigured-test', { index: 1, title: 'Test', narration: '', visualPrompt: '', status: 'pending' }, 'missing.mp4', 'video', new AbortController().signal);
  assert.equal(review.status, 'unavailable');
  assert.deepEqual(review.checks, []);
});

test('video review sends a real contact sheet and keeps provider credentials out of the report', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'autosub-review-'));
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  try {
    const file = path.join(dir, 'clip.mp4');
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=12', '-t', '1', '-c:v', 'libx264', file]);
    const provider: AIProvider = { id: 'test', name: 'test', providerType: 'openai-compatible', baseUrl: 'https://example.test/v1', apiKey: 'private-test-key', enabled: true, models: [], authType: 'bearer', capabilities: { vision: true } };
    configureFilmReviewer('review-test', { provider, model: 'test-vision' });
    globalThis.fetch = async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"checks":[{"criterion":"action","verdict":"uncertain","evidence":"Only sampled frames available."}]}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const review = await reviewFilmContent('review-test', { index: 1, durationSeconds: 1, title: 'Test', narration: '', visualPrompt: 'Moving pattern', status: 'pending' }, file, 'video', new AbortController().signal);
    assert.equal(review.status, 'needs-review');
    assert.match(requestBody, /data:image\/jpeg;base64,/);
    assert.match(requestBody, /Six frames/);
    assert.doesNotMatch(JSON.stringify(review), /private-test-key/);
  } finally {
    globalThis.fetch = originalFetch;
    configureFilmReviewer('review-test');
    await rm(dir, { recursive: true, force: true });
  }
});
