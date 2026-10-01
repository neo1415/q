"use server";

import { z } from "zod";

import {
  ApiProblemError,
  appendQRunMessage,
  approveQApproval,
  archiveQConversation,
  cancelQRun,
  rejectQApproval,
  createQRun,
  getCurrentOnboardingSession,
  getQArtifact,
  getQArtifactVersion,
  getQConversation,
  getQRun,
  listPendingQApprovals,
  listQConversations,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  Q_MESSAGE_TEXT_MAX_LENGTH,
  Q_OPENING_MAX_LENGTH,
  QConversationIdSchema,
  QScreenContextSchema,
  QViewingMomentSchema,
  type ListQConversationsResponse,
  type QArtifactDetail,
  type QConversationDetail,
  type QPendingApproval,
  type QRunSummary,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The only place the browser reaches the Q API (CQ-C5-R1 §13, §19).
 *
 * The Q API is a separate deployable from the application API, so this
 * carries its own base URL. What these actions do is exactly what the
 * existing Q client already offers — start a run, add a turn, cancel, read
 * the run back — over a session token that is forwarded server to server
 * and never reaches the browser.
 *
 * Every failure becomes a plain sentence a person can act on. No status
 * code, no problem code, no SQL, no queue, no provider, no run identifier
 * dressed up as an explanation (§19).
 */

export type QActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const UNAVAILABLE = "Q isn't available right now. Try again later.";

const failure = (message: string): QActionResult<never> => ({
  ok: false,
  message,
});

const QuestionSchema = z.string().trim().min(1).max(Q_MESSAGE_TEXT_MAX_LENGTH);
const RunIdSchema = z.string().uuid();
const OpeningSchema = z.string().trim().min(1).max(Q_OPENING_MAX_LENGTH);

async function qSession(): Promise<ApiSession | QActionResult<never>> {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return failure(UNAVAILABLE);
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return failure("Your session ended. Sign in again to continue.");
  }
  return { baseUrl: qApiBaseUrl, accessToken };
}

function isSession(
  value: ApiSession | QActionResult<never>,
): value is ApiSession {
  return "baseUrl" in value;
}

/**
 * Problem details → something worth reading.
 *
 * The API's own `detail` is server-authored and safe to show for a refusal
 * the person can do something about; everything else collapses to one
 * sentence, because "500" and "ECONNREFUSED" tell a founder nothing.
 */
function translate(error: unknown): QActionResult<never> {
  if (error instanceof ApiProblemError) {
    if (error.status === 401 || error.status === 403) {
      return failure("Your session ended. Sign in again to continue.");
    }
    if (error.status === 429) {
      return failure("Q is handling a lot right now. Try again in a moment.");
    }
    if (error.status >= 500) {
      return failure("I couldn't answer that right now. Try again.");
    }
    return failure(
      error.problem?.detail ?? "I couldn't send that to Q. Try again.",
    );
  }
  return failure("I couldn't reach Q. Try again.");
}

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
): Promise<QActionResult<T>> {
  const session = await qSession();
  if (!isSession(session)) {
    return session;
  }
  try {
    return { ok: true, value: await work(session) };
  } catch (error) {
    if (!(error instanceof ApiProblemError)) {
      // The connection, not the answer: the Q API restarts in development
      // and a mobile network drops. One retry after a beat.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      try {
        return { ok: true, value: await work(session) };
      } catch (again) {
        return translate(again);
      }
    }
    return translate(error);
  }
}

/**
 * Which platform subject a run is about. Resolved on the server; the Q API
 * resolves and authorises it again before the run reaches any context.
 */
export type QSubjectInput =
  | { readonly companyId: string }
  | { readonly investorOrganisationId: string }
  | { readonly relationshipId: string };

const SubjectInputSchema = z.union([
  z.object({ companyId: z.string().uuid() }).strict(),
  z.object({ investorOrganisationId: z.string().uuid() }).strict(),
  z.object({ relationshipId: z.string().uuid() }).strict(),
]);

export type QStartedRun = {
  readonly runId: string;
  readonly conversationId: string | undefined;
};

/**
 * The company this person's questions are about, when Capital Q already
 * knows of one.
 *
 * Read on the server from their own founder onboarding session, whose
 * subject is the canonical company binding the journey established. It is
 * not a new source of truth and not a new endpoint: the session already
 * names the company, and this reads it back under the person's own token.
 *
 * Naming a subject is how a run asks to reason about a company. It is a
 * request and never authority — the Q API resolves the subject through the
 * owning context's query port and refuses it unless disclosure allows this
 * actor to view it, which is why passing an id here grants nothing.
 */
export async function ownCompanyIdAction(): Promise<string | null> {
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) {
    return null;
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return null;
  }
  try {
    const view = await getCurrentOnboardingSession(
      { baseUrl: apiBaseUrl, accessToken },
      "founder",
    );
    const subject = view?.session.subject ?? null;
    return subject !== null && subject.type === "COMPANY" ? subject.id : null;
  } catch {
    // Not knowing the company is a normal state — an investor, or a founder
    // who has not started. Q still answers; it simply has no subject.
    return null;
  }
}

/**
 * Starts a conversation, or continues one by naming its conversation.
 *
 * `ANSWER` is the only capability this surface offers: Home asks questions.
 * The subject, when there is one, was resolved on the server; the Q API
 * resolves and authorises it again before the run reaches any context.
 */
export async function askQAction(
  rawQuestion: string,
  rawConversationId?: string,
  rawSubject?: QSubjectInput | string,
  /**
   * The browser's key for this question (CQ-QX-007 H1), so the same
   * question asked again after a reload is the same run, not a second
   * one. Input, never proof: the Q API scopes a key to the authenticated
   * person and refuses one reused for a different request.
   */
  rawIdempotencyKey?: string,
  /**
   * Where in a pitch the person was when they asked (R18). A request,
   * never authority: the Q API authorises the asset for this person with
   * the playback rule and the company's visibility, and drops it when
   * refused. Anything malformed is dropped here rather than failing the
   * question.
   */
  rawViewing?: unknown,
  /**
   * What is on screen (R21): the screen and the entity ids it shows. A
   * request, never authority: the Q API resolves each id for this person
   * or drops it. Anything malformed is dropped here.
   */
  rawScreen?: unknown,
  /**
   * What the surface said before this first question (Home's welcome and
   * briefing), so the conversation holds what a follow-up refers to.
   * Used only when this starts a conversation; dropped if malformed.
   */
  rawOpening?: string,
): Promise<QActionResult<QStartedRun>> {
  const parsed = QuestionSchema.safeParse(rawQuestion);
  if (!parsed.success) {
    return failure("Write a question first.");
  }
  // A conversation id from the browser is a request to continue that
  // conversation, never proof of access to it: the Q API resolves ownership
  // against the authenticated actor before it accepts the run.
  const conversationId =
    rawConversationId === undefined
      ? undefined
      : QConversationIdSchema.safeParse(rawConversationId).data;
  // A bare string is the older company-only form (F8 still uses it).
  const subject =
    rawSubject === undefined
      ? undefined
      : typeof rawSubject === "string"
        ? SubjectInputSchema.safeParse({ companyId: rawSubject }).data
        : SubjectInputSchema.safeParse(rawSubject).data;
  const subjects =
    subject === undefined
      ? undefined
      : "companyId" in subject
        ? [{ kind: "COMPANY" as const, companyId: subject.companyId }]
        : "relationshipId" in subject
          ? [
              {
                kind: "RELATIONSHIP" as const,
                relationshipId: subject.relationshipId,
              },
            ]
          : [
              {
                kind: "INVESTOR_ORGANISATION" as const,
                investorOrganisationId: subject.investorOrganisationId,
              },
            ];

  const viewing =
    rawViewing === undefined
      ? undefined
      : QViewingMomentSchema.safeParse(rawViewing).data;
  const screen =
    rawScreen === undefined
      ? undefined
      : QScreenContextSchema.safeParse(rawScreen).data;

  const opening =
    rawOpening === undefined || conversationId !== undefined
      ? undefined
      : OpeningSchema.safeParse(rawOpening).data;

  const idempotencyKey =
    rawIdempotencyKey === undefined
      ? undefined
      : RunIdSchema.safeParse(rawIdempotencyKey).data;

  return run(async (session) => {
    const start = (
      inConversation: typeof conversationId,
      key: string = idempotencyKey ?? crypto.randomUUID(),
    ) =>
      createQRun(
        session,
        {
          capability: "ANSWER",
          message: { text: parsed.data },
          modality: "TEXT",
          ...(subjects === undefined ? {} : { subjects }),
          ...(viewing === undefined ? {} : { viewing }),
          ...(screen === undefined ? {} : { screen }),
          ...(inConversation === undefined
            ? opening === undefined
              ? {}
              : { opening }
            : { conversationId: inConversation }),
        },
        key,
      );
    /**
     * A conversation that is no longer this person's to continue in their
     * current context (CQ-QX-005, adversarial round 1 #4).
     *
     * The onboarding thread opened its Q conversation before the person
     * had an organisation; creating one changed their actor context, and
     * the next question met "I couldn't find that Q conversation" — a dead
     * end over something they never did. Not found is the Q API's answer
     * for "not yours here"; the question is asked again in a fresh
     * conversation under the context they have now, and the caller keeps
     * the new id. Nothing is widened: the new run is authorised as any
     * other.
     */
    const handle = await start(conversationId).catch((error: unknown) => {
      if (
        conversationId !== undefined &&
        error instanceof ApiProblemError &&
        error.status === 404
      ) {
        return start(undefined, crypto.randomUUID());
      }
      throw error;
    });
    return {
      runId: handle.runId,
      conversationId: handle.conversationId,
    } satisfies QStartedRun;
  });
}

/** The next turn of a run that is still open. Stored, not answered. */
export async function continueQRunAction(
  rawRunId: string,
  rawQuestion: string,
): Promise<QActionResult<null>> {
  const runId = RunIdSchema.safeParse(rawRunId);
  const question = QuestionSchema.safeParse(rawQuestion);
  if (!runId.success || !question.success) {
    return failure("Write a question first.");
  }
  return run(async (session) => {
    await appendQRunMessage(
      session,
      runId.data,
      { message: { text: question.data } },
      crypto.randomUUID(),
    );
    return null;
  });
}

/** Stop a run in flight. Idempotent on the server. */
export async function cancelQRunAction(
  rawRunId: string,
): Promise<QActionResult<null>> {
  const runId = RunIdSchema.safeParse(rawRunId);
  if (!runId.success) {
    return failure("I couldn't stop that. Try again.");
  }
  return run(async (session) => {
    await cancelQRun(session, runId.data);
    return null;
  });
}

const ApprovalIdSchema = z.string().uuid();

/**
 * The person's decision on something Q prepared (CQ-Q-008, ADR 0011).
 * The server owns the proposal and its exact payload; this sends the
 * decision and nothing else. Approving resumes the run, which executes
 * through the gate; declining ends it with nothing changed.
 */
export async function approveQApprovalAction(
  rawApprovalId: string,
): Promise<QActionResult<null>> {
  const approvalId = ApprovalIdSchema.safeParse(rawApprovalId);
  if (!approvalId.success) {
    return failure("I couldn't record that decision. Try again.");
  }
  return run(async (session) => {
    await approveQApproval(session, approvalId.data);
    return null;
  });
}

/** The approvals still waiting on this person (their own, server-read). */
export async function pendingQApprovalsAction(): Promise<
  QActionResult<readonly QPendingApproval[]>
> {
  return run(async (session) => (await listPendingQApprovals(session)).items);
}

export async function rejectQApprovalAction(
  rawApprovalId: string,
): Promise<QActionResult<null>> {
  const approvalId = ApprovalIdSchema.safeParse(rawApprovalId);
  if (!approvalId.success) {
    return failure("I couldn't record that decision. Try again.");
  }
  return run(async (session) => {
    await rejectQApproval(session, approvalId.data);
    return null;
  });
}

/**
 * The run as its owner may read it, including the turns already exchanged.
 *
 * This is what makes a refresh honest: the conversation is the server's, so
 * reopening one shows what was actually said rather than a client's memory
 * of it.
 */
export async function readQRunAction(
  rawRunId: string,
): Promise<QActionResult<QRunSummary>> {
  const runId = RunIdSchema.safeParse(rawRunId);
  if (!runId.success) {
    return failure("I couldn't find that conversation.");
  }
  return run((session) => getQRun(session, runId.data));
}

/**
 * A person's conversations with Q (ADR 0012). Owner-only on the Q API; a
 * conversation that is not theirs is not found. The browser never keeps
 * a copy: a refresh reads the list and the thread back from the server.
 */
export async function listQConversationsAction(
  before?: string,
): Promise<QActionResult<ListQConversationsResponse>> {
  return run((session) =>
    listQConversations(session, {
      limit: 30,
      ...(before === undefined ? {} : { before }),
    }),
  );
}

export async function readQConversationAction(
  rawConversationId: string,
): Promise<QActionResult<QConversationDetail>> {
  const conversationId = QConversationIdSchema.safeParse(rawConversationId);
  if (!conversationId.success) {
    return failure("I couldn't find that conversation.");
  }
  return run((session) => getQConversation(session, conversationId.data));
}

export async function archiveQConversationAction(
  rawConversationId: string,
): Promise<QActionResult<null>> {
  const conversationId = QConversationIdSchema.safeParse(rawConversationId);
  if (!conversationId.success) {
    return failure("I couldn't find that conversation.");
  }
  return run(async (session) => {
    await archiveQConversation(session, conversationId.data);
    return null;
  });
}

/**
 * Reading what Q composed (QX-003E).
 *
 * Authority is the session cookie, verified here, forwarded server to
 * server. Knowing an artifact id is not permission to read it: the Q API
 * resolves the actor for itself and answers "not found" for anything that
 * is not theirs, so a card in an old message stops working the moment the
 * person loses access to the company it is about.
 */
export async function readQArtifactAction(
  rawArtifactId: string,
): Promise<QActionResult<QArtifactDetail>> {
  const artifactId = z.string().uuid().safeParse(rawArtifactId);
  if (!artifactId.success) {
    return failure("I couldn't find that document.");
  }
  return run((session) => getQArtifact(session, artifactId.data));
}

/** One earlier version of it, shown as it was written. */
export async function readQArtifactVersionAction(
  rawArtifactId: string,
  rawVersion: number,
): Promise<QActionResult<QArtifactDetail>> {
  const artifactId = z.string().uuid().safeParse(rawArtifactId);
  const version = z.number().int().min(1).max(10_000).safeParse(rawVersion);
  if (!artifactId.success || !version.success) {
    return failure("I couldn't find that version.");
  }
  return run((session) =>
    getQArtifactVersion(session, artifactId.data, version.data),
  );
}
