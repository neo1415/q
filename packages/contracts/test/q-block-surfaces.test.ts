import { describe, expect, it } from "vitest";

import {
  Q_BLOCK_SURFACES,
  Q_DRAWN_BLOCK_KINDS,
  Q_RESULT_BLOCK_KINDS,
  Q_STAGE_OBJECT_KINDS,
  QResultBlockSchema,
} from "../src/q/index.js";

/** Every discriminator of the union itself, read from the schema. */
const UNION_KINDS = QResultBlockSchema.options
  .map((option): string => option.shape.kind.value)
  .sort();

describe("Q_BLOCK_SURFACES (N3: one rule for every view)", () => {
  it("lists every kind of the union, and only those", () => {
    expect([...Q_RESULT_BLOCK_KINDS].sort()).toEqual(UNION_KINDS);
    expect(Object.keys(Q_BLOCK_SURFACES).sort()).toEqual(UNION_KINDS);
  });

  it.each([...Q_RESULT_BLOCK_KINDS])(
    "%s: a thread draws it somewhere, and the Q view exactly once",
    (kind) => {
      const { thread, stage } = Q_BLOCK_SURFACES[kind];
      expect(["OBJECT", "CHIP", "APPROVAL", "PROSE"]).toContain(thread);
      // A stage that draws it takes it from the caption; one that leaves it
      // to the caption needs a thread place the caption draws.
      if (stage !== "CAPTION") expect(thread).toBe("OBJECT");
    },
  );

  it("an object that backs 'on your screen' is drawn as one in a thread", () => {
    for (const kind of Q_DRAWN_BLOCK_KINDS) {
      expect(Q_BLOCK_SURFACES[kind].thread, kind).toBe("OBJECT");
    }
    // An offer to open a page has opened nothing.
    expect(Q_DRAWN_BLOCK_KINDS.has("NAVIGATION_OFFER")).toBe(false);
    for (const kind of ["SCHEDULE", "PLAN", "SUMMARY", "TABLE"] as const) {
      expect(Q_DRAWN_BLOCK_KINDS.has(kind), kind).toBe(true);
    }
  });

  it("puts plans, schedules, attention and work in progress on the stage", () => {
    for (const kind of [
      "PLAN",
      "SCHEDULE",
      "ATTENTION",
      "WORK_IN_PROGRESS",
    ] as const) {
      expect(Q_STAGE_OBJECT_KINDS.has(kind), kind).toBe(true);
    }
    expect(Q_BLOCK_SURFACES.NAVIGATION_OFFER.stage).toBe("BESIDE");
  });
});
