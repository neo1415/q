import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QRecordPage,
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
  matchOwnCounterpart,
  namedRecordRequestOf,
  notFoundLine,
  pagesFor,
} from "../src/named-record-request.js";
import type { QOpenRecordPort } from "../src/references.js";

/**
 * RECOVERY-2026-10 (C, INC-1 live 2026-10-08 19:20-19:22): the founder's
 * four phrasings, word for word. Each names ONE record; code opens exactly
 * that record (their own relationship first) through open_page's port, or
 * says in one line who it could be -- never "Understood." with nothing
 * done, and never the relationships list instead of the relationship.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SHIFTWELL = "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

/** An investor's run: their own investor organisation is in the plan. */
function request(investor: boolean): QAnswerRequest {
  const runId = randomUUID();
  const asked = base(runId);
  // An investor's own organisation, bound as the firewall binds it.
  return investor
    ? {
        ...asked,
        plan: {
          ...asked.plan,
          scopes: [
            {
              kind: "INVESTOR_MANDATE",
              subject: {
                kind: "INVESTOR_ORGANISATION",
                investorOrganisationId: actor.organisationId,
              },
            } as unknown as QAnswerRequest["plan"]["scopes"][number],
          ],
        },
      }
    : asked;
}

function base(runId: string): QAnswerRequest {
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
    }),
  };
}

/** What the turn reader filed in the incident: the relationships LIST. */
const MISREAD = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: { kind: "NAVIGATE", destination: "RELATIONSHIPS", unknownScreen: null },
} as unknown as QTurnReading;

/**
 * open_page as the port sees it: Shiftwell is a company the investor has
 * a relationship with; only its exact name opens, and only company pages.
 */
function openRecordPort(opened: { page: QRecordPage; name?: string }[]) {
  const port: QOpenRecordPort = {
    open: (_request, target) => {
      opened.push({
        page: target.page,
        ...(target.name === undefined ? {} : { name: target.name }),
      });
      const companyPage =
        target.page === "COMPANY" ||
        target.page === "COMPANY_DATA_ROOM" ||
        target.page === "RELATIONSHIP_COMPANY";
      return Promise.resolve(
        companyPage && target.name === "Shiftwell Health"
          ? { kind: "OPEN_RECORD_PAGE", page: target.page, id: SHIFTWELL }
          : null,
      );
    },
  };
  return port;
}

function conversation(counterparts: readonly string[], investor = true) {
  const conversationId = randomUUID();
  const lines: QConversationMessage[] = [];
  const opened: { page: QRecordPage; name?: string }[] = [];
  let delegated = 0;
  const turns: QTurnReader = { read: () => Promise.resolve(MISREAD) };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      answer: () => {
        delegated += 1;
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
    openRecord: openRecordPort(opened),
    counterpartNames: () => Promise.resolve(counterparts),
  });
  const say = async (said: string) => {
    lines.push({
      tenantId: TENANT,
      conversationId,
      runId: randomUUID(),
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      role: "USER",
      content: said,
    } as unknown as QConversationMessage);
    await answer.answer(request(investor));
    const last = lines.at(-1);
    return {
      role: last?.role,
      content: last?.content ?? "",
      blocks: last?.blocks ?? [],
    };
  };
  return { say, opened, delegated: () => delegated };
}

const intentOf = (blocks: readonly QResultBlock[]) =>
  blocks.flatMap((block) => (block.kind === "UI_INTENT" ? [block.intent] : []));

describe("the incident's four phrasings, read by code", () => {
  it("names one record and the part asked for", () => {
    expect(namedRecordRequestOf("Take me to Shiftwell relationship.")).toEqual({
      name: "Shiftwell",
      facet: "RELATIONSHIP",
      explicit: true,
    });
    expect(namedRecordRequestOf("Open Shiftwell.")).toEqual({
      name: "Shiftwell",
      facet: "PAGE",
      explicit: true,
    });
    expect(
      namedRecordRequestOf("Show me the data room for Shiftwell."),
    ).toEqual({ name: "Shiftwell", facet: "DATA_ROOM", explicit: true });
    expect(
      namedRecordRequestOf(
        "You open documents. I want to see the data room for Shiftwell.",
      ),
    ).toEqual({ name: "Shiftwell", facet: "DATA_ROOM", explicit: true });
    expect(namedRecordRequestOf("Shiftwell's data room please")).toBeNull();
    expect(namedRecordRequestOf("Open Shiftwell's data room")).toMatchObject({
      name: "Shiftwell",
      facet: "DATA_ROOM",
    });
  });

  it("leaves pages, pointing words and questions alone", () => {
    expect(namedRecordRequestOf("Take me to my relationships.")).toBeNull();
    expect(namedRecordRequestOf("Open the data room.")).toBeNull();
    expect(namedRecordRequestOf("Open it.")).toBeNull();
    expect(namedRecordRequestOf("Open the second one.")).toBeNull();
    expect(namedRecordRequestOf("What does Shiftwell do?")).toBeNull();
  });

  it("matches their own counterpart, never guesses between two, and names the near ones", () => {
    expect(
      matchOwnCounterpart("Shiftwell", ["Shiftwell Health", "Ledgerline"]),
    ).toEqual({ kind: "ONE", name: "Shiftwell Health" });
    expect(
      matchOwnCounterpart("Shiftwell", ["Shiftwell Health", "Shiftwell Labs"]),
    ).toMatchObject({ kind: "SEVERAL" });
    const none = matchOwnCounterpart("Shiftwel", ["Ledgerline", "Nixo"]);
    expect(none.kind).toBe("NONE");
    expect(
      notFoundLine({ name: "Shiftwell", facet: "DATA_ROOM", explicit: true }, [
        "Shiftwell Labs",
      ]),
    ).toBe('I can\'t find "Shiftwell" data room. Did you mean Shiftwell Labs?');
    expect(pagesFor("DATA_ROOM", "INVESTOR")[0]).toBe("COMPANY_DATA_ROOM");
    expect(pagesFor("RELATIONSHIP", "FOUNDER")[0]).toBe(
      "RELATIONSHIP_INVESTOR",
    );
  });
});

describe("the answer opens exactly that record (INC-1 regression)", () => {
  const own = ["Shiftwell Health", "Ledgerline", "Nixo"];

  it('"Take me to Shiftwell relationship." opens the Shiftwell relationship, not the list', async () => {
    const q = conversation(own);
    const answer = await q.say("Take me to Shiftwell relationship.");
    expect(intentOf(answer.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "RELATIONSHIP_COMPANY", id: SHIFTWELL },
    ]);
    expect(answer.content).toBe('Opening "Shiftwell Health".');
    expect(q.delegated()).toBe(0);
  });

  it('"Open Shiftwell." opens its page and never answers "Understood."', async () => {
    const q = conversation(own);
    const answer = await q.say("Open Shiftwell.");
    expect(intentOf(answer.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: SHIFTWELL },
    ]);
    expect(answer.content).not.toBe("Understood.");
  });

  it('"Show me the data room for Shiftwell." opens Shiftwell\'s data room', async () => {
    const q = conversation(own);
    const answer = await q.say("Show me the data room for Shiftwell.");
    expect(intentOf(answer.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY_DATA_ROOM", id: SHIFTWELL },
    ]);
    expect(answer.content).toBe('Opening "Shiftwell Health"\'s data room.');
  });

  it('"You open documents. I want to see the data room for Shiftwell." acts, never asks about documents', async () => {
    const q = conversation(own);
    const answer = await q.say(
      "You open documents. I want to see the data room for Shiftwell.",
    );
    expect(intentOf(answer.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY_DATA_ROOM", id: SHIFTWELL },
    ]);
    expect(answer.content).not.toMatch(/document/iu);
  });

  it("two of theirs called Shiftwell: one short line naming both, nothing opened", async () => {
    const q = conversation(["Shiftwell Health", "Shiftwell Labs"]);
    const answer = await q.say("Open Shiftwell.");
    expect(answer.content).toBe(
      "Which one do you mean: Shiftwell Health or Shiftwell Labs?",
    );
    expect(intentOf(answer.blocks)).toEqual([]);
    expect(q.opened).toEqual([]);
  });

  it("nothing of theirs and nothing they can reach: says so with the near names, never Understood", async () => {
    const q = conversation(["Shiftwell Labs", "Ledgerline"]);
    const answer = await q.say("Show me the data room for Brightmoor.");
    expect(intentOf(answer.blocks)).toEqual([]);
    expect(answer.content).toMatch(/^I can't find "Brightmoor" data room/u);
    expect(answer.content).not.toBe("Understood.");
  });
});
