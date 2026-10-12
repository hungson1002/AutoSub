/** Cut preview clips without resampling. Final export retains the full group. */
export function sliceDubbingPcm(wav: Buffer, startMs: number, endMs: number): Buffer {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid PCM WAV');
  let format: Buffer | undefined;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > wav.length) throw new Error('Truncated WAV chunk');
    const tag = wav.toString('ascii', offset, offset + 4);
    if (tag === 'fmt ') format = wav.subarray(offset + 8, end);
    if (tag === 'data') data = wav.subarray(offset + 8, end);
    offset = end + (size % 2);
  }
  if (!format || format.length < 16 || !data || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) throw new Error('Expected 16-bit PCM');
  const channels = format.readUInt16LE(2);
  const rate = format.readUInt32LE(4);
  const align = format.readUInt16LE(12);
  if (!channels || !rate || align !== channels * 2 || data.length % align || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error('Invalid PCM range');
  const frames = data.length / align;
  const start = Math.min(frames, Math.max(0, Math.round(startMs * rate / 1000)));
  const end = Math.min(frames, Math.max(start, Math.round(endMs * rate / 1000)));
  if (end <= start) throw new Error('Empty PCM range');
  const payload = data.subarray(start * align, end * align);
  const result = Buffer.alloc(44 + payload.length);
  result.write('RIFF', 0); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); format.copy(result, 20, 0, 16);
  result.write('data', 36); result.writeUInt32LE(payload.length, 40); payload.copy(result, 44);
  return result;
}
