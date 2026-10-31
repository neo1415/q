import { describe, expect, it } from "vitest";

import { salvageCutOff } from "../src/policy/cut-off-salvage.js";

/**
 * Production 2026-10-31 (job f468bff8): a research plan ran to its 4,000
 * token ceiling, then to 8,000 on the retry, both cut off; every plan that
 * finished took at most 889. The questions it finished before running
 * away are whole; the one it was writing is not.
 */
const q = (n: number) =>
  `{"lane":"MARKET","query":"query number ${String(n)}","alsoQuery":null,"recent":false,"primary":false}`;

describe("a cut-off answer's finished list elements", () => {
  it("keeps the elements that closed and leaves out the one being written", () => {
    const text = `{"questions":[${q(1)},${q(2)},{"lane":"COMPET`;
    const salvage = salvageCutOff(text, { keepItems: 12 });
    expect(salvage?.items).toBe(2);
    expect(JSON.parse(salvage?.text ?? "")).toEqual({
      questions: [JSON.parse(q(1)), JSON.parse(q(2))],
    });
  });

  it("keeps at most keepItems of a list that ran away", () => {
    const many = Array.from({ length: 40 }, (_, n) => q(n + 1)).join(",");
    const salvage = salvageCutOff(`{"questions":[${many},{"la`, {
      keepItems: 12,
    });
    const parsed = JSON.parse(salvage?.text ?? "") as {
      questions: unknown[];
    };
    expect(parsed.questions).toHaveLength(12);
    expect(salvage?.items).toBe(12);
  });

  it("keeps a closed list and the root fields after it when a later string ran away", () => {
    const text = `{"questions":[${q(1)}],"recentOnly":true,"internalQuery":"fintech fintech fintech fint`;
    expect(
      JSON.parse(salvageCutOff(text, { keepItems: 12 })?.text ?? ""),
    ).toEqual({ questions: [JSON.parse(q(1))], recentOnly: true });
  });

  it("tolerates a code fence and escaped quotes inside strings", () => {
    const text =
      '```json\n{"questions":[{"lane":"A","query":"the \\"Clearwater\\" name, [UK]","alsoQuery":null,"recent":true,"primary":false},{"lane":"B","query":"x';
    const salvage = salvageCutOff(text, { keepItems: 12 });
    expect(JSON.parse(salvage?.text ?? "")).toEqual({
      questions: [
        {
          lane: "A",
          query: 'the "Clearwater" name, [UK]',
          alsoQuery: null,
          recent: true,
          primary: false,
        },
      ],
    });
  });

  it("finds nothing when no element finished, or the object closed whole", () => {
    expect(
      salvageCutOff('{"questions":[{"lane":"A","que', { keepItems: 12 }),
    ).toBeNull();
    expect(salvageCutOff("\n\n\n\n", { keepItems: 12 })).toBeNull();
    expect(
      salvageCutOff(`{"questions":[${q(1)}]}`, { keepItems: 12 }),
    ).toBeNull();
  });
});
