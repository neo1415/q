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
import { createModelGatewayQAnswer, OWN_MANDATE_NOTE } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Home Q knows the person it is talking to (CQ-QX-007; fixture
 * conversation 64aab371). An onboarded investor asked "according to my
 * profile, who am I?" and was told no profile facts existed: the run was
 * about their own investor organisation, the firewall had admitted its
 * mandate to them as owner, and nothing read it. It is now read for them,
 * through the same tool and plan, whenever the plan binds it — and only
 * then.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const OWN = randomUUID();

const MANDATE_TOOL: QOfferedTool = {
  toolName: "investor_mandate.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "get_investor_mandate",
    description: "Returns the investor's declared mandate.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_INVESTOR_CRITERIA",
};

function plan(boundMandate: boolean): PermittedContextPlan {
  const subject = {
    kind: "INVESTOR_ORGANISATION" as const,
    investorOrganisationId: OWN,
  };
  return {
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
    subjects: [subject],
    scopes: boundMandate ? [{ kind: "INVESTOR_MANDATE", subject }] : [],
    denied: [],
    maxSensitivity: "PUBLIC",
  } as unknown as PermittedContextPlan;
}

function build(boundMandate: boolean) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer:
            "You're an angel investor with Zino Aviation, backing pre-seed companies; your mandate is still a draft.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
        }),
      },
    ],
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
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: "According to my profile, who am I?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const executed: QToolProposal[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([MANDATE_TOOL]),
    execute: (proposal) => {
      executed.push(proposal);
      const outcome: QToolCallOutcome = {
        callId: proposal.callId,
        toolName: "investor_mandate.get",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: {
          ok: true,
          data: {
            investorOrganisationId: OWN,
            displayName: "Zino Aviation",
            investorType: "ANGEL",
            deploymentState: "ACTIVELY_INVESTING",
            mandates: [
              {
                status: "DRAFT",
                stage: { minStageCode: "pre_seed", maxStageCode: "pre_seed" },
                cheque: { currency: "EUR" },
              },
            ],
            truncated: false,
          },
        },
        latencyMs: 3,
      };
      return Promise.resolve(outcome);
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) =>
        Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage),
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
  });
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
    subjects: [{ kind: "INVESTOR_ORGANISATION", investorOrganisationId: OWN }],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: plan(boundMandate),
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed };
}

describe("Home Q reads the person's own declared profile", () => {
  it("hands their own profile to the model when the firewall bound it to them", async () => {
    const { seam, request, alpha, executed } = build(true);
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(executed.map((call) => call.name)).toEqual(["get_investor_mandate"]);
    expect(executed[0]?.arguments).toEqual({ investorOrganisationId: OWN });
    const sent = alpha.calls
      .flatMap((call) => call.request.messages.map((m) => m.content))
      .join("\n");
    // Among the AUTHORISED FACTS, in words, not as a trailing tool dump.
    const facts = sent.slice(sent.indexOf("AUTHORISED FACTS"));
    expect(facts).toContain("own declared investor profile");
    expect(facts).toContain("their investor organisation is Zino Aviation");
    expect(facts).toContain("they invest as angel");
    expect(facts).toContain("deployment: actively investing");
    expect(facts).toContain("draft mandate (still being declared)");
    expect(sent).toContain(OWN_MANDATE_NOTE.content);
  });

  it("reads nothing when the plan did not bind their mandate", async () => {
    const { seam, request, executed } = build(false);
    await seam.answer(request);
    expect(executed).toEqual([]);
  });
});
