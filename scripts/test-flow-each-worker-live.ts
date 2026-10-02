import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const apiBase = String(process.env.AUTOSUB_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const live = process.argv.includes('--live');
if (!live) throw new Error('This test creates real Flow images. Re-run with --live after reviewing the per-worker preflight.');

type Worker = {
  clientId: string;
  port: number;
  baseUrl: string;
  state: string;
  extensionConnected: boolean;
  tokenReady: boolean;
  imageReady: boolean;
};

const readJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Preflight HTTP ${response.status} for ${new URL(url).pathname}`);
  return response.json() as Promise<T>;
};

const jobs = await readJson<Array<{ id: string; status: string }>>(`${apiBase}/api/animation-studio/director-jobs`);
const activeJobs = jobs.filter((job) => ['queued', 'running', 'processing'].includes(job.status));
assert.equal(activeJobs.length, 0, `Refusing to start while ${activeJobs.length} animation job(s) are active.`);

const workerResponse = await readJson<{ workers: Worker[] }>(`${apiBase}/api/ai-video/flow-workers`);
const workers = workerResponse.workers;
assert.equal(workers.length, 9, `Expected 9 Flow workers; found ${workers.length}.`);
assert.ok(workers.every((worker) => worker.extensionConnected && worker.state === 'idle'), 'Every Flow worker must have a live browser bridge and be idle.');
const unavailableWorkers = workers.filter((worker) => !worker.imageReady).map((worker) => worker.clientId);
if (unavailableWorkers.length) {
  console.error(`Refusing to spend credits: ${unavailableWorkers.length}/9 workers are missing a live connection or token (${unavailableWorkers.join(', ')}).`);
  process.exitCode = 1;
} else {

const {
  generateGoogleFlowImage,
  getGoogleFlowImagePoolCapacity,
  getGoogleFlowImagePoolRuntimeStats,
  resetGoogleFlowImagePoolRuntimeStats,
} = await import('../server/services/googleFlow');

const capacity = await getGoogleFlowImagePoolCapacity();
assert.equal(capacity.isolatedWorkers, true, 'Isolated Flow workers are not active in this process.');
assert.equal(capacity.accountCount, 9, `Flow pool sees ${capacity.accountCount}/9 accounts.`);
assert.equal(capacity.maxParallelSlots, TEST_CONCURRENCY, `Expected ${TEST_CONCURRENCY} available worker slots.`);
assert.equal(getGoogleFlowImagePoolRuntimeStats().active, 0, 'This process already has active Flow image work.');

const topics = [
  [
    'a greenhouse collecting sunlight', 'a wind turbine over a green field', 'a river flowing through a hydroelectric dam',
    'a seed sprouting roots in a glass jar', 'a honeybee pollinating a yellow flower', 'the water cycle above a mountain lake',
    'a robotic arm sorting colored blocks', 'a sailboat catching wind on calm water', 'a planet orbiting a bright star',
  ],
  [
    'a lighthouse guiding ships at dusk', 'a bicycle gear turning its chain', 'a baker kneading dough on a wooden table',
    'a coral reef with small fish and sea plants', 'a crane lifting a steel beam', 'a red blood cell carrying oxygen',
    'a paper airplane gliding across a classroom', 'a snowflake forming on a cold window', 'an electric car charging beside a home',
  ],
  [
    'a telescope observing Saturn', 'a tree absorbing rainwater in a forest', 'a small bridge crossing a clear stream',
    'a solar panel powering a village home', 'a clockwork mechanism turning smoothly', 'a volcano forming new rock layers',
    'a submarine exploring a kelp forest', 'a potter shaping clay on a wheel', 'a hot air balloon rising at sunrise',
  ],
  [
    'a seedling growing toward a sunlit window', 'a red fox crossing a snowy field', 'a small satellite orbiting Earth',
    'a glass of water catching morning light', 'a railway crossing a mountain valley', 'a turtle swimming over seagrass',
    'a ceramic bowl being glazed by hand', 'a wind-up toy walking across a desk', 'a waterfall flowing into a quiet pool',
  ],
];

const outputDir = await mkdtemp(path.join(os.tmpdir(), 'autosub-flow-worker-rounds-'));
const successesByClient = new Map(workers.map((worker) => [worker.clientId, 0]));
const failures: Array<{ round: number; clientId: string; error: string }> = [];
const maxByClient = new Map<string, number>();
const TEST_ROUNDS = 2;
const IMAGES_PER_WORKER_PER_ROUND = 2;
const TEST_CONCURRENCY = workers.length * IMAGES_PER_WORKER_PER_ROUND;
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
let roundsCompleted = 0;

try {
  for (let round = 0; round < TEST_ROUNDS; round += 1) {
    const tasks = workers.flatMap((worker, workerIndex) => Array.from(
      { length: IMAGES_PER_WORKER_PER_ROUND },
      (_, lane) => ({ worker, workerIndex, lane }),
    ));
    const results = new Array<PromiseSettledResult<{ clientId: string; bytes: number }>>(tasks.length);
    let nextTask = 0;
    await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, tasks.length) }, async () => {
      while (nextTask < tasks.length) {
        const taskIndex = nextTask++;
        const { worker, workerIndex, lane } = tasks[taskIndex];
        try {
          const prompt = `A clear educational illustration of ${topics[round * IMAGES_PER_WORKER_PER_ROUND + lane][workerIndex]}, square composition, no text.`;
          const outputFile = path.join(outputDir, `${worker.clientId}-round-${round + 1}-lane-${lane + 1}.png`);
          const result = await generateGoogleFlowImage(prompt, outputFile, {
            size: '1024x1024',
            _preferredClientIds: [worker.clientId],
            // Keep the live test pinned to the worker under test. Never mask a bad
            // account by silently generating its image through a different worker.
            _failoverAttempt: 8,
          });
          if (!Number.isFinite(result.bytes) || result.bytes < 100) throw new Error('Flow returned an empty or invalid image.');
          results[taskIndex] = { status: 'fulfilled', value: { clientId: worker.clientId, bytes: result.bytes } };
        } catch (reason) {
          results[taskIndex] = { status: 'rejected', reason };
        }
      }
    }));

    sample();
    const roundFailures: typeof failures = [];
    for (const [index, result] of results.entries()) {
      const worker = tasks[index].worker;
      if (result.status === 'fulfilled') {
        successesByClient.set(worker.clientId, (successesByClient.get(worker.clientId) || 0) + 1);
      } else {
        roundFailures.push({
          round: round + 1,
          clientId: worker.clientId,
          error: result.reason instanceof Error ? result.reason.message.slice(0, 260) : String(result.reason).slice(0, 260),
        });
      }
    }
    failures.push(...roundFailures);
    roundsCompleted = round + 1;
    process.stdout.write(`Round ${round + 1}/${TEST_ROUNDS}: ${tasks.length - roundFailures.length}/${tasks.length} images created on their assigned accounts.\n`);

    // Each subsequent round is a stability check. Stop a failed account from
    // repeatedly spending/retrying and stop the whole test if Google throttles.
    const globalTrafficError = roundFailures.some(({ error }) => /TOO_MUCH_TRAFFIC|RECAPTCHA|FLOW_IMAGE_TRAFFIC_THROTTLED|unusual activity/i.test(error));
    if (roundFailures.length || globalTrafficError) break;
  }

  sample();
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    requested: workers.length * roundsCompleted * IMAGES_PER_WORKER_PER_ROUND,
    roundsCompleted,
    succeeded: [...successesByClient.values()].reduce((sum, count) => sum + count, 0),
    failed: failures.length,
    pool: {
      accountCount: capacity.accountCount,
      slotsPerAccount: capacity.slotsPerAccount,
      configuredTestConcurrency: TEST_CONCURRENCY,
      peakActive,
      maxActiveByClient: Object.fromEntries(maxByClient),
    },
    successesByClient: Object.fromEntries(successesByClient),
    failures,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  assert.equal(summary.failed, 0, 'At least one targeted Flow worker failed.');
  assert.ok(peakActive <= TEST_CONCURRENCY, `Test exceeded ${TEST_CONCURRENCY} concurrent requests.`);
  assert.ok(peakActive === TEST_CONCURRENCY, `The test never reached ${TEST_CONCURRENCY} active image requests.`);
  assert.ok([...maxByClient.values()].every((count) => count === IMAGES_PER_WORKER_PER_ROUND), 'A worker did not use both parallel image lanes.');
  assert.ok([...successesByClient.values()].every((count) => count === roundsCompleted * IMAGES_PER_WORKER_PER_ROUND), 'A worker did not produce every completed round.');
  assert.equal(roundsCompleted, TEST_ROUNDS, 'The test did not complete both stability rounds per worker.');
} finally {
  clearInterval(sampler);
  await rm(outputDir, { recursive: true, force: true });
}
}
