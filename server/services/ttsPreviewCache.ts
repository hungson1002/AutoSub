type PreviewEntry = { audio: Buffer; expiresAt: number };

const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 64;
const CACHE_TTL_MS = 6 * 60 * 60_000;

const entries = new Map<string, PreviewEntry>();
const pending = new Map<string, Promise<Buffer>>();
let totalBytes = 0;

function remove(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  totalBytes -= entry.audio.length;
  entries.delete(key);
}

function prune() {
  const now = Date.now();
  for (const [key, entry] of entries) if (entry.expiresAt <= now) remove(key);
  while (entries.size > MAX_CACHE_ENTRIES || totalBytes > MAX_CACHE_BYTES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (!oldest) break;
    remove(oldest);
  }
}

export async function cachedTtsPreview(key: string, create: () => Promise<Buffer>) {
  prune();
  const cached = entries.get(key);
  if (cached) {
    entries.delete(key);
    entries.set(key, cached);
    return { audio: cached.audio, cache: 'hit' as const };
  }

  const inFlight = pending.get(key);
  if (inFlight) return { audio: await inFlight, cache: 'shared' as const };

  const task = create();
  pending.set(key, task);
  try {
    const audio = await task;
    if (audio.length <= MAX_CACHE_BYTES) {
      entries.set(key, { audio, expiresAt: Date.now() + CACHE_TTL_MS });
      totalBytes += audio.length;
      prune();
    }
    return { audio, cache: 'miss' as const };
  } finally {
    pending.delete(key);
  }
}

export function clearTtsPreviewCache() {
  entries.clear();
  pending.clear();
  totalBytes = 0;
}

export function ttsPreviewCacheStats() {
  prune();
  return { entries: entries.size, bytes: totalBytes, pending: pending.size };
}
