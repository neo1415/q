import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
  MODEL_TOOL_CALLS_MAX,
} from "@capital-q/contracts";
import type { CompanyAnalystResult } from "@capital-q/q-core";
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
  type FakeBehaviour,
} from "../src/index.js";
import {
  CLIENT_ACTION_DONE_LINE,
  createModelGatewayQAnswer,
  noAuthorisedContext,
  Q_TOOL_LOOP_MAX_CALLS,
  Q_TOOL_LOOP_MAX_ROUNDS,
  type QAuthorisedContextPort,
} from "../src/q/index.js";
import { FIRST_CONTACT_REPLY, firstContactOf } from "../src/q/first-contact.js";
import { onScreenCompanyFact } from "../src/q/company-fact.js";
import { chatInsteadOf } from "../src/q/message-channel.js";
import { qCardOfferOf } from "../src/q/q-card-offer.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";
import { fitFixture } from "./fit-fixture.js";

/**
 * The bounded tool loop in the answer seam (CQ-Q-007 §63-§66, §102) over
 * the fake provider and a scripted tool port: what the model is told,
 * what it may propose, what returns to it, how many calls a run may make,
 * and that a tool's outcome — including a denial — is data in the
 * conversation, never an instruction and never a secret.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const PRIVATE = "TOOL-FOUNDER-PRIVATE-DO-NOT-LEAK";

function analystResult(answer: string): CompanyAnalystResult {
  return {
    answer,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
  };
}

const GET_COMPANY: QOfferedTool = {
  toolName: "company.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "get_company",
    description: "Returns a company profile.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_COMPANY",
};

function plan(): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

type ToolScript = (proposal: QToolProposal) => QToolCallOutcome;

function toolPort(
  offered: readonly QOfferedTool[],
  script: ToolScript,
): QToolPort & { readonly executed: QToolProposal[] } {
  const executed: QToolProposal[] = [];
  return {
    executed,
    offer: () => Promise.resolve(offered),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve(script(proposal));
    },
  };
}

function succeeded(proposal: QToolProposal, data: unknown): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName: "company.get",
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "PUBLIC",
    result: { ok: true, data },
    latencyMs: 3,
  };
}

function denied(proposal: QToolProposal): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName: "company.get",
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "DENIED",
    failureCode: "NOT_AVAILABLE",
    sensitivity: null,
    result: {
      ok: false,
      error: {
        code: "NOT_AVAILABLE",
        safeMessage: "Not available in this conversation's context.",
      },
    },
    latencyMs: 1,
  };
}

function build(options: {
  readonly script: readonly FakeBehaviour[];
  readonly tools?: QToolPort | undefined;
  readonly context?: QAuthorisedContextPort | undefined;
  readonly parallelExtras?: boolean | undefined;
  /** What the person says this turn; "Tell me about my company." by default. */
  readonly said?: string | undefined;
  /** The asker is on an investor's side (their own mandate is in the plan). */
  readonly investor?: boolean | undefined;
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: options.script,
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
      id: randomUUID() as QConversationMessage["id"],
      tenantId: TENANT as QConversationMessage["tenantId"],
      conversationId: CONVERSATION as QConversationMessage["conversationId"],
      runId: RUN as QConversationMessage["runId"],
      role: "USER",
      content: options.said ?? "Tell me about my company.",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ];
  const stages: string[] = [];
  const completed: unknown[] = [];
  /** Live findings, and how many completed messages preceded each. */
  const live: { payload: unknown; before: number }[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      // The seam reads the conversation, not the run; the fake has one
      // conversation, so both return the same thing.
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        input: { role: "USER" | "Q"; content: string },
      ) => {
        const message = {
          ...messages[0],
          id: randomUUID(),
          role: input.role,
          content: input.content,
        } as QConversationMessage;
        messages.push(message);
        return Promise.resolve(message);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(stages.length + 1) },
    runEvents: {
      // Stages only: the durable q.message.completed the seam now appends
      // (CQ-Q-009) carries no visible stage.
      append: (
        _tx: unknown,
        input: {
          visibleStage: string | null;
          eventType?: string;
          payload?: unknown;
        },
      ) => {
        if (input.eventType === "q.message.completed") {
          completed.push(input.payload);
        }
        if (input.eventType === "q.finding.available") {
          live.push({ payload: input.payload, before: completed.length });
        }
        if (input.visibleStage !== null) {
          stages.push(input.visibleStage);
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const logLines: string[] = [];
  const logger = {
    debug: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    info: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    warn: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    error: (c: unknown, m: string) => logLines.push(JSON.stringify([c, m])),
    child: () => logger,
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: options.tools,
    ...(options.context === undefined ? {} : { context: options.context }),
    ...(options.parallelExtras === undefined
      ? {}
      : { parallelExtras: options.parallelExtras }),
    logger,
  });
  const request: QAnswerRequest = {
    runId: RUN as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan:
      options.investor === true
        ? ({
            ...plan(),
            scopes: [
              {
                kind: "INVESTOR_MANDATE",
                subject: {
                  kind: "INVESTOR_ORGANISATION",
                  investorOrganisationId:
                    "0f000000-0000-4000-8000-0000000000f1",
                },
              },
            ],
          } as unknown as PermittedContextPlan)
        : plan(),
  };
  return { seam, alpha, messages, stages, logLines, request, completed, live };
}

const call = (
  id: string,
  args: Record<string, unknown> = { companyId: "x" },
): FakeBehaviour => ({
  kind: "TOOL_CALLS",
  calls: [{ callId: id, name: "get_company", arguments: args }],
});

const SET_THEME_OFFERED: QOfferedTool = {
  toolName: "client.theme.set",
  toolVersion: 1,
  classification: "SIDE_EFFECT",
  definition: {
    name: "set_theme",
    description: "Switches the appearance.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
};

describe("named-company evidence binding", () => {
  it.each([
    [false, "COMPANY"],
    [true, "COMPANY"],
    [false, "DISCOVER"],
    [true, "DISCOVER"],
  ] as const)(
    "binds findings to the explicitly named authorised profile, warm=%s screen=%s",
    async (warm, route) => {
      const screen = randomUUID();
      const target = randomUUID();
      const profile = (companyId: string, canonicalName: string) => ({
        companyId,
        canonicalName,
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
      const tools = toolPort([GET_COMPANY], (p) =>
        succeeded(
          p,
          profile(
            p.callId === "named-profile" ? target : screen,
            p.callId === "named-profile"
              ? "Named Founder"
              : "Incidental Screen Company",
          ),
        ),
      );
      const { seam, request, messages, completed, alpha } = build({
        tools,
        script: [
          call("named-profile", { companyId: target }),
          {
            kind: "TEXT",
            text: JSON.stringify({
              ...analystResult(
                "Named Founder's declared profile is seed stage.",
              ),
              findings: [
                {
                  statement: "Declared seed stage.",
                  type: "FACT",
                  confidence: "MODERATE",
                  truthClass: "USER_CLAIM",
                  evidenceStatus: "SELF_REPORTED",
                },
              ],
            }),
          },
        ],
      });
      if (messages[0])
        messages.splice(0, 1, {
          ...messages[0],
          content: "What does Named Founder do?",
        });
      const bound = {
        ...request,
        subjects: [{ kind: "COMPANY" as const, companyId: screen }],
        plan: {
          ...request.plan,
          screen: { route, companyId: screen },
        },
      };
      if (warm) {
        const warmAnswer = seam.warm;
        if (warmAnswer === undefined) throw new Error("Warm reads unavailable");
        warmAnswer(bound);
      }
      await seam.answer({ ...bound, aboutNamedOther: true });
      const payload = completed.at(-1) as {
        message: {
          blocks: Array<{
            kind: string;
            finding?: { subjects: unknown[] };
            companyId?: string;
          }>;
        };
      };
      expect(
        payload.message.blocks.find((b) => b.kind === "FINDING")?.finding
          ?.subjects,
      ).toEqual([{ kind: "COMPANY", companyId: target }]);
      expect(
        payload.message.blocks
          .filter((b) => b.kind === "COMPANY_REFERENCE")
          .map((b) => b.companyId),
      ).toEqual([target]);
      expect(JSON.stringify(alpha.calls[0]?.request)).toContain(
        "Resolve the company named in the current question",
      );
    },
  );
});

describe("fresh selected-company follow-ups reuse authorized identity", () => {
  it.each(
    (
      [
        ["What are the risks for this company?", "FRESH", false],
        ["What are the risks for this company?", "MULTIPLE", false],
        ["What are the risks for this company?", "OTHER_ONLY", true],
        [
          "What traction, material risks and missing evidence are on record for this company? Distinguish claims from verified facts.",
          "FRESH",
          false,
        ],
        // S3 (live 69e50e45): words naming no other company.
        ["What are the main risks here?", "FRESH", false],
        ["What are Selected Company's main risks?", "FRESH", false],
        ["What are the main risks here?", "REVOKED", true],
        ["What are the risks of Different Target?", "FRESH", true],
        ["What does Different Target do?", "FRESH", true],
        ["Compare this company with Different Target", "FRESH", true],
        ["What are the risks for these companies?", "FRESH", true],
        ["What are the risks for this company?", "MALFORMED", true],
        ["What are the risks for this company?", "REVOKED", true],
        ["What are the risks for this company?", "UNREAD", true],
        ["What are the risks for this company?", "NO_SELECTED_CONTEXT", true],
        ["What are the risks for this company?", "MISMATCHED_CONTEXT", true],
        ["What are the risks for this company?", "NO_SELECTED_SUBJECT", true],
      ] as const
    ).flatMap(([text, access, lookup]) =>
      (["COMPANY", "DISCOVER"] as const).map(
        (route) => [text, access, lookup, route] as const,
      ),
    ),
  )(
    "%s / %s preserves lookup=%s on %s",
    async (text, access, lookup, route) => {
      const companyId = randomUUID();
      const otherId = randomUUID();
      const tools = toolPort(access === "UNREAD" ? [] : [GET_COMPANY], (p) =>
        access === "REVOKED"
          ? denied(p)
          : access === "MALFORMED"
            ? succeeded(p, { companyId, canonicalName: "Selected Company" })
            : succeeded(p, {
                companyId:
                  access === "OTHER_ONLY" || p.callId === "additional-profile"
                    ? otherId
                    : companyId,
                canonicalName:
                  access === "OTHER_ONLY" || p.callId === "additional-profile"
                    ? "Other Company"
                    : "Selected Company",
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
              }),
      );
      const { seam, request, messages, alpha, completed } = build({
        tools,
        script: [
          ...(access === "MULTIPLE"
            ? [call("additional-profile", { companyId: otherId })]
            : []),
          {
            kind: "TEXT",
            text: JSON.stringify({
              ...analystResult(
                "The authorized profile has declared claims; missing evidence stays unknown.",
              ),
              findings: [
                {
                  statement: "Declared seed stage.",
                  type: "FACT",
                  confidence: "MODERATE",
                  truthClass: "USER_CLAIM",
                  evidenceStatus: "SELF_REPORTED",
                },
              ],
            }),
          },
        ],
      });
      if (messages[0]) messages[0] = { ...messages[0], content: text };
      await seam.answer({
        ...request,
        aboutNamedOther: true,
        subjects:
          access === "NO_SELECTED_SUBJECT"
            ? [{ kind: "COMPANY", companyId: otherId }]
            : [{ kind: "COMPANY", companyId }],
        plan: {
          ...request.plan,
          screen:
            access === "NO_SELECTED_CONTEXT"
              ? { route }
              : {
                  route,
                  companyId:
                    access === "MISMATCHED_CONTEXT" ? otherId : companyId,
                },
        },
      });
      const prompt = JSON.stringify(alpha.calls[0]?.request);
      expect(
        prompt.includes(
          "Resolve the company named in the current question through search_companies and get_company",
        ),
      ).toBe(lookup);
      const payload = completed.at(-1) as {
        message: {
          blocks: Array<{ kind: string; finding?: { subjects: unknown[] } }>;
        };
      };
      expect(
        payload.message.blocks.find((block) => block.kind === "FINDING")
          ?.finding?.subjects,
      ).toEqual(lookup ? [] : [{ kind: "COMPANY", companyId }]);
      if (!lookup) {
        expect(prompt).toContain("freshly read authorized profile");
        expect(
          tools.executed.filter((p) => p.name === "get_company"),
        ).toHaveLength(access === "MULTIPLE" ? 2 : 1);
      }
    },
  );
});

describe("selected-company analysis stays out of the candidate sweep", () => {
  it.each([
    [false, false, "COMPANY"],
    [true, false, "COMPANY"],
    [false, true, "COMPANY"],
    [true, true, "COMPANY"],
    [false, true, "DISCOVER"],
    [true, true, "DISCOVER"],
  ])(
    "answers the profile question with a late FIT reading, warm=%s, other=%s, screen=%s",
    async (warm, aboutNamedOther, screenRoute) => {
      const companyId = randomUUID();
      const investorOrganisationId = randomUUID();
      const topOffer = {
        ...GET_COMPANY,
        toolName: "fit.top_candidates",
        definition: { ...GET_COMPANY.definition, name: "fit_top_candidates" },
      };
      const tools = toolPort(
        [
          GET_COMPANY,
          topOffer,
          {
            ...topOffer,
            toolName: "fit.profile",
            definition: { ...topOffer.definition, name: "fit_profile" },
          },
        ],
        (p) => {
          if (p.name === "fit_top_candidates") {
            const fit = fitFixture(
              companyId,
              "Selected Company",
              { STAGE: "STRONG" },
              "STRONG_FIT",
            );
            const data = fit.result.data as { name: string; profile: unknown };
            return {
              ...succeeded(p, {
                status: "OK",
                comparison: {
                  entries: [
                    { name: data.name, line: null, profile: data.profile },
                  ],
                },
              }),
              toolName: "fit.top_candidates",
            };
          }
          if (p.name === "fit_profile")
            return {
              ...succeeded(
                p,
                fitFixture(
                  companyId,
                  "Selected Company",
                  { STAGE: "STRONG" },
                  "STRONG_FIT",
                ).result.data,
              ),
              toolName: "fit.profile",
            };
          return succeeded(p, {
            companyId,
            canonicalName: "Selected Company",
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
        },
      );
      const text =
        "What does this company actually do and why does it fit my mandate? Use its Capital Q records.";
      const answer =
        "Selected Company's declared profile is seed stage; missing fit evidence remains unknown.";
      const { seam, request, messages, completed, alpha } = build({
        tools,
        script: [
          {
            kind: "TEXT",
            text: JSON.stringify({
              ...analystResult(answer),
              findings: [
                {
                  statement: "Declared seed stage.",
                  type: "FACT",
                  confidence: "MODERATE",
                  truthClass: "USER_CLAIM",
                  evidenceStatus: "SELF_REPORTED",
                },
              ],
            }),
          },
        ],
      });
      if (messages[0]) messages[0] = { ...messages[0], content: text };
      const bound = {
        ...request,
        subjects: [{ kind: "COMPANY" as const, companyId }],
        plan: PermittedContextPlanSchema.parse({
          ...request.plan,
          screen: { route: screenRoute, companyId },
          scopes: [
            {
              kind: "INVESTOR_MANDATE" as const,
              contextLabel: "investor_private",
              sensitivity: "CONFIDENTIAL",
              layer: "STRUCTURED_STATE",
              factCategories: ["INVESTOR_THESIS"],
              projection: "FULL",
              rights: {
                canUseForReasoning: true,
                canDiscloseExistence: true,
                canQuote: true,
                canProvideLink: false,
              },
              filter: { tenantId: TENANT, investorOrganisationId },
              isEvidence: true,
              subject: {
                kind: "INVESTOR_ORGANISATION" as const,
                investorOrganisationId,
              },
            },
          ],
        }),
      };
      if (warm) {
        if (!seam.warm) throw new Error("Warm seam missing");
        seam.warm(bound);
      }
      await seam.answer({
        ...bound,
        aboutNamedOther,
        fitQuestion: { text, count: null },
      });
      expect(
        tools.executed.filter((p) => p.name === "fit_top_candidates"),
      ).toHaveLength(0);
      expect(tools.executed.some((p) => p.name === "get_company")).toBe(true);
      expect(alpha.calls).toHaveLength(1);
      expect(JSON.stringify(completed)).toContain(answer);
      const payload = completed.at(-1) as {
        message: {
          blocks: Array<{
            kind: string;
            companyId?: string;
            finding?: { subjects: unknown[] };
          }>;
        };
      };
      expect(
        payload.message.blocks
          .filter((b) => b.kind === "COMPANY_REFERENCE")
          .map((b) => b.companyId),
      ).toEqual([companyId]);
      expect(
        payload.message.blocks.find((b) => b.kind === "FINDING")?.finding
          ?.subjects,
      ).toEqual([{ kind: "COMPANY", companyId }]);
    },
  );
});

describe("client actions and the screen reach the answer (R20/R21/R33)", () => {
  it("a client-action tool's authorised result rides on the answer as a UI_INTENT block", async () => {
    const tools = toolPort([SET_THEME_OFFERED], (p) => ({
      ...succeeded(p, {
        status: "SCREEN_WILL_DO_IT",
        clientAction: { kind: "SET_THEME", theme: "dark" },
      }),
      toolName: "client.theme.set",
      classification: "SIDE_EFFECT",
    }));
    const { seam, request, completed } = build({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            { callId: "t1", name: "set_theme", arguments: { theme: "dark" } },
          ],
        },
        {
          kind: "TEXT",
          text: JSON.stringify(analystResult("Dark mode is on.")),
        },
      ],
      tools,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const last = completed.at(-1) as { message: { blocks?: unknown[] } };
    expect(last.message.blocks).toEqual([
      { kind: "UI_INTENT", intent: { kind: "SET_THEME", theme: "dark" } },
    ]);
  });

  it("an empty closing answer after a screen action still delivers the action (founder live 2026-09-30)", async () => {
    const tools = toolPort([SET_THEME_OFFERED], (p) => ({
      ...succeeded(p, {
        status: "SCREEN_WILL_DO_IT",
        clientAction: { kind: "SET_THEME", theme: "dark" },
      }),
      toolName: "client.theme.set",
      classification: "SIDE_EFFECT",
    }));
    const { seam, request, completed } = build({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            { callId: "t1", name: "set_theme", arguments: { theme: "dark" } },
          ],
        },
        { kind: "TEXT", text: JSON.stringify(analystResult("")) },
      ],
      tools,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const last = completed.at(-1) as {
      message: { text: string; blocks?: unknown[] };
    };
    expect(last.message.text).toBe(CLIENT_ACTION_DONE_LINE);
    expect(last.message.blocks).toEqual([
      { kind: "UI_INTENT", intent: { kind: "SET_THEME", theme: "dark" } },
    ]);
  });

  it("a revised document's card rides on the answer from the tool's own result (founder directive 2026-09-28)", async () => {
    const REVISE_OFFERED: QOfferedTool = {
      toolName: "documents.own.revise",
      toolVersion: 1,
      classification: "SIDE_EFFECT",
      definition: {
        name: "revise_my_document",
        description: "Revises one of their documents.",
        inputJsonSchema: { type: "object", properties: {} },
      },
      visibleStage: null,
    };
    const document = {
      artifactId: "00000000-0000-4000-8000-00000000a111",
      type: "PITCH_DECK",
      status: "READY",
      title: "Alpha deck",
      currentVersion: 2,
    };
    const tools = toolPort([REVISE_OFFERED], (p) => ({
      ...succeeded(p, { status: "DOCUMENT_UPDATED", document }),
      toolName: "documents.own.revise",
      classification: "SIDE_EFFECT",
    }));
    const { seam, request, completed } = build({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "r1",
              name: "revise_my_document",
              arguments: {
                artifactId: document.artifactId,
                changes: "Shorter summary",
              },
            },
          ],
        },
        {
          kind: "TEXT",
          text: JSON.stringify(analystResult("Updated: version 2.")),
        },
      ],
      tools,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const last = completed.at(-1) as { message: { blocks?: unknown[] } };
    expect(last.message.blocks).toEqual([
      {
        kind: "ARTIFACT_REFERENCE",
        artifactId: document.artifactId,
        type: "PITCH_DECK",
        status: "READY",
        title: "Alpha deck",
      },
    ]);
  });

  it("a failed or unrelated tool result carries no client action", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { clientAction: { kind: "RELOAD_PAGE" } }),
    );
    const { seam, request, completed } = build({
      script: [
        call("c1"),
        { kind: "TEXT", text: JSON.stringify(analystResult("ok")) },
      ],
      tools,
    });
    await seam.answer(request);
    const last = completed.at(-1) as { message: { blocks?: unknown[] } };
    expect(last.message.blocks ?? []).toEqual([]);
  });

  it("the planner is told which screen the person is on, from the plan (typed and voice alike)", async () => {
    const { seam, alpha, request } = build({
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("ok")) }],
    });
    await seam.answer({
      ...request,
      plan: { ...request.plan, screen: { route: "PROFILE" } },
    });
    const sent = alpha.calls[0]?.request.messages ?? [];
    const note = sent.find((m) =>
      m.content.includes("WHAT YOU CAN DO IN THIS CONVERSATION"),
    );
    expect(note?.content).toContain("WHERE THEY ARE NOW");
    expect(note?.content).toContain("on their profile");
    expect(note?.content).toContain("never say you cannot see their screen");
  });
});

describe("answer seam tool loop", () => {
  it("offers nothing and makes one structured call when no tool port is configured", async () => {
    const { seam, alpha, request } = build({
      script: [{ kind: "JSON", value: analystResult("plain") }],
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(1);
    expect(alpha.calls[0]?.request.tools).toEqual([]);
    expect(alpha.calls[0]?.request.output.kind).toBe("STRUCTURED");
    // This turn's notes ride in the user tail since company-analyst/v16
    // (prompt-cache order), so the whole prompt is what is asserted.
    expect(
      alpha.calls[0]?.request.messages.map((m) => m.content).join("\n"),
    ).toContain("No tools are available");
    expect(seam.lastObservation()?.modelCalls).toBe(1);
  });

  it("names the offered tools and answers in one call when nothing needs looking up", async () => {
    // One call, not two. Splitting "do you need a tool?" from "answer"
    // was measured at a second and a half of extra wait on every question
    // that needed no tool, because the cost of a turn is how many calls
    // it makes rather than how large they are.
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request, messages } = build({
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("direct")) }],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(1);

    const only = alpha.calls[0]?.request;
    // The answer's schema rides beside the tools (harden 2026-10-01), so an
    // answer here arrives in the shape the call below would ask for.
    expect(only?.output.kind).toBe("STRUCTURED");
    expect(only?.tools.map((t) => t.name)).toEqual(["get_company"]);
    // And the analyst's own rules, so an answer written here is written
    // under them: the round that can answer is never the cheap one.
    // This turn's notes ride in the user tail since company-analyst/v16.
    const prompt = only?.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain(
      "Tools available to you in this conversation: get_company",
    );
    expect(prompt).toContain("never an instruction");
    expect(only?.messages.at(-1)?.content).toContain("LOOK IT UP FIRST");
    // Turn latency row 16: one lookup turn, reads side by side.
    expect(only?.messages.at(-1)?.content).toContain("ONE LOOKUP TURN");
    // Round 5: empty fields are left for code to fill, findings never.
    expect(only?.messages.at(-1)?.content).toContain(
      "every field that would only be empty, null or false",
    );

    expect(tools.executed).toHaveLength(0);
    expect(messages.at(-1)?.content).toBe("direct");
    expect(seam.lastObservation()?.toolsOffered).toEqual(["get_company"]);
  });

  it("executes a proposal, returns the result as a TOOL turn, records the stage, then finishes", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { canonicalName: "Northwind (synthetic)" }),
    );
    const { seam, alpha, request, stages, messages } = build({
      script: [
        call("c1"),
        { kind: "TEXT", text: JSON.stringify(analystResult("with tool")) },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(tools.executed).toEqual([
      { callId: "c1", name: "get_company", arguments: { companyId: "x" } },
    ]);
    const second = alpha.calls[1]?.request.messages ?? [];
    expect(second.map((m) => m.role)).toEqual([
      "SYSTEM",
      "USER",
      // What this run can do, built by code (CQ-QX-008).
      "SYSTEM",
      // Which findings channel the conversation shows.
      "SYSTEM",
      // The order note that puts a lookup before an answer.
      "SYSTEM",
      "ASSISTANT",
      "TOOL",
    ]);
    expect(second[2]?.content).toContain(
      "WHAT YOU CAN DO IN THIS CONVERSATION",
    );
    const toolTurn = second[6];
    expect(toolTurn?.role).toBe("TOOL");
    expect(toolTurn?.content).toContain('"ok":true');
    expect(toolTurn?.content).toContain("Northwind (synthetic)");
    expect(stages).toEqual(["PREPARING_ANALYSIS", "REVIEWING_COMPANY"]);
    expect(messages.at(-1)?.content).toBe("with tool");
    const observation = seam.lastObservation();
    expect(observation?.modelCalls).toBe(2);
    expect(observation?.toolCalls).toEqual([
      {
        toolName: "company.get",
        providerName: "get_company",
        status: "SUCCEEDED",
        failureCode: null,
        latencyMs: 3,
      },
    ]);
  });

  it("runs a round of reads side by side and hands results back in the order proposed (Zino live 2026-10-07)", async () => {
    let inFlight = 0;
    let most = 0;
    const executed: string[] = [];
    const tools: QToolPort = {
      offer: () => Promise.resolve([GET_COMPANY]),
      execute: async (proposal) => {
        executed.push(proposal.callId);
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return succeeded(proposal, { canonicalName: `Co ${proposal.callId}` });
      },
    };
    const { seam, alpha, request } = build({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: ["a", "b", "c"].map((id) => ({
            callId: id,
            name: "get_company",
            arguments: { companyId: id },
          })),
        },
        { kind: "TEXT", text: JSON.stringify(analystResult("Three.")) },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(most).toBe(3);
    expect(executed).toEqual(["a", "b", "c"]);
    const turns = (alpha.calls[1]?.request.messages ?? []).filter(
      (m) => m.role === "TOOL",
    );
    expect(turns.map((m) => /Co (\w)/u.exec(m.content)?.[1])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("writes a round's stage once, beside its reads, not once per read before each (turn latency row 16)", async () => {
    let reading = 0;
    let stageWhileReading = false;
    const tools: QToolPort = {
      offer: () => Promise.resolve([GET_COMPANY]),
      execute: async (proposal) => {
        reading += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        reading -= 1;
        return succeeded(proposal, { canonicalName: `Co ${proposal.callId}` });
      },
    };
    const { seam, request, stages } = build({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: ["a", "b", "c"].map((id) => ({
            callId: id,
            name: "get_company",
            arguments: { companyId: id },
          })),
        },
        call("d"),
        { kind: "TEXT", text: JSON.stringify(analystResult("Four.")) },
      ],
      tools,
    });
    const watched = stages.push.bind(stages);
    stages.push = (...items: string[]) => {
      if (reading > 0) stageWhileReading = true;
      return watched(...items);
    };
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    // Four reads over two rounds, one stage: it never changed (was 4 writes).
    expect(stages.filter((s) => s === "REVIEWING_COMPANY")).toHaveLength(1);
    // The write did not hold the reads back: they were already running.
    expect(stageWhileReading).toBe(true);
  });

  it.each([
    ["a list", ["I need to retrieve your companies first."]],
    // The shape a model actually wrote live: one string, not a list.
    [
      "a string, in the wrong shape",
      "I need to retrieve your companies first.",
    ],
  ])(
    "an answer that describes doing something instead of calling the tool gets one more round (actionTalk as %s; founder live 2026-10-01)",
    async (_label, actionTalk) => {
      const tools = toolPort([GET_COMPANY], (p) =>
        succeeded(p, { canonicalName: "Northwind (synthetic)" }),
      );
      const { seam, alpha, request, messages } = build({
        script: [
          {
            kind: "TEXT",
            text: JSON.stringify({
              ...analystResult("I can list them once I retrieve them."),
              actionTalk,
            }),
          },
          call("c1"),
          { kind: "TEXT", text: JSON.stringify(analystResult("Northwind.")) },
        ],
        tools,
      });
      const outcome = await seam.answer(request);
      expect(outcome.kind).toBe("ANSWERED");
      // The tool was called on the extra round, and the answer is from it.
      expect(tools.executed).toHaveLength(1);
      const second = alpha.calls[1]?.request;
      expect(second?.tools.map((t) => t.name)).toEqual(["get_company"]);
      expect(second?.messages.at(-1)?.content).toContain("instead of doing it");
      expect(messages.at(-1)?.content).toBe("Northwind.");
    },
  );

  // Owner conversation 2026-10-24: asked for three Qatari investors, Q
  // asked "would you like me to do that?" and promised "I'll look for…"
  // with no search. A look-up asked for is done, never offered or promised.
  it("an answer offering to do the look-up it was asked for gets one round to do it", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { canonicalName: "Northwind (synthetic)" }),
    );
    const { seam, alpha, request, messages } = build({
      said: "Find me three Qatari investors for Northwind.",
      script: [
        {
          kind: "TEXT",
          text: JSON.stringify(
            analystResult(
              "I don't have them yet. Want me to find three Qatari investors for Northwind?",
            ),
          ),
        },
        call("c1"),
        {
          kind: "TEXT",
          text: JSON.stringify(analystResult("Here are three: A, B and C.")),
        },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(tools.executed).toHaveLength(1);
    expect(alpha.calls[1]?.request.messages.at(-1)?.content).toContain(
      "do it now",
    );
    expect(messages.at(-1)?.content).toBe("Here are three: A, B and C.");
  });

  it("a promise of a look-up not done is never said, even after the round", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const promise = analystResult(
      "I'll look for three Qatar-based investors. I'll identify named investors first.",
    );
    const { seam, messages, request } = build({
      said: "Just find me three Qatari investors.",
      script: [
        { kind: "TEXT", text: JSON.stringify(promise) },
        { kind: "TEXT", text: JSON.stringify(promise) },
        { kind: "JSON", value: promise },
      ],
      tools,
    });
    await seam.answer(request);
    const said = messages.at(-1)?.content ?? "";
    expect(said).not.toMatch(/I['’]ll (?:look|identify)/u);
    expect(said).toBe(
      "I haven't run that search yet, so I have nothing to show you on it this turn.",
    );
  });

  it("an offer of a new next step, not what was asked, stays", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, messages, request } = build({
      said: "Tell me about Northwind.",
      script: [
        {
          kind: "TEXT",
          text: JSON.stringify(
            analystResult(
              "Northwind builds ledgers. Want me to draft an intro to them?",
            ),
          ),
        },
      ],
      tools,
    });
    await seam.answer(request);
    expect(messages.at(-1)?.content).toBe(
      "Northwind builds ledgers. Want me to draft an intro to them?",
    );
  });

  it("an answer that asks who 'this person' is, on a company's page, gets one more round naming the screen's company (founder live 2026-10-01)", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { canonicalName: "Kazikit (synthetic)" }),
    );
    const company = randomUUID();
    const { seam, alpha, request, messages } = build({
      script: [
        {
          kind: "TEXT",
          text: JSON.stringify({
            ...analystResult("Who should I arrange the meeting with?"),
            clarifyingQuestions: [
              { question: "Who should I arrange the meeting with?", why: "" },
            ],
          }),
        },
        call("c1", { companyId: company }),
        { kind: "TEXT", text: JSON.stringify(analystResult("Kazikit.")) },
      ],
      tools,
    });
    await seam.answer({
      ...request,
      plan: {
        ...request.plan,
        screen: { route: "COMPANY", companyId: company },
      },
    });
    const second = alpha.calls[1]?.request.messages ?? [];
    expect(second.at(-1)?.content).toContain(`the company ${company}`);
    expect(tools.executed).toHaveLength(1);
    expect(messages.at(-1)?.content).toBe("Kazikit.");
  });

  it("keeps a question back when the screen shows nothing in particular", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request } = build({
      script: [
        {
          kind: "TEXT",
          text: JSON.stringify({
            ...analystResult("Which company?"),
            clarifyingQuestions: [{ question: "Which company?", why: "" }],
          }),
        },
      ],
      tools,
    });
    await seam.answer({
      ...request,
      plan: { ...request.plan, screen: { route: "HOME" } },
    });
    expect(alpha.calls).toHaveLength(1);
  });

  it("does not add a round when the answer talks about nothing it should have done", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request } = build({
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("direct")) }],
      tools,
    });
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(1);
  });

  it("hands a denial back to the model as data and never the private material", async () => {
    const tools = toolPort([GET_COMPANY], denied);
    const { seam, alpha, request, logLines } = build({
      script: [
        call("c1"),
        { kind: "TEXT", text: JSON.stringify(analystResult("not available")) },
      ],
      tools,
    });
    await seam.answer(request);
    const toolTurn = alpha.calls[1]?.request.messages[6];
    expect(toolTurn?.content).toContain('"ok":false');
    expect(toolTurn?.content).toContain("NOT_AVAILABLE");
    expect(JSON.stringify(alpha.calls)).not.toContain(PRIVATE);
    expect(logLines.join("\n")).not.toContain(PRIVATE);
    expect(seam.lastObservation()?.toolCalls[0]?.status).toBe("DENIED");
  });

  it("never puts more calls in one round than one assistant message may carry", async () => {
    // QA 2026-10-24 ("show my pipeline"): one call, then nine in the next
    // round -- inside the turn's budget of ten, but the ninth made the
    // next request one the gateway's own schema refuses, and the run failed.
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const nine: FakeBehaviour = {
      kind: "TOOL_CALLS",
      calls: Array.from({ length: MODEL_TOOL_CALLS_MAX + 1 }, (_v, i) => ({
        callId: `n${String(i)}`,
        name: "get_company",
        arguments: { companyId: `n-${String(i)}` },
      })),
    };
    expect(1 + MODEL_TOOL_CALLS_MAX + 1).toBeLessThanOrEqual(
      Q_TOOL_LOOP_MAX_CALLS,
    );
    const { seam, alpha, request } = build({
      script: [
        call("first", { companyId: "first" }),
        nine,
        { kind: "JSON", value: analystResult("capped") },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(tools.executed).toHaveLength(1 + MODEL_TOOL_CALLS_MAX);
    for (const sent of alpha.calls) {
      for (const message of sent.request.messages) {
        if (message.role === "ASSISTANT") {
          expect(message.toolCalls?.length ?? 0).toBeLessThanOrEqual(
            MODEL_TOOL_CALLS_MAX,
          );
        }
      }
    }
  });

  it("bounds rounds and calls, then finishes with one structured call without tools", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    // Each round proposes as many distinct calls as a reply may carry; together
    // they propose more than the turn's budget.
    const many = (round: string): FakeBehaviour => ({
      kind: "TOOL_CALLS",
      calls: Array.from({ length: MODEL_TOOL_CALLS_MAX }, (_v, i) => ({
        callId: `${round}${String(i)}`,
        name: "get_company",
        // Distinct reads: identical concurrent ones share a call (K4).
        arguments: { companyId: `${round}-${String(i)}` },
      })),
    });
    expect(MODEL_TOOL_CALLS_MAX * Q_TOOL_LOOP_MAX_ROUNDS).toBeGreaterThan(
      Q_TOOL_LOOP_MAX_CALLS,
    );
    const { seam, alpha, request } = build({
      script: [
        ...Array.from({ length: Q_TOOL_LOOP_MAX_ROUNDS }, (_v, i) =>
          many(`m${String(i)}`),
        ),
        { kind: "JSON", value: analystResult("bounded") },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    // The rounds proposed more than the budget: the surplus is never executed.
    expect(tools.executed).toHaveLength(Q_TOOL_LOOP_MAX_CALLS);
    expect(alpha.calls).toHaveLength(Q_TOOL_LOOP_MAX_ROUNDS + 1);
    const finalCall = alpha.calls.at(-1)?.request;
    expect(finalCall?.output.kind).toBe("STRUCTURED");
    expect(finalCall?.tools).toEqual([]);

    // One call per round: the round budget ends the loop instead.
    const perRound = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const rounds = build({
      script: [
        // Distinct reads: a read this run already made is kept (2026-10-16).
        ...Array.from({ length: Q_TOOL_LOOP_MAX_ROUNDS }, (_v, i) =>
          call(`r${String(i)}`, { companyId: `r-${String(i)}` }),
        ),
        { kind: "JSON", value: analystResult("rounds") },
      ],
      tools: perRound,
    });
    const second = await rounds.seam.answer(rounds.request);
    expect(second.kind).toBe("ANSWERED");
    expect(perRound.executed).toHaveLength(Q_TOOL_LOOP_MAX_ROUNDS);
    expect(rounds.alpha.calls).toHaveLength(Q_TOOL_LOOP_MAX_ROUNDS + 1);
    expect(rounds.alpha.calls.at(-1)?.request.output.kind).toBe("STRUCTURED");
  });

  it("autopilot P1: a look-up may follow a look-up in the same turn, and the second round may answer at once", async () => {
    expect(Q_TOOL_LOOP_MAX_ROUNDS).toBeGreaterThanOrEqual(2);
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request, messages } = build({
      script: [
        call("first", { companyId: "a" }),
        call("second", { companyId: "b" }),
        { kind: "JSON", value: analystResult("chained") },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(tools.executed.map((one) => one.arguments)).toEqual([
      { companyId: "a" },
      { companyId: "b" },
    ]);
    // The second round still held the tools: it was a real chained step.
    expect(alpha.calls[1]?.request.tools.length).toBeGreaterThan(0);
    expect(messages.at(-1)?.content).toBe("chained");

    // Answered in the second round: no extra tool-less call is paid.
    const quick = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const once = build({
      script: [
        call("only"),
        { kind: "JSON", value: analystResult("answered in round two") },
      ],
      tools: quick,
    });
    expect((await once.seam.answer(once.request)).kind).toBe("ANSWERED");
    expect(once.alpha.calls).toHaveLength(2);
  });

  describe("a note to founders they are not connected with prepares the first contact (owner 2026-10-23)", () => {
    const tool = (name: string, toolName: string): QOfferedTool => ({
      ...GET_COMPANY,
      toolName,
      classification: "SIDE_EFFECT",
      definition: { ...GET_COMPANY.definition, name },
    });
    const CHAT = tool("propose_chat_message", "relationship.chat.propose");
    const INTEREST = tool(
      "propose_express_interest",
      "relationship.interest.express.propose",
    );
    const NOTE = "Hi Anchor team, I'd like a call next week about your API.";
    const run = async (options: {
      chat: "NOT_CONNECTED" | "NOT_AVAILABLE" | "PREPARED";
      interest?: "PREPARED" | "DENIED";
      offerInterest?: boolean;
    }) => {
      const tools = toolPort(
        options.offerInterest === false ? [CHAT] : [CHAT, INTEREST],
        (p) => {
          if (p.name === "propose_chat_message") {
            return options.chat === "NOT_AVAILABLE"
              ? { ...denied(p), toolName: "relationship.chat.propose" }
              : {
                  ...succeeded(p, {
                    status: options.chat,
                    awaitingApprovalOf:
                      options.chat === "PREPARED"
                        ? "Send a message to Anchor"
                        : "Messages open once you're connected with them: interest expressed and accepted.",
                  }),
                  toolName: "relationship.chat.propose",
                };
          }
          return options.interest === "DENIED"
            ? {
                ...denied(p),
                toolName: "relationship.interest.express.propose",
              }
            : {
                ...succeeded(p, {
                  status: "PREPARED",
                  awaitingApprovalOf: "Express interest in Anchor",
                }),
                toolName: "relationship.interest.express.propose",
              };
        },
      );
      const { seam, alpha, request, messages } = build({
        said: "Draft a short note to the founders of Anchor saying I'd like a call next week",
        script: [
          {
            kind: "TOOL_CALLS",
            calls: [
              {
                callId: "c",
                name: "propose_chat_message",
                arguments: { counterpartName: "Anchor", body: NOTE },
              },
            ],
          },
          { kind: "JSON", value: analystResult("prepared") },
        ],
        tools,
      });
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      return {
        executed: tools.executed.map((p) => [p.name, p.arguments]),
        second: JSON.stringify(alpha.calls[1]?.request.messages ?? []),
        reply: messages.at(-1)?.content ?? "",
      };
    };

    // F-91 (QA re-score 24 Oct, run 3a213c7a): the model offered the note
    // instead of calling a message tool, so no first contact was prepared.
    // When the reader read a note as the asked action, the model is told to
    // call it (and the first contact follows the refusal, as below).
    it("tells the model to call the message tool the reader read as asked", async () => {
      const tools = toolPort([CHAT, INTEREST], (p) => ({
        ...succeeded(p, { status: "PREPARED" }),
        toolName: "relationship.chat.propose",
      }));
      const { seam, alpha, request } = build({
        said: "Draft a short note to Basketari's founders asking about their repeat-order rate.",
        script: [{ kind: "JSON", value: analystResult("drafted") }],
        tools,
      });
      await seam.answer({ ...request, askedAction: "propose_chat_message" });
      expect(JSON.stringify(alpha.calls[0]?.request.messages ?? [])).toContain(
        "THEY ASKED FOR A NOTE OR MESSAGE: call propose_chat_message now",
      );
    });

    it("prepares Express Interest in the same turn, for approval, and tells the model so", async () => {
      const { executed, second } = await run({ chat: "NOT_CONNECTED" });
      expect(executed).toEqual([
        ["propose_chat_message", { counterpartName: "Anchor", body: NOTE }],
        // The drafted note travels with the interest, on the same approval.
        ["propose_express_interest", { company: "Anchor", note: NOTE }],
      ]);
      expect(second).toContain("Capital Q prepared the first step");
      expect(second).toContain("Express interest in Anchor");
      expect(second).toContain("The note they asked for goes with it");
      expect(second).toContain("Nothing is sent until they approve");
    });

    it("replies in code's own words: never names a tool or asks permission for what was asked (QO-08)", async () => {
      const { reply } = await run({ chat: "NOT_CONNECTED" });
      expect(reply).toBe(FIRST_CONTACT_REPLY);
      expect(reply).not.toMatch(/tool|want me to|would you like/iu);
      // Nothing prepared by code: the model's own answer stands.
      const { reply: own } = await run({ chat: "PREPARED" });
      expect(own).not.toBe(FIRST_CONTACT_REPLY);
    });

    it("never cuts a note longer than an interest note: the interest goes without it", () => {
      const long = "x".repeat(1001);
      const outcome = succeeded(
        { callId: "c", name: "propose_chat_message", arguments: {} },
        { status: "NOT_CONNECTED" },
      );
      expect(
        firstContactOf(
          {
            name: "propose_chat_message",
            arguments: { counterpartName: "Anchor", body: long },
          },
          outcome,
        ),
      ).toEqual({ company: "Anchor" });
      expect(
        firstContactOf(
          {
            name: "propose_email",
            arguments: { companyId: "c-1", subject: "Hi", body: "  Hello  " },
          },
          outcome,
        ),
      ).toEqual({ companyId: "c-1", note: "Hello" });
    });

    it("does the same when there is no relationship yet (not available)", async () => {
      const { executed } = await run({ chat: "NOT_AVAILABLE" });
      expect(executed.map(([name]) => name)).toEqual([
        "propose_chat_message",
        "propose_express_interest",
      ]);
    });

    it("prepares nothing more when the message itself was prepared", async () => {
      const { executed, second } = await run({ chat: "PREPARED" });
      expect(executed.map(([name]) => name)).toEqual(["propose_chat_message"]);
      expect(second).not.toContain("Capital Q prepared the first step");
    });

    it("says nothing about a first step its own authorize step refused", async () => {
      const { executed, second } = await run({
        chat: "NOT_CONNECTED",
        interest: "DENIED",
      });
      expect(executed.map(([name]) => name)).toContain(
        "propose_express_interest",
      );
      expect(second).not.toContain("Capital Q prepared the first step");
    });

    it("never prepares interest where it is not offered (a founder)", async () => {
      const { executed } = await run({
        chat: "NOT_CONNECTED",
        offerInterest: false,
      });
      expect(executed.map(([name]) => name)).toEqual(["propose_chat_message"]);
    });
  });

  describe("a search that found one company has its profile read by code (turn latency row 16)", () => {
    const SEARCH: QOfferedTool = {
      ...GET_COMPANY,
      toolName: "company.search",
      definition: { ...GET_COMPANY.definition, name: "search_companies" },
      visibleStage: "UNDERSTANDING_REQUEST",
    };
    const found = (...names: readonly string[]) =>
      names.map((name, index) => ({
        companyId: `id-${String(index)}`,
        canonicalName: name,
      }));
    const port = (items: readonly unknown[]) =>
      toolPort([SEARCH, GET_COMPANY], (p) =>
        p.name === "search_companies"
          ? { ...succeeded(p, { items }), toolName: "company.search" }
          : succeeded(p, {
              companyId: (p.arguments as { companyId: string }).companyId,
              canonicalName: "Northwind Ledger",
              currentStageCode: "seed",
            }),
      );
    const search = (query: string): FakeBehaviour => ({
      kind: "TOOL_CALLS",
      calls: [{ callId: "s", name: "search_companies", arguments: { query } }],
    });

    it("answers in the round after the search: 3 model calls become 2", async () => {
      // Before: search round, get_company round, answer = 3 model calls.
      const tools = port(found("Northwind Ledger", "Northwind Ledgerworks"));
      const { seam, alpha, request, messages } = build({
        script: [
          search("Northwind Ledger"),
          { kind: "JSON", value: analystResult("Northwind is at seed.") },
        ],
        tools,
      });
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      expect(alpha.calls).toHaveLength(2);
      expect(tools.executed.map((p) => [p.name, p.arguments])).toEqual([
        ["search_companies", { query: "Northwind Ledger" }],
        ["get_company", { companyId: "id-0" }],
      ]);
      // The profile reached the second round as Capital Q's own read.
      const second = JSON.stringify(alpha.calls[1]?.request.messages);
      expect(second).toContain("Capital Q ran get_company");
      expect(second).toContain("id-0");
      expect(messages.at(-1)?.content).toBe("Northwind is at seed.");
    });

    it("leaves an ambiguous search to the model", async () => {
      const tools = port(found("Northwind", "Northwind Labs"));
      const { seam, alpha, request } = build({
        script: [
          search("north"),
          { kind: "JSON", value: analystResult("Which one?") },
        ],
        tools,
      });
      await seam.answer(request);
      expect(tools.executed.map((p) => p.name)).toEqual(["search_companies"]);
      expect(JSON.stringify(alpha.calls[1]?.request.messages)).not.toContain(
        "Capital Q ran get_company",
      );
    });

    describe("and its published figures beside it (owner 2026-10-23)", () => {
      const FIGURES: QOfferedTool = {
        ...GET_COMPANY,
        toolName: "company.figures.read",
        definition: { ...GET_COMPANY.definition, name: "read_company_figures" },
      };
      const FIGURE = {
        key: "financial.monthly_revenue",
        statement:
          "Monthly recurring revenue was USD 4,800 in September 2026. (Demonstration data, self-reported by the company.)",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        lifecycleStatus: "CURRENT",
      };
      const withFigures = (figures: (p: QToolProposal) => QToolCallOutcome) =>
        toolPort([SEARCH, GET_COMPANY, FIGURES], (p) =>
          p.name === "search_companies"
            ? {
                ...succeeded(p, { items: found("Northwind Ledger") }),
                toolName: "company.search",
              }
            : p.name === "read_company_figures"
              ? figures(p)
              : succeeded(p, {
                  companyId: "id-0",
                  canonicalName: "Northwind Ledger",
                }),
        );

      it("reads the figures with the profile, so the answer round holds both", async () => {
        const tools = withFigures((p) => ({
          ...succeeded(p, {
            companyId: "id-0",
            status: "AVAILABLE",
            figures: [FIGURE],
          }),
          toolName: "company.figures.read",
        }));
        const { seam, alpha, request } = build({
          script: [
            search("Northwind Ledger"),
            { kind: "JSON", value: analystResult("USD 4,800, self-reported.") },
          ],
          tools,
        });
        expect((await seam.answer(request)).kind).toBe("ANSWERED");
        expect(alpha.calls).toHaveLength(2);
        expect(tools.executed.map((p) => [p.name, p.arguments])).toEqual([
          ["search_companies", { query: "Northwind Ledger" }],
          ["get_company", { companyId: "id-0" }],
          ["read_company_figures", { companyId: "id-0" }],
        ]);
        const second = JSON.stringify(alpha.calls[1]?.request.messages);
        expect(second).toContain("Capital Q ran get_company");
        expect(second).toContain("Capital Q ran read_company_figures");
        expect(second).toContain("SELF_REPORTED");
      });

      it("starts both reads before either finishes (no added latency)", async () => {
        let figuresStarted: () => void = () => undefined;
        const started = new Promise<void>((resolve) => {
          figuresStarted = resolve;
        });
        const executed: string[] = [];
        const tools: QToolPort = {
          offer: () => Promise.resolve([SEARCH, GET_COMPANY, FIGURES]),
          execute: async (p) => {
            executed.push(p.name);
            if (p.name === "search_companies") {
              return {
                ...succeeded(p, { items: found("Northwind Ledger") }),
                toolName: "company.search",
              };
            }
            if (p.name === "read_company_figures") {
              figuresStarted();
              return {
                ...succeeded(p, { status: "NONE", figures: [] }),
                toolName: "company.figures.read",
              };
            }
            // The profile finishes only once the figures read has started:
            // a sequential chain would never get there.
            await started;
            return succeeded(p, { companyId: "id-0" });
          },
        };
        const { seam, request } = build({
          script: [
            search("Northwind Ledger"),
            { kind: "JSON", value: analystResult("ok") },
          ],
          tools,
        });
        expect((await seam.answer(request)).kind).toBe("ANSWERED");
        expect(executed).toEqual([
          "search_companies",
          "get_company",
          "read_company_figures",
        ]);
      });

      it("answers from the profile alone when the figures read is denied", async () => {
        const tools = withFigures((p) => ({
          ...denied(p),
          toolName: "company.figures.read",
        }));
        const { seam, alpha, request, messages } = build({
          script: [
            search("Northwind Ledger"),
            { kind: "JSON", value: analystResult("Northwind is at seed.") },
          ],
          tools,
        });
        expect((await seam.answer(request)).kind).toBe("ANSWERED");
        expect(alpha.calls).toHaveLength(2);
        const second = JSON.stringify(alpha.calls[1]?.request.messages);
        expect(second).toContain("Capital Q ran get_company");
        expect(second).not.toContain("Capital Q ran read_company_figures");
        expect(messages.at(-1)?.content).toBe("Northwind is at seed.");
      });

      it("never reads the figures twice when the model asks for them anyway", async () => {
        const tools = withFigures((p) => ({
          ...succeeded(p, { status: "NONE", figures: [] }),
          toolName: "company.figures.read",
        }));
        const { seam, request } = build({
          script: [
            search("Northwind Ledger"),
            {
              kind: "TOOL_CALLS",
              calls: [
                {
                  callId: "f",
                  name: "read_company_figures",
                  arguments: { companyId: "id-0" },
                },
              ],
            },
            { kind: "JSON", value: analystResult("none published") },
          ],
          tools,
        });
        expect((await seam.answer(request)).kind).toBe("ANSWERED");
        expect(
          tools.executed.filter((p) => p.name === "read_company_figures"),
        ).toHaveLength(1);
      });
    });

    it("a company the turn names has its published figures ready before the model is asked", async () => {
      const FIGURES: QOfferedTool = {
        ...GET_COMPANY,
        toolName: "company.figures.read",
        definition: { ...GET_COMPANY.definition, name: "read_company_figures" },
      };
      const statement =
        "Monthly recurring revenue was USD 6,500 in September 2026. (Demonstration data, self-reported by the company.)";
      const tools = toolPort([SEARCH, GET_COMPANY, FIGURES], (p) =>
        p.name === "search_companies"
          ? {
              ...succeeded(p, { items: found("Northwind Ledger") }),
              toolName: "company.search",
            }
          : p.name === "read_company_figures"
            ? {
                ...succeeded(p, {
                  companyId: "id-0",
                  status: "AVAILABLE",
                  figures: [
                    {
                      key: "financial.monthly_revenue",
                      statement,
                      truthClass: "USER_CLAIM",
                      evidenceStatus: "SELF_REPORTED",
                      lifecycleStatus: "CURRENT",
                    },
                  ],
                }),
                toolName: "company.figures.read",
              }
            : succeeded(p, {
                companyId: "id-0",
                canonicalName: "Northwind Ledger",
              }),
      );
      const { seam, alpha, request } = build({
        said: "What is Northwind Ledger's revenue?",
        script: [{ kind: "JSON", value: analystResult("USD 6,500 a month.") }],
        tools,
      });
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      expect(tools.executed.map((p) => p.name)).toContain(
        "read_company_figures",
      );
      const first = JSON.stringify(alpha.calls[0]?.request.messages);
      expect(first).toContain(
        "Northwind Ledger, as the company states it: Monthly recurring revenue was USD 6,500",
      );
      expect(first).toContain("SELF_REPORTED");
    });

    describe("Capital Q, the company on its own platform (owner 2026-10-23)", () => {
      const FIGURES: QOfferedTool = {
        ...GET_COMPANY,
        toolName: "company.figures.read",
        definition: { ...GET_COMPANY.definition, name: "read_company_figures" },
      };
      const REVENUE =
        "Monthly recurring revenue was USD 4,800 in September 2026. (Demonstration data, self-reported by the company.)";
      const capitalQ = (relationToYou: "SHARED" | "OWN") =>
        toolPort([SEARCH, GET_COMPANY, FIGURES], (p) =>
          p.name === "search_companies"
            ? {
                ...succeeded(p, {
                  items: [{ companyId: "cq", canonicalName: "Capital Q" }],
                }),
                toolName: "company.search",
              }
            : p.name === "read_company_figures"
              ? {
                  ...succeeded(p, {
                    companyId: "cq",
                    status: "AVAILABLE",
                    figures: [
                      {
                        key: "financial.monthly_revenue",
                        statement: REVENUE,
                        truthClass: "USER_CLAIM",
                        evidenceStatus: "SELF_REPORTED",
                        lifecycleStatus: "CURRENT",
                      },
                    ],
                  }),
                  toolName: "company.figures.read",
                }
              : succeeded(p, {
                  companyId: "cq",
                  canonicalName: "Capital Q",
                  relationToYou,
                }),
        );
      const ask = async (
        said: string,
        options: { investor: boolean; relation?: "SHARED" | "OWN" },
      ) => {
        const tools = capitalQ(options.relation ?? "SHARED");
        const { seam, alpha, request } = build({
          said,
          investor: options.investor,
          script: [{ kind: "JSON", value: analystResult("answered") }],
          tools,
        });
        expect((await seam.answer(request)).kind).toBe("ANSWERED");
        return {
          searched: tools.executed
            .filter((p) => p.name === "search_companies")
            .map((p) => (p.arguments as { query: string }).query),
          first: JSON.stringify(alpha.calls[0]?.request),
        };
      };

      it("an investor asking about Capital Q's revenue gets the company's own figures", async () => {
        const { searched, first } = await ask("What is Capital Q's revenue?", {
          investor: true,
        });
        expect(searched).toContain("Capital Q");
        expect(first).toContain("Capital Q, as the company states it");
        expect(first).toContain("USD 4,800");
        expect(first).toContain("CAPITAL Q THE COMPANY");
        expect(first).toContain(
          "If you meant the Capital Q platform itself, I can explain how it works.",
        );
      });

      it("a member of Capital Q's own team keeps the platform reading", async () => {
        const { first } = await ask("Tell me about Capital Q", {
          investor: true,
          relation: "OWN",
        });
        expect(first).not.toContain("CAPITAL Q THE COMPANY");
      });

      it("a founder never looks Capital Q up as a company", async () => {
        const { searched, first } = await ask("Tell me about Capital Q", {
          investor: false,
        });
        expect(searched).not.toContain("Capital Q");
        expect(first).not.toContain("CAPITAL Q THE COMPANY");
      });

      it("a question about using the platform keeps the platform reading, even for an investor", async () => {
        const { searched, first } = await ask("How does Capital Q work?", {
          investor: true,
        });
        expect(searched).not.toContain("Capital Q");
        expect(first).not.toContain("CAPITAL Q THE COMPANY");
      });
    });

    it("never reads the profile twice when the model asks for it anyway", async () => {
      const tools = port(found("Northwind Ledger"));
      const { seam, request } = build({
        script: [
          search("Northwind Ledger"),
          call("again", { companyId: "id-0" }),
          { kind: "JSON", value: analystResult("seed") },
        ],
        tools,
      });
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      expect(
        tools.executed.filter((p) => p.name === "get_company"),
      ).toHaveLength(1);
    });
  });

  it("takes the conversation the turn already read instead of reading it again (turn latency row 5)", async () => {
    const { seam, alpha, request, messages } = build({
      script: [{ kind: "JSON", value: analystResult("ok") }],
    });
    const first = messages[0];
    if (first === undefined) throw new Error("fixture");
    const asked = { ...first, content: "From the turn's own read." };
    await seam.answer({ ...request, history: [asked] });
    const prompt = JSON.stringify(alpha.calls[0]?.request.messages);
    expect(prompt).toContain("From the turn's own read.");
    expect(prompt).not.toContain("Tell me about my company.");
  });

  it("logs where the answer's output went, as counts only (round 5)", async () => {
    const { seam, request, logLines } = build({
      script: [{ kind: "JSON", value: analystResult("A private answer.") }],
    });
    await seam.answer(request);
    const produced = logLines.find((line) =>
      line.includes("q answer produced"),
    );
    expect(produced).toContain('"outputSplit":{"total":');
    expect(produced).not.toContain("A private answer.");
  });

  it.each(["JSON", "TEXT"] as const)(
    "accepts an answer that leaves its empty fields out (%s; round 5)",
    async (kind) => {
      const minimum = {
        answer: "Seed stage, by its own account.",
        responseShape: "CONCISE",
        insufficientEvidence: false,
      };
      const { seam, request, alpha, messages } = build({
        script: [
          kind === "JSON"
            ? { kind: "JSON", value: minimum }
            : { kind: "TEXT", text: JSON.stringify(minimum) },
        ],
      });
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      // No second call was needed to repair it.
      expect(alpha.calls).toHaveLength(1);
      expect(messages.at(-1)?.content).toBe("Seed stage, by its own account.");
    },
  );

  it("shows each finding as it is written, under the id the message keeps (round 5, lane 3)", async () => {
    const finding = (statement: string, type: string) => ({
      type,
      statement,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      confidence: "MODERATE",
      basis: ["F1"],
    });
    const { seam, request, live, completed } = build({
      script: [
        {
          kind: "JSON",
          value: {
            ...analystResult("Northwind declares a seed stage."),
            findings: [
              finding("Revenue grew 40% last year.", "FACT"),
              finding("Runway is not stated.", "RISK"),
            ],
          },
        },
      ],
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    // Both shown live, before the completed message.
    expect(live).toHaveLength(2);
    expect(live.every((one) => one.before === 0)).toBe(true);
    const liveFindings = live.map(
      (one) =>
        (one.payload as { finding: { findingId: string; statement: string } })
          .finding,
    );
    expect(liveFindings.map((f) => f.statement)).toEqual([
      "Revenue grew 40% last year.",
      "Runway is not stated.",
    ]);
    // The completed message's FINDING blocks carry the same ids.
    const blocks =
      (
        completed[0] as {
          message: {
            blocks?: { kind: string; finding?: { findingId: string } }[];
          };
        }
      ).message.blocks ?? [];
    const finalIds = blocks
      .filter((block) => block.kind === "FINDING")
      .map((block) => block.finding?.findingId);
    expect(finalIds).toEqual(liveFindings.map((f) => f.findingId));
  });

  it("never shows an invalid finding early; the message stays authoritative", async () => {
    const { seam, request, live } = build({
      script: [
        {
          kind: "JSON",
          value: {
            ...analystResult("Answer."),
            findings: [{ statement: "No type or labels." }],
          },
        },
      ],
    });
    await seam.answer(request);
    expect(live).toHaveLength(0);
  });

  it("what Q knows, Q knows: a later turn's same read is not made again; 'check again' reads anew", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { canonicalName: "Northwind", relationToYou: "SHARED" }),
    );
    const { seam, request, messages } = build({
      script: [
        call("first", { companyId: "n" }),
        { kind: "JSON", value: analystResult("Seed stage.") },
        call("second", { companyId: "n" }),
        { kind: "JSON", value: analystResult("Runway is not stated.") },
        call("third", { companyId: "n" }),
        { kind: "JSON", value: analystResult("Still seed.") },
      ],
      tools,
    });
    const turn = async (said: string) => {
      const first = messages[0];
      if (first === undefined) throw new Error("fixture");
      messages[0] = { ...first, content: said };
      return seam.answer({
        ...request,
        runId: randomUUID() as typeof request.runId,
      });
    };
    expect((await turn("tell me about Northwind")).kind).toBe("ANSWERED");
    expect((await turn("what's their runway?")).kind).toBe("ANSWERED");
    // The second turn's read came from what was already read.
    expect(tools.executed.filter((p) => p.name === "get_company")).toHaveLength(
      1,
    );
    expect((await turn("check again: what stage are they at?")).kind).toBe(
      "ANSWERED",
    );
    expect(tools.executed.filter((p) => p.name === "get_company")).toHaveLength(
      2,
    );
  });

  it("repairs a non-JSON text answer with a final structured call", async () => {
    const tools = toolPort([GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, alpha, request, messages } = build({
      script: [
        { kind: "TEXT", text: "I would rather chat in prose." },
        { kind: "JSON", value: analystResult("repaired") },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(2);
    // Parity eval 2026-10-02: a refused structured round is asked again in
    // text with the tools kept (a model that meant to act still can); its
    // answer is accepted by the same schema.
    expect(alpha.calls[1]?.request.output.kind).toBe("TEXT");
    expect(alpha.calls[1]?.request.tools.length).toBeGreaterThan(0);
    expect(messages.at(-1)?.content).toBe("repaired");
  });

  it("stops after tool execution when the run was cancelled", async () => {
    const controller = new AbortController();
    const tools = toolPort([GET_COMPANY], (p) => {
      controller.abort();
      return succeeded(p, {});
    });
    const { seam, alpha, request } = build({
      script: [call("c1"), { kind: "JSON", value: analystResult("never") }],
      tools,
    });
    const outcome = await seam.answer({
      ...request,
      signal: controller.signal,
    });
    expect(outcome).toEqual({
      kind: "FAILED",
      diagnosticCode: "RUN_CANCELLED",
    });
    expect(alpha.calls).toHaveLength(1);
  });
});

describe("use_capability: a tool outside the turn's focus, loaded and called in the same turn (lead 2026-10-04)", () => {
  const USE_CAPABILITY: QOfferedTool = {
    toolName: "q.capability.use",
    toolVersion: 1,
    classification: "READ_ONLY",
    definition: {
      name: "use_capability",
      description: "Loads a tool.",
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  };
  const PROPOSE_MEETING: QOfferedTool = {
    toolName: "relationship.meeting.propose",
    toolVersion: 1,
    classification: "SIDE_EFFECT",
    definition: {
      name: "propose_meeting",
      description: "Prepares a meeting.",
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  };
  const port = (available: readonly QOfferedTool[], loads: string[]) => {
    const executed: { name: string; focusTools: readonly string[] }[] = [];
    const tools: QToolPort = {
      offer: () => Promise.resolve([USE_CAPABILITY, GET_COMPANY]),
      available: () => Promise.resolve(available),
      execute: (proposal, context) => {
        executed.push({
          name: proposal.name,
          focusTools: context.focus?.tools ?? [],
        });
        return Promise.resolve(
          succeeded(
            proposal,
            proposal.name === "use_capability"
              ? {
                  loaded: loads.map((name) => ({ name, does: "" })),
                  message: "Loaded.",
                }
              : { status: "PREPARED" },
          ),
        );
      },
    };
    return { tools, executed };
  };
  const script = (): FakeBehaviour[] => [
    {
      kind: "TOOL_CALLS",
      calls: [
        {
          callId: "u1",
          name: "use_capability",
          arguments: { need: "book a call" },
        },
      ],
    },
    {
      kind: "TOOL_CALLS",
      calls: [{ callId: "m1", name: "propose_meeting", arguments: {} }],
    },
    { kind: "TEXT", text: JSON.stringify(analystResult("Prepared.")) },
  ];

  it("loads it for the next step, then executes it in the same turn", async () => {
    const { tools, executed } = port(
      [USE_CAPABILITY, GET_COMPANY, PROPOSE_MEETING],
      ["propose_meeting"],
    );
    const { seam, alpha, request, logLines } = build({
      script: script(),
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    // Sent in one stable name order (K7: the cached prefix holds).
    expect(alpha.calls[0]?.request.tools.map((t) => t.name)).toEqual([
      "get_company",
      "use_capability",
    ]);
    expect(alpha.calls[1]?.request.tools.map((t) => t.name)).toEqual([
      "get_company",
      "propose_meeting",
      "use_capability",
    ]);
    expect(executed.map((e) => e.name)).toEqual([
      "use_capability",
      "propose_meeting",
    ]);
    // Executed under a focus that names it, as a named tool would be.
    expect(executed[1]?.focusTools).toContain("propose_meeting");
    expect(logLines.some((line) => line.includes("q.capability_loaded"))).toBe(
      true,
    );
  });

  it("never loads a tool the run's available list does not hold", async () => {
    // The loader names it, but the plan does not allow it: not offered.
    const { tools, executed } = port(
      [USE_CAPABILITY, GET_COMPANY],
      ["propose_meeting"],
    );
    const { seam, alpha, request } = build({ script: script(), tools });
    await seam.answer(request);
    for (const attempt of alpha.calls) {
      expect(attempt.request.tools.map((t) => t.name)).not.toContain(
        "propose_meeting",
      );
    }
    expect(executed.at(-1)?.focusTools ?? []).not.toContain("propose_meeting");
  });
});

describe("approval by conversation (live 2026-09-27 #1, #2)", () => {
  const APPROVE: QOfferedTool = {
    toolName: "proposal.pending.approve",
    toolVersion: 1,
    classification: "SIDE_EFFECT",
    definition: {
      name: "approve_pending_proposal",
      description: "Approves the one change waiting for their decision.",
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  };
  const approveCall: FakeBehaviour = {
    kind: "TOOL_CALLS",
    calls: [
      {
        callId: "a1",
        name: "approve_pending_proposal",
        arguments: { proposalId: "p-1" },
      },
    ],
  };
  const result = (outcome: string, status: string | null) => ({
    outcome,
    proposal:
      status === null
        ? null
        : { proposalId: "p-1", summary: "Headline", status },
    pending: [],
  });

  const answerAfter = async (data: unknown, text: string) => {
    const tools = toolPort([APPROVE], (p) => ({
      ...succeeded(p, data),
      toolName: "proposal.pending.approve",
      classification: "SIDE_EFFECT",
    }));
    const { seam, request, messages } = build({
      script: [
        approveCall,
        { kind: "TEXT", text: JSON.stringify(analystResult(text)) },
      ],
      tools,
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(tools.executed.map((p) => p.name)).toEqual([
      "approve_pending_proposal",
    ]);
    return messages.at(-1)?.content ?? "";
  };

  it("says saved only from the tool's SAVED result", async () => {
    const saved = await answerAfter(
      result("SAVED", "SAVED"),
      "Anything else for your profile?",
    );
    expect(saved.startsWith("Saved.")).toBe(true);

    const lapsed = await answerAfter(
      result("EXPIRED", "EXPIRED"),
      "Anything else for your profile?",
    );
    expect(lapsed).toMatch(/^Not saved/);
    expect(lapsed).not.toMatch(/^Saved/);

    const repeat = await answerAfter(
      result("ALREADY_DECIDED", "SAVED"),
      "Anything else?",
    );
    expect(repeat.startsWith("Already saved.")).toBe(true);
  });

  it("adds no status when nothing was approved, leaving the question to the model", async () => {
    const none = await answerAfter(
      result("SEVERAL_PENDING", null),
      "Which one do you want to approve?",
    );
    expect(none).toBe("Which one do you want to approve?");
  });
});

// RECOVERY-2026-10 G-D3: "I've prepared that reminder for you to approve."
// after a propose_* round failed the whole turn and lost the proposal.
// Prepared-but-not-executed is truthful when a proposal exists this turn.
describe("a natural answer after a proposal (G-D3)", () => {
  const PROPOSE_REMINDER: QOfferedTool = {
    toolName: "schedule.reminder.propose",
    toolVersion: 1,
    classification: "SIDE_EFFECT",
    definition: {
      name: "propose_reminder",
      description: "Prepares a reminder for their approval.",
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  };
  const proposed = (proposal: QToolProposal): QToolCallOutcome => ({
    ...succeeded(proposal, { status: "PREPARED" }),
    toolName: "schedule.reminder.propose",
    classification: "SIDE_EFFECT",
  });

  it.each([
    ["I've prepared that reminder for you to approve.", true],
    ["I've prepared that reminder for you to approve.", false],
    ["I've set up the reminder for tomorrow; approve it on the card.", false],
  ])(
    "%j (marked as action talk: %s) keeps the turn and the proposal",
    async (said, marked) => {
      const tools = toolPort([PROPOSE_REMINDER], proposed);
      const { seam, request, messages } = build({
        script: [
          {
            kind: "TOOL_CALLS",
            calls: [
              {
                callId: "r1",
                name: "propose_reminder",
                arguments: { title: "Call Savanna Seed", remindAt: "tomorrow" },
              },
            ],
          },
          {
            kind: "TEXT",
            text: JSON.stringify(
              marked
                ? { ...analystResult(said), actionTalk: [said] }
                : analystResult(said),
            ),
          },
        ],
        tools,
      });
      const outcome = await seam.answer(request);
      expect(outcome.kind).toBe("ANSWERED");
      expect(tools.executed.map((p) => p.name)).toEqual(["propose_reminder"]);
      // Something truthful about the waiting card is said, never "done".
      const answer = messages.at(-1)?.content ?? "";
      expect(messages.at(-1)?.role).toBe("Q");
      expect(answer.length).toBeGreaterThan(0);
      expect(answer).not.toMatch(/\b(?:is now set|has been set|done)\b/iu);
    },
  );
});

describe("compound fit questions retain the synthesis path", () => {
  it.each([
    ["Which companies fit my mandate?", "FIT", false],
    [
      "Which companies have we discussed recently that fit my mandate, what did your agents find, and which unresolved risks remain?",
      "THEIR_OWN_RECORDS",
      true,
    ],
    [
      "Which companies fit my mandate and what did Q learn about them?",
      "THEIR_OWN_RECORDS",
      true,
    ],
    [
      "Which companies fit my mandate and what are their weaknesses?",
      "THEIR_OWN_RECORDS",
      true,
    ],
  ] as const)(
    "reuses authorized computed fit reads for %s (%s), synthesis=%s",
    async (text, questionKind, compound) => {
      const companyId = randomUUID();
      const investorOrganisationId = randomUUID();
      const topOffer: QOfferedTool = {
        ...GET_COMPANY,
        toolName: "fit.top_candidates",
        definition: { ...GET_COMPANY.definition, name: "fit_top_candidates" },
      };
      const profileOffer: QOfferedTool = {
        ...topOffer,
        toolName: "fit.profile",
        definition: { ...topOffer.definition, name: "fit_profile" },
      };
      const fit = fitFixture(
        companyId,
        "Selected Company",
        { STAGE: "STRONG" },
        "STRONG_FIT",
      );
      const data = fit.result.data as { name: string; profile: unknown };
      const tools = toolPort([topOffer, profileOffer], (proposal) => ({
        ...succeeded(proposal, {
          status: "OK",
          comparison: {
            entries: [{ name: data.name, line: null, profile: data.profile }],
          },
        }),
        toolName: "fit.top_candidates",
      }));
      const answer =
        "The reviewer revised the memo; unresolved evidence remains unknown.";
      const { seam, request, messages, completed, alpha } = build({
        tools,
        script: [{ kind: "TEXT", text: JSON.stringify(analystResult(answer)) }],
      });
      if (messages[0]) messages[0] = { ...messages[0], content: text };
      const bound = {
        ...request,
        plan: PermittedContextPlanSchema.parse({
          ...request.plan,
          scopes: [
            {
              kind: "INVESTOR_MANDATE",
              contextLabel: "investor_private",
              sensitivity: "CONFIDENTIAL",
              layer: "STRUCTURED_STATE",
              factCategories: ["INVESTOR_THESIS"],
              projection: "FULL",
              rights: {
                canUseForReasoning: true,
                canDiscloseExistence: true,
                canQuote: true,
                canProvideLink: false,
              },
              filter: { tenantId: TENANT, investorOrganisationId },
              isEvidence: true,
              subject: {
                kind: "INVESTOR_ORGANISATION",
                investorOrganisationId,
              },
            },
          ],
        }),
      };
      // The same authorized plan is prepared before the actual reading.
      if (!seam.warm) throw new Error("Warm seam missing");
      seam.warm(bound);
      await seam.answer({ ...bound, questionKind });
      expect(
        tools.executed.filter((p) => p.name === "fit_top_candidates"),
      ).toHaveLength(1);
      expect(alpha.calls).toHaveLength(compound ? 1 : 0);
      if (compound) expect(JSON.stringify(completed)).toContain(answer);
    },
  );
});

/**
 * S3a (live 2026-10-15 on #107): a company the turn names, read ahead of
 * the model, was looked up again because the note said to resolve it.
 * Once its authorised profile is in hand, the note says so, with its id.
 */
describe("a named company read ahead of the model is not looked up again", () => {
  const SEARCH: QOfferedTool = {
    ...GET_COMPANY,
    toolName: "company.search",
    definition: { ...GET_COMPANY.definition, name: "search_companies" },
  };
  it.each([false, true])(
    "aboutNamedOther=%s: the note names the read profile and drops the lookup instruction",
    async (aboutNamedOther) => {
      const target = randomUUID();
      const tools = toolPort([SEARCH, GET_COMPANY], (p) =>
        p.name === "search_companies"
          ? {
              ...succeeded(p, {
                items: [
                  {
                    companyId: target,
                    canonicalName: "Northwind Ledger",
                    currentStageCode: "seed",
                    headquartersCountry: null,
                    shortDescription: null,
                  },
                ],
                nextCursor: null,
                truthClass: "USER_CLAIM",
              }),
              toolName: "company.search",
            }
          : succeeded(p, {
              companyId: target,
              canonicalName: "Northwind Ledger",
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
            }),
      );
      const { seam, request, messages, alpha } = build({
        tools,
        script: [
          {
            kind: "TEXT",
            text: JSON.stringify(
              analystResult("Northwind Ledger declares a seed stage."),
            ),
          },
        ],
      });
      if (messages[0])
        messages[0] = {
          ...messages[0],
          content: "What are the risks with Northwind Ledger?",
        };
      await seam.answer({ ...request, aboutNamedOther });
      const prompt = JSON.stringify(alpha.calls[0]?.request);
      expect(prompt).toContain(
        "Already read for this turn through get_company",
      );
      expect(prompt).toContain(`Northwind Ledger (company id ${target})`);
      expect(prompt).not.toContain(
        "Resolve the company named in the current question through search_companies and get_company before answering",
      );
      // Read once, ahead of the model; the model was not asked to look again.
      expect(
        tools.executed.filter((p) => p.name === "get_company"),
      ).toHaveLength(1);
    },
  );
});

/**
 * S3 (live 2026-10-15 run f854c339, a GateQ dossier question): on a screen
 * focused on one record the wide reads start when the turn is warmed,
 * beside the readers, rather than after the reading.
 */
describe("wide reads start at warm on a focused screen or a named company", () => {
  const SEARCH: QOfferedTool = {
    ...GET_COMPANY,
    toolName: "company.search",
    definition: { ...GET_COMPANY.definition, name: "search_companies" },
  };
  it.each([
    [true, "What are the risks with Northwind Ledger?", true],
    // Owner 2026-10-21: a named company is read while the turn is read.
    [false, "What are the risks with Northwind Ledger?", true],
    [false, "what should I focus on today?", false],
  ] as const)("focused=%s, %s", async (focused, said, early) => {
    const tools = toolPort([SEARCH, GET_COMPANY], (p) =>
      succeeded(p, { items: [], nextCursor: null, truthClass: "USER_CLAIM" }),
    );
    const { seam, request, messages } = build({
      tools,
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("Noted.")) }],
    });
    if (messages[0])
      messages[0] = {
        ...messages[0],
        content: said,
      };
    const bound = {
      ...request,
      plan: {
        ...request.plan,
        screen: {
          route: "OTHER" as const,
          ...(focused
            ? {
                manifest: {
                  v: 2,
                  seq: 1,
                  focus: { kind: "GATEQ_APPLICATION", id: randomUUID() },
                  inView: [],
                  dialogs: [],
                  controls: [],
                  sections: [],
                },
              }
            : {}),
        },
      },
    } as typeof request;
    if (!seam.warm) throw new Error("Warm seam missing");
    seam.warm(bound);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = tools.executed.filter(
      (p) => p.name === "search_companies",
    ).length;
    expect(before > 0).toBe(early);
    await seam.answer(bound);
    // Read once either way: the warm read is the one the answer takes.
    expect(
      tools.executed.filter((p) => p.name === "search_companies"),
    ).toHaveLength(early ? 1 : 0);
  });
});

/**
 * S6 (live 2026-10-15 run ddf0738b, a GateQ dossier review): the screen's
 * own reads -- here the selected application's summarise -- start from the
 * run's tool set, beside context assembly, not after it; and are read once.
 */
describe("the selected dossier is read beside context assembly", () => {
  const SUMMARISE: QOfferedTool = {
    ...GET_COMPANY,
    toolName: "app.gateq.inbox.summarise",
    definition: { ...GET_COMPANY.definition, name: "gateq_inbox_summarise" },
  };
  it("starts before assembly settles and is read once", async () => {
    const tools = toolPort([SUMMARISE], (p) =>
      succeeded(p, { status: "NOT_DONE", says: "Not in your inbox." }),
    );
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let assembling = 0;
    const context: QAuthorisedContextPort = {
      assemble: async (request) => {
        assembling += 1;
        await held;
        return noAuthorisedContext.assemble(request);
      },
    };
    const { seam, request } = build({
      tools,
      context,
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("Noted.")) }],
    });
    const applicationId = randomUUID();
    const bound = {
      ...request,
      plan: {
        ...request.plan,
        screen: {
          route: "OTHER" as const,
          manifest: {
            v: 2,
            seq: 1,
            focus: { kind: "GATEQ_APPLICATION", id: applicationId },
            inView: [],
            dialogs: [],
            controls: [],
            sections: [],
          },
        },
      },
    } as typeof request;
    const answered = seam.answer(bound);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(assembling).toBe(1);
    // Assembly is still held: the summarise has already been asked.
    expect(
      tools.executed.filter((p) => p.name === "gateq_inbox_summarise"),
    ).toEqual([expect.objectContaining({ arguments: { applicationId } })]);
    release();
    await answered;
    expect(
      tools.executed.filter((p) => p.name === "gateq_inbox_summarise"),
    ).toHaveLength(1);
  });

  it.each([
    ["the dossier read", true, "PREPARED_CONTEXT", 0],
    ["the dossier refused", false, "DEEP_ANALYSIS", 1],
  ] as const)(
    "a review of %s routes over it with no tools, or keeps the full path",
    async (_label, read, path, toolsOffered) => {
      const applicationId = randomUUID();
      const tools = toolPort([SUMMARISE], (p) =>
        succeeded(
          p,
          read
            ? {
                status: "DONE",
                says: "Read the application.",
                reading: {
                  v: 1,
                  subject: {
                    kind: "GATEQ_SUBMISSION",
                    gatewayId: randomUUID(),
                    applicationId,
                    reference: "ga_submitted",
                    submittedAt: "2026-10-14T13:12:00.000Z",
                    dossierSchemaVersion: "gateq-dossier.v1",
                  },
                  text: "Customers pay by the litre [truth=USER_CLAIM]",
                  sources: [],
                },
              }
            : { status: "NOT_DONE", says: "Not in your inbox." },
        ),
      );
      const { seam, request, logLines } = build({
        tools,
        script: [
          { kind: "TEXT", text: JSON.stringify(analystResult("Noted.")) },
        ],
      });
      const bound = {
        ...request,
        turnKind: "QUESTION_TO_Q",
        questionKind: "ADVICE",
        research: Promise.resolve({
          mode: "EXPLICIT",
          announceSourceChange: false,
        }),
        plan: {
          ...request.plan,
          screen: {
            route: "OTHER" as const,
            manifest: {
              v: 2,
              seq: 1,
              focus: { kind: "GATEQ_APPLICATION", id: applicationId },
              inView: [],
              dialogs: [],
              controls: [],
              sections: [],
            },
          },
        },
      } as typeof request;
      await seam.answer(bound);
      const logged = logLines
        .map((line) => JSON.parse(line) as [Record<string, unknown>, string])
        .find(([, message]) => message === "q answer path");
      expect(logged?.[0]).toMatchObject({ path, tools: toolsOffered });
    },
  );
});

/**
 * Lane S 2026-10-15 (lane A): "put those three in a table" after an answer
 * is a re-render: no public-web tool is offered and none is run, even when
 * the turn's reading asked for research.
 */
describe("a re-render ask never reaches the public web", () => {
  const WEB: QOfferedTool = {
    ...GET_COMPANY,
    toolName: "public_web.search",
    definition: { ...GET_COMPANY.definition, name: "research_public_web" },
  };
  it.each([
    ["put those three in a table", 1],
    ["What are the risks with Northwind Ledger?", 2],
  ] as const)("%s -> %s tools offered", async (said, offeredCount) => {
    const tools = toolPort([WEB, GET_COMPANY], (p) => succeeded(p, {}));
    const { seam, request, messages, logLines } = build({
      tools,
      script: [{ kind: "TEXT", text: JSON.stringify(analystResult("Noted.")) }],
    });
    const first = messages[0];
    if (first === undefined) throw new Error("fixture");
    messages.splice(
      0,
      1,
      { ...first, content: "Which three companies fit my mandate?" },
      {
        ...first,
        id: randomUUID() as QConversationMessage["id"],
        role: "Q",
        content: "Ledgerfold, Baridi and Maji Loop fit best.",
      },
      {
        ...first,
        id: randomUUID() as QConversationMessage["id"],
        content: said,
      },
    );
    await seam.answer({
      ...request,
      turnKind: "QUESTION_TO_Q",
      research: Promise.resolve({
        mode: "EXPLICIT",
        announceSourceChange: false,
      }),
    });
    const path = logLines
      .map((line) => JSON.parse(line) as [Record<string, unknown>, string])
      .find(([, message]) => message === "q answer path");
    expect(path?.[0]).toMatchObject({ tools: offeredCount });
    if (offeredCount === 1) {
      expect(tools.executed.some((p) => p.name === "research_public_web")).toBe(
        false,
      );
    }
  });
});

describe("findings and cards written beside the answer (owner 2026-10-22)", () => {
  const finding = (statement: string) => ({
    type: "FACT",
    statement,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    basis: ["F1"],
  });
  const findingBlocks = (completed: readonly unknown[]): string[] =>
    (
      (
        completed[0] as {
          message: {
            blocks?: { kind: string; finding?: { statement: string } }[];
          };
        }
      ).message.blocks ?? []
    )
      .filter((block) => block.kind === "FINDING")
      .map((block) => block.finding?.statement ?? "");

  it("is off unless switched on: one call writes both", async () => {
    const { seam, alpha, request } = build({
      script: [{ kind: "JSON", value: analystResult("Answer.") }],
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(1);
    const prompt = alpha.calls[0]?.request.messages
      .map((m) => m.content)
      .join("\n");
    expect(prompt).not.toContain("A second writer");
  });

  it("a second call writes the findings from the same messages, and they join the answer", async () => {
    const { seam, alpha, request, completed, live } = build({
      script: [
        {
          kind: "JSON",
          value: analystResult("Northwind declares a seed stage."),
        },
        {
          kind: "JSON",
          value: {
            ...analystResult("Seed stage."),
            findings: [finding("Northwind declares a seed stage.")],
          },
        },
      ],
      parallelExtras: true,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(2);
    const [answerCall, extrasCall] = alpha.calls.map((c) => c.request);
    const answerPrompt = answerCall?.messages.map((m) => m.content).join("\n");
    const extrasPrompt = extrasCall?.messages.map((m) => m.content).join("\n");
    expect(answerPrompt).toContain("A second writer");
    expect(answerPrompt).not.toContain("Another writer");
    expect(extrasPrompt).toContain("Another writer");
    expect(extrasPrompt).not.toContain("A second writer");
    // Everything else the two writers read is the same.
    expect(extrasCall?.messages.slice(0, -1)).toEqual(
      answerCall?.messages.filter(
        (m) => !m.content.includes("A second writer"),
      ),
    );
    expect(findingBlocks(completed)).toEqual([
      "Northwind declares a seed stage.",
    ]);
    // Shown as written, before the message.
    expect(live).toHaveLength(1);
    expect(live[0]?.before).toBe(0);
    // The extras' writer said one sentence nobody reads.
    expect(
      (completed[0] as { message: { text: string } }).message.text,
    ).not.toContain("Seed stage.");
    expect(seam.lastObservation()?.modelCalls).toBe(2);
  });

  it("starts the extras as a tool turn's answering round begins, after the reads", async () => {
    const tools = toolPort([GET_COMPANY], (p) =>
      succeeded(p, { name: "Northwind" }),
    );
    const { seam, alpha, request, completed } = build({
      script: [
        call("c1"),
        { kind: "JSON", value: analystResult("Northwind is at seed.") },
        {
          kind: "JSON",
          value: {
            ...analystResult("Seed."),
            findings: [finding("Northwind is at seed.")],
          },
        },
      ],
      tools,
      parallelExtras: true,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(3);
    const extrasCall = alpha.calls[2]?.request;
    // It read the tool's result, and holds no tools.
    expect(extrasCall?.messages.some((m) => m.role === "TOOL")).toBe(true);
    expect(extrasCall?.tools).toHaveLength(0);
    // The tools-first note stays last for the answer's writer.
    expect(alpha.calls[0]?.request.messages.at(-1)?.content).toContain(
      "LOOK IT UP FIRST",
    );
    expect(findingBlocks(completed)).toEqual(["Northwind is at seed."]);
  });

  it("the extras' cards reach the message: the join never clears them (owner 2026-10-23)", async () => {
    const { seam, request, completed } = build({
      script: [
        {
          kind: "JSON",
          value: analystResult("Zino Aviation runs charter flights."),
        },
        {
          kind: "JSON",
          value: {
            ...analystResult("Charter."),
            answerCards: {
              shape: "RESEARCH",
              title: "Zino Aviation",
              cards: [
                {
                  name: "Zino Aviation",
                  line: null,
                  reasons: ["Runs charter flights."],
                  measures: [],
                  view: null,
                  said: null,
                  citations: [],
                },
              ],
              followUps: [],
            },
          },
        },
      ],
      parallelExtras: true,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const blocks =
      (
        completed[0] as {
          message: {
            blocks?: { kind: string; cards?: { name: string }[] }[];
          };
        }
      ).message.blocks ?? [];
    const cards = blocks.find((block) => block.kind === "ANSWER_CARDS");
    expect(cards?.cards?.map((card) => card.name)).toEqual(["Zino Aviation"]);
  });

  it("an answer that asks a question back keeps no extras", async () => {
    const { seam, request, completed } = build({
      script: [
        {
          kind: "JSON",
          value: {
            ...analystResult("Which company do you mean?"),
            clarifyingQuestions: [
              { question: "Which company do you mean?", why: "Two match." },
            ],
          },
        },
        {
          kind: "JSON",
          value: {
            ...analystResult("Seed."),
            findings: [finding("Northwind declares a seed stage.")],
          },
        },
      ],
      parallelExtras: true,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(findingBlocks(completed)).toEqual([]);
  });

  it("leaves out a finding stating a number neither writer was given", async () => {
    const { seam, request, completed, logLines } = build({
      script: [
        { kind: "JSON", value: analystResult("Revenue grew 40% last year.") },
        {
          kind: "JSON",
          value: {
            ...analystResult("Growth."),
            findings: [
              finding("Revenue grew 40% last year."),
              finding("Revenue reached $7.3M."),
            ],
          },
        },
      ],
      parallelExtras: true,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(findingBlocks(completed)).toEqual(["Revenue grew 40% last year."]);
    expect(logLines.join("\n")).toContain("neither writer was given");
  });

  it("a failed extras call still answers, and says so in the log", async () => {
    const { seam, request, completed, logLines } = build({
      script: [
        {
          kind: "JSON",
          value: analystResult("Northwind declares a seed stage."),
        },
        { kind: "FAIL", failureClass: "INVALID_REQUEST" },
      ],
      parallelExtras: true,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(findingBlocks(completed)).toEqual([]);
    expect(
      (completed[0] as { message: { text: string } }).message.text,
    ).toContain("Northwind declares a seed stage.");
    expect(logLines.join("\n")).toContain("the extras' call failed");
  });

  it("counts both writers' tokens and cost", async () => {
    const usage = {
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 100,
    };
    const { seam, request } = build({
      script: [
        { kind: "JSON", value: analystResult("Answer."), usage },
        {
          kind: "JSON",
          value: { ...analystResult("x"), findings: [finding("Answer.")] },
          usage,
        },
      ],
      parallelExtras: true,
    });
    await seam.answer(request);
    expect(seam.lastObservation()?.usage).toEqual({
      inputTokens: 2000,
      outputTokens: 200,
    });
  });
});

describe("a company's team reaches the answer as its page shows it (QA F-16)", () => {
  it("says the team before the description, and says plainly when none is recorded", () => {
    const fact = onScreenCompanyFact({
      canonicalName: "Silo Credit",
      relationToYou: "SHARED",
      primaryDescription: "x".repeat(3_000),
      team: [
        {
          name: "Amina Bello",
          businessTitle: "CEO",
          isFounder: true,
          shortBio: "Ran grain trading at a Kano co-op.",
        },
        {
          name: "Tunde Ade",
          businessTitle: null,
          isFounder: false,
          shortBio: null,
        },
      ],
    });
    expect(fact?.statement).toContain(
      "Team, as its page shows it (2): Amina Bello (CEO, founder): Ran grain trading at a Kano co-op.; Tunde Ade.",
    );
    expect(
      onScreenCompanyFact({ canonicalName: "Silo Credit", team: [] })
        ?.statement,
    ).toContain("No team members are recorded on its page.");
    // Not read for them: nothing said about a team at all.
    expect(
      onScreenCompanyFact({ canonicalName: "Silo Credit" })?.statement,
    ).not.toContain("Team");
  });
});

describe("an email their mailbox cannot send goes through the Capital Q conversation (QA F-32)", () => {
  const tool = (name: string, toolName: string): QOfferedTool => ({
    ...GET_COMPANY,
    toolName,
    classification: "SIDE_EFFECT",
    definition: { ...GET_COMPANY.definition, name },
  });
  const EMAIL = tool("propose_email", "relationship.email.propose");
  const CHAT = tool("propose_chat_message", "relationship.chat.propose");
  const BODY = "Hello Amara, thank you for asking. Best, Wanjiru";

  it("prepares the same words as a Capital Q message, and tells the model not to send them to Gmail", async () => {
    const tools = toolPort([EMAIL, CHAT], (p) =>
      p.name === "propose_email"
        ? {
            ...succeeded(p, {
              status: "MAILBOX_NOT_CONNECTED",
              awaitingApprovalOf:
                "Connect Gmail in Settings, then I can prepare this email for you to approve.",
            }),
            toolName: "relationship.email.propose",
          }
        : {
            ...succeeded(p, {
              status: "PREPARED",
              awaitingApprovalOf: "Send a message to Savanna Seed Partners",
            }),
            toolName: "relationship.chat.propose",
          },
    );
    const { seam, alpha, request } = build({
      said: "Send it to them.",
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "e",
              name: "propose_email",
              arguments: {
                counterpartName: "Savanna Seed Partners",
                subject: "Kiosk economics",
                body: BODY,
              },
            },
          ],
        },
        { kind: "JSON", value: analystResult("prepared") },
      ],
      tools,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(tools.executed.map((p) => [p.name, p.arguments])).toEqual([
      [
        "propose_email",
        {
          counterpartName: "Savanna Seed Partners",
          subject: "Kiosk economics",
          body: BODY,
        },
      ],
      [
        "propose_chat_message",
        { counterpartName: "Savanna Seed Partners", body: BODY },
      ],
    ]);
    const second = JSON.stringify(alpha.calls[1]?.request.messages ?? []);
    expect(second).toContain("prepared the same words as a message");
    expect(second).toContain("Do not tell them to connect Gmail");
  });

  it("leaves a prepared email alone, and a reply to an inbound email", () => {
    const prepared = succeeded(
      { callId: "e", name: "propose_email", arguments: {} },
      { status: "PREPARED", awaitingApprovalOf: "Email them" },
    );
    expect(
      chatInsteadOf(
        { name: "propose_email", arguments: { companyId: "c", body: "Hi" } },
        prepared,
      ),
    ).toBeNull();
    const noMailbox = succeeded(
      { callId: "e", name: "propose_email", arguments: {} },
      { status: "MAILBOX_NOT_CONNECTED", awaitingApprovalOf: "Connect Gmail" },
    );
    expect(
      chatInsteadOf(
        {
          name: "propose_email",
          arguments: { inboundEmailId: "i", body: "Hi" },
        },
        noMailbox,
      ),
    ).toBeNull();
    expect(
      chatInsteadOf(
        { name: "propose_email", arguments: { companyId: "c", body: " Hi " } },
        noMailbox,
      ),
    ).toEqual({ companyId: "c", body: "Hi" });
  });
});

describe("no Q Card yet: one is prepared right there for approval (QA F-34)", () => {
  const tool = (name: string, toolName: string): QOfferedTool => ({
    ...GET_COMPANY,
    toolName,
    definition: { ...GET_COMPANY.definition, name },
  });
  const READ = tool("get_q_card", "q_card.get");
  const CLAIM = {
    ...tool("claim_q_card_handle", "app.q_card.handle.claim"),
    classification: "SIDE_EFFECT" as const,
  };

  it("prepares the claim with the suggested handle and tells the model not to ask what to take on", async () => {
    const tools = toolPort([READ, CLAIM], (p) =>
      p.name === "get_q_card"
        ? {
            ...succeeded(p, {
              status: "NOT_MADE",
              handle: null,
              publicUrl: null,
              findableBySearchEngines: null,
              updatedAt: null,
              suggestedHandle: "maji-loop",
            }),
            toolName: "q_card.get",
          }
        : {
            ...succeeded(p, { status: "PREPARED", says: "Claim @maji-loop" }),
            toolName: "app.q_card.handle.claim",
          },
    );
    const { seam, alpha, request } = build({
      said: "Show my Q Card.",
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "q",
              name: "get_q_card",
              arguments: { subject: "COMPANY" },
            },
          ],
        },
        { kind: "JSON", value: analystResult("prepared") },
      ],
      tools,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(tools.executed.map((p) => [p.name, p.arguments])).toEqual([
      ["get_q_card", { subject: "COMPANY" }],
      ["claim_q_card_handle", { subject: "COMPANY", handle: "maji-loop" }],
    ]);
    const second = JSON.stringify(alpha.calls[1]?.request.messages ?? []);
    expect(second).toContain(
      "prepared one for their approval with the handle @maji-loop",
    );
    expect(second).toContain("Do not ask what to take on");
  });

  it("offers nothing for a card already made", () => {
    const saved = succeeded(
      { callId: "q", name: "get_q_card", arguments: {} },
      { status: "SAVED", handle: "maji-loop" },
    );
    expect(
      qCardOfferOf(
        { name: "get_q_card", arguments: { subject: "COMPANY" } },
        saved,
      ),
    ).toBeNull();
  });
});
