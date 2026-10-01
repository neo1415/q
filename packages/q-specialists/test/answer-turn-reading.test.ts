import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import {
  createToolHandOverPort,
  type QHandOverPort,
} from "../src/hand-over.js";
import type { PendingDecisionPort } from "../src/pending-decision.js";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import { Q_CAPABILITIES } from "@capital-q/q-tools";
import type { TurnReaderV8Result as TurnReaderResult } from "@capital-q/q-core";
import type {
  ContextFirewallPort,
  QAnswerOutcome,
  QAnswerRequest,
  QToolCallOutcome,
  QToolExecutionContext,
  QToolProposal,
  QConversationMessage,
  QResearchDirective,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer, unknownScreenLine } from "../src/answer.js";

/**
 * Every general turn to Q is read before it is answered (CQ-QX-005):
 * the conversation core decides from the reading whether the public web
 * may be read, and a failed answer is named once by the subsystem that
 * failed — deterministic doubles, code asserts.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const CONVERSATION = randomUUID();

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(): QAnswerRequest {
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
      purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
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

function seam(options: {
  readonly said: string;
  readonly reading: TurnReaderResult | null | (() => TurnReaderResult | null);
  readonly outcomes: readonly QAnswerOutcome[];
  readonly visibility?: {
    noteVisibility: (entry: Record<string, unknown>) => void;
  };
  readonly offeredTools?: readonly string[];
  /** A spoken turn: stored with the recogniser's utterance. */
  readonly spoken?: boolean;
  /** The company analysis takes the question (default: it never does). */
  readonly specialistSupports?: boolean;
  /** Earlier lines of the conversation, oldest first. */
  readonly earlier?: readonly {
    readonly role: "USER" | "Q";
    readonly content: string;
  }[];
  /** A typed decision on a waiting change (founder fixture #1). */
  readonly pendingDecisions?: PendingDecisionPort;
  /** A hand-over prepared by code (TURN_READER v22). */
  readonly handOver?: QHandOverPort;
}) {
  const message: QConversationMessage = {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role: "USER",
    content: options.said,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    ...(options.spoken === true ? { utteranceRef: "utt-1" } : {}),
  };
  const directives: (QResearchDirective | undefined)[] = [];
  const marked: string[] = [];
  const earlier: QConversationMessage[] = (options.earlier ?? []).map(
    (line, index) =>
      ({
        ...message,
        id: randomUUID(),
        role: line.role,
        content: line.content,
        createdAt: new Date(Date.now() - (10 - index) * 1000).toISOString(),
      }) as QConversationMessage,
  );
  const unread: boolean[] = [];
  const capabilities: unknown[] = [];
  let reads = 0;
  const heardActions: unknown[] = [];
  const outcomes = [...options.outcomes];
  const modalities: string[] = [];
  const turns: QTurnReader = {
    read: (input) => {
      reads += 1;
      modalities.push(input.modality);
      heardActions.push(input.actions ?? []);
      return Promise.resolve(
        typeof options.reading === "function"
          ? options.reading()
          : options.reading,
      );
    },
  };
  const stored: QConversationMessage[] = [];
  const events: { type: string; data: unknown }[] = [];
  let delegated = 0;
  let warmed = 0;
  let investigated = 0;
  const probes: unknown[] = [];
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: (probe) => {
        probes.push(probe);
        return options.specialistSupports === true;
      },
      investigate: () => {
        investigated += 1;
        return Promise.reject(new Error("not used"));
      },
    },
    ...(options.visibility === undefined
      ? {}
      : { visibility: options.visibility }),
    delegate: {
      warm: () => {
        warmed += 1;
      },
      answer: async (req) => {
        delegated += 1;
        unread.push(req.turnUnread === true);
        capabilities.push(req.capabilities);
        directives.push(
          req.research === undefined ? undefined : await req.research,
        );
        return (
          outcomes.shift() ?? {
            kind: "ANSWERED",
            messageId: "m",
            modelPolicyVersion: "p",
            promptBundleVersion: "b",
          }
        );
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () =>
          Promise.resolve([...earlier, message]),
        mark: (_tx: unknown, input: { messageIds: readonly string[] }) => {
          marked.push(...input.messageIds);
          return Promise.resolve();
        },
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          const row = {
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          } as unknown as QConversationMessage;
          stored.push(row);
          return Promise.resolve(row);
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(events.length + 1) },
      runEvents: {
        append: (
          _tx: unknown,
          input: { eventType: string; payload: unknown },
        ) => {
          events.push({ type: input.eventType, data: input.payload });
          return Promise.resolve(input);
        },
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    ...(options.pendingDecisions === undefined
      ? {}
      : { pendingDecisions: options.pendingDecisions }),
    ...(options.handOver === undefined ? {} : { handOver: options.handOver }),
    ...(options.offeredTools === undefined
      ? {}
      : { offeredTools: () => Promise.resolve(options.offeredTools ?? []) }),
  });
  return {
    answer,
    directives,
    stored,
    events,
    delegated: () => delegated,
    warmed: () => warmed,
    marked,
    message,
    earlierLines: earlier,
    probes,
    investigated: () => investigated,
    unread,
    capabilities,
    reads: () => reads,
    heardActions,
    modalities,
  };
}

const COMPANY = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";

function toolReading(
  tool: Omit<
    NonNullable<TurnReaderResult["tool"]>,
    "documentType" | "subjectName" | "unknownScreen"
  > & {
    readonly unknownScreen?: NonNullable<
      TurnReaderResult["tool"]
    >["unknownScreen"];
  },
  confidence: TurnReaderResult["confidence"] = "HIGH",
): TurnReaderResult {
  return {
    kind: "TOOL_REQUEST",
    confidence,
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    // v3's document parameters belong to PREPARE_DOCUMENT only.
    tool: {
      unknownScreen: null,
      ...tool,
      documentType: null,
      subjectName: null,
    },
  };
}

describe("a request for one of Q's own hands (CQ-QACT-001)", () => {
  it("answers 'take me to discover' with a NAVIGATE intent and no model answer (F8)", async () => {
    const run = seam({
      said: "take me to discover",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "DISCOVER",
        visibility: null,
      }),
      outcomes: [],
    });
    const outcome = await run.answer.answer(request());
    expect(outcome.kind).toBe("ANSWERED");
    expect(run.delegated()).toBe(0);
    expect(run.stored).toHaveLength(1);
    expect(run.stored[0]?.content).toBe("Taking you to Discover.");
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "DISCOVER" },
      },
    ]);
    expect(run.events.map((event) => event.type)).toEqual([
      "q.message.completed",
    ]);
  });

  it("a screen Capital Q does not have is said not to exist and the nearest offered; nobody is moved (live test 2026-09-27 #5)", async () => {
    const run = seam({
      said: "take me to the queue page",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: null,
        unknownScreen: { named: "queue", nearest: "DISCOVER" },
        visibility: null,
      }),
      outcomes: [],
    });
    const outcome = await run.answer.answer(request());
    expect(outcome.kind).toBe("ANSWERED");
    expect(run.delegated()).toBe(0);
    expect(run.stored).toHaveLength(1);
    expect(run.stored[0]?.content).toBe(
      'Capital Q doesn\'t have a "queue" page. The nearest is Discover. Shall I take you there?',
    );
    // No UI_INTENT: nothing moves the person, least of all Home.
    expect(run.stored[0]?.blocks ?? []).toEqual([]);
  });

  it("a named record read as an unknown screen goes to the answer, which can open it (founder report 2026-09-30)", async () => {
    const run = seam({
      said: "open my chat with young field agro",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: null,
        unknownScreen: {
          named: "chat with young field agro",
          nearest: "RELATIONSHIPS",
        },
        visibility: null,
      }),
      outcomes: [],
      offeredTools: ["open_page", "list_my_relationships"],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(1);
    // The conversational path's reads started beside the reading.
    expect(run.warmed()).toBe(1);
  });

  it("offers only a screen this run can open; otherwise names the ones it can", () => {
    expect(
      unknownScreenLine("settings <b>", "COMPANY_VISIBILITY", [
        "HOME",
        "DISCOVER",
      ]),
    ).toBe(
      'Capital Q doesn\'t have a "settings b" page. I can take you to Home, Discover.',
    );
  });

  it("says the page word once when the person already said it (R30 #26)", () => {
    expect(unknownScreenLine("the queue page", "HOME", [])).toBe(
      'Capital Q doesn\'t have a "queue" page.',
    );
  });

  it("never navigates on a guess, and never to a surface the run has no subject for", async () => {
    const guess = seam({
      said: "discover?",
      reading: toolReading(
        { kind: "NAVIGATE", destination: "DISCOVER", visibility: null },
        "LOW",
      ),
      outcomes: [],
    });
    await guess.answer.answer(request());
    expect(guess.stored).toHaveLength(0);
    expect(guess.delegated()).toBe(1);

    // No company in this run: its visibility page is not somewhere to go.
    const noCompany = seam({
      said: "open my visibility settings",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "COMPANY_VISIBILITY",
        visibility: null,
      }),
      outcomes: [],
    });
    await noCompany.answer.answer(request());
    expect(noCompany.stored).toHaveLength(0);
    expect(noCompany.delegated()).toBe(1);
  });

  it("hands 'make my company visible to investors' to the proposer and prepares no document (F6)", async () => {
    const noted: Record<string, unknown>[] = [];
    const run = seam({
      said: "please make my company visible to investors",
      reading: toolReading({
        kind: "SET_VISIBILITY",
        destination: null,
        visibility: "network_visible",
      }),
      outcomes: [],
      visibility: { noteVisibility: (entry) => noted.push(entry) },
    });
    const turn = {
      ...request(),
      subjects: [{ kind: "COMPANY" as const, companyId: COMPANY }],
    } as QAnswerRequest;
    const outcome = await run.answer.answer(turn);
    expect(outcome.kind).toBe("ANSWERED");
    // Neither the specialist nor the conversational seam ran: nothing
    // that could prepare a deck was reached.
    expect(run.delegated()).toBe(0);
    expect(noted).toEqual([
      {
        runId: turn.runId,
        tenantId: TENANT,
        companyId: COMPANY,
        visibility: "network_visible",
      },
    ]);
    // It explains, honestly, and claims nothing: the action port says it
    // prepared something only once the proposal exists.
    expect(run.stored[0]?.content).toMatch(/recommendations/);
    expect(run.stored[0]?.content).not.toMatch(/prepared|approve|done/i);
  });
});

const advice: TurnReaderResult = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind: "ADVICE", text: "what else should I look for?", about: [] },
  aboutNamedOther: false,
  tool: null,
};

describe("a general turn is read before it is answered", () => {
  it("researches an advice question outside an interview (founder direction 2026-09-29)", async () => {
    const { answer, directives } = seam({
      said: "What else should I look for? Check the web if you like.",
      reading: advice,
      outcomes: [],
    });
    await answer.answer(request());
    // Advice is answered with what the market says now; what leaves is
    // still only what the egress policy allows.
    expect(directives[0]?.mode).toBe("EXPLICIT");
  });

  it("lets a request for a real example reach the web", async () => {
    const { answer, directives } = seam({
      said: "Give me a real investor like me",
      reading: {
        ...advice,
        question: {
          kind: "REAL_WORLD_EXAMPLE",
          text: "a real investor",
          about: [],
        },
      },
      outcomes: [],
    });
    await answer.answer(request());
    expect(directives[0]?.mode).toBe("EXPLICIT");
  });

  it("treats a turn it could not read as not asking for research", async () => {
    const { answer, directives } = seam({
      said: "Any news on Acme?",
      reading: null,
      outcomes: [],
    });
    await answer.answer(request());
    expect(directives[0]?.mode).toBe("NEVER");
  });
});

describe("a failed answer is named once, by its subsystem", () => {
  it("gives the orchestrator a notice for the first and the stopping failure, read once each", async () => {
    const failed: QAnswerOutcome = {
      kind: "FAILED",
      diagnosticCode: "MODEL_PROVIDER_UNAVAILABLE",
    };
    const { answer } = seam({
      said: "What do you think?",
      reading: advice,
      outcomes: [failed, failed, failed],
    });
    const notices: (string | undefined)[] = [];
    for (let i = 0; i < 3; i += 1) {
      const turn = request();
      await answer.answer(turn);
      notices.push(answer.failureNotice?.(turn.runId));
      // Read once: the port forgets it.
      expect(answer.failureNotice?.(turn.runId)).toBeUndefined();
    }
    expect(notices[0]).toMatch(/reasoning service/i);
    expect(notices[1]).toMatch(/stop trying/i);
    expect(notices[2]).toBeUndefined();
  });

  it("does not notify for a cancellation", async () => {
    const { answer } = seam({
      said: "never mind",
      reading: advice,
      outcomes: [{ kind: "FAILED", diagnosticCode: "RUN_CANCELLED" }],
    });
    const turn = request();
    await answer.answer(turn);
    expect(answer.failureNotice?.(turn.runId)).toBeUndefined();
  });
});

describe("words Q could not make out (lead 2026-09-25)", () => {
  function unclear(
    kind: TurnReaderResult["kind"],
    transcript: TurnReaderResult["transcript"],
  ): TurnReaderResult {
    return {
      kind,
      confidence: "LOW",
      transcript,
      question: null,
      aboutNamedOther: false,
      tool: null,
    };
  }

  it("asks no model: one brief prompt, then silence, never the prompt twice in a row", async () => {
    for (const reading of [
      unclear("UNCLEAR_TRANSCRIPT", "FRAGMENT"),
      unclear("UNCLEAR_TRANSCRIPT", "NOISY"),
      unclear("QUESTION_TO_Q", "FRAGMENT"),
    ]) {
      const run = seam({ said: "the uh which", reading, outcomes: [] });
      const first = await run.answer.answer(request());
      const second = await run.answer.answer(request());
      const third = await run.answer.answer(request());
      const label = `${reading.kind}/${reading.transcript}`;
      expect(run.delegated(), label).toBe(0);
      expect(first.kind, label).toBe("ANSWERED");
      expect(run.stored, label).toHaveLength(1);
      const line = run.stored[0]?.content ?? "";
      // Brief, and never a statement about what Q could not identify.
      expect(line.split(/\s+/).length, label).toBeLessThanOrEqual(5);
      expect(second.kind === "ANSWERED" && second.messageId, label).toBeNull();
      expect(third.kind === "ANSWERED" && third.messageId, label).toBeNull();
    }
  });

  it("a clear turn resets it: the next unclear turn gets its prompt again", async () => {
    const readings: (TurnReaderResult | null)[] = [
      unclear("UNCLEAR_TRANSCRIPT", "NOISY"),
      {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
      },
      unclear("UNCLEAR_TRANSCRIPT", "NOISY"),
    ];
    const run = seam({
      said: "x",
      reading: () => readings.shift() ?? null,
      outcomes: [],
    });
    await run.answer.answer(request());
    await run.answer.answer(request());
    await run.answer.answer(request());
    // Two prompts written (one before, one after the clear turn), and the
    // clear turn went to the model as usual.
    expect(run.stored).toHaveLength(2);
    expect(run.delegated()).toBe(1);
  });
});

describe("spoken words that were not for Q (founder live 2026-09-29)", () => {
  const clear = (
    addressedToQ: boolean,
  ): TurnReaderResult & {
    addressedToQ: boolean;
  } => ({
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
    addressedToQ,
  });

  it("tells the reader the turn was spoken", async () => {
    const run = seam({
      said: "hi",
      reading: clear(true),
      outcomes: [],
      spoken: true,
    });
    await run.answer.answer(request());
    expect(run.modalities).toEqual(["VOICE"]);
    const typed = seam({ said: "hi", reading: clear(true), outcomes: [] });
    await typed.answer.answer(request());
    expect(typed.modalities).toEqual(["TEXT"]);
  });

  it("answers nothing, records nothing and asks no model for words meant for someone else", async () => {
    const run = seam({
      said: "Daniel, please check the Google pages again",
      reading: clear(false),
      outcomes: [],
      spoken: true,
    });
    const outcome = await run.answer.answer(request());
    expect(outcome.kind === "ANSWERED" && outcome.messageId).toBeNull();
    expect(run.delegated()).toBe(0);
    expect(run.stored).toHaveLength(0);
  });

  it("still answers a typed turn whatever the reading says about who it was for", async () => {
    const run = seam({ said: "hello", reading: clear(false), outcomes: [] });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(1);
  });

  it("never asks the room to say that again: an unclear spoken turn is silent", async () => {
    const run = seam({
      said: "machines",
      reading: {
        kind: "UNCLEAR_TRANSCRIPT",
        confidence: "LOW",
        transcript: "NOISY",
        question: null,
        aboutNamedOther: false,
        tool: null,
      },
      outcomes: [],
      spoken: true,
    });
    await run.answer.answer(request());
    expect(run.stored).toHaveLength(0);
    expect(run.delegated()).toBe(0);
  });
});

describe("a turn whose reading fails is never silently answered as chat (B1)", () => {
  it("tries the reading again, and acts on it when the second try reads it", async () => {
    const readings: (TurnReaderResult | null)[] = [
      null,
      toolReading({
        kind: "NAVIGATE",
        destination: "DISCOVER",
        visibility: null,
      }),
    ];
    const run = seam({
      said: "take me to discover",
      reading: () => readings.shift() ?? null,
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.reads()).toBe(2);
    expect(run.delegated()).toBe(0);
    expect(run.stored[0]?.blocks?.[0]).toMatchObject({ kind: "UI_INTENT" });
  });

  it("tells the answer the turn was not read when both tries fail", async () => {
    const run = seam({
      said: "make me a pdf of my thesis",
      reading: null,
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.reads()).toBe(2);
    expect(run.unread).toEqual([true]);
  });

  it("a read turn is never marked unread", async () => {
    const run = seam({
      said: "what do you know about fintech in Lagos?",
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
      },
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.reads()).toBe(1);
    expect(run.unread).toEqual([false]);
  });
});

describe("the answer is told what this run can do (CQ-QX-008)", () => {
  it("hands on a manifest built from what is composed and what the plan holds", async () => {
    const run = seam({
      said: "what can you do for me?",
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
      },
      outcomes: [],
    });
    await run.answer.answer(request());
    // No company in the run, no artifact service composed here, no
    // visibility notebook: screens only, and never the visibility one.
    // R33: what only the person can do comes with its screen, and a
    // company's own screens (Pitch, Verification) wait for a company.
    expect(run.capabilities).toEqual([
      {
        navigate: [
          "HOME",
          "PROFILE",
          "CAPITAL",
          "DISCOVER",
          "RELATIONSHIPS",
          "SETTINGS",
          "SAVED",
          "INVESTORS",
          "SEARCH",
          "GATEWAY",
          "MEMORY",
          "REHEARSALS",
          // DOCS: their documents and brand kit.
          "DOCUMENTS",
          // DAILY: The Q Daily.
          "DAILY",
          "RESULTS",
        ],
        documents: [],
        visibilityChange: false,
        offers: [
          expect.objectContaining({ destination: "SETTINGS" }),
          // Profile photo and cover (cropped on the profile).
          expect.objectContaining({ destination: "PROFILE" }),
          expect.objectContaining({ destination: "HOME" }),
          // Unsend, block, unblock, report (chat).
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          // DOCS: confirm a brand (Documents) and an answer as a PDF.
          expect.objectContaining({ destination: "DOCUMENTS" }),
          expect.objectContaining({ destination: "HOME" }),
          // Dismiss a reminder.
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          // Answer founders' Connection Requests (ADR 0023); sending one
          // is a company's own and waits for a company.
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
        ],
      },
    ]);
  });
});

describe("an action the run offers is never filed as a document (BIZ-004 founder live)", () => {
  const actionOf = (providerName: string) => {
    const entry = Q_CAPABILITIES.find(
      (capability) =>
        capability.performedBy.kind === "TOOL" &&
        capability.performedBy.providerName === providerName,
    );
    return { name: providerName, does: entry?.does };
  };
  const ACTION_READING = {
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
  } as const;

  it("hands the offered actions to the reader, and an action request goes to the model that holds it", async () => {
    const run = seam({
      said: "Make a Q card for Zino Aviation with the handle zino-aviation",
      reading: ACTION_READING,
      outcomes: [],
      offeredTools: ["propose_handle_claim", "get_company"],
    });
    await run.answer.answer(request());
    // From the capability registry: the action, never the read.
    expect(run.heardActions).toEqual([[actionOf("propose_handle_claim")]]);
    // No document was prepared here; the answer's model took the turn.
    expect(run.delegated()).toBe(1);
    expect(run.stored).toHaveLength(0);
  });

  it("a profile edit is an action the reader knows, and the model that holds it takes the turn (R20)", async () => {
    const run = seam({
      said: "change my headline to fintech founder in Lagos",
      reading: ACTION_READING,
      outcomes: [],
      offeredTools: ["propose_profile_change", "search_companies"],
    });
    await run.answer.answer(request());
    expect(run.heardActions).toEqual([[actionOf("propose_profile_change")]]);
    expect(run.delegated()).toBe(1);
    // Not taken to the profile screen: no navigation message was stored.
    expect(run.stored).toHaveLength(0);
  });

  it("a tool the run does not offer is not an action it has", async () => {
    const run = seam({
      said: "claim @kivu for us",
      reading: ACTION_READING,
      outcomes: [],
      offeredTools: ["get_company"],
    });
    await run.answer.answer(request());
    expect(run.heardActions).toEqual([[]]);
  });
});

describe("a question about their own record takes the fast path (lead 2026-10-01)", () => {
  const withCompany = (): QAnswerRequest => ({
    ...request(),
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
  });
  const ownRecords: TurnReaderResult = {
    ...advice,
    question: {
      kind: "THEIR_OWN_RECORDS",
      text: "what do you have on record about my company?",
      about: [],
    },
  };

  it("is answered from the record by the conversational path, not the analysis", async () => {
    const { answer, delegated, investigated } = seam({
      said: "What do you have on record about my company?",
      reading: ownRecords,
      outcomes: [],
      specialistSupports: true,
    });
    await answer.answer(withCompany());
    expect(delegated()).toBe(1);
    expect(investigated()).toBe(0);
  });

  it("leaves an assessment of their company to the analysis", async () => {
    const { answer, investigated, probes } = seam({
      said: "How strong is my company's traction?",
      reading: advice,
      outcomes: [],
      specialistSupports: true,
    });
    await answer.answer(withCompany()).catch(() => undefined);
    expect(investigated()).toBe(1);
    // The analysis decides from the reading, never from the words.
    expect(probes[0]).toMatchObject({
      reading: {
        kind: advice.kind,
        questionKind: advice.question?.kind ?? null,
        aboutNamedOther: advice.aboutNamedOther,
      },
    });
  });
});

describe("a typed yes to a waiting change (founder fixture #1)", () => {
  const waiting = (approved: string[]): PendingDecisionPort => ({
    proposals: () =>
      Promise.resolve([
        {
          proposalId: "p1",
          summary: "Reminder: Send Savanna the updated deck",
          status: "PENDING",
        },
      ]),
    read: () => Promise.resolve({ decision: "YES", remainder: null }),
    approve: (_context, proposalId) => {
      approved.push(proposalId);
      return Promise.resolve({ status: "SAVED" });
    },
    decline: () => Promise.resolve({ status: "DECLINED" }),
  });

  it("is approved by code and answered with the engine's status; the model is not asked", async () => {
    const approved: string[] = [];
    const { answer, stored, delegated, reads } = seam({
      said: "yes, go ahead",
      reading: null,
      outcomes: [],
      pendingDecisions: waiting(approved),
    });
    await answer.answer(request());
    expect(approved).toEqual(["p1"]);
    expect(stored.map((m) => m.content)).toEqual([
      "Done: Reminder: Send Savanna the updated deck.",
    ]);
    expect(delegated()).toBe(0);
    expect(reads()).toBe(0);
  });

  it("a no with more said is declined first, then the rest is answered", async () => {
    const declined: string[] = [];
    const { answer, stored, delegated } = seam({
      said: "yes but change the time to 3pm",
      reading: null,
      outcomes: [],
      pendingDecisions: {
        ...waiting([]),
        read: () =>
          Promise.resolve({
            decision: "NO",
            remainder: "change the time to 3pm",
          }),
        decline: (_context, proposalId) => {
          declined.push(proposalId);
          return Promise.resolve({ status: "DECLINED" });
        },
      },
    });
    await answer.answer(request());
    expect(declined).toEqual(["p1"]);
    expect(stored[0]?.content).toMatch(/^Declined: Reminder/);
    expect(delegated()).toBe(1);
  });
});

describe("the turn read early, beside the firewall (ADR 0035)", () => {
  const navigate = () =>
    seam({
      said: "take me to discover",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "DISCOVER",
        visibility: null,
      }),
      outcomes: [],
    });
  const early = (run: ReturnType<typeof navigate>, r: QAnswerRequest) =>
    run.answer.preread?.({
      runId: r.runId,
      tenantId: r.tenantId,
      actor: r.actor,
      correlationId: r.correlationId,
    });

  it("is taken up by the answer for the same run: the turn is read once", async () => {
    const run = navigate();
    // The first turn of a conversation teaches the reader's actions.
    await run.answer.answer(request());
    expect(run.reads()).toBe(1);
    const next = request();
    early(run, next);
    const outcome = await run.answer.answer(next);
    expect(outcome.kind).toBe("ANSWERED");
    expect(run.reads()).toBe(2);
    expect(run.stored.at(-1)?.content).toBe("Taking you to Discover.");
  });

  it("is dropped unused when the run is refused: the answer reads the turn itself", async () => {
    const run = navigate();
    await run.answer.answer(request());
    const next = request();
    early(run, next);
    run.answer.discard?.(next.runId);
    await run.answer.answer(next);
    // Early reading (unused) plus the answer's own.
    expect(run.reads()).toBe(3);
  });

  it("is not made for a conversation's first turn", async () => {
    const run = navigate();
    const first = request();
    early(run, first);
    await run.answer.answer(first);
    expect(run.reads()).toBe(1);
  });
});

describe("a hand-over is prepared by code for the subject on screen (TURN_READER v22)", () => {
  const COMPANY = "94ec9c88-d157-49d1-9bf4-fc01d1e7b8d3";
  const handOverPort = (prepared: unknown[]): QHandOverPort => ({
    prepare: (_request, subject) => {
      prepared.push(subject);
      return Promise.resolve({
        status: "PREPARED",
        awaitingApprovalOf: "Q looks after Tarmacly for you",
      });
    },
    candidates: () =>
      Promise.resolve([
        {
          name: "Kazikit",
          subject: { kind: "RELATIONSHIP", relationshipId: "r-kazikit" },
        },
        {
          name: "Tarmacly",
          subject: { kind: "RELATIONSHIP", relationshipId: "r-tarmacly" },
        },
      ]),
  });
  const reading = (
    handOver: {
      kind: "MEETING" | "HAND_OVER";
      counterpartName: string | null;
    } | null,
    kind: TurnReaderResult["kind"] = "TOOL_REQUEST",
  ) =>
    ({
      kind,
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver,
    }) as TurnReaderResult;
  const onCompanyPage = (): QAnswerRequest => {
    const base = request();
    return {
      ...base,
      plan: { ...base.plan, screen: { route: "COMPANY", companyId: COMPANY } },
    };
  };

  it.each([
    ["get me a meeting with this person", "MEETING"],
    ["occupe-toi de ça pour moi", "HAND_OVER"],
  ] as const)(
    "%j on a company's page: Q's errand for that company, for approval, and the model is not asked",
    async (said, kind) => {
      const prepared: unknown[] = [];
      const { answer, stored, delegated } = seam({
        said,
        reading: reading({ kind, counterpartName: null }),
        outcomes: [],
        handOver: handOverPort(prepared),
      });
      await answer.answer(onCompanyPage());
      expect(prepared).toEqual([{ kind: "COMPANY", companyId: COMPANY }]);
      expect(stored.at(-1)?.content).toMatch(
        /^Q looks after Tarmacly for you: once you approve/,
      );
      expect(delegated()).toBe(0);
    },
  );

  it("an errand already running for them: no second card, Q says what it is doing and asks about changes", async () => {
    const { answer, stored, delegated } = seam({
      said: "handle this for me",
      reading: reading({ kind: "HAND_OVER", counterpartName: null }),
      outcomes: [],
      handOver: {
        prepare: () =>
          Promise.resolve({
            status: "ALREADY_ACTIVE",
            awaitingApprovalOf:
              "Q is already looking after Tarmacly for you (in the chat with them): Offered three times for the call.",
          }),
        candidates: () => Promise.resolve([]),
      },
    });
    await answer.answer(onCompanyPage());
    expect(stored.at(-1)?.content).toBe(
      "Q is already looking after Tarmacly for you (in the chat with them): Offered three times for the call. Want me to change anything?",
    );
    expect(delegated()).toBe(0);
  });

  it("a question about meetings is not a hand-over ('what is a meeting?')", async () => {
    const prepared: unknown[] = [];
    const { answer, delegated } = seam({
      said: "what is a meeting?",
      reading: reading(null, "QUESTION_TO_Q"),
      outcomes: [],
      handOver: handOverPort(prepared),
    });
    await answer.answer(onCompanyPage());
    expect(prepared).toEqual([]);
    expect(delegated()).toBe(1);
  });

  it("with no subject on screen, asks one short question naming their own likely ones", async () => {
    const prepared: unknown[] = [];
    const { answer, stored } = seam({
      said: "get me a meeting with them",
      reading: reading({ kind: "MEETING", counterpartName: null }),
      outcomes: [],
      handOver: handOverPort(prepared),
    });
    await answer.answer(request());
    expect(prepared).toEqual([]);
    expect(stored.at(-1)?.content).toBe(
      "Who should I set this up with: Kazikit or Tarmacly?",
    );
  });

  it("with no subject on screen, a name that is one of their relationships is that one", async () => {
    const prepared: unknown[] = [];
    const { answer } = seam({
      said: "book me a call with kazikit",
      reading: reading({ kind: "MEETING", counterpartName: "kazikit" }),
      outcomes: [],
      handOver: handOverPort(prepared),
    });
    await answer.answer(request());
    expect(prepared).toEqual([
      { kind: "RELATIONSHIP", relationshipId: "r-kazikit" },
    ]);
  });
  it("a relationship they name wins over the page they are on (QA 2026-10-01, run 41cdef22)", async () => {
    const prepared: unknown[] = [];
    const { answer } = seam({
      said: "handle an intro to Kazikit for me",
      reading: reading({ kind: "HAND_OVER", counterpartName: "Kazikit" }),
      outcomes: [],
      handOver: handOverPort(prepared),
    });
    await answer.answer(onCompanyPage());
    expect(prepared).toEqual([
      { kind: "RELATIONSHIP", relationshipId: "r-kazikit" },
    ]);
  });

  it("a name that is none of their relationships leaves the page's subject", async () => {
    const prepared: unknown[] = [];
    const { answer } = seam({
      said: "handle an intro to them for me",
      reading: reading({ kind: "HAND_OVER", counterpartName: "Nobody Ltd" }),
      outcomes: [],
      handOver: handOverPort(prepared),
    });
    await answer.answer(onCompanyPage());
    expect(prepared).toEqual([{ kind: "COMPANY", companyId: COMPANY }]);
  });
});

describe("the hand-over port plans a named relationship before acting (QA 2026-10-01)", () => {
  const RELATIONSHIP = "11111111-2222-4333-8444-555555555555";
  const outcome = (data: unknown): QToolCallOutcome => ({
    callId: "c",
    toolName: null,
    toolVersion: 1,
    classification: null,
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: null,
    result: { ok: true, data },
    latencyMs: 1,
  });
  const fakeTools = (data: unknown) => {
    const calls: { proposal: QToolProposal; context: QToolExecutionContext }[] =
      [];
    return {
      calls,
      tools: {
        offer: () => Promise.resolve([]),
        execute: (proposal: QToolProposal, context: QToolExecutionContext) => {
          calls.push({ proposal, context });
          return Promise.resolve(outcome(data));
        },
      },
    };
  };
  const firewallGiving = (
    decision: Awaited<ReturnType<ContextFirewallPort["plan"]>>,
  ) => {
    const asked: unknown[] = [];
    const firewall: ContextFirewallPort = {
      plan: (input) => {
        asked.push(input.subjects);
        return Promise.resolve(decision);
      },
    };
    return { asked, firewall };
  };

  it("a relationship the run's plan does not bind is planned on its own, and the tool runs under that plan; an errand already running is said, not duplicated", async () => {
    const base = request();
    const own = request().plan;
    const { asked, firewall } = firewallGiving({
      outcome: "AUTHORISED",
      plan: own,
    });
    const { calls, tools } = fakeTools({
      status: "ALREADY_ACTIVE",
      awaitingApprovalOf:
        "Q is already looking after Kazikit for you (the call is booked).",
    });
    const port = createToolHandOverPort({ tools, firewall });
    const prepared = await port.prepare(base, {
      kind: "RELATIONSHIP",
      relationshipId: RELATIONSHIP,
    });
    expect(asked).toEqual([
      [{ kind: "RELATIONSHIP", relationshipId: RELATIONSHIP }],
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.context.plan).toBe(own);
    expect(calls[0]?.proposal.arguments).toMatchObject({
      relationshipId: RELATIONSHIP,
    });
    expect(prepared).toEqual({
      status: "ALREADY_ACTIVE",
      awaitingApprovalOf:
        "Q is already looking after Kazikit for you (the call is booked).",
    });
  });

  it("a relationship the firewall refuses is not acted on: no tool call", async () => {
    const { firewall } = firewallGiving({
      outcome: "DENIED",
      reason: "SUBJECT_UNRESOLVED",
      denied: [],
    });
    const { calls, tools } = fakeTools({});
    const port = createToolHandOverPort({ tools, firewall });
    const prepared = await port.prepare(request(), {
      kind: "RELATIONSHIP",
      relationshipId: RELATIONSHIP,
    });
    expect(prepared).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("a subject on the page runs under the run's own plan, with no second plan", async () => {
    const base = request();
    const { asked, firewall } = firewallGiving({
      outcome: "AUTHORISED",
      plan: request().plan,
    });
    const { calls, tools } = fakeTools({
      status: "PREPARED",
      awaitingApprovalOf: "Q looks after Tarmacly for you",
    });
    const port = createToolHandOverPort({ tools, firewall });
    await port.prepare(base, {
      kind: "COMPANY",
      companyId: "94ec9c88-d157-49d1-9bf4-fc01d1e7b8d3",
    });
    expect(asked).toEqual([]);
    expect(calls[0]?.context.plan).toBe(base.plan);
  });
});

describe("speech that was not for Q is kept out of what Q reads back (founder live 2026-10-01)", () => {
  const reading = (extra: Partial<TurnReaderResult>): TurnReaderResult =>
    ({
      kind: "SMALL_TALK",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      ...extra,
    });

  it("marks a spoken line meant for someone else, and says nothing", async () => {
    const run = seam({
      said: "Neo, n e u. N e u.",
      spoken: true,
      reading: reading({ addressedToQ: false }),
      outcomes: [],
    });
    const outcome = await run.answer.answer(request());
    expect(outcome).toMatchObject({ kind: "ANSWERED", messageId: null });
    expect(run.marked).toEqual([run.message.id]);
    expect(run.delegated()).toBe(0);
  });

  it("on 'wasn't talking to you', marks their lines since Q last spoke, not Q's and not this one", async () => {
    const run = seam({
      said: "Q, I wasn't really talking to you. Take me to Discover.",
      spoken: true,
      earlier: [
        { role: "Q", content: "Hey, Zino." },
        { role: "USER", content: "Have you tested eleven labs?" },
        { role: "USER", content: "And the whole Google Meet stuff." },
      ],
      reading: {
        ...toolReading({
          kind: "NAVIGATE",
          destination: "DISCOVER",
          visibility: null,
        }),
        earlierNotForQ: true,
      } as TurnReaderResult,
      outcomes: [],
    });
    await run.answer.answer(request());
    const [, dictation1, dictation2] = run.earlierLines;
    expect(new Set(run.marked)).toEqual(
      new Set([dictation1?.id, dictation2?.id]),
    );
    expect(run.marked).not.toContain(run.message.id);
    // The request itself is still acted on.
    expect(run.stored.at(-1)?.content).toBe("Taking you to Discover.");
  });

  it("marks nothing on an ordinary turn", async () => {
    const run = seam({
      said: "take me to discover",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "DISCOVER",
        visibility: null,
      }),
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.marked).toEqual([]);
  });
});
