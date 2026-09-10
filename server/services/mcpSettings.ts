import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { workdir } from './ffmpeg';

export const mcpSettingsSchema = z.object({ enabled: z.boolean(), allowWrites: z.boolean() }).strict();
export type McpSettings = z.infer<typeof mcpSettingsSchema> & { token: string };

export function createMcpSettingsStore(directory = path.join(workdir, 'mcp')) {
  const file = path.join(directory, 'settings.json');
  let pending: Promise<unknown> = Promise.resolve();
  async function read(): Promise<McpSettings> {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      return { ...mcpSettingsSchema.parse({ enabled: value.enabled, allowWrites: value.allowWrites }), token: z.string().regex(/^[a-f0-9]{64}$/).parse(value.token) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { enabled: false, allowWrites: false, token: '' };
    }
  }
  function update(change: Partial<z.infer<typeof mcpSettingsSchema>>, rotate = false): Promise<McpSettings> {
    const operation = pending.then(async () => {
      const current = await read();
      const next = { ...current, ...change, token: rotate || !current.token ? randomBytes(32).toString('hex') : current.token };
      await mkdir(directory, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      return next;
    });
    pending = operation.catch(() => undefined);
    return operation;
  }
  return { read, update, file };
}
export const mcpSettingsStore = createMcpSettingsStore();
export function validMcpToken(header: string | undefined, token: string) {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
  return !!token && /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}
