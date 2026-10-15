// node --test scripts/seed/lane-v/tavus.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { estimateUsd, isQuotaRefusal, keyIndex, tag } from "./tavus.mjs";
import { closeWindow } from "../tavus20/plan.mjs";

test("quota and credit refusals move to the next key", () => {
  assert.equal(isQuotaRefusal({ status: 402, body: {} }), true);
  assert.equal(isQuotaRefusal({ status: 429, body: "slow down" }), true);
  assert.equal(
    isQuotaRefusal({ status: 400, body: { message: "Insufficient credits" } }),
    true,
  );
  assert.equal(
    isQuotaRefusal({ status: 403, body: { error: "Video limit reached" } }),
    true,
  );
});

test("job errors and successes stay on the same key", () => {
  assert.equal(
    isQuotaRefusal({ status: 400, body: { message: "Invalid replica_id" } }),
    false,
  );
  assert.equal(
    isQuotaRefusal({ status: 200, body: { video_id: "x", plan: "credit" } }),
    false,
  );
});

test("keys are named only by position", () => {
  assert.equal(tag(0), "key#1");
  assert.equal(keyIndex("key#6"), 5);
  assert.equal(estimateUsd(90), 1.5);
});

test("close window is relative to the day it runs", () => {
  const today = new Date("2026-10-15");
  assert.equal(closeWindow("2026-12-01", today), "Within 3 months");
  assert.equal(closeWindow("2027-03-01", today), "3–6 months");
});
