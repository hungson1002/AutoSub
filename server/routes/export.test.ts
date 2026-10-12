import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { blurRegionWindowSeconds, buildSlowVideoFilter, embeddedFontFamily, h264QualityArgs, replaceAssFontFamily, safeDrawtextPosition } from "./export";

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
