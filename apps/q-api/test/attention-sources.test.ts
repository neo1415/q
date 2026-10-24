import { describe, expect, it } from "vitest";

import { jobAttentionItems } from "../src/composition/attention-sources.js";

/**
 * QA 2026-10-24 (I1): "What needs my attention today?" said "An agent's
 * job stopped: …", the same job three times. The person sees Q's work,
 * never an agent, and one line per piece of work.
 */

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 24, 12, minutes));

describe("stopped and held work, as attention items", () => {
  it("says Q's work, never an agent, and lists the same work once with how often", () => {
    const items = jobAttentionItems([
      {
        id: "j1",
        goal: "Follow up with Nixo",
        status: "FAILED",
        updated_at: at(30),
      },
      {
        id: "j2",
        goal: "Follow up with Nixo",
        status: "FAILED",
        updated_at: at(20),
      },
      {
        id: "j3",
        goal: "Follow up with Nixo",
        status: "FAILED",
        updated_at: at(10),
      },
      {
        id: "j4",
        goal: "Book a call with Tarmacly",
        status: "HELD",
        updated_at: at(5),
      },
    ]);
    expect(items.map((item) => item.title)).toEqual([
      "Q's work on “Follow up with Nixo” stopped (3 times)",
      "Q's work on “Book a call with Tarmacly” is waiting on you",
    ]);
    // The newest of the repeats is the one kept, and acted on.
    expect(items[0]?.entity).toEqual({ kind: "JOB", id: "j1" });
    // The words they read; the source code AGENT_BLOCKED is internal.
    for (const item of items) expect(item.title).not.toMatch(/agent/iu);
  });
});
