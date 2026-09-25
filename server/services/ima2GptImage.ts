import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { resolveAnimationGenerationReferencePaths, type AnimationAssetGenerationInput } from './animationAssets';

const require = createRequire(import.meta.url);
const MAX_REFERENCE_COUNT = 5;
const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 30 * 1024 * 1024;
const DEFAULT_MODEL = 'gpt-5.6-luna';
const imageModels = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-6-astra'];

type AdvertisedServer = { url?: string; backend?: { url?: string }; pid?: number; adminNonce?: string };
type Health = { ok?: boolean; version?: string; pid?: number };
type OAuthStatus = { status?: 'starting' | 'offline' | 'auth_required' | 'ready'; models?: string[] };
type Ima2Login = { sessionId: string; userCode: string; verificationUrl: string; expiresIn: number };
type OwnerRecord = { pid: number; port: number; createdAt: string; codexHome?: string };

let child: ChildProcess | undefined;
let childOutput = '';
let activeBaseUrl = '';
let startup: Promise<string> | undefined;
let startupRetryAfter = 0;
const completedLoginSessions = new Map<string, number>();

function configDirectory() {
  if (process.env.AUTOSUB_IMA2_CONFIG_DIR?.trim()) return path.resolve(process.env.AUTOSUB_IMA2_CONFIG_DIR.trim());
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'AutoSub', 'ima2-gen');
  return path.join(homedir(), '.autosub', 'ima2-gen');
}

export function ima2CodexHomePath(baseDirectory = configDirectory()) {
  return path.join(baseDirectory, 'codex-home');
}

function advertisementFile() { return path.join(configDirectory(), 'server.json'); }
function ownerFile() { return path.join(configDirectory(), 'autosub-sidecar.json'); }

export function safeIma2LoopbackUrl(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(hostname)) return undefined;
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) return undefined;
    return parsed.origin;
  } catch { return undefined; }
}

export function ima2ImageSize(width = 1024, height = 1024) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1024x1024';
  const ratio = width / height;
  if (ratio > 1.2) return '1824x1024';
  if (ratio < 0.83) return '1024x1824';
  return '1024x1024';
}

export function ima2ServerSpawnOptions() {
  return { detached: true, windowsHide: true, stdio: 'ignore' as const };
}

async function canBind(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function availablePort(start: number, count = 32) {
  for (let port = start; port < start + count; port += 1) if (await canBind(port)) return port;
  throw new Error(`Không tìm được cổng trống quanh ${start} cho ima2-gen.`);
}

async function readAdvertisedServer() {
  try {
    const value = JSON.parse(await readFile(advertisementFile(), 'utf8')) as AdvertisedServer;
    const base = safeIma2LoopbackUrl(value.backend?.url || value.url || '');
    return base ? { base, pid: Number(value.pid) || undefined, adminNonce: value.adminNonce } : undefined;
  } catch { return undefined; }
}

async function jsonRequest<T>(base: string, endpoint: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  const response = await fetch(`${base}${endpoint}`, { ...init, signal: init?.signal || AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* preserve a useful status message below */ }
  if (!response.ok) {
    const detail = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : text.slice(0, 300);
    throw new Error(`ima2-gen ${endpoint} trả HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return body as T;
}

async function healthAt(base: string) {
  try {
    const health = await jsonRequest<Health>(base, '/api/health', undefined, 1500);
    return health.ok === true && Boolean(health.version);
  } catch { return false; }
}

async function findRunningServer() {
  const candidates = [activeBaseUrl, (await readAdvertisedServer())?.base || ''].filter(Boolean);
  for (const base of [...new Set(candidates)]) if (await healthAt(base)) return base;
  return '';
}

async function prepareConfig() {
  const directory = configDirectory();
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'config.json');
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Cấu hình ima2-gen không phải JSON object.');
    config = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // ima2-gen's CLI asks interactively for a provider on first launch. Seed only
  // the missing default so AutoSub can launch it non-interactively; existing
  // user config is otherwise left intact.
  if (!config.provider) {
    config.provider = 'oauth';
    await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  }
}

function serverScript() {
  try { return require.resolve('ima2-gen/server.js'); }
  catch { throw new Error('Chưa cài ima2-gen. Hãy chạy npm install trong thư mục AutoSub rồi khởi động lại.'); }
}

async function waitForServer(base: string, timeoutMs = 90_000, spawned?: ChildProcess) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await healthAt(base)) return base;
    if (childOutput || (spawned && spawned.exitCode !== null)) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const reason = childOutput
    ? `ima2-gen không thể khởi động: ${childOutput.slice(-500)}`
    : spawned?.exitCode !== null && spawned?.exitCode !== undefined
    ? `ima2-gen thoát với mã ${spawned.exitCode}`
    : 'ima2-gen không phản hồi health check trong 90 giây.';
  throw new Error(reason);
}

async function startServer() {
  const existing = await findRunningServer();
  if (existing) { activeBaseUrl = existing; return existing; }
  await prepareConfig();
  const codexHome = ima2CodexHomePath();
  await mkdir(codexHome, { recursive: true });
  const port = await availablePort(3333);
  const oauthPort = await availablePort(10531);
  const env: NodeJS.ProcessEnv = { ...process.env, IMA2_CONFIG_DIR: configDirectory(), CODEX_HOME: codexHome, IMA2_HOST: '127.0.0.1', IMA2_PORT: String(port), IMA2_OAUTH_PROXY_PORT: String(oauthPort), IMA2_NO_OAUTH_PROXY: '0' };
  delete env.OPENAI_API_KEY;
  childOutput = '';
  // Keep the local OAuth/image bridge alive across backend and tsx-watch restarts.
  // It uses AutoSub's isolated CODEX_HOME and is rediscovered through server.json.
  const spawned = spawn(process.execPath, [serverScript()], { cwd: path.dirname(serverScript()), env, ...ima2ServerSpawnOptions() });
  child = spawned;
  spawned.once('exit', () => { if (child === spawned) { child = undefined; activeBaseUrl = ''; } });
  spawned.once('error', (error) => { childOutput = error.message; });
  spawned.unref();
  const base = `http://127.0.0.1:${port}`;
  activeBaseUrl = base;
  if (!spawned.pid) { spawned.kill(); throw new Error('Không lấy được PID của ima2-gen để theo dõi dịch vụ.'); }
  await writeFile(ownerFile(), JSON.stringify({ pid: spawned.pid, port, createdAt: new Date().toISOString(), codexHome } satisfies OwnerRecord), 'utf8');
  return waitForServer(base, 90_000, spawned);
}

async function ensureServer() {
  if (startup) return startup;
  startup = startServer().finally(() => { startup = undefined; });
  return startup;
}

async function oauthStatus(base: string) {
  return jsonRequest<OAuthStatus>(base, '/api/oauth/status', undefined, 8_000);
}

async function readOwner() {
  try { return JSON.parse(await readFile(ownerFile(), 'utf8')) as OwnerRecord; } catch { return undefined; }
}

async function stopOwnedServer(base: string) {
  const owner = await readOwner();
  if (!owner?.pid) return false;
  const health = await jsonRequest<Health>(base, '/api/health', undefined, 1500).catch(() => undefined);
  if (health?.pid !== owner.pid) return false;
  const advertised = await readAdvertisedServer();
  if (advertised?.pid !== owner.pid || !advertised.adminNonce) return false;
  const stopResponse = await fetch(`${base}/api/admin/stop`, {
    method: 'POST',
    headers: { 'x-ima2-admin-nonce': advertised.adminNonce },
    signal: AbortSignal.timeout(2500),
  }).catch(() => undefined);
  if (stopResponse?.status !== 202) return false;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const remaining = await jsonRequest<Health>(base, '/api/health', undefined, 500).catch(() => undefined);
    if (remaining?.pid !== owner.pid) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const remaining = await jsonRequest<Health>(base, '/api/health', undefined, 500).catch(() => undefined);
  if (remaining?.pid === owner.pid) return false;
  child = undefined;
  activeBaseUrl = '';
  await rm(ownerFile(), { force: true });
  return true;
}

function sameFilesystemPath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function ensureIsolatedServerForLogin() {
  const base = await findRunningServer();
  if (!base) return ensureServer();
  activeBaseUrl = base;

  const codexHome = ima2CodexHomePath();
  const owner = await readOwner();
  if (owner?.codexHome && sameFilesystemPath(owner.codexHome, codexHome)) return base;

  // Older AutoSub sidecars inherited the user's default ~/.codex directory.
  // Restart only a process we can prove AutoSub owns; never kill an external
  // ima2-gen instance or touch the user's existing Codex credentials.
  if (owner?.pid && await stopOwnedServer(base)) return ensureServer();
  throw new Error('ima2-gen đang chạy ngoài quyền quản lý của AutoSub hoặc chưa xác nhận được kho đăng nhập riêng. Để bảo vệ phiên Codex trong VS Code, hãy đóng dịch vụ ima2-gen bên ngoài rồi thử lại.');
}

async function activateOauthAfterLogin(base: string) {
  const current = await oauthStatus(base).catch(() => ({ status: 'offline' as const }));
  if (current.status === 'ready') return current;
  if (!await stopOwnedServer(base)) return current;
  const restarted = await ensureServer();
  const deadline = Date.now() + 45_000;
  let status = await oauthStatus(restarted).catch(() => ({ status: 'offline' as const }));
  while (status.status !== 'ready' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    status = await oauthStatus(restarted).catch(() => ({ status: 'offline' as const }));
  }
  return status;
}

export async function ima2GptImageStatus() {
  let base = await findRunningServer();
  if (!base) {
    const owner = await readOwner();
    const canRecover = owner?.codexHome && sameFilesystemPath(owner.codexHome, ima2CodexHomePath());
    if (!canRecover) return { installed: true, running: false, connected: false, authStatus: 'stopped', models: [] as string[] };
    if (!startup && Date.now() >= startupRetryAfter) {
      void ensureServer().then(() => { startupRetryAfter = 0; }).catch(() => { startupRetryAfter = Date.now() + 30_000; });
    }
    return { installed: true, running: false, connected: false, authStatus: startup ? 'starting' : 'offline', models: [] as string[], modelChoices: imageModels };
  }
  activeBaseUrl = base;
  const status: OAuthStatus = await oauthStatus(base).catch(() => ({ status: 'offline' }));
  const health: Health = await jsonRequest<Health>(base, '/api/health').catch(() => ({}));
  return { installed: true, running: true, connected: status.status === 'ready', authStatus: status.status || 'offline', models: status.models || [], modelChoices: imageModels, version: health.version };
}

export async function startIma2GptLogin() {
  const base = await ensureIsolatedServerForLogin();
  const status = await oauthStatus(base).catch(() => ({ status: 'offline' as const }));
  if (status.status === 'ready') return { alreadyConnected: true, status: 'ready' } as const;
  return jsonRequest<Ima2Login>(base, '/api/auth/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex' }) }, 35_000);
}

export async function pollIma2GptLogin(sessionId: string) {
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(sessionId)) throw new Error('Mã phiên đăng nhập không hợp lệ.');
  const completedUntil = completedLoginSessions.get(sessionId);
  if (completedUntil) {
    if (Date.now() > completedUntil) {
      completedLoginSessions.delete(sessionId);
      return { status: 'error' as const, error: 'Đã xác thực ChatGPT nhưng OAuth proxy chưa sẵn sàng. Hãy thử kết nối lại.' };
    }
    const running = await findRunningServer();
    const ready = running ? await oauthStatus(running).catch(() => ({ status: 'offline' as const })) : { status: 'offline' as const };
    if (ready.status === 'ready') { completedLoginSessions.delete(sessionId); return { status: 'ready' as const, authStatus: 'ready' }; }
    return { status: 'complete' as const, authStatus: ready.status || 'starting' };
  }
  const base = await findRunningServer();
  if (!base) return { status: 'expired' as const };
  const session = await jsonRequest<{ status: 'pending' | 'complete' | 'expired' | 'error'; error?: string }>(base, `/api/auth/switch/${encodeURIComponent(sessionId)}`);
  if (session.status !== 'complete') return session;
  completedLoginSessions.set(sessionId, Date.now() + 15 * 60_000);
  const status = await activateOauthAfterLogin(base);
  if (status.status === 'ready') { completedLoginSessions.delete(sessionId); return { status: 'ready' as const, authStatus: 'ready' }; }
  return { status: 'complete' as const, authStatus: status.status || 'starting' };
}

async function referenceDataUrls(input: AnimationAssetGenerationInput) {
  const paths = await resolveAnimationGenerationReferencePaths(input);
  if (paths.length > MAX_REFERENCE_COUNT) throw new Error(`GPT Image hỗ trợ tối đa ${MAX_REFERENCE_COUNT} ảnh tham chiếu cùng lúc.`);
  return Promise.all(paths.map(async (filePath) => {
    const source = await readFile(filePath);
    const data = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    if (data.length > MAX_REFERENCE_BYTES) throw new Error('Ảnh tham chiếu sau nén vẫn quá lớn (5 MB). Hãy chọn ảnh nhỏ hơn.');
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  }));
}

export async function generateWithIma2Gpt(input: AnimationAssetGenerationInput) {
  const model = input.model || DEFAULT_MODEL;
  if (!imageModels.includes(model)) throw new Error(`Model GPT Image không được hỗ trợ: ${model}.`);
  const base = await findRunningServer();
  if (!base) throw new Error('Chưa kết nối ChatGPT cho GPT Image. Vào Cài đặt → GPT Image, bấm “Đăng nhập ChatGPT” rồi thử lại.');
  const auth = await oauthStatus(base).catch(() => ({ status: 'offline' as const }));
  if (auth.status !== 'ready') throw new Error('GPT Image chưa đăng nhập hoặc OAuth proxy đang ngoại tuyến. Vào Cài đặt → GPT Image để kết nối lại.');
  const references = await referenceDataUrls(input);
  const response = await jsonRequest<{ image?: string; error?: string }>(base, '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: input.prompt, quality: 'high', size: ima2ImageSize(input.width, input.height), format: 'png', moderation: 'low', provider: 'oauth', model, n: 1, references, requestId: randomUUID(), storyboard: false }),
  }, 8 * 60_000);
  const match = String(response.image || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) throw new Error(typeof response.error === 'string' ? `GPT Image: ${response.error}` : 'ima2-gen không trả về ảnh hợp lệ.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES) throw new Error('Ảnh GPT Image trống hoặc vượt giới hạn 30 MB.');
  return bytes;
}
