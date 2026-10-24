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

import { pendingPlaceOf } from "@capital-q/q-core/speech";

import { continuesQsQuestion, createSpecialistQAnswer } from "../src/answer.js";
import { pageRequestOf, selfCorrected } from "../src/page-request.js";
import { openingLine } from "../src/references.js";
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
      if (target.page === "EXTERNAL_REHEARSAL") {
        return Promise.resolve(
          target.id === SHADI_ID
            ? {
                kind: "OPEN_RECORD_PAGE" as const,
                page: target.page,
                id: SHADI_ID,
              }
            : null,
        );
      }
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

const SHADI_ID = "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d";

/** A researched entity the asker can reach by name (a prepared seed). */
const EXTERNAL = {
  find: (_request: QAnswerRequest, name: string) =>
    Promise.resolve(
      name.toLowerCase() === "shadi qishta"
        ? {
            externalPersonId: SHADI_ID,
            displayName: "Shadi Qishta",
            said: "Here's Shadi Qishta, from public sources.",
            blocks: [
              {
                kind: "ANSWER_CARDS",
                shape: "RESEARCH",
                title: "Who I found",
                cards: [
                  {
                    key: SHADI_ID,
                    name: "Shadi Qishta",
                    line: null,
                    hue: 1,
                    fit: null,
                    reasons: ["Strong match on public sources"],
                    measures: [],
                    view: null,
                    said: null,
                    sourceCount: 1,
                    subject: null,
                  },
                ],
                followUps: [],
              },
            ] as unknown as QResultBlock[],
          }
        : null,
    ),
};

function conversation(
  counterparts: readonly string[],
  investor = true,
  withExternal = false,
) {
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
    ...(withExternal ? { externalEntities: EXTERNAL } : {}),
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
  /** A line Q said earlier in the conversation. */
  const qSaid = (content: string) => {
    lines.push({
      tenantId: TENANT,
      conversationId,
      runId: randomUUID(),
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      role: "Q",
      content,
    } as unknown as QConversationMessage);
  };
  return { say, qSaid, opened, delegated: () => delegated };
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

describe("a company's documents are its data room (owner 2026-10-15)", () => {
  it("reads documents, docs and files of a named company as its data room", () => {
    for (const said of [
      "Open Tensorgate's documents",
      "open the documents for Tensorgate",
      "show me Tensorgate's files",
      "open Tensorgate's docs",
      "open the files of Tensorgate",
    ]) {
      expect(namedRecordRequestOf(said)).toEqual({
        name: "Tensorgate",
        facet: "DATA_ROOM",
        explicit: true,
      });
      expect(pageRequestOf(said)).toBeNull();
    }
    expect(namedRecordRequestOf("open Tensorgate's pitch")).toMatchObject({
      name: "Tensorgate",
      facet: "ELEVATOR",
    });
    expect(namedRecordRequestOf("open Tensorgate's pitch deck")).toMatchObject({
      name: "Tensorgate",
      facet: "DECK",
    });
  });

  it("keeps their own Documents page, and never makes a record of plain words", () => {
    for (const said of ["open my documents", "open documents", "open files"]) {
      expect(namedRecordRequestOf(said)).toBeNull();
      expect(pageRequestOf(said)).toMatchObject({
        kind: "PAGE",
        target: { destination: "DOCUMENTS" },
      });
    }
    expect(namedRecordRequestOf("open documents for my seed round")).toBeNull();
  });

  it("lane S: a lower-case name is held to their own counterparts", () => {
    expect(namedRecordRequestOf("open tensorgate's documents")).toEqual({
      name: "tensorgate",
      facet: "DATA_ROOM",
      explicit: true,
      ownOnly: true,
    });
    expect(namedRecordRequestOf("show me their documents")).toBeNull();
    expect(namedRecordRequestOf("open its files")).toBeNull();
  });

  it("lane S: a kind of company in the plural is a search, not a record", () => {
    for (const said of [
      "show me fintech companies in Nigeria",
      "show me seed-stage startups in Kenya",
      "open climate investors in Lagos",
    ]) {
      expect(namedRecordRequestOf(said)).toBeNull();
    }
    expect(namedRecordRequestOf("open Clearwater Investors")).toMatchObject({
      name: "Clearwater Investors",
    });
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
    // G2-D3: the one pending wording (move-line.ts), so the thread's row
    // flips to "Opened Shiftwell Health." on the browser's VERIFIED receipt.
    expect(answer.content).toBe("Opening Shiftwell Health…");
    expect(pendingPlaceOf(answer.content)).toBe("Shiftwell Health");
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

  it('"Open Shiftwell\'s documents." opens its data room, never its profile', async () => {
    const q = conversation(own);
    const answer = await q.say("Open Shiftwell's documents.");
    // COMPANY_DATA_ROOM is /company/<id>?tab=dataroom (client-actions).
    expect(intentOf(answer.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY_DATA_ROOM", id: SHIFTWELL },
    ]);
    expect(answer.content).toBe("Opening Shiftwell Health's data room…");
  });

  it("lane S: typed in lower case, their own company's documents are still its data room", async () => {
    for (const said of [
      "open shiftwell's documents",
      "show me the files for shiftwell",
    ]) {
      const q = conversation(own);
      const answer = await q.say(said);
      expect(intentOf(answer.blocks)).toEqual([
        { kind: "OPEN_RECORD_PAGE", page: "COMPANY_DATA_ROOM", id: SHIFTWELL },
      ]);
    }
  });

  it('"Show me the data room for Shiftwell." opens Shiftwell\'s data room', async () => {
    const q = conversation(own);
    const answer = await q.say("Show me the data room for Shiftwell.");
    expect(intentOf(answer.blocks)).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY_DATA_ROOM",
        id: SHIFTWELL,
        tab: "dataroom",
      },
    ]);
    expect(answer.content).toBe("Opening Shiftwell Health's data room…");
  });

  it('"You open documents. I want to see the data room for Shiftwell." acts, never asks about documents', async () => {
    const q = conversation(own);
    const answer = await q.say(
      "You open documents. I want to see the data room for Shiftwell.",
    );
    expect(intentOf(answer.blocks)).toEqual([
      {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY_DATA_ROOM",
        id: SHIFTWELL,
        tab: "dataroom",
      },
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

// Owner conversation 2026-10-24 (run 80da02af): Q asked "Want me to find
// three Qatar-based investors whose focus could fit Halyard?", they said
// "Yes. No, not Halyard. Capital Q", and Halyard Security was opened.
describe("a yes or a correction to Q's own question never opens a record", () => {
  const own = ["Shiftwell Health", "Ledgerline", "Nixo"];

  it("never reads the name they said 'not' to as the place", () => {
    expect(
      namedRecordRequestOf("Yes. No, not Shiftwell. Capital Q")?.name,
    ).not.toMatch(/Shiftwell/u);
    expect(selfCorrected("Yes. No, not Shiftwell. Capital Q")).not.toMatch(
      /Shiftwell/u,
    );
  });

  it("continues Q's question: nothing opened, the answer path answers", async () => {
    const q = conversation(own);
    q.qSaid(
      "Want me to find three Qatar-based investors whose focus could fit Shiftwell Health?",
    );
    const answer = await q.say("Yes. No, not Shiftwell. Capital Q");
    expect(intentOf(answer.blocks)).toEqual([]);
    expect(q.opened).toEqual([]);
    expect(q.delegated()).toBe(1);
  });

  it("still opens what they ask to open after Q's question", async () => {
    const q = conversation(own);
    q.qSaid("Want me to compare them?");
    const answer = await q.say("Open Shiftwell.");
    expect(intentOf(answer.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: SHIFTWELL },
    ]);
  });

  it("answers code's own 'which one do you mean?' with that record", () => {
    const history = [
      { role: "USER" as const, content: "Open Shiftwell" },
      {
        role: "Q" as const,
        content: "Which one do you mean: Shiftwell Health or Shiftwell Labs?",
      },
      { role: "USER" as const, content: "Shiftwell Health" },
    ];
    expect(continuesQsQuestion(history, "Shiftwell Health")).toBe(false);
    expect(
      continuesQsQuestion(
        [{ role: "Q", content: "Want me to find three investors?" }],
        "Yes, Capital Q",
      ),
    ).toBe(true);
    // Coordinator replay 2026-10-24: a list that ends inviting a choice.
    expect(
      continuesQsQuestion(
        [
          {
            role: "Q",
            content:
              "Here are three: Kestrel, Savanna and Rift Valley. Tell me which to look into further.",
          },
        ],
        "Yes. No, not Halyard. Capital Q",
      ),
    ).toBe(true);
  });
});

describe("G2-D3: a record move's line is the one pending wording", () => {
  it("names the record as people read it, so the row can flip to Opened", () => {
    const line = openingLine("INVESTOR", "Savanna Seed Partners (fictional)");
    expect(line).toBe("Opening Savanna Seed Partners…");
    expect(pendingPlaceOf(line)).toBe("Savanna Seed Partners");
    expect(pendingPlaceOf(openingLine("COMPANY_DECK", "Tallyloom"))).toBe(
      "Tallyloom's pitch deck",
    );
    expect(pendingPlaceOf(openingLine("DOCUMENT", undefined))).toBe(
      "the document",
    );
  });
});

describe("W4: a researched entity by name, when it is none of their relationships", () => {
  const own = ["Shiftwell Health", "Ledgerline"];

  it('"Take me to Shadi Qishta" / "open Shadi Qishta" show the identity card, not "can\'t find"', async () => {
    for (const said of ["Take me to Shadi Qishta.", "Open Shadi Qishta."]) {
      const q = conversation(own, false, true);
      const answer = await q.say(said);
      expect(answer.content).toBe("Here's Shadi Qishta, from public sources.");
      expect(answer.blocks.map((b) => b.kind)).toEqual(["ANSWER_CARDS"]);
      expect(q.delegated()).toBe(0);
    }
  });

  it('"I want to rehearse with Shadi Qishta" opens /rehearsals/person through open_page', async () => {
    const q = conversation(own, false, true);
    const answer = await q.say("I want to rehearse with Shadi Qishta.");
    expect(intentOf(answer.blocks)).toEqual([
      { kind: "OPEN_RECORD_PAGE", page: "EXTERNAL_REHEARSAL", id: SHADI_ID },
    ]);
    expect(answer.content).toMatch(/AI rehearsal informed by public sources/u);
  });

  it("their own relationship of the same name keeps its own path; an unknown name still says it cannot find it", async () => {
    const q = conversation(["Shadi Qishta"], false, true);
    await q.say("Open Shadi Qishta.");
    expect(q.opened.length).toBeGreaterThan(0);
    const none = conversation(own, false, true);
    const unknown = await none.say("Show me the data room for Brightmoor.");
    expect(unknown.content).toMatch(/can't find/u);
    expect(unknown.blocks.map((b) => b.kind)).not.toContain("ANSWER_CARDS");
  });

  it("without the entity port, nothing changes (still not found)", async () => {
    const q = conversation(own, false, false);
    const answer = await q.say("Take me to Shadi Qishta.");
    expect(answer.blocks.map((b) => b.kind)).not.toContain("ANSWER_CARDS");
  });
});

describe("a language named is not a record (live 2026-10-16)", () => {
  it("leaves any language by name to Q's language tool, never a record (live 2026-10-16)", () => {
    for (const text of [
      "Please switch to French.",
      "switch to Swahili please",
      "go to Spanish",
      "switch to the Portuguese language",
      "switch to français",
    ]) {
      expect(namedRecordRequestOf(text), text).toBeNull();
    }
    // A short word is a word, not a language code.
    expect(namedRecordRequestOf("open Shiftwell")).not.toBeNull();
  });

  it("leaves 'switch to English' and its kin to Q's language tool", () => {
    for (const words of [
      "switch to English",
      "Switch to Arabic please.",
      "can you switch to english now",
      "go to the English language",
    ]) {
      expect(namedRecordRequestOf(words)).toBeNull();
    }
  });

  it("the answer never says it can't find English, and opens nothing", async () => {
    const q = conversation(["Shiftwell Health", "Ledgerline"]);
    const answer = await q.say("switch to English");
    expect(answer.content).not.toMatch(/can't find/u);
    expect(q.opened).toEqual([]);
  });

  it("still reads a record whose name only starts like a language", () => {
    expect(namedRecordRequestOf("open English Bay Capital")?.name).toBe(
      "English Bay Capital",
    );
  });
});
