import { describe, expect, it } from "vitest";

import { ApplicationAnswersRequestSchema } from "@capital-q/contracts";

import { applicationProjection, factsFromAnswers } from "../src/index.js";
import type { ApplicationFact } from "../src/index.js";

const APP = "00000000-0000-4000-8000-0000000000a1";
const TENANT = "00000000-0000-4000-8000-0000000000b1";

/** The facts as the store would hold them: current, recorded now. */
function stored(answers: unknown): ApplicationFact[] {
  return factsFromAnswers(ApplicationAnswersRequestSchema.parse(answers)).map(
    (fact, index) => ({
      ...fact,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      applicationId: APP,
      recordedAt: "2026-10-06T09:00:00.000Z",
      supersededAt: null,
    }) as ApplicationFact,
  );
}

describe("the GateQ form's answers (F1)", () => {
  it("records each answer as an applicant-provided fact the engine can read", () => {
    const facts = stored({
      companyName: "Kora Health",
      stage: "seed",
      country: "NG",
      sectors: ["Health", "Health"],
      raise: { amount: "1200000", currency: "USD" },
      instrument: "SAFE",
      lead: "LOOKING",
      note: "Hi Sahel team",
    });
    expect(facts.every((f) => f.provenance === "APPLICANT_PROVIDED")).toBe(true);
    const projection = applicationProjection({
      applicationId: APP as never,
      tenantId: TENANT,
      facts,
      classifications: [],
    });
    expect(projection.currentStageCode).toBe("seed");
    expect(projection.headquartersCountry).toBe("NG");
    expect(projection.raise).toEqual({ amount: "1200000", currency: "USD" });
    // Words, deduplicated; never a node id from the browser.
    expect(facts.find((f) => f.dimension === "company.sector_phrases")?.value).toEqual({
      kind: "PHRASES",
      phrases: ["Health"],
    });
    expect(projection.classifications).toEqual([]);
  });

  it("records \"I'd rather not say\" as asked-and-unknown, which the engine never reads as a no", () => {
    const facts = stored({ stage: "DECLINED", country: "DECLINED", raise: "DECLINED" });
    expect(facts.map((f) => f.provenance)).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"]);
    expect(facts.every((f) => f.value.kind === "NONE")).toBe(true);
    const projection = applicationProjection({
      applicationId: APP as never,
      tenantId: TENANT,
      facts,
      classifications: [],
    });
    expect(projection.currentStageCode).toBeNull();
    expect(projection.headquartersCountry).toBeNull();
    expect(projection.raise).toBeNull();
  });

  it("leaves a field it was not given untouched", () => {
    expect(stored({ instrument: "EQUITY" }).map((f) => f.dimension)).toEqual([
      "raise.instrument",
    ]);
    expect(stored({})).toEqual([]);
  });

  it("refuses what a form cannot honestly send", () => {
    for (const bad of [
      { raise: { amount: 1200000, currency: "USD" } },
      { raise: { amount: "1.2e6", currency: "USD" } },
      { raise: { amount: "-5", currency: "USD" } },
      { country: "Nigeria" },
      { stage: "SEED; drop" },
      { note: "x".repeat(601) },
      { access: "MAY_APPLY" },
      { tenantId: TENANT },
    ]) {
      expect(ApplicationAnswersRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});
