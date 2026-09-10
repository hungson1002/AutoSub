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
    assert.equal((await app.inject({ method: 'PUT', url, payload: { ...graph, edges: [...graph.edges, { source: b, target: a }] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url, payload: { nodes: [], edges: [] } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url })).json().nodes.length, 0);
  } finally {
    await app.close(); assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('autosub-manual-test-')); await rm(dir, { recursive: true, force: true });
  }
});
