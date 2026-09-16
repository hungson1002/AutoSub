import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { blurRegionWindowSeconds, boundedSourceVideoBitrate, buildSlowVideoFilter, embeddedFontFamily, replaceAssFontFamily, safeDrawtextPosition } from "./export";

test("export bitrate follows the source instead of unconstrained CRF output", () => {
  assert.equal(boundedSourceVideoBitrate(900_000, 1_050_000), 900_000);
  assert.equal(boundedSourceVideoBitrate(undefined, 1_060_000), 900_000);
  assert.equal(boundedSourceVideoBitrate(undefined, undefined), 2_500_000);
  assert.equal(boundedSourceVideoBitrate(100_000_000, 100_200_000), 40_000_000);
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
