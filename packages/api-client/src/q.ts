import {
  ListQArtifactsResponseSchema,
  QArtifactDetailSchema,
  Q_ARTIFACTS_PATH,
  Q_ARTIFACT_VERSIONS_SUFFIX,
  AppendQRunMessageResponseSchema,
  CreateQRunResponseSchema,
  CreateQVoiceSessionResponseSchema,
  QVoiceTurnStateSchema,
  qVoiceTurnPath,
  qVoiceScreenPath,
  type QVoiceScreenUpdate,
  Q_VOICE_SESSIONS_PATH,
  IDEMPOTENCY_KEY_HEADER,
  Q_APPROVAL_APPROVE_SUFFIX,
  Q_APPROVAL_REJECT_SUFFIX,
  Q_APPROVALS_PATH,
  Q_CONVERSATION_ARCHIVE_SUFFIX,
  Q_CONVERSATION_MESSAGE_HIDE_SUFFIX,
  Q_CONVERSATIONS_PATH,
  Q_RUN_CANCEL_SUFFIX,
  Q_RUN_MESSAGES_SUFFIX,
  Q_RUNS_PATH,
  ListQConversationsResponseSchema,
  QConversationDetailSchema,
  QApprovalViewSchema,
  QPendingApprovalListSchema,
  QRunSummarySchema,
  type AppendQRunMessageRequest,
  type CreateQRunRequest,
  type CreateQVoiceSessionRequest,
  type RejectQApprovalRequest,
  ProfileFindingsResponseSchema,
  Q_PROFILE_FINDINGS_PATH,
  type ProfileFindingsQuery,
  // DOCS block.
  Q_ANSWER_EXPORTS_PATH,
  Q_BRAND_KIT_CONFIRM_SUFFIX,
  Q_BRAND_KIT_PATH,
  Q_BRAND_KIT_SUGGEST_SUFFIX,
  QBrandKitSchema,
  QBrandKitStateSchema,
  type ConfirmQBrandKitRequest,
  type CreateQAnswerExportRequest,
  type SetQBrandKitRequest,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
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

/** `GET /v1/q/approvals` — the approvals still waiting on the caller (R35). */
export function listPendingQApprovals(session: ApiSession) {
  return call(session, "GET", Q_APPROVALS_PATH, QPendingApprovalListSchema);
}

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

/**
 * `POST /v1/q/voice/sessions` (CQ-Q-VOICE-001 C) — an ephemeral, scoped
 * credential for one microphone session, bound on the server to the actor
 * and the thread the person is in. It grants audio transport and nothing
 * in Capital Q; the provider API key never leaves the Q API.
 */
/** What Q is asking after its latest spoken turn (owner only). */
/**
 * The line's sealed session (from the create response), presented so any
 * instance of the Q API still knows the line after a deploy or restart.
 */
const voiceSessionHeader = (sessionToken: string | undefined) =>
  sessionToken === undefined ? {} : { "x-q-voice-session": sessionToken };

export function getQVoiceTurnState(
  session: ApiSession,
  voiceSessionId: string,
  sessionToken?: string,
) {
  return call(
    session,
    "GET",
    qVoiceTurnPath(voiceSessionId),
    QVoiceTurnStateSchema,
    { headers: voiceSessionHeader(sessionToken) },
  );
}

/** Where the person is now, while the line is open (R21; owner only). 204. */
export async function setQVoiceScreen(
  session: ApiSession,
  voiceSessionId: string,
  screen: QVoiceScreenUpdate,
  sessionToken?: string,
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${qVoiceScreenPath(voiceSessionId)}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${session.accessToken}`,
        ...voiceSessionHeader(sessionToken),
      },
      body: JSON.stringify(screen),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await readProblemResponse(response);
  }
}

export function createQVoiceSession(
  session: ApiSession,
  input: CreateQVoiceSessionRequest,
) {
  return call(
    session,
    "POST",
    Q_VOICE_SESSIONS_PATH,
    CreateQVoiceSessionResponseSchema,
    { body: input },
  );
}

const conversationPath = (conversationId: string) =>
  `${Q_CONVERSATIONS_PATH}/${encodeURIComponent(conversationId)}`;

/**
 * A person's conversations with Q (ADR 0012). Owner-only on the server;
 * a conversation that is not theirs is not found.
 */

/** `GET /v1/q/conversations?limit=&before=` — newest activity first. */
export function listQConversations(
  session: ApiSession,
  page: { readonly limit?: number; readonly before?: string } = {},
) {
  const query = new URLSearchParams();
  if (page.limit !== undefined) query.set("limit", String(page.limit));
  if (page.before !== undefined) query.set("before", page.before);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return call(
    session,
    "GET",
    `${Q_CONVERSATIONS_PATH}${suffix}`,
    ListQConversationsResponseSchema,
  );
}

/** `GET /v1/q/conversations/:conversationId` — the recent turns and the latest run. */
export function getQConversation(session: ApiSession, conversationId: string) {
  return call(
    session,
    "GET",
    conversationPath(conversationId),
    QConversationDetailSchema,
  );
}

/** `POST /v1/q/conversations/:conversationId/archive` — idempotent; 204. */
/** Keep one of the owner's lines out of what Q reads back; never deleted. */
export async function hideQConversationMessage(
  session: ApiSession,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${conversationPath(conversationId)}/messages/${encodeURIComponent(messageId)}${Q_CONVERSATION_MESSAGE_HIDE_SUFFIX}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await readProblemResponse(response);
  }
}

export async function archiveQConversation(
  session: ApiSession,
  conversationId: string,
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${conversationPath(conversationId)}${Q_CONVERSATION_ARCHIVE_SUFFIX}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await readProblemResponse(response);
  }
}

const artifactPath = (artifactId: string) =>
  `${Q_ARTIFACTS_PATH}/${encodeURIComponent(artifactId)}`;

/**
 * What Q composed (QX-003E). Owner-only on the server: an artifact that
 * is not this person's is not found, and knowing its id changes nothing.
 */

/** `GET /v1/q/artifacts?limit=&before=&subjectId=` — newest first. */
export function listQArtifacts(
  session: ApiSession,
  page: {
    readonly limit?: number;
    readonly before?: string;
    readonly subjectId?: string;
  } = {},
) {
  const query = new URLSearchParams();
  if (page.limit !== undefined) query.set("limit", String(page.limit));
  if (page.before !== undefined) query.set("before", page.before);
  if (page.subjectId !== undefined) query.set("subjectId", page.subjectId);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return call(
    session,
    "GET",
    `${Q_ARTIFACTS_PATH}${suffix}`,
    ListQArtifactsResponseSchema,
  );
}

/** `GET /v1/q/artifacts/:artifactId` — the current version and the history. */
export function getQArtifact(session: ApiSession, artifactId: string) {
  return call(session, "GET", artifactPath(artifactId), QArtifactDetailSchema);
}

/** `GET /v1/q/artifacts/:artifactId/versions/:version` — one earlier version. */
export function getQArtifactVersion(
  session: ApiSession,
  artifactId: string,
  version: number,
) {
  return call(
    session,
    "GET",
    `${artifactPath(artifactId)}${Q_ARTIFACT_VERSIONS_SUFFIX}/${String(version)}`,
    QArtifactDetailSchema,
  );
}

/**
 * `GET /v1/q/profile-findings` -- what Q found on the public web about the
 * caller's own profile subject (BIZ-002). A Q API session.
 */
export function getProfileFindings(
  session: ApiSession,
  query: ProfileFindingsQuery,
) {
  const params = new URLSearchParams({
    subjectType: query.subjectType,
    subjectId: query.subjectId,
  });
  return call(
    session,
    "GET",
    `${Q_PROFILE_FINDINGS_PATH}?${params.toString()}`,
    ProfileFindingsResponseSchema,
  );
}

// --- DOCS block: brand kit and answer exports ------------------------------

/** `GET /v1/q/brand-kit` — what applies and what waits for a yes. */
export function getQBrandKit(session: ApiSession) {
  return call(session, "GET", Q_BRAND_KIT_PATH, QBrandKitStateSchema);
}

/** `POST /v1/q/brand-kit` — the person's own values, confirmed as given. */
export function setQBrandKit(session: ApiSession, body: SetQBrandKitRequest) {
  return call(session, "POST", Q_BRAND_KIT_PATH, QBrandKitSchema, { body });
}

/** `POST /v1/q/brand-kit/suggest` — Q reads their website; applies nothing. */
export function suggestQBrandKit(session: ApiSession) {
  return call(
    session,
    "POST",
    `${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_SUGGEST_SUFFIX}`,
    QBrandKitSchema,
    { body: {} },
  );
}

/** `POST /v1/q/brand-kit/confirm` — confirm or decline exactly one suggestion. */
export function confirmQBrandKit(
  session: ApiSession,
  body: ConfirmQBrandKitRequest,
) {
  return call(
    session,
    "POST",
    `${Q_BRAND_KIT_PATH}${Q_BRAND_KIT_CONFIRM_SUFFIX}`,
    QBrandKitSchema,
    { body },
  );
}

/** `POST /v1/q/answer-exports` — one Q answer filed as a PDF document. */
export function createQAnswerExport(
  session: ApiSession,
  body: CreateQAnswerExportRequest,
) {
  return call(session, "POST", Q_ANSWER_EXPORTS_PATH, QArtifactDetailSchema, {
    body,
  });
}
