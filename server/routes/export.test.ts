import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { run } from "../services/ffmpeg";
import { blurRegionWindowSeconds, buildSlowVideoFilter, embeddedFontFamily, h264QualityArgs, replaceAssFontFamily, safeDrawtextPosition, subtitleBurnFilter } from "./export";

test("subtitle export keeps glyphs and vector boxes on the same ASS canvas", () => {
  const filter = subtitleBurnFilter("C:\\render\\captions.ass", "[Script Info]\r\nPlayResX: 1920\r\nPlayResY: 1080\r\n", "C:\\render\\fonts");
  assert.equal(filter, "subtitles='C\\:/render/captions.ass':fontsdir='C\\:/render/fonts':original_size=1920x1080");
  assert.match(subtitleBurnFilter("captions.ass", "PlayResX: 1080\nPlayResY: 1920\n"), /:original_size=1080x1920$/);
  assert.doesNotMatch(subtitleBurnFilter("captions.ass", ""), /original_size/);
  assert.doesNotMatch(subtitleBurnFilter("captions.ass", "PlayResX: 0\nPlayResY: 1080\n"), /original_size/);
});

test("rendered Vietnamese captions stay inside their box on 4:3, 16:9 and portrait sources", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "autosub-caption-box-"));
  try {
    const fonts = path.join(directory, "fonts");
    await mkdir(fonts);
    await copyFile(path.join(process.cwd(), "public/fonts/Bangers-Regular.ttf"), path.join(fonts, "Bangers-Regular.ttf"));
    for (const [index, source] of ["640x480", "640x360", "360x640"].entries()) {
      const assFile = path.join(directory, "captions.ass");
      const png = path.join(directory, "frame.png");
      // Preserve the real failing export's font, size and measured box width.
      // Include two lines to check Vietnamese accents and line spacing too.
      const twoLines = index === 2;
      const top = twoLines ? 869 : 960;
      const height = twoLines ? 184 : 93;
      const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Bangers,90.5,&H00FFFFFF,&H00FFFFFF,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\\an7\\pos(449,${top})\\p1\\1c&H00000000}m 0 0 l 1022 0 l 1022 ${height} l 0 ${height}{\\p0}
Dialogue: 1,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\\an5\\pos(960,${Math.round(top + height / 2)})}Dụ nó haha, thế hóa ra nãy giờ tôi nói bằng thừa à${twoLines ? "\\NChữ tiếng Việt có dấu" : ""}
`;
      await writeFile(assFile, ass, "utf8");
      await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=0x60A080:s=${source}:r=2:d=1`,
        "-vf", `${subtitleBurnFilter(assFile, ass, fonts)},scale=1920:1080`, "-ss", "0.5", "-frames:v", "1", "-y", png]);
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const bounds = { box: [Infinity, Infinity, -1, -1], ink: [Infinity, Infinity, -1, -1] };
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const pixel = (y * info.width + x) * info.channels;
        const [r, g, b] = [data[pixel], data[pixel + 1], data[pixel + 2]];
        const rect = r < 20 && g < 20 && b < 20 ? bounds.box : r > 235 && g > 235 && b > 235 ? bounds.ink : undefined;
        if (rect) {
          rect[0] = Math.min(rect[0], x); rect[1] = Math.min(rect[1], y);
          rect[2] = Math.max(rect[2], x); rect[3] = Math.max(rect[3], y);
        }
      }
      assert.ok(bounds.ink[2] > bounds.ink[0], `${source}: caption must be visible`);
      assert.ok(bounds.ink[0] > bounds.box[0] && bounds.ink[2] < bounds.box[2], `${source}: text overflows the box horizontally`);
      assert.ok(bounds.ink[1] > bounds.box[1] && bounds.ink[3] < bounds.box[3], `${source}: Vietnamese accents overflow the box vertically: ${JSON.stringify(bounds)}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("filtered export uses quality-based H.264 encoding instead of source bitrate caps", () => {
  const x264 = h264QualityArgs("libx264", 18);
  assert.deepEqual(x264.slice(0, 6), ["-c:v", "libx264", "-preset", "fast", "-crf", "18"]);
  assert.equal(x264.includes("-b:v"), false);

  const nvenc = h264QualityArgs("h264_nvenc", 18);
  assert.ok(nvenc.includes("p5"));
  assert.ok(nvenc.includes("-cq"));
  assert.equal(nvenc[nvenc.indexOf("-cq") + 1], "18");
  assert.equal(nvenc[nvenc.indexOf("-b:v") + 1], "0");
  assert.equal(nvenc.includes("-maxrate"), false);

  const qsv = h264QualityArgs("h264_qsv", 18);
  assert.equal(qsv[qsv.indexOf("-global_quality") + 1], "18");
  assert.ok(qsv.includes("medium"));

  const amf = h264QualityArgs("h264_amf", 18);
  assert.ok(amf.includes("qvbr"));
  assert.equal(amf[amf.indexOf("-qvbr_quality_level") + 1], "18");

  assert.equal(h264QualityArgs("libx264", 2)[5], "16");
  assert.equal(h264QualityArgs("libx264", 99)[5], "35");
});

test("export replaces an uploaded browser font alias in every ASS style and cue", () => {
  const ass = [
    "Style: Outline,AutoSub Review Font,34,&H00FFFFFF",
    "Style: Box,AutoSub Review Font,34,&H00FFFFFF",
    "Dialogue: 1,0:00:00.00,0:00:01.00,Outline,,0,0,0,,{\\fnAutoSub Review Font\\fs34}Xin chào",
    "Dialogue: 2,0:00:00.00,0:00:01.00,Outline,,0,0,0,,{\\fnArial\\fs24}Logo",
  ].join("\n");

  const rendered = replaceAssFontFamily(ass, "SVN-Gilroy", "AutoSub Review Font");

  assert.equal((rendered.match(/Style: (?:Outline|Box),SVN-Gilroy/g) || []).length, 2);
  assert.match(rendered, /\\fnSVN-Gilroy\\fs34/);
  assert.match(rendered, /\\fnArial\\fs24/);
  assert.doesNotMatch(rendered, /AutoSub Review Font/);
});

test("bundled subtitle fonts expose the same family used by preview and ASS", async () => {
  const fonts = [
    ["Bangers-Regular.ttf", "Bangers"],
    ["Montserrat-Variable.ttf", "Montserrat"],
    ["BeVietnamPro-Regular.ttf", "Be Vietnam Pro"],
    ["Anton-Regular.ttf", "Anton"],
  ] as const;
  for (const [file, family] of fonts) {
    assert.equal(await embeddedFontFamily(path.join(process.cwd(), "public", "fonts", file)), family);
  }
});

test("text logo coordinates keep glyphs and outlines inside the exported frame", () => {
  assert.equal(safeDrawtextPosition("w", "text_w", 0, 3), "min(max(3,w*0.000000),w-text_w-3)");
  assert.equal(safeDrawtextPosition("h", "text_h", 0.99, 4), "min(max(4,h*0.990000),h-text_h-4)");
});

test("slow video export normalizes retimed frames back to constant frame pacing", () => {
  const filter = buildSlowVideoFilter("0:v", [
    {
      originalDurationMs: 1000,
      ttsDurationMs: 2000,
      timelineStartMs: 500,
      timelineShiftMs: 0,
    },
  ]);

  assert.match(filter, /setpts=/);
  assert.match(filter, /,fps=30,settb=AVTB\[slowDubVideo\]$/);
  assert.match(buildSlowVideoFilter("0:v", [], "out", "25"), /,fps=25,settb=AVTB\[out\]$/);
});

test("whole-video blur stays enabled past the legacy 999999ms sentinel", () => {
  assert.deepEqual(
    blurRegionWindowSeconds(
      { startMs: 0, endMs: 999999, wholeVideo: true },
      0,
      (timeMs) => timeMs,
    ),
    { start: 0, end: 86_400 },
  );
});
