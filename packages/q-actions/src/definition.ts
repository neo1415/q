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
  ) => { readonly summary: string; readonly preview?: string | undefined };
  readonly authorize: (
    payload: P,
    actor: ActorContext,
  ) => Promise<QActionAuthorization>;
  readonly executor: QActionExecutor<P, R>;
};

/** Erased for the registry; per-definition types stay with the definition. */
export type AnyQActionDefinition = QActionDefinition<unknown, unknown>;

export function defineQAction<P, R>(
  definition: QActionDefinition<P, R>,
): AnyQActionDefinition {
  return definition as unknown as AnyQActionDefinition;
}
