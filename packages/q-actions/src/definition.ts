import type { z } from "zod";

import type {
  CorrelationId,
  QActionClass,
  QActionPayloadHash,
  QActionProposalId,
  QActionType,
  QApprovalId,
  QRunId,
  QSubjectRef,
} from "@capital-q/contracts";
import type {
  ActorContext,
  OrganisationId,
  TenantId,
  UserId,
} from "@capital-q/security";

/**
 * A registered consequential action (doc 12 §28.2, §33; doc 22 §84;
 * CQ-Q-008 §52-§56). What a definition declares is the whole of what the
 * Approval Engine will ever execute for its type:
 *
 *   - a versioned identity that participates in the approval binding, so a
 *     definition whose semantics change is a new version and an approval
 *     for the old one does not authorise it;
 *   - a strict payload schema and a strict result schema (Zod in, Zod out);
 *   - the targets a payload names, which are part of the binding: another
 *     recipient, document or company is another action;
 *   - plain language for the approver (never the binding);
 *   - `authorize`: the capability and resource authority the acting person
 *     must hold for THIS payload — evaluated at proposal, at decision and
 *     again immediately before execution, so an approval never creates a
 *     permission and revoked authority blocks a later execution;
 *   - `executor`: the deterministic, provider-neutral implementation, which
 *     the gate calls exactly once per claimed attempt and never directly.
 *
 * There is no `execute(actionType: string, payload: any)` anywhere: an
 * unregistered type has no executor and no way to acquire one.
 */

export type QActionDescription = {
  readonly summary: string;
  readonly preview?: string | undefined;
};

export type QActionAuthorization =
  | { readonly outcome: "ALLOW" }
  | { readonly outcome: "DENY"; readonly code: string };

/** What the gate hands an executor: the approved record, nothing a model wrote later. */
export type ApprovedQAction<P> = {
  readonly actionId: QActionProposalId;
  readonly runId: QRunId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId | null;
  readonly actionType: QActionType;
  readonly actionVersion: number;
  readonly targets: readonly QSubjectRef[];
  readonly payload: P;
  /** Capital Q's execution identity; a provider idempotency key derives from it, never replaces it. */
  readonly idempotencyKey: string;
  readonly payloadHash: QActionPayloadHash;
  readonly approvalId: QApprovalId;
  /** The human whose authority the execution carries. */
  readonly approvedByUserId: UserId;
};

export type QActionExecutionContext = {
  /**
   * The approver, exactly as the gate just verified them: the same person
   * who approved, in the same tenant and organisation, holding the approve
   * capability and the action's own permission at this moment. An
   * executor acts under this authority and no other — rebuilding an actor
   * from the approval's user id loses the membership that roles hang on,
   * and live, every approved profile change failed its own permission
   * check that way (CQ-QACT-001).
   */
  readonly approver: ActorContext;
  readonly correlationId: CorrelationId;
  /** 1 for the first claim; a retry under the same approval increments it. */
  readonly attempt: number;
  readonly signal?: AbortSignal | undefined;
};

/**
 * The executor's typed report. The gate persists it; a model never
 * paraphrases it into a success (TM-Q-09). UNKNOWN means the executor
 * cannot say whether the side effect happened: the action becomes
 * RECONCILIATION_REQUIRED and is never resent automatically.
 */
export type QActionExecutionReport<R> =
  | { readonly outcome: "EXECUTED"; readonly result: R }
  | {
      readonly outcome: "FAILED";
      readonly failureCode: string;
      readonly retryable: boolean;
    }
  | { readonly outcome: "UNKNOWN"; readonly failureCode: string };

export type QActionExecutor<P, R> = {
  readonly execute: (
    action: ApprovedQAction<P>,
    context: QActionExecutionContext,
  ) => Promise<QActionExecutionReport<R>>;
};

export type QActionDefinition<P, R> = {
  readonly actionType: QActionType;
  readonly version: number;
  /** doc 12 §30. V1 registers CONFIRM_REQUIRED only. */
  readonly riskClass: QActionClass;
  readonly owner: string;
  readonly description: string;
  readonly payload: z.ZodType<P>;
  readonly result: z.ZodType<R>;
  /** The canonical entities the payload acts on; at least one. Part of the binding. */
  readonly targets: (payload: P) => readonly QSubjectRef[];
  /** Plain English for the person deciding. Presentation only. */
  readonly describe: (
    payload: P,
    targets: readonly QSubjectRef[],
  ) => QActionDescription;
  /**
   * The same, naming its targets as the proposing person may see them,
   * read after authorize allowed them; never writes. Absent: `describe`.
   * A failure falls back to `describe`: a card is never lost to a name.
   */
  readonly describeFor?:
    | ((
        payload: P,
        targets: readonly QSubjectRef[],
        actor: ActorContext,
      ) => Promise<QActionDescription>)
    | undefined;
  readonly authorize: (
    payload: P,
    actor: ActorContext,
  ) => Promise<QActionAuthorization>;
  readonly executor: QActionExecutor<P, R>;
  /**
   * Whether `next` may replace `previous` as the person's own edit of a
   * pending proposal (BIZ-007: the words of an email, never its recipient).
   * Absent: the action cannot be revised in place. A revision is proposed,
   * authorised and bound afresh; the old approval is void.
   */
  readonly revisable?: ((previous: P, next: P) => boolean) | undefined;
  /**
   * A setter (lead 2026-10-03): two waiting values for the same target
   * contradict each other, so a newer card replaces the older one. Absent
   * or false: an additive action (a message, a request, a reminder), and
   * several cards for one target coexist.
   */
  readonly supersedes?: boolean | undefined;
  /**
   * A setter's resource, from its payload (G-D23 follow-up): two waiting
   * cards replace each other only when this is equal. Required in effect
   * for a setter that declares no targets -- its default target is the
   * proposer, which would match every card of theirs; without a key such
   * a setter never replaces anything.
   */
  readonly supersedeKey?: ((payload: P) => string) | undefined;
  /**
   * Whether two proposals for the same targets would do the same thing in
   * the world although their values differ in detail (voiceq-63, live
   * 2026-10-04: "book a call with Nixo in the next five minutes", said and
   * restated, gave five starts seconds apart, five cards and two invites).
   * A match with a waiting card returns that card; a match with one
   * already carried out returns its result, said as `alreadyDone`. Absent:
   * only identical content is the same card.
   */
  readonly sameIntent?: ((previous: P, next: P) => boolean) | undefined;
  /**
   * What Q says when a request matches a change already carried out, from
   * that change's payload and validated result: "Already booked for Tue
   * 10:00 — link: …". Absent: "Already done: <summary>."
   */
  readonly alreadyDone?: ((payload: P, result: R) => string) | undefined;
  /**
   * What Q tells the person once the gate has persisted EXECUTED, from the
   * approved payload and the executor's validated result — never from a
   * model. Absent: the approval summary, prefixed "Done".
   */
  readonly confirm?: ((payload: P, result: R) => string) | undefined;
};

/** Erased for the registry; per-definition types stay with the definition. */
export type AnyQActionDefinition = QActionDefinition<unknown, unknown>;

export function defineQAction<P, R>(
  definition: QActionDefinition<P, R>,
): AnyQActionDefinition {
  return definition as unknown as AnyQActionDefinition;
}
