import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
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
  type FakeBehaviour,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import {
  holdsWebForOwned,
  OWNED_FIRST_CODE,
  ownedReadFound,
  settledWithin,
} from "../src/q/owned-first.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Speed lane C (production 2026-10-12, run b5eb0a12): a memory question
 * read as ONLY_IF_EMPTY ("Remember what we discussed about Tensorgate. Has
 * anything changed since our previous assessment?"). The model asked for
 * the company search and the public web in one round; the search found
 * the company in 128 ms and the answer waited 7.4 s for the web. Fake
 * timed ports: the search takes SEARCH_MS, the web WEB_MS.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();
const SEARCH_MS = 20;
const WEB_MS = 500;

const WEB: QOfferedTool = {
  toolName: "public_web.search",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "research_public_web",
    description: "Searches the public web once.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "SEARCHING_PUBLIC_SOURCES",
};
const SEARCH: QOfferedTool = {
  toolName: "company.search",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "search_companies",
    description: "Searches Capital Q's companies.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_COMPANY",
};

function outcome(
  proposal: QToolProposal,
  toolName: QToolCallOutcome["toolName"],
  data: unknown,
): QToolCallOutcome {
  return {
    callId: proposal.callId,
    toolName,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "PUBLIC",
    result: { ok: true, data },
    latencyMs: 1,
  };
}

const later = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

function plan(): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
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

const answer = (text: string): FakeBehaviour => ({
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
  }),
});

const bothInOneRound: FakeBehaviour = {
  kind: "TOOL_CALLS",
  calls: [
    { callId: "w1", name: "research_public_web", arguments: { query: "x" } },
    { callId: "s1", name: "search_companies", arguments: { query: "x" } },
  ],
};

function scene(options: {
  readonly script: readonly FakeBehaviour[];
  readonly found: boolean;
  readonly mode: "ONLY_IF_EMPTY" | "EXPLICIT";
}) {
  const log: string[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([WEB, SEARCH]),
    execute: (proposal) => {
      log.push(`start ${proposal.name}`);
      if (proposal.name === "research_public_web") {
        return later(
          WEB_MS,
          outcome(proposal, "public_web.search", {
            status: "OK",
            query: "x",
            sources: [],
            comparison: [],
            truthClass: "UNKNOWN",
          }),
        ).finally(() => log.push(`end ${proposal.name}`));
      }
      if (proposal.name === "search_companies") {
        return later(
          SEARCH_MS,
          outcome(proposal, "company.search", {
            items: options.found
              ? [{ companyId: COMPANY, name: "Tensorgate" }]
              : [],
          }),
        ).finally(() => log.push(`end ${proposal.name}`));
      }
      return Promise.reject(new Error(`unexpected ${proposal.name}`));
    },
  };
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
      content:
        "Remember what we discussed about Tensorgate. Has anything changed since our previous assessment?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
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
    runs: { allocateEventSequence: () => Promise.resolve(1) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
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
    plan: plan(),
    turnKind: "QUESTION_TO_Q",
    questionKind: "THEIR_OWN_RECORDS",
    research: Promise.resolve({
      mode: options.mode,
      announceSourceChange: false,
    }),
  };
  return { seam, request, alpha, log };
}

/** What the model was handed back for one call id, as JSON text. */
function resultFor(
  alpha: { calls: readonly { request: { messages: readonly unknown[] } }[] },
  callId: string,
): string {
  for (const call of alpha.calls) {
    for (const message of call.request.messages as readonly {
      role?: string;
      callId?: string;
      content?: string;
    }[]) {
      if (message.role === "TOOL" && message.callId === callId) {
        return message.content ?? "";
      }
    }
  }
  return "";
}

describe("speed lane C: owned evidence first under ONLY_IF_EMPTY", () => {
  it("the web waits for the search and is not asked when the search found the subject", async () => {
    const { seam, request, alpha, log } = scene({
      script: [bothInOneRound, answer("Nothing new is established.")],
      found: true,
      mode: "ONLY_IF_EMPTY",
    });
    const started = Date.now();
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const elapsed = Date.now() - started;
    console.info(
      `[speed-lane-c] owned-first: search ${String(SEARCH_MS)} ms, web ${String(WEB_MS)} ms -> answer in ${String(elapsed)} ms, web ${log.includes("start research_public_web") ? "RUN" : "HELD"}`,
    );
    expect(log).not.toContain("start research_public_web");
    expect(elapsed).toBeLessThan(WEB_MS);
    // The model is told why, in the call's own result (a valid transcript).
    expect(resultFor(alpha, "w1")).toContain(OWNED_FIRST_CODE);
    expect(resultFor(alpha, "s1")).toContain("Tensorgate");
  });

  it("the web still runs, after the search, when the search came back empty", async () => {
    const { seam, request, log } = scene({
      script: [bothInOneRound, answer("From public sources: ...")],
      found: false,
      mode: "ONLY_IF_EMPTY",
    });
    await seam.answer(request);
    expect(log).toContain("start research_public_web");
    expect(log.indexOf("end search_companies")).toBeLessThan(
      log.indexOf("start research_public_web"),
    );
  });

  it("a chained round cannot ask the web alone once the records answered", async () => {
    const { seam, request, log, alpha } = scene({
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "s1",
              name: "search_companies",
              arguments: { query: "x" },
            },
          ],
        },
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "w2",
              name: "research_public_web",
              arguments: { query: "x" },
            },
          ],
        },
        answer("Nothing new is established."),
      ],
      found: true,
      mode: "ONLY_IF_EMPTY",
    });
    await seam.answer(request);
    expect(log).not.toContain("start research_public_web");
    expect(resultFor(alpha, "w2")).toContain(OWNED_FIRST_CODE);
  });

  it("EXPLICIT research is unchanged: the web runs beside the search", async () => {
    const { seam, request, log } = scene({
      script: [bothInOneRound, answer("Current coverage says ...")],
      found: true,
      mode: "EXPLICIT",
    });
    await seam.answer(request);
    expect(log.slice(0, 2).sort()).toEqual([
      "start research_public_web",
      "start search_companies",
    ]);
  });
});

describe("owned-first rules", () => {
  const proposal = { callId: "c", name: "x", arguments: {} };
  it("only a lookup of the subject counts as found; lists of everything never do", () => {
    expect(
      ownedReadFound(outcome(proposal, "company.search", { items: [{}] })),
    ).toBe(true);
    expect(
      ownedReadFound(outcome(proposal, "company.search", { items: [] })),
    ).toBe(false);
    expect(
      ownedReadFound(
        outcome(proposal, "relationship.own.list", { items: [{}, {}] }),
      ),
    ).toBe(false);
    expect(
      ownedReadFound({
        ...outcome(proposal, "company.get", null),
        status: "DENIED",
        result: {
          ok: false,
          error: { code: "NOT_AVAILABLE", safeMessage: "" },
        },
      }),
    ).toBe(false);
  });

  it("holds the web only under ONLY_IF_EMPTY, beside a read or after one found", () => {
    const web = { name: "research_public_web", classification: "READ_ONLY" };
    const read = { name: "search_companies", classification: "READ_ONLY" };
    const base = { ownedFoundEarlier: false };
    expect(
      holdsWebForOwned({
        ...base,
        researchMode: "ONLY_IF_EMPTY",
        proposals: [web, read],
      }),
    ).toBe(true);
    expect(
      holdsWebForOwned({
        ...base,
        researchMode: "ONLY_IF_EMPTY",
        proposals: [web],
      }),
    ).toBe(false);
    expect(
      holdsWebForOwned({
        researchMode: "ONLY_IF_EMPTY",
        proposals: [web],
        ownedFoundEarlier: true,
      }),
    ).toBe(true);
    for (const mode of ["EXPLICIT", "OFFERED", "NEVER", undefined]) {
      expect(
        holdsWebForOwned({
          ...base,
          researchMode: mode,
          proposals: [web, read],
        }),
      ).toBe(false);
    }
  });

  it("settledWithin: the value in time, null when late or failed", async () => {
    expect(await settledWithin(Promise.resolve("now"), 0)).toBe("now");
    expect(await settledWithin(later(50, "late"), 5)).toBeNull();
    expect(await settledWithin(Promise.reject(new Error("x")), 50)).toBeNull();
  });
});
