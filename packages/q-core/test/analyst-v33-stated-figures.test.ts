import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V32,
  COMPANY_ANALYST_V33,
  CompanyAnalystV33ResultSchema,
  createDefaultPromptRegistry,
  V33_CHANGES,
} from "../src/index.js";

/**
 * COMPANY_ANALYST v33 (A8, live 14 Nov 2026 on 4d5ab3ac2): the corrected
 * figure was put only in userStatements and dropped there; no card. The
 * figure is now also returned as structure (statedFigures), from which
 * Capital Q prepares the figure action's own approval card.
 */
describe("COMPANY_ANALYST v33: a stated figure is also returned as structure", () => {
  it("is active on schema v33, keeps v32 published, and differs only by its listed changes", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(33);
    expect(registry.get("COMPANY_ANALYST", 32)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V33.output).toMatchObject({
      kind: "STRUCTURED",
      schemaVersion: 33,
    });
    const undone = [...V33_CHANGES]
      .reverse()
      .reduce(
        (text, [from, to]) => text.replace(to, from),
        COMPANY_ANALYST_V33.template,
      );
    expect(undone).toBe(COMPANY_ANALYST_V32.template);
    expect(COMPANY_ANALYST_V33.template).toContain("statedFigures");
    // No keyword routing: no metric word is added to the template.
    expect(COMPANY_ANALYST_V33.template.split("MRR").length).toBe(
      COMPANY_ANALYST_V32.template.split("MRR").length,
    );
  });

  it("accepts a month period and a missing currency, and defaults to none", () => {
    const figures = CompanyAnalystV33ResultSchema.shape.statedFigures;
    expect(figures.parse(undefined)).toEqual([]);
    const read = figures.parse([
      {
        metric: "MRR",
        amount: 110000,
        currency: "USD",
        period: "2026-10",
        quote: "Actually October MRR was $110k.",
      },
      {
        metric: "CUSTOMERS",
        amount: 42,
        currency: null,
        period: null,
        quote: "42 paying customers",
      },
    ]);
    expect(read).toHaveLength(2);
    expect(
      figures.safeParse([
        {
          metric: "MRR",
          amount: 110000,
          currency: "$",
          period: "October",
          quote: "Actually October MRR was $110k.",
        },
      ]).success,
    ).toBe(false);
  });
});
