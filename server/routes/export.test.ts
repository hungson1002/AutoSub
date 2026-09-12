import assert from "node:assert/strict";
import test from "node:test";
import { replaceAssFontFamily } from "./export";

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
