import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { run, ensureWorkdir, preferredH264Encoder } from "../services/ffmpeg";
import { getDubbingResult } from "../services/dubbingJobs";
import { buildExportAudioFilter, buildRetimedSourceAudioFilter, retimedDurationMs, retimedWindows } from "../services/exportAudio";
import {
  cleanupUploadSession,
  createTemporarySession,
  discardUploadStream,
  persistUploadStream,
  resolveUpload,
  safeUploadName,
  UploadTooLargeError,
} from "../services/uploads";

type Fields = Record<string, string>;
type Region = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  startMs: number;
  endMs: number;
  blurStrength: number;
  borderRadius?: number;
  mode?: "blur" | "neighbor";
};
type Logo = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  opacity: number;
};
type CropRegion = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
};
type VideoEdit = {
  aspectRatio?: "original" | "16:9" | "9:16" | "1:1" | "4:5";
  trimStartMs?: number;
  trimEndMs?: number;
  crop?: CropRegion;
};
type ExportProgress = {
  percent: number;
  stage: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  updatedAt: number;
};

const exportProgress = new Map<string, ExportProgress>();
const setExportProgress = (
  id: string | undefined,
  patch: Partial<ExportProgress>,
) => {
  if (!id) return;
  const current = exportProgress.get(id) || {
    percent: 1,
    stage: "Đang nhận video",
    status: "running" as const,
    updatedAt: Date.now(),
  };
  exportProgress.set(id, { ...current, ...patch, updatedAt: Date.now() });
};
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const uploadError = (error: unknown) =>
  error instanceof UploadTooLargeError ||
  (error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE");
const ffmpegPath = (file: string) =>
  file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const assField = (value: string) => value.replace(/[\r\n,]/g, " ").trim();

async function appendComplexFilter(
  args: string[],
  filter: string,
  directory: string,
  name: string,
) {
  // Windows limits the complete CreateProcess command line to roughly 32 KiB.
  // A retimed long-form video can contain thousands of cue expressions, so
  // passing the graph inline makes spawn fail with ENAMETOOLONG before FFmpeg
  // even starts. FFmpeg's script option keeps the command itself constant.
  if (process.platform === "win32" && filter.length > 8_000) {
    const script = path.join(directory, `${name}-filter.ffscript`);
    await writeFile(script, filter, "utf8");
    // FFmpeg 7+ replaced the deprecated -filter_complex_script spelling with
    // the generic file-loading form: -/filter_complex <path>.
    args.push("-/filter_complex", script);
    return;
  }
  args.push("-filter_complex", filter);
}

export function buildSlowVideoSetpts(metadata: Array<{
  originalDurationMs: number;
  ttsDurationMs: number;
  timelineStartMs?: number;
  timelineShiftMs?: number;
}>) {
  const terms = metadata.flatMap((cue) => {
    const duration = Math.max(1, Number(cue.originalDurationMs) || 1) / 1000;
    const speech = Math.max(1, Number(cue.ttsDurationMs) || 1) / 1000;
    const extension = Math.max(0, speech - duration);
    if (extension < 0.001 || !Number.isFinite(cue.timelineStartMs)) return [];
    const start = Math.max(0, (Number(cue.timelineStartMs) - Number(cue.timelineShiftMs || 0)) / 1000);
    const end = start + duration;
    const slope = extension / duration;
    return [`if(between(PTS*TB,${start.toFixed(6)},${end.toFixed(6)}),(PTS*TB-${start.toFixed(6)})*${slope.toFixed(9)},if(gte(PTS*TB,${end.toFixed(6)}),${extension.toFixed(6)},0))`];
  });
  return terms.length ? `setpts='PTS-STARTPTS+(${terms.join('+')})/TB'` : 'setpts=PTS-STARTPTS';
}

export function buildSlowVideoFilter(
  input: string,
  metadata: Array<{
    originalDurationMs: number;
    ttsDurationMs: number;
    timelineStartMs?: number;
    timelineShiftMs?: number;
  }>,
  output = "slowDubVideo",
) {
  const slowed = retimedWindows(metadata);
  if (!slowed.length) return `[${input}]setpts=PTS-STARTPTS[${output}]`;

  const segments: Array<{ endMs?: number; scale: number }> = [];
  let cursorMs = 0;
  for (const cue of slowed) {
    const { startMs, endMs } = cue;
    if (startMs > cursorMs) segments.push({ endMs: startMs, scale: 1 });
    if (endMs > startMs) segments.push({ endMs, scale: cue.scale });
    cursorMs = endMs;
  }
  segments.push({ scale: 1 });

  const timestamps = segments.slice(0, -1).map((segment) => ((segment.endMs || 0) / 1000).toFixed(6)).join("|");
  const sources = segments.map((_segment, index) => `[retimeVideoSrc${index}]`).join("");
  const parts = segments.map((_segment, index) => `[retimeVideoPart${index}]`).join("");
  const filters = [`[${input}]segment=timestamps=${timestamps}${sources}`];
  segments.forEach((segment, index) => {
    const scale = Math.abs(segment.scale - 1) < 0.0000005 ? "" : `*${segment.scale.toFixed(9)}`;
    filters.push(`[retimeVideoSrc${index}]setpts=(PTS-STARTPTS)${scale}[retimeVideoPart${index}]`);
  });
  filters.push(`${parts}concat=n=${segments.length}:v=1:a=0[${output}]`);
  return filters.join(";");
}

/**
 * The browser can give an uploaded font any CSS family name.  libass cannot:
 * it must receive the family embedded in the font file or it silently falls
 * back to another (often visibly heavier) face.  Read name IDs 16/1 directly
 * from TTF/OTF's name table; WOFF files simply retain the chosen family.
 */
async function embeddedFontFamily(file: string): Promise<string | undefined> {
  try {
    const data = await readFile(file);
    if (
      data.length < 12 ||
      data.toString("ascii", 0, 4) === "wOFF" ||
      data.toString("ascii", 0, 4) === "wOF2"
    )
      return undefined;
    const tableCount = data.readUInt16BE(4);
    let nameOffset = -1;
    let nameLength = 0;
    for (let index = 0; index < tableCount; index += 1) {
      const offset = 12 + index * 16;
      if (offset + 16 > data.length) break;
      if (data.toString("ascii", offset, offset + 4) !== "name") continue;
      nameOffset = data.readUInt32BE(offset + 8);
      nameLength = data.readUInt32BE(offset + 12);
      break;
    }
    if (
      nameOffset < 0 ||
      nameOffset + 6 > data.length ||
      nameOffset + nameLength > data.length
    )
      return undefined;
    const count = data.readUInt16BE(nameOffset + 2);
    const stringsOffset = data.readUInt16BE(nameOffset + 4);
    const candidates: Array<{ priority: number; value: string }> = [];
    for (let index = 0; index < count; index += 1) {
      const offset = nameOffset + 6 + index * 12;
      if (offset + 12 > data.length) break;
      const platform = data.readUInt16BE(offset);
      const language = data.readUInt16BE(offset + 4);
      const nameId = data.readUInt16BE(offset + 6);
      const length = data.readUInt16BE(offset + 8);
      const relative = data.readUInt16BE(offset + 10);
      const start = nameOffset + stringsOffset + relative;
      if (
        (nameId !== 16 && nameId !== 1) ||
        start < 0 ||
        start + length > data.length
      )
        continue;
      const raw = data.subarray(start, start + length);
      const value =
        platform === 3
          ? Buffer.from(raw).swap16().toString("utf16le")
          : raw.toString("utf8");
      const normalized = assField(value);
      if (!normalized) continue;
      const priority =
        (nameId === 16 ? 4 : 0) +
        (platform === 3 ? 2 : 0) +
        (language === 0x0409 ? 1 : 0);
      candidates.push({ priority, value: normalized });
    }
    return candidates.sort((left, right) => right.priority - left.priority)[0]
      ?.value;
  } catch {
    return undefined;
  }
}

const replaceAssFontFamily = (ass: string, fontFamily?: string) => {
  if (!fontFamily) return ass;
  return ass.replace(/^(Style:\s*[^,]+,)[^,]*/m, `$1${assField(fontFamily)}`);
};

// `fontsdir` is most reliable when it contains only the requested font.  A
// Windows Fonts directory has hundreds of faces and libass can otherwise pick
// a fallback/synthetic-bold face even when the CSS preview found the right one.
const windowsFontFile = async (family: string | undefined) => {
  if (process.platform !== "win32" || !family) return undefined;
  const names: Record<string, string> = {
    arial: "arial.ttf",
    "arial black": "ariblk.ttf",
    "arial narrow": "arialn.ttf",
    calibri: "calibri.ttf",
    cambria: "cambria.ttc",
    "comic sans ms": "comic.ttf",
    consolas: "consola.ttf",
    "courier new": "cour.ttf",
    georgia: "georgia.ttf",
    impact: "impact.ttf",
    "segoe ui": "segoeui.ttf",
    "segoe ui black": "seguibl.ttf",
    "segoe ui light": "segoeuil.ttf",
    "segoe ui semibold": "seguisb.ttf",
    tahoma: "tahoma.ttf",
    "times new roman": "times.ttf",
    "trebuchet ms": "trebuc.ttf",
    verdana: "verdana.ttf",
  };
  const name = names[family.trim().toLowerCase()];
  if (!name) return undefined;
  const candidate = path.join(
    process.env.WINDIR || "C:\\Windows",
    "Fonts",
    name,
  );
  try {
    await stat(candidate);
    return candidate;
  } catch {
    return undefined;
  }
};

const fontFamilyFromAss = (ass: string) =>
  /^Style:\s*[^,]+,([^,]*)/m.exec(ass)?.[1]?.trim();
const outputSize = (
  resolution: string,
  aspectRatio?: VideoEdit["aspectRatio"],
) => {
  const shortEdge =
    resolution === "1440"
      ? 1440
      : resolution === "1080"
        ? 1080
        : resolution === "720"
          ? 720
          : undefined;
  if (!shortEdge) return undefined;
  if (aspectRatio === "9:16")
    return `${shortEdge}x${Math.round((shortEdge * 16) / 9)}`;
  if (aspectRatio === "1:1") return `${shortEdge}x${shortEdge}`;
  if (aspectRatio === "4:5")
    return `${shortEdge}x${Math.round((shortEdge * 5) / 4)}`;
  return `${Math.round((shortEdge * 16) / 9)}x${shortEdge}`;
};

export async function exportRoutes(app: FastifyInstance) {
  app.get("/api/export/progress/:id", async (request, reply) => {
    const id = String((request.params as { id?: string }).id || "");
    return reply.send(
      exportProgress.get(id) || {
        percent: 1,
        stage: "Đang tải video lên máy",
        status: "running",
      },
    );
  });

  app.post("/api/export/audio", async (request, reply) => {
    await ensureWorkdir();
    const body = (request.body || {}) as {
      uploadId?: string;
      dubbingJobId?: string;
      trimStartMs?: number;
      trimEndMs?: number;
      audioSource?: "dub" | "original" | "original-retimed";
    };
    const uploadId =
      typeof body.uploadId === "string" ? body.uploadId.trim() : "";
    const dubbingJobId =
      typeof body.dubbingJobId === "string" ? body.dubbingJobId.trim() : "";
    const audioSource = body.audioSource || (dubbingJobId ? "dub" : "original");
    const trimStartMs = Math.max(0, Math.round(Number(body.trimStartMs) || 0));
    const trimEndValue = Number(body.trimEndMs);
    const trimEndMs =
      Number.isFinite(trimEndValue) && trimEndValue > 0
        ? Math.round(trimEndValue)
        : undefined;
    if (trimEndMs !== undefined && trimEndMs <= trimStartMs) {
      return reply
        .code(400)
        .send({ error: "Điểm kết thúc phải nằm sau điểm bắt đầu." });
    }
    if (audioSource === "original-retimed" && (trimStartMs > 0 || trimEndMs !== undefined)) {
      return reply.code(400).send({ error: "Audio gốc đã khớp video chậm chưa hỗ trợ cắt đầu/cuối cùng lúc." });
    }

    let input: string;
    let completedDub = false;
    let retimeMetadata: Awaited<ReturnType<typeof getDubbingResult>>["metadata"] | undefined;
    try {
      if (audioSource === "original-retimed") {
        if (!uploadId || !dubbingJobId) throw new Error("Cần video nguồn và dubbing job để xuất audio gốc đã giãn.");
        input = (await resolveUpload(uploadId)).absolutePath;
        const result = await getDubbingResult(dubbingJobId);
        if (!result.job.config.slowVideoToMatchSpeech) throw new Error("Dubbing job này không dùng chế độ làm chậm video theo cue.");
        retimeMetadata = result.metadata;
      } else if (dubbingJobId) {
        input = (await getDubbingResult(dubbingJobId)).audioFile;
        completedDub = true;
      } else if (uploadId) {
        input = (await resolveUpload(uploadId)).absolutePath;
      } else {
        return reply
          .code(400)
          .send({ error: "Thiếu video hoặc bản lồng tiếng để xuất audio." });
      }
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : "Không tìm thấy audio hiện tại.",
      });
    }

    // A completed dub result is already a mastered 48 kHz WAV. Avoid a full
    // decode/filter/encode pass when the user requests that exact track.
    if (completedDub && trimStartMs === 0 && trimEndMs === undefined) {
      const inputStat = await stat(input);
      reply.header("Content-Type", "audio/wav");
      reply.header("Content-Length", String(inputStat.size));
      reply.header(
        "Content-Disposition",
        'attachment; filename="autosub-current-audio.wav"',
      );
      return reply.send(createReadStream(input));
    }

    const job = `audio-export-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const exportDir = await createTemporarySession('audio-export-');
    const output = path.join(exportDir, `${job}.wav`);
    const stagedOutput = path.join(exportDir, `${job}.rendering.wav`);
    const requestAbort = new AbortController();
    let responseSent = false;
    const abortOnClientClose = () => { if (!responseSent) requestAbort.abort(); };
    request.raw.once("aborted", abortOnClientClose);
    reply.raw.once("close", abortOnClientClose);

    try {
      const args = ["-y", "-i", input];
      if (trimStartMs > 0) args.push("-ss", (trimStartMs / 1000).toFixed(3));
      if (trimEndMs !== undefined)
        args.push("-t", ((trimEndMs - trimStartMs) / 1000).toFixed(3));
      if (retimeMetadata) {
        const durationProbe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input], requestAbort.signal);
        const sourceDurationMs = Math.max(1, Number(durationProbe.stdout.trim()) * 1000);
        const targetDurationMs = retimedDurationMs(sourceDurationMs, retimeMetadata);
        await appendComplexFilter(args, buildRetimedSourceAudioFilter(retimeMetadata, "0:a", "retimedOriginal", targetDurationMs), exportDir, job);
        args.push("-map", "[retimedOriginal]", "-vn");
      } else args.push("-map", "0:a:0", "-vn");
      args.push("-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", stagedOutput);
      await run("ffmpeg", args, requestAbort.signal);
      const rendered = await stat(stagedOutput);
      if (rendered.size <= 44)
        throw new Error("Video hiện tại không có audio hợp lệ để xuất.");
      await rename(stagedOutput, output);
      const outputStat = await stat(output);
      reply.header("Content-Type", "audio/wav");
      reply.header("Content-Length", String(outputStat.size));
      reply.header(
        "Content-Disposition",
        'attachment; filename="autosub-current-audio.wav"',
      );
      const stream = createReadStream(output);
      const cleanupOutput = () => {
        void cleanupUploadSession(exportDir);
      };
      stream.once("close", cleanupOutput);
      stream.once("error", cleanupOutput);
      responseSent = true;
      return reply.send(stream);
    } catch (error) {
      if (requestAbort.signal.aborted) return;
      const message =
        error instanceof Error ? error.message : "FFmpeg không thể xuất audio.";
      const friendly =
        /matches no streams|stream map.*matches no streams|does not contain any stream/i.test(
          message,
        )
          ? "Video hiện tại không có audio để xuất."
          : message;
      return reply.code(500).send({ error: friendly });
    } finally {
      request.raw.off("aborted", abortOnClientClose);
      reply.raw.off("close", abortOnClientClose);
      await Promise.all(
        [stagedOutput, responseSent ? undefined : output]
          .filter((file): file is string => Boolean(file))
          .map((file) => unlink(file).catch(() => undefined)),
      );
      if (!responseSent) await cleanupUploadSession(exportDir);
    }
  });

  app.post("/api/export/video", async (request, reply) => {
    await ensureWorkdir();
    const uploadDir = await createTemporarySession('export-');
    const fields: Fields = {};
    let input: string | undefined;
    let dubFile: string | undefined;
    let fontFile: string | undefined;
    let logoFile: string | undefined;
    let videoName = "input.mp4";
    let fontName = "uploaded-font.ttf";
    let logoName = "logo.png";

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname === "file") {
            videoName = safeUploadName(part.filename || videoName);
            input = (
              await persistUploadStream(
                part.file,
                path.join(uploadDir, `source-${videoName}`),
              )
            ).path;
          } else if (part.fieldname === "dubTrack") {
            dubFile = (
              await persistUploadStream(
                part.file,
                path.join(uploadDir, "dub-track.wav"),
              )
            ).path;
          } else if (part.fieldname === "fontFile") {
            fontName = safeUploadName(part.filename || fontName);
            fontFile = (
              await persistUploadStream(
                part.file,
                path.join(uploadDir, `font-${fontName}`),
              )
            ).path;
          } else if (part.fieldname === "logoFile") {
            logoName = safeUploadName(part.filename || logoName);
            logoFile = (
              await persistUploadStream(
                part.file,
                path.join(uploadDir, `logo-${logoName}`),
              )
            ).path;
          } else await discardUploadStream(part.file);
        } else {
          fields[part.fieldname] = String(part.value);
          if (part.fieldname === "exportId")
            setExportProgress(fields.exportId, {
              percent: 3,
              stage: "Đã nhận yêu cầu render",
              status: "running",
            });
        }
      }
    } catch (error) {
      await cleanupUploadSession(uploadDir);
      if (uploadError(error))
        return reply.code(413).send({ error: "File vượt quá giới hạn 4 GiB." });
      throw error;
    }

    if (!input && fields.uploadId) {
      try {
        input = (await resolveUpload(fields.uploadId)).absolutePath;
      } catch {
        await cleanupUploadSession(uploadDir);
        return reply.code(400).send({
          error: "Upload video không còn tồn tại. Hãy chọn lại video.",
        });
      }
    }
    if (!input) {
      await cleanupUploadSession(uploadDir);
      return reply.code(400).send({ error: "Thiếu video để xuất." });
    }

    let options: {
      resolution: "original" | "1440" | "1080" | "720";
      crf?: number;
      keepAudio: boolean;
      originalVolume?: number;
      burnSubtitles?: boolean;
      separateVocals?: boolean;
      blurRegions?: Region[];
      logo?: Logo;
      dubbingJobId?: string;
      videoEdit?: VideoEdit;
    };
    try {
      options = JSON.parse(
        fields.options ||
          '{"resolution":"original","crf":20,"keepAudio":true,"blurRegions":[]}',
      );
    } catch {
      await cleanupUploadSession(uploadDir);
      return reply.code(400).send({ error: "Tùy chọn export không hợp lệ." });
    }

    const ass = fields.ass;
    if (options.burnSubtitles !== false && !ass) {
      await cleanupUploadSession(uploadDir);
      return reply.code(400).send({ error: "Thiếu ASS subtitle." });
    }
    const exportId = fields.exportId;
    const trimStartMs = Math.max(
      0,
      Number(options.videoEdit?.trimStartMs) || 0,
    );
    const trimEndMs = Number(options.videoEdit?.trimEndMs) || undefined;
    if (trimEndMs !== undefined && trimEndMs <= trimStartMs) {
      await cleanupUploadSession(uploadDir);
      return reply
        .code(400)
        .send({ error: "Điểm kết thúc phải nằm sau điểm bắt đầu." });
    }
    const trimStartSeconds = trimStartMs / 1000;
    const trimDurationSeconds =
      trimEndMs === undefined ? undefined : (trimEndMs - trimStartMs) / 1000;
    setExportProgress(exportId, {
      percent: 6,
      stage: "Đang chuẩn bị media",
      status: "running",
    });
    let jobDubPath: string | undefined;
    let jobDubIncludesBackground = false;
    let jobKeepOriginal = false;
    let jobOriginalVolume: number | undefined;
    let slowVideoMetadata: Awaited<ReturnType<typeof getDubbingResult>>['metadata'] | undefined;
    if (options.dubbingJobId) {
      try {
        const result = await getDubbingResult(options.dubbingJobId);
        jobDubPath = result.audioFile;
        if (result.job.config.slowVideoToMatchSpeech) slowVideoMetadata = result.metadata;
        jobKeepOriginal = Boolean(result.job.config.audioMix.keepOriginal && !result.job.config.audioMix.separateVocals);
        jobOriginalVolume = result.job.config.audioMix.originalVolume;
        jobDubIncludesBackground = Boolean(
          result.job.config.audioMix.keepOriginal &&
            result.job.config.audioMix.separateVocals,
        );
      } catch (error) {
        await cleanupUploadSession(uploadDir);
        return reply.code(400).send({
          error:
            error instanceof Error ? error.message : "Dub job chưa hoàn tất.",
        });
      }
    }

    const job = `export-${Date.now()}`;
    const assFile = path.join(uploadDir, `${job}.ass`);
    const output = path.join(uploadDir, `${job}.mp4`);
    // Never expose FFmpeg's in-progress file as a download.  An interrupted
    // MP4 does not contain its final `moov` atom, which Windows Media Player
    // correctly reports as an unsupported/corrupt encoding.
    const stagedOutput = path.join(uploadDir, `${job}.rendering.mp4`);
    const separationDir = path.join(uploadDir, `${job}-stems`);
    const requestAbort = new AbortController();
    let responseSent = false;
    const abortOnClientClose = () => { if (!responseSent) requestAbort.abort(); };
    request.raw.once("aborted", abortOnClientClose);
    reply.raw.once("close", abortOnClientClose);
    let responseStream: ReturnType<typeof createReadStream> | undefined;

    try {
      const requestedFamily = fontFamilyFromAss(ass || "");
      const resolvedFontFile =
        fontFile || (await windowsFontFile(requestedFamily));
      const fontFamily = resolvedFontFile
        ? await embeddedFontFamily(resolvedFontFile)
        : undefined;
      const renderedAss = replaceAssFontFamily(ass || "", fontFamily);
      // Keep the selected font isolated for this one render.  This avoids
      // libass substituting a bold/incorrect face from the full system font
      // collection, which made the exported subtitle visibly heavier than the
      // browser preview.
      let isolatedFontDir: string | undefined;
      if (resolvedFontFile) {
        isolatedFontDir = path.join(uploadDir, "subtitle-font");
        await mkdir(isolatedFontDir, { recursive: true });
        await copyFile(
          resolvedFontFile,
          path.join(isolatedFontDir, path.basename(resolvedFontFile)),
        );
      }
      await writeFile(assFile, renderedAss, "utf8");
      setExportProgress(exportId, {
        percent: 10,
        stage: "Đã lưu video nguồn",
        status: "running",
      });
      const regions = options.blurRegions || [];
      const filters: string[] = [];
      let current = "0:v";

      if (slowVideoMetadata?.length) {
        if (trimStartMs > 0 || trimEndMs !== undefined) {
          throw new Error("Chế độ làm chậm video theo cue chưa hỗ trợ cắt đầu/cuối cùng lúc. Hãy bỏ phạm vi cắt rồi xuất lại.");
        }
        filters.push(buildSlowVideoFilter(current, slowVideoMetadata));
        current = "slowDubVideo";
      }

      const requestedCrop = options.videoEdit?.crop;
      if (requestedCrop) {
        const xPercent = clamp(Number(requestedCrop.xPercent), 0, 99);
        const yPercent = clamp(Number(requestedCrop.yPercent), 0, 99);
        const widthPercent = clamp(
          Number(requestedCrop.widthPercent),
          1,
          100 - xPercent,
        );
        const heightPercent = clamp(
          Number(requestedCrop.heightPercent),
          1,
          100 - yPercent,
        );
        const cropX = `trunc(iw*${xPercent / 100}/2)*2`;
        const cropY = `trunc(ih*${yPercent / 100}/2)*2`;
        const cropW = `max(2,trunc(iw*${widthPercent / 100}/2)*2)`;
        const cropH = `max(2,trunc(ih*${heightPercent / 100}/2)*2)`;
        filters.push(
          `[${current}]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}'[cropOut]`,
        );
        current = "cropOut";
      } else {
        const canvasRatio =
          options.videoEdit?.aspectRatio &&
          options.videoEdit.aspectRatio !== "original"
            ? (
                {
                  "16:9": 16 / 9,
                  "9:16": 9 / 16,
                  "1:1": 1,
                  "4:5": 4 / 5,
                } as const
              )[options.videoEdit.aspectRatio]
            : undefined;
        if (canvasRatio) {
          // The aspect-ratio picker changes the output canvas, not the source
          // crop. Fit the full source and letterbox/pillarbox surplus space.
          // Cropping remains an explicit Crop-modal action.
          const ratio = canvasRatio.toFixed(8);
          filters.push(
            `[${current}]scale=w='if(gt(a,${ratio}),round(ih*${ratio}/2)*2,iw)':h='if(gt(a,${ratio}),-2,round(iw/${ratio}/2)*2)',pad=w='max(iw,round(ih*${ratio}/2)*2)':h='max(ih,round(iw/${ratio}/2)*2)':x='(ow-iw)/2':y='(oh-ih)/2':color=black,setsar=1[aspectOut]`,
          );
          current = "aspectOut";
        }
      }

      regions.forEach((region, index) => {
        const xPercent = clamp(Number(region.xPercent), 0, 99);
        const yPercent = clamp(Number(region.yPercent), 0, 99);
        const widthPercent = clamp(
          Number(region.widthPercent),
          1,
          100 - xPercent,
        );
        const heightPercent = clamp(
          Number(region.heightPercent),
          1,
          100 - yPercent,
        );
        const start = Math.max(0, Number(region.startMs) || 0) / 1000;
        const end = Math.max(start, Number(region.endMs) || 0) / 1000;
        const radius = Math.max(
          3,
          Math.min(60, Math.round(Number(region.blurStrength) || 24)),
        );
        const borderRadius = clamp(Number(region.borderRadius ?? 0), 0, 24);
        // Treat the control as a real corner radius. CSS percentage radii on a
        // wide subtitle strip become an exaggerated capsule and do not match
        // the exported frame.
        const cornerRadius = `min(${Math.round(borderRadius)},min(W,H)/2)`;
        const roundedMask =
          borderRadius > 0
            ? `if(gt(between(X,${cornerRadius},W-${cornerRadius})+between(Y,${cornerRadius},H-${cornerRadius})+lte(hypot(X-${cornerRadius},Y-${cornerRadius}),${cornerRadius})+lte(hypot(X-(W-${cornerRadius}),Y-${cornerRadius}),${cornerRadius})+lte(hypot(X-${cornerRadius},Y-(H-${cornerRadius})),${cornerRadius})+lte(hypot(X-(W-${cornerRadius}),Y-(H-${cornerRadius})),${cornerRadius}),0),1,0)`
            : "1";
        // Keep the export region identical to the editor selection. The centre
        // stays fully blurred so source subtitles cannot bleed through, while a
        // short edge feather lets the patch merge back into the actual scene
        // instead of reading as a hard grey rectangle.
        const base = `base${index}`;
        const crop = `crop${index}`;
        const blur = `blur${index}`;
        const out = `video${index}`;
        const cropX = `trunc(iw*${xPercent / 100}/2)*2`;
        const cropY = `trunc(ih*${yPercent / 100}/2)*2`;
        const cropW = `max(2,trunc(iw*${widthPercent / 100}/2)*2)`;
        const cropH = `max(2,trunc(ih*${heightPercent / 100}/2)*2)`;
        const overlayX = `trunc(main_w*${xPercent / 100}/2)*2`;
        const overlayY = `trunc(main_h*${yPercent / 100}/2)*2`;
        // Blur only the selected source pixels, then put those pixels back in
        // exactly the same position.  It retains the real scene underneath
        // (unlike a mirrored-neighbour patch) while making the original text
        // unreadable.  Blur first and burn the new ASS subtitle afterwards.
        // A very large Gaussian radius with six approximation passes makes a
        // subtitle-sized patch dominate the whole export (and can leave a
        // short video sitting near completion for many minutes). Two passes
        // at this radius still destroy the source glyphs while preserving the
        // selected region and the natural scene colours around it.
        const sigma = Math.min(
          48,
          Math.max(
            24,
            Math.round(radius * (region.mode === "neighbor" ? 1.85 : 1.65)),
          ),
        );
        const edgeFeather = clamp(Math.round(radius * 0.38), 8, 18);
        const edgeAlpha = `min(1,max(0,min(min(X,W-1-X),min(Y,H-1-Y))/${edgeFeather}))`;
        const alpha = `255*(${roundedMask})*${edgeAlpha}`;
        filters.push(
          `[${current}]split=2[${base}][${crop}];[${crop}]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',gblur=sigma=${sigma}:steps=2,eq=brightness=-0.025:saturation=0.92,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[${blur}];[${base}][${blur}]overlay=x=${overlayX}:y=${overlayY}:format=auto:enable='between(t,${start},${end})'[${out}]`,
        );
        current = out;
      });

      const args: string[] = ["-y"];
      if (trimStartSeconds > 0) args.push("-ss", trimStartSeconds.toFixed(3));
      args.push("-i", input);
      let nextInputIndex = 1;
      let logoInputIndex: number | undefined;
      if (logoFile) {
        logoInputIndex = nextInputIndex;
        nextInputIndex += 1;
        args.push("-loop", "1", "-i", logoFile);
      }
      const hasDub = Boolean(dubFile || jobDubPath);
      let dubInputIndex: number | undefined;
      if (hasDub) {
        dubInputIndex = nextInputIndex;
        nextInputIndex += 1;
        if (trimStartSeconds > 0) args.push("-ss", trimStartSeconds.toFixed(3));
        args.push("-i", jobDubPath || (dubFile as string));
      }

      let backgroundAudioPath: string | undefined;
      if (options.separateVocals && !jobDubIncludesBackground) {
        setExportProgress(exportId, {
          percent: 14,
          stage: "Đang tách lời gốc khỏi nhạc nền bằng Demucs",
          status: "running",
        });
        await mkdir(separationDir, { recursive: true });
        await run(
          "py",
          [
            "-3.12",
            "-m",
            "demucs",
            "--two-stems",
            "vocals",
            "-n",
            "htdemucs",
            "--out",
            separationDir,
            input,
          ],
          requestAbort.signal,
        );
        backgroundAudioPath = path.join(
          separationDir,
          "htdemucs",
          path.parse(input).name,
          "no_vocals.wav",
        );
        setExportProgress(exportId, {
          percent: 42,
          stage: "Đã tách lời, đang dựng video",
          status: "running",
        });
      }
      let backgroundInputIndex: number | undefined;
      if (backgroundAudioPath) {
        backgroundInputIndex = nextInputIndex;
        nextInputIndex += 1;
        if (trimStartSeconds > 0) args.push("-ss", trimStartSeconds.toFixed(3));
        args.push("-i", backgroundAudioPath);
      }

      if (logoInputIndex !== undefined && options.logo) {
        const xPercent = clamp(Number(options.logo.xPercent), 0, 99);
        const yPercent = clamp(Number(options.logo.yPercent), 0, 99);
        const widthPercent = clamp(Number(options.logo.widthPercent), 2, 80);
        const opacity = clamp(Number(options.logo.opacity), 0, 1);
        const logoX = `trunc(main_w*${xPercent / 100}/2)*2`;
        const logoY = `trunc(main_h*${yPercent / 100}/2)*2`;
        // Match the browser preview's `width: N%; height: auto` exactly:
        // derive only the width from the rendered canvas, then let scale2ref
        // calculate an even height from the logo's own aspect ratio.  Supplying
        // a second expression involving `iw`/`ih` can use the reference-video
        // dimensions in some FFmpeg builds and stretch PNG/JPG logos.
        const logoWidth = `trunc(main_w*${widthPercent / 100}/2)*2`;
        filters.push(
          `[${logoInputIndex}:v]format=rgba,setsar=1[logoRaw];[logoRaw][${current}]scale2ref=w='${logoWidth}':h=-2[logoScaled][logoBase];[logoScaled]setsar=1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[logoOpacity];[logoBase]setsar=1[logoVideo];[logoVideo][logoOpacity]overlay=x=${logoX}:y=${logoY}:format=auto:eof_action=repeat[logoOut]`,
        );
        current = "logoOut";
      }

      // Browser preview uses Windows' installed fonts. Point libass at the
      // same directory for built-in font choices, otherwise it may silently
      // substitute a heavier fallback face only in the exported MP4.
      const preferredFontDir = isolatedFontDir
        ? isolatedFontDir
        : process.platform === "win32"
          ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts")
          : "";
      const fontDir = preferredFontDir
        .replace(/\\/g, "/")
        .replace(/:/g, "\\:")
        .replace(/'/g, "\\'");
      const scaledOutput = outputSize(
        options.resolution,
        options.videoEdit?.aspectRatio,
      );
      // Preserve the encoded picture when export only replaces/mixes audio.
      // This is lossless for video and avoids decoding every frame.
      const copyVideoStream = options.burnSubtitles === false
        && filters.length === 0
        && !scaledOutput;
      if (!copyVideoStream)
        filters.push(
          options.burnSubtitles === false
            ? `[${current}]null[videoout]`
            : `[${current}]subtitles='${ffmpegPath(assFile)}'${fontDir ? `:fontsdir='${fontDir}'` : ""}[videoout]`,
        );

      const audio = buildExportAudioFilter({
        hasDub,
        dubInputIndex,
        backgroundInputIndex,
        keepAudio: options.keepAudio || jobKeepOriginal,
        originalVolume: jobOriginalVolume ?? options.originalVolume,
        jobDubIncludesBackground,
        originalInputLabel: slowVideoMetadata?.length && (options.keepAudio || jobKeepOriginal) ? "retimedOriginal" : "0:a",
      });
      if (slowVideoMetadata?.length && (options.keepAudio || jobKeepOriginal)) {
        filters.unshift(buildRetimedSourceAudioFilter(slowVideoMetadata));
      }
      if (audio) filters.push(audio);

      if (filters.length) await appendComplexFilter(args, filters.join(";"), uploadDir, job);
      args.push("-map", copyVideoStream ? "0:v" : "[videoout]");
      if (audio) args.push("-map", "[audioout]");
      if (scaledOutput) args.push("-s", scaledOutput);
      // Keep H.264 compatibility and benchmark the available encoders once per
      // server run. QVBR preserves the requested visual-quality target when
      // AMD AMF wins; otherwise the established x264 path remains unchanged.
      const requestedQuality = String(Math.round(clamp(Number(options.crf ?? 20), 16, 35)));
      const videoEncoder = copyVideoStream ? undefined : await preferredH264Encoder();
      if (copyVideoStream) {
        args.push("-c:v", "copy");
      } else if (videoEncoder === "h264_amf") {
        args.push(
          "-c:v", "h264_amf", "-usage", "transcoding", "-quality", "quality",
          "-rc", "qvbr", "-qvbr_quality_level", requestedQuality,
          "-vbaq", "true", "-preanalysis", "true",
          "-pix_fmt", "yuv420p", "-profile:v", "high", "-tag:v", "avc1",
        );
      } else {
        args.push(
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high",
          "-tag:v", "avc1", "-crf", requestedQuality, "-preset", "veryfast",
        );
      }
      if (audio) args.push("-c:a", "aac", "-shortest");
      else args.push("-an");

      const durationProbe = await run(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=nw=1:nk=1",
          input,
        ],
        requestAbort.signal,
      );
      const sourceDurationMs = Math.max(
        1,
        Number(durationProbe.stdout.trim()) * 1000,
      );
      const durationMs = Math.max(
        1,
        Math.min(
          trimDurationSeconds === undefined
            ? sourceDurationMs - trimStartMs
            : trimDurationSeconds * 1000,
          sourceDurationMs - trimStartMs,
        ),
      );
      const renderDurationMs = slowVideoMetadata?.length
        ? retimedDurationMs(durationMs, slowVideoMetadata)
        : durationMs;
      // Logo inputs loop and padded audio is intentionally unbounded. Always
      // provide the finite output duration so `-shortest` cannot wait forever
      // after the source video has ended.
      args.push("-t", (renderDurationMs / 1000).toFixed(3));
      // The file is downloaded only after a successful encode, so a second
      // full-file faststart relocation is unnecessary. The staged file is
      // validated and atomically renamed before it is sent to the browser.
      args.push("-progress", "pipe:2", "-nostats", stagedOutput);
      let progressBuffer = "";
      let renderSpeed = "";
      let renderStalled = false;
      const renderAbort = new AbortController();
      const abortRender = () => renderAbort.abort();
      requestAbort.signal.addEventListener("abort", abortRender, {
        once: true,
      });
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const armStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          renderStalled = true;
          renderAbort.abort();
        }, 180_000);
      };
      setExportProgress(exportId, {
        percent: Math.max(45, exportProgress.get(exportId || "")?.percent || 0),
        stage: copyVideoStream ? "Đang ghép nhanh audio với video gốc" : videoEncoder === "h264_amf" ? "AMD GPU đang render video và âm thanh" : "FFmpeg đang render video và âm thanh",
        status: "running",
      });
      armStallTimer();
      try {
        await run("ffmpeg", args, renderAbort.signal, (chunk) => {
          armStallTimer();
          progressBuffer += chunk;
          const lines = progressBuffer.split(/\r?\n/);
          progressBuffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            const speedMatch = /^speed=([^\s]+)/.exec(trimmed);
            if (speedMatch) renderSpeed = speedMatch[1];
            const match = /^out_time_(?:us|ms)=(\d+)/.exec(trimmed);
            if (!match) continue;
            const renderedMs = Number(match[1]) / 1000;
            const renderer = copyVideoStream ? "Ghép nhanh" : videoEncoder === "h264_amf" ? "AMD GPU" : "FFmpeg";
            const stage = renderSpeed
              ? `${renderer} đang render video và âm thanh · ${renderSpeed}`
              : `${renderer} đang render video và âm thanh`;
            setExportProgress(exportId, {
              percent: Math.round(
                Math.min(96, Math.max(45, 45 + (renderedMs / renderDurationMs) * 51)),
              ),
              stage,
              status: "running",
            });
          }
        });
      } catch (error) {
        if (renderStalled) {
          throw new Error(
            "FFmpeg không tạo thêm dữ liệu trong 3 phút nên AutoSub đã dừng job bị treo. Hãy thử xuất lại và kiểm tra dung lượng đĩa nếu lỗi lặp lại.",
          );
        }
        throw error;
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
        requestAbort.signal.removeEventListener("abort", abortRender);
      }

      setExportProgress(exportId, {
        percent: 97,
        stage: "Đã mã hóa xong, đang kiểm tra file MP4",
        status: "running",
      });
      const renderProbe = await run(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=format_name,duration:stream=codec_type",
          "-of",
          "json",
          stagedOutput,
        ],
        requestAbort.signal,
      );
      let renderInfo: {
        format?: { format_name?: string; duration?: string };
        streams?: Array<{ codec_type?: string }>;
      };
      try {
        renderInfo = JSON.parse(renderProbe.stdout) as typeof renderInfo;
      } catch {
        throw new Error(
          "FFmpeg tạo file MP4 chưa hoàn chỉnh; không thể xác minh trước khi tải.",
        );
      }
      const hasVideo = renderInfo.streams?.some(
        (stream) => stream.codec_type === "video",
      );
      const validMp4 = renderInfo.format?.format_name
        ?.split(",")
        .includes("mp4");
      const renderedDuration = Number(renderInfo.format?.duration);
      if (
        !hasVideo ||
        !validMp4 ||
        !Number.isFinite(renderedDuration) ||
        renderedDuration <= 0
      ) {
        throw new Error(
          "FFmpeg tạo file MP4 chưa hoàn chỉnh; AutoSub đã chặn tải file lỗi. Hãy xuất lại video.",
        );
      }
      const expectedDurationSeconds = renderDurationMs / 1000;
      const minimumCompleteDuration = Math.max(
        0,
        expectedDurationSeconds - Math.max(3, expectedDurationSeconds * 0.001),
      );
      if (renderedDuration < minimumCompleteDuration) {
        throw new Error(
          `FFmpeg chỉ render được ${renderedDuration.toFixed(1)}s / ${expectedDurationSeconds.toFixed(1)}s; AutoSub đã chặn tải video bị cắt ngắn.`,
        );
      }
      setExportProgress(exportId, {
        percent: 99,
        stage: "File hợp lệ, đang hoàn tất tải xuống",
        status: "running",
      });
      await rename(stagedOutput, output);
      const outputStat = await stat(output);
      setExportProgress(exportId, {
        percent: 100,
        stage: "Đã render xong video",
        status: "completed",
      });
      reply.header("Content-Type", "video/mp4");
      reply.header("Content-Length", String(outputStat.size));
      reply.header(
        "Content-Disposition",
        'attachment; filename="autosub-final.mp4"',
      );
      responseStream = createReadStream(output);
      const cleanupOutput = () => {
        void cleanupUploadSession(uploadDir);
      };
      responseStream.once("close", cleanupOutput);
      responseStream.once("error", cleanupOutput);
      responseSent = true;
      return reply.send(responseStream);
    } catch (error) {
      if (requestAbort.signal.aborted) {
        setExportProgress(fields.exportId, {
          status: "cancelled",
          stage: "Đã hủy render",
        });
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : "FFmpeg không thể render video.";
      const friendly = /No module named demucs/i.test(message)
        ? "Chưa cài Demucs cho Python 3.12. Hãy cài dependency tách lời trước khi dùng chế độ giữ nhạc nền."
        : message;
      setExportProgress(fields.exportId, {
        status: "failed",
        stage: "Render thất bại",
        error: friendly,
      });
      return reply.code(500).send({ error: friendly });
    } finally {
      request.raw.off("aborted", abortOnClientClose);
      reply.raw.off("close", abortOnClientClose);
      await Promise.all(
        [assFile, stagedOutput, responseSent ? undefined : output]
          .filter((file): file is string => Boolean(file))
          .map((file) => unlink(file).catch(() => undefined)),
      );
      await rm(separationDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
      if (!responseSent) await cleanupUploadSession(uploadDir);
      if (fields.exportId)
        setTimeout(
          () => exportProgress.delete(fields.exportId),
          10 * 60_000,
        ).unref?.();
    }
  });
}
