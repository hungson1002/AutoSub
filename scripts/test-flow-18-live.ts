import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generateGoogleFlowImage,
  getGoogleFlowImagePoolCapacity,
  getGoogleFlowImagePoolRuntimeStats,
  resetGoogleFlowImagePoolRuntimeStats,
} from '../server/services/googleFlow';

const apiBase = String(process.env.AUTOSUB_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const live = process.argv.includes('--live');
const storyboard = process.argv.includes('--storyboard');
const runKey = randomUUID();
const assetKey = (name: string) => `autosub-asset-${createHash('sha256').update(`${runKey}:${name}`).digest('hex')}`;

if (!live) {
  throw new Error('This test submits 18 live Google Flow image generations. Re-run with --live after confirming the preflight conditions.');
}

const readJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Preflight HTTP ${response.status} for ${new URL(url).pathname}`);
  return response.json() as Promise<T>;
};

const jobs = await readJson<Array<{ id: string; status: string }>>(`${apiBase}/api/animation-studio/director-jobs`);
const activeJobs = jobs.filter((job) => ['queued', 'running', 'processing'].includes(job.status));
assert.equal(activeJobs.length, 0, `Refusing to start while ${activeJobs.length} animation job(s) are active.`);

const workerResponse = await readJson<{ workers: Array<{ clientId: string; state: string; tokenReady: boolean; extensionConnected: boolean }> }>(`${apiBase}/api/ai-video/flow-workers`);
const readyWorkers = workerResponse.workers.filter((worker) => worker.tokenReady && worker.extensionConnected);
assert.equal(readyWorkers.length, 9, `Refusing paid load test: ${readyWorkers.length}/9 Flow accounts are ready.`);
assert.ok(readyWorkers.every((worker) => worker.state === 'idle'), 'Refusing paid load test while a Flow account is already busy.');

const capacity = await getGoogleFlowImagePoolCapacity();
assert.equal(capacity.isolatedWorkers, true, 'Isolated Flow workers are not active in this process.');
assert.equal(capacity.accountCount, 9, `Flow pool sees ${capacity.accountCount}/9 accounts.`);
assert.equal(capacity.slotsPerAccount, 2);
if (!storyboard) assert.equal(capacity.recommendedSlots, 18, `Flow pool recommends ${capacity.recommendedSlots}/18 slots.`);
else console.log(`Production pool starts at ${capacity.recommendedSlots} active slots; submitting 18 storyboard images through its adaptive queue.`);
assert.equal(getGoogleFlowImagePoolRuntimeStats().active, 0, 'This process already has active Flow image work.');

const prompts = [
  'A clear educational illustration of a small greenhouse collecting sunlight through glass, no text.',
  'A clear educational illustration of a wind turbine turning above a green field, no text.',
  'A clear educational illustration of a river flowing through a hydroelectric dam, no text.',
  'A clear educational illustration of a seed sprouting roots inside a glass jar, no text.',
  'A clear educational illustration of a honeybee pollinating a yellow flower, no text.',
  'A clear educational illustration of the water cycle above a mountain lake, no text.',
  'A clear educational illustration of a simple robotic arm sorting colored blocks, no text.',
  'A clear educational illustration of a sailboat catching wind on calm water, no text.',
  'A clear educational illustration of a planet orbiting a bright star in space, no text.',
  'A clear educational illustration of a lighthouse guiding a ship at dusk, no text.',
  'A clear educational illustration of a bicycle gear turning its chain, no text.',
  'A clear educational illustration of a baker kneading dough on a wooden table, no text.',
  'A clear educational illustration of a coral reef with small fish and sea plants, no text.',
  'A clear educational illustration of a crane lifting a steel beam at a construction site, no text.',
  'A clear educational illustration of a red blood cell carrying oxygen through a vessel, no text.',
  'A clear educational illustration of a paper airplane gliding across a classroom, no text.',
  'A clear educational illustration of a snowflake forming on a cold window, no text.',
  'A clear educational illustration of an electric car charging beside a home, no text.',
];

const outputDir = await mkdtemp(path.join(os.tmpdir(), 'autosub-flow-18-lanes-'));
const referenceImagePath = storyboard ? path.join(outputDir, 'scene-anchor.png') : undefined;
if (referenceImagePath) {
  console.log('Creating one shared scene reference before the 18-image storyboard wave.');
  await generateGoogleFlowImage('A clean hand-drawn educational illustration of a small greenhouse in a garden, bold contours, flat warm colors, cream background, no lettering.', referenceImagePath, { size: '1024x1024', idempotencyKey: assetKey('anchor') });
}
const maxByClient = new Map<string, number>();
let peakActive = 0;
resetGoogleFlowImagePoolRuntimeStats();
const sample = () => {
  const stats = getGoogleFlowImagePoolRuntimeStats();
  peakActive = Math.max(peakActive, stats.peakActive);
  for (const [clientId, active] of Object.entries(stats.activeByClient)) {
    maxByClient.set(clientId, Math.max(maxByClient.get(clientId) || 0, active));
  }
};
const sampler = setInterval(sample, 50);
const startedAt = Date.now();

try {
  const results = await Promise.allSettled(prompts.map(async (prompt, index) => {
    const output = path.join(outputDir, `flow-${String(index + 1).padStart(2, '0')}.png`);
    const started = Date.now();
    await generateGoogleFlowImage(prompt, output, {
      size: '1024x1024', referenceImagePath,
      ...(storyboard ? { idempotencyKey: assetKey(`shot-${index}`) } : {}),
      onProgress: (message) => { console.log(`Image ${index + 1}: ${message}`); },
    });
    const metadata = await sharp(output).metadata();
    assert.ok(metadata.width && metadata.height, 'Returned image must decode');
    console.log(`Image ${index + 1} completed in ${Math.round((Date.now() - started) / 1000)}s`);
  }));
  sample();
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [{ index: index + 1, error: result.reason instanceof Error ? result.reason.message.slice(0, 240) : String(result.reason).slice(0, 240) }]
    : []);
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    requested: prompts.length,
    mode: storyboard ? 'stable-asset-keys-with-shared-reference' : 'plain-prompts',
    succeeded: results.filter((result) => result.status === 'fulfilled').length,
    failed: failures.length,
    pool: {
      accountCount: capacity.accountCount,
      slotsPerAccount: capacity.slotsPerAccount,
      capacity: capacity.totalSlots,
      peakActive,
      observedAccounts: maxByClient.size,
      maxActiveByClient: Object.fromEntries(maxByClient),
    },
    failures,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  assert.equal(summary.succeeded, 18, 'Not all live Flow image requests completed.');
  if (storyboard) assert.ok(peakActive >= capacity.recommendedSlots, 'The storyboard wave did not fill the production pool.');
  else assert.equal(peakActive, 18, 'The live test did not reach all 18 concurrent slots.');
  assert.equal(maxByClient.size, 9, 'The live test did not use all nine ready accounts.');
  assert.ok([...maxByClient.values()].every((active) => storyboard ? active >= 1 && active <= 2 : active === 2), 'Per-account lane count mismatch.');
} finally {
  clearInterval(sampler);
  await rm(outputDir, { recursive: true, force: true });
}
