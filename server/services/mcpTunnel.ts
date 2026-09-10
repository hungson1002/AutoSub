import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const tunnelConfigSchema = z.object({
  tunnelId: z.string().trim().regex(/^tunnel_[a-f0-9]{32}$/),
  apiKey: z.string().trim().max(1024).refine((value) => !value || /^sk-[\w-]{16,}$/.test(value)).optional(),
}).strict();

// Secrets travel over stdin, never command arguments or application logs.
function powershell(script: string, input = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'pipe' });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Thao tác Windows quá thời gian.')); }, 60_000);
    child.stdout!.on('data', (chunk) => { output += chunk; });
    child.stderr!.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('Không chạy được công cụ Windows.')); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error('Thao tác Windows thất bại.')); });
    child.stdin!.on('error', () => undefined);
    child.stdin!.end(input);
  });
}
export async function protectTunnelKey(value: string, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('Lưu khóa tunnel hiện hỗ trợ Windows.');
  return powershell(`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); ${decrypt
    ? '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'
    : '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))'}`, value);
}

export function createTunnelStore(directory: string, protect = protectTunnelKey) {
  const file = path.join(directory, 'tunnel.json');
  async function read() {
    try { return z.object({ tunnelId: z.string(), encryptedKey: z.string() }).parse(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { tunnelId: '', encryptedKey: '' }; }
  }
  let queue: Promise<unknown> = Promise.resolve();
  function save(config: z.infer<typeof tunnelConfigSchema>) {
    const task = queue.then(async () => {
      const current = await read();
      const encryptedKey = config.apiKey ? await protect(config.apiKey) : current.encryptedKey;
      await mkdir(directory, { recursive: true });
      await writeFile(file + '.tmp', JSON.stringify({ tunnelId: config.tunnelId, encryptedKey }), { mode: 0o600 });
      await rename(file + '.tmp', file);
    });
    queue = task.catch(() => undefined);
    return task;
  }
  return { read, save, key: async () => { const value = await read(); return value.encryptedKey ? protect(value.encryptedKey, true) : ''; } };
}

const version = 'v0.0.14';
export async function installTunnelClient(directory: string) {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Tunnel tích hợp hiện hỗ trợ Windows x64/ARM64.');
  const name = `tunnel-client-${version}-windows-${process.arch === 'x64' ? 'amd64' : 'arm64'}.zip`;
  const base = `https://github.com/openai/tunnel-client/releases/download/${version}`;
  const target = path.join(directory, version, 'tunnel-client.exe');
  // Recheck the local executable against its installation digest before running.
  try {
    const digest = await readFile(target + '.sha256', 'utf8');
    if (createHash('sha256').update(await readFile(target)).digest('hex') === digest) return target;
  } catch { /* first installation or incomplete download */ }
  const download = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error('Không tải được tunnel-client từ GitHub. Kiểm tra mạng rồi thử lại.');
    return Buffer.from(await response.arrayBuffer());
  };
  const sums = (await download(`${base}/SHA256SUMS.txt`)).toString('utf8');
  const expected = sums.split(/\r?\n/).find((line) => line.trim().split(/\s+\*?/)[1] === name)?.split(/\s+/)[0];
  const bytes = await download(`${base}/${name}`);
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Checksum tunnel-client không khớp; đã chặn cài đặt.');
  const folder = path.dirname(target);
  await mkdir(folder, { recursive: true });
  const archive = path.join(folder, 'client.zip');
  await writeFile(archive, bytes);
  // Extract only the executable; never trust archive paths for filesystem writes.
  await powershell("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $p=([Console]::In.ReadToEnd()|ConvertFrom-Json); $z=[IO.Compression.ZipFile]::OpenRead($p.archive); try { $e=@($z.Entries|Where-Object {$_.Name -eq 'tunnel-client.exe'}); if($e.Count -ne 1){throw 'Invalid archive'}; [IO.Compression.ZipFileExtensions]::ExtractToFile($e[0],$p.target,$true) } finally {$z.Dispose()}", JSON.stringify({ archive, target }));
  await writeFile(target + '.sha256', createHash('sha256').update(await readFile(target)).digest('hex'));
  return target;
}

export function recentTunnelPoll(metrics: string, now = Date.now()) {
  const timestamp = Number(metrics.match(/^commands_poll_last_successful_timestamp_seconds(?:_seconds)?(?:\{[^\n]*\})?\s+([\d.e+]+)$/m)?.[1] || 0);
  return timestamp > 0 && now / 1000 - timestamp >= -5 && now / 1000 - timestamp < 90;
}

export function createTunnelManager(directory: string, settings: { file: string; read: () => Promise<{ enabled: boolean; token: string }> }, endpoint: string,
  dependencies = { install: installTunnelClient, spawn }) {
  const store = createTunnelStore(directory);
  let child: ChildProcess | undefined;
  let phase = 'stopped';
  let message = '';
  let pending: Promise<void> | undefined;
  let healthFile = '';
  let closed = false;
  let stopping = false;
  const killOnExit = () => { child?.kill(); };
  async function status() {
    const config = await store.read();
    let ready = false;
    if (child && healthFile) {
      try {
        const url = new URL((await readFile(healthFile, 'utf8')).trim());
        if (url.protocol === 'http:' && url.hostname === '127.0.0.1') {
          const [health, metrics] = await Promise.all(['/readyz', '/metrics'].map((route) => fetch(new URL(route, url), { signal: AbortSignal.timeout(1500), redirect: 'error' })));
          ready = health.ok && metrics.ok && recentTunnelPoll(await metrics.text());
        }
      } catch { /* not listening yet or connection interrupted */ }
    }
    return { tunnelId: config.tunnelId, hasKey: !!config.encryptedKey, phase: child ? ready ? 'ready' : 'starting' : phase, message: child && !ready ? 'Đang chờ tunnel sẵn sàng. Nếu kéo dài, kiểm tra API key và quyền Tunnels Read + Use.' : message };
  }
  async function connect(config: z.infer<typeof tunnelConfigSchema>) {
    if (closed || stopping || pending || child) throw new Error('Tunnel đang chạy hoặc đang xử lý. Ngắt kết nối trước khi đổi cấu hình.');
    phase = 'starting'; message = '';
    // Assign synchronously before disk/network work to prevent duplicate launches.
    pending = (async () => {
      if (!(await settings.read()).enabled) throw new Error('Bật và lưu MCP server trước khi kết nối tunnel.');
      await store.save(config);
      const key = await store.key();
      if (!key) throw new Error('Nhập Runtime API key của OpenAI.');
      phase = 'installing';
      const binary = await dependencies.install(path.join(directory, 'runtime'));
      if (closed || stopping) return;
      const current = await settings.read();
      if (!current.enabled) throw new Error('MCP đã tắt; tunnel không được khởi động.');
      healthFile = path.join(directory, `health-${randomUUID()}.txt`);
      // Explicit allowlist: never inherit .env provider keys or arbitrary tunnel config.
      const env: NodeJS.ProcessEnv = {};
      for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) if (process.env[name]) env[name] = process.env[name];
      env.CONTROL_PLANE_API_KEY = key;
      env.AUTOSUB_TUNNEL_BEARER = `Bearer ${current.token}`;
      const processChild = dependencies.spawn(binary, ['run', '--control-plane.tunnel-id', config.tunnelId, '--mcp.server-url', endpoint,
        '--mcp.extra-headers', 'Authorization: env:AUTOSUB_TUNNEL_BEARER', '--mcp.discovery-extra-headers', 'Authorization: env:AUTOSUB_TUNNEL_BEARER',
        '--health.listen-addr', '127.0.0.1:0', '--health.url-file', healthFile, '--control-plane.poll-channel', 'main'], { env, cwd: directory, windowsHide: true, stdio: 'ignore' });
      child = processChild; phase = 'starting';
      process.once('exit', killOnExit);
      const exited = () => { process.removeListener('exit', killOnExit); if (child === processChild) { child = undefined; phase = 'error'; message = 'Tunnel đã dừng. Kiểm tra Tunnel ID, Runtime API key và quyền truy cập rồi kết nối lại.'; } };
      processChild.once('error', exited); processChild.once('exit', exited);
    })().catch((error: unknown) => { phase = 'error'; message = error instanceof Error ? error.message : 'Không khởi động được tunnel.'; }).finally(() => { pending = undefined; });
    return { accepted: true };
  }
  async function stop() {
    stopping = true;
    // Wait for a pending install before stopping so it cannot launch after Stop.
    if (pending) await pending;
    const owned = child;
    if (owned) {
      await new Promise<void>((resolve) => {
        if (owned.exitCode !== null) return resolve();
        owned.once('exit', () => resolve());
        owned.once('error', () => resolve());
        owned.kill();
      });
      child = undefined;
    }
    phase = 'stopped'; message = '';
    stopping = false;
  }
  return { status, connect, stop, close: async () => { closed = true; await stop(); } };
}
