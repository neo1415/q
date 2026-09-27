import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import { Q_CAPABILITIES } from "@capital-q/q-tools";
import type { TurnReaderV8Result as TurnReaderResult } from "@capital-q/q-core";
import type {
  QAnswerOutcome,
  QAnswerRequest,
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
  };
  const directives: (QResearchDirective | undefined)[] = [];
  const unread: boolean[] = [];
  const capabilities: unknown[] = [];
  let reads = 0;
  const heardActions: unknown[] = [];
  const outcomes = [...options.outcomes];
  const turns: QTurnReader = {
    read: (input) => {
      reads += 1;
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
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    ...(options.visibility === undefined
      ? {}
      : { visibility: options.visibility }),
    delegate: {
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
        listRecentForConversationOfRun: () => Promise.resolve([message]),
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
    unread,
    capabilities,
    reads: () => reads,
    heardActions,
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
  it("keeps the web out of an advice question, whatever its words", async () => {
    const { answer, directives } = seam({
      said: "What else should I look for? Check the web if you like.",
      reading: advice,
      outcomes: [],
    });
    await answer.answer(request());
    // The model never holds the web on this turn. The fallback only lets
    // code read public sources after the platform's own prospects lookup
    // comes back thin (gap 1); it is not a research directive.
    expect(directives).toEqual([
      { mode: "NEVER", announceSourceChange: false, fallback: true },
    ]);
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
        ],
        documents: [],
        visibilityChange: false,
        offers: [
          expect.objectContaining({ destination: "SETTINGS" }),
          expect.objectContaining({ destination: "HOME" }),
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
