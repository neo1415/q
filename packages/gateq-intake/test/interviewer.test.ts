import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ModelGatewayError } from "@capital-q/model-gateway";
import type {
  GatewayPolicy,
  PublicGateway,
  QualificationResult,
} from "@capital-q/gateq";
import type { GateQInterviewerResult } from "@capital-q/q-core";

import type { ApplicationFact } from "../src/contracts/index.js";
import {
  createGateQInterviewer,
  InterviewUnavailableError,
  type InterviewTurnInput,
} from "../src/application/interviewer.js";
import { questionNeedsFor } from "../src/application/question-needs.js";

/**
 * What the model may and may not do (CQ-GATE-002 §5, §23, §28, §38, §44).
 *
 * The model is scripted here, because these cases are about what happens
 * to its output rather than about its taste. The question each one asks is
 * the same: a fluent proposer said something — what did the platform
 * actually do with it?
 */

const TENANT = "c0000000-0000-4000-8000-00000000000a";
/** Fixed, so two renderings differ only where the test means them to. */
const CORRELATION = "f0000000-0000-4000-8000-000000000001";

const PUBLIC_GATEWAY: PublicGateway = {
  publicId: "gq_0123456789abcdefghjkmnpqrs",
  organisationDisplayName: "Acme Ventures",
  title: "Seed-stage African fintech",
  description: "We read every application.",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [
    { label: "Sector", requiredness: "REQUIRED", dimension: "TAXONOMY" },
    {
      label: "Where you are",
      requiredness: "REQUIRED",
      dimension: "GEOGRAPHY",
    },
  ],
  publishedAt: "2026-09-21T12:00:00.000Z",
};

const RESULT: GateQInterviewerResult = {
  reply: "Lagos, got it. What does the product actually do for them?",
  intent: "ANSWER",
  facts: [
    {
      dimension: "company.country",
      value: { kind: "CODE", code: "NG" },
      provenance: "APPLICANT_PROVIDED",
      correction: false,
    },
  ],
  asking: "company.solution",
  questionForQ: null,
  readyToReview: false,
};

function interviewer(
  result: GateQInterviewerResult | Error,
  captured?: { prompt?: string },
) {
  const execute = vi.fn((request: unknown) => {
    if (captured !== undefined) {
      captured.prompt = JSON.stringify(request);
    }
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({
      output: { kind: "STRUCTURED", value: result },
    });
  });
  return {
    execute,
    service: createGateQInterviewer({
      gateway: { execute } as never,
    }),
  };
}

const turn = (
  overrides: Partial<InterviewTurnInput> = {},
): InterviewTurnInput => ({
  stage: "APPLICATION",
  channel: "text",
  publicGateway: PUBLIC_GATEWAY,
  utterance: "We're in Lagos.",
  recentTurns: [],
  tangents: 0,
  askedAlready: [],
  attribution: { tenantId: TENANT, correlationId: CORRELATION },
  ...overrides,
});

describe("what survives validation", () => {
  it("44: a dimension nobody defined never becomes state", async () => {
    const { service } = interviewer({
      ...RESULT,
      facts: [
        ...RESULT.facts,
        {
          dimension: "company.secret_score",
          value: { kind: "TEXT", text: "10" },
          provenance: "APPLICANT_PROVIDED",
          correction: false,
        },
        {
          dimension: "qualification.outcome",
          value: { kind: "TEXT", text: "QUALIFIED" },
          provenance: "APPLICANT_PROVIDED",
          correction: false,
        },
      ],
    });
    const outcome = await service.turn(turn());
    expect(outcome.facts.map((f) => f.dimension)).toEqual(["company.country"]);
    expect(outcome.rejectedFacts).toBe(2);
  });

  it("44: a malformed payload never becomes state at all", async () => {
    const { service } = interviewer({
      ...RESULT,
      facts: [
        {
          dimension: "raise.amount",
          // Not a decimal, and not a currency.
          value: {
            kind: "AMOUNT",
            amount: "about a million",
            currency: "dollars",
          },
          provenance: "APPLICANT_PROVIDED",
          correction: false,
        } as never,
      ],
    });
    // The gateway enforces the schema before this code ever sees a
    // result, and this parse is the second layer. A payload that fails it
    // is not partially believed: the turn is refused and the application
    // is untouched, which is the right way round for a fail-closed path.
    await expect(service.turn(turn())).rejects.toBeInstanceOf(
      InterviewUnavailableError,
    );
  });

  it("23: there is no field through which a model could declare qualification", () => {
    // Structural. The result schema has no outcome, no score and no
    // boolean that means "qualified", so `{ qualified: true }` is not a
    // thing the model can say — never mind a thing that could be believed.
    const keys = Object.keys(RESULT);
    expect(keys.sort()).toEqual(
      [
        "asking",
        "facts",
        "intent",
        "questionForQ",
        "readyToReview",
        "reply",
      ].sort(),
    );
    for (const forbidden of ["qualified", "outcome", "score", "access"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("7: a joke records nothing, whatever the model read into it", async () => {
    // By intent rather than by asking the model to be careful: a turn that
    // was not about the application cannot contribute an answer.
    for (const intent of ["SMALL_TALK", "OFF_TOPIC", "SABOTAGE"] as const) {
      const { service } = interviewer({ ...RESULT, intent });
      const outcome = await service.turn(
        turn({ utterance: "haha this is stressful" }),
      );
      expect(outcome.facts).toEqual([]);
      expect(outcome.intent).toBe(intent);
      // Q still said something.
      expect(outcome.reply.length).toBeGreaterThan(0);
    }
  });

  it("a question for Q is answered, not recorded", async () => {
    const { service } = interviewer({
      ...RESULT,
      intent: "QUESTION_FOR_Q",
      questionForQ: "What stages do you accept?",
    });
    const outcome = await service.turn(
      turn({ utterance: "What stages do you accept?" }),
    );
    expect(outcome.facts).toEqual([]);
    expect(outcome.questionForQ).toBe("What stages do you accept?");
  });
});

describe("what the model is given", () => {
  it("28: never a private threshold, and never the private policy", async () => {
    const captured: { prompt?: string } = {};
    const { service } = interviewer(RESULT, captured);
    const policy = {
      gateway: { id: randomUUID() },
      version: { id: randomUUID() },
      criteria: [
        {
          id: randomUUID(),
          config: {
            type: "GEOGRAPHY",
            // The organisation's actual commercial position.
            allowedCountries: ["NG", "KE"],
          },
        },
      ],
    } as unknown as GatewayPolicy;
    const criterionId = (policy.criteria[0] as { id: string }).id;
    const qualification = {
      criteria: [],
      // The country is required and nobody has answered it, so the need
      // reaches the model — which is exactly the case where the threshold
      // must not.
      unknowns: [criterionId],
      principalMismatches: [],
    } as unknown as QualificationResult;

    await service.turn(
      turn({
        application: {
          policy,
          qualification,
          facts: [],
          documentProposals: [],
        },
      }),
    );

    const prompt = captured.prompt ?? "";
    // The need reaches the model; the rule does not.
    expect(prompt).toContain("company.country");
    expect(prompt).not.toContain("allowedCountries");
    expect(prompt).not.toContain('"NG","KE"');
    expect(prompt).not.toContain("allowedNodeIds");
  });

  it("28: a private criterion still gets asked about, by name of the need", () => {
    const criterionId = randomUUID();
    const needs = questionNeedsFor({
      policy: {
        criteria: [
          {
            id: criterionId,
            config: { type: "STAGE", allowedStageCodes: ["seed"] },
          },
        ],
      } as unknown as GatewayPolicy,
      qualification: {
        unknowns: [criterionId],
        criteria: [],
      } as unknown as QualificationResult,
      facts: [],
    });
    expect(needs[0]).toEqual({
      dimension: "company.stage",
      reason: "REQUIRED_BY_GATEWAY",
    });
    // The allowed codes are nowhere in what the model will be told.
    expect(JSON.stringify(needs)).not.toContain("seed");
  });

  it("22: what is already answered is not asked about again", () => {
    const answered: ApplicationFact[] = [
      {
        id: randomUUID() as ApplicationFact["id"],
        applicationId: randomUUID() as ApplicationFact["applicationId"],
        dimension: "company.name",
        value: { kind: "TEXT", text: "KoboLogistics" },
        provenance: "APPLICANT_PROVIDED",
        recordedAt: "2026-09-21T12:00:00.000Z",
        supersededAt: null,
      },
    ];
    const needs = questionNeedsFor({
      policy: { criteria: [] } as unknown as GatewayPolicy,
      qualification: {
        unknowns: [],
        criteria: [],
      } as unknown as QualificationResult,
      facts: answered,
    });
    expect(needs.map((n) => n.dimension)).not.toContain("company.name");
    // And what a partner would read first comes first.
    expect(needs[0]?.dimension).toBe("company.description");
  });

  it("22: a required criterion outranks everything a partner merely wants", () => {
    const criterionId = randomUUID();
    const needs = questionNeedsFor({
      policy: {
        criteria: [
          {
            id: criterionId,
            config: {
              type: "TAXONOMY",
              vocabularyCode: "industry",
              allowedNodeIds: [randomUUID()],
            },
          },
        ],
      } as unknown as GatewayPolicy,
      qualification: {
        unknowns: [criterionId],
        criteria: [],
      } as unknown as QualificationResult,
      facts: [],
    });
    expect(needs[0]).toEqual({
      dimension: "company.sector_phrases",
      reason: "REQUIRED_BY_GATEWAY",
    });
  });
});

describe("when the model is unavailable", () => {
  it("38: the turn fails plainly and the application is untouched", async () => {
    const { service } = interviewer(
      new ModelGatewayError("provider unavailable", {
        failureClass: "PROVIDER_OUTAGE",
        attempts: 3,
        candidates: [],
        routingPolicyCode: undefined,
      }),
    );
    const failure = await service.turn(turn()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InterviewUnavailableError);
    // Retryable, and carrying nothing about the provider.
    expect((failure as InterviewUnavailableError).retryable).toBe(true);
    const text = JSON.stringify({
      message: (failure as Error).message,
      name: (failure as Error).name,
    });
    for (const forbidden of [
      "gemini",
      "groq",
      "provider",
      "PROVIDER_UNAVAILABLE",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("38: a cancelled turn is not something to retry", async () => {
    const { service } = interviewer(
      new ModelGatewayError("cancelled", {
        failureClass: "CANCELLED",
        attempts: 1,
        candidates: [],
        routingPolicyCode: undefined,
      }),
    );
    const failure = await service.turn(turn()).catch((error: unknown) => error);
    expect((failure as InterviewUnavailableError).retryable).toBe(false);
  });

  it("38: an answer that is not structured is never guessed at", async () => {
    const execute = vi.fn(() =>
      Promise.resolve({ output: { kind: "TEXT", value: "sure, you qualify" } }),
    );
    const service = createGateQInterviewer({
      gateway: { execute } as never,
    });
    await expect(service.turn(turn())).rejects.toBeInstanceOf(
      InterviewUnavailableError,
    );
  });
});

describe("one brain, either modality", () => {
  it("39: a typed turn and a spoken one differ only in the channel", async () => {
    const typed: { prompt?: string } = {};
    const spoken: { prompt?: string } = {};
    const a = interviewer(RESULT, typed);
    const b = interviewer(RESULT, spoken);
    await a.service.turn(turn({ channel: "text" }));
    await b.service.turn(turn({ channel: "voice" }));

    // Same prompt family, same variables, same validation. The only
    // difference is the two places the template says which medium this is.
    const normalise = (prompt: string) =>
      prompt
        .replace(/over voice/g, "over MEDIUM")
        .replace(/over text/g, "over MEDIUM")
        .replace(/Over voice/g, "Over MEDIUM")
        .replace(/Over text/g, "Over MEDIUM");
    expect(normalise(typed.prompt ?? "x")).toBe(
      normalise(spoken.prompt ?? "y"),
    );
    expect(typed.prompt).not.toBe(spoken.prompt);
  });
});
