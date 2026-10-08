import type { QNavigateDestination } from "@capital-q/contracts";
import type {
  CorrelationId,
  ModelToolDefinition,
  ModelToolName,
  PermittedContextPlan,
  QActionProposalId,
  QApprovalId,
  QCapability,
  QContextDenialReason,
  QContextLabel,
  QDeniedScope,
  QFailureDiagnosticCode,
  QRunHandle,
  QRunId,
  QSensitivityClass,
  QScreenContext,
  QSubjectRef,
  QViewingMoment,
  QToolClassification,
  QToolName,
  QVisibleStage,
} from "@capital-q/contracts";
import type { ActorContext, TenantId, UserId } from "@capital-q/security";

/**
 * The Capital Q-owned orchestration port (doc 12 §10.2).
 *
 * Consumers — the Q API today, the worker later — depend on this and on
 * nothing framework-shaped. An adapter (LangGraph in CQ-Q-003) implements
 * it; no type here names a graph, a thread, a checkpoint, a node, a command
 * or an interrupt, and none may be added that does.
 *
 * Every operation carries the server-resolved actor. A run id, and by
 * extension whatever thread or checkpoint identity an adapter derives from
 * it, is a selection, never authority: the adapter must load the run
 * through the runtime's ownership check before it touches any engine
 * state. `cancel` therefore takes the same input as the others rather than
 * a bare id.
 */
export type QOrchestrationInput = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly correlationId: CorrelationId;
  /**
   * Cooperative deadline / cancellation propagation for the engine. The
   * canonical lifecycle stays authoritative: an aborted invocation still
   * ends through the runtime's cancellation or failure path.
   */
  readonly signal?: AbortSignal | undefined;
};

export type QResumeInput = QOrchestrationInput;

export type QCancelInput = Omit<QOrchestrationInput, "signal">;

export type QOrchestrator = {
  /** Picks up a RECEIVED run. Resolves with the run's handle when the engine returns. */
  readonly start: (input: QOrchestrationInput) => Promise<QRunHandle>;
  /** Continues a paused (AWAITING_INPUT) run from its durable checkpoint. */
  readonly resume: (input: QResumeInput) => Promise<QRunHandle>;
  /** Applies the canonical cancellation lifecycle; the engine observes it at its next boundary. */
  readonly cancel: (input: QCancelInput) => Promise<QRunHandle>;
};

/**
 * Bounded references the seams receive. Identifiers and coded values
 * only: no message text, no objective text, no document, no token.
 */
export type QOrchestrationSubjectContext = {
  readonly runId: QRunId;
  readonly tenantId: TenantId;
  readonly actorUserId: UserId;
  readonly capability: QCapability;
  readonly subjects: readonly QSubjectRef[];
};

// ---------------------------------------------------------------------------
// Context Firewall port (doc 12 §15, doc 15 §19). Implemented by
// @capital-q/q-firewall; the orchestrator calls it before any retrieval and
// again before any resumed retrieval. Nothing here is a decision.
// ---------------------------------------------------------------------------

/**
 * What the firewall is asked. Trusted, server-resolved inputs only: the
 * actor comes from the actor-context hook, the subjects are the run's
 * typed references, and the requested labels are what the caller asked Q
 * to consider — a request, never a grant. There is no field for text, a
 * purpose override, a tenant, a role or a permission, so nothing a person
 * writes can reach the policy.
 */
export type ContextFirewallRequest = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly correlationId: CorrelationId;
  readonly capability: QCapability;
  readonly subjects: readonly QSubjectRef[];
  readonly requestedLabels?: readonly QContextLabel[] | undefined;
  /** R18: the run's authorised viewing moment; the plan carries it only if the company is bound. */
  readonly viewing?: QViewingMoment | null | undefined;
  /** R21: the run's screen; the plan keeps the route and only bound entities. */
  readonly screen?: QScreenContext | null | undefined;
};

export type ContextFirewallDecision =
  | {
      readonly outcome: "AUTHORISED";
      readonly plan: PermittedContextPlan;
    }
  | {
      /** No plan exists. The public projection is one code for every reason. */
      readonly outcome: "DENIED";
      readonly reason: QContextDenialReason;
      readonly denied: readonly QDeniedScope[];
    };

export type ContextFirewallPort = {
  readonly plan: (
    request: ContextFirewallRequest,
  ) => Promise<ContextFirewallDecision>;
};

// ---------------------------------------------------------------------------
// Retrieval and answer seams. Both REQUIRE a permitted context plan: there
// is no signature through which retrieval can run without the firewall's
// allowlist, and no second unfiltered path (doc 14 §30).
// ---------------------------------------------------------------------------

/**
 * The retrieval seam (doc 12 §36 order: actor/tenant → Context Firewall →
 * authorised context plan → retrieval → model). CQ-RAG supplies retrieval
 * behind this port; until then the only implementation says so, typed,
 * and retrieves nothing. Whatever implements it must treat `plan` as the
 * mandatory allowlist: the database predicate is built from the plan's
 * scope filters and from nothing else.
 */
export type QRetrievalRequest = QOrchestrationSubjectContext;

export type QRetrievalOutcome =
  | { readonly kind: "NOT_CONFIGURED" }
  | {
      /** Reserved for CQ-RAG: authorised references, never contents. */
      readonly kind: "AUTHORISED_REFERENCES";
      readonly referenceCount: number;
    };

export type QRetrievalPort = {
  readonly retrieve: (
    request: QRetrievalRequest,
    plan: PermittedContextPlan,
  ) => Promise<QRetrievalOutcome>;
};

export function createUnconfiguredQRetrieval(): QRetrievalPort {
  return {
    retrieve: () => Promise.resolve({ kind: "NOT_CONFIGURED" }),
  };
}

/**
 * The answer seam. The graph never chooses a model; CQ-Q-005's Model
 * Gateway implements this port behind its own policy and provider
 * adapters, and it receives the plan so data-use routing can honour
 * `maxSensitivity` (doc 15 §88): private context is never sent to a
 * provider whose data policy is unsuitable. Until then the only
 * implementation reports that no model execution is configured.
 */
/**
 * One step of a requested series of questions (R35). Structurally the
 * conversation core's `QuestionSequenceStep`, restated here so the
 * runtime does not depend on the core.
 */
export type QQuestionSequenceStep =
  | {
      readonly kind: "ASK" | "REASK";
      readonly topic: string;
      readonly number: number;
      readonly total: number;
    }
  | {
      readonly kind: "FINISHED";
      readonly topic: string;
      readonly total: number;
    }
  | { readonly kind: "STOPPED"; readonly topic: string };

export type QAnswerRequest = QOrchestrationSubjectContext & {
  /**
   * The server-resolved actor the run belongs to, re-validated by the
   * engine on every (re)start. Tools authorise against it (CQ-Q-007); it
   * is never derived from a checkpoint alone or from a client field.
   */
  readonly actor: ActorContext;
  readonly correlationId: CorrelationId;
  readonly retrieval: QRetrievalOutcome;
  readonly plan: PermittedContextPlan;
  /** Cooperative cancellation: the engine's signal, propagated to the model call. */
  readonly signal?: AbortSignal | undefined;
  /**
   * Whether this turn may go to the public web (CQ-QX-005), decided from
   * the conversation core's reading of the turn before the answer runs.
   * EXPLICIT: they asked for something real or current. ONLY_IF_EMPTY:
   * about their own records — authorised context first, the web only if
   * that came back empty, announced as a change of source. NEVER: every
   * other turn. A promise, so that reading the turn runs alongside the
   * context the answer assembles anyway; the answer path awaits it only
   * where research is decided. Absent means no reading was made, and the
   * answer path forces no research of its own.
   */
  readonly research?: Promise<QResearchDirective> | undefined;
  /**
   * The turn could not be read, even on a second try (the reader's model
   * was unavailable). No document, screen change or record change can be
   * started on this turn, and the answer must say so plainly rather than
   * answer as if nothing had been asked (B1, 2026-09-25).
   */
  readonly turnUnread?: boolean | undefined;
  /**
   * The person asked for this answer as a document (a Q_REPORT, founder
   * live 2026-09-28 #1): the answer is the document's text, and Capital Q
   * files it with a PDF once it is written. Decided from the turn's
   * reading, never by the answer's model.
   */
  readonly writingDocument?: boolean | undefined;
  /**
   * A series of questions the person asked Q to put to them, and what
   * this turn must do about it (R35): decided by the conversation core
   * from the turn's reading, never by the answer's model. Absent: no
   * series is in hand.
   */
  readonly questionSequence?: QQuestionSequenceStep | undefined;
  /**
   * What this run can do beyond the tools the model is offered, built by
   * code from what is composed (CQ-QX-008): the screens Capital Q opens,
   * the documents it prepares, whether a visibility change can be
   * prepared. The answer tells the model; it never guesses.
   */
  readonly capabilities?: QCapabilityManifest | undefined;
  /**
   * What the conversation core read this turn as (ANSWER, TOOL_REQUEST,
   * ...). Absent when it was not read. A statement about their company is
   * recorded only from a turn that states something (live 2026-10-02:
   * "I'm giving you full permission…" was echoed as a noted statement).
   */
  readonly turnKind?: string | undefined;
  /**
   * What kind of question the reader read it as (ADVICE, THEIR_OWN_RECORDS,
   * ...), when it is one. "What should I do next?" is ADVICE: their own
   * readiness leads that answer (QA 2026-10-03, run 2cba241a).
   */
  readonly questionKind?: string | undefined;
  /**
   * Lines code composed to open this answer (readiness for "what should I
   * do next?"), said before the model's own words. Absent: none.
   */
  readonly leadLines?: string | undefined;
  /**
   * RECOVERY-2026-10 B6: what the turn's words point at ("the second one",
   * "compare those two", "him"), bound by code to records the person
   * already saw (their page, Q's lists, the conversation's focus), as one
   * trusted note with ids. Never the person's words; grants nothing.
   */
  readonly references?: string | undefined;
  /**
   * The declared action the reader read them as asking for, by its name
   * (TURN_READER v30, ADR 0040), offered here or not. Absent: none named.
   */
  readonly askedAction?: string | undefined;
  /** What the turn is about, for the tool offer (QToolFocus). */
  readonly toolFocus?: QToolFocus | undefined;
  /**
   * This answer was started before its turn was read (voice speculation,
   * latency2). Until `decided` settles true nothing it produces may leave
   * the answer: live text is held, nothing is stored, and only READ_ONLY
   * tools run. Settled false, it is dropped unsaid and unstored. Absent:
   * an ordinary answer.
   */
  readonly speculation?: QAnswerSpeculation | undefined;
  /**
   * The turn was spoken and its answer is said aloud (the utterance came
   * from a voice line). The answer is shaped for the ear: short, answer
   * first, lists on screen (natural conversation, 2026-10-07). Absent:
   * a typed turn.
   */
  readonly spoken?: boolean | undefined;
};

export type QAnswerSpeculation = {
  /** True: adopted as the turn's answer. False: cancelled. */
  readonly decided: Promise<boolean>;
};

/** A speculative answer reached a side effect and was then cancelled. */
export class QSpeculationCancelledError extends Error {
  constructor() {
    super("speculative answer cancelled");
    this.name = "QSpeculationCancelledError";
  }
}

export type QCapabilityManifest = {
  readonly navigate: readonly QNavigateDestination[];
  readonly documents: readonly string[];
  readonly visibilityChange: boolean;
  /**
   * R33: what only the person can do, on a screen (an OAuth consent, a
   * password, a file from their device): Q offers the screen by name.
   */
  readonly offers?:
    | readonly {
        readonly does: string;
        readonly destination: QNavigateDestination;
      }[]
    | undefined;
};

export type QResearchDirective = {
  /** OFFERED: the model holds the research tools; nothing is forced. */
  readonly mode: "EXPLICIT" | "ONLY_IF_EMPTY" | "OFFERED" | "NEVER";
  readonly announceSourceChange: boolean;
  /**
   * A question to Q with research up: a platform lookup the world can also
   * answer (prospective investors) that came back empty or thin may fall
   * back to public sources.
   */
  readonly fallback?: boolean | undefined;
};

export type QAnswerOutcome =
  | { readonly kind: "NOT_CONFIGURED" }
  | {
      /** The Q message the gateway produced, and the routing policy it ran under. */
      readonly kind: "ANSWERED";
      /**
       * Null when Q deliberately says nothing: a turn it could not make out,
       * right after it already asked them to say it again. The run still
       * completes; a voice keeps listening.
       */
      readonly messageId: string | null;
      readonly modelPolicyVersion: string;
      /** The prompt bundle that produced the answer (CQ-Q-006). */
      readonly promptBundleVersion: string;
    }
  | {
      /**
       * Model execution ended without an answer: a coded, retryable-or-not
       * failure (timeout, budget, cancellation, no eligible provider). No
       * provider text travels with it.
       */
      readonly kind: "FAILED";
      readonly diagnosticCode: QFailureDiagnosticCode;
    };

export type QAnswerPort = {
  readonly answer: (request: QAnswerRequest) => Promise<QAnswerOutcome>;
  /**
   * Q's own sentence for a run whose answer FAILED, from the conversation
   * core's failure ledger (CQ-QX-005): named by the subsystem that failed,
   * and undefined when the ledger says the person has already been told.
   * A port, not graph state: checkpoints hold coded outcomes, never prose.
   * Read once; the port forgets it.
   */
  readonly failureNotice?: (runId: string) => string | undefined;
  /**
   * Start the turn's read-only preparation (conversation, context, tools,
   * the person's own facts) while the caller is still reading the turn;
   * the answer that follows for the same run takes it up. Optional and
   * best effort: an answer never depends on it having been called.
   */
  readonly warm?: (request: QAnswerRequest) => void;
  /**
   * Start reading the person's latest turn as soon as PREFLIGHT has passed
   * (ADR 0035), beside the Context Firewall. Its input is only their own
   * message and their own recent turns in this run's conversation; it is
   * a reading, never an answer, and nothing is said or done from it until
   * the answer for the same run takes it up. Optional and best effort.
   */
  readonly preread?: (input: QPrereadInput) => void;
  /**
   * The run was refused (or ended) before its answer: an early reading is
   * dropped unused.
   */
  readonly discard?: (runId: string) => void;
};

export type QPrereadInput = {
  readonly runId: QRunId;
  readonly tenantId: TenantId;
  readonly actor: ActorContext;
  readonly correlationId: string;
  readonly signal?: AbortSignal | undefined;
};

export function createUnconfiguredQAnswer(): QAnswerPort {
  return {
    answer: () => Promise.resolve({ kind: "NOT_CONFIGURED" }),
  };
}

// ---------------------------------------------------------------------------
// Tool seam (doc 12 §28-29, §33; doc 15 §49-52; doc 22 §83-87). Implemented
// by @capital-q/q-tools behind the Capital Q-owned Tool Registry. The
// answer seam offers a run only what this port returns for its plan, and
// executes a model's proposal only through this port. Nothing here names
// a table, a query, a provider or a model.
// ---------------------------------------------------------------------------

/** What a tool run receives: the actor, the run, the plan. Never a credential. */
export type QToolExecutionContext = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly correlationId: CorrelationId;
  readonly capability: QCapability;
  readonly plan: PermittedContextPlan;
  readonly signal?: AbortSignal | undefined;
  /**
   * The person's latest message in this run, verbatim (CQ-Q-RESEARCH-001
   * §9). A tool that sends anything outside Capital Q composes its request
   * from these words and from authorised public identity — never from a
   * model's argument as given. Absent when a caller has no conversation.
   */
  readonly conversation?:
    | {
        readonly latestUserText: string;
        /**
         * The person's own earlier messages, most recent last (at most a
         * few): their words too, for a look-up that refers back ("look
         * her up"). Never Q's words.
         */
        readonly earlierUserText?: readonly string[] | undefined;
      }
    | undefined;
  /**
   * What this turn is about, from its reading (lead 2026-10-02): the tool
   * offer narrows to the core, these capability areas and these tools.
   * Absent or empty: the purpose's list, ranked and bounded as before.
   */
  readonly focus?: QToolFocus | undefined;
};

/**
 * The parts of the app a turn is about (capability areas, e.g.
 * "Relationships") and the tools it named (provider names). Decided by
 * code from the turn's reading, never by the answer's model.
 */
export type QToolFocus = {
  readonly areas: readonly string[];
  readonly tools: readonly string[];
  /**
   * A request to act that named no tool (lead 2026-10-03, run d396af2f):
   * the purpose's tools are all kept, and the areas only add the declared
   * app actions in them. Absent: the areas narrow the purpose's tools.
   */
  readonly widen?: boolean | undefined;
};

/**
 * One tool the registry offers for a run: its Capital Q identity and
 * the provider-neutral declaration the model sees. The declaration's
 * name is a projection the registry chose; the model never learns the
 * tool id, version or class.
 */
export type QOfferedTool = {
  readonly toolName: QToolName;
  readonly toolVersion: number;
  readonly classification: QToolClassification;
  readonly definition: ModelToolDefinition;
  /** The approved stage a person may see while this tool runs, if any. */
  readonly visibleStage: QVisibleStage | null;
};

/** A model's proposal, exactly as the gateway normalised it. Untrusted input. */
export type QToolProposal = {
  readonly callId: string;
  readonly name: ModelToolName;
  readonly arguments: unknown;
};

/**
 * The bounded, structured result of a tool call (doc 22 §86): typed data
 * on success, a stable code and a safe sentence otherwise. No stack
 * trace, no raw row, no provider or database message ever travels here.
 */
export type QToolResult =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly safeMessage: string;
      };
    };

export type QToolCallStatusOutcome = "SUCCEEDED" | "DENIED" | "FAILED";

export type QToolCallOutcome = {
  readonly callId: string;
  /** Null when the proposal named nothing the registry offered. */
  readonly toolName: QToolName | null;
  readonly toolVersion: number | null;
  readonly classification: QToolClassification | null;
  readonly status: QToolCallStatusOutcome;
  /** Stable UPPER_SNAKE_CASE code when not SUCCEEDED. */
  readonly failureCode: string | null;
  /** The sensitivity class of the data returned, when SUCCEEDED. */
  readonly sensitivity: QSensitivityClass | null;
  readonly result: QToolResult;
  readonly latencyMs: number;
};

export type QToolPort = {
  /** The minimum tool set for this run's purpose, actor and plan. Deterministic. */
  readonly offer: (
    context: QToolExecutionContext,
  ) => Promise<readonly QOfferedTool[]>;
  /**
   * Everything relevant to this purpose, actor and plan, before a turn's
   * focus narrows it (lead 2026-10-02): what the turn reader is told Capital
   * Q can do, so an action not offered to the answer is still named and
   * reached. Absent: the offer is the list.
   */
  readonly available?:
    | ((context: QToolExecutionContext) => Promise<readonly QOfferedTool[]>)
    | undefined;
  /** Validate → authorise → execute → validate output. Never throws for a bad proposal. */
  readonly execute: (
    proposal: QToolProposal,
    context: QToolExecutionContext,
  ) => Promise<QToolCallOutcome>;
};

// ---------------------------------------------------------------------------
// Action seam (doc 12 §29-§32; doc 15 §50, §53; CQ-Q-008). Implemented by
// @capital-q/q-actions. The graph asks whether this run has a consequential
// action to prepare; if one is proposed the run pauses for a human, and
// after a valid approval the graph asks the same port to execute it. The
// port re-verifies authority, approval, hash and idempotency on its own:
// nothing the graph remembers, and nothing a person clicked, is authority.
// ---------------------------------------------------------------------------

export type QActionPrepareContext = QOrchestrationSubjectContext & {
  readonly actor: ActorContext;
  readonly correlationId: CorrelationId;
  readonly plan: PermittedContextPlan;
};

export type QActionPrepareOutcome =
  /** Nothing consequential to do for this run. */
  | { readonly kind: "NONE" }
  /**
   * An action was proposed and an approval requested atomically; the run
   * is now AWAITING_APPROVAL and the person must decide.
   */
  | {
      readonly kind: "AWAITING_APPROVAL";
      readonly actionId: QActionProposalId;
      readonly approvalId: QApprovalId;
    };

export type QActionExecuteContext = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly tenantId: TenantId;
  readonly correlationId: CorrelationId;
  readonly actionId: QActionProposalId;
  readonly signal?: AbortSignal | undefined;
};

/** The durable execution outcome; success is stated by the record, never by a model. */
export type QActionExecuteOutcome =
  | { readonly kind: "EXECUTED" }
  | { readonly kind: "FAILED"; readonly failureCode: string }
  /** The approval was rejected, expired or revoked: the run ends without a side effect. */
  | { readonly kind: "NOT_APPROVED"; readonly reason: string }
  /** Authority no longer holds at execution time; nothing ran. */
  | { readonly kind: "BLOCKED"; readonly reason: string }
  /** Another worker holds or held the claim; the record's state is the answer. */
  | { readonly kind: "ALREADY_EXECUTED" }
  | { readonly kind: "IN_PROGRESS" }
  | { readonly kind: "RECONCILIATION_REQUIRED"; readonly failureCode: string };

export type QActionPort = {
  readonly prepare: (
    context: QActionPrepareContext,
  ) => Promise<QActionPrepareOutcome>;
  readonly executeApproved: (
    context: QActionExecuteContext,
  ) => Promise<QActionExecuteOutcome>;
};

/** No consequential action can be prepared or executed. Production until real action tools exist. */
export function createUnconfiguredQActions(): QActionPort {
  return {
    prepare: () => Promise.resolve({ kind: "NONE" }),
    executeApproved: () =>
      Promise.resolve({ kind: "BLOCKED", reason: "ACTIONS_NOT_CONFIGURED" }),
  };
}

/** No tools at all: the model is told so and cannot propose any. */
export function createUnconfiguredQTools(): QToolPort {
  return {
    offer: () => Promise.resolve([]),
    execute: (proposal) =>
      Promise.resolve({
        callId: proposal.callId,
        toolName: null,
        toolVersion: null,
        classification: null,
        status: "DENIED",
        failureCode: "TOOL_NOT_AVAILABLE",
        sensitivity: null,
        result: {
          ok: false,
          error: {
            code: "TOOL_NOT_AVAILABLE",
            safeMessage: "No tool is available in this context.",
          },
        },
        latencyMs: 0,
      }),
  };
}

/**
 * Decides whether orchestration should pause for a person after context is
 * resolved. Production never pauses here: clarification and approval
 * (CQ-Q-008) will replace this with their own semantics. The seam exists so
 * durable pause/resume can be proven without inventing either.
 */
export type QPausePolicy = {
  readonly shouldPause: (
    context: QOrchestrationSubjectContext,
  ) => Promise<boolean> | boolean;
};

export const neverPause: QPausePolicy = { shouldPause: () => false };
