import { describe, expect, it } from "vitest";

import {
  createFounderReview,
  FOUNDER_STEPS,
  sessionFactsFrom,
  type FounderCandidate,
  type FounderExtractionOutcome,
} from "../src/index.js";
import { namesAccountHolder } from "../src/intelligence/account-holder.js";

/**
 * QA F-74 (24 Oct): the deck read-back told Chidi Eze "you're the CEO";
 * the deck names Ngozi Adeyemi as CEO. A role the deck gives someone is
 * offered as the account holder's only when it names them.
 */

const DECK = {
  documentId: "33333333-3333-4333-8333-333333333333",
  documentVersionId: "44444444-4444-4444-8444-444444444444",
  label: "your pitch deck, slide 9",
  page: 9,
};

const role = (
  quote: string | null,
  origins: FounderCandidate["origins"] = [DECK],
): FounderCandidate => ({
  key: "founder_role",
  value: "ceo",
  quote,
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  confidence: "MODERATE",
  explicit: true,
  origins,
});

const stage: FounderCandidate = {
  ...role("We are raising a seed round"),
  key: "stage",
  value: "seed",
};

async function suggestedSteps(
  candidates: readonly FounderCandidate[],
  accountName: string | null | undefined,
) {
  const result = {
    candidates,
    taxonomy: [],
    conflicts: [],
    ambiguities: [],
    missing: [],
    proposed: [],
    summary: "A synthetic reading.",
    blocked: null,
    telemetry: {},
  } as unknown as FounderExtractionOutcome;
  const plan = await createFounderReview({
    extraction: { extract: () => Promise.resolve(result) },
  }).prepare({
    tenantId: "11111111-1111-4111-8111-111111111111" as never,
    userId: "22222222-2222-4222-8222-222222222222" as never,
    sql: undefined as never,
    facts: sessionFactsFrom({
      responses: [],
      pendingSuggestionSteps: [],
      narrative: null,
    }),
    sources: [],
    correlationId: "cor_f74",
    accountName,
  });
  return {
    steps: plan.suggestions.map((s) => s.stepKey),
    forReview: plan.forReview.map((c) => c.key),
  };
}

describe("a role read from the deck (F-74)", () => {
  it("is not offered as theirs when the deck names someone else", async () => {
    const { steps, forReview } = await suggestedSteps(
      [role("Ngozi Adeyemi, CEO"), stage],
      "Chidi Eze",
    );
    expect(steps).not.toContain(FOUNDER_STEPS.founderRole);
    expect(forReview).not.toContain("founder_role");
    // Everything else the deck says still comes through.
    expect(steps).toContain(FOUNDER_STEPS.stage);
  });

  it("is offered when the deck names them", async () => {
    const { steps } = await suggestedSteps(
      [role("Ngozi Adeyemi (CEO) and Chidi Eze (CTO)")],
      "Ngozi Adeyemi",
    );
    expect(steps).toContain(FOUNDER_STEPS.founderRole);
  });

  it("assumes nothing when the account's name or the quote is unknown", async () => {
    expect(
      (await suggestedSteps([role("Ngozi Adeyemi, CEO")], null)).steps,
    ).not.toContain(FOUNDER_STEPS.founderRole);
    expect(
      (await suggestedSteps([role(null)], "Ngozi Adeyemi")).steps,
    ).not.toContain(FOUNDER_STEPS.founderRole);
  });

  it("what they said themselves (no document) is theirs", async () => {
    const { steps } = await suggestedSteps(
      [role("I'm the CEO", [])],
      "Chidi Eze",
    );
    expect(steps).toContain(FOUNDER_STEPS.founderRole);
  });
});

describe("namesAccountHolder", () => {
  it("matches first and last names as whole words, accents folded", () => {
    expect(namesAccountHolder("Ngozi Adéyemi — CEO", "Ngozi Adeyemi")).toBe(
      true,
    );
    expect(namesAccountHolder("Ngozi Okafor, CEO", "Ngozi Adeyemi")).toBe(
      false,
    );
    expect(namesAccountHolder("Chidinma Eze", "Chidi Eze")).toBe(false);
    expect(namesAccountHolder("Founder: Amara", "Amara")).toBe(true);
    expect(namesAccountHolder("anything", "  ")).toBe(false);
  });
});
