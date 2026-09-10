import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP HTTP and stdio: auth, permissions, editing, rotation and disable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autosub-mcp-test-'));
  process.env.AUTOSUB_WORKDIR = directory;
  const { mcpRoutes } = await import('./mcp');
  const { createMcpSettingsStore, validMcpToken } = await import('../services/mcpSettings');
  const store = createMcpSettingsStore(path.join(directory, 'mcp'));
  const app = Fastify();
  await app.register(mcpRoutes, { store });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const clients: Client[] = [];
  const admin = { 'X-AutoSub-Settings': '1', 'Content-Type': 'application/json' };
  async function configure(enabled: boolean, allowWrites: boolean) {
    const response = await fetch(`${base}/api/mcp-settings`, { method: 'PUT', headers: admin, body: JSON.stringify({ enabled, allowWrites }) });
    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(await response.json() as object, 'token'), false);
  }
  try {
    assert.equal((await fetch(`${base}/api/mcp`, { method: 'POST' })).status, 503);
    assert.equal((await fetch(`${base}/api/mcp-settings`)).status, 403);
    assert.equal((await fetch(`${base}/api/mcp-settings/tunnel`)).status, 403);
    const tunnel = await (await fetch(`${base}/api/mcp-settings/tunnel`, { headers: admin })).json() as Record<string, unknown>;
    assert.equal(tunnel.phase, 'stopped');
    assert.equal(tunnel.hasKey, false);
    assert.equal(Object.hasOwn(tunnel, 'apiKey'), false);
    assert.equal((await fetch(`${base}/api/mcp-settings/tunnel/connect`, { method: 'POST', headers: admin, body: JSON.stringify({ tunnelId: 'invalid' }) })).status, 400);
    assert.equal((await fetch(`${base}/api/mcp-settings`, { headers: { ...admin, Origin: 'https://attacker.example' } })).status, 403);
    await configure(true, false);
    const original = await store.read();
    assert.equal(validMcpToken(`Bearer ${'é'.repeat(64)}`, original.token), false);
    assert.equal((await fetch(`${base}/api/mcp`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${original.token}`, Origin: 'https://attacker.example' } })).status, 403);
    const client = new Client({ name: 'test', version: '1' }); clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${original.token}` } } }));
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes('animation_create'));
    assert.ok(names.includes('animation_render_status'));
    const status = await client.callTool({ name: 'autosub_status' });
    assert.equal(status.isError, undefined, JSON.stringify(status));
    assert.equal((await client.callTool({ name: 'animation_create', arguments: { name: 'MCP test' } })).isError, true);
    await configure(true, true);
    const readResult = (value: unknown) => {
      const blocks = (value as { content: Array<{ text: string }> }).content;
      return JSON.parse(blocks[0].text);
    };
    const project = readResult(await client.callTool({ name: 'animation_create', arguments: { name: 'MCP test', width: 320, height: 320 } }));
    assert.equal(project.name, 'MCP test');
    assert.ok(readResult(await client.callTool({ name: 'animation_projects', arguments: {} })).some((item: { id: string }) => item.id === project.id));
    const saved = readResult(await client.callTool({ name: 'animation_save', arguments: { projectId: project.id, expectedUpdatedAt: project.updatedAt, project: { ...project, name: 'Edited by MCP' } } }));
    assert.equal(saved.id, project.id);
    const conflict = readResult(await client.callTool({ name: 'animation_save', arguments: { projectId: project.id, expectedUpdatedAt: 'stale', project } }));
    assert.ok(conflict.error);
    assert.equal((await client.callTool({ name: 'animation_get', arguments: { projectId: '../../.env' } })).isError, true);
    const blockedAsset = await client.callTool({ name: 'animation_save', arguments: { projectId: project.id, expectedUpdatedAt: saved.updatedAt, project: { ...project, assets: [{ id: 'bad', name: 'bad', type: 'image', uri: 'http://127.0.0.1/private', tags: [], createdAt: project.createdAt }] } } });
    assert.equal(blockedAsset.isError, true);
    if (process.env.AUTOSUB_MCP_RENDER_TEST === '1') {
      const { defaultTransform } = await import('../../shared/animationStudio');
      const scene = { id: 'mcp-scene', name: 'Smoke', order: 0, durationMs: 1000, narration: '', renderMode: 'composite', backgroundColor: '#101820', commands: [], camera: { transform: defaultTransform(), commands: [] }, layers: [{ id: 'title', type: 'text', name: 'Title', text: 'MCP OK', fontSize: 32, fill: '#ffffff', width: 280, height: 80, visible: true, locked: false, zIndex: 1, transform: { ...defaultTransform(), position: { x: 160, y: 160 } } }] };
      const update = await client.callTool({ name: 'animation_save', arguments: { projectId: project.id, expectedUpdatedAt: saved.updatedAt, project: { ...project, scenes: [scene] } } });
      assert.notEqual(update.isError, true, JSON.stringify(update));
      const rendered = readResult(await client.callTool({ name: 'animation_render', arguments: { projectId: project.id } }));
      assert.ok(rendered.jobId);
      const duplicate = readResult(await client.callTool({ name: 'animation_render', arguments: { projectId: project.id } }));
      assert.equal(duplicate.jobId, rendered.jobId);
      const deadline = Date.now() + 90000;
      let status;
      do {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        status = readResult(await client.callTool({ name: 'animation_render_status', arguments: { jobId: rendered.jobId } }));
      } while (Date.now() < deadline && ['queued', 'rendering'].includes(status.status));
      assert.equal(status.status, 'completed', JSON.stringify(status));
      assert.match(status.videoPath, /\/video$/);
    }
    const stdio = new Client({ name: 'stdio-test', version: '1' }); clients.push(stdio);
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('server/mcpStdio.ts')], env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), AUTOSUB_MCP_ENDPOINT: `${base}/api/mcp`, AUTOSUB_MCP_SETTINGS_FILE: store.file }, stderr: 'pipe' }));
    assert.equal((await stdio.listTools()).tools.length, names.length);
    await store.update({}, true);
    assert.equal((await fetch(`${base}/api/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${original.token}` } })).status, 401);
    assert.equal((await stdio.callTool({ name: 'autosub_status', arguments: {} })).isError, undefined);
    await configure(false, false);
    assert.equal((await fetch(`${base}/api/mcp`, { method: 'POST' })).status, 503);
    assert.equal((await createMcpSettingsStore(path.join(directory, 'mcp')).read()).enabled, false);
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await app.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('autosub-mcp-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
