import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QPageManifest,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import {
  focusFromHistory,
  listsFromHistory,
  listsFromManifest,
  referenceAskOf,
  resolutionNote,
  resolveReference,
  type ConversationEntity,
} from "../src/conversation-entities.js";

/**
 * RECOVERY-2026-10 B6 (Scenarios A, B, G): what the person points at --
 * "the second one", "not that investor, the second one", "compare those
 * two", "go back to what we were discussing", "book a meeting with him" --
 * is bound by code to records on their page, in Q's lists, or in the
 * conversation's focus, which lives on the durable messages (so voice and
 * text, and any q-api instance, see the same thing).
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

// Discover, investors tab: four funds in screen order.
const HALYARD = "11111111-1111-4111-8111-000000000001";
const SAVANNA = "11111111-1111-4111-8111-000000000002";
const CLEARWATER = "11111111-1111-4111-8111-000000000003";
const LEDGERFOLD = "11111111-1111-4111-8111-000000000004";
// Companies Q listed.
const AJOPOT = "22222222-2222-4222-8222-000000000001";
const TENSORGATE = "22222222-2222-4222-8222-000000000002";
const KORA = "22222222-2222-4222-8222-000000000003";

/** The investors list on Discover, in screen order. */
function investorList(
  ids: readonly string[],
): QPageManifest["sections"][number] {
  return {
    id: "investors",
    kind: "INVESTOR_LIST",
    refs: ids.map((id) => ({ kind: "INVESTOR_ORGANISATION" as const, id })),
    total: ids.length,
  };
}

const INVESTORS_PAGE: QPageManifest = {
  v: 2,
  seq: 7,
  tab: "find",
  inView: ["investors"],
  sections: [investorList([HALYARD, SAVANNA, CLEARWATER, LEDGERFOLD])],
  dialogs: [],
};

const companyCards: QResultBlock = {
  kind: "ANSWER_CARDS",
  title: "Closest to your mandate",
  cards: [
    ["Ajopot", AJOPOT],
    ["Tensorgate", TENSORGATE],
    ["Kora", KORA],
  ].map(([name, id]) => ({
    name: name ?? "",
    subject: { kind: "COMPANY", companyId: id ?? "" },
    facts: [],
  })),
} as unknown as QResultBlock;

const opened = (page: "COMPANY" | "INVESTOR", id: string): QResultBlock => ({
  kind: "UI_INTENT",
  intent: { kind: "OPEN_RECORD_PAGE", page, id },
});

function message(
  role: "USER" | "Q",
  content: string,
  blocks?: readonly QResultBlock[],
): QConversationMessage {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    conversationId: "c",
    runId: randomUUID(),
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    ...(blocks === undefined ? {} : { blocks }),
  } as unknown as QConversationMessage;
}

const resolve = (
  said: string,
  history: readonly QConversationMessage[],
  manifest?: QPageManifest,
) => {
  const ask = referenceAskOf(said);
  if (ask === null) return null;
  const latestQ = [...history].reverse().find((one) => one.role === "Q");
  return resolveReference(ask, {
    page: listsFromManifest(manifest),
    answers: listsFromHistory(history),
    answerIsNewest: (latestQ?.blocks ?? []).some(
      (block) => block.kind === "ANSWER_CARDS",
    ),
    focus: focusFromHistory(history),
  });
};

const one = (result: ReturnType<typeof resolve>): ConversationEntity | null =>
  result?.kind === "ONE" ? result.entity : null;

describe("reading what the words point at", () => {
  it.each([
    ["explain the second one", { kind: "ORDINAL", position: 2 }],
    ["open the third investor", { kind: "ORDINAL", position: 3 }],
    ["show me the last one", { kind: "ORDINAL", position: -1 }],
    [
      "not that investor, the second one",
      { kind: "ORDINAL", position: 2, correction: true },
    ],
    ["compare those two", { kind: "PAIR" }],
    ["can you compare them for me", { kind: "PAIR" }],
    ["go back to what we were discussing", { kind: "BACK" }],
    ["book a meeting with him", { kind: "COUNTERPART" }],
    ["send her a message", null],
  ])("%j", (said, expected) => {
    const ask = referenceAskOf(said);
    if (expected === null) {
      // "send her a message" names no verb+pronoun pair we bind; the
      // reader still reads it.
      expect(ask?.kind ?? null).not.toBe("ORDINAL");
      return;
    }
    expect(ask).toEqual(expect.objectContaining(expected));
  });

  it("reads the kind named with a correction", () => {
    expect(referenceAskOf("not that investor, the second one")).toEqual({
      kind: "ORDINAL",
      position: 2,
      entityKind: "INVESTOR_ORGANISATION",
      correction: true,
    });
  });

  it("leaves ordinary questions alone", () => {
    for (const said of [
      "what's our runway?",
      "who is the president of Nigeria?",
      "hi Q",
    ]) {
      expect(referenceAskOf(said)).toBeNull();
    }
  });
});

describe("binding a reference to a record", () => {
  it("'the second one' on the investors page is the second fund on screen", () => {
    expect(one(resolve("explain the second one", [], INVESTORS_PAGE))).toEqual({
      kind: "INVESTOR_ORGANISATION",
      id: SAVANNA,
      name: null,
    });
  });

  it("'the second one' right after Q listed companies is Q's second card", () => {
    const history = [
      message("USER", "top three companies for my mandate"),
      message("Q", "Here are the closest three.", [companyCards]),
    ];
    expect(
      one(resolve("tell me about the second one", history, INVESTORS_PAGE)),
    ).toEqual({ kind: "COMPANY", id: TENSORGATE, name: "Tensorgate" });
  });

  it("'not that investor, the second one' skips the investor just opened", () => {
    // Q opened the second fund already; the correction means the next.
    const history = [
      message("USER", "open the second investor"),
      message("Q", "Opening it.", [opened("INVESTOR", SAVANNA)]),
    ];
    const result = resolve("not that investor, the second one", history, {
      ...INVESTORS_PAGE,
      // The page now shows the list with the opened one first.
      sections: [investorList([SAVANNA, CLEARWATER, HALYARD])],
    });
    expect(one(result)?.id).toBe(CLEARWATER);
  });

  it("'compare those two' is the two most recently discussed of one kind", () => {
    const history = [
      message("Q", "Opening it.", [opened("INVESTOR", HALYARD)]),
      message("USER", "and the next"),
      message("Q", "Opening it.", [opened("INVESTOR", CLEARWATER)]),
    ];
    const result = resolve("compare those two", history, INVESTORS_PAGE);
    expect(result?.kind).toBe("PAIR");
    expect(
      result?.kind === "PAIR" ? result.entities.map((e) => e.id) : [],
    ).toEqual([CLEARWATER, HALYARD]);
  });

  it("'compare those two' with nothing discussed is the first two on the list", () => {
    const result = resolve("compare those two", [], INVESTORS_PAGE);
    expect(
      result?.kind === "PAIR" ? result.entities.map((e) => e.id) : [],
    ).toEqual([HALYARD, SAVANNA]);
  });

  it("'go back to what we were discussing' is the topic before the current one", () => {
    const history = [
      message("Q", "Ajopot's raise is…", [opened("COMPANY", AJOPOT)]),
      message("USER", "what about Halyard"),
      message("Q", "Halyard invests…", [opened("INVESTOR", HALYARD)]),
    ];
    expect(
      one(resolve("go back to what we were discussing", history))?.id,
    ).toBe(AJOPOT);
  });

  it("'book a meeting with him' is the counterpart in focus", () => {
    const history = [
      message("Q", "Halyard invests at seed…", [opened("INVESTOR", HALYARD)]),
    ];
    expect(one(resolve("book a meeting with him", history))).toEqual({
      kind: "INVESTOR_ORGANISATION",
      id: HALYARD,
      name: null,
    });
  });

  it("binds nothing when nothing was shown or discussed", () => {
    expect(resolve("explain the second one", [])).toBeNull();
    expect(resolve("compare those two", [])).toBeNull();
    expect(resolve("go back to what we were discussing", [])).toBeNull();
  });

  it("writes Capital Q's note with ids", () => {
    const ask = referenceAskOf("explain the second one");
    expect(ask).not.toBeNull();
    const result = resolve("explain the second one", [], INVESTORS_PAGE);
    expect(result).not.toBeNull();
    if (ask === null || result === null) return;
    expect(resolutionNote(ask, result)).toBe(
      `RESOLVED: number 2 = (investor ${SAVANNA}).`,
    );
  });
});

// --- through the answer seam --------------------------------------------------

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(manifest?: QPageManifest): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER, organisationId: actor.organisationId },
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
      ...(manifest === undefined
        ? {}
        : { screen: { route: "DISCOVER", manifest } }),
    }),
  };
}

const QUESTION: QTurnReading = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
} as unknown as QTurnReading;

function seam(earlier: readonly QConversationMessage[] = []) {
  const lines: QConversationMessage[] = [...earlier];
  const notes: (string | undefined)[] = [];
  const delegatedWith: QAnswerRequest[] = [];
  const turns: QTurnReader = {
    read: (input) => {
      const last = input.recentTurns.at(-1);
      notes.push(
        last?.text.startsWith("[Q context]") === true ? last.text : undefined,
      );
      return Promise.resolve(QUESTION);
    },
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      answer: (asked) => {
        delegatedWith.push(asked);
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "p",
          promptBundleVersion: "b",
        });
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([...lines]),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          const row = {
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          } as unknown as QConversationMessage;
          lines.push(row);
          return Promise.resolve(row);
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    offeredTools: () => Promise.resolve(["open_page"]),
  });
  const say = async (said: string, manifest?: QPageManifest) => {
    lines.push(message("USER", said));
    await answer.answer(request(manifest));
    return lines.at(-1);
  };
  return { say, notes, delegatedWith, lines };
}

describe("references through the answer seam (Scenarios A, B, G)", () => {
  it("'open the second one' on the investors page opens that fund, by code", async () => {
    const run = seam();
    const last = await run.say("open the second one", INVESTORS_PAGE);
    expect(run.delegatedWith).toHaveLength(0);
    expect(last?.blocks).toEqual([opened("INVESTOR", SAVANNA)]);
  });

  it("'not that investor, the second one' opens the next fund, not the one just opened", async () => {
    const run = seam([
      message("USER", "open the first one"),
      message("Q", "Opening it.", [opened("INVESTOR", HALYARD)]),
    ]);
    const page: QPageManifest = {
      ...INVESTORS_PAGE,
      sections: [investorList([HALYARD, SAVANNA, CLEARWATER])],
    };
    const last = await run.say("not that investor, the second one", page);
    expect(last?.blocks).toEqual([opened("INVESTOR", SAVANNA)]);
  });

  it("'explain the second one' is answered by Q, told which record it is", async () => {
    const run = seam();
    await run.say("explain the second one", INVESTORS_PAGE);
    expect(run.delegatedWith).toHaveLength(1);
    expect(run.delegatedWith[0]?.references).toBe(
      `RESOLVED: number 2 = (investor ${SAVANNA}).`,
    );
    // The reader is told too, ahead of the rest of its note.
    expect(run.notes.at(-1)).toMatch(/^\[Q context\] RESOLVED: number 2/u);
  });

  it("'compare those two' after Q listed companies tells Q the pair, by name and id", async () => {
    const run = seam([
      message("USER", "top three companies for my mandate"),
      message("Q", "Here are the closest three.", [companyCards]),
    ]);
    await run.say("compare those two");
    expect(run.delegatedWith[0]?.references).toBe(
      `RESOLVED: the two to compare = "Ajopot" (company ${AJOPOT}) and "Tensorgate" (company ${TENSORGATE}).`,
    );
  });

  it("'go back to what we were discussing' carries across voice and text: the focus is on the messages", async () => {
    // Earlier turns could have been spoken or typed; only the durable
    // messages are read, so a new seam (another instance) binds the same.
    const earlier = [
      message("Q", "Ajopot's raise is…", [opened("COMPANY", AJOPOT)]),
      message("Q", "Halyard invests…", [opened("INVESTOR", HALYARD)]),
    ];
    const run = seam(earlier);
    await run.say("go back to what we were discussing");
    expect(run.delegatedWith[0]?.references).toBe(
      `RESOLVED: what was being discussed before = (company ${AJOPOT}).`,
    );
  });

  it("a turn that points at nothing carries no reference", async () => {
    const run = seam();
    await run.say("what's our runway?");
    expect(run.delegatedWith[0]?.references).toBeUndefined();
  });
});
