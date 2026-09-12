export interface VideoCdnMeasurement {
  url: string;
  index: number;
  speed: number;
  bytes: number;
  complete: boolean;
  partialContent: boolean;
}

export function orderVideoCdnMeasurements(measurements: VideoCdnMeasurement[], sampleBytes: number) {
  const minimumUsefulSample = Math.min(sampleBytes, 256 * 1024);
  return [...measurements].sort((a, b) => {
    const aUsable = a.partialContent && a.bytes >= minimumUsefulSample;
    const bUsable = b.partialContent && b.bytes >= minimumUsefulSample;
    return Number(bUsable) - Number(aUsable)
      || b.speed - a.speed
      || Number(b.complete) - Number(a.complete)
      || a.index - b.index;
  });
}

/** Rank only the provider's alternate URLs for the same video stream. */
export async function rankVideoCdns(urls: string[], headers: Record<string, string>, signal: AbortSignal): Promise<string[]> {
  const candidates = [...new Set(urls)];
  if (candidates.length < 2) return candidates;
  const sampleBytes = 1024 * 1024;
  const measured = await Promise.all(candidates.slice(0, 4).map(async (url, index) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    const started = performance.now();
    let bytes = 0;
    let partialContent = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(url, { headers: { ...headers, Range: `bytes=0-${sampleBytes - 1}` }, signal: AbortSignal.any([signal, controller.signal]) });
      partialContent = response.status === 206;
      if (!partialContent || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        return { url, index, speed: 0, bytes: 0, complete: false, partialContent: false };
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
    return {
      url,
      index,
      speed: bytes / Math.max(1, performance.now() - started),
      bytes,
      complete: bytes >= sampleBytes,
      partialContent,
    };
  }));
  if (signal.aborted) throw new Error('Đã hủy tải video.');
  // A timed-out probe that transferred a useful sample still reflects real
  // throughput. Requiring the whole sample used to favor slower CDNs.
  const ranked = orderVideoCdnMeasurements(measured, sampleBytes);
  return [...ranked.map((item) => item.url), ...candidates.slice(4)];
}
