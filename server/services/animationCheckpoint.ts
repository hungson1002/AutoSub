import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { workdir } from './ffmpeg';
import { writeJsonFileResilient } from './resilientFileWrite';

// Persist only caller-supplied non-secret identity and the accepted plan, never
// provider credentials. Failed/unknown provider operations are not retried here.
//
// Bump this only when storyboard semantics change enough that old accepted
// storyboard/image checkpoints would violate the new directing contract.
// Deliberately scope it to long AI-Director identities so job fingerprints,
// sprite checkpoints and unrelated caches remain resumable/stable.
export const ANIMATION_STORYBOARD_POLICY_EPOCH = 'reference-film-2026-09-27-v4-style-profile-calibration';

function isLongDirectorCheckpointIdentity(identity: unknown) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return false;
  const value = identity as Record<string, unknown>;
  return typeof value.projectId === 'string'
    && typeof value.brief === 'string'
    && typeof value.targetDurationSeconds === 'number'
    && typeof value.mode === 'string';
}

export function animationCheckpointKey(identity: unknown) {
  const payload = isLongDirectorCheckpointIdentity(identity)
    ? { storyboardPolicyEpoch: ANIMATION_STORYBOARD_POLICY_EPOCH, identity }
    : identity;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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
  await writeJsonFileResilient(file, value);
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
