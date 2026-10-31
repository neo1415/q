import type { DelegationContext, QDelegationPort } from "../src/delegation.js";
import { asksToReviseDocument } from "../src/references.js";
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  QArtifactIdSchema,
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
import {
  createQTurnReader,
  TURN_READER_ATTEMPT_TIMEOUT_MS,
  TURN_READER_SAME_MODEL_HEDGE_MS,
  type QTurnReader,
} from "@capital-q/model-gateway/q";
import { ModelGatewayError } from "@capital-q/model-gateway";
import { createLogger, type Logger } from "@capital-q/observability";
import { Q_CAPABILITIES } from "@capital-q/q-tools";
import { PLAN_OFFER_LINES } from "@capital-q/q-core";
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
import { ActorContextSchema } from "@capital-q/security";

import {
  asksForWorkProducts,
  createSpecialistQAnswer,
  namedInWords,
  planStartWords,
  storedPlanOffer,
  TURN_REREAD_DEADLINE_MS,
  TURN_UNREAD_REPLY,
  unknownScreenLine,
} from "../src/answer.js";
import {
  RESEARCHED_MEMO_WAIT,
  teamJobLine,
  teamJobOutcomeOf,
  type QTeamJobPort,
  type TeamJobPriorAnswer,
} from "../src/team-job.js";
import type { CallPrep, QCallPrepPort } from "../src/call-prep.js";
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
  /** The reader itself, in place of `reading` (latency: signals, timing). */
  readonly read?: QTurnReader["read"];
  /** The extra reading's deadline (default: the seam's own). */
  readonly turnRereadDeadlineMs?: number;
  readonly outcomes: readonly QAnswerOutcome[];
  readonly visibility?: {
    noteVisibility: (entry: Record<string, unknown>) => void;
  };
  readonly offeredTools?: readonly string[];
  readonly openRecord?: import("../src/references.js").QOpenRecordPort;
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
  /** Several kinds of work at once: a team job (live 2026-10-12). */
  readonly teamJob?: QTeamJobPort;
  /** Situation-first planning (S5): a plan of their own. */
  readonly plan?: import("../src/plan-job-port.js").QPlanJobPort;
  /** A call with one named counterpart, prepared in the answer (v58). */
  readonly callPrep?: QCallPrepPort;
  /** A follow-up answered from what Q already showed (v54 fromShown). */
  readonly conversationRecall?: (
    request: QAnswerRequest,
    input: { readonly said: string },
  ) => Promise<string | null>;
  /** Readiness lead lines for "what should I do next?" (lead 2026-10-03). */
  readonly readinessLead?: (request: QAnswerRequest) => Promise<string | null>;
  /** The line offering a full plan that closes it (owner 2026-10-30). */
  readonly planOffer?: (request: QAnswerRequest) => Promise<string | null>;
  /** Their profile's gaps filled by code (TURN_READER v27). */
  readonly profileGaps?: QProfileGapsPort;
  /** ADR 0040: a declared app action the reading names. */
  readonly appActions?: QAppActionPort;
  /** Their relationships' counterpart names (lead 2026-10-03). */
  readonly counterpartNames?: readonly string[];
  /** An investor's own data room requests, with their state (QO-15). */
  readonly diligenceSummary?: (
    request: QAnswerRequest,
  ) => Promise<string | null>;
  /** One line of what a destination holds (coordinator 2026-10-23). */
  readonly destinationSummary?: (
    request: QAnswerRequest,
    destination: string,
  ) => Promise<string | null>;
  /** The shared translation layer, faked (QA F-96). */
  readonly localiseWords?: Parameters<
    typeof createSpecialistQAnswer
  >[0]["localiseWords"];
  /** A recording logger (lead 2026-10-03: the route is observable). */
  readonly logger?: Logger;
  /** The quick first read (a model), faked. */
  readonly turnSkim?: Parameters<typeof createSpecialistQAnswer>[0]["turnSkim"];
  /** What goes out live (owner 2026-10-23: the holding line). */
  readonly deltas?: { readonly text: string; readonly holding?: true }[];
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
  /** The conversation the seam's lines are in; a test may start another. */
  const conversation = { id: CONVERSATION as string };
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
  let counterpartReads = 0;
  const heardActions: unknown[] = [];
  const declaredActions: string[][] = [];
  const askedActions: (string | undefined)[] = [];
  const focuses: unknown[] = [];
  const namedOthers: (boolean | undefined)[] = [];
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
      if (options.read !== undefined) return options.read(input);
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
  const compares: unknown[] = [];
  const leadBlocks: unknown[] = [];
  const leads: (string | undefined)[] = [];
  const leadsSaid: (string | undefined)[] = [];
  const deltasAtDelegate: number[] = [];
  const closings: (string | undefined)[] = [];
  const unrecordedOffers: boolean[] = [];
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
        leadsSaid.push(req.leadLinesSaid?.answerMessageId);
        deltasAtDelegate.push(options.deltas?.length ?? 0);
        closings.push(req.closingLines);
        unrecordedOffers.push(req.offerTakenUnrecorded === true);
        focuses.push(req.toolFocus);
        namedOthers.push(req.aboutNamedOther);
        compares.push(req.compare);
        leadBlocks.push(req.leadBlocks);
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
          Promise.resolve(
            [...earlier, message].map((line) =>
              conversation.id === CONVERSATION
                ? line
                : {
                    ...line,
                    conversationId:
                      conversation.id as QConversationMessage["conversationId"],
                  },
            ),
          ),
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
    ...(options.turnRereadDeadlineMs === undefined
      ? {}
      : { turnRereadDeadlineMs: options.turnRereadDeadlineMs }),
    ...(options.openRecord === undefined
      ? {}
      : { openRecord: options.openRecord }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.turnSkim === undefined ? {} : { turnSkim: options.turnSkim }),
    ...(options.deltas === undefined
      ? {}
      : {
          deltas: {
            publish: (delta: { text: string; holding?: true }) => {
              options.deltas?.push({
                text: delta.text,
                ...(delta.holding === true ? { holding: true as const } : {}),
              });
            },
            subscribe: () => () => undefined,
            subscriberCount: () => 1,
          } as unknown as NonNullable<
            Parameters<typeof createSpecialistQAnswer>[0]["deltas"]
          >,
        }),
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
    ...(options.teamJob === undefined ? {} : { teamJob: options.teamJob }),
    ...(options.plan === undefined ? {} : { plan: options.plan }),
    ...(options.callPrep === undefined ? {} : { callPrep: options.callPrep }),
    ...(options.conversationRecall === undefined
      ? {}
      : { conversationRecall: options.conversationRecall }),
    ...(options.readinessLead === undefined
      ? {}
      : { readinessLead: options.readinessLead }),
    ...(options.planOffer === undefined
      ? {}
      : { planOffer: options.planOffer }),
    ...(options.appActionArguments === undefined
      ? {}
      : { appActionArguments: options.appActionArguments }),
    ...(options.appActions === undefined
      ? {}
      : { appActions: options.appActions }),
    ...(options.appActionRouter === undefined
      ? {}
      : { appActionRouter: options.appActionRouter }),
    ...(options.localiseWords === undefined
      ? {}
      : { localiseWords: options.localiseWords }),
    ...(options.destinationSummary === undefined
      ? {}
      : { destinationSummary: options.destinationSummary }),
    ...(options.diligenceSummary === undefined
      ? {}
      : { diligenceSummary: options.diligenceSummary }),
    ...(options.counterpartNames === undefined
      ? {}
      : {
          counterpartNames: () => {
            counterpartReads += 1;
            return Promise.resolve(options.counterpartNames ?? []);
          },
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
    compares,
    leadBlocks,
    warmed: () => warmed,
    marked,
    message,
    earlierLines: earlier,
    /** The same person's lines, now in a new conversation. */
    newConversation: () => {
      conversation.id = randomUUID();
    },
    probes,
    leads,
    leadsSaid,
    deltasAtDelegate,
    closings,
    unrecordedOffers,
    investigated: () => investigated,
    unread,
    capabilities,
    reads: () => reads,
    counterpartReads: () => counterpartReads,
    heardActions,
    declaredActions,
    askedActions,
    modalities,
    focuses,
    namedOthers,
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
  /** A skim that reads the turn as given, and a reading that lands later. */
  function holding(said: string, skimmed: Record<string, unknown> | null) {
    const deltas: { text: string; holding?: true }[] = [];
    let landReading: () => void = () => undefined;
    const run = seam({
      said,
      reading: null,
      read: () =>
        new Promise((resolve) => {
          landReading = () => {
            resolve(null);
          };
        }),
      turnSkim: {
        skim: () => Promise.resolve(skimmed as never),
      },
      outcomes: [{ kind: "ANSWERED", messageId: randomUUID() } as never],
      deltas,
      // The reading lands as none; its re-read is not what these test.
      turnRereadDeadlineMs: 40,
    });
    const answering = run.answer.answer(request());
    return { deltas, answering, land: () => landReading() };
  }

  it("says it is looking into whom the quick first read understood, before the turn is read (owner 2026-10-23)", async () => {
    const turn = holding("tell me about zino aviation and its team", {
      kind: "PERSON_SEARCH",
      // MEDIUM: the person lane is not taken; the answer path goes on.
      confidence: "MEDIUM",
      person: { name: "Zino Aviation", kind: "ORGANIZATION" },
    });
    await expect.poll(() => turn.deltas.length).toBeGreaterThan(1);
    // As the turn arrives, a line that names no one (a speed hint); then,
    // while the full reading is still out, whom the skim understood.
    expect(turn.deltas.slice(0, 2)).toEqual([
      { text: "Looking into that now. ", holding: true },
      { text: "Looking into Zino Aviation now. ", holding: true },
    ]);
    turn.land();
    await turn.answering;
  });

  it("names no one from the words alone: capitals and question words are a speed hint, never a name (owner 2026-10-23)", async () => {
    for (const said of ["Tell me about Zino Aviation", "Who Is It?"]) {
      const turn = holding(said, { kind: "OTHER", confidence: "HIGH" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      turn.land();
      await turn.answering;
      expect(turn.deltas.filter((d) => d.holding === true)).toEqual([
        { text: "Looking into that now. ", holding: true },
      ]);
    }
    // A reply is no question: nothing is said before it is read.
    const yes = holding("Yes", { kind: "OTHER", confidence: "HIGH" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    yes.land();
    await yes.answering;
    expect(yes.deltas.filter((d) => d.holding === true)).toEqual([]);
  });

  it("says it is drafting the note, to whom the skim understood, at skim time (QA F-23)", async () => {
    const turn = holding(
      "Draft a note to the founders of the second company saying I'd like a call next week",
      {
        kind: "OTHER",
        confidence: "HIGH",
        subject: { name: "Silo Credit", kind: "COMPANY" },
        writes: true,
      },
    );
    await expect.poll(() => turn.deltas.length).toBeGreaterThan(0);
    expect(turn.deltas).toEqual([
      { text: "Drafting that note to Silo Credit now. ", holding: true },
    ]);
    turn.land();
    await turn.answering;
    // No one understood: still says it is drafting, naming no one.
    const nameless = holding("draft a note for me", {
      kind: "OTHER",
      confidence: "HIGH",
      writes: true,
    });
    await expect.poll(() => nameless.deltas.length).toBeGreaterThan(0);
    expect(nameless.deltas).toEqual([
      { text: "Drafting that now. ", holding: true },
    ]);
    nameless.land();
    await nameless.answering;
  });

  it('a "Yes" to an offer about Zino is named only as the skim understood it', async () => {
    const turn = holding("Yes", {
      kind: "OTHER",
      confidence: "HIGH",
      subject: { name: "Zino Aviation", kind: "COMPANY" },
    });
    await expect.poll(() => turn.deltas.length).toBeGreaterThan(0);
    expect(turn.deltas).toEqual([
      { text: "Looking into Zino Aviation now. ", holding: true },
    ]);
    turn.land();
    await turn.answering;
  });

  it("F-36: the Arabic 'افتح صفحة الاكتشاف' read as NAVIGATE DISCOVER opens Discover (the move words are only known in English)", async () => {
    const run = seam({
      said: "افتح صفحة الاكتشاف",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "DISCOVER",
        visibility: null,
      }),
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(0);
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "DISCOVER" },
      },
    ]);
  });

  it("F-34: 'Show me my Q Card and the share link' is answered from the card, never only a move to the profile", async () => {
    const run = seam({
      said: "Show me my Q Card and the share link.",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "PROFILE",
        visibility: null,
      }),
      outcomes: [{ kind: "ANSWERED", messageId: randomUUID() } as never],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(1);
    expect(
      run.stored.flatMap((message) => message.blocks ?? []),
    ).not.toContainEqual(expect.objectContaining({ kind: "UI_INTENT" }));
  });

  it("a statement in English naming no page still never moves them", async () => {
    const run = seam({
      said: "I'm looking at Discover right now.",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "DISCOVER",
        visibility: null,
      }),
      outcomes: [{ kind: "ANSWERED", messageId: randomUUID() } as never],
    });
    await run.answer.answer(request());
    expect(
      run.stored.flatMap((message) => message.blocks ?? []),
    ).not.toContainEqual(expect.objectContaining({ kind: "UI_INTENT" }));
  });

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
    // Said as a person says it, never "Taking you to…" (round 3).
    expect(run.stored[0]?.content).toMatch("Opening Discover…");
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

  it("live 2026-10-30: a founder's 'take me to my mandate' never claims to open an investor's page; Q says what a mandate is and opens their raise", async () => {
    // The reader's own NAVIGATE MANDATE (the live path), and a reading
    // that named another page while the words name the mandate.
    for (const destination of ["MANDATE", "PROFILE"] as const) {
      const run = seam({
        said: "take me to my mandate",
        reading: toolReading({
          kind: "NAVIGATE",
          destination,
          visibility: null,
        }),
        outcomes: [],
      });
      const outcome = await run.answer.answer(request());
      expect(outcome.kind, destination).toBe("ANSWERED");
      expect(run.delegated()).toBe(0);
      const content = run.stored[0]?.content ?? "";
      expect(content).not.toMatch(/Opening your mandate/u);
      expect(content).toMatch(/A mandate is an investor's/u);
      const blocks = run.stored[0]?.blocks ?? [];
      expect(blocks).not.toContainEqual(
        expect.objectContaining({
          intent: { kind: "NAVIGATE", destination: "MANDATE" },
        }),
      );
      expect(blocks).toContainEqual({
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "CAPITAL_RAISE" },
      });
    }
  });

  // Coordinator 23 Oct 2026: "Show me my fundraising pipeline" said only
  // "Opening your pipeline…". The move says what is in it, then opens it.
  it("a move to their pipeline says what is in it first", async () => {
    const asked: string[] = [];
    const run = seam({
      said: "Show me my fundraising pipeline",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "CRM_PIPELINE",
        visibility: null,
      }),
      outcomes: [],
      destinationSummary: (_request, destination) => {
        asked.push(destination);
        return Promise.resolve(
          "3 investors: Savanna Seed Partners connected; Zino Aviation and Rift Valley waiting for your reply.",
        );
      },
    });
    expect((await run.answer.answer(request())).kind).toBe("ANSWERED");
    expect(asked).toEqual(["CRM_PIPELINE"]);
    expect(run.stored[0]?.content).toMatch(
      /^3 investors: Savanna Seed Partners connected; Zino Aviation and Rift Valley waiting for your reply\. Opening your pipeline/u,
    );
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
      },
    ]);
  });

  // QA F-96 (24 Oct 2026): code's English lines ("Opening your pipeline…",
  // the summary before it) reached a turn in Arabic in English. They go
  // through the shared translation layer, with the turn; English turns
  // never call it.
  it("a move asked in Arabic is said in Arabic", async () => {
    const asked: { turn: string | undefined; texts: string[] }[] = [];
    const run = seam({
      said: "اعرض لي مسار جمع التمويل",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "CRM_PIPELINE",
        visibility: null,
      }),
      outcomes: [],
      destinationSummary: () =>
        Promise.resolve("3 investors: Savanna Seed Partners connected."),
      localiseWords: (who, texts) => {
        asked.push({ turn: who.turn, texts: [...texts] });
        return Promise.resolve(texts.map(() => "[ar]"));
      },
    });
    expect((await run.answer.answer(request())).kind).toBe("ANSWERED");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.turn).toBe("اعرض لي مسار جمع التمويل");
    expect(run.stored[0]?.content).not.toMatch(/Opening your pipeline/u);
    expect(run.stored[0]?.content).toContain("[ar]");
  });

  it("a move asked in English never calls the translation layer", async () => {
    const asked: string[][] = [];
    const run = seam({
      said: "Show me my fundraising pipeline",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "CRM_PIPELINE",
        visibility: null,
      }),
      outcomes: [],
      localiseWords: (_who, texts) => {
        asked.push([...texts]);
        return Promise.resolve(texts.map(() => null));
      },
    });
    expect((await run.answer.answer(request())).kind).toBe("ANSWERED");
    expect(asked).toHaveLength(0);
    expect(run.stored[0]?.content).toMatch(/Opening your pipeline/u);
  });

  // QA 2026-10-24: an investor's "Show my pipeline" (no "me") was left to
  // the reader and answered with their capital commitments. It is the same
  // page request as "show me my pipeline", whatever the reading says.
  it("'show my pipeline' opens their pipeline by code, with what is in it", async () => {
    const asked: string[] = [];
    const run = seam({
      said: "Show my pipeline",
      reading: null,
      outcomes: [],
      destinationSummary: (_request, destination) => {
        asked.push(destination);
        return Promise.resolve(
          "2 companies: Ledgerfold and Mizan in diligence.",
        );
      },
    });
    expect((await run.answer.answer(request())).kind).toBe("ANSWERED");
    expect(asked).toEqual(["CRM_PIPELINE"]);
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "CRM_PIPELINE" },
      },
    ]);
  });

  it("an investor's data room requests open the CRM, said where they are and what they asked (QO-15)", async () => {
    const ORG = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
    const subject = {
      kind: "INVESTOR_ORGANISATION" as const,
      investorOrganisationId: ORG,
    };
    const base = request();
    const investor: QAnswerRequest = {
      ...base,
      plan: PermittedContextPlanSchema.parse({
        ...base.plan,
        scopes: [
          {
            kind: "INVESTOR_MANDATE",
            subject,
            contextLabel: "investor_private",
            sensitivity: "CONFIDENTIAL",
            layer: "STRUCTURED_STATE",
            factCategories: ["INVESTOR_THESIS"],
            projection: "FULL",
            rights: {
              canUseForReasoning: true,
              canDiscloseExistence: true,
              canQuote: true,
              canProvideLink: false,
            },
            filter: { tenantId: TENANT, investorOrganisationId: ORG },
            isEvidence: true,
          },
        ],
      }),
    };
    const run = seam({
      said: "Take me to my data room requests",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "OWN_DATA_ROOM",
        visibility: null,
      }),
      outcomes: [],
      diligenceSummary: () =>
        Promise.resolve(
          "You've asked two companies for documents: Kora (2 open) and Ledgerfold (1 answered).",
        ),
    });
    expect((await run.answer.answer(investor)).kind).toBe("ANSWERED");
    const said = run.stored[0]?.content ?? "";
    expect(said).toMatch(
      /^You've asked two companies for documents: Kora \(2 open\) and Ledgerfold \(1 answered\)\. Your data room requests are on each company's Diligence tab in the CRM/u,
    );
    expect(said).not.toMatch(/your data room\./iu);
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "RELATIONSHIPS" },
      },
    ]);

    // A founder's own data room is still theirs.
    const founder = seam({
      said: "Take me to my data room",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "OWN_DATA_ROOM",
        visibility: null,
      }),
      outcomes: [],
    });
    expect((await founder.answer.answer(request())).kind).toBe("ANSWERED");
    expect(founder.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "OWN_DATA_ROOM" },
      },
    ]);
  });

  it.each([
    "Can you pitch Capital Q to me?",
    "Peux-tu me présenter Capital Q ?",
    "¿Qué puedes hacer?",
  ])(
    "starts Q Pitch for %s, read as a question about Capital Q (v6, live 2026-10-17)",
    async (said) => {
      const run = seam({
        said,
        reading: {
          ...toolReading({
            kind: "NAVIGATE",
            destination: "Q_PITCH",
            visibility: null,
          }),
          kind: "QUESTION_TO_Q",
          question: {
            kind: "ABOUT_CAPITAL_Q",
            text: "what is Capital Q?",
            about: [],
            count: null,
            discover: null,
            subject: null,
          },
        },
        outcomes: [],
      });
      await run.answer.answer(request());
      expect(run.delegated()).toBe(0);
      expect(run.stored[0]?.blocks).toEqual([
        {
          kind: "UI_INTENT",
          intent: { kind: "NAVIGATE", destination: "Q_PITCH" },
        },
      ]);
    },
  );

  it("answers, without the tour, a question about pitches the reader sent to Q_PITCH", async () => {
    const run = seam({
      said: "Don't pitch Capital Q to me, just tell me what you found",
      reading: {
        ...toolReading({
          kind: "NAVIGATE",
          destination: "Q_PITCH",
          visibility: null,
        }),
        kind: "QUESTION_TO_Q",
        question: {
          kind: "ABOUT_CAPITAL_Q",
          text: "what is Capital Q?",
          about: [],
          count: null,
          discover: null,
          subject: null,
        },
      },
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(1);
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
    expect(run.stored[0]?.content).toMatch("Opening Explore…");
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

  it("answers 'tell me about the third company on the list' and never moves them (QA F-41); 'open the third one' opens it", async () => {
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
      // Read (an unread turn is told so, never answered: run 8bc5116c).
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
      },
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
    // A question about the card: the answer path answers it, with the
    // record bound; nothing opens and the conversation stays (QA F-41).
    expect(run.delegated()).toBe(1);
    expect(
      run.stored.flatMap((message) => message.blocks ?? []),
    ).not.toContainEqual(expect.objectContaining({ kind: "UI_INTENT" }));
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
  question: {
    kind: "ADVICE",
    text: "what else should I look for?",
    about: [],
    count: null,
    discover: null,
    subject: null,
  },
  aboutNamedOther: false,
  tool: null,
};

// TURN_READER v62 (lane 8, 23 Oct 2026): "compare the top two in a table"
// was answered from what Q had shown, in prose, with no table. A comparison
// the reader read goes the full way, carrying the reading, in any words.
// U4/F8 (QA 24 Oct 2026): "open the data room and tell me X" opened the
// page and lost the question. The move goes with the answer.
describe("a move with a question after it", () => {
  it("is answered, carrying the move", async () => {
    const run = seam({
      said: "Open my data room and tell me what's missing",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "OWN_DATA_ROOM",
        visibility: null,
      }),
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(1);
    expect(run.leadBlocks).toEqual([
      [
        {
          kind: "UI_INTENT",
          intent: { kind: "NAVIGATE", destination: "OWN_DATA_ROOM" },
        },
      ],
    ]);
  });

  it("a move alone is still only the move", async () => {
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
    expect(run.delegated()).toBe(0);
  });
});

describe("a comparison the reader read", () => {
  it("is answered in full with the reading, never from what was shown", async () => {
    // A reading carrying v62's compare (the harness takes the v1 shape).
    const comparing = { ...advice, compare: { count: 2, names: [] } };
    const run = seam({
      said: "Lequel des deux est le meilleur ?",
      reading: comparing,
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(1);
    expect(run.compares).toEqual([{ count: 2, names: [] }]);
  });
});

// Live 2026-10-25: the reader's 2.5-4.5 s carried no run, so a run's
// model usage hid where its time went.
describe("the reading is the run's", () => {
  it("is asked for with the run it reads, so its usage is the run's", async () => {
    const runs: (string | undefined)[] = [];
    const run = seam({
      said: "How do the top two stack up?",
      reading: null,
      read: (input) => {
        runs.push(input.attribution.qRunId);
        return Promise.resolve(null);
      },
      outcomes: [],
    });
    const asked = request();
    await run.answer.answer(asked);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((one) => one === asked.runId)).toBe(true);
  });
});

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
          count: null,
          discover: null,
          subject: null,
        },
      },
      outcomes: [],
    });
    await answer.answer(request());
    expect(directives[0]?.mode).toBe("EXPLICIT");
  });

  it("never researches a turn it could not read", async () => {
    const { answer, directives, delegated } = seam({
      said: "Any news on Acme?",
      reading: null,
      outcomes: [],
    });
    await answer.answer(request());
    expect(directives).toEqual([]);
    expect(delegated()).toBe(0);
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
      said: "what a week it has been",
      reading: clear(true),
      outcomes: [],
      spoken: true,
    });
    await run.answer.answer(request());
    expect(run.modalities).toEqual(["VOICE"]);
    const typed = seam({
      said: "what a week it has been",
      reading: clear(true),
      outcomes: [],
    });
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
    const run = seam({
      said: "what a week it has been",
      reading: clear(false),
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(1);
  });

  // RECOVERY-2026-10 (live T1, 11:13): "Fidiani inanituma attention" was
  // read UNCLEAR, Q went SILENT, and the realtime voice improvised "could
  // you give me more detail…" in Q's place. SILENT is now only for speech
  // meant for someone else (the test above); a spoken turn to Q that could
  // not be made out always gets Q's own short prompt, never a model.
  it("answers an unclear spoken turn to Q with a short prompt, varied, never silence", async () => {
    const run = seam({
      said: "Fidiani inanituma attention",
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
    const outcomes = [
      await run.answer.answer(request()),
      await run.answer.answer(request()),
      await run.answer.answer(request()),
    ];
    expect(run.delegated()).toBe(0);
    for (const outcome of outcomes) {
      expect(outcome.kind === "ANSWERED" && outcome.messageId).not.toBeNull();
    }
    const lines = run.stored.map((message) => message.content);
    expect(lines).toEqual([
      "Sorry, I didn't catch that. Say it again?",
      "I still couldn't make that out. Could you put it another way, or type it?",
      "I'm not catching it, sorry. Typing it in the box works too.",
    ]);
  });

  it("invites a cut-off spoken turn to go on", async () => {
    const run = seam({
      said: "can you show me the",
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "LOW",
        transcript: "FRAGMENT",
        question: null,
        aboutNamedOther: false,
        tool: null,
      },
      outcomes: [],
      spoken: true,
    });
    await run.answer.answer(request());
    expect(run.stored.map((message) => message.content)).toEqual(["Go on."]);
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

  // Live 2026-10-30 (run 8bc5116c): "Plan my raise over 8 weeks", unread
  // twice, was answered by the general answer as a chat memo and the plan
  // never started. Not knowing what the turn asks, Q guesses no path: it
  // says it could not read it and that nothing was started.
  it("says it could not read the turn, and answers nothing else, when both tries fail", async () => {
    const run = seam({
      said: "Plan my raise over 8 weeks",
      reading: null,
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.reads()).toBe(2);
    expect(run.delegated()).toBe(0);
    expect(run.unread).toEqual([]);
    expect(run.stored.map((message) => message.content)).toEqual([
      TURN_UNREAD_REPLY,
    ]);
    expect(TURN_UNREAD_REPLY).toMatch(/haven't started anything/u);
  });

  it("a reader whose gateway times out twice is the same unread turn: told, not guessed (fake gateway timeouts)", async () => {
    let attempts = 0;
    // The real turn reader over a gateway whose attempts all time out, as
    // run 8bc5116c's did (three TIMEOUTs on the only eligible model).
    const reader = createQTurnReader({
      gateway: {
        execute: () => {
          attempts += 1;
          return Promise.reject(
            new ModelGatewayError(
              "model request failed after bounded attempts",
              { failureClass: "TIMEOUT", attempts: 2, candidates: [] },
            ),
          );
        },
      },
      logger: createLogger(
        { serviceName: "q-specialists-test", environment: "test" },
        { level: "silent" },
      ),
    });
    const run = seam({
      said: "Plan my raise over 8 weeks",
      reading: null,
      outcomes: [],
      read: (input) => reader.read(input),
    });
    await run.answer.answer(request());
    expect(run.reads()).toBe(2);
    expect(attempts).toBe(2);
    expect(run.delegated()).toBe(0);
    expect(run.stored.map((message) => message.content)).toEqual([
      TURN_UNREAD_REPLY,
    ]);
  });

  it("the extra reading is cut off at its deadline: one extra try, the turn answered as unread", async () => {
    const signals: AbortSignal[] = [];
    const run = seam({
      said: "make me a pdf of my thesis",
      reading: null,
      outcomes: [],
      turnRereadDeadlineMs: 40,
      // The first reading fails (the gateway's own attempts spent); the
      // extra one hangs until its signal is aborted.
      read: (input) => {
        const signal = input.signal ?? new AbortController().signal;
        signals.push(signal);
        if (signals.length === 1) {
          return Promise.reject(new Error("both attempts failed"));
        }
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    });
    const started = Date.now();
    await run.answer.answer(request());
    expect(run.reads()).toBe(2);
    expect(signals[1]?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(run.delegated()).toBe(0);
    expect(run.stored.map((message) => message.content)).toEqual([
      TURN_UNREAD_REPLY,
    ]);
  });

  // Live 2026-10-30 (run 8bc5116c): the re-read's model answered at
  // 5,986 ms and the 6,000 ms deadline, equal to the attempt's own
  // timeout, threw the answer away.
  it("the extra reading outlasts the reader's own attempt, so an answer inside it is kept", () => {
    expect(TURN_REREAD_DEADLINE_MS).toBeGreaterThan(
      TURN_READER_ATTEMPT_TIMEOUT_MS,
    );
  });

  it("the extra reading has the reader's own time: a slow second read (2.8 s) still reads the turn (live 2026-10-29, run B)", async () => {
    // Run B: the 2.5 s re-read was cancelled before its model answered
    // (p90 4.2 s), so a research ask was answered unread.
    expect(TURN_REREAD_DEADLINE_MS).toBeGreaterThan(
      TURN_READER_SAME_MODEL_HEDGE_MS,
    );
    let reads = 0;
    const run = seam({
      said: "let's have a look at discover",
      reading: null,
      outcomes: [],
      read: () => {
        reads += 1;
        if (reads === 1) return Promise.reject(new Error("both timed out"));
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                toolReading({
                  kind: "NAVIGATE",
                  destination: "DISCOVER",
                  visibility: null,
                }),
              ),
            2_800,
          ),
        );
      },
    });
    await run.answer.answer(request());
    expect(reads).toBe(2);
    expect(run.unread).toEqual([]);
    expect(run.stored[0]?.blocks?.[0]).toMatchObject({ kind: "UI_INTENT" });
  }, 10_000);

  it("a run already aborted gets no extra reading", async () => {
    const controller = new AbortController();
    const run = seam({
      said: "make me a pdf of my thesis",
      reading: null,
      outcomes: [],
      read: () => {
        // The run is cancelled while its first reading fails.
        controller.abort();
        return Promise.resolve(null);
      },
    });
    await run.answer
      .answer({ ...request(), signal: controller.signal })
      .catch(() => undefined);
    expect(run.reads()).toBe(1);
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
          "OWN_DATA_ROOM",
          "OWN_DECK",
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
          "CRM_PIPELINE",
          "Q_PITCH",
          "BOARD",
          // An investor's own screen: no investor organisation in this plan.
        ],
        documents: [],
        visibilityChange: false,
        offers: [
          expect.objectContaining({ destination: "SETTINGS" }),
          // G: accept an invitation to a company or firm, or ask to join.
          expect.objectContaining({ destination: "SETTINGS" }),
          expect.objectContaining({ destination: "SETTINGS" }),
          // Correct something Q remembers, through the memory Write Gate.
          expect.objectContaining({ destination: "MEMORY" }),
          // Their Q email address: copy it, or get a new one (inbound email).
          expect.objectContaining({ destination: "SETTINGS" }),
          // Set aside one of Q's suggestions on Work ("Not now").
          expect.objectContaining({ destination: "WORK" }),
          // Delegation on a standing instruction (switch on/off).
          expect.objectContaining({ destination: "WORK" }),
          // Profile photo and cover (cropped on the profile).
          expect.objectContaining({ destination: "PROFILE" }),
          // Data room: share a whole folder, and let unconnected investors
          // see its folder names and counts (never titles or contents).
          expect.objectContaining({ destination: "DOCUMENTS" }),
          expect.objectContaining({ destination: "DOCUMENTS" }),
          // Upload a document of their own for Q to read.
          expect.objectContaining({ destination: "HOME" }),
          // Unsend, block, unblock, report (chat).
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          // CRM saved views: save, rename, share with the team or delete.
          expect.objectContaining({ destination: "RELATIONSHIPS" }),
          // CRM S3: add or correct a private note on a relationship.
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
          // GateQ, in registry order: Find my startup (F4), the inbox's
          // approved words (F3), and setting up a gateway from a mandate.
          expect.objectContaining({ destination: "GATEWAY" }),
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
      count: null,
      discover: null,
      subject: null,
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
    // QA F-89: the request is its own turn; the unrelated card waits and
    // does not take the answer.
    expect(stored.map((m) => m.content).join("\n")).not.toMatch(
      /That's ready: Reminder|Still waiting for your approval/u,
    );
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

  // QA F-89 (U10) replaces "one short waiting line" (lead 2026-10-03): a
  // waiting card takes only a turn about it, so an unrelated request is
  // answered as any other, with no line about the card, which still waits.
  it("with the engine's step composed, an unrelated request defers no waiting line", async () => {
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
    expect(deferred).toEqual([]);
  });

  it("a different request with a card pending: answered alone, the card still waiting (QA F-89)", async () => {
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
    expect(stored.map((m) => m.content)).toEqual(["Saved Ajopot."]);
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
    // Unread (run 8bc5116c): no answer is guessed; Q says so, and the card
    // is still said to be waiting after it.
    expect(delegated()).toBe(0);
    expect(stored[0]?.content).toBe(TURN_UNREAD_REPLY);
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
    expect(run.stored.at(-1)?.content).toMatch("Opening Discover…");
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

  it("is made for a new conversation's first turn from the person's last actions: one reading, used", async () => {
    const run = navigate();
    // An earlier conversation of theirs taught the reader's actions.
    await run.answer.answer(request());
    expect(run.reads()).toBe(1);
    run.newConversation();
    const first = request();
    early(run, first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Read beside the firewall, before the answer began.
    expect(run.reads()).toBe(2);
    const outcome = await run.answer.answer(first);
    expect(outcome.kind).toBe("ANSWERED");
    // Exactly one reading for the new conversation's first turn: the early one.
    expect(run.reads()).toBe(2);
    expect(run.stored.at(-1)?.content).toMatch("Opening Discover…");
  });

  it("is not made for a person's first turn this process has seen", async () => {
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

  it("a founder accepting an investor's waiting interest answers it, never an errand that waits for them (QA F-33)", async () => {
    const asked: (string | null)[] = [];
    const { value, errands } = port(() => null);
    const handOver: QHandOverPort = {
      ...value,
      answerIncomingInterest: (_request, investor) => {
        asked.push(investor);
        return Promise.resolve({
          status: "PREPARED",
          awaitingApprovalOf: "Accept Rift Valley Seed Fund's interest",
        });
      },
    };
    const { answer, stored, delegated } = seam({
      said: "Reply to Rift Valley Seed Fund: accept their interest and suggest a call next week.",
      reading: reading("Rift Valley Seed Fund"),
      outcomes: [],
      handOver,
    });
    await answer.answer(request());
    expect(asked).toEqual(["Rift Valley Seed Fund"]);
    expect(errands).toEqual([]);
    expect(delegated()).toBe(0);
    const line = stored.at(-1)?.content ?? "";
    expect(line).toContain("Accept Rift Valley Seed Fund's interest");
    expect(line).not.toMatch(
      /hasn't accepted your interest|nothing to accept/u,
    );
  });

  it("falls through to the errand when no investor's interest waits on them", async () => {
    const { value, errands } = port(() => null);
    const handOver: QHandOverPort = {
      ...value,
      answerIncomingInterest: () =>
        Promise.resolve({
          status: "NO_PENDING_INTEREST",
          awaitingApprovalOf: "No investor's interest is waiting.",
        }),
    };
    await run(handOver, null, true);
    expect(errands).toHaveLength(1);
  });

  it("a request for research, a memo and diligence questions is never answered by accepting a waiting request (live 2026-10-12)", async () => {
    const { value, asked, errands } = port(() => ({
      status: "PREPARED",
      awaitingApprovalOf:
        "Accept Ledgerfold's connection request and send them your message",
    }));
    const { answer, delegated } = seam({
      said: "Research Ledgerfold and how it fits Savanna Seed Partners, assess the opportunity, identify the important risks and missing information, prepare an investment memo, get a second specialist to critique it, revise the memo, and prepare appropriate founder diligence questions. Show me the results and anything requiring my approval.",
      reading: reading("Ledgerfold"),
      outcomes: [],
      handOver: value,
    });
    await answer.answer(request());
    expect(asked).toEqual([]);
    expect(errands).toEqual([]);
    expect(delegated()).toBe(1);
  });

  it("the same request, with Q's team composed, is planned as one team job and the plan is said back (live 2026-10-12)", async () => {
    const { value, asked, errands } = port(() => null);
    const goals: string[] = [];
    const teamJob: QTeamJobPort = {
      propose: (_request, goal) => {
        goals.push(goal);
        return Promise.resolve({
          status: "PREPARED",
          plan: {
            summary:
              "Research Ledgerfold, write and critique a memo, draft diligence questions.",
            steps: [
              { who: "Research", does: "Reads Ledgerfold's public record." },
              { who: "Documents", does: "Writes the investment memo." },
              { who: "Reviewer", does: "Critiques it and revises it once." },
              { who: "Diligence", does: "Drafts the founder questions." },
            ],
            needsYou: ["Sending the questions needs your approval."],
            cannot: [],
          },
        });
      },
    };
    const said =
      "Research Ledgerfold and how it fits Savanna Seed Partners, assess the opportunity, identify the important risks and missing information, prepare an investment memo, get a second specialist to critique it, revise the memo, and prepare appropriate founder diligence questions. Show me the results and anything requiring my approval.";
    const { answer, delegated, stored } = seam({
      said,
      // The reader reads it as team work (no keyword path, 2026-10-28).
      reading: { ...reading("Ledgerfold"), teamJob: true } as TurnReaderResult,
      outcomes: [],
      handOver: value,
      teamJob,
    });
    await answer.answer(request());
    expect(goals).toEqual([said]);
    expect(asked).toEqual([]);
    expect(errands).toEqual([]);
    expect(delegated()).toBe(0);
    expect(stored.at(-1)?.content).toBe(
      "I've planned this in 4 steps: Research → Documents → Reviewer → Diligence. Sending the questions needs your approval.",
    );
  });

  it("a team job that could not be planned is said plainly, never covered by an answer (lead review 2026-10-12)", async () => {
    const teamJob: QTeamJobPort = {
      propose: () => Promise.resolve({ status: "NOT_PLANNED" }),
    };
    const { answer, delegated, stored } = seam({
      said: "Research Ledgerfold, write a memo and have it critiqued",
      reading: { ...reading(null), teamJob: true } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(delegated()).toBe(0);
    expect(stored.at(-1)?.content).toMatch(
      /^I couldn't turn that into a plan I can carry out, so nothing has started\./u,
    );
  });

  it("a go-ahead after 'Shall I plan this one anyway?' plans the goal they first gave, with proceed (live 2026-10-12)", async () => {
    const goal =
      "Research Ledgerfold, assess the opportunity, prepare an investment memo, get it critiqued and prepare founder diligence questions";
    const calls: { goal: string; proceed: boolean }[] = [];
    const teamJob: QTeamJobPort = {
      propose: (_request, asked, options) => {
        calls.push({ goal: asked, proceed: options?.proceed === true });
        return Promise.resolve({ status: "NOT_PLANNED" });
      },
    };
    const { answer } = seam({
      said: "Yes, plan this one anyway.",
      earlier: [
        { role: "USER", content: goal },
        {
          role: "Q",
          content:
            "Something like this is already waiting for you: Send Ledgerfold these 5 questions. Shall I plan this one anyway?",
        },
      ],
      reading: {
        ...reading(null),
        handOver: null,
        teamJob: true,
        // The reader reads "Yes, plan this one anyway." as the reply to Q's question.
        replyTo: { kind: "Q_QUESTION", card: null },
      } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(calls).toEqual([{ goal, proceed: true }]);
  });

  it("a new goal after 'Shall I plan this one anyway?' is planned as itself, without proceed", async () => {
    const calls: { goal: string; proceed: boolean }[] = [];
    const teamJob: QTeamJobPort = {
      propose: (_request, asked, options) => {
        calls.push({ goal: asked, proceed: options?.proceed === true });
        return Promise.resolve({ status: "NOT_PLANNED" });
      },
    };
    const said = "Research Kestrel Heat instead and write me a memo";
    const { answer } = seam({
      said,
      earlier: [
        { role: "USER", content: "Research Ledgerfold and write a memo" },
        {
          role: "Q",
          content:
            "Something like this is already waiting for you: Send Ledgerfold these 5 questions. Shall I plan this one anyway?",
        },
      ],
      reading: {
        ...reading(null),
        handOver: null,
        teamJob: true,
      } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(calls).toEqual([{ goal: said, proceed: false }]);
  });

  it("a team job whose planning failed on Q's side says so, never asks them to reword it (live 2026-10-12)", async () => {
    const teamJob: QTeamJobPort = {
      propose: () => Promise.resolve({ status: "FAILED" }),
    };
    const { answer, delegated, stored } = seam({
      said: "Research Ledgerfold, write a memo and have it critiqued",
      reading: { ...reading(null), teamJob: true } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(delegated()).toBe(0);
    const said = stored.at(-1)?.content ?? "";
    expect(said).toMatch(
      /^I couldn't plan this just now: something failed on my side/u,
    );
    expect(said).not.toMatch(/Tell me who it's about/u);
  });

  it("work handed to the team in words naming no list of tasks is read by the reader and planned (lead review 2026-10-12)", async () => {
    const goals: string[] = [];
    const teamJob: QTeamJobPort = {
      propose: (_request, goal) => {
        goals.push(goal);
        return Promise.resolve({ status: "UNAVAILABLE" });
      },
    };
    const said =
      "Get your team to investigate Ledgerfold and prepare me for a meeting";
    const { answer, delegated, stored } = seam({
      said,
      reading: {
        ...reading("Ledgerfold"),
        handOver: null,
        teamJob: true,
      } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(goals).toEqual([said]);
    expect(delegated()).toBe(0);
    expect(stored.at(-1)?.content).toMatch(
      /^Taking on work like this isn't available on your account here, so nothing has started\./u,
    );
  });

  it("QO-07: 'Write me a 12-month plan' is started as work, and 'yes' to Q's offer carries their earlier words as the goal", async () => {
    const goals: string[] = [];
    const teamJob: QTeamJobPort = {
      propose: (_request, goal) => {
        goals.push(goal);
        return Promise.resolve({
          status: "STARTED",
          plan: {
            summary: "Write your 12-month plan from your pipeline and mandate",
            steps: [],
            needsYou: [],
            cannot: [],
          },
          firstRead: "Your pipeline is the place to start.",
        });
      },
    };
    const direct = seam({
      said: "Write me a 12-month plan",
      reading: {
        ...reading(null),
        handOver: null,
        teamJob: true,
      } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await direct.answer.answer(request());
    expect(goals).toEqual(["Write me a 12-month plan"]);
    expect(direct.delegated()).toBe(0);
    expect(direct.stored.at(-1)?.content).toMatch(
      /^On it\. Starting now: write your 12-month plan/u,
    );

    const yes = seam({
      said: "yes",
      earlier: [
        { role: "USER", content: "Write me a 12-month plan" },
        {
          role: "Q",
          content: "Here is a first view... Want me to put it in a document?",
        },
      ],
      reading: {
        ...reading(null),
        handOver: null,
        teamJob: true,
        workFromEarlier: true,
      } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await yes.answer.answer(request());
    expect(goals.at(-1)).toBe("Write me a 12-month plan\nyes");
    expect(yes.delegated()).toBe(0);
  });

  // Live 2026-10-28 (run 8b649d10): a founder asked for their gaps, Q listed
  // three, and "make that into a plan and execute it" reached the planner
  // without them; Q replied with investor wording.
  const GAPS = [
    "Here are the three gaps investors will see first:",
    "1. No audited financials for 2025",
    "2. No named customer references",
    "3. The cap table is not in your data room",
  ].join("\n");

  it("run 8b649d10: 'make that into a plan and execute it' after Q's gaps carries the three gaps beside the person's words", async () => {
    const calls: {
      goal: string;
      prior: TeamJobPriorAnswer | undefined;
    }[] = [];
    const teamJob: QTeamJobPort = {
      propose: (_request, goal, options) => {
        calls.push({ goal, prior: options?.priorAnswer });
        return Promise.resolve({
          status: "NOT_PLANNED",
          choices: options?.priorAnswer?.items ?? [],
        });
      },
    };
    const said =
      "Can you make that into a plan and then go ahead and execute it";
    const turn = seam({
      said,
      earlier: [
        { role: "USER", content: "What are my gaps?" },
        { role: "Q", content: GAPS },
      ],
      reading: {
        ...reading(null),
        handOver: null,
        teamJob: true,
        workFromEarlier: true,
      } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await turn.answer.answer(request());
    expect(calls).toHaveLength(1);
    // The goal is the person's own words; Q's answer travels beside it.
    expect(calls[0]?.goal).toBe(`What are my gaps?\n${said}`);
    expect(calls[0]?.prior?.items).toEqual([
      "No audited financials for 2025",
      "No named customer references",
      "The cap table is not in your data room",
    ]);
    const line = turn.stored.at(-1)?.content ?? "";
    expect(line).toMatch(
      /^Tell me which of these you want done first: 1\) No audited financials for 2025; 2\) No named customer references; 3\) The cap table is not in your data room\./u,
    );
    expect(teamJobOutcomeOf(line)).toBe("NOT_PLANNED");
  });

  it("run 8b649d10: a turn the reading does not tie to Q's answer carries no earlier answer", async () => {
    const priors: (TeamJobPriorAnswer | undefined)[] = [];
    const teamJob: QTeamJobPort = {
      propose: (_request, _goal, options) => {
        priors.push(options?.priorAnswer);
        return Promise.resolve({ status: "NOT_PLANNED" });
      },
    };
    const turn = seam({
      said: "Research the Kenyan water market and write me a growth plan",
      earlier: [
        { role: "USER", content: "What are my gaps?" },
        { role: "Q", content: GAPS },
      ],
      reading: {
        ...reading(null),
        handOver: null,
        teamJob: true,
        replyTo: { kind: "NEW", card: null },
      } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await turn.answer.answer(request());
    expect(priors).toEqual([undefined]);
    // A founder (no investor mandate in the run) hears a founder's options.
    const line = turn.stored.at(-1)?.content ?? "";
    expect(line).toMatch(/a one-pager for investors/u);
    expect(line).not.toMatch(/questions for the founder/u);
  });

  it("the not-planned line is the person's side of the table: founder and investor wording", () => {
    const founder = teamJobLine({ status: "NOT_PLANNED" }, "FOUNDER");
    const investor = teamJobLine({ status: "NOT_PLANNED" }, "INVESTOR");
    expect(founder).not.toMatch(/questions for the founder|who it's about/u);
    expect(founder).toMatch(/updated pitch deck, a one-pager for investors/u);
    expect(investor).toMatch(/questions for the founder/u);
    for (const line of [founder, investor]) {
      expect(teamJobOutcomeOf(line)).toBe("NOT_PLANNED");
    }
  });

  it("the same words without the reading's teamJob are answered as before (no magic word)", async () => {
    let proposed = 0;
    const teamJob: QTeamJobPort = {
      propose: () => {
        proposed += 1;
        return Promise.resolve({ status: "FAILED" });
      },
    };
    const { answer, delegated } = seam({
      said: "Get your team to investigate Ledgerfold and prepare me for a meeting",
      reading: { ...reading(null), handOver: null } as TurnReaderResult,
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(proposed).toBe(0);
    expect(delegated()).toBe(1);
  });

  it("a question with two kinds of work is not a team job", async () => {
    let proposed = 0;
    const teamJob: QTeamJobPort = {
      propose: () => {
        proposed += 1;
        return Promise.resolve({ status: "FAILED" });
      },
    };
    const { answer, delegated } = seam({
      said: "What are the main risks? Give me a brief assessment.",
      reading: reading(null),
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(proposed).toBe(0);
    expect(delegated()).toBe(1);
  });

  it("names the work kinds: two or more is a work request, a hand-over names none", () => {
    expect(asksForWorkProducts("handle Kestrel for me")).toBe(false);
    expect(asksForWorkProducts("get me a meeting with Priya")).toBe(false);
    expect(
      asksForWorkProducts("research them and write me a memo on the risks"),
    ).toBe(true);
  });

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
    asInvestor = false,
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
    const base = request();
    const ORG = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
    await answer.answer(
      asInvestor
        ? {
            ...base,
            plan: PermittedContextPlanSchema.parse({
              ...base.plan,
              scopes: [
                {
                  kind: "INVESTOR_MANDATE",
                  subject: {
                    kind: "INVESTOR_ORGANISATION",
                    investorOrganisationId: ORG,
                  },
                  contextLabel: "investor_private",
                  sensitivity: "CONFIDENTIAL",
                  layer: "STRUCTURED_STATE",
                  factCategories: ["INVESTOR_THESIS"],
                  projection: "FULL",
                  rights: {
                    canUseForReasoning: true,
                    canDiscloseExistence: true,
                    canQuote: true,
                    canProvideLink: false,
                  },
                  filter: { tenantId: TENANT, investorOrganisationId: ORG },
                  isEvidence: true,
                },
              ],
            }),
          }
        : base,
    );
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

  // F-92 (QA 2026-10-24): "Schedule a call with Mizan's founders" was
  // answered "Who should I set this up with: Harbourline, Brightkloof…?",
  // a list that left out the one they named.
  it("a name that is none of them: said so plainly, never a list that leaves it out", async () => {
    const { line, errands } = await run("set it up with Zorblax", "Zorblax");
    expect(errands).toEqual([]);
    expect(line).toBe(
      "None of your relationships is Zorblax, so there's no call with them to book yet: calls open once you're connected.",
    );
    expect(line).not.toMatch(/Who should I|Nixo|Kazikit/u);
  });

  it("an investor naming a company they are not connected with: the honest reply, and Express Interest with a note offered", async () => {
    const { line, errands } = await run(
      "Schedule a call with Mizan's founders next week",
      "Mizan",
      undefined,
      undefined,
      true,
    );
    expect(errands).toEqual([]);
    expect(line).toBe(
      "None of your relationships is Mizan, so there's no call with them to book yet: calls open once they accept your interest. Want me to prepare Express Interest in Mizan with a note asking for a call, for your approval?",
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
    expect(run.stored.at(-1)?.content).toMatch("Opening Discover…");
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
    expect(run.stored[0]?.content).toMatch("Opening Passed…");
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

  it("a reply read as 'do it again' still continues the waiting action with the zone, never repeats it without (live 2026-10-16: 'Lagos. Set both reminders.')", async () => {
    const asked =
      "Which city are you in, so Friday at 10:00 is right? Then I'll set the reminder.";
    const first = {
      title: "Review the cash forecast",
      when: { day: "friday", time: "10:00" },
    };
    const reading = (kind: string, appAction: unknown, retryLast: boolean) =>
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
        reference: {
          open: null,
          name: null,
          shown: null,
          retryLast,
          sameFor: null,
        },
      }) as unknown as TurnReaderResult;
    let turn = 0;
    const ran: TurnAppAction[] = [];
    const run = seam({
      said: "Set a reminder for Friday at 10am to review the cash forecast.",
      reading: () =>
        turn === 0
          ? reading(
              "TOOL_REQUEST",
              { tool: "propose_reminder", arguments: first },
              false,
            )
          : reading("ANSWER", null, true),
      outcomes: [],
      appActions: {
        tools: new Set(["propose_reminder"]),
        run: (_request, action) => {
          ran.push(action);
          return Promise.resolve(
            ran.length === 1
              ? { asks: asked, needs: "TIME_ZONE" }
              : { prepared: "Reminder: Review the cash forecast" },
          );
        },
      },
      appActionArguments: () => Promise.resolve({}),
    });
    await run.answer.answer(request());
    turn = 1;
    (run.message as { content: string }).content = "Lagos. Set both reminders.";
    await run.answer.answer(request());
    expect(ran).toEqual([
      { tool: "propose_reminder", arguments: first },
      {
        tool: "propose_reminder",
        arguments: { ...first, timeZone: "Africa/Lagos" },
      },
    ]);
  });

  it("a city given to Q's own city question continues the reminder it was asked for (live 2026-10-16)", async () => {
    const reading = (kind: string) =>
      ({
        kind,
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        tool: null,
        handOver: null,
        appAction: null,
        askedAction: null,
      }) as unknown as TurnReaderResult;
    const ran: TurnAppAction[] = [];
    const read: { tool: string; utterance: string }[] = [];
    const run = seam({
      said: "Lagos.",
      earlier: [
        {
          role: "USER",
          content:
            "Set me a reminder for Friday at 10am to review the cash forecast.",
        },
        {
          role: "Q",
          content:
            "Which city or time zone should I use for Friday at 10:00? I can also save it to your profile.",
        },
      ],
      reading: () => reading("ANSWER"),
      outcomes: [],
      appActions: {
        tools: new Set(["propose_reminder"]),
        run: (_request, action) => {
          ran.push(action);
          return Promise.resolve({
            prepared: "Reminder: Review the cash forecast",
          });
        },
      },
      appActionArguments: (_request, input) => {
        read.push(input);
        return Promise.resolve({
          title: "Review the cash forecast",
          when: { day: "friday", time: "10:00" },
        });
      },
    });
    await run.answer.answer(request());
    expect(read).toEqual([
      {
        tool: "propose_reminder",
        utterance:
          "Set me a reminder for Friday at 10am to review the cash forecast.",
      },
    ]);
    expect(ran).toEqual([
      {
        tool: "propose_reminder",
        arguments: {
          title: "Review the cash forecast",
          when: { day: "friday", time: "10:00" },
          timeZone: "Africa/Lagos",
        },
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
    // Guard run (2026-10-25, runs fafa6adf, 3b7da40d): guidance for Q's
    // answer was said as the whole reply. A NOT_THIS_ACTION refusal is never
    // the answer; the turn is answered in full, and its guidance is handed
    // to the answer, not said (guard F-106-reshown-card, 2026-10-26).
    expect(
      await portFor(
        outcomeOf(
          "DENIED",
          "NOT_THIS_ACTION",
          "No open question in their inbox matches it. Prepare their reply now as a message.",
        ),
      ).run(request(), action),
    ).toEqual({
      redirect:
        "No open question in their inbox matches it. Prepare their reply now as a message.",
    });
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
/**
 * Guard F-106-reshown-card (2026-10-26, run 8f9221fa): answer_investor_question
 * found no open question and said, for Q, to prepare the reply with
 * propose_chat_message. The guidance was dropped and the answer ran with no
 * action asked; nothing was prepared. The action it names is now the one
 * asked for, offered to the answer, and the guidance is never the reply.
 */
describe("a declared action refused with guidance for the answer", () => {
  const reading = {
    kind: "TOOL_REQUEST",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: true,
    tool: null,
    handOver: null,
    appAction: {
      tool: "answer_investor_question",
      arguments: {
        question: "gross margin per litre",
        answer: "After September.",
      },
    },
  } as unknown as TurnReaderResult;
  const GUIDANCE =
    "No open question in their inbox matches it, so it is not recorded against one. Prepare their reply now as a message to that investor with propose_chat_message.";

  it("runs the declared action the refusal names, by code", async () => {
    const asked: string[] = [];
    const ran: string[] = [];
    const run = seam({
      said: "Savanna Seed asked about our gross margin per litre. Draft a short reply saying we will share it after reconciling September, then send it.",
      reading,
      outcomes: [],
      offeredTools: ["answer_investor_question", "propose_chat_message"],
      appActions: {
        tools: new Set(["answer_investor_question", "propose_chat_message"]),
        run: (_request, action) => {
          ran.push(action.tool);
          return Promise.resolve(
            action.tool === "propose_chat_message"
              ? { prepared: "Message Savanna Seed Partners" }
              : { redirect: GUIDANCE },
          );
        },
      },
      appActionArguments: (_request, input) => {
        asked.push(input.tool);
        return Promise.resolve({
          counterpartName: "Savanna Seed Partners",
          body: "We'll share it once September is reconciled.",
        });
      },
    });
    await run.answer.answer(request());
    expect(ran).toEqual(["answer_investor_question", "propose_chat_message"]);
    expect(asked).toEqual(["propose_chat_message"]);
    // Done by code: the full answer never ran.
    expect(run.askedActions).toEqual([]);
    expect(run.stored.map((m) => m.content).join(" ")).not.toContain(
      "No open question",
    );
  });

  it("asks the answer for it when code cannot read its inputs", async () => {
    const run = seam({
      said: "Savanna Seed asked about our gross margin per litre. Draft a short reply saying we will share it after reconciling September, then send it.",
      reading,
      outcomes: [],
      offeredTools: ["answer_investor_question", "propose_chat_message"],
      appActions: {
        tools: new Set(["answer_investor_question", "propose_chat_message"]),
        run: () => Promise.resolve({ redirect: GUIDANCE }),
      },
      appActionArguments: () => Promise.resolve(null),
    });
    await run.answer.answer(request());
    expect(run.askedActions).toEqual(["propose_chat_message"]);
    expect(JSON.stringify(run.focuses.at(-1))).toContain(
      "propose_chat_message",
    );
    expect(run.stored.map((m) => m.content).join(" ")).not.toContain(
      "No open question",
    );
  });

  it("names nothing this run does not offer", async () => {
    const run = seam({
      said: "Savanna Seed asked about our gross margin per litre. Draft a short reply.",
      reading,
      outcomes: [],
      offeredTools: ["answer_investor_question"],
      appActions: {
        tools: new Set(["answer_investor_question"]),
        run: () => Promise.resolve({ redirect: GUIDANCE }),
      },
    });
    await run.answer.answer(request());
    expect(run.askedActions).not.toContain("propose_chat_message");
  });
});

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
          count: null,
          discover: null,
          subject: null,
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

  it("reads their counterparts beside the reading, once, not after it (latency)", async () => {
    let release: (reading: TurnReaderResult) => void = () => undefined;
    const reading = new Promise<TurnReaderResult>((resolve) => {
      release = resolve;
    });
    const run = seam({
      said: "Ask Ledgerfold for their last 12 months of management accounts.",
      reading: null,
      read: () => reading,
      outcomes: [],
      counterpartNames: ["Ledgerfold"],
    });
    const answering = run.answer.answer(request());
    // The reading has not landed; the counterparts are already being read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const counterpartsBeforeReading = run.counterpartReads();
    release(untold());
    await answering;
    expect(counterpartsBeforeReading).toBe(1);
    // Taken up after the reading, never read a second time.
    expect(run.counterpartReads()).toBe(1);
    expect(run.focuses.at(-1)).toMatchObject({ areas: ["Relationships"] });
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
      offeredTools: [...TOOLS, "propose_email"],
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
    // Guard F-106 (2026-10-25): every action this person may take here is
    // a candidate, by what it does -- the declared app actions among them,
    // and an email, which is not one.
    expect(routedWith.map((r) => r.utterance)).toEqual([said]);
    expect(routedWith[0]?.names).toEqual(expect.arrayContaining(TOOLS));
    expect(routedWith[0]?.names).toContain("propose_email");
    // Only what this run offers (guard F-106-reshown-card, 2026-10-26): an
    // action the registry declares but this run cannot take is never a
    // route.
    expect(
      (routedWith[0]?.names ?? []).filter(
        (name) =>
          ![...TOOLS, "propose_email", "propose_standing_instruction"].includes(
            name,
          ),
      ),
    ).toEqual([]);
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

  // Guard F-106 (production a3f2a0f81, runs 891e2a3d, c6561774): "Draft a
  // short update email to Savanna Seed Partners…" was routed to a chat
  // message. Routed to an action that is not a declared app action, the
  // full answer does it, with that action as the one asked for.
  it("an email routed by meaning goes to the answer as the asked action, never the chat card", async () => {
    const ran: unknown[] = [];
    const run = seam({
      said: "Draft a short update email to Savanna Seed Partners about our latest traction",
      reading: untold(),
      outcomes: [],
      offeredTools: TOOLS,
      appActionRouter: () => Promise.resolve("propose_email"),
      appActionArguments: () => Promise.resolve({}),
      appActions: {
        tools: new Set(TOOLS),
        run: (_request, action) => {
          ran.push(action);
          return Promise.resolve({ prepared: "the card" });
        },
      },
    });
    await run.answer.answer(request());
    expect(ran).toEqual([]);
    expect(run.askedActions).toEqual(["propose_email"]);
  });

  // wf, live 2026-10-16: "We're going into diligence on Harbourline Cargo
  // next week. Get the team ready." recorded the outcome and lost the work.
  it("a decision stated with work attached goes to the team as one plan, never to the outcome card (TURN_READER v51)", async () => {
    let routed = 0;
    const ran: unknown[] = [];
    const goals: string[] = [];
    const said =
      "We're going into diligence on Harbourline Cargo next week. Get the team ready.";
    const run = seam({
      said,
      reading: { ...untold(), teamJob: true } as TurnReaderResult,
      outcomes: [],
      offeredTools: [...TOOLS, "relationship_outcome"],
      appActionRouter: () => {
        routed += 1;
        return Promise.resolve("relationship_outcome");
      },
      appActions: {
        tools: new Set([...TOOLS, "relationship_outcome"]),
        run: (_request, action) => {
          ran.push(action);
          return Promise.resolve({ prepared: "the card" });
        },
      },
      teamJob: {
        propose: (_request, goal) => {
          goals.push(goal);
          return Promise.resolve({ status: "NOT_PLANNED" });
        },
      },
    });
    await run.answer.answer(request());
    // The whole turn, decision included, is the lead's to plan; the
    // decision comes back inside the plan as the person's next action.
    expect(goals).toEqual([said]);
    expect(routed).toBe(0);
    expect(ran).toEqual([]);
  });

  it("a decision stated on its own is the relationship's action, never a team job", async () => {
    let planned = 0;
    const ran: unknown[] = [];
    const run = seam({
      said: "We're going into diligence on Harbourline Cargo.",
      reading: untold(),
      outcomes: [],
      offeredTools: [...TOOLS, "relationship_outcome"],
      appActionRouter: () => Promise.resolve("relationship_outcome"),
      appActionArguments: () =>
        Promise.resolve({
          relationship: "Harbourline Cargo",
          outcome: "DILIGENCE",
        }),
      appActions: {
        tools: new Set([...TOOLS, "relationship_outcome"]),
        run: (_request, action) => {
          ran.push(action);
          return Promise.resolve({ prepared: "the card" });
        },
      },
      teamJob: {
        propose: () => {
          planned += 1;
          return Promise.resolve({ status: "NOT_PLANNED" });
        },
      },
    });
    await run.answer.answer(request());
    expect(planned).toBe(0);
    expect(ran).toEqual([
      {
        tool: "relationship_outcome",
        arguments: { relationship: "Harbourline Cargo", outcome: "DILIGENCE" },
      },
    ]);
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
  const advice = (aboutNamedOther = false, nextSteps = true) =>
    ({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: { kind: "ADVICE", text: "what should I do next" },
      aboutNamedOther,
      nextSteps,
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

  it("live 2026-10-30 (run 2c8fd21b): with code's priorities leading, a forced web search becomes the model's to reach for (OFFERED), decided by the lead, never by words", async () => {
    const run = seam({
      said: "What should I do today?",
      reading: advice(),
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
    });
    await run.answer.answer(request());
    expect(run.leads).toEqual([LEAD]);
    expect(run.directives[0]?.mode).toBe("OFFERED");
    // Without code's lead, the reading's own decision stands.
    const plain = seam({
      said: "What should I do today?",
      reading: advice(),
      outcomes: [],
    });
    await plain.answer.answer(request());
    expect(plain.directives[0]?.mode).toBe("EXPLICIT");
  });

  it("live 2026-10-30 (latency): code's priorities reach the person the moment they are composed, before the answer is asked, as the answer's own message", async () => {
    const deltas: { text: string; holding?: true }[] = [];
    const run = seam({
      said: "What should I do today?",
      reading: advice(),
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
      deltas,
    });
    await run.answer.answer(request());
    const lines = LEAD.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    // Out before the answer (the delegate) was even called.
    expect(run.deltasAtDelegate[0]).toBeGreaterThanOrEqual(lines.length);
    expect(
      deltas.filter((d) => d.holding !== true).map((d) => d.text.trim()),
    ).toEqual(lines);
    // The answer is told they were said, and under which message.
    expect(run.leadsSaid[0]).toMatch(/^[0-9a-f-]{36}$/u);
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
    expect(other.namedOthers).toEqual([true]);
    const ready = seam({
      said: "what should I do next",
      reading: advice(),
      outcomes: [],
      readinessLead: () => Promise.resolve(null),
    });
    await ready.answer.answer(request());
    expect(ready.leads).toEqual([undefined]);
  });
  it("owner 2026-10-30: 'What should I do today?' is answered here, says what Q is doing, and closes by offering -- never starting -- a full plan", async () => {
    const OFFER =
      "If you'd like a full plan for the weeks ahead, say so and I'll build it.";
    const started: unknown[] = [];
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
      said: "What should I do today?",
      // TURN_READER v72/v73: planAsk null, nextSteps true.
      reading: advice(),
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
      planOffer: () => Promise.resolve(OFFER),
      plan: {
        start: (_request, input) => {
          started.push(input);
          return Promise.resolve({ status: "FAILED" as const });
        },
      },
    });
    await run.answer.answer(request());
    expect(started).toEqual([]);
    expect(run.leads).toEqual([LEAD]);
    expect(run.closings).toEqual([OFFER]);
    expect(run.events).toContainEqual({
      type: "q.stage.changed",
      data: { stage: "GATHERING_SITUATION" },
    });
    // Where the time before the answer went, without their words.
    const timing = lines.find(([message]) => message === "q turn timing");
    const fields = (timing?.[1] ?? {}) as Record<string, unknown>;
    expect(fields["lead"]).toBe(true);
    for (const key of ["readMs", "readinessLeadMs", "beforeAnswerMs"]) {
      expect(typeof fields[key]).toBe("number");
    }
    expect(JSON.stringify(timing?.[1])).not.toContain("today");
  });

  it("live 2026-10-30: the priorities and the plan offer follow nextSteps, whichever source class the reader chose", async () => {
    const OFFER = "If you'd like a full plan, say so.";
    const records = {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: { kind: "THEIR_OWN_RECORDS", text: "What should I do today?" },
      aboutNamedOther: false,
      nextSteps: true,
      tool: null,
      handOver: null,
    } as unknown as TurnReaderResult;
    const run = seam({
      said: "What should I do today?",
      reading: records,
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
      planOffer: () => Promise.resolve(OFFER),
      plan: { start: () => Promise.resolve({ status: "FAILED" as const }) },
    });
    await run.answer.answer(request());
    expect(run.leads).toEqual([LEAD]);
    expect(run.closings).toEqual([OFFER]);
    // The same class without nextSteps is a question about their records.
    const plain = seam({
      said: "What's on my company record?",
      reading: { ...records, nextSteps: false } as TurnReaderResult,
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
      planOffer: () => Promise.resolve(OFFER),
      plan: { start: () => Promise.resolve({ status: "FAILED" as const }) },
    });
    await plain.answer.answer(request());
    expect(plain.leads).toEqual([undefined]);
    expect(plain.closings).toEqual([undefined]);
  });

  it("live 2026-10-30: a yes binds to the plan offer recorded with Q's turn, for what they first asked -- never a plan of 'yes'", async () => {
    const OFFER = "If you'd like a full plan, say so.";
    const started: { ask: string; planAsk: unknown }[] = [];
    let turn = 0;
    const run = seam({
      said: "What should I do today?",
      earlier: [{ role: "Q", content: `Here is where things stand. ${OFFER}` }],
      reading: () => {
        turn += 1;
        return turn === 1
          ? advice()
          : ({
              kind: "QUESTION_TO_Q",
              confidence: "HIGH",
              transcript: "CLEAR",
              question: { kind: "ADVICE", text: "yes" },
              aboutNamedOther: false,
              nextSteps: false,
              // The reader may or may not also read it as the plan ask (v73).
              planAsk: null,
              acceptsOffer: true,
              tool: null,
              handOver: null,
            } as unknown as TurnReaderResult);
      },
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
      planOffer: () => Promise.resolve(OFFER),
      plan: {
        start: (_request, input) => {
          started.push(input);
          return Promise.resolve({
            status: "STARTED" as const,
            jobId: randomUUID(),
            title: "Your plan",
            line: "I'm on it.",
          });
        },
      },
    });
    // Turn 1 is the run whose answer the history's Q line is.
    const first = { ...request(), runId: run.message.runId };
    await run.answer.answer(first);
    expect(run.closings).toEqual([OFFER]);
    (run.message as { content: string }).content = "yes";
    await run.answer.answer(request());
    expect(started).toEqual([
      {
        ask: "What should I do today?",
        planAsk: {
          kind: "GOAL",
          research: "NONE",
          side: null,
          subject: "OWN",
          deliverable: "PLAN",
        },
      },
    ]);
  });

  it("live 2026-10-31: a yes read as a plan ask but not as taking up the offer is planned with the offered question first, and the title quotes neither", async () => {
    const OFFER = "If you'd like a full plan, say so.";
    const started: Record<string, unknown>[] = [];
    let turn = 0;
    const run = seam({
      said: "What should I do today?",
      earlier: [{ role: "Q", content: `Here is where things stand. ${OFFER}` }],
      reading: () => {
        turn += 1;
        // Live run fde3dfce: planAsk GOAL (v73) with acceptsOffer false.
        return turn === 1
          ? advice()
          : ({
              kind: "TOOL_REQUEST",
              confidence: "HIGH",
              transcript: "CLEAR",
              question: null,
              aboutNamedOther: false,
              nextSteps: false,
              planAsk: { kind: "GOAL", subject: "OWN", deliverable: "PLAN" },
              acceptsOffer: false,
              teamJob: true,
              tool: null,
              handOver: null,
            } as unknown as TurnReaderResult);
      },
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
      planOffer: () => Promise.resolve(OFFER),
      plan: {
        start: (_request, input) => {
          started.push(input);
          return Promise.resolve({
            status: "STARTED" as const,
            jobId: randomUUID(),
            title: "Your plan",
            line: "I'm on it.",
          });
        },
      },
    });
    await run.answer.answer({ ...request(), runId: run.message.runId });
    (run.message as { content: string }).content = "yes";
    await run.answer.answer(request());
    expect(started).toHaveLength(1);
    expect(started[0]?.["ask"]).toBe("What should I do today?\nyes");
    expect(started[0]?.["quote"]).toBeNull();
  });

  it("live 2026-10-31: after a restart the plan offer is read back from Q's stored answer, and a yes plans the question it answered", async () => {
    const started: Record<string, unknown>[] = [];
    const run = seam({
      said: "yes",
      // One run: their question, then Q's answer closing with code's offer.
      earlier: [
        { role: "USER", content: "What should I do today?" },
        {
          role: "Q",
          content: `Verify your identity first. ${PLAN_OFFER_LINES[0] ?? ""} `,
        },
      ],
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        planAsk: null,
        acceptsOffer: true,
        tool: null,
        handOver: null,
      } as unknown as TurnReaderResult,
      outcomes: [],
      plan: {
        start: (_request, input) => {
          started.push(input);
          return Promise.resolve({
            status: "STARTED" as const,
            jobId: randomUUID(),
            title: "Your plan",
            line: "I'm on it.",
          });
        },
      },
    });
    await run.answer.answer(request());
    expect(started).toHaveLength(1);
    expect(started[0]?.["ask"]).toBe("What should I do today?");
    expect(started[0]?.["quote"]).toBeUndefined();
  });

  it("planStartWords: taken, standing and no offer", () => {
    const offer = { kind: "PLAN" as const, runId: "r1", ask: "What now?" };
    expect(
      planStartWords({ latest: "yes", taken: offer, standing: offer }),
    ).toEqual({ ask: "What now?" });
    expect(
      planStartWords({ latest: "Plan my raise", taken: null, standing: null }),
    ).toEqual({ ask: "Plan my raise" });
    expect(
      planStartWords({ latest: " yes ", taken: null, standing: offer }),
    ).toEqual({ ask: "What now?\nyes", quote: null });
  });

  it("storedPlanOffer reads only code's own offer copy at the end of Q's stored answer", () => {
    const line = (role: "USER" | "Q", runId: string, content: string) => ({
      role,
      runId,
      content,
    });
    const asked = line("USER", "r1", "What should I do today?");
    const offered = line("Q", "r1", `Do this. ${PLAN_OFFER_LINES[1] ?? ""}`);
    expect(storedPlanOffer([asked, offered], offered)).toEqual({
      kind: "PLAN",
      runId: "r1",
      ask: "What should I do today?",
    });
    const plain = line("Q", "r1", "Do this. Want a plan?");
    expect(storedPlanOffer([asked, plain], plain)).toBeNull();
  });

  it("live 2026-10-30: a yes to an offer code did not record moves nothing -- the answer is told so, never a guessed page", async () => {
    const run = seam({
      said: "yes",
      earlier: [
        { role: "Q", content: "Want me to take you to the pending approvals?" },
      ],
      reading: {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "ADVICE", text: "yes" },
        aboutNamedOther: false,
        acceptsOffer: true,
        replyTo: { kind: "Q_QUESTION", card: null },
        tool: null,
        handOver: null,
      } as unknown as TurnReaderResult,
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.delegated()).toBe(1);
    expect(run.unrecordedOffers).toEqual([true]);
  });

  it("offers no plan when the plan job is not composed, nor beside a turn with no lead", async () => {
    const OFFER = "If you'd like a full plan, say so.";
    const noJob = seam({
      said: "What should I do today?",
      reading: advice(),
      outcomes: [],
      readinessLead: () => Promise.resolve(LEAD),
      planOffer: () => Promise.resolve(OFFER),
    });
    await noJob.answer.answer(request());
    expect(noJob.closings).toEqual([undefined]);
    const noLead = seam({
      said: "What should I do today?",
      reading: advice(),
      outcomes: [],
      readinessLead: () => Promise.resolve(null),
      planOffer: () => Promise.resolve(OFFER),
      plan: { start: () => Promise.resolve({ status: "FAILED" as const }) },
    });
    await noLead.answer.answer(request());
    expect(noLead.closings).toEqual([undefined]);
  });

  it("not on advice that does not ask for next steps (live 2026-10-16: explain a SAFE)", async () => {
    let asked = 0;
    const safe = seam({
      said: "اشرح لي باختصار ما هو SAFE",
      reading: advice(false, false),
      outcomes: [],
      readinessLead: () => {
        asked += 1;
        return Promise.resolve(LEAD);
      },
    });
    await safe.answer.answer(request());
    expect(safe.leads).toEqual([undefined]);
    // The readiness record is not even read for such a turn.
    expect(asked).toBe(0);
  });
});

/**
 * RECOVERY-2026-10 (C, live GPT-Live 2026-10-09 14:35-14:47, Zino): the
 * turn reader moved the screen on statements and negations. Its move is
 * followed only when the words ask for that page.
 */
describe("a reader's move the words do not ask for is not made (live 2026-10-09)", () => {
  const moves = (blocks: unknown) =>
    JSON.stringify(blocks ?? []).includes('"kind":"NAVIGATE"');

  it.each([
    [
      "I can't really see anything, so you're not I guess that's fi",
      "DISCOVER",
    ],
    ["So no, no, you're alright. I'm on Tensorgate's page, but I", "DISCOVER"],
    ["Is there a Tensorgate rehearsal here I can open", "RELATIONSHIPS"],
  ] as const)("%s -> no move to %s", async (said, destination) => {
    const run = seam({
      said,
      reading: toolReading({ kind: "NAVIGATE", destination, visibility: null }),
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.stored.some((message) => moves(message.blocks))).toBe(false);
    expect(run.delegated()).toBe(1);
  });

  it("'Okay, let me do a quick rehearsal with these people' still opens Rehearsals", async () => {
    const run = seam({
      said: "Okay, let me do a quick rehearsal with these people",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "REHEARSALS",
        visibility: null,
      }),
      outcomes: [],
    });
    await run.answer.answer(request());
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "REHEARSALS" },
      },
    ]);
  });
});

describe("explicit document revision cannot become opening the document", () => {
  it.each([
    ["Revise the report you just prepared.", true],
    ["Please shorten this deck.", true],
    ["Open the revised report.", false],
    ["Do not revise my report.", false],
    ["Update my company profile.", false],
    ["Revise my report using new market research.", false],
    ["Revise this document and email it to the investor.", false],
    ["Edit my memo and prepare a new pitch deck.", false],
  ])("keeps the full meaning of %s", (text, expected) => {
    expect(asksToReviseDocument(text)).toBe(expected);
  });
  const artifactId = QArtifactIdSchema.parse(randomUUID());
  function revisionTurn(said: string) {
    let opened = 0;
    const reading = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      tool: null,
      aboutNamedOther: false,
      reference: {
        open: "DOCUMENT",
        name: "Test report",
        shown: 1,
        retryLast: false,
        sameFor: null,
      },
    } as TurnReaderResult;
    const run = seam({
      said,
      reading,
      outcomes: [],
      specialistSupports: true,
      offeredTools: ["revise_my_document", "read_my_document", "open_page"],
      earlier: [
        {
          role: "Q",
          content: "Your document is ready.",
          blocks: [
            {
              kind: "ARTIFACT_REFERENCE",
              artifactId,
              type: "Q_REPORT",
              status: "READY",
              title: "Test report",
            },
          ],
        },
      ],
      openRecord: {
        open: () => {
          opened += 1;
          return Promise.resolve({
            kind: "OPEN_RECORD_PAGE",
            page: "DOCUMENT",
            id: artifactId,
          });
        },
      },
    });
    return { run, opened: () => opened };
  }
  it("routes the actual edit request to the existing revision tool when the reader says open", async () => {
    const { run, opened } = revisionTurn(
      "Revise the document you just prepared. Make the opening concise, and add a clearly labeled Evidence gaps section. Keep all existing evidence qualifications and do not invent facts.",
    );
    await run.answer.answer(request());
    expect(opened()).toBe(0);
    expect(run.delegated()).toBe(1);
    expect(run.investigated()).toBe(0);
    const focus = run.focuses[0] as QAnswerRequest["toolFocus"];
    expect(focus?.tools).toContain("revise_my_document");
    expect(run.stored).toEqual([]);
  });
  it("preserves a genuine request to open the document", async () => {
    const { run, opened } = revisionTurn(
      "Open the document you just prepared.",
    );
    await run.answer.answer(request());
    expect(opened()).toBe(1);
    expect(run.delegated()).toBe(0);
  });
});

describe("getting ready for a call is prepared in the answer (owner 2026-10-23, TURN_READER v58)", () => {
  const said = "Help me prepare for a first call with Savanna Seed Partners";
  // The live reading: the old reader said teamJob; v58 says meetingPrep.
  const prepReading = {
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: true,
    tool: null,
    handOver: null,
    teamJob: true,
    meetingPrep: { counterpart: "Savanna Seed Partners" },
  } as unknown as TurnReaderResult;
  const prep = (waiting: readonly string[] = []): CallPrep => ({
    viewerRole: "FOUNDER",
    counterpartName: "Savanna Seed Partners",
    whoTheyAre: "A seed fund based in Nairobi",
    soFar: "This would be the first contact",
    questions: [
      {
        question: "Why now?",
        answer: "Your record shows pilots with 3 co-ops",
      },
      { question: "Who pays?", answer: "The co-ops, per your deck" },
      {
        question: "How big is it?",
        answer: "Your record doesn't size the market yet: have it ready",
      },
    ],
    weakSpots: [
      {
        spot: "No churn figure",
        handle: "Say so and give the pilot retention you have",
      },
    ],
    ask: "Ask for a second meeting with their partner",
    waiting,
  });

  // QA F-98 (live 2026-10-24, founder): "Let us rehearse my call with
  // Savanna Seed Partners" returned the prep brief again. A rehearsal they
  // ask for (TURN_READER v64 reference open REHEARSAL, by meaning) opens the
  // rehearsal with that investor -- even if the reading also says
  // meetingPrep -- and the brief is not prepared again.
  it("a rehearsal they ask for opens the rehearsal room with that investor, not the prep again", async () => {
    const asked: string[] = [];
    const opened: { page: string; name?: string }[] = [];
    const { answer, stored } = seam({
      said: "Let us rehearse my call with Savanna Seed Partners",
      reading: {
        ...prepReading,
        teamJob: false,
        reference: {
          open: "REHEARSAL",
          name: "Savanna Seed Partners",
          shown: null,
          retryLast: false,
          sameFor: null,
        },
      } as unknown as TurnReaderResult,
      outcomes: [],
      callPrep: {
        prepare: (_request, input) => {
          asked.push(input.counterpart);
          return Promise.resolve(prep());
        },
      },
      openRecord: {
        open: (_request, target) => {
          opened.push({
            page: target.page,
            ...(target.name === undefined ? {} : { name: target.name }),
          });
          return Promise.resolve(
            target.page === "INVESTOR_REHEARSAL"
              ? {
                  kind: "OPEN_RECORD_PAGE" as const,
                  page: "INVESTOR_REHEARSAL" as const,
                  id: "5a5a5a5a-0000-4000-8000-000000000001",
                }
              : null,
          );
        },
      },
    });
    await answer.answer(request());
    expect(asked).toEqual([]);
    expect(opened[0]).toEqual({
      page: "INVESTOR_REHEARSAL",
      name: "Savanna Seed Partners",
    });
    const last = stored.at(-1);
    expect(last?.content ?? "").not.toContain("What they'll likely ask");
    expect(JSON.stringify(last?.blocks ?? [])).toContain("INVESTOR_REHEARSAL");
  });

  it("prepares it now, ahead of a team job, and offers the rehearsal", async () => {
    const asked: string[] = [];
    const planned: string[] = [];
    const callPrep: QCallPrepPort = {
      prepare: (_request, input) => {
        asked.push(input.counterpart);
        return Promise.resolve(prep());
      },
    };
    const teamJob: QTeamJobPort = {
      propose: (_request, goal) => {
        planned.push(goal);
        return Promise.resolve({ status: "NOT_PLANNED" });
      },
    };
    const { answer, stored } = seam({
      said,
      reading: prepReading,
      outcomes: [],
      callPrep,
      teamJob,
    });
    await answer.answer(request());
    expect(asked).toEqual(["Savanna Seed Partners"]);
    expect(planned).toEqual([]);
    const text = stored.at(-1)?.content ?? "";
    expect(text).toContain("**What they'll likely ask**\n1. Why now?");
    expect(text).toContain("**Weak spots**");
    expect(text).toContain(
      "**Your ask**\nAsk for a second meeting with their partner.",
    );
    expect(
      text.endsWith("Want to rehearse it? I'll play Savanna Seed Partners."),
    ).toBe(true);
    expect(text).not.toMatch(/Q['’]s team|\.\.|plan this one anyway/u);
  });

  it("live 20:31, the three-turn sequence: after a list of investors, the prep is not answered as a follow-up", async () => {
    const recalled: string[] = [];
    const asked: string[] = [];
    const { answer, stored } = seam({
      said,
      earlier: [
        { role: "USER", content: "Which investors should I talk to first" },
        {
          role: "Q",
          content:
            "Start with Savanna Seed Partners, then Baobab Seed Partners.",
          blocks: [
            {
              kind: "ARTIFACT_REFERENCE",
              artifactId: QArtifactIdSchema.parse(randomUUID()),
              type: "Q_REPORT",
              status: "READY",
              title: "Investors to talk to first",
            },
          ],
        },
        { role: "USER", content: "Why might the top one pass on us?" },
        {
          role: "Q",
          content: "Savanna may hesitate because kiosk economics are unproven.",
        },
      ],
      reading: {
        ...prepReading,
        teamJob: false,
        fromShown: { turn: 2, reshow: false },
      } as unknown as TurnReaderResult,
      outcomes: [],
      conversationRecall: (_request, input) => {
        recalled.push(input.said);
        return Promise.resolve(
          "A generic follow-up. Want me to draft the reply to Amara?",
        );
      },
      callPrep: {
        prepare: (_request, input) => {
          asked.push(input.counterpart);
          return Promise.resolve(prep());
        },
      },
    });
    await answer.answer(request());
    expect(asked).toEqual(["Savanna Seed Partners"]);
    expect(recalled).toEqual([]);
    const text = stored.at(-1)?.content ?? "";
    expect(text).toContain("**What they'll likely ask**");
    expect(
      text.endsWith("Want to rehearse it? I'll play Savanna Seed Partners."),
    ).toBe(true);
  });

  it("work already waiting is one plain line; the prep is given anyway", async () => {
    const callPrep: QCallPrepPort = {
      prepare: () =>
        Promise.resolve(
          prep([
            "Q's team: Prepare for the Savanna Seed Partners call without booking it.",
          ]),
        ),
    };
    const { answer, stored } = seam({
      said,
      reading: prepReading,
      outcomes: [],
      callPrep,
    });
    await answer.answer(request());
    const text = stored.at(-1)?.content ?? "";
    expect(text).toContain(
      "Related work is already waiting for your approval: Prepare for the Savanna Seed Partners call without booking it.",
    );
    expect(text).toContain("**Who they are**");
    expect(text).not.toMatch(/Q['’]s team|\.\.|anyway\?/u);
  });

  it("a counterpart that cannot be prepared goes on as before (the team job here)", async () => {
    const planned: string[] = [];
    const callPrep: QCallPrepPort = { prepare: () => Promise.resolve(null) };
    const teamJob: QTeamJobPort = {
      propose: (_request, goal) => {
        planned.push(goal);
        return Promise.resolve({ status: "NOT_PLANNED" });
      },
    };
    const { answer } = seam({
      said,
      reading: prepReading,
      outcomes: [],
      callPrep,
      teamJob,
    });
    await answer.answer(request());
    expect(planned).toEqual([said]);
  });

  it("a LOW reading is never prepared", async () => {
    const asked: string[] = [];
    const callPrep: QCallPrepPort = {
      prepare: (_request, input) => {
        asked.push(input.counterpart);
        return Promise.resolve(prep());
      },
    };
    const { answer } = seam({
      said,
      reading: { ...prepReading, confidence: "LOW" },
      outcomes: [],
      callPrep,
    });
    await answer.answer(request()).catch(() => undefined);
    expect(asked).toEqual([]);
  });
});

describe("situation-first planning: the reader's planAsk starts the plan job (S5)", () => {
  const reading = (_named: string | null) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool: null,
      handOver: null,
    }) as TurnReaderResult;
  const F03 =
    "Review the pitch deck and financial documents I've uploaded. Extract material company facts, identify contradictions and show me what needs my confirmation before updating the company record.";

  function planPort() {
    const started: { ask: string; deliverable: string }[] = [];
    const directed: string[] = [];
    const plan: import("../src/plan-job-port.js").QPlanJobPort = {
      start: (_request, input) => {
        started.push({
          ask: input.ask,
          deliverable: input.planAsk.deliverable,
        });
        return Promise.resolve({
          status: "STARTED",
          jobId: "70000000-0000-4000-8000-000000000001",
          title: "Your plan",
          line: "I'm on it: gathering where things stand for you now.",
        });
      },
      direct: (_request, text) => {
        directed.push(text);
        return Promise.resolve({ status: "NOTED" });
      },
    };
    return { plan, started, directed };
  }

  // Live 2026-10-29: F03 became a plan whose first step was the review it
  // asked for. A review of their own documents is that work, done by the
  // team job (TURN_READER v71: deliverable ANALYSIS / DOCUMENT_REVIEW).
  it("the F03 ask is the review itself: the team job takes it, never a plan", async () => {
    const { plan, started } = planPort();
    let proposed = 0;
    const { answer, stored } = seam({
      said: F03,
      reading: {
        ...reading(null),
        teamJob: true,
        planAsk: {
          kind: "GOAL",
          research: "NONE",
          side: "FOUNDER",
          subject: "OWN",
          deliverable: "DOCUMENT_REVIEW",
        },
        directsWork: false,
      } as TurnReaderResult,
      outcomes: [],
      plan,
      teamJob: {
        propose: () => {
          proposed += 1;
          return Promise.resolve({ status: "NOT_PLANNED" });
        },
      },
    });
    await answer.answer(request());
    expect(started).toEqual([]);
    expect(proposed).toBe(1);
    expect(stored.length).toBeGreaterThan(0);
  });

  it("an ask about a company they name is not a plan of their own: the team job takes it", async () => {
    const { plan, started } = planPort();
    let proposed = 0;
    const { answer } = seam({
      said: "Make me a diligence plan for Ledgerfold",
      reading: {
        ...reading("Ledgerfold"),
        teamJob: true,
        planAsk: {
          kind: "GOAL",
          research: "NONE",
          side: "INVESTOR",
          subject: "NAMED",
          deliverable: "PLAN",
        },
      } as TurnReaderResult,
      outcomes: [],
      plan,
      teamJob: {
        propose: () => {
          proposed += 1;
          return Promise.resolve({ status: "UNAVAILABLE" });
        },
      },
    });
    await answer.answer(request());
    expect(started).toEqual([]);
    expect(proposed).toBe(1);
  });

  it("words to running work are filed as direction (the reader's directsWork), once", async () => {
    const { plan, directed, started } = planPort();
    const { answer, stored } = seam({
      said: "Focus on the fintech investors first",
      reading: { ...reading(null), directsWork: true } as TurnReaderResult,
      outcomes: [],
      plan,
    });
    await answer.answer(request());
    expect(directed).toEqual(["Focus on the fintech investors first"]);
    expect(started).toEqual([]);
    expect(stored.at(-1)?.content).toMatch(
      /^Noted\. I'll work that in from the next step/u,
    );
  });
});

describe("an investment memo on a company is the researched memo job (owner decision 2026-10-31, TURN_READER v75)", () => {
  // Live 2026-10-31: "Write me an IC memo on Portside" was read as one
  // document (a Q_REPORT, teamJob false) and came back in ~37 s from the
  // profile alone. v75 reads investmentMemo by meaning; code starts the job.
  const documentReading = (
    subjectName: string | null,
    documentType: string,
    extra: Record<string, unknown> = {},
  ) =>
    ({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: subjectName !== null,
      tool: {
        kind: "PREPARE_DOCUMENT",
        destination: null,
        visibility: null,
        documentType,
        subjectName,
      },
      teamJob: false,
      ...extra,
    }) as unknown as TurnReaderResult;
  const recordingTeamJob = () => {
    const goals: string[] = [];
    const teamJob: QTeamJobPort = {
      propose: (_request, goal) => {
        goals.push(goal);
        return Promise.resolve({
          status: "STARTED",
          plan: {
            summary: "Research Portside, then write an investment memo on it.",
            steps: [
              { who: "Research", does: "Reads Portside's public record." },
              { who: "Documents", does: "Writes the investment memo." },
            ],
            needsYou: [],
            cannot: [],
          },
          firstRead: null,
        });
      },
    };
    return { goals, teamJob };
  };

  it("an investor's 'Write me an IC memo on Portside' starts the researched job and says it is researching, and for how long", async () => {
    const { goals, teamJob } = recordingTeamJob();
    const said = "Write me an IC memo on Portside";
    const { answer, delegated, stored } = seam({
      said,
      reading: documentReading("Portside", "Q_REPORT", {
        investmentMemo: true,
      }),
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(goals).toEqual([said]);
    expect(delegated()).toBe(0);
    expect(stored.at(-1)?.content).toMatch(/^On it\. Starting now: /u);
    expect(stored.at(-1)?.content).toContain(RESEARCHED_MEMO_WAIT);
    expect(RESEARCHED_MEMO_WAIT).toMatch(/researching it on the web/u);
    expect(RESEARCHED_MEMO_WAIT).toMatch(/about three minutes/u);
  });

  it("'Give me a quick summary of Portside' stays the quick document: no job", async () => {
    const { goals, teamJob } = recordingTeamJob();
    const { answer, stored } = seam({
      said: "Give me a quick summary of Portside",
      reading: documentReading("Portside", "INVESTMENT_BRIEF"),
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(goals).toEqual([]);
    expect(
      stored.some((message) => message.content.includes(RESEARCHED_MEMO_WAIT)),
    ).toBe(false);
  });

  it("a founder's 'make me a one-pager' stays quick, even if the reader also said investmentMemo", async () => {
    const { goals, teamJob } = recordingTeamJob();
    const { answer } = seam({
      said: "Make me a one-pager",
      // Bound to their own company (no subject named): never the memo job.
      reading: documentReading(null, "INVESTMENT_BRIEF", {
        investmentMemo: true,
      }),
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(goals).toEqual([]);
  });

  it("a LOW reading of a memo is a guess and starts nothing", async () => {
    const { goals, teamJob } = recordingTeamJob();
    const { answer } = seam({
      said: "IC memo Portside?",
      reading: {
        ...documentReading("Portside", "Q_REPORT", { investmentMemo: true }),
        confidence: "LOW",
      },
      outcomes: [],
      teamJob,
    });
    await answer.answer(request());
    expect(goals).toEqual([]);
  });
});
