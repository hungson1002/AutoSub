import type { FastifyInstance, FastifyRequest } from 'fastify';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createAutoSubMcp } from '../services/mcpTools';
import { mcpSettingsSchema, mcpSettingsStore, validMcpToken, type createMcpSettingsStore } from '../services/mcpSettings';
import { createTunnelManager, tunnelConfigSchema } from '../services/mcpTunnel';

function localRequest(request: FastifyRequest) {
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  try {
    if (!allowedHosts.has(new URL(`http://${request.headers.host}`).hostname)) return false;
    if (request.headers.origin && !allowedHosts.has(new URL(request.headers.origin).hostname)) return false;
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip);
  } catch { return false; }
}
export async function mcpRoutes(app: FastifyInstance, options: { store?: ReturnType<typeof createMcpSettingsStore> } = {}) {
  const store = options.store || mcpSettingsStore;
  const endpoint = `http://127.0.0.1:${process.env.AUTOSUB_PORT || 8787}/api/mcp`;
  const tunnel = createTunnelManager(path.dirname(store.file), store, endpoint);
  app.addHook('onClose', async () => tunnel.close());
  const publicSettings = (settings: Awaited<ReturnType<typeof store.read>>) => ({ enabled: settings.enabled, allowWrites: settings.allowWrites, hasToken: !!settings.token, endpoint,
    desktopConfig: { mcpServers: { autosub: { command: process.execPath, args: [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('server/mcpStdio.ts')], env: { AUTOSUB_MCP_ENDPOINT: endpoint, AUTOSUB_MCP_SETTINGS_FILE: store.file } } } } });
  await app.register(async (admin) => {
    admin.addHook('onRequest', async (request, reply) => {
      if (!localRequest(request) || request.headers['x-autosub-settings'] !== '1') return reply.code(403).send({ error: 'Chỉ cấu hình MCP từ AutoSub trên máy này.' });
      reply.header('Cache-Control', 'no-store');
    });
    admin.get('/api/mcp-settings', async () => publicSettings(await store.read()));
    admin.get('/api/mcp-settings/tunnel', async () => tunnel.status());
    admin.post('/api/mcp-settings/tunnel/connect', { bodyLimit: 4096 }, async (request, reply) => {
      const parsed = tunnelConfigSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Tunnel ID cần dạng tunnel_ và 32 ký tự hex. API key cần là Runtime key sk-… hợp lệ.' });
      try { return await tunnel.connect(parsed.data); }
      catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'Không kết nối được tunnel.' }); }
    });
    admin.post('/api/mcp-settings/tunnel/disconnect', async () => { await tunnel.stop(); return tunnel.status(); });
    admin.put('/api/mcp-settings', async (request, reply) => {
      const parsed = mcpSettingsSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Cấu hình MCP không hợp lệ.' });
      const next = await store.update(parsed.data);
      if (!next.enabled) await tunnel.stop();
      return publicSettings(next);
    });
    admin.post('/api/mcp-settings/rotate-token', async () => { await tunnel.stop(); const settings = await store.update({}, true); return { ...publicSettings(settings), token: settings.token }; });
  });
  app.route({ method: ['GET', 'POST', 'DELETE'], url: '/api/mcp', bodyLimit: 2 * 1024 * 1024, handler: async (request, reply) => {
    const settings = await store.read();
    if (!settings.enabled) return reply.code(503).send({ error: 'MCP disabled' });
    if (!validMcpToken(request.headers.authorization, settings.token)) return reply.code(401).header('WWW-Authenticate', 'Bearer realm="AutoSub MCP"').send({ error: 'Unauthorized' });
    if (request.headers.origin && !localRequest(request)) return reply.code(403).send({ error: 'Origin not allowed' });
    if (request.method !== 'POST') return reply.code(405).header('Allow', 'POST').send();
    const server = createAutoSubMcp(store.read);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    reply.hijack();
    reply.raw.on('close', () => { void transport.close(); void server.close(); });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  } });
}
