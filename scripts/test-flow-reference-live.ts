import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { generateGoogleFlowImage } from '../server/services/googleFlow';

assert.ok(process.argv.includes('--live'), 'Requires --live: submits two paid image requests.');
const clientId = process.argv[process.argv.indexOf('--worker') + 1];
const reference = process.argv[process.argv.indexOf('--reference') + 1];
assert.ok(process.argv.includes('--worker') && clientId && process.argv.includes('--reference') && reference);
const api = 'http://127.0.0.1:8787';
const jobs = await (await fetch(`${api}/api/animation-studio/director-jobs`)).json() as Array<{status: string}>;
assert.ok(!jobs.some((job) => ['queued', 'running', 'processing'].includes(job.status)), 'Active production job; refusing competing test.');
const pool = await (await fetch(`${api}/api/ai-video/flow-workers`)).json() as {workers: Array<{clientId:string; tokenReady:boolean; extensionConnected:boolean; state:string}>};
assert.ok(pool.workers.some((worker) => worker.clientId === clientId && worker.tokenReady && worker.extensionConnected && worker.state === 'idle'));
const run = randomUUID();
const dir = path.resolve('workdir/diagnostics', `flow-reference-${run}`);
await mkdir(dir, { recursive: true });
const report: Array<Record<string, unknown>> = [];
for (let index = 0; index < 2; index++) {
  const key = `autosub-asset-${createHash('sha256').update(`${run}:${index}`).digest('hex')}`;
  const row: Record<string, unknown> = {index, key, clientId, startedAt: new Date().toISOString(), status: 'processing'};
  report.push(row);
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  const started = Date.now();
  try {
    const output = path.join(dir, `${index}.png`);
    await generateGoogleFlowImage(`Educational hand drawn illustration of a small greenhouse in a garden, ${index ? 'side view with a watering can' : 'wide view with a pathway'}, use reference for visual style, no text.`, output, {
      referenceImagePath: path.resolve(reference), _preferredClientIds: [clientId], idempotencyKey: key,
      onProgress: (message) => console.log(message),
    });
    const meta = await sharp(output).metadata();
    assert.ok(meta.width && meta.height);
    Object.assign(row, {status: 'succeeded', width: meta.width, height: meta.height});
  } catch (error) {
    Object.assign(row, {status: 'failed-or-unconfirmed', error: error instanceof Error ? error.message : String(error)});
    process.exitCode = 1;
  } finally {
    row.elapsedSeconds = Math.round((Date.now() - started) / 1000);
    await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(row));
  }
  if (process.exitCode) break;
}
console.log(`Report and images: ${dir}`);
