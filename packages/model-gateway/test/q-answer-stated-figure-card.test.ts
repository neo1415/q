import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { statedFigureCard } from "../src/q/stated-figure-card.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * A8 (live 14 Nov 2026, founder.maji-loop on 4d5ab3ac2): with "MRR USD
 * 120,000 for October 2026" approved, "Actually October MRR was $110k."
 * went down the tool path, the model called no tool and put the figure only
 * in its structured output, and Q said "I haven't saved that yet." with no
 * card. Code now prepares the figure tool's own card from the run's reading
 * (statedFigures) when the run did not, through the same tool port, so the
 * action's authorize step and checks decide (q-tools company-figure-tool
 * test: the same arguments name the USD 120,000 already on record).
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();
const SAID = "Actually October MRR was $110k.";

const FIGURE_TOOL: QOfferedTool = {
  toolName: "app.company.figure.record",
  toolVersion: 1,
  classification: "PREPARE",
  definition: {
    name: "propose_company_figure",
    description: "Prepares a figure they state for their approval.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
} as unknown as QOfferedTool;

// The app action's own prepared line (q-tools preparedLine over its card).
const CARD_SAYS =
  "Record your MRR of USD 110,000 for October 2026: You said: \"Actually October MRR was $110k.\". Kept as your own statement (self-reported), private to your company: investors don't see it. You already have USD 120,000 for October 2026 recorded for that date: both are kept, marked as conflicting, until you settle it.. It's on the card for your approval; nothing changes until you approve it.";

const READING = {
  metric: "MRR",
  amount: 110000,
  currency: "USD",
  period: "2026-10",
  quote: SAID,
};

/** The live answer: the figure in structure only, and a claim of saving. */
const LIVE_ANSWER = {
  answer:
    "You've corrected Maji Loop's October MRR to $110k. The earlier $120k figure remains on record.",
  responseShape: "CONCISE",
  insufficientEvidence: false,
  recommendation: null,
  userStatements: [
    {
      quote: SAID,
      statement: "October 2026 MRR was USD 110,000.",
      knowledgeKey: "financial.mrr",
      validFrom: "2026-10-31",
    },
  ],
  statedFigures: [READING],
};

function build(
  options: {
    readonly answer?: Record<string, unknown>;
    readonly said?: string;
    readonly offered?: readonly QOfferedTool[];
    readonly modelCalls?: boolean;
    readonly investor?: boolean;
  } = {},
) {
  const text = JSON.stringify(options.answer ?? LIVE_ANSWER);
  const alpha = createFakeModelProvider({
    code: "alpha",
    script:
      options.modelCalls === true
        ? [
            {
              kind: "TOOL_CALLS",
              calls: [
                {
                  callId: "model-figure",
                  name: "propose_company_figure",
                  arguments: {
                    metric: "MRR",
                    amount: 110000,
                    currency: "USD",
                    period: "2026-10",
                    said: SAID,
                  },
                },
              ],
            },
            { kind: "TEXT", text },
          ]
        : [{ kind: "TEXT", text }],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: options.said ?? SAID,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const executed: QToolProposal[] = [];
  const stored: string[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([...(options.offered ?? [FIGURE_TOOL])]),
    execute: (proposal) => {
      executed.push(proposal);
      // Stands in for the app action (its checks are q-tools'): prepared
      // for approval, nothing written.
      return Promise.resolve({
        callId: proposal.callId,
        toolName: FIGURE_TOOL.toolName,
        toolVersion: 1,
        classification: "PREPARE",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: {
          ok: true,
          data: {
            status: "PREPARED",
            summary: "Record your MRR of USD 110,000 for October 2026",
            ownRecord: true,
            says: CARD_SAYS,
          },
        },
        latencyMs: 2,
      } as QToolCallOutcome);
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) => {
        stored.push(input.content);
        return Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    context: {
      assemble: () =>
        Promise.resolve({
          facts: [
            {
              scope: "COMPANY_PROFILE",
              statement: "MRR USD 120,000 for October 2026 (their statement).",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              source: "Their statement",
            },
          ],
          subjectDescription: "their own company, Maji Loop",
        }),
    },
  });
  const subject = { kind: "COMPANY", companyId: COMPANY } as const;
  const request = {
    runId: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [subject],
    turnKind: "CORRECTION",
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: {
        capability: "ANSWER",
        taskClass:
          options.investor === true
            ? "COUNTERPARTY_COMPANY_QUESTION"
            : "OWN_COMPANY_QUESTION",
      },
      subjects: [subject],
      scopes: [{ kind: "COMPANY_PROFILE", subject }],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, executed, stored };
}

const figureCalls = (executed: readonly QToolProposal[]) =>
  executed.filter((call) => call.name === "propose_company_figure");

describe("a figure the run read reaches the approval card (A8, live 14 Nov)", () => {
  it("the live sequence: the model returns only structure, code prepares one card and says it waits", async () => {
    const { seam, request, executed, stored } = build();
    const result = await seam.answer(request);
    expect(result.kind).toBe("ANSWERED");
    const calls = figureCalls(executed);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments).toEqual({
      metric: "MRR",
      amount: 110000,
      currency: "USD",
      period: "2026-10",
      said: SAID,
    });
    const said = stored.at(-1) ?? "";
    // Prepared, never done: the claim of a correction is the honest line.
    expect(said).not.toMatch(/You've corrected/u);
    // The card's own line: the figure on record is named, and it waits.
    expect(said).toContain(CARD_SAYS);
    expect(said).toContain("USD 120,000 for October 2026");
    expect(said).not.toMatch(/\bI've (saved|recorded|corrected)/u);
  });

  it("a model that already called the tool gets no second card", async () => {
    const { seam, request, executed } = build({ modelCalls: true });
    await seam.answer(request);
    const calls = figureCalls(executed);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.callId).toBe("model-figure");
  });

  it("money without a stated currency makes no card: nothing is guessed", async () => {
    const { seam, request, executed, stored } = build({
      answer: {
        ...LIVE_ANSWER,
        statedFigures: [{ ...READING, currency: null }],
      },
    });
    await seam.answer(request);
    expect(figureCalls(executed)).toEqual([]);
    expect(stored.at(-1) ?? "").not.toContain("on the card for your approval");
  });

  it("an investor's turn never: the figure tool is not offered there", async () => {
    const { seam, request, executed, stored } = build({
      offered: [],
      investor: true,
    });
    await seam.answer(request);
    expect(figureCalls(executed)).toEqual([]);
    expect(stored.at(-1) ?? "").not.toContain("on the card for your approval");
  });

  it("a quote that is not in their words makes no card", async () => {
    const { seam, request, executed, stored } = build({
      answer: {
        ...LIVE_ANSWER,
        statedFigures: [{ ...READING, quote: "October MRR was USD 110,000" }],
      },
    });
    await seam.answer(request);
    expect(figureCalls(executed)).toEqual([]);
    expect(stored.at(-1) ?? "").not.toContain("on the card for your approval");
  });
});

describe("statedFigureCard: the decision alone", () => {
  const base = {
    readings: [READING],
    offered: true,
    modelCalled: false,
    theirWords: [SAID],
  };

  it("prepares a complete reading in their words", () => {
    expect(statedFigureCard(base)).toEqual({
      kind: "PREPARE",
      arguments: {
        metric: "MRR",
        amount: 110000,
        currency: "USD",
        period: "2026-10",
        said: SAID,
      },
    });
  });

  it("never without the offer, after the model's own call, or from an incomplete or foreign reading", () => {
    expect(statedFigureCard({ ...base, offered: false })).toMatchObject({
      reason: "NOT_OFFERED",
    });
    expect(statedFigureCard({ ...base, modelCalled: true })).toMatchObject({
      reason: "MODEL_CALLED",
    });
    expect(
      statedFigureCard({ ...base, readings: [{ ...READING, period: null }] }),
    ).toMatchObject({ reason: "INCOMPLETE" });
    expect(
      statedFigureCard({ ...base, readings: [{ ...READING, metric: "NPS" }] }),
    ).toMatchObject({ reason: "INCOMPLETE" });
    expect(
      statedFigureCard({ ...base, theirWords: ["Something else entirely."] }),
    ).toMatchObject({ reason: "NOT_THEIR_WORDS" });
    expect(statedFigureCard({ ...base, readings: undefined })).toMatchObject({
      reason: "NO_READING",
    });
  });

  it("a count needs no currency, and a currency on it is not passed", () => {
    expect(
      statedFigureCard({
        ...base,
        readings: [
          {
            metric: "CUSTOMERS",
            amount: 42,
            currency: "USD",
            period: "2026-10",
            quote: "42 paying customers",
          },
        ],
        theirWords: ["We have 42 paying customers as of October."],
      }),
    ).toEqual({
      kind: "PREPARE",
      arguments: {
        metric: "CUSTOMERS",
        amount: 42,
        period: "2026-10",
        said: "42 paying customers",
      },
    });
  });
});
