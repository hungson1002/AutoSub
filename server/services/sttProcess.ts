import { spawn, type ChildProcess } from 'node:child_process';
import { constants, setPriority } from 'node:os';

export function lowerSttPriority(child: ChildProcess) {
  if (!child.pid || process.env.AUTOSUB_BACKGROUND_PRIORITY === '0') return;
  try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Best effort. */ }
}

// Windows venv python.exe launches another interpreter. Killing only the wrapper
// leaves inference running and holding the shared STT queue and its memory.
export function stopSttProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') { child.kill(); return Promise.resolve(); }
  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => { child.kill(); resolve(); });
    killer.once('close', () => resolve());
  });
}
