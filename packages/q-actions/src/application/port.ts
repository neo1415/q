import type { Logger } from "@capital-q/observability";
import type {
  QActionPort,
  QActionPrepareContext,
  QActionPrepareOutcome,
} from "@capital-q/q-runtime";

import {
  QActionNotPermittedError,
  QActionUnavailableError,
  QActionVersionConflictError,
} from "../domain/errors.js";
import { noQActionNarrator, type QActionNarrator } from "./narrator.js";
import type { QActionService } from "./service.js";

/**
 * Where a run's consequential action comes from (CQ-Q-008 §46, §113).
 *
 * The proposer decides WHETHER this run has something consequential to
 * prepare and WHAT it is; the Approval Engine decides whether it may be
 * proposed, persists it exactly, and requests the approval. A future
 * PREPARE_ONLY tool result becomes a proposer; until one exists,
 * production proposes nothing and the test proposer proposes the test
 * action. Whatever a proposer says, an unregistered or prohibited type
 * never becomes a proposal, and a proposer can never approve anything.
 */
export type QActionProposal = {
  readonly actionType: string;
  readonly payload: unknown;
};

/**
 * The person asked for something this run could not turn into a proposal
 * (a value the target refuses, a field it does not have). `refused` is a
 * plain sentence for them, composed by code from the refusal — never a
 * model's words — so "I couldn't prepare that" is as honest as "I've
 * prepared this".
 */
export type QActionRefusal = { readonly refused: string };

export type QActionProposer = {
  readonly propose: (
    context: QActionPrepareContext,
  ) => Promise<QActionProposal | QActionRefusal | null>;
};

export const noQActionProposer: QActionProposer = {
  propose: () => Promise.resolve(null),
};

/** The orchestration seam over the engine. */
/**
 * A reminder the turn deferred about a card still waiting (lead 2026-10-03):
 * said after the engine's step for the same run, unless that step's card
 * was the one or replaced it. Taken once.
 */
export type QWaitingLines = {
  readonly take: (
    runId: string,
  ) => { readonly line: string; readonly actionId: string } | null;
};

/** One line naming the cards still waiting beside a new one. */
export function waitingLine(summaries: readonly string[]): string {
  const names = summaries.map((summary) =>
    summary.trim().replace(/[.\s]+$/u, ""),
  );
  const list =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  return `Still waiting for your approval: ${list}.`;
}

export function createQActionPort(options: {
  readonly service: QActionService;
  readonly proposer?: QActionProposer | undefined;
  /**
   * Says what happened, from the record (CQ-QACT-001). Absent: nothing is
   * said beside the approval control, which is drawn from the proposal.
   */
  readonly narrator?: QActionNarrator | undefined;
  readonly logger?: Logger | undefined;
  /**
   * "Still waiting for your approval: X." lines the turn deferred until the
   * engine's result is known (lead 2026-10-03, runs a05becfe, a5121124):
   * said after this step unless this run's card superseded or was that
   * card. Absent: the turn said them itself.
   */
  readonly waitingLines?: QWaitingLines | undefined;
  /**
   * The cards in the run's conversation, with their current status, for
   * naming one still waiting beside a new card (lead 2026-10-03). Absent:
   * only deferred lines are said.
   */
  readonly pendingInConversation?:
    | ((context: QActionPrepareContext) => Promise<
        readonly {
          readonly proposalId: string;
          readonly summary: string;
          readonly status: string;
        }[]
      >)
    | undefined;
}): QActionPort {
  const proposer = options.proposer ?? noQActionProposer;
  const narrator = options.narrator ?? noQActionNarrator;
  /** The cards the engine's result covered for this run: no reminder. */
  const prepareAndRemind = async (
    context: QActionPrepareContext,
  ): Promise<QActionPrepareOutcome> => {
    const covered = new Set<string>();
    const outcome = await prepare(context, covered);
    const deferred = options.waitingLines?.take(context.runId) ?? null;
    const run = {
      runId: context.runId,
      tenantId: context.actor.tenantId,
      actorUserId: context.actor.userId,
    };
    const say = async (line: string, reason: string) => {
      options.logger?.info(
        { qRunId: context.runId, outcome: "said", reason },
        "q waiting reminder",
      );
      await narrator.note?.(run, line).catch(() => undefined);
    };
    const skip = (reason: string) => {
      options.logger?.info(
        { qRunId: context.runId, outcome: "skipped", reason },
        "q waiting reminder",
      );
    };
    // This turn prepared a new card (lead 2026-10-03, run 0d1ffa3f): any
    // other card of theirs still waiting in this conversation, and not
    // covered by this result, is named once after the new card's line --
    // from the conversation's own cards, never from the decision reader.
    if (outcome.kind === "AWAITING_APPROVAL") {
      const others =
        options.pendingInConversation === undefined
          ? null
          : await options
              .pendingInConversation(context)
              .then((cards) =>
                cards.filter(
                  (card) =>
                    card.status === "PENDING" && !covered.has(card.proposalId),
                ),
              )
              .catch(() => null);
      if (others === null) {
        if (deferred !== null && !covered.has(deferred.actionId)) {
          await say(deferred.line, "deferred line, pending cards unread");
        } else {
          skip("pending cards unread");
        }
      } else if (others.length === 0) {
        skip("no other card waiting");
      } else {
        await say(
          waitingLine(others.map((card) => card.summary)),
          "other card waiting",
        );
      }
      return outcome;
    }
    if (deferred === null) return outcome;
    if (covered.has(deferred.actionId)) {
      skip("covered by this result");
    } else {
      await say(deferred.line, "deferred line");
    }
    return outcome;
  };
  const prepare = async (
    context: QActionPrepareContext,
    covered: Set<string>,
  ): Promise<QActionPrepareOutcome> => {
    {
      const proposal = await proposer.propose(context);
      if (proposal === null) {
        return { kind: "NONE" };
      }
      const run = {
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
      };
      if ("refused" in proposal) {
        await narrator.refused(run, proposal.refused);
        return { kind: "NONE" };
      }
      try {
        const { action, approval, existing, superseded } =
          await options.service.propose({
            actor: context.actor,
            runId: context.runId,
            correlationId: context.correlationId,
            actionType: proposal.actionType,
            payload: proposal.payload,
          });
        // What this result covers: the card it is, and the cards it replaced.
        covered.add(action.id);
        for (const older of superseded ?? []) covered.add(older.id);
        if (existing === true) {
          // The same change already waits for them (lead 2026-10-03): its
          // card is shown here again, in focus, and nothing new is made.
          // This run does not wait on it: the card's own run does.
          await narrator.proposed(
            run,
            action,
            { id: approval.id, expiresAt: approval.expiresAt },
            { alreadyWaiting: true },
          );
          return { kind: "NONE" };
        }
        // Only now, with the proposal and its approval request committed,
        // may Q say it has prepared anything.
        await narrator.proposed(
          run,
          action,
          {
            id: approval.id,
            expiresAt: approval.expiresAt,
          },
          superseded === undefined || superseded.length === 0
            ? undefined
            : { replaces: superseded.map((older) => older.summary) },
        );
        return {
          kind: "AWAITING_APPROVAL",
          actionId: action.id,
          approvalId: approval.id,
        };
      } catch (error: unknown) {
        // A refused proposal is not a run failure: Q simply has nothing it
        // may prepare, and the person receives the analysis alone.
        if (
          error instanceof QActionUnavailableError ||
          error instanceof QActionNotPermittedError ||
          error instanceof QActionVersionConflictError
        ) {
          options.logger?.info(
            {
              qRunId: context.runId,
              actionType: proposal.actionType,
              errorCode: error.errorCode,
            },
            "q action proposal refused",
          );
          await narrator.refused(
            run,
            error instanceof QActionVersionConflictError
              ? "something else changed at the same moment, so ask me again"
              : "that isn't something I can change for you from here",
          );
          return { kind: "NONE" };
        }
        throw error;
      }
    }
  };
  return {
    prepare: prepareAndRemind,
    executeApproved: async (requested) => {
      // The run resumes with the action it first prepared; if the person
      // edited it since, the approval they gave is for the revision, and
      // the gate verifies that revision's own approval and hash.
      const actionId = await options.service.currentRevision(
        requested.tenantId,
        requested.runId,
        requested.actionId,
      );
      const context =
        actionId === requested.actionId
          ? requested
          : {
              ...requested,
              actionId,
            };
      const outcome = await options.service.executeApproved(context);
      // "Done" only after the gate persisted what the executor reported.
      await narrator.settled(context, outcome);
      return outcome;
    },
  };
}
