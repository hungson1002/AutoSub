import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';

test('manual API saves empty graph, multiple scripts, direct links and runs text without Flow', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autosub-manual-test-'));
  process.env.AUTOSUB_WORKDIR = dir;
  const { manualFilmRoutes } = await import('./manualFilm');
  const app = Fastify(); await app.register(manualFilmRoutes);
  const id = randomUUID(); const a = randomUUID(); const b = randomUUID();
  const url = `/api/manual-film/${id}`;
  try {
    const graph = { nodes: [{ id: a, kind: 'script', prompt: 'A forest', model: 'narwhal', duration: 8, x: 40, y: 40 }, { id: b, kind: 'storyboard', prompt: '', model: 'narwhal', duration: 8, x: 400, y: 40 }], edges: [{ source: a, target: b }] };
    assert.equal((await app.inject({ method: 'PUT', url, payload: graph })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url })).json().nodes.length, 2);
    const run = await app.inject({ method: 'POST', url: `${url}/nodes/${a}/run`, payload: { aspectRatio: '16:9' } });
    assert.equal(run.statusCode, 200); assert.equal(run.json().nodes[0].status, 'done');
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input) => {
        if (String(input).endsWith('/v1/models')) return Response.json({ data: [{ id: 'narwhal' }, { id: 'gem_pix_2' }] });
        if (String(input).endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
        return Response.json({ detail: 'MODEL_REJECTED: synthetic failure' }, { status: 400 });
      };
      const models = await app.inject({ method: 'GET', url: '/api/manual-film/image-models' });
      assert.equal(models.statusCode, 200);
      assert.deepEqual(models.json().models.map((model: { label: string }) => model.label), ['Nano Banana 2', 'Nano Banana Pro']);
      const failedRun = await app.inject({ method: 'POST', url: `${url}/nodes/${b}/run`, payload: { aspectRatio: '16:9' } });
      assert.equal(failedRun.statusCode, 202);
      let failed;
      for (let i = 0; i < 100; i++) {
        failed = (await app.inject({ method: 'GET', url })).json().nodes[1];
        if (failed.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(failed.status, 'failed');
      assert.match(failed.error, /MODEL_REJECTED: synthetic failure/);
    } finally { globalThis.fetch = originalFetch; }
    assert.equal((await app.inject({ method: 'PUT', url, payload: { ...graph, edges: [...graph.edges, { source: b, target: a }] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url, payload: { nodes: [], edges: [] } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url })).json().nodes.length, 0);
  } finally {
    await app.close(); assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('autosub-manual-test-')); await rm(dir, { recursive: true, force: true });
  }
});
