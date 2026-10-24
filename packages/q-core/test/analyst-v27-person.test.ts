import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V26,
  COMPANY_ANALYST_V27,
  V27_PERSON_LINE,
  V27_TRIMS,
  createDefaultPromptRegistry,
} from "../src/index.js";

/**
 * QA 2026-10-23 (QO-04 / F-45): answers called the person "the investor",
 * cited "the supplied company profile" and opened with the company's
 * stage and place whatever was asked.
 */
describe("COMPANY_ANALYST v27: Q speaks to the person", () => {
  it("is active, keeps v26 for its runs, and adds the person line plus listed trims", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(27);
    expect(registry.get("COMPANY_ANALYST", 26)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(COMPANY_ANALYST_V27.template).toContain(V27_PERSON_LINE);
    expect(COMPANY_ANALYST_V27.output).toBe(COMPANY_ANALYST_V26.output);
    // The person line is added; every other difference is a listed trim.
    const [, added] = V27_PERSON_LINE.split("\n");
    const untrimmed = [...V27_TRIMS]
      .reverse()
      .reduce(
        (text, [from, to]) => text.replace(to, from),
        COMPANY_ANALYST_V27.template.replace(`\n${added ?? ""}`, ""),
      );
    expect(untrimmed).toBe(COMPANY_ANALYST_V26.template);
    expect(COMPANY_ANALYST_V27.template).not.toMatch(/The supplied fact/u);
  });

  it("says second person, never naming the inputs, and an opening that answers", () => {
    expect(V27_PERSON_LINE).toMatch(/never "the investor" or "the founder"/u);
    expect(V27_PERSON_LINE).toMatch(/"the supplied profile"/u);
    expect(V27_PERSON_LINE).toMatch(/open with what answers the question/u);
  });
});
