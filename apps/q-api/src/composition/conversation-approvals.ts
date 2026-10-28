import {
  CorrelationIdSchema,
  QActionProposalIdSchema,
  QApprovalIdSchema,
  QRunIdSchema,
  type QActionProposal,
  type QApprovalView,
} from "@capital-q/contracts";
import { APP_ACTIONS, PERSON_ACTIONS } from "@capital-q/app-actions";
import type { Logger } from "@capital-q/observability";
import {
  QActionPayloadMismatchError,
  QApprovalAlreadyDecidedError,
  QApprovalExpiredError,
  type QActionService,
} from "@capital-q/q-actions";
import type { QOrchestrator, QRuntimeService } from "@capital-q/q-runtime";
import {
  mayStandAsApproval,
  readApprovalWords,
  type ConversationProposal,
  type PendingProposalContext,
  type PendingProposalPort,
  type ProposalPlainStatus,
} from "@capital-q/q-tools";
import type { QDecisionVia } from "@capital-q/q-actions";
import type { ActorContext } from "@capital-q/security";

import type { PendingDecisionPort } from "@capital-q/q-specialists";

import type { DecisionReader } from "../voice/decision.js";
import type { ApprovedContinuation } from "./approved-continuation.js";

/**
 * Approval by conversation (live test 2026-09-27 #1, #2).
 *
 * The status of a change Q prepared, in the only terms Q may use about it,
 * read from the Approval Engine as the person: pending, saving, saved, not
 * saved, declined or expired. Q said "ready for approval" and "done" about
 * the same change because it had the approval row's status (APPROVED) and
 * not whether the action ran; SAVED here means the action EXECUTED.
 */
export function plainProposalStatus(view: QApprovalView): ProposalPlainStatus {
  switch (view.status) {
    case "PENDING":
      return view.canDecide ? "PENDING" : "EXPIRED";
    case "REJECTED":
      return "DECLINED";
    case "EXPIRED":
    case "REVOKED":
      return "EXPIRED";
    case "APPROVED":
      switch (view.action.actionStatus) {
        case "EXECUTED":
          return "SAVED";
        case "APPROVED":
        case "EXECUTING":
          return "SAVING";
        // Approved, but the change did not (or can no longer) go through.
        case "FAILED":
        case "RECONCILIATION_REQUIRED":
        case "EXPIRED":
        case "WITHDRAWN":
        case "REJECTED":
        case "PROPOSED":
        case "AWAITING_APPROVAL":
          return "NOT_SAVED";
      }
  }
}

/**
 * The kinds that keep their card's own Approve (owner 2026-10-16; the
 * brief's high-risk tier): money movement and terms (ADR 0043's MONEY and
 * TERMS consequences: a raise, a round, a commitment amount, deal terms,
 * sharing the raise), and sharing a private document with someone outside
 * the company (diligence shares). Words never approve these; the card's
 * button does, after its explicit confirmation. Everything else Q
 * prepares (messages, emails, meetings, reminders, profile and record
 * changes, interest, connection requests) is approvable by the person's
 * own typed or spoken words.
 */
const CARD_ONLY_CONSEQUENCES: ReadonlySet<string> = new Set(["MONEY", "TERMS"]);
const CARD_ONLY_APP_ACTIONS: ReadonlySet<string> = new Set([
  "diligence.document.share",
  "diligence.request.fulfil",
  "diligence.request.upload_fulfil",
]);

type DeclaredAction = {
  readonly name: string;
  readonly consequence?: string | undefined;
  readonly viaTool?: string | undefined;
  readonly tool?: { readonly name: string } | undefined;
};

const DECLARED: readonly DeclaredAction[] = [
  ...(APP_ACTIONS as readonly DeclaredAction[]),
  ...(PERSON_ACTIONS as readonly DeclaredAction[]),
];

/**
 * Kinds the other side receives (an interest, an answer, a message, an
 * email, an invite, a request): a card still waiting reads "ready to
 * send". Profile and record edits keep "Not saved yet".
 */
export const OUTWARD_ACTION_TYPES: ReadonlySet<string> = new Set([
  "relationship.interest.express",
  "relationship.interest.respond",
  "relationship.connection_request.send",
  "relationship.connection_request.respond",
  "email.send",
  "email.inbound.reply",
  "review.request",
  "app.chat.message.send",
  "app.diligence.document.request",
  "app.diligence.document.share",
  "app.diligence.questions.send",
  "app.schedule.meeting.book",
  "app.schedule.proposal.accept",
  "chat.message.send",
  "meeting.schedule",
  "meeting.reschedule",
  "meeting.cancel",
]);

function cardOnlyAction(action: DeclaredAction): boolean {
  return (
    (action.consequence !== undefined &&
      CARD_ONLY_CONSEQUENCES.has(action.consequence)) ||
    CARD_ONLY_APP_ACTIONS.has(action.name)
  );
}

/**
 * Whether this prepared action keeps its card's Approve: never approved by
 * words. Anything outside the one approvable class keeps it too.
 */
export function keepsItsCard(input: {
  readonly actionType: string;
  readonly actionClass: string;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
}): boolean {
  if (input.actionClass !== "CONFIRM_REQUIRED") return true;
  if (!input.actionType.startsWith("app.")) return false;
  const name = input.actionType.slice("app.".length);
  const action = DECLARED.find((candidate) => candidate.name === name);
  if (action === undefined) return false;
  if (cardOnlyAction(action)) return true;
  // A family ("diligence.change"): its member is the payload's operation.
  const toolName = action.tool?.name;
  if (toolName === undefined) return false;
  const members = DECLARED.filter((member) => member.viaTool === toolName);
  if (!members.some(cardOnlyAction)) return false;
  const operation = input.payload?.["operation"];
  const member =
    typeof operation === "string"
      ? members.filter((candidate) =>
          candidate.name.endsWith(`.${operation.toLowerCase()}`),
        )
      : [];
  // Not known which member: as the strictest of them.
  return member.length === 1 && member[0] !== undefined
    ? cardOnlyAction(member[0])
    : true;
}

export type ConversationApprovalDependencies = {
  readonly runtime: Pick<QRuntimeService, "getRun" | "getConversation">;
  /**
   * Resolved at call time: the Approval Engine and the orchestrator are
   * composed after the tools that call this port. An absent orchestrator
   * means an approved action waits for a worker, as after the card's
   * Approve.
   */
  readonly late: () => {
    readonly actions: Pick<
      QActionService,
      | "findApprovalForAction"
      | "getApproval"
      | "readProposal"
      | "approve"
      | "reject"
      | "listPendingApprovals"
    >;
    readonly orchestrator: QOrchestrator | undefined;
    /**
     * Resume, or execute through the gate when the run cannot resume
     * (approved-continuation.ts). Absent: resume only.
     */
    readonly continueApproved?: ApprovedContinuation | undefined;
  };
  /** How long an approval waits for the change to be applied before answering "saving". */
  readonly applyWithinMs?: number | undefined;
  readonly logger?: Logger | undefined;
  /**
   * Where the action's outcome line is handed while this approval waits
   * for it, so the turn that decided it says it once. Absent: the paused
   * run says it, and this answer says the engine's status.
   */
  readonly relay?: DecisionRelay | undefined;
};

/**
 * One outcome line per action decided in words (owner 2026-10-16: "Done.
 * I'll remind you: X." and "Done: Reminder: X." for one approval). The
 * turn that approved claims the action while it waits on the execution;
 * the narrator, finding it claimed, hands its line over instead of writing
 * it on the paused run. Released when the wait ends, whatever happened: an
 * execution that settles later is narrated on its run as before.
 */
export type DecisionRelay = {
  readonly claim: (actionId: string) => void;
  readonly heldFor: (actionId: string) => boolean;
  readonly hold: (actionId: string, line: string) => void;
  /** The line handed over, if any; the claim ends. */
  readonly release: (actionId: string) => string | null;
};

export function createDecisionRelay(): DecisionRelay {
  const claimed = new Map<string, string | null>();
  return {
    claim: (actionId) => {
      claimed.set(actionId, null);
    },
    heldFor: (actionId) => claimed.has(actionId),
    hold: (actionId, line) => {
      if (claimed.has(actionId)) claimed.set(actionId, line);
    },
    release: (actionId) => {
      const line = claimed.get(actionId) ?? null;
      claimed.delete(actionId);
      return line;
    },
  };
}

const APPLY_WITHIN_MS = 12_000;
const PROPOSALS_MAX = 12;

/**
 * The port behind `approve_pending_proposal`. Everything is read as the
 * actor: the run and conversation through their owner checks, each
 * proposal through `getApproval`, which refuses anyone the approval was
 * not requested from. Approving is the Approval Engine's own `approve`,
 * the call the card's Approve button makes, then the paused run's
 * resumption, which executes through the execution gate.
 */
export function createConversationApprovalPort(
  dependencies: ConversationApprovalDependencies,
): PendingProposalPort {
  const { runtime, late, logger } = dependencies;
  const applyWithinMs = dependencies.applyWithinMs ?? APPLY_WITHIN_MS;

  const viewOf = async (
    actor: ActorContext,
    proposalId: string,
    correlationId: string,
  ): Promise<QApprovalView | null> => {
    const id = QActionProposalIdSchema.safeParse(proposalId);
    if (!id.success) return null;
    const { actions } = late();
    const approval = await actions.findApprovalForAction(
      actor.tenantId,
      id.data,
    );
    if (approval === null) return null;
    // findApprovalForAction is tenant-scoped only; getApproval is the
    // read as this person, and refuses anyone else.
    return actions
      .getApproval({
        actor,
        approvalId: QApprovalIdSchema.parse(approval.id),
        correlationId: CorrelationIdSchema.parse(correlationId),
      })
      .catch(() => null);
  };

  /** This run's conversation, read as the person; empty without one. */
  const messagesOf = async (context: PendingProposalContext) => {
    const { actor } = context;
    const correlationId = CorrelationIdSchema.parse(context.correlationId);
    const { run } = await runtime.getRun({
      actor,
      runId: QRunIdSchema.parse(context.runId),
      correlationId,
    });
    if (run.conversationId === null) return [];
    const { messages } = await runtime.getConversation({
      actor,
      conversationId: run.conversationId,
      correlationId,
    });
    return messages;
  };

  /**
   * The person's own words that stand as their decision on this card, by
   * code (owner 2026-10-16): their latest message in this conversation,
   * sent in this run, after the card was shown (its message here, or its
   * request time for a card from elsewhere), and neither a refusal nor a
   * change asked for. Null: nothing they said approves it, whoever asks
   * -- the decision reading or the model's tool -- so nothing is approved.
   * Never auto-approval: no utterance, no approval.
   */
  const theirWords = async (
    context: PendingProposalContext,
    view: QApprovalView,
    decision: "APPROVE" | "DECLINE",
  ): Promise<QDecisionVia | null> => {
    const messages = await messagesOf(context);
    const shownIn = messages.find((message) =>
      (message.blocks ?? []).some(
        (block) =>
          block.kind === "ACTION_PROPOSAL" &&
          block.proposal.proposalId === view.action.actionId,
      ),
    );
    // The card stands from the moment its approval was requested, or its
    // message was stored, whichever came first (live 2026-10-28: a yes
    // typed as the card lands may be stored before the card's own message
    // is; the approval was requested before either, so the yes is after).
    const shownAt = Math.min(
      Date.parse(view.requestedAt),
      shownIn === undefined ? Infinity : Date.parse(shownIn.createdAt),
    );
    const latest = messages.findLast((message) => message.role === "USER");
    if (
      latest === undefined ||
      latest.runId !== context.runId ||
      !(Date.parse(latest.createdAt) > shownAt)
    ) {
      return null;
    }
    if (
      decision === "APPROVE" &&
      !mayStandAsApproval(latest.content, [view.action.summary])
    ) {
      return null;
    }
    // Nor is a yes ever turned into a no.
    if (
      decision === "DECLINE" &&
      readApprovalWords(latest.content, { summaries: [view.action.summary] })
        .kind === "APPROVE"
    ) {
      return null;
    }
    return {
      channel: latest.utteranceRef === undefined ? "TEXT" : "VOICE",
      evidenceRef: latest.id,
    };
  };

  const inConversation = async (
    context: PendingProposalContext,
  ): Promise<readonly ConversationProposal[]> => {
    const { actor } = context;
    const messages = await messagesOf(context);
    const seen = new Map<string, QActionProposal>();
    for (const message of messages) {
      for (const block of message.blocks ?? []) {
        if (block.kind === "ACTION_PROPOSAL") {
          seen.set(block.proposal.proposalId, block.proposal);
        }
      }
    }
    const proposals: ConversationProposal[] = [];
    for (const [proposalId, proposal] of [...seen].slice(-PROPOSALS_MAX)) {
      const view = await viewOf(actor, proposalId, context.correlationId);
      if (view === null) continue;
      proposals.push({
        proposalId,
        summary: proposal.summary,
        status: plainProposalStatus(view),
        ...(OUTWARD_ACTION_TYPES.has(proposal.actionType)
          ? { outward: true }
          : {}),
        proposal,
      });
    }
    return proposals;
  };

  const approve = async (
    context: PendingProposalContext,
    proposalId: string,
  ): Promise<{
    readonly status: ProposalPlainStatus | "CHANGED" | "CARD_ONLY";
    readonly line?: string | undefined;
  }> => {
    const { actor } = context;
    const correlationId = CorrelationIdSchema.parse(context.correlationId);
    const before = await viewOf(actor, proposalId, context.correlationId);
    if (before === null) {
      throw new Error("the proposal is not readable as this person");
    }
    const { actions, orchestrator, continueApproved } = late();
    // Only a decision still open is made here by words; a repeat of one
    // already made goes to the engine as before (its retry is idempotent,
    // and continues an approved action whose continuation was lost).
    let via: QDecisionVia | undefined;
    if (before.status === "PENDING") {
      const proposal = await actions
        .readProposal({ actor, approvalId: before.approvalId, correlationId })
        .catch(() => null);
      if (
        proposal === null ||
        keepsItsCard({
          actionType: proposal.actionType,
          actionClass: before.action.actionClass,
          payload: proposal.payload,
        })
      ) {
        return { status: "CARD_ONLY" };
      }
      const words = await theirWords(context, before, "APPROVE");
      if (words === null) {
        logger?.info(
          { qRunId: context.runId, actionId: proposalId, correlationId },
          "no words of theirs since the card was shown approve it; nothing approved",
        );
        return { status: "PENDING" };
      }
      via = words;
    }
    // Whether the continuation finished within the wait: "applying" is
    // said only while it may still be running (live 2026-10-01: Q said
    // "It's being applied now" about an action whose continuation had
    // already failed, and it stayed APPROVED).
    let continued: "WAITING" | "DONE" | "FAILED" = "WAITING";
    let said: string | null = null;
    try {
      const result = await actions.approve({
        actor,
        approvalId: before.approvalId,
        correlationId,
        ...(via === undefined ? {} : { via }),
      });
      // A repeated approve of an action still waiting to run (its first
      // continuation was lost) continues it again; the gate's claim makes
      // that safe.
      const waiting =
        result.decided ||
        (continueApproved !== undefined && result.action.status === "APPROVED");
      const continuation =
        continueApproved !== undefined
          ? () =>
              continueApproved({
                actor,
                runId: result.action.runId,
                actionId: result.action.id,
                correlationId,
              })
          : orchestrator !== undefined
            ? () =>
                orchestrator
                  .resume({ actor, runId: result.action.runId, correlationId })
                  .then(() => undefined)
            : undefined;
      if (waiting && continuation !== undefined) {
        // Only a decision in words is answered here; a repeat of one
        // already decided is reported as it stands.
        const relay = via === undefined ? undefined : dependencies.relay;
        relay?.claim(result.action.id);
        // The same continuation the card's Approve starts. It runs on its
        // own; this answer waits a bounded time to report what happened.
        const resumed = continuation()
          .then(() => {
            continued = "DONE";
            return true;
          })
          .catch((error: unknown) => {
            logger?.error(
              { err: error, qRunId: result.action.runId, correlationId },
              "q run did not resume after an approval by conversation",
            );
            continued = "FAILED";
            return true;
          });
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          resumed,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => {
              resolve(false);
            }, applyWithinMs);
            timer.unref();
          }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
        said = relay?.release(result.action.id) ?? null;
      }
    } catch (error: unknown) {
      if (error instanceof QActionPayloadMismatchError) {
        return { status: "CHANGED" };
      }
      if (error instanceof QApprovalExpiredError) {
        return { status: "EXPIRED" };
      }
      if (!(error instanceof QApprovalAlreadyDecidedError)) throw error;
      // Decided meanwhile (on the card, or by a retried call): reported
      // as it now stands, below.
    }
    const after = await viewOf(actor, proposalId, context.correlationId);
    if (after === null) return { status: "NOT_SAVED" };
    const status = plainProposalStatus(after);
    // Approved and nothing left running it: not "being applied".
    if (
      status === "SAVING" &&
      continued !== "WAITING" &&
      after.action.actionStatus === "APPROVED"
    ) {
      return said === null ? { status: "NOT_SAVED" } : { status, line: said };
    }
    return said === null ? { status } : { status, line: said };
  };

  /**
   * R33: "no, don't". The Approval Engine's own reject, the call the
   * card's Decline makes, as this person; nothing executes.
   */
  const decline = async (
    context: PendingProposalContext,
    proposalId: string,
  ): Promise<{ readonly status: ProposalPlainStatus }> => {
    const { actor } = context;
    const before = await viewOf(actor, proposalId, context.correlationId);
    if (before === null) {
      throw new Error("the proposal is not readable as this person");
    }
    const via =
      before.status === "PENDING"
        ? await theirWords(context, before, "DECLINE")
        : undefined;
    if (via === null) {
      return { status: plainProposalStatus(before) };
    }
    try {
      await late().actions.reject({
        actor,
        approvalId: before.approvalId,
        correlationId: CorrelationIdSchema.parse(context.correlationId),
        ...(via === undefined ? {} : { via }),
      });
    } catch (error: unknown) {
      if (
        !(error instanceof QApprovalAlreadyDecidedError) &&
        !(error instanceof QApprovalExpiredError)
      ) {
        throw error;
      }
    }
    const after = await viewOf(actor, proposalId, context.correlationId);
    return { status: after === null ? "EXPIRED" : plainProposalStatus(after) };
  };

  /**
   * An approval from the person's inbox (another conversation), by id,
   * read as them: getApproval refuses anyone it was not requested from.
   */
  const inboxItem = async (
    context: PendingProposalContext,
    approvalId: string,
  ): Promise<ConversationProposal | null> => {
    const id = QApprovalIdSchema.safeParse(approvalId);
    if (!id.success) return null;
    const view = await late()
      .actions.getApproval({
        actor: context.actor,
        approvalId: id.data,
        correlationId: CorrelationIdSchema.parse(context.correlationId),
      })
      .catch(() => null);
    if (view === null) return null;
    return {
      proposalId: view.action.actionId,
      summary: view.action.summary,
      status: plainProposalStatus(view),
    };
  };

  return { inConversation, approve, decline, inboxItem };
}

/** How recently a change in another conversation was asked for to count. */
export const RECENT_ELSEWHERE_MS = 30 * 60_000;

/**
 * Changes still waiting for this person's approval, asked for in the last
 * half hour in a conversation other than this run's (live 2026-10-01). The
 * person's own pending list, each read back as them through getApproval.
 */
export function createRecentPendingElsewhere(
  dependencies: Pick<ConversationApprovalDependencies, "runtime" | "late"> & {
    readonly withinMs?: number | undefined;
    readonly now?: (() => number) | undefined;
  },
): (
  context: PendingProposalContext,
) => Promise<readonly ConversationProposal[]> {
  const { runtime, late } = dependencies;
  const withinMs = dependencies.withinMs ?? RECENT_ELSEWHERE_MS;
  const now = dependencies.now ?? Date.now;
  return async (context) => {
    const { actor } = context;
    const correlationId = CorrelationIdSchema.parse(context.correlationId);
    const { run } = await runtime.getRun({
      actor,
      runId: QRunIdSchema.parse(context.runId),
      correlationId,
    });
    const { actions } = late();
    const rows = await actions.listPendingApprovals({ actor });
    const found: ConversationProposal[] = [];
    for (const row of rows) {
      if (
        row.conversationId !== null &&
        row.conversationId === run.conversationId
      ) {
        continue;
      }
      if (now() - Date.parse(row.requestedAt) > withinMs) continue;
      const view = await actions
        .getApproval({ actor, approvalId: row.approvalId, correlationId })
        .catch(() => null);
      if (view === null) continue;
      found.push({
        proposalId: view.action.actionId,
        summary: view.action.summary,
        status: plainProposalStatus(view),
      });
    }
    return found;
  };
}

/**
 * The typed-turn decision port (founder fixture #1): the conversation's
 * proposals and their engine status, the person's words read by
 * DECISION_READER, and the engine's own approve and reject.
 */
export function createPendingDecisionPort(dependencies: {
  readonly proposals: PendingProposalPort;
  readonly decisions: DecisionReader;
  /** Changes waiting in their other conversations, asked for recently. */
  readonly recentElsewhere?:
    | ((
        context: PendingProposalContext,
      ) => Promise<readonly ConversationProposal[]>)
    | undefined;
  /** Where an approved change's work stands now (the receipts port). */
  readonly progress?: PendingDecisionPort["progress"];
}): PendingDecisionPort {
  const { proposals, decisions, recentElsewhere, progress } = dependencies;
  return {
    ...(recentElsewhere === undefined ? {} : { recentElsewhere }),
    ...(progress === undefined ? {} : { progress }),
    proposals: (context) => proposals.inConversation(context),
    read: (input) =>
      decisions.read({
        question: input.question,
        utterance: input.utterance,
        recentTurns: input.recentTurns,
        attribution: {
          tenantId: input.context.tenantId,
          userId: input.context.userId,
          correlationId: input.context.correlationId,
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
    approve: (context, proposalId) => proposals.approve(context, proposalId),
    decline: async (context, proposalId) => {
      if (proposals.decline === undefined) {
        return { status: "PENDING" as const };
      }
      return proposals.decline(context, proposalId);
    },
  };
}
