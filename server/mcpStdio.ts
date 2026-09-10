import { readFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Launcher only: uses the running backend; never starts a second Flow runtime.
async function main() {
  const endpoint = new URL(process.env.AUTOSUB_MCP_ENDPOINT || 'http://127.0.0.1:8787/api/mcp');
  if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Local endpoint required');
  const file = process.env.AUTOSUB_MCP_SETTINGS_FILE;
  if (!file) throw new Error('Copy the desktop configuration from AutoSub Settings.');
  const client = new Client({ name: 'autosub-desktop-bridge', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, { fetch: async (url, init) => {
    const settings = JSON.parse(await readFile(file, 'utf8'));
    if (!settings.enabled || !settings.token) throw new Error('Enable MCP in AutoSub Settings.');
    const headers = new Headers(init?.headers); headers.set('Authorization', `Bearer ${settings.token}`);
    return fetch(url, { ...init, headers });
  } });
  await client.connect(transport);
  const server = new Server({ name: 'autosub', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params));
  await server.connect(new StdioServerTransport());
  process.stdin.on('end', () => { void client.close(); void server.close(); });
}
void main().catch(() => { console.error('AutoSub MCP: không kết nối được. Mở AutoSub, bật MCP trong Cài đặt và sao chép lại cấu hình.'); process.exitCode = 1; });
