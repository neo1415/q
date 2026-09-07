import {
  AppendQRunMessageResponseSchema,
  CreateQRunResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  Q_APPROVAL_APPROVE_SUFFIX,
  Q_APPROVAL_REJECT_SUFFIX,
  Q_APPROVALS_PATH,
  Q_RUN_CANCEL_SUFFIX,
  Q_RUN_MESSAGES_SUFFIX,
  Q_RUNS_PATH,
  QApprovalViewSchema,
  QRunSummarySchema,
  type AppendQRunMessageRequest,
  type CreateQRunRequest,
  type RejectQApprovalRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * The Q run lifecycle (CQ-Q-002). These call the Q API — a separate
 * service from the application API — so the session's `baseUrl` is the Q
 * API's origin.
 *
 * There is deliberately no `streamQRun` here and no way to read events:
 * the resumable stream arrives with CQ-Q-009, and a method that looked like
 * it subscribed would be a lie a caller could not see through. What these
 * do is start, read, continue and cancel the durable run record. Starting
 * a run returns RECEIVED — accepted, not analysed.
 */

const runPath = (runId: string) =>
  `${Q_RUNS_PATH}/${encodeURIComponent(runId)}`;

/**
 * `POST /v1/q/runs`. The idempotency key is generated once per intended
 * request and reused on retry; the same key with the same body returns the
 * same run.
 */
export function createQRun(
  session: ApiSession,
  input: CreateQRunRequest,
  idempotencyKey: string,
) {
  return call(session, "POST", Q_RUNS_PATH, CreateQRunResponseSchema, {
    body: input,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

/** `GET /v1/q/runs/:runId` — the run as its owner may read it. */
export function getQRun(session: ApiSession, runId: string) {
  return call(session, "GET", runPath(runId), QRunSummarySchema);
}

/**
 * `POST /v1/q/runs/:runId/messages` — the person's next turn. Stored, not
 * answered.
 */
export function appendQRunMessage(
  session: ApiSession,
  runId: string,
  input: AppendQRunMessageRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    `${runPath(runId)}${Q_RUN_MESSAGES_SUFFIX}`,
    AppendQRunMessageResponseSchema,
    { body: input, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

/** `POST /v1/q/runs/:runId/cancel` — idempotent; returns the run's state. */
export function cancelQRun(session: ApiSession, runId: string) {
  return call(
    session,
    "POST",
    `${runPath(runId)}${Q_RUN_CANCEL_SUFFIX}`,
    QRunSummarySchema,
  );
}

const approvalPath = (approvalId: string) =>
  `${Q_APPROVALS_PATH}/${encodeURIComponent(approvalId)}`;

/**
 * The approval surface (CQ-Q-008). A client reads what Q wants to do and
 * states a decision about that existing server-side proposal. No approval
 * state is computed here and nothing about the proposal is sent back: the
 * server owns the canonical payload and its fingerprint. "Approved" in the
 * returned view means the decision was recorded; execution is reported by
 * the action's own status, never assumed.
 */

/** `GET /v1/q/approvals/:approvalId` — the approval as its requested approver may read it. */
export function getQApproval(session: ApiSession, approvalId: string) {
  return call(session, "GET", approvalPath(approvalId), QApprovalViewSchema);
}

/** `POST /v1/q/approvals/:approvalId/approve` — approves the exact proposal; empty body by contract. */
export function approveQApproval(session: ApiSession, approvalId: string) {
  return call(
    session,
    "POST",
    `${approvalPath(approvalId)}${Q_APPROVAL_APPROVE_SUFFIX}`,
    QApprovalViewSchema,
    { body: {} },
  );
}

/** `POST /v1/q/approvals/:approvalId/reject` — declines; the reason is optional and bounded. */
export function rejectQApproval(
  session: ApiSession,
  approvalId: string,
  input: RejectQApprovalRequest = {},
) {
  return call(
    session,
    "POST",
    `${approvalPath(approvalId)}${Q_APPROVAL_REJECT_SUFFIX}`,
    QApprovalViewSchema,
    { body: input },
  );
}
