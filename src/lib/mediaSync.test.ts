import { strict as assert } from "node:assert";
import test from "node:test";
import { DUB_SYNC_TOLERANCE_SECONDS, dubAudioNeedsResync } from "./mediaSync";

test("dub preview corrects visible drift while ignoring harmless clock jitter", () => {
  assert.equal(DUB_SYNC_TOLERANCE_SECONDS, 0.06);
  assert.equal(dubAudioNeedsResync(10, 10.04), false);
  assert.equal(dubAudioNeedsResync(10, 10.08), true);
  assert.equal(dubAudioNeedsResync(10, Number.NaN), true);
});
