/** Rank only the provider's alternate URLs for the same video stream. */
export async function rankVideoCdns(urls: string[], headers: Record<string, string>, signal: AbortSignal): Promise<string[]> {
  const candidates = [...new Set(urls)];
  if (candidates.length < 2) return candidates;
  const sampleBytes = 2 * 1024 * 1024;
  const measured = await Promise.all(candidates.slice(0, 4).map(async (url, index) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const started = performance.now();
    let bytes = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(url, { headers: { ...headers, Range: `bytes=0-${sampleBytes - 1}` }, signal: AbortSignal.any([signal, controller.signal]) });
      if (response.status !== 206 || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        return { url, index, speed: 0, complete: false };
      }
      reader = response.body.getReader();
      while (bytes < sampleBytes) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
      }
    } catch {
      // Preserve slow/failed candidates as fallbacks; probes must not fail a job.
    } finally {
      controller.abort();
      clearTimeout(timer);
      await reader?.cancel().catch(() => undefined);
    }
    return { url, index, speed: bytes / Math.max(1, performance.now() - started), complete: bytes >= sampleBytes };
  }));
  if (signal.aborted) throw new Error('Đã hủy tải video.');
  // A fast but truncated response is not a fast usable CDN.
  measured.sort((a, b) => Number(b.complete) - Number(a.complete) || b.speed - a.speed || a.index - b.index);
  return [...measured.map((item) => item.url), ...candidates.slice(4)];
}
