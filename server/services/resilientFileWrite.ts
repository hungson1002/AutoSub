import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const transientCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransientFileLock(error: unknown) {
  return transientCodes.has(String((error as NodeJS.ErrnoException)?.code || ''));
}

async function retryTransient<T>(operation: () => Promise<T>, delays = [30, 75, 150, 300, 600, 1000]) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!isTransientFileLock(error) || attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
    }
  }
  throw lastError;
}

/**
 * OneDrive/Windows can briefly lock an existing JSON file while syncing it.
 * Keep the normal atomic temp->rename path and retry transient locks. Never
 * fall back to truncating the destination in place: an interrupted direct
 * overwrite can leave a valid JSON file as a zero-filled or partial file.
 */
export async function writeTextFileResilient(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  try {
    await retryTransient(() => rename(temporary, file));
    return;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeJsonFileResilient(file: string, value: unknown, pretty = false) {
  await writeTextFileResilient(file, JSON.stringify(value, null, pretty ? 2 : undefined));
}
