import { strict as assert } from 'node:assert';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { AIProvider } from '../types';
import { ProviderError } from '../adapters';
import { workdir } from './ffmpeg';
import { buildSeparatedAudioMixFilter, buildStemAudioMixFilter, buildTimelineMixFilter, canFitSpeechWithoutCut, createDubbingJob, cueBoundaryFades, cueDeclickFilter, dubbingRewriteWordLimit, effectiveTtsConcurrency, findLatestDubbingJobByVideoId, fittingTempo, getDubbingJobStatus, isRewriteUnavailableError, isTransientDubbingError, isUsefulDubbingRewrite, planAdaptiveCueTempos, planDubbingTimeline, queueDubbingCueRegeneration, recoverDubbingJob, retryDubbingOperation, speechTrimFilter, startDubbingJob, tempoFilter } from './dubbingJobs';

const jobsPath = path.join(workdir, 'jobs');
const fakeProvider: AIProvider = { id: 'synthetic-provider', name: 'Synthetic Provider', baseUrl: 'http://127.0.0.1:1/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { chat: true, tts: true } };
const capcutProvider: AIProvider = { id: 'capcut-tts-local', name: 'CapCut TTS', baseUrl: 'local://capcut-tts', enabled: true, models: [], providerType: 'capcut-tts', authType: 'none', capabilities: { tts: true } };

function cues(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `synthetic-${index + 1}`, index: index + 1, startMs: index * 2500, endMs: index * 2500 + 1800, originalText: `Original cue ${index + 1}`, translatedText: `Translated cue ${index + 1}`, text: `Translated cue ${index + 1}`, previousText: index ? `Translated cue ${index}` : '', nextText: `Translated cue ${index + 2}`, provider: fakeProvider, model: 'synthetic-model', voice: 'synthetic-voice', speed: 1, volume: 1 }));
}

async function cleanup(id: string) { await rm(path.join(jobsPath, id), { recursive: true, force: true }); }

async function waitForTerminal(id: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await getDubbingJobStatus(id);
    if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Job ${id} did not reach a terminal state in time.`);
}

test('timeline mix preserves cue gain instead of normalizing it by batch size', () => {
  const filter = buildTimelineMixFilter(29, 79_180);
  assert.match(filter, /amix=inputs=29:duration=longest:dropout_transition=0:normalize=0/);
  assert.match(filter, /alimiter=limit=0\.891:level=false/);
  assert.match(filter, /apad=whole_dur=79\.180,atrim=end=79\.180/);
  assert.doesNotMatch(filter, /,apad,/);
});

test('final separated-audio mix is finite and carries a hard output duration', () => {
  const mix = buildSeparatedAudioMixFilter(84_600, 0.25);
  assert.equal(mix.duration, '84.600');
  assert.match(mix.filter, /apad=whole_dur=84\.600,atrim=end=84\.600/);
  assert.match(mix.filter, /volume=0\.250/);
  assert.match(mix.filter, /asplit=2\[dub\]\[sidechain\]/);
  assert.match(mix.filter, /sidechaincompress=threshold=0\.005:ratio=12/);
  assert.match(mix.filter, /amix=inputs=2:duration=first/);
  assert.doesNotMatch(mix.filter, /,apad,/);
});

test('stem mix combines selected source stems only once before ducking under dub', () => {
  const mix = buildStemAudioMixFilter(84_600, 0.25, 2);
  assert.match(mix.filter, /\[1:a\].*\[stem0\]/);
  assert.match(mix.filter, /\[2:a\].*\[stem1\]/);
  assert.match(mix.filter, /amix=inputs=2:duration=longest/);
  assert.match(mix.filter, /sidechaincompress/);
});

test('cue boundaries retain natural room tone and use click-safe fades', () => {
  assert.equal((speechTrimFilter.match(/start_silence=0\.04/g) || []).length, 2);
  const fades = cueBoundaryFades(3_066);
  assert.equal(fades.fadeInDuration, 0.08);
  assert.equal(fades.fadeOutDuration, 0.08);
  assert.ok(Math.abs(fades.fadeOutStart - 2.986) < 0.000_001);
  assert.equal(cueDeclickFilter, 'adeclick=w=20:o=75:a=4:t=1.5:b=2:m=s,adeclick=w=20:o=75:a=4:t=1.5:b=2:m=s');
});

test('CapCut jobs are serialized and narration is sped up without padding or trimming', async () => {
  const capcutCue = { ...cues(1)[0], provider: capcutProvider };
  assert.equal(effectiveTtsConcurrency([capcutCue], 3), 1);
  assert.equal(effectiveTtsConcurrency(cues(1), 3), 3);
  assert.match(tempoFilter(1.25), /rubberband=tempo=1\.250/);
  assert.doesNotMatch(tempoFilter(1.25), /apad|atrim/);
  assert.doesNotMatch(tempoFilter(1.25), /alimiter/);
  assert.equal(tempoFilter(1), 'anull');
  assert.equal(fittingTempo(0.65), 1);
  assert.equal(fittingTempo(0.90), 1);
  assert.equal(fittingTempo(1.08), 1.08);
  assert.equal(fittingTempo(3), 1.18);
  assert.match(speechTrimFilter, /^silenceremove=.*areverse.*silenceremove=.*areverse$/);
  assert.equal(canFitSpeechWithoutCut(2_626, 2_500), true);
  assert.equal(canFitSpeechWithoutCut(6_089, 1_880), false);

  const job = await createDubbingJob({ cues: [capcutCue], ttsConcurrency: 3 });
  try { assert.equal(job.config.ttsConcurrency, 1); } finally { await cleanup(job.id); }
});

test('timeline planner preserves natural gaps and shifts later cues after an overrun', () => {
  const plan = planDubbingTimeline([
    { cueId: 'a', startMs: 0, endMs: 2_000, audioDurationMs: 2_000 },
    { cueId: 'b', startMs: 2_000, endMs: 3_000, audioDurationMs: 2_500 },
    { cueId: 'c', startMs: 3_000, endMs: 4_000, audioDurationMs: 1_000 },
    { cueId: 'd', startMs: 9_000, endMs: 10_000, audioDurationMs: 1_000 },
  ]);

  assert.deepEqual(plan.map(({ cueId, timelineStartMs, timelineEndMs, timelineShiftMs }) => ({ cueId, timelineStartMs, timelineEndMs, timelineShiftMs })), [
    { cueId: 'a', timelineStartMs: 0, timelineEndMs: 2_000, timelineShiftMs: 0 },
    { cueId: 'b', timelineStartMs: 2_000, timelineEndMs: 4_500, timelineShiftMs: 0 },
    { cueId: 'c', timelineStartMs: 4_520, timelineEndMs: 5_520, timelineShiftMs: 1_520 },
    { cueId: 'd', timelineStartMs: 9_000, timelineEndMs: 10_000, timelineShiftMs: 0 },
  ]);
});

test('timeline planner never pulls a cue earlier than its source timestamp', () => {
  const plan = planDubbingTimeline([
    { cueId: 'a', startMs: 0, endMs: 2_000, audioDurationMs: 1_100 },
    { cueId: 'b', startMs: 2_000, endMs: 4_000, audioDurationMs: 1_300 },
    { cueId: 'c', startMs: 6_000, endMs: 7_000, audioDurationMs: 700 },
  ]);
  assert.equal(plan[1].timelineStartMs, 2_000);
  assert.equal(plan[1].timelineShiftMs, 0);
  assert.equal(plan[2].timelineStartMs, 6_000);
  assert.ok(plan.every((cue) => cue.timelineStartMs >= cue.startMs));
});

test('adaptive fitting shares a long cue across a bounded local cue group', () => {
  const plan = planAdaptiveCueTempos([
    { cueId: '13', startMs: 35_280, endMs: 36_800, targetDurationMs: 1_520, audioDurationMs: 1_775 },
    { cueId: '14', startMs: 36_800, endMs: 39_160, targetDurationMs: 2_360, audioDurationMs: 3_271 },
    { cueId: '15', startMs: 39_160, endMs: 42_600, targetDurationMs: 3_440, audioDurationMs: 2_660 },
    { cueId: '16', startMs: 42_600, endMs: 43_960, targetDurationMs: 1_360, audioDurationMs: 1_730 },
    { cueId: '17', startMs: 43_960, endMs: 45_080, targetDurationMs: 1_120, audioDurationMs: 949 },
    { cueId: '18', startMs: 45_080, endMs: 48_080, targetDurationMs: 3_000, audioDurationMs: 2_749 },
  ]);
  const byId = new Map(plan.map((item) => [item.cueId, item.tempo]));
  assert.ok((byId.get('14') || 0) > 1.02);
  assert.ok((byId.get('14') || 2) < 1.06);
  assert.equal(byId.get('13'), byId.get('14'));
  assert.equal(byId.get('14'), byId.get('15'));
  assert.equal(byId.get('14'), byId.get('16'));
  assert.equal(byId.get('14'), byId.get('17'));
  assert.equal(byId.get('14'), byId.get('18'));
  assert.ok(plan.every((item) => item.tempo <= 1.18));
});

test('adaptive fitting does not spread tempo across a real pause', () => {
  const plan = planAdaptiveCueTempos([
    { cueId: 'before', startMs: 0, endMs: 1_000, targetDurationMs: 1_000, audioDurationMs: 1_000 },
    { cueId: 'long', startMs: 1_000, endMs: 2_000, targetDurationMs: 1_000, audioDurationMs: 1_500 },
    { cueId: 'after-gap', startMs: 4_000, endMs: 5_000, targetDurationMs: 1_000, audioDurationMs: 1_000 },
  ]);
  const byId = new Map(plan.map((item) => [item.cueId, item.tempo]));
  assert.equal(byId.get('before'), byId.get('long'));
  assert.equal(byId.get('after-gap'), 1);
});

test('auto cadence shares sustained timing pressure across a dense block', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    cueId: `dense-${index + 1}`,
    startMs: index * 1_000,
    endMs: index * 1_000 + 1_000,
    targetDurationMs: 1_000,
    audioDurationMs: index % 4 === 3 ? 900 : 1_220,
  }));
  const plan = planAdaptiveCueTempos(items);
  const byId = new Map(plan.map((item) => [item.cueId, item.tempo]));

  assert.ok((byId.get('dense-1') || 0) > 1.15);
  assert.equal(byId.get('dense-1'), byId.get('dense-4'));
  assert.equal(byId.get('dense-4'), byId.get('dense-10'));
  assert.ok(plan.every((item) => item.tempo >= 1 && item.tempo <= 1.5));

  const timeline = planDubbingTimeline(items.map((item) => ({
    cueId: item.cueId,
    startMs: item.startMs,
    endMs: item.endMs,
    audioDurationMs: item.audioDurationMs / (byId.get(item.cueId) || 1),
  })));
  // The whole run shares one natural cadence, so a tiny final ripple is
  // preferable to forcing only the long lines to race at their individual
  // SRT speed.
  assert.ok(Math.max(...timeline.map((item) => item.timelineShiftMs)) <= 180);
});

test('auto cadence distributes an extreme cue across its continuous block', () => {
  const plan = planAdaptiveCueTempos(Array.from({ length: 8 }, (_, index) => ({
    cueId: `extreme-${index + 1}`,
    startMs: index * 1_000,
    endMs: index * 1_000 + 1_000,
    targetDurationMs: 1_000,
    audioDurationMs: index === 3 ? 1_900 : 1_100,
  })));
  const byId = new Map(plan.map((item) => [item.cueId, item.tempo]));

  assert.ok((byId.get('extreme-4') || 0) > 1.2);
  assert.equal(byId.get('extreme-4'), byId.get('extreme-1'));
});

test('auto cadence leaves a roomy short block at the conservative speed', () => {
  const plan = planAdaptiveCueTempos([
    { cueId: 'short-1', startMs: 0, endMs: 1_000, targetDurationMs: 1_000, audioDurationMs: 900 },
    { cueId: 'short-2', startMs: 2_000, endMs: 3_000, targetDurationMs: 1_000, audioDurationMs: 1_600 },
    { cueId: 'short-3', startMs: 4_000, endMs: 5_000, targetDurationMs: 1_000, audioDurationMs: 900 },
    { cueId: 'short-4', startMs: 6_000, endMs: 7_000, targetDurationMs: 1_000, audioDurationMs: 900 },
  ]);
  const byId = new Map(plan.map((item) => [item.cueId, item.tempo]));

  assert.equal(byId.get('short-1'), 1);
  assert.equal(byId.get('short-2'), 1);
  assert.equal(byId.get('short-3'), 1);
  assert.equal(byId.get('short-4'), 1);
});

test('roomy long-form cue does not speed up just to match its own SRT window', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    cueId: `final-fit-${index + 1}`,
    startMs: index * 1_200,
    endMs: index * 1_200 + 1_000,
    targetDurationMs: 1_000,
    audioDurationMs: index === 5 ? 1_420 : 900,
  }));
  const plan = planAdaptiveCueTempos(items);
  const byId = new Map(plan.map((item) => [item.cueId, item.tempo]));

  assert.equal(byId.get('final-fit-6'), 1);
  assert.equal(byId.get('final-fit-1'), 1);
});

test('uses nearby cue slack instead of forcing the long middle cue to 1.4x', () => {
  const items = [
    { cueId: '13', startMs: 35_280, endMs: 36_800, targetDurationMs: 1_520, audioDurationMs: 1_855 },
    { cueId: '14', startMs: 36_800, endMs: 39_160, targetDurationMs: 2_360, audioDurationMs: 3_351 },
    { cueId: '15', startMs: 39_160, endMs: 42_600, targetDurationMs: 3_440, audioDurationMs: 2_740 },
    { cueId: '16', startMs: 42_600, endMs: 43_960, targetDurationMs: 1_360, audioDurationMs: 1_810 },
    { cueId: '17', startMs: 43_960, endMs: 45_080, targetDurationMs: 1_120, audioDurationMs: 1_029 },
    { cueId: '18', startMs: 45_080, endMs: 48_080, targetDurationMs: 3_000, audioDurationMs: 2_829 },
  ];
  const plan = planAdaptiveCueTempos(items);
  const byId = new Map(plan.map((item) => [item.cueId, item.tempo]));
  const sharedTempo = byId.get('14') || 0;

  assert.ok(sharedTempo > 1.05 && sharedTempo < 1.10);
  assert.equal(byId.get('13'), sharedTempo);
  assert.equal(byId.get('15'), sharedTempo);
  assert.equal(byId.get('16'), sharedTempo);
  assert.equal(byId.get('17'), sharedTempo);
  assert.equal(byId.get('18'), sharedTempo);

  const timeline = planDubbingTimeline(items.map((item) => ({
    cueId: item.cueId,
    startMs: item.startMs,
    endMs: item.endMs,
    audioDurationMs: item.audioDurationMs / (byId.get(item.cueId) || 1),
  })));
  assert.ok(timeline.every((cue) => cue.timelineStartMs >= cue.startMs));
  assert.ok(timeline[timeline.length - 1].timelineEndMs <= items[items.length - 1].endMs + 20);
});

test('final fit does not speed an isolated line in a short video', () => {
  const plan = planAdaptiveCueTempos([
    { cueId: 'short-a', startMs: 0, endMs: 1_000, targetDurationMs: 1_000, audioDurationMs: 900 },
    { cueId: 'short-b', startMs: 2_000, endMs: 3_000, targetDurationMs: 1_000, audioDurationMs: 1_300 },
  ]);
  const byId = new Map(plan.map((item) => [item.cueId, item.tempo]));
  assert.equal(byId.get('short-b'), byId.get('short-a'));
  assert.ok((byId.get('short-b') || 0) <= 1.18);
});

test('finds the latest persisted dubbing job for an existing uploaded video', async () => {
  const videoId = `restore-${crypto.randomUUID()}`;
  const first = await createDubbingJob({ videoId, cues: cues(1) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await createDubbingJob({ videoId, cues: cues(1) });
  try {
    assert.equal((await findLatestDubbingJobByVideoId(videoId))?.id, second.id);
  } finally {
    await cleanup(first.id);
    await cleanup(second.id);
  }
});

test('queues only the edited cue for voice regeneration', async () => {
  const job = await createDubbingJob({ cues: cues(3) });
  const directory = path.join(jobsPath, job.id);
  try {
    const persistedPath = path.join(directory, 'job.json');
    const persisted = JSON.parse(await readFile(persistedPath, 'utf8')) as Record<string, unknown>;
    persisted.status = 'completed';
    persisted.doneCues = 3;
    persisted.result = { audioFile: 'result/dub-track.wav', metadataFile: 'result/metadata.json', durationMs: 6000 };
    await writeFile(persistedPath, JSON.stringify(persisted), 'utf8');
    for (let index = 1; index <= 3; index += 1) {
      const cuePath = path.join(directory, 'cues', `synthetic-${index}.json`);
      const cue = JSON.parse(await readFile(cuePath, 'utf8')) as Record<string, unknown>;
      cue.status = 'done';
      cue.audioFile = `cues/synthetic-${index}.wav`;
      cue.metadata = { cueId: `synthetic-${index}`, adaptiveFitVersion: 1 };
      await writeFile(cuePath, JSON.stringify(cue), 'utf8');
    }

    const status = await queueDubbingCueRegeneration(job.id, 'synthetic-2', { text: 'Nội dung vừa sửa', translatedText: 'Nội dung vừa sửa' });
    assert.equal(status.status, 'queued');
    assert.equal(status.doneCues, 2);
    const first = JSON.parse(await readFile(path.join(directory, 'cues', 'synthetic-1.json'), 'utf8')) as { status: string };
    const edited = JSON.parse(await readFile(path.join(directory, 'cues', 'synthetic-2.json'), 'utf8')) as { status: string; input: { text: string }; metadata?: unknown; audioFile?: string };
    const third = JSON.parse(await readFile(path.join(directory, 'cues', 'synthetic-3.json'), 'utf8')) as { status: string };
    assert.equal(first.status, 'done');
    assert.equal(third.status, 'done');
    assert.equal(edited.status, 'pending');
    assert.equal(edited.input.text, 'Nội dung vừa sửa');
    assert.equal(edited.metadata, undefined);
    assert.equal(edited.audioFile, undefined);
  } finally {
    await cleanup(job.id);
  }
});

test('persists synthetic jobs with 100, 1000 and 3000 cues', { timeout: 120_000 }, async () => {
  const ids: string[] = [];
  try {
    for (const count of [100, 1000, 3000]) {
      const job = await createDubbingJob({ cues: cues(count), batchSize: 30 });
      ids.push(job.id);
      const status = await getDubbingJobStatus(job.id);
      assert.equal(status.totalCues, count);
      assert.equal(status.doneCues, 0);
      assert.equal(status.progressPercent, 0);
      assert.equal(status.config.batchSize, 30);
      assert.deepEqual(status.config.audioMix, { mode: 'original', keepOriginal: true, originalVolume: 0.25, separateVocals: false });
      assert.equal(status.providerInfo.length, 1);
    }
  } finally { await Promise.all(ids.map(cleanup)); }
});

test('crash recovery resets processing cues but keeps done and failed checkpoints', async () => {
  const job = await createDubbingJob({ cues: cues(3) });
  try {
    const first = path.join(jobsPath, job.id, 'cues', 'synthetic-1.json');
    const second = path.join(jobsPath, job.id, 'cues', 'synthetic-2.json');
    const jobFile = path.join(jobsPath, job.id, 'job.json');
    const firstCue = JSON.parse(await readFile(first, 'utf8')) as { status: string };
    const secondCue = JSON.parse(await readFile(second, 'utf8')) as { status: string };
    firstCue.status = 'tts';
    secondCue.status = 'done';
    await writeFile(first, JSON.stringify(firstCue));
    await writeFile(second, JSON.stringify(secondCue));
    const storedJob = JSON.parse(await readFile(jobFile, 'utf8')) as { status: string };
    storedJob.status = 'running';
    await writeFile(jobFile, JSON.stringify(storedJob));
    const recovered = await recoverDubbingJob(job.id);
    assert.equal(recovered.status, 'queued');
    assert.equal(recovered.doneCues, 1);
    const recoveredCue = JSON.parse(await readFile(first, 'utf8')) as { status: string };
    assert.equal(recoveredCue.status, 'pending');
  } finally { await cleanup(job.id); }
});

test('retry classifier retries 429, 5xx and network failures but not auth/client failures', () => {
  assert.equal(isTransientDubbingError(new ProviderError('rate limited', 429)), true);
  assert.equal(isTransientDubbingError(new ProviderError('usage_exceeded', 400)), false);
  assert.equal(isTransientDubbingError(new ProviderError('quota exceeded', 429)), false);
  assert.equal(isTransientDubbingError(new ProviderError('server', 500)), true);
  assert.equal(isTransientDubbingError(new TypeError('fetch failed')), true);
  assert.equal(isTransientDubbingError(new ProviderError('bad request', 400)), false);
  assert.equal(isTransientDubbingError(new ProviderError('unauthorized', 401)), false);
  assert.equal(isTransientDubbingError(new ProviderError('forbidden', 403)), false);
});

test('unsupported Chat capability is a rewrite fallback, not a failed TTS cue', () => {
  assert.equal(isRewriteUnavailableError(new ProviderError('ElevenLabs does not provide Chat capability.', 400)), true);
  assert.equal(isRewriteUnavailableError(new ProviderError('ElevenLabs không cung cấp capability Chat.', 400)), true);
  assert.equal(isRewriteUnavailableError(new ProviderError('Unauthorized', 401)), false);
  assert.equal(isRewriteUnavailableError(new ProviderError('Provider unavailable', 500)), false);
});

test('an unchanged or longer AI rewrite falls back instead of failing forever', () => {
  assert.equal(isUsefulDubbingRewrite('Một câu khá dài', 'Một câu khá dài'), false);
  assert.equal(isUsefulDubbingRewrite('Một câu khá dài', 'Một câu còn dài hơn nữa'), false);
  assert.equal(isUsefulDubbingRewrite('Một câu khá dài', 'Câu ngắn'), true);
  assert.equal(isUsefulDubbingRewrite('Một câu khá dài cần rút gọn', 'Một câu vẫn ngắn hơn'), true);
});

test('rewrite word limits tighten from measured CapCut audio instead of a fixed speaking rate', () => {
  const current = 'Đột nhiên trở thành siêu anh hùng thì sẽ là trải nghiệm như thế nào';
  const firstLimit = dubbingRewriteWordLimit(current, 2_880, 6_900, 1);
  const nextText = 'Trở thành siêu anh hùng sẽ thế nào';
  const secondLimit = dubbingRewriteWordLimit(nextText, 2_880, 4_630, 2);
  assert.ok(firstLimit < current.split(/\s+/).length);
  assert.ok(secondLimit < nextText.split(/\s+/).length);
  assert.ok(secondLimit <= 5);
});

test('rejects a shorter rewrite that repeats an adjacent cue', () => {
  assert.equal(isUsefulDubbingRewrite(
    'Đã thấy bạn mình ngồi thẫn thờ trên giường.',
    'Nhưng vừa đáp xuống đã thở phào.',
    ['Nhưng vừa đáp xuống, thở phào một cái'],
  ), false);
});

test('retry operation recovers from simulated 429 and 500, but stops on 400', { timeout: 10_000 }, async () => {
  const controller = new AbortController();
  let transientAttempts = 0;
  const recovered = await retryDubbingOperation(async () => {
    transientAttempts += 1;
    if (transientAttempts === 1) throw new ProviderError('rate limited', 429);
    if (transientAttempts === 2) throw new ProviderError('provider unavailable', 500);
    return 'ok';
  }, 3, controller.signal);
  assert.equal(recovered, 'ok');
  assert.equal(transientAttempts, 3);

  let clientAttempts = 0;
  await assert.rejects(() => retryDubbingOperation(async () => {
    clientAttempts += 1;
    throw new ProviderError('bad request', 400);
  }, 3, controller.signal));
  assert.equal(clientAttempts, 1);
});

test('one provider failure becomes one failed cue and does not loop forever', { timeout: 30_000 }, async () => {
  const job = await createDubbingJob({ cues: cues(1), maxRetries: 1 });
  try {
    await startDubbingJob(job.id);
    const status = await waitForTerminal(job.id);
    assert.equal(status.status, 'completed_with_errors');
    assert.equal(status.doneCues, 0);
    assert.equal(status.failedCues, 1);
    assert.deepEqual(status.failedCueIds, ['synthetic-1']);
  } finally { await cleanup(job.id); }
});
