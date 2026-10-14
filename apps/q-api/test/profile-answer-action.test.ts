import { describe, expect, it } from "vitest";

import { resolveProfileAnswer } from "../src/composition/profile-answer-action.js";

/**
 * ADR 0024: Q's words for a profile fact become the step's own exact
 * answer, or a reason that names what would fit. Nothing is guessed.
 */
describe("resolveProfileAnswer", () => {
  it("resolves stage names to the step's options", () => {
    const answer = resolveProfileAnswer("stages", ["Seed", "Series A"]);
    expect(answer).toMatchObject({
      journey: "investor",
      stepKey: "I2.stages",
      value: { type: "MULTI_SELECT", optionKeys: ["seed", "series_a"] },
    });
  });

  it("resolves sector names to the taxonomy's own nodes, in one sentence or a list", () => {
    const answer = resolveProfileAnswer(
      "sectors",
      "Fintech and Enterprise Software",
    );
    expect("value" in answer && answer.value).toMatchObject({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
    });
    if (!("value" in answer) || answer.value.type !== "RESOURCE_REFERENCE") {
      throw new Error("expected categories");
    }
    expect(answer.value.resourceIds).toContain(
      "eacf7107-9af3-5b76-91a2-3c169e396347",
    );
    expect(answer.value.resourceIds).toHaveLength(2);
    expect(answer.preview).toMatch(/Fintech/);
  });

  it("names the valid choices when a word does not fit, and refuses an unknown category", () => {
    const stage = resolveProfileAnswer("discovery_mode", "whenever");
    expect("reason" in stage ? stage.reason : "").toMatch(/Choose from/);
    const sector = resolveProfileAnswer("sectors", ["Space pirates"]);
    expect("reason" in sector ? sector.reason : "").toMatch(/Space pirates/);
  });

  it("lists a short vocabulary's own names when a business model does not fit (live 2026-10-14)", () => {
    const refused = resolveProfileAnswer("business_models", [
      "B2B SaaS and subscription software",
    ]);
    expect(refused).toHaveProperty("reason");
    if (!("reason" in refused)) return;
    expect(refused.reason).toContain("Choose from:");
    expect(refused.reason).toContain("Transaction Fee");
    expect(refused.reason).toContain("Marketplace");
  });

  it("resolves the fictional fund's business models and customer types by their taxonomy names", () => {
    const models = resolveProfileAnswer("business_models", [
      "B2B SaaS",
      "Transaction Fee",
      "Usage-Based Pricing",
      "Marketplace",
    ]);
    expect(models).not.toHaveProperty("reason");
    const customers = resolveProfileAnswer(
      "customer_types",
      "Small & Medium Business, Mid-Market, Enterprise and Financial Institution",
    );
    expect(customers).not.toHaveProperty("reason");
    if ("reason" in customers) return;
    expect(customers.value.type).toBe("RESOURCE_REFERENCE");
    expect(
      customers.value.type === "RESOURCE_REFERENCE"
        ? customers.value.resourceIds.length
        : 0,
    ).toBe(4);
  });

  it("maps a founder's company facts to the founder journey", () => {
    const answer = resolveProfileAnswer("team_size", "12");
    expect(answer).toMatchObject({
      journey: "founder",
      stepKey: "F4.team_size",
      value: { type: "RANGE", value: "12" },
    });
  });
});
