import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V33,
  COMPANY_ANALYST_V34,
  CompanyAnalystV33ResultSchema,
  CompanyAnalystV34ResultSchema,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * Decision 97 (2026-11-14): v33's count bounds let the gateway keep a
 * list's first items and drop the rest without a trace. v34 is v33's
 * template word for word on a schema with no count ceiling.
 */
describe("COMPANY_ANALYST v34: no count ceiling on the evidence lists", () => {
  const statement = (n: number) => `Statement ${String(n)}`;
  const answer = (n: number) => ({
    answer: "An answer.",
    responseShape: "ANALYTICAL",
    insufficientEvidence: false,
    recommendation: null,
    missingEvidence: Array.from({ length: n }, (_, i) => statement(i)),
  });

  it("is active, on v33's template", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(34);
    expect(COMPANY_ANALYST_V34.template).toBe(COMPANY_ANALYST_V33.template);
    expect(COMPANY_ANALYST_V34.output).toMatchObject({
      kind: "STRUCTURED",
      schemaVersion: 34,
      schema: CompanyAnalystV34ResultSchema,
    });
  });

  it("keeps a 25th missing-evidence statement that v33 refused", () => {
    const v33 = CompanyAnalystV33ResultSchema.safeParse(answer(25));
    const v34 = CompanyAnalystV34ResultSchema.safeParse(answer(25));
    expect(v33.success).toBe(false);
    expect(v34.success).toBe(true);
    expect(v34.data?.missingEvidence).toHaveLength(25);
  });
});
