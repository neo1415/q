import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ModelGatewayError } from "@capital-q/model-gateway";
import type {
  GatewayPolicy,
  PublicGateway,
  QualificationResult,
} from "@capital-q/gateq";
import {
  createPromptRegistry,
  PROMPT_DEFINITIONS,
  type PromptRegistry,
  type GateQInterviewerResult,
} from "@capital-q/q-core";

import {
  APPLICATION_DIMENSIONS,
  type ApplicationFact,
} from "../src/contracts/index.js";
import {
  createGateQInterviewer,
  interviewLanguageOf,
  InterviewUnavailableError,
  InterviewTurnOutcomeSchema,
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
  registry?: PromptRegistry,
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
      registry,
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
  // Owner principle 2026-10-21: every stated answer is saved. These shapes
  // used to be refused with "I couldn't record what you said about ...";
  // each is now put into its dimension's canonical shape and recorded.
  it.each([
    [
      "company.stage",
      { kind: "TEXT", text: "seed" },
      { kind: "CODE", code: "seed" },
    ],
    [
      "company.stage",
      { kind: "TEXT", text: "Series A" },
      { kind: "CODE", code: "series_a" },
    ],
    [
      "company.stage",
      { kind: "CODE", code: "Pre-Seed" },
      { kind: "CODE", code: "pre_seed" },
    ],
    [
      "company.country",
      { kind: "CODE", code: "Kenya" },
      { kind: "CODE", code: "KE" },
    ],
    [
      "company.country",
      { kind: "TEXT", text: "Nairobi, Kenya" },
      { kind: "CODE", code: "KE" },
    ],
    [
      "company.country",
      { kind: "CODE", code: "ke" },
      { kind: "CODE", code: "KE" },
    ],
    [
      "company.country",
      { kind: "TEXT", text: "Lagos" },
      { kind: "CODE", code: "NG" },
    ],
    [
      "company.country",
      { kind: "TEXT", text: "We're based out of Cape Town" },
      { kind: "CODE", code: "ZA" },
    ],
    [
      "company.country",
      { kind: "TEXT", text: "London and Lagos" },
      { kind: "CODE", code: "GB" },
    ],
    [
      "company.sector_phrases",
      { kind: "TEXT", text: "Climate" },
      { kind: "PHRASES", phrases: ["Climate"] },
    ],
    [
      "company.sector_phrases",
      { kind: "TEXT", text: "climate, logistics and fintech" },
      { kind: "PHRASES", phrases: ["climate", "logistics", "fintech"] },
    ],
    [
      "raise.amount",
      { kind: "TEXT", text: "1500000 USD" },
      { kind: "AMOUNT", amount: "1500000", currency: "USD" },
    ],
    [
      "raise.amount",
      { kind: "TEXT", text: "$1.5M" },
      { kind: "AMOUNT", amount: "1500000", currency: "USD" },
    ],
    [
      "raise.currency",
      { kind: "TEXT", text: "USD" },
      { kind: "CODE", code: "USD" },
    ],
    [
      "raise.currency",
      { kind: "TEXT", text: "US dollars" },
      { kind: "CODE", code: "USD" },
    ],
    [
      "contact.email",
      { kind: "TEXT", text: "Mailto:Ama@Kijani.Africa" },
      { kind: "TEXT", text: "ama@kijani.africa" },
    ],
    [
      "company.website",
      { kind: "TEXT", text: "kijani.africa" },
      { kind: "TEXT", text: "https://kijani.africa" },
    ],
  ] as const)(
    "saves %s %j in its canonical shape",
    async (dimension, value, expected) => {
      const { service } = interviewer({
        ...RESULT,
        facts: [
          {
            dimension,
            value,
            provenance: "APPLICANT_PROVIDED",
            correction: false,
          },
        ],
      });
      const outcome = await service.turn(
        turn({
          utterance:
            "Kijani is a seed climate company in Nairobi, Kenya, raising $1.5M in US dollars.",
        }),
      );
      expect(outcome.facts).toEqual([
        { dimension, value: expected, provenance: "APPLICANT_PROVIDED" },
      ]);
      expect(outcome.rejectedFacts).toBe(0);
      expect(outcome.reply).toBe(RESULT.reply);
      expect(outcome.notRecorded).toBeUndefined();
    },
  );

  it("saves an amount said in words", async () => {
    const { service } = interviewer({
      ...RESULT,
      facts: [
        {
          dimension: "raise.amount",
          value: { kind: "AMOUNT", amount: "2500000", currency: "USD" },
          provenance: "APPLICANT_PROVIDED",
          correction: false,
        },
      ],
    });
    const outcome = await service.turn(
      turn({
        utterance:
          "We're raising two and a half... no, two million five hundred thousand dollars.",
      }),
    );
    expect(outcome.facts.map((f) => f.value)).toEqual([
      { kind: "AMOUNT", amount: "2500000", currency: "USD" },
    ]);
    expect(outcome.notRecorded).toBeUndefined();
  });

  it("never records an amount they never said; it is read back for their yes", async () => {
    const { service } = interviewer({
      ...RESULT,
      facts: [
        {
          dimension: "raise.amount",
          value: { kind: "TEXT", text: "$3M" },
          provenance: "APPLICANT_PROVIDED",
          correction: false,
        },
      ],
    });
    const outcome = await service.turn(
      turn({
        utterance: "We're raising a seed round, about a year of runway.",
      }),
    );
    expect(outcome.facts).toEqual([]);
    expect(outcome.rejectedFacts).toBe(1);
    expect(outcome.notRecorded).toEqual([
      {
        dimension: "raise.amount",
        reason: "AMOUNT_READ_BACK",
        amount: "3000000",
        currency: "USD",
      },
    ]);
    expect(outcome.reply).toMatch(
      /So that's USD 3,000,000 for raise size, right\?$/,
    );
  });

  it("never says it couldn't record a region; it asks which country", async () => {
    const { service } = interviewer({
      ...RESULT,
      facts: [
        {
          dimension: "company.country",
          value: { kind: "TEXT", text: "somewhere in Europe" },
          provenance: "APPLICANT_PROVIDED",
          correction: false,
        },
      ],
    });
    const outcome = await service.turn(turn());
    expect(outcome.facts).toEqual([]);
    expect(outcome.reply).not.toMatch(/couldn't record/);
    // A region, not a country: Q asks which country in it, as its question.
    expect(outcome.reply).toBe(
      "Lagos, got it. Which country in Europe is the company based in?",
    );
    expect(outcome.asking).toBe("company.country");
  });

  it("replays an older paid checkpoint without restoring a wrongly shaped stage", () => {
    const outcome = InterviewTurnOutcomeSchema.parse({
      reply: RESULT.reply,
      intent: "ANSWER",
      facts: [
        {
          dimension: "company.stage",
          value: { kind: "TEXT", text: "seed" },
          provenance: "APPLICANT_PROVIDED",
        },
        {
          dimension: "company.country",
          value: { kind: "CODE", code: "KE" },
          provenance: "APPLICANT_PROVIDED",
        },
      ],
      rejectedFacts: 2,
      asking: null,
      questionForQ: null,
      readyToReview: false,
    });
    expect(outcome.reply).toBe(RESULT.reply);
    expect(outcome.facts.map((fact) => fact.dimension)).toEqual([
      "company.country",
    ]);
    expect(outcome.rejectedFacts).toBe(3);
  });

  it("keeps a stated canonical stage and explicit unknown as separate valid proposals", async () => {
    const { service } = interviewer({
      ...RESULT,
      facts: [
        {
          dimension: "company.stage",
          value: { kind: "CODE", code: "seed" },
          provenance: "APPLICANT_PROVIDED",
          correction: true,
        },
        {
          dimension: "raise.amount",
          value: { kind: "NONE" },
          provenance: "UNKNOWN",
          correction: false,
        },
      ],
    });
    const outcome = await service.turn(turn());
    expect(outcome.facts.map((fact) => fact.value)).toEqual([
      { kind: "CODE", code: "seed" },
      { kind: "NONE" },
    ]);
    expect(outcome.rejectedFacts).toBe(0);
  });

  it("never upgrades a new founder claim to document-supported based on model assertion alone", async () => {
    const { service } = interviewer({
      ...RESULT,
      facts: [
        {
          ...RESULT.facts[0],
          dimension: "claims.revenue",
          value: { kind: "TEXT", text: "$100k revenue" },
          provenance: "DOCUMENT_SUPPORTED",
          correction: false,
        },
      ],
    });
    const outcome = await service.turn(
      turn({ utterance: "We have $100k revenue." }),
    );
    expect(outcome.facts[0]?.provenance).toBe("APPLICANT_PROVIDED");
    expect(outcome.facts[0]?.value).toEqual({
      kind: "TEXT",
      text: "$100k revenue",
    });
  });
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
    expect(needs).toHaveLength(6);
    // Supported new claims fall outside this bounded next-question window.
    expect(needs.map((need) => need.dimension)).not.toContain(
      "claims.traction",
    );
    expect(needs.map((need) => need.dimension)).not.toContain(
      "raise.use_of_funds",
    );
  });

  it("does not ask one dimension a third time, and moves to what is still unknown (live 2026-10-17)", () => {
    // Partech/FDN Advisory: "what are you building, and who is it for?"
    // was asked four times while nothing was recorded on that dimension.
    const empty = {
      policy: { criteria: [] } as unknown as GatewayPolicy,
      qualification: {
        unknowns: [],
        criteria: [],
      } as unknown as QualificationResult,
      facts: [
        {
          id: randomUUID() as ApplicationFact["id"],
          applicationId: randomUUID() as ApplicationFact["applicationId"],
          dimension: "company.name",
          value: { kind: "TEXT", text: "FDN Advisory" },
          provenance: "APPLICANT_PROVIDED",
          recordedAt: "2026-10-17T16:00:00.000Z",
          supersededAt: null,
        },
      ] as ApplicationFact[],
    };
    expect(questionNeedsFor(empty)[0]?.dimension).toBe("company.description");
    const once = questionNeedsFor({
      ...empty,
      askedCounts: new Map([["company.description", 1]]),
    });
    expect(once[0]?.dimension).toBe("company.description");
    const twice = questionNeedsFor({
      ...empty,
      askedCounts: new Map([["company.description", 2]]),
    });
    expect(twice.map((need) => need.dimension)).not.toContain(
      "company.description",
    );
    expect(twice[0]?.dimension).toBe("company.problem");
  });

  it("leans on the investor's mandate emphasis after required rules and before the general order", () => {
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
      emphasis: ["claims.revenue", "company.customers"],
    });
    expect(needs.slice(0, 3)).toEqual([
      { dimension: "company.stage", reason: "REQUIRED_BY_GATEWAY" },
      { dimension: "claims.revenue", reason: "INVESTOR_EMPHASIS" },
      { dimension: "company.customers", reason: "INVESTOR_EMPHASIS" },
    ]);
  });

  it("treats an explained solution as having described the company", () => {
    const needs = questionNeedsFor({
      policy: { criteria: [] } as unknown as GatewayPolicy,
      qualification: {
        unknowns: [],
        criteria: [],
      } as unknown as QualificationResult,
      facts: [
        {
          id: randomUUID() as ApplicationFact["id"],
          applicationId: randomUUID() as ApplicationFact["applicationId"],
          dimension: "company.solution",
          value: { kind: "TEXT", text: "Investment-readiness programme" },
          provenance: "APPLICANT_PROVIDED",
          recordedAt: "2026-10-17T16:00:00.000Z",
          supersededAt: null,
        },
      ],
    });
    const dimensions = needs.map((need) => need.dimension);
    expect(dimensions).not.toContain("company.description");
    expect(dimensions).not.toContain("company.solution");
    // The investment substance still follows: model and market.
    expect(dimensions).toContain("company.business_model");
    expect(dimensions).toContain("company.market");
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

describe("recordable claims versus next-question priority", () => {
  it("gives Q the full recordable contract independently of the next questions", async () => {
    const captured: { prompt?: string } = {};
    const { service } = interviewer(
      { ...RESULT, facts: [], asking: null },
      captured,
    );
    await service.turn(
      turn({
        utterance:
          "We have fourteen paying sites; the raise funds inventory and engineers.",
      }),
    );
    const prompt = captured.prompt ?? "";
    expect(prompt).toContain("RECORDABLE DIMENSIONS");
    expect(prompt).toContain("claims.traction");
    expect(prompt).toContain("raise.use_of_funds");
    for (const dimension of APPLICATION_DIMENSIONS)
      expect(prompt).toContain(dimension);
    expect(prompt).not.toContain(
      "Only dimensions that appear in KNOWN FACTS or QUESTION NEEDS",
    );
  });

  it("accepts stated traction and use of funds without making them the next question", async () => {
    const { service } = interviewer({
      ...RESULT,
      asking: "company.team",
      facts: [
        {
          dimension: "claims.traction",
          value: { kind: "TEXT", text: "Fourteen paying sites" },
          provenance: "APPLICANT_PROVIDED",
          correction: false,
        },
        {
          dimension: "raise.use_of_funds",
          value: { kind: "TEXT", text: "Inventory and two field engineers" },
          provenance: "APPLICANT_PROVIDED",
          correction: false,
        },
      ],
    });
    const outcome = await service.turn(
      turn({
        utterance:
          "We have fourteen paying sites; the raise funds inventory and two field engineers.",
      }),
    );
    expect(outcome.asking).toBe("company.team");
    expect(outcome.facts.map((fact) => fact.dimension)).toEqual([
      "claims.traction",
      "raise.use_of_funds",
    ]);
    expect(outcome.rejectedFacts).toBe(0);
  });
});

it("retains the historical variable contract for an explicitly pinned interviewer registry", async () => {
  const registry = createPromptRegistry(
    PROMPT_DEFINITIONS.filter(
      (definition) =>
        definition.id !== "GATEQ_INTERVIEWER" || definition.version === 2,
    ).map((definition) =>
      definition.id === "GATEQ_INTERVIEWER"
        ? { ...definition, status: "ACTIVE" as const }
        : definition,
    ),
  );
  const captured: { prompt?: string } = {};
  const { service } = interviewer(RESULT, captured, registry);
  expect((await service.turn(turn())).facts).toHaveLength(1);
  expect(captured.prompt).not.toContain("RECORDABLE DIMENSIONS");
});

describe("what the founder said, not what Q worked out (live 2026-10-15)", () => {
  const amount = (value: string) => ({
    dimension: "claims.revenue" as const,
    value: { kind: "AMOUNT" as const, amount: value, currency: "USD" },
    provenance: "APPLICANT_PROVIDED" as const,
    correction: false,
  });
  const traction = {
    dimension: "claims.traction" as const,
    value: {
      kind: "PHRASES" as const,
      phrases: ["Two design partners pay annual contracts of $180,000 each"],
    },
    provenance: "APPLICANT_PROVIDED" as const,
    correction: false,
  };
  const said =
    "We have 4 design partners. Two of them pay us on annual contracts of $180,000 each.";

  it("never records a figure Q computed as the founder's claim; their words stay", async () => {
    const { service } = interviewer({
      ...RESULT,
      facts: [amount("360000"), traction] as never,
    });
    const outcome = await service.turn(turn({ utterance: said }));
    expect(outcome.facts.map((f) => f.dimension)).toEqual(["claims.traction"]);
    expect(outcome.rejectedFacts).toBe(1);
  });

  it("records an amount that was actually said, in any common written form", async () => {
    for (const [utterance, value] of [
      [said, "180000"],
      ["Revenue is about 1.5 million dollars a year.", "1500000"],
      ["We're at $80k MRR.", "80000"],
    ] as const) {
      const { service } = interviewer({
        ...RESULT,
        facts: [amount(value)] as never,
      });
      const outcome = await service.turn(turn({ utterance }));
      expect(outcome.facts).toHaveLength(1);
    }
  });

  it("a spoken first name never replaces the confirmed contact name", async () => {
    const confirmed: ApplicationFact = {
      id: randomUUID(),
      applicationId: randomUUID(),
      dimension: "contact.name",
      value: { kind: "TEXT", text: "Laura Mensah" },
      provenance: "APPLICANT_PROVIDED",
      recordedAt: "2026-10-15T20:00:00.000Z",
      supersededAt: null,
    } as ApplicationFact;
    const spoken = {
      dimension: "contact.name" as const,
      value: { kind: "TEXT" as const, text: "Laura" },
      provenance: "APPLICANT_PROVIDED" as const,
      correction: false,
    };
    const application = (facts: ApplicationFact[]) => ({
      policy: {
        gateway: { id: randomUUID() },
        version: { id: randomUUID() },
        criteria: [],
      } as unknown as GatewayPolicy,
      qualification: {
        criteria: [],
        unknowns: [],
        principalMismatches: [],
      } as unknown as QualificationResult,
      facts,
      documentProposals: [],
    });
    const { service } = interviewer({ ...RESULT, facts: [spoken] as never });
    const kept = await service.turn(
      turn({ utterance: "I'm Laura.", application: application([confirmed]) }),
    );
    expect(kept.facts).toEqual([]);
    // With no name on record yet, what they say fills it.
    const filled = await service.turn(
      turn({ utterance: "I'm Laura.", application: application([]) }),
    );
    expect(filled.facts.map((f) => f.dimension)).toEqual(["contact.name"]);
    // A different name or a new email is a change: recorded over the old
    // one (the store keeps its history), never refused (owner 2026-10-21).
    const changed = interviewer({
      ...RESULT,
      facts: [
        { ...spoken, value: { kind: "TEXT" as const, text: "Laura Owusu" } },
        {
          dimension: "contact.email" as const,
          value: { kind: "TEXT" as const, text: "laura@new.example" },
          provenance: "APPLICANT_PROVIDED" as const,
          correction: true,
        },
      ] as never,
    });
    const email = {
      ...confirmed,
      id: randomUUID(),
      dimension: "contact.email",
      value: { kind: "TEXT", text: "laura@old.example" },
    } as ApplicationFact;
    const moved = await changed.service.turn(
      turn({
        utterance: "I'm Laura Owusu now, and use laura@new.example from today.",
        application: application([confirmed, email]),
      }),
    );
    expect(moved.facts.map((f) => [f.dimension, f.value])).toEqual([
      ["contact.name", { kind: "TEXT", text: "Laura Owusu" }],
      ["contact.email", { kind: "TEXT", text: "laura@new.example" }],
    ]);
    expect(moved.notRecorded).toBeUndefined();
    expect(moved.reply).toBe(RESULT.reply);
  });
});

describe("the interview in Arabic (lane ml)", () => {
  // The note's words as JSON-escaped in the captured request.
  const asks = (prompt: string | undefined) =>
    (prompt ?? "").includes("Ask every question and say every reply in Arabic");

  it("asks an applicant who chose Arabic in Arabic, keeping the fund's name and figures as recorded", async () => {
    const captured: { prompt?: string } = {};
    const { service } = interviewer(RESULT, captured);
    await service.turn(turn({ locale: "ar-AE", utterance: "We're in Lagos." }));
    expect(asks(captured.prompt)).toBe(true);
    expect(captured.prompt).toContain("this person chose Arabic");
    expect(captured.prompt).toContain(
      "the fund's name, the gateway's criteria as named, amounts and currencies stay exactly as recorded",
    );
    // The fund's record is unchanged in what the model is given.
    expect(captured.prompt).toContain("Acme Ventures");
  });

  it("follows an applicant who answers in Arabic with no stated language", async () => {
    const captured: { prompt?: string } = {};
    const { service } = interviewer(RESULT, captured);
    await service.turn(
      turn({ utterance: "نحن في لاغوس ونجمع 1.5 مليون دولار." }),
    );
    expect(asks(captured.prompt)).toBe(true);
  });

  it("stays English for English, and a stated English wins over Arabic text", async () => {
    const english: { prompt?: string } = {};
    await interviewer(RESULT, english).service.turn(turn());
    expect(asks(english.prompt)).toBe(false);
    const stated: { prompt?: string } = {};
    await interviewer(RESULT, stated).service.turn(
      turn({ locale: "en", utterance: "نحن في لاغوس" }),
    );
    expect(asks(stated.prompt)).toBe(false);
  });

  it("reads the language of an opening from the stated locale alone", () => {
    expect(
      interviewLanguageOf({ locale: "ar", utterance: "", recentTurns: [] }),
    ).toBe("ar");
    expect(
      interviewLanguageOf({
        utterance: "",
        recentTurns: [{ role: "person", text: "مرحباً، شركتنا في دبي" }],
      }),
    ).toBe("ar");
    expect(interviewLanguageOf({ utterance: "Hello", recentTurns: [] })).toBe(
      null,
    );
  });

  it("asks in any stated language, and reads other scripts with no per-language code", async () => {
    expect(
      interviewLanguageOf({ locale: "fr-FR", utterance: "", recentTurns: [] }),
    ).toBe("fr-FR");
    expect(
      interviewLanguageOf({
        locale: "en-GB",
        utterance: "Привет",
        recentTurns: [],
      }),
    ).toBeNull();
    expect(
      interviewLanguageOf({
        utterance: "Мы находимся в Лагосе",
        recentTurns: [],
      }),
    ).toBe("ru");
    expect(
      interviewLanguageOf({ utterance: "हम लागोस में हैं", recentTurns: [] }),
    ).toBe("hi");
    const captured: { prompt?: string } = {};
    await interviewer(RESULT, captured).service.turn(
      turn({ locale: "sw", utterance: "Tuko Lagos." }),
    );
    expect(captured.prompt).toContain(
      "Ask every question and say every reply in Swahili",
    );
  });
});
