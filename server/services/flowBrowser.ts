import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

const flowUrl = 'https://flow.google.com/';
const flowAgentUrl = () => String(process.env.FLOW_AGENT_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function flowAgentIsRunning() {
  try {
    const response = await fetch(`${flowAgentUrl()}/health`, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function flowExecutable() {
  const configured = process.env.FLOW_AGENT_EXECUTABLE?.trim();
  if (configured) {
    await access(configured);
    return configured;
  }

  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const installed = path.join(process.env.USERPROFILE, '.local', 'bin', 'flow.exe');
    try {
      await access(installed);
      return installed;
    } catch {
      // Fall back to PATH below.
    }
  }

  return process.platform === 'win32' ? 'flow.exe' : 'flow';
}

let flowAgentStartup: Promise<{ started: boolean; url: string }> | undefined;

export function ensureFlowAgentRuntime() {
  if (!flowAgentStartup) {
    flowAgentStartup = (async () => {
      if (await flowAgentIsRunning()) return { started: false, url: flowAgentUrl() };

      const executable = await flowExecutable();
      const child = spawn(executable, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();

      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await flowAgentIsRunning()) return { started: true, url: flowAgentUrl() };
        await delay(250);
      }
      throw new Error(`Flow Agent không phản hồi tại ${flowAgentUrl()} sau khi tự khởi động.`);
    })().finally(() => {
      flowAgentStartup = undefined;
    });
  }
  return flowAgentStartup;
}

function operaPath() {
  const configured = process.env.OPERA_PATH?.trim();
  if (configured) return configured;

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    throw new Error('Không tìm thấy Opera GX. Hãy đặt OPERA_PATH trong .env.');
  }

  return path.join(localAppData, 'Programs', 'Opera GX', 'opera.exe');
}

export async function openFlowBrowser() {
  await ensureFlowAgentRuntime();
  const executablePath = operaPath();
  await access(executablePath).catch(() => {
    throw new Error(`Không tìm thấy Opera GX tại ${executablePath}. Hãy đặt OPERA_PATH trong .env.`);
  });

  const child = spawn(executablePath, [flowUrl], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  return { open: true, browser: 'Opera GX', url: flowUrl };
}
