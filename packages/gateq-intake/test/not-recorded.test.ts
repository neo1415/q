import { describe, expect, it, vi } from "vitest";

import type { PublicGateway } from "@capital-q/gateq";
import type { GateQInterviewerResult } from "@capital-q/q-core";

import {
  createGateQInterviewer,
  type InterviewTurnInput,
} from "../src/application/interviewer.js";
import { readBackLine, readBacksIn } from "../src/application/not-recorded.js";

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

describe("a worked-out figure is read back for a yes, like a person would (owner 2026-10-21)", () => {
  it("asks 'So that's USD 360,000 for revenue, right?' instead of lecturing", async () => {
    const outcome = await run(ACKNOWLEDGED);
    expect(outcome.facts).toEqual([]);
    expect(outcome.notRecorded).toEqual([
      {
        dimension: "claims.revenue",
        reason: "AMOUNT_READ_BACK",
        amount: "360000",
        currency: "USD",
      },
    ]);
    // Said once, as the turn's one question.
    expect(outcome.reply).toBe("So that's USD 360,000 for revenue, right?");
    expect(outcome.asking).toBe("claims.revenue");
    expect(outcome.reply).not.toMatch(/I only keep|haven't recorded/);
  });

  it("their 'Yes' records it as their claim, even if the model proposes nothing", async () => {
    const outcome = await run(
      {
        reply: "Great. Who are your customers?",
        intent: "ANSWER",
        facts: [],
        asking: "company.customers",
        questionForQ: null,
        readyToReview: false,
      },
      {
        utterance: "Yes, that's right.",
        recentTurns: [
          { role: "person", text: said },
          { role: "q", text: "So that's USD 360,000 for revenue, right?" },
        ],
      },
    );
    expect(outcome.facts).toEqual([
      {
        dimension: "claims.revenue",
        value: { kind: "AMOUNT", amount: "360000", currency: "USD" },
        provenance: "APPLICANT_PROVIDED",
      },
    ]);
    expect(outcome.notRecorded).toBeUndefined();
  });

  it("a 'no' or a different figure records nothing it read back", async () => {
    const turns = [
      { role: "person" as const, text: said },
      {
        role: "q" as const,
        text: "So that's USD 360,000 for revenue, right?",
      },
    ];
    const quiet: GateQInterviewerResult = {
      reply: "Thanks. What is it, then?",
      intent: "CORRECTION",
      facts: [],
      asking: "claims.revenue",
      questionForQ: null,
      readyToReview: false,
    };
    for (const utterance of [
      "No, not quite.",
      "Yes, but it's 340k really.",
      "Hmm.",
    ]) {
      const outcome = await run(quiet, { utterance, recentTurns: turns });
      expect(outcome.facts).toEqual([]);
    }
  });

  it("in another language: Q asks in theirs, and their 'Oui' makes the figure theirs", async () => {
    const outcome = await run(
      {
        reply: "Merci. Qui sont vos clients ?",
        intent: "ANSWER",
        facts: [REVENUE_360K] as never,
        asking: "company.customers",
        questionForQ: null,
        readyToReview: false,
      },
      {
        locale: "fr",
        utterance: "Oui.",
        recentTurns: [
          { role: "person", text: said },
          {
            role: "q",
            text: "Donc 360 000 USD de revenus, c'est bien ça ?",
          },
        ],
      },
    );
    expect(outcome.facts.map((fact) => fact.value)).toEqual([
      { kind: "AMOUNT", amount: "360000", currency: "USD" },
    ]);
    expect(outcome.reply).toBe("Merci. Qui sont vos clients ?");
  });

  it("tells the model to check a worked-out figure, in any language", async () => {
    const execute = vi.fn((_request: unknown) =>
      Promise.resolve({ output: { kind: "STRUCTURED", value: ACKNOWLEDGED } }),
    );
    await createGateQInterviewer({ gateway: { execute } as never }).turn({
      stage: "APPLICATION",
      channel: "text",
      locale: "fr",
      publicGateway: PUBLIC_GATEWAY,
      utterance: said,
      recentTurns: [],
      tangents: 0,
      askedAlready: [],
      attribution: {
        tenantId: "c0000000-0000-4000-8000-00000000000a",
        correlationId: "f0000000-0000-4000-8000-000000000001",
      },
    });
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toContain(
      "do not propose it as their fact: end your reply by checking it",
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

  it("keeps the model's words in another language; the figure is still held", async () => {
    const outcome = await run(ACKNOWLEDGED, { locale: "fr" });
    expect(outcome.reply).toBe(ACKNOWLEDGED.reply);
    expect(outcome.facts).toEqual([]);
    expect(outcome.notRecorded).toHaveLength(1);
  });

  it("words several figures in one question, and reads its own line back", () => {
    const items = [
      {
        dimension: "raise.amount" as const,
        reason: "AMOUNT_READ_BACK" as const,
        amount: "2000000",
        currency: "USD",
      },
      {
        dimension: "claims.revenue" as const,
        reason: "AMOUNT_READ_BACK" as const,
        amount: "360000",
        currency: "USD",
      },
    ];
    const line = readBackLine(items);
    expect(line).toBe(
      "So that's USD 2,000,000 for raise size and USD 360,000 for revenue, right?",
    );
    expect(readBacksIn(`Thanks. ${line}`)).toEqual(items);
    expect(readBackLine([])).toBe("");
    expect(readBacksIn("Who are your customers?")).toEqual([]);
  });
});
