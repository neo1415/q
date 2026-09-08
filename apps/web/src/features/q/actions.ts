"use server";

import { z } from "zod";

import {
  ApiProblemError,
  appendQRunMessage,
  cancelQRun,
  createQRun,
  getCurrentOnboardingSession,
  getQRun,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  Q_MESSAGE_TEXT_MAX_LENGTH,
  QConversationIdSchema,
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

const UNAVAILABLE = "Q isn't connected on this build yet.";

const failure = (message: string): QActionResult<never> => ({
  ok: false,
  message,
});

const QuestionSchema = z.string().trim().min(1).max(Q_MESSAGE_TEXT_MAX_LENGTH);
const RunIdSchema = z.string().uuid();

async function qSession(): Promise<ApiSession | QActionResult<never>> {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) {
    return failure(UNAVAILABLE);
  }
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) {
    return failure("Please sign in again to continue.");
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
      return failure("Please sign in again to continue.");
    }
    if (error.status === 429) {
      return failure(
        "Q is handling a lot right now. Please try again in a moment.",
      );
    }
    if (error.status >= 500) {
      return failure("I couldn't answer that right now. Please try again.");
    }
    return failure(error.problem?.detail ?? "I couldn't send that to Q.");
  }
  return failure("I couldn't reach Q. Please try again.");
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
    return translate(error);
  }
}

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
  rawCompanyId?: string,
): Promise<QActionResult<QStartedRun>> {
  const parsed = QuestionSchema.safeParse(rawQuestion);
  if (!parsed.success) {
    return failure("Please write a question first.");
  }
  // A conversation id from the browser is a request to continue that
  // conversation, never proof of access to it: the Q API resolves ownership
  // against the authenticated actor before it accepts the run.
  const conversationId =
    rawConversationId === undefined
      ? undefined
      : QConversationIdSchema.safeParse(rawConversationId).data;
  const companyId =
    rawCompanyId === undefined
      ? undefined
      : z.string().uuid().safeParse(rawCompanyId).data;

  return run(async (session) => {
    const handle = await createQRun(
      session,
      {
        capability: "ANSWER",
        message: { text: parsed.data },
        modality: "TEXT",
        ...(companyId === undefined
          ? {}
          : { subjects: [{ kind: "COMPANY" as const, companyId }] }),
        ...(conversationId === undefined ? {} : { conversationId }),
      },
      crypto.randomUUID(),
    );
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
    return failure("Please write a question first.");
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
    return failure("I couldn't stop that.");
  }
  return run(async (session) => {
    await cancelQRun(session, runId.data);
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
