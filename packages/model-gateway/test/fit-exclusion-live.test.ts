import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QAccountDigestSchema,
  type QAccountDigest,
} from "@capital-q/contracts";
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
import { runFitSweep, fitSweepAskOfReading } from "../src/q/fit-sweep.js";
import { fitFixture } from "./fit-fixture.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * D17 (live 15 Nov 2026, run bef9a7f4, savanna-seed): "Show me the
 * strongest fits, leaving out companies I'm already in contact with". The
 * cards came out right only because code dropped 8 of 10 afterwards; the
 * text named them ("Best fits on your mandate: Ledgerfold at 9.2; then
 * Watchly at 8.7; then Ajopot at 8.3") and then said "I left out
 * Ledgerfold, Watchly, Ajopot...". Log: excluded 0, cards 10. The turn was
 * prepared (warmed) before it was read, and the prepare's sweep closed
 * over a request without the reading's v88 exclusion. Fake model; no
 * provider, no network.
 */

const RUN = randomUUID();
const ID = (n: number) =>
  `5c1d7a10-0b0e-4e7a-9a0c-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-11-15T03:17:00.000Z");
const NAMES = [
  "Ledgerfold",
  "Watchly",
  "Ajopot",
  "Maji Loop",
  "Kivu Traceworks",
  "Clinicrest",
  "Kazikit",
  "Tensorgate",
  "Brancheon Works",
  "Basketari",
];
/** The first eight are companies they are already in touch with. */
const IN_TOUCH = NAMES.slice(0, 8).map((_, i) => ID(i + 1));
const SCORES = ["STRONG", "STRONG", "STRONG", "PARTIAL"] as const;

function fitOf(i: number) {
  const name = NAMES[i] ?? "Unnamed";
  const strong = i < 3 ? 3 : i < 8 ? 2 : 1;
  return fitFixture(
    ID(i + 1),
    name,
    {
      STAGE: SCORES[Math.min(i, 3)],
      SECTOR: strong >= 2 ? "STRONG" : "PARTIAL",
      GEOGRAPHY: strong >= 3 ? "STRONG" : "PARTIAL",
    },
    i < 3 ? "STRONG_FIT" : "GOOD_FIT",
  ).result.data as { name: string; profile: unknown };
}

function digest(): QAccountDigest {
  return QAccountDigestSchema.parse({
    side: "INVESTOR",
    relationships: [],
    relationshipsTotal: IN_TOUCH.length,
    byStage: { CONNECTED: IN_TOUCH.length },
    relationshipCounterpartIds: IN_TOUCH,
    waiting: [],
    waitingTotal: 0,
    meetings: [],
    work: [],
    requests: [],
    gateq: null,
    recent: [],
    unread: [],
    readAt: NOW.toISOString(),
  });
}

const offered = (name: string, toolName: string): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: "A read.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
});

function ok(
  proposal: QToolProposal,
  toolName: string,
  data: unknown,
): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "CONFIDENTIAL",
    result: { ok: true, data },
    latencyMs: 1,
  };
}

function build(relationshipsRead: boolean) {
  const alpha = createFakeModelProvider({ code: "alpha", script: [] });
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
  const asked =
    "Show me the strongest fits, leaving out companies I'm already in contact with";
  const messages: QConversationMessage[] = [
    {
      id: randomUUID() as QConversationMessage["id"],
      tenantId: TENANT as QConversationMessage["tenantId"],
      conversationId: randomUUID() as QConversationMessage["conversationId"],
      runId: RUN as QConversationMessage["runId"],
      role: "USER",
      content: asked,
      contentType: "TEXT",
      createdAt: NOW.toISOString(),
    },
  ];
  const completed: unknown[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { role: "Q"; content: string }) => {
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
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: {
      append: (
        _tx: unknown,
        input: { eventType?: string; payload?: unknown },
      ) => {
        if (input.eventType === "q.message.completed") {
          completed.push(input.payload);
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const tools: QToolPort = {
    offer: () =>
      Promise.resolve([
        offered("fit_top_candidates", "fit.top_candidates"),
        offered("fit_profile", "fit.profile"),
        offered("list_my_relationships", "relationship.list_mine"),
      ]),
    execute: (proposal) => {
      if (proposal.name === "fit_top_candidates") {
        const limit = Number(
          (proposal.arguments as Record<string, unknown>)["limit"] ?? 10,
        );
        const entries = NAMES.slice(0, Math.min(limit, NAMES.length)).map(
          (_, i) => {
            const fit = fitOf(i);
            return { name: fit.name, line: null, profile: fit.profile };
          },
        );
        return Promise.resolve(
          ok(proposal, "fit.top_candidates", {
            status: "OK",
            comparison: { entries },
          }),
        );
      }
      if (proposal.name === "fit_profile") {
        const id = (proposal.arguments as Record<string, unknown>)["companyId"];
        const at = NAMES.findIndex((_, i) => ID(i + 1) === id);
        return Promise.resolve(
          ok(proposal, "fit.profile", fitOf(Math.max(at, 0))),
        );
      }
      // Their own relationships, as the relationships read returns them;
      // or unreadable this turn (the digest still knows them).
      if (relationshipsRead) {
        return Promise.resolve(
          ok(proposal, "relationship.list_mine", {
            side: "INVESTOR",
            relationships: IN_TOUCH.map((id, i) => ({
              counterpart: { kind: "COMPANY", id, name: NAMES[i] },
            })),
            saved: [],
          }),
        );
      }
      return Promise.resolve({
        ...ok(proposal, "relationship.list_mine", null),
        status: "FAILED",
        failureCode: "NOT_AVAILABLE",
        result: {
          ok: false,
          error: { code: "NOT_AVAILABLE", safeMessage: "Not available." },
        },
      } as QToolCallOutcome);
    },
  };
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    accountDigestOf: () => Promise.resolve(digest()),
    now: () => NOW,
  });
  const investorOrganisationId = randomUUID();
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
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
        subject: { kind: "INVESTOR_ORGANISATION", investorOrganisationId },
      },
    ],
    denied: [],
    maxSensitivity: "CONFIDENTIAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: NOW.toISOString(),
    revalidateAfter: new Date(NOW.getTime() + 60_000).toISOString(),
    revalidateOnResume: true,
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
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan,
  } as unknown as QAnswerRequest;
  return { seam, request, asked, completed, alpha };
}

type Completed = {
  message: {
    text: string;
    blocks?: { kind: string; cards?: { name: string }[] }[];
  };
};

describe("D17: fits leaving out the companies they are in touch with", () => {
  it.each([true, false])(
    "a warmed prepare's sweep still leaves them out, and the text names only what is shown (relationships read: %s)",
    async (relationshipsRead) => {
      const { seam, request, asked, completed, alpha } =
        build(relationshipsRead);
      // Warmed on the words, before the turn was read (live shape).
      if (seam.warm === undefined) throw new Error("no warm");
      seam.warm(request);
      await seam.answer({
        ...request,
        turnKind: "QUESTION_TO_Q",
        questionKind: "FIT",
        fitQuestion: { text: asked, count: null, excludeShown: false },
        excludeRelationships: true,
      } as QAnswerRequest);
      expect(alpha.calls).toHaveLength(0);
      const last = completed.at(-1) as Completed | undefined;
      if (last === undefined) throw new Error("no answer");
      const cards = (last.message.blocks ?? [])
        .filter((block) => block.kind === "ANSWER_CARDS")
        .flatMap((block) => block.cards ?? [])
        .map((card) => card.name);
      expect(cards.sort()).toEqual(["Basketari", "Brancheon Works"]);
      const text = last.message.text;
      for (const name of NAMES.slice(0, 8)) {
        expect(text).not.toContain(name);
      }
      expect(text).toContain(
        "I've left out the 8 companies you're already in touch with.",
      );
      expect(text).not.toMatch(/\bI left out\b/u);
    },
  );

  it("the sweep leaves out whom the digest knows even when their own relationships read is empty", async () => {
    const ask = fitSweepAskOfReading(
      { text: "strongest fits", count: null, excludeRelationships: true },
      [],
      [],
      [],
    );
    const execute: QToolPort["execute"] = (proposal) => {
      const entries = NAMES.map((_, i) => {
        const fit = fitOf(i);
        return { name: fit.name, line: null, profile: fit.profile };
      });
      return Promise.resolve(
        ok(proposal, "fit.top_candidates", {
          status: "OK",
          comparison: { entries },
        }),
      );
    };
    const result = await runFitSweep({
      ask,
      tools: { execute },
      context: {} as Parameters<typeof runFitSweep>[0]["context"],
      available: new Set(["fit_profile", "fit_top_candidates"]),
      own: Promise.resolve(null),
      inTouch: Promise.resolve(new Set(IN_TOUCH)),
    });
    if (result === null) throw new Error("no sweep");
    expect(result.fits.map((fit) => fit.name).sort()).toEqual([
      "Basketari",
      "Brancheon Works",
    ]);
    expect([...result.excludedRelationships].sort()).toEqual(
      [...IN_TOUCH].sort(),
    );
  });
});
