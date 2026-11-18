import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QRecordPage,
} from "@capital-q/contracts";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import { possessive } from "@capital-q/q-core/speech";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import {
  agreedInMessagesLine,
  callPrepLine,
  meetingStatusLine,
  type CallPrep,
} from "../src/call-prep.js";
import { deckSectionSpeech, deckSpeech } from "../src/deck-speech.js";
import {
  resolveNamedRecord,
  type OpenRecordIntent,
} from "../src/fast-navigation.js";
import {
  namedRecordRequestOf,
  withoutHesitations,
} from "../src/named-record-request.js";
import { openingLine } from "../src/references.js";

/**
 * Owner live voice test, 18 Nov 2026, investor Zino Aviation, conversation
 * b0719e94 (production fb32830d9). Replayed from the stored turns; no live
 * or paid call.
 */

// The counterparts Zino's relationships read held at 11:14 (relationship.own.list).
const ZINO_COUNTERPARTS = [
  "KUUZA AI",
  "SongScribe AI",
  "Coreisk",
  "Halyard Security",
  "Clearwater Assurance",
  "Tensorgate",
  "Ledgerline",
  "Portside",
  "Spheros",
  "Nixo",
  "Kazikit",
  "Tallyloom",
];

const NIXO_ID = "d48c26d2-5aca-4788-9033-073b0f9d08ec";

function opener(opened: { page: QRecordPage; name: string }[]) {
  return (
    page: QRecordPage,
    name: string,
  ): Promise<OpenRecordIntent | null> => {
    opened.push({ page, name });
    if (page === "GATEQ_APPLICATION" && /nixo/iu.test(name)) {
      return Promise.resolve({
        kind: "OPEN_RECORD_PAGE",
        page,
        id: "7c9b7f4f-bb06-4965-82ee-d2794acfdc18",
      } as OpenRecordIntent);
    }
    if (page === "COMPANY" && /nixo/iu.test(name)) {
      return Promise.resolve({
        kind: "OPEN_RECORD_PAGE",
        page,
        id: NIXO_ID,
      } as OpenRecordIntent);
    }
    return Promise.resolve(null);
  };
}

describe("defect 3: a record named with its place (11:25)", () => {
  it("the spoken transcript is read cleaned: no 'um' or 'GateQ um' as a name", () => {
    expect(withoutHesitations("Open um... the Nixo... in gate queue")).toBe(
      "Open the Nixo in gate queue",
    );
    expect(
      withoutHesitations(
        "I didn't say to open the Nixo profile, no. um... The GateQ um... inbox for Nixo, that's what I asked you to open",
      ),
    ).toBe(
      "I didn't say to open the Nixo profile, no. The GateQ inbox for Nixo, that's what I asked you to open",
    );
  });

  for (const said of [
    // 11:25:27, raw and as the reader heard it.
    "Open um... the Nixo... in gate queue",
    "Open the Nixo in GateQ",
    // 11:25:49, raw (the turn that was answered "I can't find "GateQ um"").
    "I didn't say to open the Nixo profile, no. um... The GateQ um... inbox for Nixo, that's what I asked you to open",
    "Open Nixo's GateQ application",
  ]) {
    it(`"${said}" names Nixo's GateQ application`, async () => {
      expect(namedRecordRequestOf(said)).toMatchObject({
        name: "Nixo",
        facet: "GATEQ",
      });
      const opened: { page: QRecordPage; name: string }[] = [];
      const resolved = await resolveNamedRecord({
        text: said,
        side: "INVESTOR",
        counterpartNames: () => Promise.resolve(ZINO_COUNTERPARTS),
        open: opener(opened),
      });
      expect(resolved?.kind).toBe("OPEN");
      if (resolved?.kind !== "OPEN") return;
      expect(resolved.page).toBe("GATEQ_APPLICATION");
      expect(opened.every((one) => one.page !== "COMPANY")).toBe(true);
      expect(resolved.said).toBe("Opening Nixo's GateQ application…");
    });
  }

  it("a place said for the pipeline opens the relationship, not the profile", () => {
    expect(namedRecordRequestOf("Open Nixo in my pipeline")).toMatchObject({
      name: "Nixo",
      facet: "RELATIONSHIP",
    });
  });

  it("a bare name still opens the profile", () => {
    expect(namedRecordRequestOf("Open Nixo")).toMatchObject({
      name: "Nixo",
      facet: "PAGE",
    });
  });
});

// --- the answer seam: a spoken "I can't find X" waits for the reading -----

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(spoken: boolean): QAnswerRequest {
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
    ...(spoken ? { spoken: true } : {}),
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER, organisationId: actor.organisationId },
      purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
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

function seam(said: string) {
  const conversationId = randomUUID();
  const history: QConversationMessage[] = [
    {
      id: randomUUID() as QConversationMessage["id"],
      tenantId: TENANT as QConversationMessage["tenantId"],
      conversationId: conversationId as QConversationMessage["conversationId"],
      runId: randomUUID() as QConversationMessage["runId"],
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ];
  let reads = 0;
  const turns: QTurnReader = {
    read: () => {
      reads += 1;
      return Promise.resolve({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "THEIR_OWN_RECORDS", text: said },
      } as never);
    },
  };
  const stored: string[] = [];
  const delegated: QAnswerRequest[] = [];
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      warm: () => undefined,
      answer: (req) => {
        delegated.push(req);
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "none",
          promptBundleVersion: "b",
        });
      },
    },
    counterpartNames: () => Promise.resolve(ZINO_COUNTERPARTS),
    openRecord: { open: () => Promise.resolve(null) },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve(history),
        mark: () => Promise.resolve(),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          if (input.role === "Q") stored.push(input.content);
          // The repository stamps createdAt; the answer writes none.
          return Promise.resolve({
            ...input,
            createdAt: input.createdAt || new Date().toISOString(),
            id: randomUUID(),
          });
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
  });
  return { answer, stored, delegated, reads: () => reads };
}

describe("defect 3, option (c): the not-found line waits for the reading", () => {
  const said = "Open Zorblax Holdings";

  it("spoken: nothing is said before the reading; the reading's path answers", async () => {
    const s = seam(said);
    await s.answer.answer(request(true));
    expect(s.stored.some((line) => line.startsWith("I can't find"))).toBe(
      false,
    );
    expect(s.reads()).toBe(1);
    expect(s.delegated).toHaveLength(1);
  });

  it("typed: the words are already clean, so the line is said at once", async () => {
    const s = seam(said);
    await s.answer.answer(request(false));
    expect(s.reads()).toBe(0);
    expect(s.stored.some((line) => line.startsWith("I can't find"))).toBe(true);
  });
});

// --- defect 4: "Opening Kazikit's pitch deck's pitch deck" (11:19:27) -----

describe("defect 4: an owned thing is never said twice", () => {
  const deck = {
    viewer: "INVESTOR" as const,
    confirmedByFounder: true,
    sections: [
      {
        section: "PROBLEM",
        status: "PRESENT",
        summary:
          "Kenya's informal building contractors (fundis) need to quote, cost jobs and receive payment using basic Android phones.",
      },
    ],
  } as unknown as Parameters<typeof deckSpeech>[1];

  it("the record's label already names the deck", () => {
    const line = deckSpeech("Kazikit's pitch deck", deck);
    expect(line.startsWith("Opening Kazikit's pitch deck.")).toBe(true);
    expect(line).not.toMatch(/pitch deck's pitch deck/u);
    expect(deckSectionSpeech("Kazikit's pitch deck", "PROBLEM", deck)).toMatch(
      /^Opening the problem section of Kazikit's pitch deck\./u,
    );
    expect(
      deckSpeech("Kazikit", deck).startsWith("Opening Kazikit's pitch deck."),
    ).toBe(true);
  });

  it("no record move line doubles its noun", () => {
    expect(openingLine("COMPANY_DECK", "Kazikit's pitch deck")).toBe(
      "Opening Kazikit's pitch deck…",
    );
    expect(openingLine("COMPANY_DATA_ROOM", "Kazikit's data room")).toBe(
      "Opening Kazikit's data room…",
    );
    expect(possessive("Kazikit", "team")).toBe("Kazikit's team");
    expect(possessive("Kazikit's team", "team")).toBe("Kazikit's team");
    expect(possessive("Smart Deck", "deck")).toBe("Smart Deck's deck");
  });
});

// --- defects 2 and 5: the Tensorgate prep (11:21:34) ----------------------

const DANIEL =
  "Monday 16 November at 10:00 a.m. Africa/Lagos works for me for the 30-minute introductory call.";

function tensorgatePrep(over: Partial<CallPrep> = {}): CallPrep {
  return {
    viewerRole: "INVESTOR",
    counterpartName: "Tensorgate",
    whoTheyAre:
      "Tensorgate is an Austin-based seed-stage company led in the material by Daniel Park, its CTO.",
    soFar:
      "Daniel confirmed Monday 16 November at 10:00 for the introductory call.",
    questions: [
      {
        question: "How do design partners evaluate it?",
        answer: "Listen for buyers.",
      },
    ],
    weakSpots: [{ spot: "Two paid contracts.", handle: "Ask for renewals." }],
    ask: "Propose a follow-up.",
    waiting: [],
    meetings: { booked: [], cancelled: [] },
    ...over,
  };
}

describe("defect 5: where a fact was read is not part of who they are", () => {
  it("'led in the material by' is said 'led by'", () => {
    const line = callPrepLine(tensorgatePrep());
    expect(line).toContain("seed-stage company led by Daniel Park, its CTO.");
    expect(line).not.toMatch(/in the material/u);
  });
});

describe("defect 2: a time agreed in the messages is said, with its source", () => {
  it("with nothing agreed, the calendar's state stands", () => {
    expect(meetingStatusLine(tensorgatePrep())).toBe(
      "No meeting is booked with Tensorgate yet.",
    );
  });

  it("Daniel's confirmation, past: said from the messages, not 'no meeting'", () => {
    const prep = tensorgatePrep({
      meetings: {
        booked: [],
        cancelled: [],
        agreed: [
          {
            startsAt: "2026-11-16T10:00:00+01:00",
            quote: DANIEL,
            passed: true,
          },
        ],
      },
    });
    const line = agreedInMessagesLine(prep) ?? "";
    expect(line).toContain(
      `In your messages with Tensorgate, a call was agreed: "${DANIEL}"`,
    );
    expect(line).toContain("That time has passed");
    expect(callPrepLine(prep)).not.toMatch(/No meeting is booked/u);
  });
});
