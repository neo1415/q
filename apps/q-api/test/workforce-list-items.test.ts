import { describe, expect, it } from "vitest";

import { AnalysisDocumentResultV4Schema } from "@capital-q/q-core";

import { keptLines } from "../src/composition/workforce/models.js";

/**
 * Decision 97: the analysis draft's gaps were cut to 12 and, past the
 * schema's bound of 30 (or with one malformed gap), emptied whole. Every
 * usable gap is filed now, and a gap that could not be read is counted in
 * the filed list instead of vanishing.
 */
describe("the analysis draft's gaps", () => {
  it("keeps all 31 gaps and names the two that could not be read", () => {
    const gaps = Array.from({ length: 31 }, (_, i) => `Gap ${String(i + 1)}`);
    const draft = AnalysisDocumentResultV4Schema.parse({
      title: "Memo",
      summary: "Summary.",
      sections: [
        { heading: "A", body: "a" },
        { heading: "B", body: "b" },
        { heading: "C", body: "c" },
      ],
      topRecommendations: ["Do it."],
      gaps: [...gaps, 7, null],
    });
    const filed = keptLines(draft.gaps, "gap", "gaps");
    expect(filed).toHaveLength(32);
    expect(filed.slice(0, 31)).toEqual(gaps);
    expect(filed[31]).toBe("Q could not read 2 further gaps.");
  });
});
