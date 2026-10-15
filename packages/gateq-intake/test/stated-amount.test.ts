import { describe, expect, it } from "vitest";

import { GateqDossierV1Schema } from "@capital-q/contracts";

import { withDerivedAmountsMarked } from "../src/application/dossier.js";
import {
  amountOfSummary,
  amountStatedIn,
  amountsIn,
} from "../src/application/stated-amount.js";

describe("an amount is stated only when it is written in the person's words", () => {
  it("reads digits, thousands separators, decimals and scales", () => {
    expect(amountsIn("$180,000 each, 31 million requests, $1.5M, 80k")).toEqual(
      [180_000, 31_000_000, 1_500_000, 80_000],
    );
  });

  it("a product of what was said is not what was said", () => {
    const said = "Two of them pay us $180,000 each.";
    expect(amountStatedIn("180000", said)).toBe(true);
    expect(amountStatedIn("360000", said)).toBe(false);
    expect(amountStatedIn("not a number", said)).toBe(false);
  });

  it("reads the dossier's amount summary back", () => {
    expect(amountOfSummary("360000 USD")).toEqual({
      amount: "360000",
      currency: "USD",
    });
    expect(amountOfSummary("4 design partners")).toBeNull();
  });
});

describe("a frozen dossier shows a derived amount as Q's inference", () => {
  const fact = (summary: string, sourceTurnSeq: number | null) => ({
    dimension: "claims.revenue",
    label: "Revenue",
    summary,
    provenance: "APPLICANT_PROVIDED" as const,
    sourceFactId: "6b1f0e5e-0000-4000-8000-000000000001",
    sourceTurnSeq,
    truthClass: "USER_CLAIM" as const,
    evidenceStatus: "SELF_REPORTED" as const,
  });
  const dossier = (f: ReturnType<typeof fact>) => ({
    dimensions: [
      { group: "TRACTION" as never, label: "Traction and revenue", facts: [f] },
    ],
  });
  const turns = [
    { seq: 5, role: "Q", text: "What do customers pay?" },
    {
      seq: 6,
      role: "PERSON",
      text: "Two of them pay us on annual contracts of $180,000 each.",
    },
  ];

  it("marks it Q_INFERENCE with the founder's own words as its derivation", () => {
    const marked = withDerivedAmountsMarked(
      dossier(fact("360000 USD", 6)),
      turns,
    );
    const out = marked.dimensions[0]?.facts[0];
    expect(out?.truthClass).toBe("Q_INFERENCE");
    expect(out?.derivation).toContain("$180,000 each");
    expect(out?.derivation).toContain("turn 6");
  });

  it("leaves a stated amount, a form answer and an unkept turn as recorded", () => {
    for (const f of [
      fact("180000 USD", 6),
      fact("360000 USD", null),
      fact("360000 USD", 99),
      fact("4 design partners", 6),
    ]) {
      const out = withDerivedAmountsMarked(dossier(f), turns).dimensions[0]
        ?.facts[0];
      expect(out?.truthClass).toBe("USER_CLAIM");
      expect(out?.derivation).toBeUndefined();
    }
  });

  it("the marked fact is still a valid dossier fact", () => {
    const shape =
      GateqDossierV1Schema.shape.dimensions.element.shape.facts.element;
    const out = withDerivedAmountsMarked(dossier(fact("360000 USD", 6)), turns)
      .dimensions[0]?.facts[0];
    expect(shape.safeParse(out).success).toBe(true);
  });
});
