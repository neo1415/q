import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type FakeBehaviour,
  type ModelCatalogSnapshot,
} from "@capital-q/model-gateway";
import {
  createModelGatewayQAnswer,
  type QTurnReader,
} from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import {
  createSpecialistQAnswer,
  type QAppActionPort,
  type TurnAppAction,
} from "@capital-q/q-specialists";
import { ActorContextSchema } from "@capital-q/security";

/**
 * Scenario 3 of the investor-uncertainty certification, the whole turn
 * pipeline as q-api composes it: the specialist answer port (reading,
 * app-action routing, the recorded offer and the open resolution item)
 * over the model-gateway answer seam (tool loop, offer binding, code's own
 * offer), with the turn reader, the argument reader and the model faked
 * from the live run on production 78f8d72d5 (audit
 * docs/ai-handoff/audits/2026-11-14-investor-uncertainty-live.md, "Live
 * re-check 14 Nov (78f8d72d5)"):
 *
 *   run 5d5d7b24  "How solid is Ajopot's active users figure?" read
 *                 QUESTION_TO_Q / THEIR_OWN_RECORDS, aboutNamedOther, Ajopot;
 *                 the answer named a material uncertainty and offered nothing.
 *   run c72a0fbe  "Yes, please request that from Ajopot." read TOOL_REQUEST,
 *                 askedAction diligence_documents; the argument reader said
 *                 REQUIRED_INPUT_NOT_SAID; the model prepared a chat message.
 *
 * Earlier fixes tested a predicate alone and failed live at another gate;
 * these go in at the same entry the q-api uses. No network, no database.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const INVESTOR_ORG = "0f000000-0000-4000-8000-0000000000f1";
const AJOPOT = "3fa64633-0000-4000-8000-00000000a10f";
const KAZIKIT = "0989a281-0000-4000-8000-00000000b20f";
const OUTSIDER = "7e7e7e7e-0000-4000-8000-00000000c30f";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const MODEL = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const EPOCH = "2026-01-01T00:00:00.000Z";

function catalog(): ModelCatalogSnapshot {
  const taskClasses = [
    "NORMAL_DIALOGUE",
    "FAST_CLASSIFICATION",
    "DEEP_INVESTIGATION",
    "STRUCTURED_EXTRACTION",
  ] as const;
  return {
    providers: [
      {
        id: ALPHA,
        code: "alpha",
        name: "Alpha (reviewed)",
        status: "ACTIVE",
        privacyPolicyClass: "NO_TRAINING_ZERO_RETENTION",
        supportsZeroRetention: true,
        regionSupport: ["global"],
      },
    ],
    models: [
      {
        id: MODEL,
        providerId: ALPHA,
        modelCode: "alpha-standard",
        modelFamily: "test",
        modelType: "TEXT_GENERATION",
        status: "ACTIVE",
        contextWindow: 200_000,
        maxOutputTokens: 16_384,
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsVision: false,
        supportsAudio: false,
        supportsRealtime: false,
        supportsPromptCache: false,
        supportsReasoning: false,
        sensitivityCeiling: "CONFIDENTIAL",
        qualityClass: "HIGH",
        latencyClass: "FAST",
        effectiveFrom: EPOCH,
        effectiveTo: null,
      },
    ],
    prices: [
      {
        id: randomUUID(),
        modelId: MODEL,
        pricingRegion: "global",
        currency: "USD",
        inputPerMillion: 1,
        cachedInputPerMillion: null,
        outputPerMillion: 4,
        effectiveFrom: EPOCH,
        effectiveTo: null,
      },
    ],
    routingPolicies: taskClasses.map((taskClass, index) => ({
      id: `d${String(index + 1)}d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1`,
      code: `${taskClass.toLowerCase()}.v1`,
      taskClass,
      sensitivityClass: "RESTRICTED",
      qualityFloor: "BASIC",
      latencyTargetMs: null,
      costCeilingUsd: null,
      preferredModels: [MODEL],
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 1,
    })),
    loadedAt: EPOCH,
  };
}

const tool = (
  name: string,
  toolName: string,
  classification: QOfferedTool["classification"],
): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification,
  definition: {
    name,
    description: `${name}.`,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
});
const GET_COMPANY = tool("get_company", "company.get", "READ_ONLY");
const GET_RELATIONSHIP = tool(
  "get_relationship",
  "relationship.get",
  "READ_ONLY",
);
const CHAT = tool(
  "propose_chat_message",
  "relationship.chat.propose",
  "SIDE_EFFECT",
);
const DILIGENCE = tool(
  "diligence_documents",
  "app.diligence.change",
  "SIDE_EFFECT",
);

const NAMES: Readonly<Record<string, string>> = {
  [AJOPOT]: "Ajopot",
  [KAZIKIT]: "Kazikit",
  [OUTSIDER]: "Outsider Labs",
};

const profile = (companyId: string) => ({
  companyId,
  canonicalName: NAMES[companyId] ?? "Unknown",
  legalName: null,
  websiteUrl: null,
  foundedDate: null,
  headquartersCountry: null,
  headquartersCity: null,
  currentStageCode: "seed",
  shortDescription: "Declared company profile",
  primaryDescription: null,
  companyStatus: "active",
  relationToYou: "SHARED",
  truthClass: "USER_CLAIM",
});

/** Where Savanna Seed stands with each company, as hosted read showed. */
const relationshipWith = (companyId: string) => {
  const counterpart = {
    kind: "COMPANY",
    id: companyId,
    name: NAMES[companyId] ?? null,
  };
  if (companyId === OUTSIDER) {
    return {
      yourSide: "INVESTOR",
      counterpart,
      relationship: null,
      truthClass: "VERIFIED",
      source: "Capital Q relationship history",
    };
  }
  const inDiligence = companyId === AJOPOT;
  return {
    yourSide: "INVESTOR",
    counterpart,
    relationship: {
      state: inDiligence ? "IN_DILIGENCE" : "INTEREST_EXPRESSED",
      stateSince: "2026-11-01T10:00:00.000Z",
      milestones: [
        { state: "INTEREST_EXPRESSED", at: "2026-10-20T10:00:00.000Z" },
        ...(inDiligence
          ? [
              { state: "CONNECTED", at: "2026-10-22T10:00:00.000Z" },
              { state: "IN_DILIGENCE", at: "2026-11-01T10:00:00.000Z" },
            ]
          : []),
      ],
      nextStep: "NONE",
    },
    truthClass: "VERIFIED",
    source: "Capital Q relationship history",
  };
};

const ok = (
  proposal: QToolProposal,
  toolName: string,
  data: unknown,
  classification: QToolCallOutcome["classification"] = "READ_ONLY",
): QToolCallOutcome => ({
  callId: proposal.callId,
  toolName,
  toolVersion: 1,
  classification,
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "CONFIDENTIAL",
  result: { ok: true, data },
  latencyMs: 1,
});

/** The live answer of run 5d5d7b24, as the analyst's structured output. */
const DEFINITION =
  'Ajopot has not defined "active" or the period behind 18,700 of 52,000 registered users.';
const RECONCILED =
  "The active count has not been reconciled to partner-bank or transaction records.";
const analystAnswer = (
  text: string,
  uncertainties: readonly unknown[],
  offer: unknown = null,
): FakeBehaviour => ({
  kind: "TEXT",
  text: JSON.stringify({
    answer: text,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
    uncertainties,
    offer,
  }),
});
const LIVE_UNCERTAINTIES = [
  {
    statement: DEFINITION,
    standing: "REPORTED",
    material: true,
    mattersFor: ["THESIS", "VALUATION"],
    resolveBy: ["ASK_FOUNDER", "REQUEST_DOCUMENT"],
  },
  {
    statement: RECONCILED,
    standing: "REPORTED",
    material: true,
    mattersFor: ["DILIGENCE"],
    resolveBy: ["REQUEST_DOCUMENT", "CORROBORATION"],
  },
];
const LIVE_ANSWER =
  "It's a useful directional signal, but not yet solid enough to treat as decision-grade traction. I'd give it limited weight until those points are reconciled.";

type Reading = Record<string, unknown>;

/** The reader's live outputs, as TURN_READER returned them. */
const QUESTION_ABOUT = (name: string): Reading => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: {
    kind: "THEIR_OWN_RECORDS",
    text: `How solid is ${name}'s active users figure?`,
    about: [],
    count: null,
    discover: null,
    subject: null,
  },
  aboutNamedOther: true,
  namedOther: { name, kind: "COMPANY" },
  tool: null,
  handOver: null,
});
const REQUEST_THAT = (acceptsOffer: boolean): Reading => ({
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: true,
  namedOther: { name: "Ajopot", kind: "COMPANY" },
  askedAction: "diligence_documents",
  acceptsOffer,
  tool: null,
  handOver: null,
});

/** The model's live tool call on the yes turn: a chat message. */
const CHAT_CALL: FakeBehaviour = {
  kind: "TOOL_CALLS",
  calls: [
    {
      callId: "m1",
      name: "propose_chat_message",
      arguments: {
        relationship: "Ajopot",
        text: "Could you define active users and share a cohort table?",
      },
    },
  ],
};

function conversation(options: {
  readonly readings: readonly Reading[];
  readonly script: readonly FakeBehaviour[];
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      ...options.script,
      analystAnswer("Nothing further.", []),
      analystAnswer("Nothing further.", []),
    ],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog()),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const conversationId = randomUUID();
  const messages: QConversationMessage[] = [];
  const completed: { message?: { text?: string } }[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      mark: () => Promise.resolve(),
      insert: (_tx: unknown, input: Partial<QConversationMessage>) => {
        const row = {
          ...input,
          id: randomUUID(),
          tenantId: TENANT,
          conversationId,
          contentType: "TEXT",
          createdAt: new Date().toISOString(),
        } as QConversationMessage;
        messages.push(row);
        return Promise.resolve(row);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(1) },
    runEvents: {
      append: (
        _tx: unknown,
        input: { eventType?: string; payload?: unknown },
      ) => {
        if (input.eventType === "q.message.completed") {
          completed.push(input.payload as { message?: { text?: string } });
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  /** Every tool the model or code ran through the port (the world). */
  const executed: QToolProposal[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([GET_COMPANY, GET_RELATIONSHIP, CHAT]),
    available: () =>
      Promise.resolve([GET_COMPANY, GET_RELATIONSHIP, CHAT, DILIGENCE]),
    execute: (proposal) => {
      executed.push(proposal);
      const args = proposal.arguments as { companyId?: string };
      switch (proposal.name) {
        case "get_company":
          return Promise.resolve(
            ok(proposal, "company.get", profile(args.companyId ?? AJOPOT)),
          );
        case "get_relationship":
          return Promise.resolve(
            ok(
              proposal,
              "relationship.get",
              relationshipWith(args.companyId ?? AJOPOT),
            ),
          );
        default:
          return Promise.resolve(
            ok(
              proposal,
              proposal.name === "diligence_documents"
                ? "app.diligence.change"
                : "relationship.chat.propose",
              {
                status: "PREPARED",
                line: "It is waiting for your approval.",
              },
              "SIDE_EFFECT",
            ),
          );
      }
    },
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
  });
  /** The declared app actions code runs (the approval card's payload). */
  const ran: TurnAppAction[] = [];
  const appActions: QAppActionPort = {
    tools: new Set(["diligence_documents"]),
    run: (_request, action) => {
      ran.push(action);
      return Promise.resolve({
        prepared: "Ask for a document is waiting for your approval.",
      });
    },
  };
  /** The argument reader, as it answered live: nothing it could fill. */
  const argumentReads: string[] = [];
  const readings = [...options.readings];
  const turns: QTurnReader = {
    read: () => Promise.resolve((readings.shift() ?? null) as never),
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: seam,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    appActions,
    appActionArguments: (_request, input) => {
      argumentReads.push(input.tool);
      return Promise.resolve(null);
    },
    offeredTools: () =>
      Promise.resolve([
        "get_company",
        "get_relationship",
        "propose_chat_message",
        "diligence_documents",
      ]),
  });
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  /** One turn: their words stored, then the answer as q-api asks it. */
  const say = async (said: string) => {
    const runId = randomUUID();
    messages.push({
      id: randomUUID(),
      tenantId: TENANT,
      conversationId,
      runId,
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as QConversationMessage);
    const plan = PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date().toISOString(),
      revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
      revalidateOnResume: true,
    });
    const request: QAnswerRequest = {
      runId: runId as QAnswerRequest["runId"],
      tenantId: TENANT as QAnswerRequest["tenantId"],
      actorUserId: USER as QAnswerRequest["actorUserId"],
      actor,
      correlationId: `cor_${runId}`,
      capability: "ANSWER",
      subjects: [],
      retrieval: { kind: "NOT_CONFIGURED" },
      // The asker is on an investor's side: their own mandate is in plan.
      plan: {
        ...plan,
        scopes: [
          {
            kind: "INVESTOR_MANDATE",
            subject: {
              kind: "INVESTOR_ORGANISATION",
              investorOrganisationId: INVESTOR_ORG,
            },
          },
        ],
      } as unknown as PermittedContextPlan,
    };
    const outcome = await answer.answer(request);
    const text = completed.at(-1)?.message?.text ?? "";
    return { outcome, text };
  };
  return { say, executed, ran, argumentReads, messages };
}

const readsOf = (companyId: string): FakeBehaviour => ({
  kind: "TOOL_CALLS",
  calls: [
    { callId: "a", name: "get_company", arguments: { companyId } },
    // The live run read a second company beside the one asked about.
    {
      callId: "p",
      name: "get_company",
      arguments: { companyId: companyId === AJOPOT ? KAZIKIT : AJOPOT },
    },
  ],
});

describe("scenario 3 end to end: the uncertainty is resolved through one code-owned flow", () => {
  it("D12: 'How solid is Ajopot's active users figure?' (read THEIR_OWN_RECORDS + aboutNamedOther) closes with one offer, recorded", async () => {
    const turn = conversation({
      readings: [QUESTION_ABOUT("Ajopot")],
      script: [readsOf(AJOPOT), analystAnswer(LIVE_ANSWER, LIVE_UNCERTAINTIES)],
    });
    const first = await turn.say("How solid is Ajopot's active users figure?");
    expect(first.outcome).toMatchObject({
      kind: "ANSWERED",
      offer: {
        action: "diligence_documents",
        about: { statement: DEFINITION, standing: "REPORTED" },
        counterparty: { kind: "COMPANY", id: AJOPOT, name: "Ajopot" },
      },
    });
    // The answer first, then exactly one offer.
    expect(first.text.indexOf("directional signal")).toBeLessThan(
      first.text.indexOf("Want me to ask Ajopot for a document"),
    );
    expect(first.text.split("Want me to").length).toBe(2);
    // Nothing is prepared or sent on the offer itself.
    expect(turn.ran).toEqual([]);
    expect(
      turn.executed.filter((p) => p.name !== "get_company").map((p) => p.name),
    ).toEqual(["get_relationship"]);
  });

  it.each([false, true])(
    "D13: 'Yes, please request that from Ajopot.' (TOOL_REQUEST, nothing the argument reader can fill, acceptsOffer=%s) prepares the diligence request with `about`, never a chat message",
    async (acceptsOffer) => {
      const turn = conversation({
        readings: [QUESTION_ABOUT("Ajopot"), REQUEST_THAT(acceptsOffer)],
        script: [
          readsOf(AJOPOT),
          analystAnswer(LIVE_ANSWER, LIVE_UNCERTAINTIES),
          // Turn 2, as live: the model reaches for a chat message.
          CHAT_CALL,
          analystAnswer("I've drafted a message to Ajopot.", []),
        ],
      });
      await turn.say("How solid is Ajopot's active users figure?");
      await turn.say("Yes, please request that from Ajopot.");
      // One approval card: the diligence request, filled by code from the
      // item -- whom, a title, what it resolves (about + standing).
      expect(turn.ran).toHaveLength(1);
      expect(turn.ran[0]).toEqual({
        tool: "diligence_documents",
        arguments: {
          operation: "REQUEST",
          relationship: "Ajopot",
          title: `Evidence that settles: ${DEFINITION}`,
          resolves: { statement: DEFINITION, standing: "REPORTED" },
        },
      });
      // No chat message was prepared.
      expect(turn.executed.map((p) => p.name)).not.toContain(
        "propose_chat_message",
      );
    },
  );

  it("D14: an explicit request for a document later in the conversation carries `about` from the open item", async () => {
    const turn = conversation({
      readings: [
        QUESTION_ABOUT("Ajopot"),
        {
          ...REQUEST_THAT(false),
          appAction: {
            tool: "diligence_documents",
            arguments: {
              operation: "REQUEST",
              relationship: "Ajopot",
              title:
                "a six-month active-user cohort table reconciled to partner-bank records",
            },
          },
        },
      ],
      script: [readsOf(AJOPOT), analystAnswer(LIVE_ANSWER, LIVE_UNCERTAINTIES)],
    });
    await turn.say("How solid is Ajopot's active users figure?");
    await turn.say(
      "Instead of a message, request a diligence document from Ajopot: a six-month active-user cohort table reconciled to partner-bank records.",
    );
    expect(turn.ran).toHaveLength(1);
    expect(turn.ran[0]?.arguments).toMatchObject({
      operation: "REQUEST",
      relationship: "Ajopot",
      // Their own title wins over code's suggestion.
      title:
        "a six-month active-user cohort table reconciled to partner-bank records",
      resolves: { statement: DEFINITION, standing: "REPORTED" },
    });
  });

  it("Kazikit (INTEREST_EXPRESSED), negative: no offer and no diligence card; the stage is said once", async () => {
    const turn = conversation({
      readings: [QUESTION_ABOUT("Kazikit"), REQUEST_THAT(false)],
      script: [
        readsOf(KAZIKIT),
        analystAnswer("Kazikit's revenue is not solidly evidenced.", [
          {
            statement: "Kazikit's revenue figure is self-reported.",
            standing: "REPORTED",
            material: true,
            mattersFor: ["VALUATION"],
            resolveBy: ["REQUEST_DOCUMENT"],
          },
        ]),
        analystAnswer("Diligence hasn't started.", []),
      ],
    });
    const first = await turn.say("How solid are Kazikit's revenue figures?");
    expect(
      first.outcome.kind === "ANSWERED" ? first.outcome.offer : null,
    ).toBeUndefined();
    expect(first.text).not.toContain("Want me to");
    expect(first.text.split("waiting for them to accept").length).toBe(2);
    await turn.say("Yes, please request that from Kazikit.");
    // No open item was recorded: code prepares nothing on its own.
    expect(turn.ran.filter((a) => "resolves" in a.arguments)).toEqual([]);
  });

  it("D13 with no open item: a chat message the model prepares on a turn that asked for the diligence request does not go", async () => {
    const turn = conversation({
      readings: [REQUEST_THAT(false)],
      script: [
        readsOf(AJOPOT),
        CHAT_CALL,
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "d",
              name: "diligence_documents",
              arguments: {
                operation: "REQUEST",
                relationship: "Ajopot",
                title: "Definition of active users and a cohort table",
              },
            },
          ],
        },
        analystAnswer("It's ready for your approval on the card.", []),
      ],
    });
    await turn.say("Yes, please request that from Ajopot.");
    expect(turn.executed.map((p) => p.name)).not.toContain(
      "propose_chat_message",
    );
    expect(turn.executed.map((p) => p.name)).toContain("diligence_documents");
  });

  it("outsider (no relationship), negative: no offer, nothing recorded, nothing prepared", async () => {
    const turn = conversation({
      readings: [QUESTION_ABOUT("Outsider Labs"), REQUEST_THAT(false)],
      script: [
        readsOf(OUTSIDER),
        analystAnswer("Outsider Labs' user figure is its own claim.", [
          {
            statement: "Outsider Labs' user count is self-reported.",
            standing: "REPORTED",
            material: true,
            mattersFor: ["THESIS"],
            resolveBy: ["ASK_FOUNDER"],
          },
        ]),
        analystAnswer("Nothing to request yet.", []),
      ],
    });
    const first = await turn.say("How solid is Outsider Labs' user figure?");
    expect(
      first.outcome.kind === "ANSWERED" ? first.outcome.offer : null,
    ).toBeUndefined();
    await turn.say("Yes, please request that from Outsider Labs.");
    expect(turn.ran.filter((a) => "resolves" in a.arguments)).toEqual([]);
  });

  it("a request toward another company never takes Ajopot's open item", async () => {
    const turn = conversation({
      readings: [
        QUESTION_ABOUT("Ajopot"),
        {
          ...REQUEST_THAT(false),
          namedOther: { name: "Kazikit", kind: "COMPANY" },
        },
      ],
      script: [
        readsOf(AJOPOT),
        analystAnswer(LIVE_ANSWER, LIVE_UNCERTAINTIES),
        analystAnswer("Diligence hasn't started with Kazikit.", []),
      ],
    });
    await turn.say("How solid is Ajopot's active users figure?");
    await turn.say("Please request their accounts from Kazikit.");
    expect(
      turn.ran.filter(
        (a) =>
          (a.arguments as { relationship?: unknown }).relationship === "Ajopot",
      ),
    ).toEqual([]);
  });
});
