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
 * Keep the normal atomic temp->rename path, but retry transient locks and fall
 * back to a serialized direct overwrite if the sync provider holds the target
 * longer than the rename retry window.
 */
export async function writeTextFileResilient(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  try {
    await retryTransient(() => rename(temporary, file));
    return;
  } catch (error) {
    if (!isTransientFileLock(error)) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    try {
      await retryTransient(() => writeFile(file, text, 'utf8'), [50, 100, 200, 400, 800, 1200]);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}

export async function writeJsonFileResilient(file: string, value: unknown, pretty = false) {
  await writeTextFileResilient(file, JSON.stringify(value, null, pretty ? 2 : undefined));
}
