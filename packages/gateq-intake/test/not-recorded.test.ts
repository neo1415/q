import { describe, expect, it, vi } from "vitest";

import type { PublicGateway } from "@capital-q/gateq";
import type { GateQInterviewerResult } from "@capital-q/q-core";

import {
  createGateQInterviewer,
  type InterviewTurnInput,
} from "../src/application/interviewer.js";
import { notRecordedLine } from "../src/application/not-recorded.js";

/**
 * Onboarding speed 2026-10-20 (G4): a fact Q read from the applicant's
 * words and Capital Q then refused used to vanish. Q's reply is written
 * before validation, so it could even acknowledge it. Now the reply says
 * plainly what was not recorded and why, or asks again.
 */

const PUBLIC_GATEWAY: PublicGateway = {
  publicId: "gq_0123456789abcdefghjkmnpqrs",
  organisationDisplayName: "Acme Ventures",
  title: "Seed-stage African fintech",
  description: "We read every application.",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [],
  publishedAt: "2026-09-21T12:00:00.000Z",
};

const said =
  "We have 4 design partners. Two of them pay us on annual contracts of $180,000 each.";

function run(
  result: GateQInterviewerResult,
  overrides: Partial<InterviewTurnInput> = {},
) {
  const execute = vi.fn(() =>
    Promise.resolve({ output: { kind: "STRUCTURED", value: result } }),
  );
  return createGateQInterviewer({ gateway: { execute } as never }).turn({
    stage: "APPLICATION",
    channel: "text",
    publicGateway: PUBLIC_GATEWAY,
    utterance: said,
    recentTurns: [],
    tangents: 0,
    askedAlready: [],
    attribution: {
      tenantId: "c0000000-0000-4000-8000-00000000000a",
      correlationId: "f0000000-0000-4000-8000-000000000001",
    },
    ...overrides,
  });
}

const REVENUE_360K = {
  dimension: "claims.revenue",
  value: { kind: "AMOUNT", amount: "360000", currency: "USD" },
  provenance: "APPLICANT_PROVIDED",
  correction: false,
} as const;

const ACKNOWLEDGED: GateQInterviewerResult = {
  reply: "So that's $360,000 in revenue. Who are your customers?",
  intent: "ANSWER",
  facts: [REVENUE_360K] as never,
  asking: "company.customers",
  questionForQ: null,
  readyToReview: false,
};

describe("a refused fact is never dropped silently", () => {
  it("says the worked-out figure was not recorded, and asks for theirs", async () => {
    const outcome = await run(ACKNOWLEDGED);
    expect(outcome.facts).toEqual([]);
    expect(outcome.notRecorded).toEqual([
      { dimension: "claims.revenue", reason: "AMOUNT_NOT_STATED" },
    ]);
    expect(outcome.reply).toContain(ACKNOWLEDGED.reply);
    expect(outcome.reply).toMatch(
      /I haven't recorded a figure for revenue: I only keep amounts you say yourself, not ones I work out\. What is the figure\?/,
    );
  });

  it("adds nothing when everything read was kept", async () => {
    const outcome = await run({
      ...ACKNOWLEDGED,
      reply: "Got it. Who are your customers?",
      facts: [
        { ...REVENUE_360K, value: { ...REVENUE_360K.value, amount: "180000" } },
      ] as never,
    });
    expect(outcome.facts).toHaveLength(1);
    expect(outcome.reply).toBe("Got it. Who are your customers?");
    expect(outcome.notRecorded).toBeUndefined();
  });

  it("keeps the model's words in another language; the refusal is still returned", async () => {
    const outcome = await run(ACKNOWLEDGED, { locale: "fr" });
    expect(outcome.reply).toBe(ACKNOWLEDGED.reply);
    expect(outcome.notRecorded).toHaveLength(1);
  });

  it("words each reason plainly", () => {
    expect(
      notRecordedLine([
        { dimension: "raise.amount", reason: "AMOUNT_NOT_STATED" },
        { dimension: "company.stage", reason: "UNREADABLE" },
        { dimension: "contact.name", reason: "CONTACT_CONFIRMED" },
      ]),
    ).toBe(
      "I haven't recorded a figure for raise size: I only keep amounts you say yourself, not ones I work out. What is the figure? I couldn't record what you said about stage. Could you put it another way? Your contact name stays as you confirmed on the contact step.",
    );
    expect(notRecordedLine([])).toBe("");
  });
});
