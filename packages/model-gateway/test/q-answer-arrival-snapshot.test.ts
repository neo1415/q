import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ArrivalSnapshotSchema,
  type ArrivalSnapshot,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { TurnSkimResultSchema } from "@capital-q/q-core";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import {
  arrivalAspectAnswer,
  arrivalFollowUpAnswer,
} from "../src/q/arrival-answer.js";
import { arrivalSnapshotFact } from "../src/q/arrival-fact.js";
import { dailyFollowUpAnswer } from "../src/q/daily-follow-up.js";
import {
  createModelGatewayQAnswer,
  type QTurnSkimmer,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * W1: "Q already knows what it just told me". The welcome said "TensorGate
 * wants to connect"; the follow-ups ("what's the request?", "what did they
 * say?", "did they accept the time?") reach the model with the arrival
 * snapshot's facts already among the authorised facts, and no tool is
 * executed to look anything up again.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const NOW = "2026-10-10T09:00:00.000Z";
const REL = "7b1c0e55-0000-4000-8000-000000000001";
const OTHER = "7b1c0e55-0000-4000-8000-000000000002";

const SNAPSHOT: ArrivalSnapshot = ArrivalSnapshotSchema.parse({
  contractVersion: "arrival-snapshot.v1",
  version: "v-abcdef0123456789",
  asOf: NOW,
  unread: [],
  briefsRead: true,
  activity: null,
  items: [
    {
      key: `interest:${REL}`,
      kind: "INTEREST_REQUEST",
      headline: "TensorGate wants to connect and is waiting for your answer",
      availability: "OK",
      counterpart: {
        kind: "INVESTOR_ORGANISATION",
        id: OTHER,
        name: "TensorGate",
      },
      ids: {
        relationshipId: REL,
        companyId: null,
        investorOrganisationId: OTHER,
        meetingId: null,
        approvalId: null,
        jobId: null,
        documentId: null,
        messageId: null,
      },
      facts: {
        request: {
          kind: "CONNECTION_OR_INTEREST",
          from: "TensorGate",
          since: "2026-10-09T10:00:00.000Z",
          summary: "TensorGate wants to connect and is waiting for your answer",
        },
        messageCount: 2,
        latestMessage: null,
        theirLatestMessage: {
          from: "OTHER_SIDE",
          senderName: "Tensor Gate",
          text: "Could we do Thursday 3pm for a call?",
          kind: "TEXT",
          status: "SENT",
          viaQ: false,
          sentAt: "2026-10-09T15:00:00.000Z",
        },
        meeting: {
          id: "7b1c0e55-0000-4000-8000-000000000003",
          status: "SCHEDULED",
          startsAt: "2026-10-16T15:00:00.000Z",
          endsAt: "2026-10-16T15:30:00.000Z",
          timing: "UPCOMING",
          organisedByYou: false,
          booked: true,
        },
        decisions: [],
        documents: [],
        openRequests: [],
        relationshipState: "CONNECTED",
        suggestedNextAction: null,
        note: null,
      },
      openPath: `/relationships/investor/${OTHER}/messages`,
      decidable: true,
      evidence: [],
      sourceVersions: { historySequence: 7, brief: "relationship-brief.v1" },
      since: "2026-10-09T10:00:00.000Z",
      asOf: NOW,
    },
  ],
});

function build(
  snapshot: () => ArrivalSnapshot | null,
  said: string,
  arrivalSkim?: QTurnSkimmer,
  offered: readonly QOfferedTool[] = [],
  qHistory: readonly string[] = [],
  memory?: { readonly recall: () => Promise<string> },
  stalled?: { readonly assemble: boolean },
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer: "Here is what I already have on TensorGate.",
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
  const messages = [
    ...qHistory.map(
      (content) =>
        ({
          id: randomUUID(),
          tenantId: TENANT,
          conversationId: CONVERSATION,
          runId: RUN,
          role: "Q",
          content,
          contentType: "TEXT",
          createdAt: "2026-10-10T08:59:00.000Z",
        }) as unknown as QConversationMessage,
    ),
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: NOW,
    } as unknown as QConversationMessage,
  ];
  const executed: QToolProposal[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([...offered]),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.reject(new Error("no tool read is expected"));
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) => {
        persisted.push(input.content);
        return Promise.resolve({
          ...messages[messages.length - 1],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: {
      append: (...args: unknown[]) => {
        events.push(JSON.stringify(args));
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const persisted: string[] = [];
  const events: string[] = [];
  let snapshotReads = 0;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    ...(arrivalSkim === undefined ? {} : { arrivalSkim }),
    ...(memory === undefined ? {} : { memory }),
    ...(stalled?.assemble === true
      ? {
          // Context assembly and the profile read that never finish.
          context: { assemble: () => new Promise<never>(() => undefined) },
          communication: {
            profileFor: () => new Promise<never>(() => undefined),
          },
        }
      : {}),
    arrivalSnapshot: () => {
      snapshotReads += 1;
      return Promise.resolve(snapshot());
    },
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
    turnKind: "QUESTION_TO_Q",
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return {
    seam,
    request,
    alpha,
    executed,
    persisted,
    events,
    reads: () => snapshotReads,
  };
}

function promptOf(alpha: {
  calls: readonly { request: { messages: readonly { content: string }[] } }[];
}): string {
  const sent = alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");
  return sent.slice(Math.max(0, sent.indexOf("AUTHORISED FACTS")));
}

describe("other questions on the arrival items reach the model with the snapshot facts", () => {
  for (const [said, facts] of [
    [
      "is there anything else on TensorGate I should know?",
      ["TensorGate wants to connect", "The request:"],
    ],
    [
      "how is the TensorGate thread going?",
      ["Could we do Thursday 3pm for a call?"],
    ],
    [
      "where do we stand with TensorGate on timing?",
      ["booked", "2026-10-16 15:00 UTC"],
    ],
  ] as const) {
    it(`"${said}" reaches the model with the facts and no tool read`, async () => {
      const { seam, request, alpha, executed, reads } = build(
        () => SNAPSHOT,
        said,
      );
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      const prompt = promptOf(alpha);
      for (const fact of facts) expect(prompt).toContain(fact);
      expect(prompt).toContain("do not look them up again");
      expect(executed).toEqual([]);
      expect(reads()).toBe(1);
    });
  }

  it("serves nothing when the snapshot is withheld (revoked or unreadable)", async () => {
    const { seam, request, alpha, executed } = build(
      () => null,
      "what's the request?",
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const prompt = promptOf(alpha);
    expect(prompt).not.toContain("Could we do Thursday 3pm");
    expect(prompt).not.toContain("What Q already told them on arrival");
    expect(executed).toEqual([]);
  });

  it("says UNAVAILABLE for a detail that could not be read, never an empty history", () => {
    const first = SNAPSHOT.items[0];
    if (first === undefined) throw new Error("fixture");
    const fact = arrivalSnapshotFact({
      ...SNAPSHOT,
      items: [{ ...first, availability: "UNAVAILABLE" }],
    });
    expect(fact?.statement).toContain("UNAVAILABLE");
    expect(fact?.statement).toContain("do not guess");
  });
});

describe("an arrival follow-up is answered by code, with no tool and no model round", () => {
  for (const [said, expected] of [
    [
      "what's the request?",
      ["TensorGate wants to connect", "Could we do Thursday 3pm for a call?"],
    ],
    [
      "what did they say?",
      ["Tensor Gate wrote", "Could we do Thursday 3pm for a call?"],
    ],
    ["did they accept the time?", ["booked", "2026-10-16 15:00 UTC"]],
  ] as const) {
    it(`"${said}" has zero tool calls and zero model calls`, async () => {
      const { seam, request, alpha, executed, persisted } = build(
        () => SNAPSHOT,
        said,
      );
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      expect(executed).toEqual([]);
      expect(alpha.calls).toHaveLength(0);
      for (const text of expected) expect(persisted.join("\n")).toContain(text);
    });
  }

  it("never waits for memory recall: the code answer needs none (speed lane 2026-10-20)", async () => {
    let recalls = 0;
    const { seam, request, alpha, persisted } = build(
      () => SNAPSHOT,
      "what did they say?",
      undefined,
      [],
      [],
      {
        // A recall that never answers (an embedding provider stalled).
        recall: () => {
          recalls += 1;
          return new Promise<string>(() => undefined);
        },
      },
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(0);
    expect(persisted.join(" ")).toContain("Could we do Thursday 3pm");
    // Recall was still asked for; only nothing waited on it.
    expect(recalls).toBe(1);
  });

  it("never waits for context assembly or the profile read (arrival row 22)", async () => {
    const { seam, request, alpha, persisted, events } = build(
      () => SNAPSHOT,
      "what's the request?",
      undefined,
      [],
      [],
      undefined,
      { assemble: true },
    );
    // Before: the code answer waited for prepareTurn's assemble and
    // profile, so a stalled read held it (this await never returned).
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(0);
    expect(persisted.join(" ")).toContain("Could we do Thursday 3pm");
    expect(events.join(" ")).toContain("q.message.completed");
  });

  it("the early answer is the full path's: same words when nothing stalls", async () => {
    const late = build(() => SNAPSHOT, "what did they say?");
    const early = build(
      () => SNAPSHOT,
      "what did they say?",
      undefined,
      [],
      [],
      undefined,
      { assemble: true },
    );
    await late.seam.answer(late.request);
    await early.seam.answer(early.request);
    expect(early.persisted).toEqual(late.persisted);
  });

  it("when the snapshot is withheld the normal path handles it", async () => {
    const { seam, request, alpha } = build(() => null, "what's the request?");
    await seam.answer(request);
    expect(alpha.calls.length).toBeGreaterThan(0);
  });

  it("does not guess between two items without a name, nor ask: the answer path takes it (QA F-24)", () => {
    const first = SNAPSHOT.items[0];
    if (first === undefined) throw new Error("fixture");
    const two = {
      ...SNAPSHOT,
      items: [
        first,
        {
          ...first,
          key: "other",
          counterpart: { ...first.counterpart, id: REL, name: "Halyard" },
        },
      ],
    } as ArrivalSnapshot;
    expect(arrivalFollowUpAnswer("what's the request?", two)).toBeNull();
    expect(
      arrivalFollowUpAnswer("what's the request from Halyard?", two)?.itemKey,
    ).toBe("other");
  });

  it("lane S: a follow-up that names no one continues their own last turn", () => {
    // Audit 10-11 20:24: "let me see what Spheros is saying", answered;
    // then "open the chat, let me see it myself" asked which one.
    const first = SNAPSHOT.items[0];
    if (first === undefined) throw new Error("fixture");
    const two = {
      ...SNAPSHOT,
      items: [
        first,
        {
          ...first,
          key: "other",
          counterpart: { ...first.counterpart, id: REL, name: "Halyard" },
        },
      ],
    } as ArrivalSnapshot;
    expect(
      arrivalFollowUpAnswer("what's the request?", two, [
        "Tell me about my day",
        "let me see what Halyard is saying",
      ])?.itemKey,
    ).toBe("other");
    // Their latest naming wins; Q's own words are never passed in.
    expect(
      arrivalFollowUpAnswer("what's the request?", two, [
        "let me see what Halyard is saying",
        `and ${String(first.counterpart?.name)}?`,
      ])?.itemKey,
    ).toBe(first.key);
    // Two named in that turn, or none at all: never a guess and never
    // "which one" (QA F-24): the answer path reads them all.
    for (const earlier of [
      [`Halyard and ${String(first.counterpart?.name)}`],
      ["good morning"],
      [],
    ]) {
      expect(
        arrivalFollowUpAnswer("what's the request?", two, earlier),
      ).toBeNull();
    }
  });
});

describe("a named counterparty the arrival did not mention goes to the normal path (journey A2)", () => {
  it("never answers about the arrival's counterparty when the turn names another", () => {
    expect(
      arrivalFollowUpAnswer(
        "Ledgerfold: did they accept the meeting?",
        SNAPSHOT,
      ),
    ).toBeNull();
    expect(
      arrivalFollowUpAnswer("Did Ledgerfold accept the meeting?", SNAPSHOT),
    ).toBeNull();
  });

  it("still answers the arrival's own counterparty, named or pointed at, from the brief's call", () => {
    for (const said of [
      "Did they accept the meeting?",
      "TensorGate: did they accept the meeting?",
    ]) {
      expect(arrivalFollowUpAnswer(said, SNAPSHOT)?.text).toContain(
        "booked for 2026-10-16 15:00 UTC",
      );
    }
  });
});

describe("unusual phrasings are read by TURN_SKIM and still answered with no tool", () => {
  const WITH_NEXT: ArrivalSnapshot = ArrivalSnapshotSchema.parse({
    ...SNAPSHOT,
    items: SNAPSHOT.items.map((item) => ({
      ...item,
      facts: {
        ...item.facts,
        suggestedNextAction: {
          kind: "ANSWER_INTEREST",
          owner: "YOU",
          label: "Answer their request to connect",
        },
      },
    })),
  });
  const KEY = `interest:${REL}`;

  function skimmed(said: string, reading: Record<string, unknown> | null) {
    const seen: { items: readonly { key: string }[]; utterance: string }[] = [];
    const skimmer: QTurnSkimmer = {
      skim: (input) => {
        seen.push({
          items: input.arrivalItems ?? [],
          utterance: input.utterance,
        });
        return Promise.resolve(
          reading === null
            ? null
            : TurnSkimResultSchema.parse({ confidence: "HIGH", ...reading }),
        );
      },
    };
    const scene = build(() => WITH_NEXT, said, skimmer);
    return { ...scene, seen };
  }

  const PARAPHRASES: readonly (readonly [
    string,
    "REQUEST" | "THEIR_MESSAGE" | "MEETING" | "NEXT_STEP",
    string,
  ])[] = [
    ["so what did TensorGate want?", "REQUEST", "TensorGate wants to connect"],
    ["any word back on the meeting?", "MEETING", "is booked"],
    ["wetin dem talk?", "THEIR_MESSAGE", "Could we do Thursday 3pm"],
    ["abeg, dem don agree to the time?", "MEETING", "2026-10-16 15:00 UTC"],
    [
      "okay, and what should I do about them?",
      "NEXT_STEP",
      "Answer their request to connect",
    ],
  ];

  for (const [said, aspect, expected] of PARAPHRASES) {
    it(`"${said}" -> ${aspect}: zero tool calls, zero analyst calls`, async () => {
      const { seam, request, alpha, executed, persisted, seen } = skimmed(
        said,
        { kind: "ARRIVAL_FOLLOWUP", arrival: { item: KEY, aspect } },
      );
      expect((await seam.answer(request)).kind).toBe("ANSWERED");
      expect(seen).toHaveLength(1);
      expect(seen[0]?.items.map((i) => i.key)).toEqual([KEY]);
      expect(executed).toEqual([]);
      expect(alpha.calls).toHaveLength(0);
      expect(persisted.join("\n")).toContain(expected);
    });
  }

  it("a LOW confidence reading, a key the snapshot lacks, or a failed skim leaves it to the analyst", async () => {
    for (const reading of [
      {
        kind: "ARRIVAL_FOLLOWUP",
        confidence: "LOW",
        arrival: { item: KEY, aspect: "REQUEST" },
      },
      {
        kind: "ARRIVAL_FOLLOWUP",
        arrival: { item: "interest:nope", aspect: "REQUEST" },
      },
      null,
    ]) {
      const { seam, request, alpha } = skimmed(
        "so what did TensorGate want?",
        reading,
      );
      await seam.answer(request);
      expect(alpha.calls.length).toBeGreaterThan(0);
    }
  });

  it("a turn that points at nothing never asks the skim", async () => {
    const none = skimmed("hello", { kind: "OTHER" });
    await none.seam.answer(none.request);
    expect(none.seen).toHaveLength(0);
  });

  it("a named lookup never asks the skim (live 2026-10-10: ~0.9 s per lookup)", async () => {
    const lookup = skimmed("who is TensorGate?", {
      kind: "ARRIVAL_FOLLOWUP",
      arrival: { item: KEY, aspect: "REQUEST" },
    });
    await lookup.seam.answer({
      ...lookup.request,
      questionKind: "PERSON_SEARCH",
      personSearch: {
        name: "TensorGate",
        entityKind: "ORGANIZATION",
        city: null,
        country: null,
        organization: null,
        role: null,
        freshSearch: false,
      },
    });
    expect(lookup.seen).toHaveLength(0);
  });
});

describe("several items from one counterpart are one target (A3)", () => {
  const first = SNAPSHOT.items[0];
  if (first === undefined) throw new Error("fixture");
  const maji = (key: string, since: string, summary: string, extra = {}) => ({
    ...first,
    key,
    since,
    counterpart: {
      kind: "INVESTOR_ORGANISATION",
      id: OTHER,
      name: "Maji Loop",
    },
    facts: {
      ...first.facts,
      request: {
        kind: "CONNECTION_OR_INTEREST",
        from: "Maji Loop",
        since,
        summary,
      },
      ...extra,
    },
  });
  const THREE: ArrivalSnapshot = ArrivalSnapshotSchema.parse({
    ...SNAPSHOT,
    items: [
      maji("a", "2026-10-09T10:00:00.000Z", "Maji Loop wants to connect"),
      maji(
        "b",
        "2026-10-10T08:00:00.000Z",
        "Maji Loop is waiting for your reply",
      ),
      maji(
        "c",
        "2026-10-08T08:00:00.000Z",
        "Maji Loop asked for the cap table",
        {
          theirLatestMessage: null,
          meeting: null,
        },
      ),
    ],
  });

  it("answers by code from the merged facts, most recent request first", async () => {
    const { seam, request, alpha, executed, persisted } = build(
      () => THREE,
      "what's the request?",
    );
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    expect(executed).toEqual([]);
    const said = persisted.join("\n");
    expect(said.indexOf("waiting for your reply")).toBeLessThan(
      said.indexOf("wants to connect"),
    );
    expect(said).toContain("Also:");
    expect(said).toContain("asked for the cap table");
    expect(said).toContain("Could we do Thursday 3pm");
  });

  it("never asks which one: several counterparts and none named go to the answer path (QA F-24)", () => {
    const other = {
      ...THREE.items[0],
      key: "z",
      counterpart: { kind: "INVESTOR_ORGANISATION", id: REL, name: "Halyard" },
    };
    const mixed = ArrivalSnapshotSchema.parse({
      ...THREE,
      items: [...THREE.items, other],
    });
    expect(arrivalFollowUpAnswer("what's the request?", mixed)).toBeNull();
    expect(
      arrivalFollowUpAnswer(
        "Who has shown interest in us, and what do they want?",
        mixed,
      ),
    ).toBeNull();
    expect(
      arrivalFollowUpAnswer("what's the request from Halyard?", mixed)?.itemKey,
    ).toBe("z");
  });

  it("the semantic path merges the counterpart's items too", () => {
    const answer = arrivalAspectAnswer(THREE, "c", "REQUEST");
    expect(answer?.text).toContain("waiting for your reply");
  });
});

describe("open the conversation (A5)", () => {
  const pending: ArrivalSnapshot = ArrivalSnapshotSchema.parse({
    ...SNAPSHOT,
    items: SNAPSHOT.items.map((item) => ({
      ...item,
      hasConversation: false,
      openPath: `/relationships/investor/${OTHER}`,
    })),
  });

  it("says there is no conversation yet and offers the relationship page", async () => {
    const { seam, request, alpha, executed, persisted, events } = build(
      () => pending,
      "open the conversation",
    );
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    expect(executed).toEqual([]);
    const said = persisted.join("\n");
    expect(said).toContain("no conversation with TensorGate yet");
    expect(said).toContain("relationship");
    expect(said).not.toMatch(/opening your conversation/iu);
    // And it really moves them to the relationship page (the browser
    // confirms the move), not only says so.
    const sent = events.join("\n");
    expect(sent).toContain("OPEN_RECORD_PAGE");
    expect(sent).toContain('"page":"RELATIONSHIP_INVESTOR"');
    expect(sent).toContain(OTHER);
  });

  it("with a thread it opens the chat itself", async () => {
    const live = ArrivalSnapshotSchema.parse({
      ...SNAPSHOT,
      items: SNAPSHOT.items.map((item) => ({ ...item, hasConversation: true })),
    });
    const { seam, request, alpha, events } = build(
      () => live,
      "open the conversation",
    );
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    const sent = events.join("\n");
    expect(sent).toContain("OPEN_RECORD_PAGE");
    expect(sent).toContain("RELATIONSHIP_INVESTOR_MESSAGES");
  });

  it("the prepared fact tells the model not to claim a chat that does not exist", () => {
    expect(arrivalSnapshotFact(pending)?.statement).toContain(
      "no conversation yet",
    );
  });
});

describe("a matched arrival follow-up reads no tool at all (V2: six prefetch reads)", () => {
  const offered: QOfferedTool[] = [
    "get_relationship",
    "get_company",
    "list_pending_approvals",
    "list_q_work",
    "list_own_relationships",
    "list_schedule",
  ].map((name) => ({
    toolName: `${name}.read`,
    toolVersion: 1,
    classification: "READ_ONLY",
    definition: {
      name,
      description: name,
      inputJsonSchema: { type: "object", properties: {} },
    },
    visibleStage: null,
  }));

  for (const said of [
    "what's the request?",
    "what did they say?",
    "did they accept the time?",
  ]) {
    it(`"${said}" executes zero tools even with the prefetch tools offered`, async () => {
      const { seam, request, alpha, executed } = build(
        () => SNAPSHOT,
        said,
        undefined,
        offered,
      );
      await seam.answer(request);
      expect(executed).toEqual([]);
      expect(alpha.calls).toHaveLength(0);
    });
  }

  // Speed lane C (2026-10-12): the semantic skim no longer holds the reads
  // (it held every follow-up that named anyone, 1.0-2.7 s in production);
  // they run beside it and are discarded when it answers. The answer is
  // still code's, with no analyst call.
  it("a semantic (skim) match is still answered by code, its reads run beside it", async () => {
    const skimmer: QTurnSkimmer = {
      skim: () =>
        Promise.resolve(
          TurnSkimResultSchema.parse({
            kind: "ARRIVAL_FOLLOWUP",
            confidence: "HIGH",
            arrival: { item: `interest:${REL}`, aspect: "REQUEST" },
          }),
        ),
    };
    const { seam, request, alpha, persisted } = build(
      () => SNAPSHOT,
      "so what did TensorGate want?",
      skimmer,
      offered,
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(0);
    expect(persisted.join("\n")).toContain("TensorGate wants to connect");
  });

  it("control: another question still runs its prefetch reads", async () => {
    const { seam, request, executed } = build(
      () => SNAPSHOT,
      "how is my day looking?",
      undefined,
      offered,
    );
    await seam.answer(request);
    expect(executed.length).toBeGreaterThan(0);
  });

  it("an arrival question the snapshot cannot answer keeps its reads for the analyst", async () => {
    const { seam, request, executed } = build(
      () => null,
      "what's the request?",
      undefined,
      offered,
    );
    await seam.answer(request);
    expect(executed.length).toBeGreaterThan(0);
  });
});

/**
 * Speed lane C (production 2026-10-12, runs 6027a668 / b5eb0a12 /
 * decbdddf): the arrival skim (snapshot read + a FAST_CLASSIFICATION call,
 * 0.75-2.4 s) held every prefetch read, so every follow-up naming anyone
 * waited for it before Q could start. Fake timed ports: a skim that takes
 * SKIM_MS. Before: the answer could not start until it returned. After:
 * the reads run beside it and the answer waits at most the grace.
 */
describe("speed lane C: a slow arrival skim no longer holds the answer", () => {
  const SKIM_MS = 600;
  const slowSkim = (
    reading: Record<string, unknown> | null,
  ): { skimmer: QTurnSkimmer; done: () => number | null } => {
    let doneAt: number | null = null;
    return {
      skimmer: {
        skim: async () => {
          await new Promise((resolve) => setTimeout(resolve, SKIM_MS));
          doneAt = Date.now();
          return reading === null
            ? null
            : TurnSkimResultSchema.parse({ confidence: "HIGH", ...reading });
        },
      },
      done: () => doneAt,
    };
  };

  it("an ordinary follow-up naming a counterpart reaches the model before the skim returns", async () => {
    const { skimmer } = slowSkim({ kind: "OTHER" });
    const { seam, request, alpha } = build(
      () => SNAPSHOT,
      "How does TensorGate compare with what I usually back?",
      skimmer,
    );
    const started = Date.now();
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const elapsed = Date.now() - started;
    console.info(
      `[speed-lane-c] arrival skim ${String(SKIM_MS)} ms: answer completed in ${String(elapsed)} ms`,
    );
    expect(alpha.calls.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(SKIM_MS);
  });

  it("a skim that would have matched, but too late, leaves the answer to the analyst with the arrival facts", async () => {
    const { skimmer } = slowSkim({
      kind: "ARRIVAL_FOLLOWUP",
      arrival: { item: `interest:${REL}`, aspect: "REQUEST" },
    });
    const { seam, request, alpha } = build(
      () => SNAPSHOT,
      "so what did TensorGate want?",
      skimmer,
    );
    const started = Date.now();
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(Date.now() - started).toBeLessThan(SKIM_MS);
    expect(alpha.calls.length).toBeGreaterThan(0);
    // Nothing is lost: the snapshot the skim would have answered from is
    // among the facts the analyst answers from.
    expect(promptOf(alpha)).toContain("TensorGate wants to connect");
  });

  it("a follow-up code recognises still waits for its own decision (no reads, no model)", async () => {
    const { skimmer } = slowSkim(null);
    const { seam, request, alpha } = build(
      () => SNAPSHOT,
      "what's the request?",
      skimmer,
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(alpha.calls).toHaveLength(0);
  });
});

describe("K6: the arrival skim runs beside the turn, and only when it can matter", () => {
  const countingSkimmer = () => {
    const starts: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const skimmer: QTurnSkimmer = {
      skim: async (input) => {
        starts.push(input.utterance);
        await gate;
        return null;
      },
    };
    return { skimmer, starts, release: () => release?.() };
  };

  it("starts at warm time, before anything else has finished", async () => {
    const { skimmer, starts, release } = countingSkimmer();
    const { seam, request } = build(
      () => SNAPSHOT,
      "any word back from them?",
      skimmer,
    );
    seam.warm?.(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // In flight (its gate is still closed) before the answer was asked for.
    expect(starts).toEqual(["any word back from them?"]);
    release();
    await seam.answer(request);
  });

  it("is not asked for a mandate question, or when the snapshot has no items", async () => {
    const mandate = countingSkimmer();
    mandate.release();
    const a = build(
      () => SNAPSHOT,
      "What is my mandate? Remind me.",
      mandate.skimmer,
    );
    await a.seam.answer(a.request);
    expect(mandate.starts).toEqual([]);

    const empty = countingSkimmer();
    empty.release();
    const b = build(
      () => ({ ...SNAPSHOT, items: [] }),
      "any word back from them?",
      empty.skimmer,
    );
    await b.seam.answer(b.request);
    expect(empty.starts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P4: the quiet-day Q Daily stories, answered by code from the snapshot.

const EDITION = "7b1c0e55-0000-4000-8000-0000000000e1";
const story = (
  id: string,
  headline: string,
  summary: string,
  sectionCode = "YOUR_SECTOR",
) => ({
  editionId: EDITION,
  editionDate: "2026-10-09",
  sectionCode,
  storyId: id,
  headline,
  summary,
  detail: `${summary} More detail follows here.`,
  sources: [
    {
      publisher: "TechCabal",
      title: headline,
      url: "https://techcabal.com/x",
      publishedAt: null,
    },
  ],
  publishedAt: "2026-10-09T06:00:00.000Z",
  path: `/daily/${EDITION}#story-${id}`,
  sectionPath:
    sectionCode === "LEAD" ? null : `/daily/${EDITION}#section-${sectionCode}`,
});
const QUIET: ArrivalSnapshot = ArrivalSnapshotSchema.parse({
  contractVersion: "arrival-snapshot.v2",
  version: "v-quiet",
  asOf: NOW,
  unread: [],
  briefsRead: true,
  activity: null,
  items: [],
  daily: [
    story(
      "s1",
      "Lagos fintech Paystack Labs raises $20 million.",
      "Paystack Labs closed a $20 million round led by a global fund.",
    ),
    story(
      "s2",
      "Nigeria cuts fintech licence fees",
      "The central bank lowered licence fees for payment startups.",
    ),
  ],
});

describe("P4: quiet-day Daily follow-ups run by code (no model, no tool)", () => {
  const welcomeHistory = [
    "Good morning, Zino. Two stories from the 9 October Daily: Lagos fintech Paystack Labs raises $20 million, and Nigeria cuts fintech licence fees. Want the gist of either?",
  ];

  it("gist of the story the welcome named alone, with no model call", async () => {
    const one = ArrivalSnapshotSchema.parse({
      ...QUIET,
      daily: [QUIET.daily[0]],
    });
    const { seam, request, alpha, executed, persisted } = build(
      () => one,
      "give me the gist",
    );
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    expect(executed).toEqual([]);
    expect(persisted.join("\n")).toContain("closed a $20 million round");
    expect(persisted.join("\n")).toContain("According to TechCabal");
  });

  it.each([
    "tell me more",
    "what's the full story",
    "give me the gist",
    "can you give me the short version",
    "tell me more about it",
    "what's it about",
  ])("%s -> the prepared story text, no model", async (said) => {
    const one = ArrivalSnapshotSchema.parse({
      ...QUIET,
      daily: [QUIET.daily[1]],
    });
    const { seam, request, alpha, persisted } = build(() => one, said);
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    expect(persisted.join("\n")).toContain("licence fees");
  });

  it.each([
    "open it",
    "take me there",
    "show me that story",
    "pull it up",
    "let me see it",
    "open the story",
  ])("%s -> the exact story, never the Daily home", async (said) => {
    const one = ArrivalSnapshotSchema.parse({
      ...QUIET,
      daily: [QUIET.daily[0]],
    });
    const { seam, request, alpha, events } = build(() => one, said);
    await seam.answer(request);
    expect(alpha.calls).toHaveLength(0);
    const sent = events.join("\n");
    expect(sent).toContain('"page":"DAILY_EDITION"');
    expect(sent).toContain(EDITION);
    expect(sent).toContain('"anchor":"story-s1"');
  });

  it("show me that section opens the section anchor", async () => {
    const one = ArrivalSnapshotSchema.parse({
      ...QUIET,
      daily: [QUIET.daily[0]],
    });
    const { seam, request, events, persisted } = build(
      () => one,
      "show me that section",
    );
    await seam.answer(request);
    expect(events.join("\n")).toContain('"anchor":"section-YOUR_SECTOR"');
    expect(persisted.join("\n")).toContain("your sector");
  });

  it("two stories were named: asks which, then 'the second one' opens that one", async () => {
    const ask = build(() => QUIET, "open it", undefined, [], welcomeHistory);
    await ask.seam.answer(ask.request);
    expect(ask.alpha.calls).toHaveLength(0);
    expect(ask.persisted.join("\n")).toMatch(/which one/iu);
    expect(ask.events.join("\n")).not.toContain("OPEN_RECORD_PAGE");
    const second = build(
      () => QUIET,
      "open the second one",
      undefined,
      [],
      welcomeHistory,
    );
    await second.seam.answer(second.request);
    expect(second.alpha.calls).toHaveLength(0);
    expect(second.events.join("\n")).toContain('"anchor":"story-s2"');
  });

  it("the referent is the story Q last mentioned, not the welcome's first", async () => {
    const said = [
      ...welcomeHistory,
      "Nigeria cuts fintech licence fees. The central bank lowered licence fees for payment startups. According to TechCabal. Want more, or shall I open it?",
    ];
    const { seam, request, events } = build(
      () => QUIET,
      "open it",
      undefined,
      [],
      said,
    );
    await seam.answer(request);
    expect(events.join("\n")).toContain('"anchor":"story-s2"');
  });

  it("no stories prepared: nothing is invented, the normal path runs", async () => {
    const none = ArrivalSnapshotSchema.parse({ ...QUIET, daily: [] });
    const { seam, request, alpha, persisted } = build(
      () => none,
      "give me the gist",
    );
    await seam.answer(request);
    expect(alpha.calls.length).toBeGreaterThan(0);
    expect(persisted.join("\n")).not.toContain("TechCabal");
  });

  it("the last thing Q said was about something else: 'open it' is not the Daily", async () => {
    const { seam, request, events } = build(
      () => QUIET,
      "open it",
      undefined,
      [],
      ["Halyard is waiting for your reply."],
    );
    await seam.answer(request);
    expect(events.join("\n")).not.toContain("DAILY_EDITION");
  });

  it("the prepared fact carries the stories for Q's turns too", () => {
    const fact = arrivalSnapshotFact(QUIET);
    expect(fact?.statement).toContain("Paystack Labs");
    expect(fact?.statement).toContain(`/daily/${EDITION}#story-s1`);
    expect(fact?.statement).toContain("Nothing is waiting on them");
  });
});

describe("Daily follow-ups after two stories (live 2026-10-11)", () => {
  const welcome = [
    "Good morning. Two stories from the 9 October Daily: Lagos fintech Paystack Labs raises $20 million, and Nigeria cuts fintech licence fees. Want the gist of either?",
  ];

  it("a gist of two stories speaks the first and names the other", () => {
    const reply = dailyFollowUpAnswer("give me the gist", QUIET, welcome);
    expect(reply?.text).toMatch(
      /^Lagos fintech Paystack Labs raises \$20 million/u,
    );
    expect(reply?.text).toContain(
      "The other story was Nigeria cuts fintech licence fees",
    );
    expect(reply?.itemKey).toBe("daily:s1");
  });

  it("'open it' after that gist opens the story just summarised", () => {
    const gist = dailyFollowUpAnswer("give me the gist", QUIET, welcome);
    const open = dailyFollowUpAnswer("take me to the story", QUIET, [
      ...welcome,
      gist?.text ?? "",
    ]);
    expect(open?.open).toEqual({
      page: "DAILY_EDITION",
      id: EDITION,
      anchor: "story-s1",
    });
  });

  it("a bare 'the second one' picks that story's gist", () => {
    const reply = dailyFollowUpAnswer("the second one", QUIET, welcome);
    expect(reply?.text).toMatch(/^Nigeria cuts fintech licence fees/u);
  });

  it("an ordinal about something else is not a Daily reply", () => {
    expect(dailyFollowUpAnswer("the first company", QUIET, welcome)).toBeNull();
  });
});

describe("the story Q talked about in its own words (live 2026-10-11)", () => {
  it("'take me to the story' after a paraphrase of story two opens story two", () => {
    const open = dailyFollowUpAnswer("take me to the story", QUIET, [
      "The other story: Nigeria's central bank cut fintech licence fees for payment startups.",
    ]);
    expect(open?.open).toEqual({
      page: "DAILY_EDITION",
      id: EDITION,
      anchor: "story-s2",
    });
  });
});

describe("a bare ordinal from the Daily lane reaches the Daily answer", () => {
  it("'the other one' with questionKind DAILY_FOLLOW_UP is answered by code", () => {
    const reply = dailyFollowUpAnswer("the other one", QUIET, [
      "Lagos fintech Paystack Labs raises $20 million. Paystack Labs closed a $20 million round. The other story was Nigeria cuts fintech licence fees. Want that one, or shall I open this one?",
    ]);
    expect(reply?.text).toMatch(/^Nigeria cuts fintech licence fees/u);
  });
});
