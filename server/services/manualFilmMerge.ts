import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { run } from './ffmpeg';

/** Normalize heterogeneous clips, preserving their audio and the supplied order. */
export async function mergeManualClips(clips: string[], output: string, aspect: '16:9' | '9:16', signal?: AbortSignal) {
  if (!clips.length) throw new Error('Chưa có clip để ghép.');
  const temp = await mkdtemp(path.join(path.dirname(output), 'merge-'));
  const [width, height] = aspect === '16:9' ? [1920, 1080] : [1080, 1920];
  try {
    for (const [index, clip] of clips.entries()) {
      const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', clip], signal)).stdout);
      const duration = Number(probe.format?.duration);
      if (!probe.streams?.some((s: { codec_type: string }) => s.codec_type === 'video') || !Number.isFinite(duration) || duration <= 0) throw new Error(`Clip ${index + 1} không có video hợp lệ.`);
      const audio = probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio');
      await run('ffmpeg', ['-y', '-i', clip, ...(!audio ? ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'] : []),
        '-map', '0:v:0', '-map', audio ? '0:a:0' : '1:a:0',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,
        '-af', 'aresample=48000,apad', '-t', String(duration), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-video_track_timescale', '15360', path.join(temp, `${index}.mp4`)], signal);
    }
    const list = path.join(temp, 'clips.txt');
    await writeFile(list, clips.map((_, i) => `file '${i}.mp4'`).join('\n'));
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '1', '-i', list, '-c', 'copy', '-movflags', '+faststart', output], signal);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
