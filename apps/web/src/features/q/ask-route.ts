import {
  askQAction,
  type QActionResult,
  type QStartedRun,
  type QSubjectInput,
} from "./actions";

/**
 * A typed question, sent through /api/q-ask rather than the server action
 * queue (K1 browser budget, 2026-10-09: on /home the question waited 1.6 s
 * behind the arrival's own server actions). Same arguments and result as
 * askQAction; if the route cannot be reached or answers with something
 * unreadable, the question goes through askQAction as before (never lost,
 * and the idempotency key keeps it one run).
 */
export async function askQ(
  question: string,
  conversationId?: string,
  subject?: QSubjectInput | string,
  idempotencyKey?: string,
  viewing?: unknown,
  screen?: unknown,
  opening?: string,
  doFetch: typeof fetch = fetch,
): Promise<QActionResult<QStartedRun>> {
  try {
    const response = await doFetch("/api/q-ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        conversationId,
        subject,
        idempotencyKey,
        viewing,
        screen,
        opening,
      }),
    });
    if (response.ok) {
      const read = startedOf(await response.json());
      if (read !== null) return read;
    }
  } catch {
    // Unreachable: the server action below takes it.
  }
  return askQAction(
    question,
    conversationId,
    subject,
    idempotencyKey,
    viewing,
    screen,
    opening,
  );
}

/** The route's answer, read field by field; null when it is not one. */
export function startedOf(body: unknown): QActionResult<QStartedRun> | null {
  if (typeof body !== "object" || body === null) return null;
  const ok: unknown = Reflect.get(body, "ok");
  if (ok === false) {
    const message: unknown = Reflect.get(body, "message");
    return typeof message === "string" ? { ok: false, message } : null;
  }
  if (ok !== true) return null;
  const value: unknown = Reflect.get(body, "value");
  if (typeof value !== "object" || value === null) return null;
  const runId: unknown = Reflect.get(value, "runId");
  const conversationId: unknown = Reflect.get(value, "conversationId");
  if (typeof runId !== "string") return null;
  return {
    ok: true,
    value: {
      runId,
      conversationId:
        typeof conversationId === "string" ? conversationId : undefined,
    },
  };
}
