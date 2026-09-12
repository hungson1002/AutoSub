import { strict as assert } from "node:assert";
import test from "node:test";
import { defaultStyle, type SubtitleCue } from "../types";
import { copyCueProperties, editTimelineCue, layoutTimelineCues, pasteCueProperties, selectCuePropertyGroups, timelineTickSeconds } from "./subtitleTimeline";

test("timeline moves a cue without changing its duration", () => {
  assert.deepEqual(editTimelineCue(1_000, 2_500, "move", 430), {
    startMs: 1_430,
    endMs: 2_930,
  });
  assert.deepEqual(editTimelineCue(100, 600, "move", -900), {
    startMs: 0,
    endMs: 500,
  });
});

test("timeline resize keeps a usable cue window", () => {
  assert.deepEqual(editTimelineCue(1_000, 2_000, "resize-start", 2_000), {
    startMs: 1_900,
    endMs: 2_000,
  });
  assert.deepEqual(editTimelineCue(1_000, 2_000, "resize-end", -2_000), {
    startMs: 1_000,
    endMs: 1_100,
  });
});

test("timeline ruler stays bounded for long videos", () => {
  assert.equal(timelineTickSeconds(30_000, 100), 1);
  assert.equal(timelineTickSeconds(7_200_000, 40), 30);
});

test("timeline reuses a lane for non-overlapping cues", () => {
  const layout = layoutTimelineCues([
    { id: "a", startMs: 0, endMs: 1_000 },
    { id: "b", startMs: 1_000, endMs: 2_000 },
  ]);
  assert.equal(layout.laneCount, 1);
  assert.deepEqual(layout.items.map((item) => item.lane), [0, 0]);
});

test("timeline creates enough lanes for simultaneous cues", () => {
  const cues = Array.from({ length: 50 }, (_, index) => ({
    id: String(index),
    startMs: 1_000,
    endMs: 2_000,
  }));
  const layout = layoutTimelineCues(cues);
  assert.equal(layout.laneCount, 50);
  assert.equal(new Set(layout.items.map((item) => item.lane)).size, 50);
});

test("timeline preserves a manually selected track", () => {
  const layout = layoutTimelineCues([
    { id: "manual", startMs: 0, endMs: 1_000, timelineLane: 4 },
  ]);
  assert.equal(layout.items[0]?.lane, 4);
  assert.equal(layout.laneCount, 5);
});

test("a pinned cue does not push every automatic cue to higher tracks", () => {
  const layout = layoutTimelineCues([
    { id: "auto-a", startMs: 0, endMs: 1_000 },
    { id: "pinned", startMs: 0, endMs: 1_000, timelineLane: 7 },
    { id: "auto-b", startMs: 1_000, endMs: 2_000 },
  ]);
  assert.deepEqual(layout.items.map((item) => [item.cue.id, item.lane]), [
    ["auto-a", 0],
    ["pinned", 7],
    ["auto-b", 0],
  ]);
});

test("two pinned cues cannot overlap inside the same track", () => {
  const layout = layoutTimelineCues([
    { id: "first", startMs: 0, endMs: 2_000, timelineLane: 0 },
    { id: "second", startMs: 1_000, endMs: 3_000, timelineLane: 0 },
  ]);
  assert.deepEqual(layout.items.map((item) => item.lane), [0, 1]);
});

test("automatic cues can use empty tracks below a high pinned track", () => {
  const layout = layoutTimelineCues([
    { id: "pinned", startMs: 0, endMs: 1_000, timelineLane: 4 },
    { id: "auto", startMs: 0, endMs: 1_000 },
  ]);
  assert.deepEqual(layout.items.map((item) => [item.cue.id, item.lane]), [["auto", 0], ["pinned", 4]]);
});

test("timeline keeps captions, OCR, and authored text in stable semantic rows", () => {
  const layout = layoutTimelineCues([
    { id: "sub-a", startMs: 0, endMs: 1_000, sourceKind: "subtitle" as const },
    { id: "sub-b", startMs: 1_000, endMs: 2_000, sourceKind: "subtitle" as const },
    { id: "ocr", startMs: 0, endMs: 2_000, sourceKind: "onscreen-text" as const, textOrigin: "ocr" as const },
    { id: "title", startMs: 0, endMs: 2_000, sourceKind: "onscreen-text" as const, textOrigin: "manual" as const },
  ]);
  assert.deepEqual(layout.items.map((item) => [item.cue.id, item.lane]), [
    ["sub-a", 2],
    ["ocr", 1],
    ["title", 0],
    ["sub-b", 2],
  ]);
  assert.equal(layout.laneCount, 3);
});

test("overlapping captions create only the extra caption row they need", () => {
  const layout = layoutTimelineCues([
    { id: "sub-a", startMs: 0, endMs: 2_000, sourceKind: "subtitle" as const },
    { id: "sub-b", startMs: 1_000, endMs: 3_000, sourceKind: "subtitle" as const },
    { id: "ocr", startMs: 0, endMs: 3_000, sourceKind: "onscreen-text" as const, textOrigin: "ocr" as const },
  ]);
  assert.deepEqual(layout.items.map((item) => [item.cue.id, item.lane]), [
    ["sub-a", 2],
    ["ocr", 0],
    ["sub-b", 1],
  ]);
});

const textCue: SubtitleCue = {
  id: "text-1",
  index: 1,
  startMs: 0,
  endMs: 1_000,
  originalText: "Title",
  translatedText: "",
  voiceGroup: "G1",
  enabled: true,
  sourceKind: "onscreen-text",
  screenPosition: { xPercent: 18, yPercent: 22 },
  styleOverrides: { fontFamily: "Inter", fontSize: 52, textColor: "#ffee00", bold: true },
};

test("cue property clipboard copies only the selected group", () => {
  const clipboard = copyCueProperties(textCue, defaultStyle, "color");
  assert.deepEqual(clipboard.styleOverrides, { textColor: "#ffee00" });
  assert.equal(clipboard.screenPosition, undefined);
});

test("pasting cue properties preserves unrelated target styling", () => {
  const target = { ...textCue, id: "text-2", styleOverrides: { fontSize: 24, italic: true } };
  const patch = pasteCueProperties(target, copyCueProperties(textCue, defaultStyle, "color"));
  assert.deepEqual(patch.styleOverrides, { fontSize: 24, italic: true, textColor: "#ffee00" });
  assert.equal(patch.screenPosition, undefined);
});

test("position clipboard does not overwrite text appearance", () => {
  const target = { ...textCue, id: "text-3", styleOverrides: { fontSize: 24 } };
  const patch = pasteCueProperties(target, copyCueProperties(textCue, defaultStyle, "position"));
  assert.deepEqual(patch.screenPosition, { xPercent: 18, yPercent: 22 });
  assert.equal(patch.styleOverrides, undefined);
});

test("property clipboard combines multiple checked groups", () => {
  const clipboard = copyCueProperties(textCue, defaultStyle, ["position", "size", "color"]);
  assert.deepEqual(clipboard.groups, ["position", "size", "color"]);
  assert.deepEqual(clipboard.screenPosition, { xPercent: 18, yPercent: 22 });
  assert.deepEqual(clipboard.styleOverrides, { fontSize: 52, textColor: "#ffee00" });
});

test("paste-property selection can omit copied groups", () => {
  const copied = copyCueProperties(textCue, defaultStyle, ["position", "size", "color"]);
  const selected = selectCuePropertyGroups(copied, ["position", "color"]);
  assert.deepEqual(selected.groups, ["position", "color"]);
  assert.deepEqual(selected.screenPosition, { xPercent: 18, yPercent: 22 });
  assert.deepEqual(selected.styleOverrides, { textColor: "#ffee00" });
});
