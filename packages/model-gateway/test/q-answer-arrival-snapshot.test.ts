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
          ...messages[0],
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

  it("when the snapshot is withheld the normal path handles it", async () => {
    const { seam, request, alpha } = build(() => null, "what's the request?");
    await seam.answer(request);
    expect(alpha.calls.length).toBeGreaterThan(0);
  });

  it("does not guess between two items without a name", () => {
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
    expect(arrivalFollowUpAnswer("what's the request?", two)?.text).toContain(
      "Which one",
    );
    expect(
      arrivalFollowUpAnswer("what's the request from Halyard?", two)?.itemKey,
    ).toBe("other");
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

  it("asks which one only when the counterparts differ", () => {
    const other = {
      ...THREE.items[0],
      key: "z",
      counterpart: { kind: "INVESTOR_ORGANISATION", id: REL, name: "Halyard" },
    };
    const mixed = ArrivalSnapshotSchema.parse({
      ...THREE,
      items: [...THREE.items, other],
    });
    expect(arrivalFollowUpAnswer("what's the request?", mixed)?.text).toBe(
      "Which one do you mean: Maji Loop or Halyard?",
    );
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

  it("a semantic (skim) match reads no tool either", async () => {
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
    const { seam, request, executed } = build(
      () => SNAPSHOT,
      "so what did TensorGate want?",
      skimmer,
      offered,
    );
    await seam.answer(request);
    expect(executed).toEqual([]);
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
