import type { DelegationContext, QDelegationPort } from "../src/delegation.js";
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
import {
  createToolAppActionPort,
  type TurnAppAction,
  type QAppActionPort,
} from "../src/app-action-turn.js";
import type { PendingDecisionPort } from "../src/pending-decision.js";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import { Q_CAPABILITIES } from "@capital-q/q-tools";
import type {
  TurnReaderV24Result,
  TurnReaderV8Result as TurnReaderResult,
} from "@capital-q/q-core";
import type {
  ContextFirewallPort,
  QAnswerOutcome,
  QAnswerRequest,
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
  QToolProposal,
  QConversationMessage,
  QResearchDirective,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import type { Logger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  createSpecialistQAnswer,
  namedInWords,
  unknownScreenLine,
} from "../src/answer.js";
import {
  createToolProfileGapsPort,
  type QProfileGapsPort,
} from "../src/profile-gaps.js";

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
    readonly blocks?: QConversationMessage["blocks"];
  }[];
  /** A typed decision on a waiting change (founder fixture #1). */
  readonly pendingDecisions?: PendingDecisionPort;
  /** A hand-over prepared by code (TURN_READER v22). */
  readonly handOver?: QHandOverPort;
  /** Work handed over in general (QA 2026-10-03). */
  readonly delegation?: QDelegationPort;
  /** Readiness lead lines for "what should I do next?" (lead 2026-10-03). */
  readonly readinessLead?: (request: QAnswerRequest) => Promise<string | null>;
  /** Their profile's gaps filled by code (TURN_READER v27). */
  readonly profileGaps?: QProfileGapsPort;
  /** ADR 0040: a declared app action the reading names. */
  readonly appActions?: QAppActionPort;
  /** Their relationships' counterpart names (lead 2026-10-03). */
  readonly counterpartNames?: readonly string[];
  /** A recording logger (lead 2026-10-03: the route is observable). */
  readonly logger?: Logger;
  /** Waiting lines deferred to the engine's step (lead 2026-10-03). */
  readonly waitingLines?: {
    readonly defer: (
      runId: string,
      waiting: { readonly line: string; readonly actionId: string },
    ) => void;
  };
  /** APP_ACTION_ROUTER, faked (lead 2026-10-03). */
  readonly appActionRouter?: (
    request: QAnswerRequest,
    input: {
      readonly utterance: string;
      readonly candidates: readonly { readonly name: string }[];
    },
  ) => Promise<string | null>;
  /** The arguments read for a named app action (parity eval 2026-10-02). */
  readonly appActionArguments?: (
    request: QAnswerRequest,
    input: { readonly tool: string; readonly utterance: string },
  ) => Promise<Record<string, unknown> | null>;
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
        ...(line.blocks === undefined ? {} : { blocks: line.blocks }),
        createdAt: new Date(Date.now() - (10 - index) * 1000).toISOString(),
      }) as QConversationMessage,
  );
  const unread: boolean[] = [];
  const capabilities: unknown[] = [];
  let reads = 0;
  const heardActions: unknown[] = [];
  const declaredActions: string[][] = [];
  const askedActions: (string | undefined)[] = [];
  const focuses: unknown[] = [];
  const outcomes = [...options.outcomes];
  const modalities: string[] = [];
  const turns: QTurnReader = {
    read: (input) => {
      reads += 1;
      modalities.push(input.modality);
      // What this run offers; the registry's other declarations ride along
      // marked not available (ADR 0040 parity), heard separately below.
      heardActions.push(
        (input.actions ?? []).filter((action) => action.available !== false),
      );
      declaredActions.push(
        (input.actions ?? [])
          .filter((action) => action.available === false)
          .map((action) => action.name),
      );
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
  const leads: (string | undefined)[] = [];
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
        askedActions.push(req.askedAction);
        leads.push(req.leadLines);
        focuses.push(req.toolFocus);
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
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.waitingLines === undefined
      ? {}
      : { waitingLines: options.waitingLines }),
    ...(options.pendingDecisions === undefined
      ? {}
      : { pendingDecisions: options.pendingDecisions }),
    ...(options.handOver === undefined ? {} : { handOver: options.handOver }),
    ...(options.delegation === undefined
      ? {}
      : { delegation: options.delegation }),
    ...(options.readinessLead === undefined
      ? {}
      : { readinessLead: options.readinessLead }),
    ...(options.appActionArguments === undefined
      ? {}
      : { appActionArguments: options.appActionArguments }),
    ...(options.appActions === undefined
      ? {}
      : { appActions: options.appActions }),
    ...(options.appActionRouter === undefined
      ? {}
      : { appActionRouter: options.appActionRouter }),
    ...(options.counterpartNames === undefined
      ? {}
      : {
          counterpartNames: () =>
            Promise.resolve(options.counterpartNames ?? []),
        }),
    ...(options.profileGaps === undefined
      ? {}
      : { profileGaps: options.profileGaps }),
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
    leads,
    investigated: () => investigated,
    unread,
    capabilities,
    reads: () => reads,
    heardActions,
    declaredActions,
    askedActions,
    modalities,
    focuses,
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

  it("opens Explore for 'the explore page' whatever the reader thinks (voice-cards, Zino 2026-10-08)", async () => {
    const run = seam({
      said: "Take me to the explore page.",
      // The live failure: the reader filed it under Discover.
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "DISCOVER",
        visibility: null,
      }),
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.reads()).toBe(0);
    expect(run.delegated()).toBe(0);
    expect(run.stored[0]?.content).toBe("Opening Explore.");
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "EXPLORE" },
      },
    ]);
  });

  it("says it can't open a page Capital Q does not have, and moves nobody (voice-cards)", async () => {
    const run = seam({
      said: "take me to the queue page",
      reading: null,
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(0);
    expect(run.stored[0]?.content).toBe(
      "I can't open that yet: there's no \"queue\" page in Capital Q.",
    );
    expect(run.stored[0]?.blocks ?? []).toEqual([]);
  });

  it("opens the third card on screen for 'the third company on the list' (voice-cards)", async () => {
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    const card = (name: string, at: number) => ({
      key: name.toLowerCase(),
      subject: { kind: "COMPANY" as const, companyId: ids[at] ?? "" },
      name,
      line: null,
      hue: at + 1,
      reasons: [],
      measures: [],
      fit: null,
      view: null,
      said: null,
      sourceCount: 0,
    });
    const run = seam({
      said: "Tell me about the third company on the list.",
      reading: null,
      outcomes: [],
      earlier: [
        { role: "USER", content: "Show me the top three companies." },
        {
          role: "Q",
          content: "I've scored your top 3 companies against your mandate.",
          blocks: [
            {
              kind: "ANSWER_CARDS",
              shape: "RANKED",
              title: "Fit against your mandate",
              cards: [
                card("Haly", 0),
                card("Portside", 1),
                card("Tensorgate", 2),
              ],
              followUps: [],
            },
          ] as QConversationMessage["blocks"],
        },
      ],
    });
    await run.answer.answer(request());
    expect(run.stored[0]?.content).toBe('Opening "Tensorgate".');
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: ids[2] },
      },
    ]);
  });

  it("a screen Capital Q does not have is said not to exist and the nearest offered; nobody is moved (live test 2026-09-27 #5)", async () => {
    const run = seam({
      said: "I'd like the queue page",
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
      said: "let's have a look at discover",
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
    // company's own screens (Pitch) wait for a company.
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
          "USAGE",
          "REHEARSALS",
          // DOCS: their documents and brand kit.
          "DOCUMENTS",
          // DAILY: The Q Daily.
          "DAILY",
          "RESULTS",
          "PASSED",
          // WORK-58: Q's work page.
          "WORK",
          // voice-cards: every remaining page and tab, by its own name.
          "EXPLORE",
          "PEOPLE_SEARCH",
          "WORK_NEEDS",
          "WORK_PROGRESS",
          "WORK_DONE",
          "WORK_TEAM",
          "WORK_COST",
          "GATEQ_INBOX",
          "GATEQ_FIND",
          "GATEQ_CLAIM",
          "GATEQ_APPLICATIONS",
          "SAVED_COMPARE",
          "REVIEWS",
          "TOP_INVESTORS",
          "CAPITAL_RAISE",
          "CAPITAL_READINESS",
          "CAPITAL_ACTION_PLAN",
          "CAPITAL_PLAN",
          "CAPITAL_INVESTORS",
        ],
        documents: [],
        visibilityChange: false,
        offers: [
          expect.objectContaining({ destination: "SETTINGS" }),
          // G: accept an invitation to a company or firm, or ask to join.
          expect.objectContaining({ destination: "SETTINGS" }),
          expect.objectContaining({ destination: "SETTINGS" }),
          // Their Q email address: copy it, or get a new one (inbound email).
          expect.objectContaining({ destination: "SETTINGS" }),
          // Set aside one of Q's suggestions on Work ("Not now").
          expect.objectContaining({ destination: "WORK" }),
          // Delegation on a standing instruction (switch on/off).
          expect.objectContaining({ destination: "WORK" }),
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
          // Submit organisation verification (KYB, ADR 0040 offer): any
          // organisation verifies, an investor's included.
          expect.objectContaining({ destination: "VERIFICATION" }),
          // GateQ: an investor sets up their gateway from their mandate.
          expect.objectContaining({ destination: "GATEWAY" }),
          // F3/F4: the GateQ inbox's approved words, and Find my startup.
          expect.objectContaining({ destination: "GATEWAY" }),
          expect.objectContaining({ destination: "GATEWAY" }),
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
    // v32: with its few words and area, for the grouped list.
    return {
      name: providerName,
      does: entry?.does,
      short: entry?.short,
      area: entry?.area,
    };
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
      offeredTools: ["claim_q_card_handle", "get_company"],
    });
    await run.answer.answer(request());
    // From the capability registry: the action, never the read.
    expect(run.heardActions).toEqual([[actionOf("claim_q_card_handle")]]);
    // No document was prepared here; the answer's model took the turn.
    expect(run.delegated()).toBe(1);
    expect(run.stored).toHaveLength(0);
  });

  it("a profile edit is an action the reader knows, and the model that holds it takes the turn (R20)", async () => {
    const run = seam({
      said: "change my headline to fintech founder in Lagos",
      reading: ACTION_READING,
      outcomes: [],
      offeredTools: ["update_my_profile", "search_companies"],
    });
    await run.answer.answer(request());
    expect(run.heardActions).toEqual([[actionOf("update_my_profile")]]);
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
    // It is declared, though: the reader may name it, marked not here.
    expect(run.declaredActions[0]).toContain("claim_q_card_handle");
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
    // The decision reader's reading (J7): a fake model, by the words.
    read: (input) =>
      Promise.resolve({
        decision: "YES",
        remainder: null,
        ...(input.utterance === "yes, go ahead"
          ? { onlyDecision: true, explicit: true }
          : { asksSomethingElse: true }),
      }),
    approve: (_context, proposalId) => {
      approved.push(proposalId);
      return Promise.resolve({ status: "SAVED" });
    },
    decline: () => Promise.resolve({ status: "DECLINED" }),
  });

  it("is approved by code and answered with the engine's status; the answering model is not asked", async () => {
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
    // The turn is read (J7: no word list stands in for the reading); the
    // unread turn's plain decision still decides it.
    expect(reads()).toBeGreaterThanOrEqual(1);
  });

  it("run ad0b0067: 'We've decided not to proceed with Ledgefold for now.' read as a request approves nothing", async () => {
    const approved: string[] = [];
    const declined: string[] = [];
    const { answer, stored } = seam({
      said: "We've decided not to proceed with Ledgefold for now.",
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        handOver: null,
        appAction: null,
        askedAction: "relationship_outcome",
      } as TurnReaderResult,
      outcomes: [],
      pendingDecisions: {
        ...waiting(approved),
        decline: (_context, proposalId) => {
          declined.push(proposalId);
          return Promise.resolve({ status: "DECLINED" });
        },
      },
    });
    await answer.answer(request());
    expect(approved).toEqual([]);
    expect(declined).toEqual([]);
    expect(stored.at(-1)?.content).toMatch(/^That's ready: Reminder/);
  });

  /**
   * Lead 2026-10-03 (runs 7468a83f, 7c39eed0): one status per card per
   * answer. The restated outcome said "…it's on the card for your
   * approval", "Still waiting for your approval: X." and the engine's
   * "That's ready: X." -- three lines for one card.
   */
  const OUTCOME_CARD = "Decide not to proceed for now";
  const outcomePending = (declined: string[]): PendingDecisionPort => ({
    proposals: () =>
      Promise.resolve([
        { proposalId: "o1", summary: OUTCOME_CARD, status: "PENDING" },
      ]),
    // How the decision reader read the restatement in the live run.
    read: () => Promise.resolve({ decision: "NO", remainder: null }),
    approve: () => Promise.resolve({ status: "SAVED" }),
    decline: (_context, proposalId) => {
      declined.push(proposalId);
      return Promise.resolve({ status: "DECLINED" });
    },
  });
  const askedFor = (askedAction: string) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: null,
      appAction: {
        tool: askedAction,
        arguments: { relationship: "Ledgefold", operation: "NOT_PROCEED" },
      },
      askedAction,
    }) as TurnReaderResult;

  it("outcome#misheard: the same card asked for again says nothing here; the engine's one 'That's ready' line is all", async () => {
    const declined: string[] = [];
    const { answer, stored, delegated } = seam({
      said: "We've decided not to proceed with Ledgefold for now.",
      reading: askedFor("relationship_outcome"),
      outcomes: [],
      offeredTools: ["relationship_outcome"],
      pendingDecisions: outcomePending(declined),
      appActions: {
        tools: new Set(["relationship_outcome"]),
        run: () => Promise.resolve({ prepared: OUTCOME_CARD }),
      },
    });
    const outcome = await answer.answer(request());
    expect(outcome).toMatchObject({ kind: "ANSWERED", messageId: null });
    expect(declined).toEqual([]);
    // No "on the card" line and no "Still waiting": the engine names it.
    expect(stored).toEqual([]);
    expect(delegated()).toBe(0);
  });

  it("with the engine's step composed, the waiting line is deferred to it, with the card's id", async () => {
    const deferred: unknown[] = [];
    const { answer, stored } = seam({
      said: "Save Ajopot for later.",
      reading: askedFor("save_company"),
      outcomes: [],
      offeredTools: ["save_company"],
      pendingDecisions: outcomePending([]),
      appActions: {
        tools: new Set(["save_company"]),
        run: () => Promise.resolve("Saved Ajopot."),
      },
      waitingLines: { defer: (_runId, waiting) => deferred.push(waiting) },
    });
    await answer.answer(request());
    expect(stored.map((m) => m.content)).toEqual(["Saved Ajopot."]);
    expect(deferred).toEqual([
      {
        line: `Still waiting for your approval: ${OUTCOME_CARD}.`,
        actionId: "o1",
      },
    ]);
  });

  it("a different request with a card pending: one short waiting line, after the answer", async () => {
    const declined: string[] = [];
    const { answer, stored } = seam({
      said: "Save Ajopot for later.",
      reading: askedFor("save_company"),
      outcomes: [],
      offeredTools: ["save_company"],
      pendingDecisions: outcomePending(declined),
      appActions: {
        tools: new Set(["save_company"]),
        run: () => Promise.resolve("Saved Ajopot."),
      },
    });
    await answer.answer(request());
    expect(declined).toEqual([]);
    expect(stored.map((m) => m.content)).toEqual([
      "Saved Ajopot.",
      `Still waiting for your approval: ${OUTCOME_CARD}.`,
    ]);
  });

  it("a no with more said is declined first, then the rest is answered", async () => {
    const declined: string[] = [];
    const { answer, stored, delegated } = seam({
      said: "no, cancel that. Change the time to 3pm",
      // A reply to the card (lead 2026-10-03: only a reply decides).
      reading: {
        kind: "ANSWER",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
      } as TurnReaderResult,
      outcomes: [],
      pendingDecisions: {
        ...waiting([]),
        read: () =>
          Promise.resolve({
            decision: "NO",
            remainder: "change the time to 3pm",
            explicit: true,
            asksSomethingElse: true,
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

  it("a change asked for instead, with no no, leaves the card waiting and says so after the answer (QA 2026-10-03)", async () => {
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
            explicit: true,
            asksSomethingElse: true,
          }),
        decline: (_context, proposalId) => {
          declined.push(proposalId);
          return Promise.resolve({ status: "DECLINED" });
        },
      },
    });
    await answer.answer(request());
    expect(declined).toEqual([]);
    expect(delegated()).toBe(1);
    expect(stored.at(-1)?.content).toMatch(
      /^Still waiting for your approval: Reminder/,
    );
  });
});

describe("the turn read early, beside the firewall (ADR 0035)", () => {
  const navigate = () =>
    seam({
      said: "let's have a look at discover",
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

describe("a hand-over of a founder's connection request (live 2026-10-02, Zino)", () => {
  const COMPANY = "94ec9c88-d157-49d1-9bf4-fc01d1e7b8d3";
  const reading = (counterpartName: string | null) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: { kind: "HAND_OVER", counterpartName },
    }) as TurnReaderResult;
  const port = (
    answer: (company: string | null) => {
      status: string;
      awaitingApprovalOf: string;
    } | null,
  ) => {
    const asked: (string | null)[] = [];
    const errands: unknown[] = [];
    const value: QHandOverPort = {
      answerConnectionRequest: (_request, company) => {
        asked.push(company);
        return Promise.resolve(answer(company));
      },
      prepare: (_request, subject) => {
        errands.push(subject);
        return Promise.resolve({
          status: "PREPARED",
          awaitingApprovalOf: "Q looks after them for you",
        });
      },
      candidates: () => Promise.resolve([]),
    };
    return { value, asked, errands };
  };
  const run = async (
    handOver: QHandOverPort,
    counterpartName: string | null,
    onCompany = false,
  ) => {
    const { answer, stored, delegated } = seam({
      said: "handle it",
      reading: reading(counterpartName),
      outcomes: [],
      handOver,
    });
    const base = request();
    await answer.answer(
      onCompany
        ? {
            ...base,
            plan: {
              ...base.plan,
              screen: { route: "COMPANY", companyId: COMPANY },
            },
          }
        : base,
    );
    return { line: stored.at(-1)?.content, delegated: delegated() };
  };

  it("one request waiting, asked for by name: prepared as one approval with the message", async () => {
    const { value, asked, errands } = port(() => ({
      status: "PREPARED",
      awaitingApprovalOf:
        "Accept Kazikit's connection request and send them your message",
    }));
    const { line, delegated } = await run(value, "Kazikit");
    expect(asked).toEqual(["Kazikit"]);
    expect(errands).toEqual([]);
    expect(line).toBe(
      "Accept Kazikit's connection request and send them your message: once you approve, I accept it and send the message shown on the card, word for word.",
    );
    expect(delegated).toBe(0);
  });

  it("'handle it' with no one named and nothing on screen never picks a waiting request (lead 2026-10-03)", async () => {
    const { value, asked, errands } = port(() => ({
      status: "PREPARED",
      awaitingApprovalOf:
        "Accept Kazikit's connection request and send them your message",
    }));
    const { line } = await run(value, null);
    expect(asked).toEqual([]);
    expect(errands).toEqual([]);
    expect(line ?? "").not.toContain("Kazikit");
  });

  it("the name they gave, else the company on screen, is the one asked for", async () => {
    const named = port(() => ({
      status: "PREPARED",
      awaitingApprovalOf: "Accept Kazikit's connection request",
    }));
    await run(named.value, "Kazikit", true);
    expect(named.asked).toEqual(["Kazikit"]);
    const screen = port(() => ({
      status: "PREPARED",
      awaitingApprovalOf: "Accept Kazikit's connection request",
    }));
    await run(screen.value, null, true);
    expect(screen.asked).toEqual([COMPANY]);
  });

  it("not a waiting request, or not an investor: the errand as before", async () => {
    for (const answer of [
      () => ({
        status: "NOT_FOUND",
        awaitingApprovalOf:
          '"Nixo" isn\'t one of the connection requests waiting for you',
      }),
      () => ({ status: "NO_PENDING_REQUESTS", awaitingApprovalOf: "none" }),
      () => null,
    ]) {
      const { value, errands } = port(answer);
      await run(value, null, true);
      expect(errands).toEqual([{ kind: "COMPANY", companyId: COMPANY }]);
    }
  });
});

describe("live 2026-10-02 (Zino): a named, misheard company among ALL their relationships", () => {
  const rel = (n: number) => `r-${String(n)}`;
  const RELATIONSHIPS = [
    {
      name: "Nixo",
      subject: { kind: "RELATIONSHIP" as const, relationshipId: rel(1) },
      state: "CONNECTED",
    },
    {
      name: "Kazikit",
      subject: { kind: "RELATIONSHIP" as const, relationshipId: rel(2) },
      state: "INTEREST_EXPRESSED",
    },
    {
      name: "Yamfield Agro",
      subject: { kind: "RELATIONSHIP" as const, relationshipId: rel(3) },
      state: "CONNECTED",
    },
    {
      name: "Tallyloom",
      subject: { kind: "RELATIONSHIP" as const, relationshipId: rel(4) },
      state: "INTEREST_EXPRESSED",
    },
  ];
  const reading = (counterpartName: string | null) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: { kind: "MEETING", counterpartName },
    }) as TurnReaderResult;
  const run = async (
    said: string,
    counterpartName: string | null,
    prepared: { status: string; awaitingApprovalOf: string } = {
      status: "PREPARED",
      awaitingApprovalOf: "Q looks after them for you",
    },
    meeting?: QHandOverPort["proposeMeeting"],
  ) => {
    const errands: unknown[] = [];
    const handOver: QHandOverPort = {
      ...(meeting === undefined ? {} : { proposeMeeting: meeting }),
      // Nothing of theirs is waiting: both interests are Zino's own.
      answerConnectionRequest: () =>
        Promise.resolve({
          status: "NO_PENDING_REQUESTS",
          awaitingApprovalOf: "No founder's connection request is waiting.",
        }),
      prepare: (_request, subject) => {
        errands.push(subject);
        return Promise.resolve(prepared);
      },
      candidates: () => Promise.resolve(RELATIONSHIPS),
    };
    const { answer, stored, delegated } = seam({
      said,
      reading: reading(counterpartName),
      outcomes: [],
      handOver,
    });
    await answer.answer(request());
    return {
      line: stored.at(-1)?.content ?? "",
      errands,
      delegated: delegated(),
    };
  };

  it('"Accept TALUM and send them a message… book a meeting with them": Tallyloom, never a list that omits it', async () => {
    const { line, errands, delegated } = await run(
      "Accept TALUM and send them a message… book a meeting with them",
      "TALUM",
      {
        status: "PREPARED",
        awaitingApprovalOf: "Q looks after Tallyloom for you",
      },
    );
    expect(errands).toEqual([{ kind: "RELATIONSHIP", relationshipId: rel(4) }]);
    expect(line).toBe(
      "Tallyloom hasn't accepted your interest yet, so there's nothing to accept. Q looks after Tallyloom for you: once you approve, I wait for them to accept, then send them the message on the card, book an introductory call and send you the link.",
    );
    expect(line).not.toMatch(/Who should I/);
    expect(delegated).toBe(0);
  });

  it("the founder's exact line (live re-check on 916c0978): a TOOL_REQUEST hand-over runs QA's hand-over for Tallyloom", async () => {
    const { line, errands, delegated } = await run(
      "Accept TALUM and send them a message. You can book a meeting with them too.",
      "TALUM",
      {
        status: "PREPARED",
        awaitingApprovalOf: "Q looks after Tallyloom for you",
      },
    );
    expect(errands).toEqual([{ kind: "RELATIONSHIP", relationshipId: rel(4) }]);
    expect(line).toBe(
      "Tallyloom hasn't accepted your interest yet, so there's nothing to accept. Q looks after Tallyloom for you: once you approve, I wait for them to accept, then send them the message on the card, book an introductory call and send you the link.",
    );
    expect(line).not.toMatch(/nothing is waiting|Who should I|\bid\b/i);
    expect(delegated).toBe(0);
  });

  it('"Tallyloom, accept their request and chat him up for me": the truth plus one action, and an errand already running is said, not duplicated', async () => {
    const { line, errands } = await run(
      "Tallyloom, accept their request and chat him up for me",
      "Tallyloom",
      {
        status: "ALREADY_ACTIVE",
        awaitingApprovalOf:
          "Q is already looking after Tallyloom for you (waiting for them to accept).",
      },
    );
    expect(errands).toHaveLength(1);
    expect(line).toBe(
      "Tallyloom hasn't accepted your interest yet, so there's nothing to accept. Q is already looking after Tallyloom for you (waiting for them to accept). Want me to change anything?",
    );
    expect(line).not.toMatch(/\bid\b|record/i);
  });

  it("connected, 'send them a message and book a meeting': prepared directly", async () => {
    const { line, errands } = await run(
      "Send Nixo a message and book a meeting with them",
      "Nixo",
      { status: "PREPARED", awaitingApprovalOf: "Q looks after Nixo for you" },
    );
    expect(errands).toEqual([{ kind: "RELATIONSHIP", relationshipId: rel(1) }]);
    expect(line).toBe(
      "Q looks after Nixo for you: once you approve, I send them the message on the card, book an introductory call and send you the link.",
    );
  });

  it("connected, 'book a meeting with Nixo' (action parity 2026-10-02): a direct call proposal at their first free time, no errand", async () => {
    const asked: unknown[] = [];
    const { line, errands } = await run(
      "Book a meeting with Nixo",
      "Nixo",
      undefined,
      (_request, subject) => {
        asked.push(subject);
        return Promise.resolve({
          awaitingApprovalOf: "Call with Nixo",
          local: "Tue 6 Oct, 14:00",
          alsoFree: ["Tue 6 Oct, 15:00", "Wed 7 Oct, 10:00"],
        });
      },
    );
    expect(asked).toEqual([{ kind: "RELATIONSHIP", relationshipId: rel(1) }]);
    expect(errands).toEqual([]);
    expect(line).toBe(
      "Call with Nixo: Tue 6 Oct, 14:00 is your first free time. Approve it and I send the invite with a Meet link, or tell me another time (also free: Tue 6 Oct, 15:00 or Wed 7 Oct, 10:00).",
    );
  });

  it('"book a meeting with Nixon the next five minutes": Nixo, a direct call inside the window, never an errand', async () => {
    const asked: unknown[] = [];
    const errands: unknown[] = [];
    const handOver: QHandOverPort = {
      answerConnectionRequest: () =>
        Promise.resolve({
          status: "NO_PENDING_REQUESTS",
          awaitingApprovalOf: "No founder's connection request is waiting.",
        }),
      proposeMeeting: (_request, subject, window) => {
        asked.push({ subject, window });
        return Promise.resolve({
          awaitingApprovalOf: "Call with Nixo, Fri 2 Oct, 14:05",
          local: null,
          alsoFree: [],
        });
      },
      prepare: (_request, subject) => {
        errands.push(subject);
        return Promise.resolve(null);
      },
      candidates: () => Promise.resolve(RELATIONSHIPS),
    };
    const { answer, stored, delegated } = seam({
      said: "book a meeting with Nixon the next five minutes",
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        handOver: { kind: "MEETING", counterpartName: "Nixon" },
        timeWindow: { fromMinutes: 0, toMinutes: 5 },
      } as TurnReaderResult,
      outcomes: [],
      handOver,
    });
    await answer.answer(request());
    expect(asked).toEqual([
      {
        subject: { kind: "RELATIONSHIP", relationshipId: rel(1) },
        window: { fromMinutes: 0, toMinutes: 5 },
      },
    ]);
    expect(errands).toEqual([]);
    expect(stored.at(-1)?.content).toBe(
      "Call with Nixo, Fri 2 Oct, 14:05: Approve it and I send the invite with a Meet link, or tell me another time.",
    );
    expect(delegated()).toBe(0);
  });

  it("not connected or no calendar: the meeting is not proposed and the errand handles it", async () => {
    const { errands } = await run(
      "Book a meeting with Nixo",
      "Nixo",
      undefined,
      () => Promise.resolve(null),
    );
    expect(errands).toEqual([{ kind: "RELATIONSHIP", relationshipId: rel(1) }]);
  });

  it("a name that is none of them: the question names every one", async () => {
    const { line, errands } = await run("set it up with Zorblax", "Zorblax");
    expect(errands).toEqual([]);
    expect(line).toBe(
      "Who should I set this up with: Nixo, Kazikit, Yamfield Agro or Tallyloom?",
    );
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

  it("proposeMeeting finds their free times and proposes the first one, under the same plan", async () => {
    const calls: QToolProposal[] = [];
    const tools = {
      offer: () => Promise.resolve([]),
      execute: (proposal: QToolProposal) => {
        calls.push(proposal);
        return Promise.resolve(
          outcome(
            proposal.name === "find_meeting_times"
              ? {
                  status: "OK",
                  counterpartName: "Nixo",
                  timeZone: "Europe/London",
                  slots: [
                    {
                      startsAt: "2026-10-06T13:00:00.000Z",
                      endsAt: "2026-10-06T13:30:00.000Z",
                      local: "Tue 6 Oct, 14:00",
                    },
                  ],
                  guidance: "",
                }
              : { status: "PREPARED", awaitingApprovalOf: "Call with Nixo" },
          ),
        );
      },
    };
    const port = createToolHandOverPort({ tools });
    const meeting = await port.proposeMeeting?.(request(), {
      kind: "RELATIONSHIP",
      relationshipId: RELATIONSHIP,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "find_meeting_times",
      "propose_meeting",
    ]);
    expect(calls[1]?.arguments).toEqual({
      relationshipId: RELATIONSHIP,
      purpose: "Introductory call",
      startsAt: "2026-10-06T13:00:00.000Z",
    });
    expect(meeting).toEqual({
      awaitingApprovalOf: "Call with Nixo",
      local: "Tue 6 Oct, 14:00",
      alsoFree: [],
    });
  });

  it("proposeMeeting searches inside the window they asked for and, with no free slot there, proposes the earliest five-minute mark in it", async () => {
    const calls: QToolProposal[] = [];
    const tools = {
      offer: () => Promise.resolve([]),
      execute: (proposal: QToolProposal) => {
        calls.push(proposal);
        return Promise.resolve(
          outcome(
            proposal.name === "find_meeting_times"
              ? {
                  status: "OK",
                  counterpartName: "Nixo",
                  timeZone: "Europe/London",
                  slots: [],
                  guidance: "",
                }
              : {
                  status: "PREPARED",
                  awaitingApprovalOf: "Call with Nixo, Fri 2 Oct, 14:05",
                },
          ),
        );
      },
    };
    const port = createToolHandOverPort({
      tools,
      now: () => new Date("2026-10-02T13:01:30.000Z"),
    });
    const meeting = await port.proposeMeeting?.(
      request(),
      { kind: "RELATIONSHIP", relationshipId: RELATIONSHIP },
      { fromMinutes: 0, toMinutes: 5 },
    );
    expect(calls[0]?.arguments).toEqual({
      relationshipId: RELATIONSHIP,
      from: "2026-10-02T13:02:30.000Z",
      to: "2026-10-02T13:06:30.000Z",
    });
    expect(calls[1]?.arguments).toEqual({
      relationshipId: RELATIONSHIP,
      purpose: "Introductory call",
      startsAt: "2026-10-02T13:05:00.000Z",
    });
    expect(meeting).toEqual({
      awaitingApprovalOf: "Call with Nixo, Fri 2 Oct, 14:05",
      local: null,
      alsoFree: [],
    });
  });

  it("an errand carries the window they asked for as its callWindow", async () => {
    const { calls, tools } = fakeTools({
      status: "PREPARED",
      awaitingApprovalOf: "Q looks after Nixo for you",
    });
    const port = createToolHandOverPort({ tools });
    await port.prepare(
      request(),
      { kind: "RELATIONSHIP", relationshipId: RELATIONSHIP },
      { fromMinutes: 0, toMinutes: 5 },
    );
    expect(calls[0]?.proposal.arguments).toMatchObject({
      callWindow: { fromMinutes: 0, toMinutes: 5 },
    });
  });

  it("proposeMeeting proposes nothing when they are not connected", async () => {
    const { calls, tools } = fakeTools({
      status: "NOT_CONNECTED",
      counterpartName: "Nixo",
      timeZone: null,
      slots: [],
      guidance: "",
    });
    const port = createToolHandOverPort({ tools });
    expect(
      await port.proposeMeeting?.(request(), {
        kind: "RELATIONSHIP",
        relationshipId: RELATIONSHIP,
      }),
    ).toBeNull();
    expect(calls).toHaveLength(1);
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
  const reading = (
    extra: Partial<TurnReaderResult> &
      Partial<Pick<TurnReaderV24Result, "addressedToQ" | "earlierNotForQ">>,
  ): TurnReaderResult => ({
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

  it("marks Q's reply to the line too, when Q had answered it", async () => {
    const run = seam({
      said: "Sorry, wasn't talking to you. What do you call me?",
      earlier: [
        { role: "Q", content: "Good morning." },
        { role: "USER", content: "Send the board pack to Ade by Friday." },
        { role: "Q", content: "I can't send the board pack from here." },
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
    const [greeting, boardPack, reply] = run.earlierLines;
    expect(new Set(run.marked)).toEqual(new Set([boardPack?.id, reply?.id]));
    expect(run.marked).not.toContain(greeting?.id);
  });

  it("marks nothing on an ordinary turn", async () => {
    const run = seam({
      said: "let's have a look at discover",
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

/**
 * HARDEN P0 (live 2026-10-02 on 1f56545b, Nixo): the exact line below was
 * read as RESEARCH_REQUEST, a search ran, and the answer model never called
 * fill_profile_gaps -- it lectured about verification. With TURN_READER
 * v27's saveToOwnProfile, code fills the gaps: search, a constrained
 * reader maps sources to the open fields, code checks, ONE change. The
 * answer model (and the company analysis) is never asked.
 */
describe("live 2026-10-02 (Nixo): permission to fill the profile from what is online", () => {
  const LINE =
    "I need you to go online, search everything you can find, specifically the answers to the open questions in my profile. I'm giving you full permission and approval to update my profile with what you get online.";
  const PREPARED =
    "I filled headquarters city from public sources (nixo.example); approve the card to save it as your stated details. Nothing public for website; it stays open.";
  const reading = (saveToOwnProfile: boolean) =>
    ({
      kind: "RESEARCH_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      saveToOwnProfile,
    }) as TurnReaderResult;
  const harness = (second: (args: unknown) => Record<string, unknown>) => {
    const calls: { name: string; arguments: unknown }[] = [];
    const tools: QToolPort = {
      offer: () => Promise.resolve([]),
      execute: (proposal) => {
        calls.push({ name: proposal.name, arguments: proposal.arguments });
        const first = calls.length === 1;
        return Promise.resolve({
          callId: proposal.callId,
          toolName: "profile.gaps.fill",
          toolVersion: 1,
          classification: "SIDE_EFFECT",
          status: "SUCCEEDED",
          failureCode: null,
          sensitivity: "CONFIDENTIAL",
          result: {
            ok: true,
            data: first
              ? {
                  status: "RESEARCHED",
                  companyName: "Nixo",
                  openFields: ["websiteUrl", "headquartersCity"],
                  filledFields: ["primaryDescription"],
                  sources: [
                    {
                      index: 1,
                      url: "https://nixo.example/about",
                      domain: "nixo.example",
                      title: "About Nixo",
                      publishedAt: null,
                      retrievedAt: "2026-10-02T11:10:00.000Z",
                      excerpt: "Nixo is headquartered in Lagos, Nigeria.",
                    },
                  ],
                  line: "I searched public sources but couldn't settle values for your open fields (website and headquarters city); they stay open.",
                  guidance: "",
                  truthClass: "USER_CLAIM",
                }
              : second(proposal.arguments),
          },
          latencyMs: 2,
        } as QToolCallOutcome);
      },
    };
    return { tools, calls };
  };

  it("the exact line: code searches, maps, keeps only what a source says, prepares ONE change; the analyst is never asked", async () => {
    const readerCalls: unknown[] = [];
    const { tools, calls } = harness(() => ({
      status: "PREPARED",
      companyName: "Nixo",
      openFields: [],
      filledFields: [],
      sources: [],
      line: PREPARED,
      guidance: "",
      truthClass: "USER_CLAIM",
    }));
    const { answer, stored, delegated, investigated } = seam({
      said: LINE,
      reading: reading(true),
      outcomes: [],
      specialistSupports: true,
      profileGaps: createToolProfileGapsPort({
        tools,
        read: (input) => {
          readerCalls.push(input);
          return Promise.resolve({
            wrongSubject: false,
            values: [
              {
                field: "headquartersCity",
                value: "Lagos",
                sources: [1],
                quote: "headquartered in Lagos",
              },
              {
                field: "websiteUrl",
                value: "https://nixo.example",
                sources: [1],
                quote: "visit us at nixo.example",
              },
            ],
            conflicting: [],
          });
        },
      }),
    });
    expect((await answer.answer(request())).kind).toBe("ANSWERED");
    expect(stored.at(-1)?.content).toBe(PREPARED);
    expect(delegated()).toBe(0);
    expect(investigated()).toBe(0);
    expect(readerCalls).toHaveLength(1);
    expect(readerCalls[0]).toMatchObject({
      companyName: "Nixo",
      openFields: ["websiteUrl", "headquartersCity"],
    });
    expect(calls.map((call) => call.name)).toEqual([
      "fill_profile_gaps",
      "fill_profile_gaps",
    ]);
    expect(calls[0]?.arguments).toEqual({});
    expect(calls[1]?.arguments).toEqual({
      values: [{ field: "headquartersCity", value: "Lagos", sources: [1] }],
      conflicting: [],
    });
  });

  it("nothing usable: the tool's line names the fields that stay open", async () => {
    const NOTHING =
      "I searched public sources and found nothing I could use for your open fields (website and headquarters city); they stay open.";
    const { tools } = harness(() => ({
      status: "NOTHING_FOUND",
      companyName: "Nixo",
      openFields: ["website", "headquarters city"],
      filledFields: [],
      sources: [],
      line: NOTHING,
      guidance: "",
      truthClass: "USER_CLAIM",
    }));
    const { answer, stored, delegated } = seam({
      said: LINE,
      reading: reading(true),
      outcomes: [],
      profileGaps: createToolProfileGapsPort({
        tools,
        read: () => Promise.resolve(null),
      }),
    });
    await answer.answer(request());
    expect(stored.at(-1)?.content).toBe(NOTHING);
    expect(delegated()).toBe(0);
  });

  it("'save what you found' after a research turn runs the same path; without the flag the turn is answered as before", async () => {
    const { tools, calls } = harness(() => ({
      status: "NOTHING_FOUND",
      companyName: "Nixo",
      openFields: [],
      filledFields: [],
      sources: [],
      line: "They stay open.",
      guidance: "",
      truthClass: "USER_CLAIM",
    }));
    const port = createToolProfileGapsPort({
      tools,
      read: () => Promise.resolve(null),
    });
    const saved = seam({
      said: "save what you found to my profile",
      reading: reading(true),
      outcomes: [],
      earlier: [
        { role: "USER", content: "what does the web say about Nixo?" },
        { role: "Q", content: "Public sources say Nixo is in Lagos." },
      ],
      profileGaps: port,
    });
    await saved.answer.answer(request());
    expect(saved.delegated()).toBe(0);
    expect(calls.length).toBe(2);

    const plain = seam({
      said: "what does the web say about Nixo?",
      reading: reading(false),
      outcomes: [],
      profileGaps: port,
    });
    await plain.answer.answer(request());
    expect(plain.delegated()).toBe(1);
    expect(calls.length).toBe(2);
  });
});

/**
 * HARDEN P0 (live 2026-10-02, Zino 12:32-12:43): "send a message to nixo
 * telling them I am looking forward to the next meeting" got "Q looks
 * after Nixo for you is saved." and no message card. With TURN_READER v28
 * a direct request is a TOOL_REQUEST with no hand-over: it goes to the
 * answer, which prepares the message card; the hand-over never runs.
 */
describe("live 2026-10-02 (Zino): a direct request is not handed over", () => {
  it("the exact message line goes to the answer, not to an errand", async () => {
    const prepared: unknown[] = [];
    const handOver: QHandOverPort = {
      answerConnectionRequest: () =>
        Promise.resolve({
          status: "NO_PENDING_REQUESTS",
          awaitingApprovalOf: "nothing",
        }),
      prepare: (_request, subject) => {
        prepared.push(subject);
        return Promise.resolve({
          status: "PREPARED",
          awaitingApprovalOf: "Q looks after Nixo for you",
        });
      },
      candidates: () => Promise.resolve([]),
    };
    const { answer, delegated } = seam({
      said: "send a message to nixo telling them I am looking forward to the next meeting",
      reading: {
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        handOver: null,
        timeWindow: null,
      } as TurnReaderResult,
      outcomes: [],
      handOver,
    });
    await answer.answer(request());
    expect(prepared).toEqual([]);
    expect(delegated()).toBe(1);
  });
});

/**
 * HARDEN (lead 2026-10-02): PASSED reaches /discover/passed end to end
 * (the reader's NAVIGATE PASSED, the answer's UI_INTENT, the web's route
 * map, tested in apps/web), and the action the reader names (v30
 * askedAction) reaches the answer only when it was a name it was given.
 */
describe("PASSED and the asked action (ADR 0040 parity)", () => {
  it("'show me the companies I passed on' opens Passed, by a NAVIGATE intent", async () => {
    const run = seam({
      said: "show me the companies I passed on",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "PASSED",
        visibility: null,
      }),
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.stored[0]?.content).toBe("Opening Passed.");
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "PASSED" },
      },
    ]);
  });

  it("the reader's askedAction reaches the answer only when it is a listed name", async () => {
    const reading = (askedAction: string) =>
      ({
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        askedAction,
      }) as TurnReaderResult;
    const listed = seam({
      said: "pass on Kora",
      reading: reading("pass_company"),
      outcomes: [],
      offeredTools: ["get_company"],
    });
    await listed.answer.answer(request());
    expect(listed.askedActions).toEqual(["pass_company"]);
    const invented = seam({
      said: "teleport me to Lagos",
      reading: reading("teleport_person"),
      outcomes: [],
      offeredTools: ["get_company"],
    });
    await invented.answer.answer(request());
    expect(invented.askedActions).toEqual([undefined]);
  });
});

describe("a declared app action the reading names is done by code (ADR 0040, parity eval 2026-10-02)", () => {
  const reading = (appAction: unknown) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: null,
      appAction,
    }) as TurnReaderResult;

  it("'Pass on Ajopot.' runs pass_company and says its own line; the model is not asked", async () => {
    const ran: unknown[] = [];
    const appActions: QAppActionPort = {
      tools: new Set(["pass_company"]),
      run: (_request, action) => {
        ran.push(action);
        return Promise.resolve(
          "Passed on Ajopot. It stays in Passed, where Undo pass brings it back.",
        );
      },
    };
    const { answer, stored, delegated } = seam({
      said: "Pass on Ajopot.",
      reading: reading({
        tool: "pass_company",
        arguments: { company: "Ajopot" },
      }),
      outcomes: [],
      appActions,
    });
    await answer.answer(request());
    expect(ran).toEqual([
      { tool: "pass_company", arguments: { company: "Ajopot" } },
    ]);
    expect(stored.at(-1)?.content).toBe(
      "Passed on Ajopot. It stays in Passed, where Undo pass brings it back.",
    );
    expect(delegated()).toBe(0);
  });

  it("a tool that is not a declared app action, or one that refuses, falls back to the answer", async () => {
    const appActions: QAppActionPort = {
      tools: new Set(["pass_company"]),
      run: () => Promise.resolve(null),
    };
    const refused = seam({
      said: "Pass on Nowhere Ltd.",
      reading: reading({
        tool: "pass_company",
        arguments: { company: "Nowhere Ltd" },
      }),
      outcomes: [],
      appActions,
    });
    await refused.answer.answer(request());
    expect(refused.delegated()).toBe(1);
    const other = seam({
      said: "Delete my account.",
      reading: reading({ tool: "sign_out", arguments: {} }),
      outcomes: [],
      appActions,
    });
    await other.answer.answer(request());
    expect(other.delegated()).toBe(1);
  });

  it("a reminder whose time zone is unknown is answered with its one question (QA run f99e507c)", async () => {
    const question =
      "Which city are you in, so Monday at 10:00 is right? Then I'll set the reminder.";
    const port = createToolAppActionPort({
      names: ["propose_reminder"],
      tools: {
        offer: () => Promise.resolve([]),
        execute: () =>
          Promise.resolve({
            callId: "c",
            toolName: null,
            toolVersion: 1,
            classification: null,
            status: "SUCCEEDED",
            failureCode: null,
            sensitivity: null,
            result: {
              ok: true,
              data: {
                status: "NEEDS_TIME_ZONE",
                awaitingApprovalOf: "",
                says: question,
              },
            },
            latencyMs: 1,
          } as QToolCallOutcome),
      },
    });
    expect(
      await port.run(request(), {
        tool: "propose_reminder",
        arguments: {
          title: "Review Tallyloom's deck",
          when: { day: "monday", time: "10:00" },
        },
      }),
    ).toEqual({ asks: question, needs: "TIME_ZONE" });
  });

  it("a proposer's which-one or none-matching line is the answer, said as it is (lead 2026-10-03)", async () => {
    const line =
      'More than one interest waiting matches "Kazikit": Kazikit Capital or Kazikit Partners. Which one should I accept?';
    const port = createToolAppActionPort({
      names: ["propose_interest_answer"],
      tools: {
        offer: () => Promise.resolve([]),
        execute: () =>
          Promise.resolve({
            callId: "c",
            toolName: null,
            toolVersion: 1,
            classification: null,
            status: "SUCCEEDED",
            failureCode: null,
            sensitivity: null,
            result: {
              ok: true,
              data: { status: "WHICH_ONE", awaitingApprovalOf: line },
            },
            latencyMs: 1,
          } as QToolCallOutcome),
      },
    });
    expect(
      await port.run(request(), {
        tool: "propose_interest_answer",
        arguments: { investor: "Kazikit", decision: "ACCEPTED" },
      }),
    ).toBe(line);
  });

  it("the reply to the question continues the action, its arguments merged (QA runs 7d7e7260 -> 5c2f71aa)", async () => {
    const asked =
      "Which city are you in, so Monday at 10:00 is right? Then I'll set the reminder.";
    const first = {
      title: "Review Tallyloom's deck",
      when: { day: "monday", time: "10:00" },
      counterpartName: "Tallyloom",
    };
    const reading = (kind: string, appAction: unknown) =>
      ({
        kind,
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        handOver: null,
        appAction,
        askedAction: null,
      }) as unknown as TurnReaderResult;
    let turn = 0;
    const ran: TurnAppAction[] = [];
    const read: { tool: string; utterance: string }[] = [];
    const run = seam({
      said: "Remind me on Monday at 10am to review Tallyloom's deck.",
      reading: () =>
        turn === 0
          ? reading("TOOL_REQUEST", {
              tool: "propose_reminder",
              arguments: first,
            })
          : reading("ANSWER", null),
      outcomes: [],
      appActions: {
        tools: new Set(["propose_reminder"]),
        run: (_request, action) => {
          ran.push(action);
          return Promise.resolve(
            ran.length === 1
              ? { asks: asked, needs: "TIME_ZONE" }
              : { prepared: "Reminder: Review Tallyloom's deck" },
          );
        },
      },
      // The reader finds nothing it can use in "Lagos": the place is
      // turned into a zone by code, not by this stub (QA a87ca38f).
      appActionArguments: (_request, input) => {
        read.push(input);
        return Promise.resolve({});
      },
    });
    await run.answer.answer(request());
    expect(run.stored.at(-1)?.content).toBe(asked);
    turn = 1;
    (run.message as { content: string }).content = "Lagos";
    await run.answer.answer(request());
    expect(read).toEqual([{ tool: "propose_reminder", utterance: "Lagos" }]);
    expect(ran).toEqual([
      { tool: "propose_reminder", arguments: first },
      {
        tool: "propose_reminder",
        arguments: { ...first, timeZone: "Africa/Lagos" },
      },
    ]);
  });

  it("a legacy proposal tool's PREPARED output is a prepared card (QA run 4e3b1903)", async () => {
    const port = createToolAppActionPort({
      names: ["propose_express_interest"],
      tools: {
        offer: () => Promise.resolve([]),
        execute: () =>
          Promise.resolve({
            callId: "c",
            toolName: null,
            toolVersion: 1,
            classification: null,
            status: "SUCCEEDED",
            failureCode: null,
            sensitivity: null,
            result: {
              ok: true,
              data: {
                status: "PREPARED",
                awaitingApprovalOf: "Express interest in Clinicrest",
              },
            },
            latencyMs: 1,
          } as QToolCallOutcome),
      },
    });
    expect(
      await port.run(request(), {
        tool: "propose_express_interest",
        arguments: { company: "Clinicrest" },
      }),
    ).toEqual({ prepared: "Express interest in Clinicrest" });
  });

  it("the port runs only declared tools, through the executor, and returns the tool's line", async () => {
    const calls: QToolProposal[] = [];
    const port = createToolAppActionPort({
      names: ["save_company"],
      tools: {
        offer: () => Promise.resolve([]),
        execute: (proposal: QToolProposal) => {
          calls.push(proposal);
          return Promise.resolve({
            callId: "c",
            toolName: null,
            toolVersion: 1,
            classification: null,
            status: "SUCCEEDED",
            failureCode: null,
            sensitivity: null,
            result: {
              ok: true,
              data: { status: "DONE", says: "Saved Ajopot." },
            },
            latencyMs: 1,
          } as QToolCallOutcome);
        },
      },
    });
    expect(
      await port.run(request(), {
        tool: "save_company",
        arguments: { company: "Ajopot" },
      }),
    ).toBe("Saved Ajopot.");
    expect(
      await port.run(request(), { tool: "sign_out", arguments: {} }),
    ).toBeNull();
    expect(calls.map((call) => call.name)).toEqual(["save_company"]);
  });

  it("QA run 938a39b7: a refusal with its own reason is the answer; a generic refusal or a failure is not", async () => {
    const outcomeOf = (
      status: "DENIED" | "FAILED",
      code: string,
      safeMessage: string,
    ): QToolCallOutcome => ({
      callId: "c",
      toolName: null,
      toolVersion: 1,
      classification: null,
      status,
      failureCode: code,
      sensitivity: null,
      result: { ok: false, error: { code, safeMessage } },
      latencyMs: 1,
    });
    const portFor = (outcome: QToolCallOutcome) =>
      createToolAppActionPort({
        names: ["update_q_card"],
        tools: {
          offer: () => Promise.resolve([]),
          execute: () => Promise.resolve(outcome),
        },
      });
    const action = {
      tool: "update_q_card",
      arguments: { searchable: true },
    };
    const reason =
      "You don't have a Q Card yet. Make one first, then I can change who finds it.";
    expect(
      await portFor(outcomeOf("DENIED", "NOT_AVAILABLE", reason)).run(
        request(),
        action,
      ),
    ).toBe(reason);
    expect(
      await portFor(
        outcomeOf(
          "DENIED",
          "NOT_AVAILABLE",
          "Not available in this conversation's context.",
        ),
      ).run(request(), action),
    ).toBeNull();
    expect(
      await portFor(
        outcomeOf("FAILED", "INVALID_ARGUMENTS", "Arguments did not fit."),
      ).run(request(), action),
    ).toBeNull();
  });
});

/**
 * Parity eval 2026-10-02 (live ff7d5a36, runs 20f2f3b8, 9c90c7f7,
 * 7b452d68): the reader named the action (askedAction) but left appAction
 * empty, nothing was done and the answer refused. Code now reads the
 * arguments against the tool's own schema and runs it the same way; the
 * declared app actions also lead the reader's list.
 */
describe("a named app action with no arguments is still done (parity eval 2026-10-02)", () => {
  const named = (askedAction: string) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: null,
      appAction: null,
      askedAction,
    }) as TurnReaderResult;
  const port = (ran: unknown[]): QAppActionPort => ({
    tools: new Set(["pass_company", "save_company"]),
    run: (_request, action) => {
      ran.push(action);
      return Promise.resolve(`Done: ${action.tool}.`);
    },
  });

  for (const [said, tool] of [
    ["Pass on Ajopot.", "pass_company"],
    ["Put Ajopot in my saved list.", "save_company"],
    ["I'm not interested in Ajopot, skip it.", "pass_company"],
  ] as const) {
    it(`'${said}' runs ${tool} with the arguments read for it; the model is not asked`, async () => {
      const ran: unknown[] = [];
      const asked: unknown[] = [];
      const { answer, stored, delegated } = seam({
        said,
        reading: named(tool),
        outcomes: [],
        offeredTools: ["pass_company", "save_company", "get_company"],
        appActions: port(ran),
        appActionArguments: (_request, input) => {
          asked.push(input);
          return Promise.resolve({ company: "Ajopot" });
        },
      });
      await answer.answer(request());
      expect(asked).toEqual([{ tool, utterance: said }]);
      expect(ran).toEqual([{ tool, arguments: { company: "Ajopot" } }]);
      expect(stored.at(-1)?.content).toBe(`Done: ${tool}.`);
      expect(delegated()).toBe(0);
    });
  }

  it("not offered in this run, or no arguments in their words: the answer runs as before", async () => {
    const ran: unknown[] = [];
    const notOffered = seam({
      said: "Pass on Ajopot.",
      reading: named("pass_company"),
      outcomes: [],
      offeredTools: ["get_company"],
      appActions: port(ran),
      appActionArguments: () => Promise.resolve({ company: "Ajopot" }),
    });
    await notOffered.answer.answer(request());
    expect(notOffered.delegated()).toBe(1);
    const noArgs = seam({
      said: "Pass.",
      reading: named("pass_company"),
      outcomes: [],
      offeredTools: ["pass_company"],
      appActions: port(ran),
      appActionArguments: () => Promise.resolve(null),
    });
    await noArgs.answer.answer(request());
    expect(noArgs.delegated()).toBe(1);
    expect(ran).toEqual([]);
  });

  it("the declared app actions lead the reader's list", async () => {
    const run = seam({
      said: "Pass on Ajopot.",
      reading: named("pass_company"),
      outcomes: [],
      offeredTools: ["propose_profile_change", "pass_company"],
      appActions: port([]),
      appActionArguments: () => Promise.resolve(null),
    });
    await run.answer.answer(request());
    const heard = run.heardActions[0] as { name: string }[];
    expect(heard[0]?.name).toBe("pass_company");
  });
});

/**
 * Parity eval 2026-10-02 (c2c4513a): the reader's appAction arguments did
 * not fit the tool (INVALID_ARGUMENTS) and nothing was done. The arguments
 * are read once more against the tool's own schema and the same tool runs.
 */
describe("a reader's arguments the tool refuses are read again (parity eval 2026-10-02)", () => {
  const withAction = (args: Record<string, unknown>) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: null,
      appAction: { tool: "update_investor_profile", arguments: args },
    }) as TurnReaderResult;

  it("'Change our fund's website to https://lagoon-capital.example.': refused, re-read, done", async () => {
    const ran: unknown[] = [];
    const asked: unknown[] = [];
    const { answer, stored, delegated } = seam({
      said: "Change our fund's website to https://lagoon-capital.example.",
      reading: withAction({ website: "https://lagoon-capital.example" }),
      outcomes: [],
      offeredTools: ["update_investor_profile"],
      appActions: {
        tools: new Set(["update_investor_profile"]),
        run: (_request, action) => {
          ran.push(action.arguments);
          return Promise.resolve(
            "websiteUrl" in action.arguments
              ? "Prepared: your fund's website."
              : null,
          );
        },
      },
      appActionArguments: (_request, input) => {
        asked.push(input.tool);
        return Promise.resolve({
          websiteUrl: "https://lagoon-capital.example",
        });
      },
    });
    await answer.answer(request());
    expect(ran).toEqual([
      { website: "https://lagoon-capital.example" },
      { websiteUrl: "https://lagoon-capital.example" },
    ]);
    expect(asked).toEqual(["update_investor_profile"]);
    expect(stored.at(-1)?.content).toBe("Prepared: your fund's website.");
    expect(delegated()).toBe(0);
  });

  it("the same arguments read again are not run twice; the answer takes the turn", async () => {
    const ran: unknown[] = [];
    const { answer, delegated } = seam({
      said: "Change our fund's website to https://lagoon-capital.example.",
      reading: withAction({ websiteUrl: "nope" }),
      outcomes: [],
      offeredTools: ["update_investor_profile"],
      appActions: {
        tools: new Set(["update_investor_profile"]),
        run: (_request, action) => {
          ran.push(action.arguments);
          return Promise.resolve(null);
        },
      },
      appActionArguments: () => Promise.resolve({ websiteUrl: "nope" }),
    });
    await answer.answer(request());
    expect(ran).toHaveLength(1);
    expect(delegated()).toBe(1);
  });
});

/**
 * QA run 3af14042 (2026-10-03): "Make Ajopot seed deck private to my
 * organisation again" was read SET_VISIBILITY and "Make your company
 * private" was prepared. A deck's or pitch's audience is its own action.
 */
describe("a deck's audience is its own action, never the company's visibility (QA 3af14042)", () => {
  const deckPort = (ran: unknown[]): QAppActionPort => ({
    tools: new Set(["set_deck_audience", "set_pitch_sharing"]),
    run: (_request, action) => {
      ran.push(action);
      return Promise.resolve(`Prepared: ${action.tool}.`);
    },
  });
  const companyTurn = () =>
    ({
      ...request(),
      subjects: [{ kind: "COMPANY" as const, companyId: COMPANY }],
    }) as QAnswerRequest;
  const privateReading = () =>
    toolReading({
      kind: "SET_VISIBILITY",
      destination: null,
      visibility: "organisation_private",
    });

  it.each([
    [
      "Make Ajopot seed deck private to my organisation again",
      "set_deck_audience",
      { deck: "Ajopot seed deck", audience: "ORGANISATION" },
    ],
    [
      "Only my team should be able to play my pitch video",
      "set_pitch_sharing",
      { pitch: "my pitch video", sharing: "ORGANISATION" },
    ],
  ])(
    "%s -> %s; the company is never made private",
    async (said, tool, args) => {
      const ran: unknown[] = [];
      const noted: unknown[] = [];
      const run = seam({
        said,
        reading: privateReading(),
        outcomes: [],
        visibility: { noteVisibility: (entry) => noted.push(entry) },
        offeredTools: ["set_deck_audience", "set_pitch_sharing", "get_company"],
        appActions: deckPort(ran),
        appActionArguments: (_request, input) =>
          Promise.resolve(input.tool === tool ? args : null),
      });
      await run.answer.answer(companyTurn());
      expect(noted).toEqual([]);
      expect(ran).toEqual([{ tool, arguments: args }]);
      expect(run.stored.at(-1)?.content).toBe(`Prepared: ${tool}.`);
    },
  );

  it("'make my company private' is still the company's hand", async () => {
    const ran: unknown[] = [];
    const noted: unknown[] = [];
    const run = seam({
      said: "make my company private",
      reading: privateReading(),
      outcomes: [],
      visibility: { noteVisibility: (entry) => noted.push(entry) },
      offeredTools: ["set_deck_audience", "set_pitch_sharing"],
      appActions: deckPort(ran),
      appActionArguments: () => Promise.resolve(null),
    });
    await run.answer.answer(companyTurn());
    expect(ran).toEqual([]);
    expect(noted).toHaveLength(1);
  });
});

/**
 * QA parity run 1ec08a4b (2026-10-02): "Make our fund visible to founders on
 * Capital Q" was read as SET_VISIBILITY, the company's hand, and the investor
 * was told Q changes who sees a company. SET_VISIBILITY stays a company's;
 * with no company in the run and the fund's own action offered, that action
 * is done with the arguments read from their words.
 */
describe("a fund's visibility is its own action, never the company's hand (QA 1ec08a4b)", () => {
  const fundPort = (ran: unknown[]): QAppActionPort => ({
    tools: new Set(["set_investor_visibility", "pass_company"]),
    run: (_request, action) => {
      ran.push(action);
      return Promise.resolve(`Done: ${action.tool}.`);
    },
  });
  const said = "Make our fund visible to founders on Capital Q.";

  it("read as SET_VISIBILITY with no company: set_investor_visibility runs; the company hand does not", async () => {
    const ran: unknown[] = [];
    const noted: unknown[] = [];
    const asked: unknown[] = [];
    const run = seam({
      said,
      reading: toolReading({
        kind: "SET_VISIBILITY",
        destination: null,
        visibility: "network_visible",
      }),
      outcomes: [],
      visibility: { noteVisibility: (entry) => noted.push(entry) },
      offeredTools: ["set_investor_visibility", "get_company"],
      appActions: fundPort(ran),
      appActionArguments: (_request, input) => {
        asked.push(input);
        return Promise.resolve({ visibility: "network_visible" });
      },
    });
    await run.answer.answer(request());
    expect(noted).toEqual([]);
    expect(asked).toEqual([
      { tool: "set_investor_visibility", utterance: said },
    ]);
    expect(ran).toEqual([
      {
        tool: "set_investor_visibility",
        arguments: { visibility: "network_visible" },
      },
    ]);
    expect(run.stored.at(-1)?.content).toBe("Done: set_investor_visibility.");
    expect(run.stored.at(-1)?.content).not.toMatch(/who sees a company/);
  });

  it("'make my company visible to investors' with a company in the run is still the company's hand", async () => {
    const ran: unknown[] = [];
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
      offeredTools: ["set_investor_visibility"],
      appActions: fundPort(ran),
      appActionArguments: () =>
        Promise.resolve({ visibility: "network_visible" }),
    });
    const turn = {
      ...request(),
      subjects: [{ kind: "COMPANY" as const, companyId: COMPANY }],
    } as QAnswerRequest;
    await run.answer.answer(turn);
    expect(ran).toEqual([]);
    expect(noted).toHaveLength(1);
    expect(noted[0]?.["companyId"]).toBe(COMPANY);
  });

  it("without the fund's action offered, the company hand says what it can do, as before", async () => {
    const ran: unknown[] = [];
    const run = seam({
      said,
      reading: toolReading({
        kind: "SET_VISIBILITY",
        destination: null,
        visibility: "network_visible",
      }),
      outcomes: [],
      visibility: { noteVisibility: () => undefined },
      offeredTools: ["get_company"],
      appActions: fundPort(ran),
      appActionArguments: () =>
        Promise.resolve({ visibility: "network_visible" }),
    });
    await run.answer.answer(request());
    expect(ran).toEqual([]);
    expect(run.stored.at(-1)?.content).toMatch(/who sees a company/);
  });
});

/**
 * Lead 2026-10-02: the tool offer follows what the turn is about. The
 * fund-visibility and deck-audience lines still run their tools; a named
 * action reaches the answer as the turn's focus; "yes" keeps the last focus.
 */
describe("the tool offer follows the turn (tool focus)", () => {
  const named = (askedAction: string) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: null,
      appAction: null,
      askedAction,
    }) as TurnReaderResult;
  const port = (ran: unknown[]): QAppActionPort => ({
    tools: new Set(["set_investor_visibility", "set_deck_audience"]),
    run: (_request, action) => {
      ran.push(action);
      return Promise.resolve(`Done: ${action.tool}.`);
    },
  });

  for (const [said, tool, args] of [
    [
      "Make our fund visible to founders on Capital Q.",
      "set_investor_visibility",
      { visibility: "network_visible" },
    ],
    [
      "Let investors download our deck.",
      "set_deck_audience",
      { audience: "INVESTORS" },
    ],
  ] as const) {
    it(`'${said}' still runs ${tool}`, async () => {
      const ran: unknown[] = [];
      const run = seam({
        said,
        reading: named(tool),
        outcomes: [],
        offeredTools: [tool, "get_company"],
        appActions: port(ran),
        appActionArguments: () => Promise.resolve({ ...args }),
      });
      await run.answer.answer(request());
      expect(ran).toEqual([{ tool, arguments: args }]);
      expect(run.delegated()).toBe(0);
    });
  }

  it("a named action that is not an app action reaches the answer as the focus", async () => {
    const run = seam({
      said: "Book a call with Kora next week.",
      reading: named("propose_meeting"),
      outcomes: [],
      offeredTools: ["propose_meeting", "get_company"],
    });
    await run.answer.answer(request());
    expect(run.focuses[0]).toEqual({
      areas: ["Relationships"],
      // Research OFFERED (this harness's default): its tools stay in reach.
      tools: [
        "extract_public_web",
        "lookup_public_profile",
        "propose_meeting",
        "research_public_web",
      ],
    });
  });
});

/**
 * Parity eval 2026-10-02 (runs 9a63392f, e445cfb9): a stated decision about
 * a relationship names relationship_outcome (TURN_READER v35), and code
 * prepares it for approval through the declared action; an opinion does not.
 */
describe("a stated decision about a relationship is prepared, an opinion is not", () => {
  const port = (ran: unknown[]): QAppActionPort => ({
    tools: new Set(["relationship_outcome"]),
    run: (_request, action) => {
      ran.push(action);
      return Promise.resolve("I've prepared that for your approval.");
    },
  });
  const named = {
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
    handOver: null,
    appAction: null,
    askedAction: "relationship_outcome",
  } as TurnReaderResult;

  for (const said of [
    "We've decided not to proceed with Ledgerfold for now.",
    "We've decided not to proceed with Ledger fold for now.",
  ]) {
    it(`'${said}' prepares relationship_outcome for approval`, async () => {
      const ran: unknown[] = [];
      const asked: unknown[] = [];
      const run = seam({
        said,
        reading: named,
        outcomes: [],
        offeredTools: ["relationship_outcome", "get_relationship"],
        appActions: port(ran),
        appActionArguments: (_request, input) => {
          asked.push(input);
          return Promise.resolve({
            relationship: said.includes("Ledger fold")
              ? "Ledger fold"
              : "Ledgerfold",
            operation: "NOT_PROCEED",
          });
        },
      });
      await run.answer.answer(request());
      expect(asked).toEqual([
        { tool: "relationship_outcome", utterance: said },
      ]);
      expect(ran).toHaveLength(1);
      expect(run.stored.at(-1)?.content).toBe(
        "I've prepared that for your approval.",
      );
      expect(run.delegated()).toBe(0);
    });
  }

  it("'I'm not sure about Ledgerfold' prepares nothing", async () => {
    const ran: unknown[] = [];
    const run = seam({
      said: "I'm not sure about Ledgerfold.",
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: {
          kind: "ADVICE",
          text: "I'm not sure about Ledgerfold.",
          about: [],
        },
        aboutNamedOther: false,
        tool: null,
      },
      outcomes: [],
      offeredTools: ["relationship_outcome"],
      appActions: port(ran),
      appActionArguments: () =>
        Promise.resolve({
          relationship: "Ledgerfold",
          operation: "NOT_PROCEED",
        }),
    });
    await run.answer.answer(request());
    expect(ran).toEqual([]);
    expect(run.delegated()).toBe(1);
  });
});

/**
 * Lead 2026-10-03, runs 8b5ff536 and 5dd9bec5: a request to act that named
 * no tool was planned on the person's own company (Records), so the
 * Relationships actions -- diligence_documents among them -- were never
 * offered. A request that names one of their relationships' counterparts
 * brings the Relationships area; the registry then offers its app actions
 * on any purpose (q-tools tool-focus-offer: d396af2f).
 */
describe("a request naming a counterparty brings Relationships into the offer", () => {
  const untold = () =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: null,
      appAction: null,
      askedAction: null,
    }) as unknown as TurnReaderResult;

  it("8b5ff536 (Ajopot, own company): 'Share our financial model with Savanna Seed Partners (fictional).'", async () => {
    const run = seam({
      said: "Share our financial model with Savanna Seed Partners (fictional).",
      reading: untold(),
      outcomes: [],
      counterpartNames: ["Savanna Seed Partners (fictional)", "Lagoon Angels"],
    });
    await run.answer.answer({
      ...request(),
      subjects: [{ kind: "COMPANY" as const, companyId: COMPANY }],
    });
    expect(run.focuses.at(-1)).toEqual({
      areas: ["Records", "Relationships"],
      // Research OFFERED (this harness's default): its tools stay in reach.
      tools: [
        "extract_public_web",
        "lookup_public_profile",
        "research_public_web",
      ],
      widen: true,
    });
  });

  it("5dd9bec5 (Savanna, investor): 'Ask Ledgerfold for their last 12 months of management accounts.'", async () => {
    const run = seam({
      said: "Ask Ledgerfold for their last 12 months of management accounts.",
      reading: untold(),
      outcomes: [],
      counterpartNames: ["Ledgerfold"],
    });
    await run.answer.answer(request());
    expect(run.focuses.at(-1)).toEqual({
      areas: ["Relationships"],
      // Research OFFERED (this harness's default): its tools stay in reach.
      tools: [
        "extract_public_web",
        "lookup_public_profile",
        "research_public_web",
      ],
      widen: true,
    });
  });

  it("a request naming nobody they know is planned as before", async () => {
    const run = seam({
      said: "Make my company private.",
      reading: untold(),
      outcomes: [],
      counterpartNames: ["Ledgerfold"],
    });
    await run.answer.answer(request());
    expect(run.focuses.at(-1)).toBeUndefined();
  });
});

/**
 * Lead 2026-10-03 (runs 9b4ef8d1, 7dd0bc2c, 31d085ac): a request to act the
 * reader named no declared action for is routed by APP_ACTION_ROUTER over
 * the declared actions this person may take, then run through the same
 * arguments read and app action port as a named one.
 */
describe("a request the reader named nothing for is routed (APP_ACTION_ROUTER)", () => {
  const untold = () =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: true,
      tool: null,
      handOver: null,
      appAction: null,
      askedAction: null,
    }) as unknown as TurnReaderResult;
  const TOOLS = [
    "diligence_documents",
    "set_deck_audience",
    "set_pitch_sharing",
  ];

  it.each([
    [
      "9b4ef8d1",
      "Share our financial model with Savanna Seed Partners (fictional).",
      "diligence_documents",
      {
        relationship: "Savanna Seed Partners",
        operation: "SHARE",
        document: "financial model",
      },
    ],
    [
      "7dd0bc2c",
      "Ask Ledgerfold for their last 12 months of management accounts.",
      "diligence_documents",
      {
        relationship: "Ledgerfold",
        operation: "REQUEST",
        title: "Last 12 months of management accounts",
      },
    ],
    [
      "31d085ac",
      "Make Ajoot seed deck private to my organisation again.",
      "set_deck_audience",
      { deck: "Ajoot seed deck", audience: "ORGANISATION" },
    ],
  ])("%s: '%s' runs %s", async (_run, said, tool, args) => {
    const routedWith: { utterance: string; names: string[] }[] = [];
    const asked: unknown[] = [];
    const ran: unknown[] = [];
    const lines: [string, unknown][] = [];
    const record = (fields: unknown, message?: string) => {
      lines.push([message ?? "", fields]);
    };
    const logger = {
      info: record,
      warn: record,
      error: record,
      debug: record,
      child: () => logger,
    } as unknown as Logger;
    const run = seam({
      logger,
      said,
      reading: untold(),
      outcomes: [],
      offeredTools: TOOLS,
      appActionRouter: (_request, input) => {
        routedWith.push({
          utterance: input.utterance,
          names: input.candidates.map((c) => c.name).sort(),
        });
        return Promise.resolve(tool);
      },
      appActionArguments: (_request, input) => {
        asked.push(input);
        return Promise.resolve(args);
      },
      appActions: {
        tools: new Set(TOOLS),
        run: (_request, action) => {
          ran.push(action);
          return Promise.resolve({ prepared: "the card" });
        },
      },
    });
    await run.answer.answer(request());
    expect(routedWith).toEqual([{ utterance: said, names: TOOLS }]);
    // Logged before the code-run path returns (lead 2026-10-03).
    expect(lines).toContainEqual([
      "q request route",
      expect.objectContaining({
        routed: tool,
        action: tool,
        readerNamed: null,
      }),
    ]);
    expect(asked).toEqual([{ tool, utterance: said }]);
    expect(ran).toEqual([{ tool, arguments: args }]);
    // The engine says the card's status; nothing else is said here.
    expect(run.stored).toEqual([]);
    expect(run.delegated()).toBe(0);
  });

  it("a reader that named the action is not routed again; NONE answers as before", async () => {
    let routed = 0;
    const none = seam({
      said: "What is my runway?",
      reading: untold(),
      outcomes: [],
      offeredTools: TOOLS,
      appActionRouter: () => {
        routed += 1;
        return Promise.resolve(null);
      },
      appActions: { tools: new Set(TOOLS), run: () => Promise.resolve(null) },
    });
    await none.answer.answer(request());
    expect(routed).toBe(1);
    expect(none.delegated()).toBe(1);
  });
});

describe("counterpart names match through their parentheticals (run 9b4ef8d1)", () => {
  it.each([
    [
      "Share our financial model with Savanna Seed Partners (fictional).",
      "Savanna Seed Partners (fictional)",
      true,
    ],
    [
      "Share our financial model with Savanna Seed Partners.",
      "Savanna Seed Partners (fictional)",
      true,
    ],
    [
      "Share our deck with Savanna Seed Partners (fictional)",
      "Savanna Seed Partners",
      true,
    ],
    [
      "Ask Ledgerfold for their last 12 months of management accounts.",
      "Ledgerfold",
      true,
    ],
    [
      "We've decided not to proceed with Ledgefold for now.",
      "Ledgerfold",
      true,
    ],
    ["Make my company private.", "Ledgerfold", false],
    ["Share it with the team.", "Savanna Seed Partners (fictional)", false],
  ])("%s / %s -> %s", (said, name, expected) => {
    expect(namedInWords(said, name)).toBe(expected);
  });
});

describe("work handed over in general (QA 2026-10-03, runs 18eb8420, 5c6dcabe)", () => {
  const delegationPort = (
    context: DelegationContext,
    proposed: unknown[],
  ): QDelegationPort => ({
    context: () => Promise.resolve(context),
    propose: (_request, input) => {
      proposed.push(input);
      return Promise.resolve({
        status: "PREPARED",
        awaitingApprovalOf: "Q works on this for you, inside these limits",
      });
    },
  });
  const base = (
    handOver: {
      kind: "MEETING" | "HAND_OVER";
      counterpartName: string | null;
    } | null,
  ) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver,
    }) as TurnReaderResult;
  const handOverReading = (counterpartName: string | null) =>
    base({ kind: "HAND_OVER", counterpartName });
  const noRelationships: QHandOverPort = {
    prepare: () => Promise.resolve(null),
    candidates: () => Promise.resolve([]),
  };

  it("'just handle it' with nothing on screen: the standing-instruction card, never an invented target", async () => {
    const proposed: unknown[] = [];
    const prepared: unknown[] = [];
    const { answer, stored } = seam({
      said: "just handle it",
      reading: handOverReading(null),
      outcomes: [],
      handOver: {
        prepare: (_request, subject) => {
          prepared.push(subject);
          return Promise.resolve(null);
        },
        candidates: () =>
          Promise.resolve([
            {
              name: "Ajopot",
              subject: { kind: "RELATIONSHIP", relationshipId: "r-ajopot" },
            },
          ]),
      },
      delegation: delegationPort(
        { side: "INVESTOR", relationships: 1, outstanding: [] },
        proposed,
      ),
    });
    await answer.answer(request());
    expect(prepared).toEqual([]);
    expect(proposed).toEqual([
      { goal: "just handle it", includeNewCompanies: false },
    ]);
    const said = stored.at(-1)?.content ?? "";
    expect(said).toContain(
      "As a standing instruction, the card shows exactly what I'd do on my own",
    );
    expect(said).not.toContain("Ajopot");
    expect(said).not.toContain("couldn't");
  });

  it("'handle my investors' from a founder with none: says so, gives the real path, prepares the card", async () => {
    const proposed: unknown[] = [];
    const { answer, stored } = seam({
      said: "handle my investors",
      reading: handOverReading("my investors"),
      outcomes: [],
      handOver: noRelationships,
      delegation: delegationPort(
        {
          side: "COMPANY",
          relationships: 0,
          outstanding: [
            "DISCOVERY_VISIBILITY_CONFIRMED",
            "REQUIRED_DOCUMENTATION",
          ],
        },
        proposed,
      ),
    });
    await answer.answer(request());
    expect(proposed).toHaveLength(1);
    expect(stored.at(-1)?.content).toBe(
      "You don't have any investors on Capital Q yet, so there's no one for me to handle today. The real path is to make your company findable to investors and upload your deck, and I can help with both. Meanwhile, as a standing instruction I'd find investors who match and engage them for you, asking you first before anything goes out. The card shows what I'd do on my own, what I'd ask first and what never happens without you.",
    );
  });

  it("the router may name it among the actions: routed there, it is the standing instruction", async () => {
    const proposed: unknown[] = [];
    const candidates: string[][] = [];
    const { answer, stored } = seam({
      said: "take care of all of this for me",
      reading: base(null),
      outcomes: [],
      offeredTools: ["propose_standing_instruction"],
      appActionRouter: (_request, input) => {
        candidates.push(input.candidates.map((candidate) => candidate.name));
        return Promise.resolve("propose_standing_instruction");
      },
      appActions: {
        tools: new Set<string>(),
        run: () => Promise.resolve(null),
      },
      delegation: delegationPort(
        { side: "INVESTOR", relationships: 3, outstanding: [] },
        proposed,
      ),
    });
    await answer.answer(request());
    expect(candidates[0]).toContain("propose_standing_instruction");
    expect(proposed).toHaveLength(1);
    expect(stored.at(-1)?.content).toContain("standing instruction");
  });

  it("what else they said about the grant is read against the tool and carried", async () => {
    const proposed: unknown[] = [];
    const { answer } = seam({
      said: "take over my founder conversations, but ask me before every step",
      reading: handOverReading(null),
      outcomes: [],
      handOver: noRelationships,
      appActionArguments: (_request, input) =>
        Promise.resolve(
          input.tool === "propose_standing_instruction"
            ? { askFirst: true, goal: "ignored: their words are the goal" }
            : null,
        ),
      delegation: delegationPort(
        { side: "INVESTOR", relationships: 2, outstanding: [] },
        proposed,
      ),
    });
    await answer.answer(request());
    expect(proposed).toEqual([
      {
        goal: "take over my founder conversations, but ask me before every step",
        includeNewCompanies: false,
        more: { askFirst: true, goal: "ignored: their words are the goal" },
      },
    ]);
  });

  it("'just handle it' never accepts a waiting connection request in its place (runs 73c40208, bec2d96a, 1d641c09)", async () => {
    const proposed: unknown[] = [];
    const answered: unknown[] = [];
    const { answer, stored } = seam({
      said: "just handle it",
      reading: handOverReading(null),
      outcomes: [],
      handOver: {
        answerConnectionRequest: (_request, company) => {
          answered.push(company);
          return Promise.resolve({
            status: "PREPARED",
            awaitingApprovalOf:
              "Accept Ledgerfold's connection request and send them your message",
          });
        },
        prepare: () => Promise.resolve(null),
        candidates: () => Promise.resolve([]),
      },
      delegation: delegationPort(
        { side: "INVESTOR", relationships: 4, outstanding: [] },
        proposed,
      ),
    });
    await answer.answer(request());
    expect(answered).toEqual([]);
    expect(proposed).toHaveLength(1);
    expect(stored.at(-1)?.content).not.toContain("Ledgerfold");
  });

  it("'handle my investors' with relationships is the standing instruction, not a question (run d77f9934)", async () => {
    const proposed: unknown[] = [];
    const { answer, stored } = seam({
      said: "handle my investors",
      reading: handOverReading("my investors"),
      outcomes: [],
      handOver: {
        prepare: () => Promise.resolve(null),
        candidates: () =>
          Promise.resolve([
            {
              name: "Ventures Platform",
              subject: { kind: "RELATIONSHIP", relationshipId: "r-1" },
            },
            {
              name: "Voltron Capital",
              subject: { kind: "RELATIONSHIP", relationshipId: "r-2" },
            },
          ]),
      },
      delegation: delegationPort(
        { side: "COMPANY", relationships: 2, outstanding: [] },
        proposed,
      ),
    });
    await answer.answer(request());
    expect(proposed).toHaveLength(1);
    expect(stored.at(-1)?.content).toContain("standing instruction");
  });

  it("asked to negotiate terms too: the card for the rest, and terms stay theirs (run 8705e6e8)", async () => {
    const proposed: unknown[] = [];
    const { answer, stored } = seam({
      said: "Handle everything with my investors, including negotiating the valuation and terms for me.",
      reading: handOverReading("my investors"),
      outcomes: [],
      handOver: noRelationships,
      appActionArguments: () => Promise.resolve({ askedTermsOrMoney: true }),
      delegation: delegationPort(
        { side: "COMPANY", relationships: 2, outstanding: [] },
        proposed,
      ),
    });
    await answer.answer(request());
    expect(proposed).toHaveLength(1);
    expect(stored.at(-1)?.content).toContain(
      "I won't negotiate valuation, terms or money for you; those stay with you, and I'll handle the rest.",
    );
  });

  it("a founder's own company in the run is never the hand-over's subject (runs 4e9dc7c0, 02eb9643)", async () => {
    const proposed: unknown[] = [];
    const errands: unknown[] = [];
    const own = request();
    const ownRequest = {
      ...own,
      subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    } as QAnswerRequest;
    const { answer, stored } = seam({
      said: "Handle everything with my investors, including negotiating the valuation and terms for me.",
      reading: handOverReading("my investors"),
      outcomes: [],
      handOver: {
        prepare: (_request, subject) => {
          errands.push(subject);
          return Promise.resolve(null);
        },
        candidates: () =>
          Promise.resolve([
            {
              name: "Ventures Platform",
              subject: { kind: "RELATIONSHIP", relationshipId: "r-1" },
            },
          ]),
      },
      appActionArguments: () => Promise.resolve({ askedTermsOrMoney: true }),
      delegation: delegationPort(
        { side: "COMPANY", relationships: 4, outstanding: [] },
        proposed,
      ),
    });
    await answer.answer(ownRequest);
    expect(errands).toEqual([]);
    expect(proposed).toHaveLength(1);
    expect(stored.at(-1)?.content).toContain(
      "those stay with you, and I'll handle the rest",
    );
  });

  it("a meeting with no one named is still asked about by name", async () => {
    const proposed: unknown[] = [];
    const { answer, stored } = seam({
      said: "get me a meeting with them",
      reading: base({ kind: "MEETING", counterpartName: null }),
      outcomes: [],
      handOver: {
        prepare: () => Promise.resolve(null),
        candidates: () =>
          Promise.resolve([
            {
              name: "Kazikit",
              subject: { kind: "RELATIONSHIP", relationshipId: "r-k" },
            },
          ]),
      },
      delegation: delegationPort(
        { side: "INVESTOR", relationships: 1, outstanding: [] },
        proposed,
      ),
    });
    await answer.answer(request());
    expect(proposed).toEqual([]);
    expect(stored.at(-1)?.content).toBe(
      "Who should I set this up with: Kazikit?",
    );
  });
});

describe("what should I do next about themselves (lead 2026-10-03, run 2cba241a)", () => {
  const advice = (aboutNamedOther = false) =>
    ({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: { kind: "ADVICE", text: "what should I do next" },
      aboutNamedOther,
      tool: null,
      handOver: null,
    }) as unknown as TurnReaderResult;
  const LEAD =
    "Investors can't find your company in Discover yet. What to do next, most important first:\n1. Make the company visible to investors.";

  it("opens with code's readiness lines and answers on the conversational path, even with the company analysis able to take it", async () => {
    const run = seam({
      said: "what should I do next",
      reading: advice(),
      outcomes: [],
      specialistSupports: true,
      readinessLead: () => Promise.resolve(LEAD),
    });
    await run.answer.answer(request());
    expect(run.leads).toEqual([LEAD]);
    expect(run.investigated()).toBe(0);
  });

  it("not when it is about someone else, nor when there are no gaps", async () => {
    const other = seam({
      said: "what should I do next with Kazikit",
      reading: advice(true),
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
    });
    await other.answer.answer(request());
    expect(other.leads).toEqual([undefined]);
    const ready = seam({
      said: "what should I do next",
      reading: advice(),
      outcomes: [],
      readinessLead: () => Promise.resolve(null),
    });
    await ready.answer.answer(request());
    expect(ready.leads).toEqual([undefined]);
  });
});
