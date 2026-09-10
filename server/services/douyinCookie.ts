import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { protectTunnelKey } from './mcpTunnel';

export function createDouyinCookieStore(directory: string, protect = protectTunnelKey) {
  const file = path.join(directory, 'douyin-cookie');
  let queue: Promise<unknown> = Promise.resolve();
  async function encrypted() {
    try { return await readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw new Error('Không đọc được cookie đã lưu.'); }
  }
  function save(cookie: string) {
    const task = queue.then(async () => {
      if (!cookie) { await rm(file, { force: true }); return; }
      const value = await protect(cookie);
      await mkdir(directory, { recursive: true });
      await writeFile(file + '.tmp', value, { mode: 0o600 });
      await rename(file + '.tmp', file);
    });
    queue = task.catch(() => undefined);
    return task;
  }
  return { save, has: async () => !!(await encrypted()), read: async () => { const value = await encrypted(); return value ? protect(value, true) : ''; } };
}
export const douyinCookieStore = createDouyinCookieStore(path.join(process.env.LOCALAPPDATA || os.homedir(), 'AutoSub', 'secrets'));
