import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workdir } from './ffmpeg';

// Persist only caller-supplied non-secret identity and the accepted plan, never
// provider credentials. Failed/unknown provider operations are not retried here.
export function animationCheckpointKey(identity: unknown) {
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export async function loadAnimationCheckpoint<T>(key: string): Promise<T | undefined> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid animation checkpoint key.');
  try {
    return JSON.parse(await readFile(path.join(workdir, 'animation-director-checkpoints', `${key}.json`), 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error; // A corrupt checkpoint is not permission to generate again.
  }
}

export async function saveAnimationCheckpoint(key: string, value: unknown) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid animation checkpoint key.');
  const file = path.join(workdir, 'animation-director-checkpoints', `${key}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), 'utf8');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

const active = new Map<string, Promise<unknown>>();
export async function runAnimationOnce<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const existing = active.get(key);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve().then(operation);
  active.set(key, pending);
  try { return await pending; }
  finally { if (active.get(key) === pending) active.delete(key); }
}
