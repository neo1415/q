import { describe, expect, it } from "vitest";

import { QArtifactReferenceBlockSchema } from "@capital-q/contracts";

import { boardCountOf } from "../src/features/q/board-timeline";
import { replyParts } from "../src/features/q/q-answer";

/**
 * QA 2026-10-23. F-35: one brief came up three times (thread, "Shown
 * recently", stage). F-37: the Board count stayed 0 after a report.
 */
const ARTIFACT = QArtifactReferenceBlockSchema.parse({
  kind: "ARTIFACT_REFERENCE",
  artifactId: "a0000000-0000-4000-8000-000000000001",
  type: "BRIEF",
  status: "READY",
  title: "Kora brief",
});

describe("a document Q made is drawn once (F-35)", () => {
  it("is the stage's where the stage draws the answer's objects, and the thread's otherwise", () => {
    const blocks: Parameters<typeof replyParts>[0] = [ARTIFACT];
    expect(replyParts(blocks, false, false).inline).toEqual([]);
    expect(replyParts(blocks, false, true).inline).toHaveLength(1);
  });
});

describe("the Board count (F-37)", () => {
  const report = {
    id: "q1",
    files: [
      {
        artifactId: ARTIFACT.artifactId,
        title: ARTIFACT.title,
        detail: "Made by Q because you asked",
      },
    ],
  };
  const cards = { id: "q2", files: [] };

  it("counts a report Q made at once, even while it is on the stage", () => {
    expect(boardCountOf([report], [], "q1")).toBe(1);
  });

  it("holds back only the Board entry on the stage, never for a table or map", () => {
    expect(boardCountOf([report, cards], [], "q2")).toBe(1);
    // A table on the stage (answer q3) is not a Board entry.
    expect(boardCountOf([report, cards], [], "q3")).toBe(2);
    expect(boardCountOf([report, cards], ["q1"], null)).toBe(1);
  });
});
