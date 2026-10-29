import { createSseParser } from "@capital-q/api-client";
import type { SayOnboardingResponse } from "@capital-q/contracts";

import { OnboardingClientError } from "./client";

/**
 * Turn latency 2026-10-21 (onboarding L9): one typed onboarding turn, read
 * as Q writes it. The browser posts to the web app's own route
 * (`/api/onboarding-say/<session>`), which carries the session's bearer to
 * the API; each finished sentence of Q's reply reaches `onSentence` while
 * the turn runs, and the whole turn resolves exactly as the server action
 * would have returned it.
 *
 * Null: the stream never opened (no route, a network failure, a refused
 * request), so no turn ran. The caller then makes the ordinary
 * server-action request, which words any refusal exactly as before.
 */

export const ONBOARDING_SAY_ROUTE = "/api/onboarding-say";

export type SayStreamRequest = {
  readonly sessionId: string;
  readonly text: string;
  readonly expectedSessionVersion: number;
  readonly idempotencyKey: string;
  readonly recentTurns: readonly {
    readonly role: "person" | "q";
    readonly text: string;
  }[];
  readonly focus?: string | undefined;
  /** The review whose confirm button they tapped (sweep D1). */
  readonly confirmReview?: string | undefined;
};

/**
 * How long the stream may go without an event (a sentence, a stage, the
 * result) before the thread is read to settle the turn (D2, live run
 * 2026-10-28). Heartbeat comments keep the connection open but say nothing
 * about the turn, so they do not count.
 */
export const SAY_STREAM_STALL_MS = 15_000;
/** After this long with no result by any route, the turn is given up on screen. */
export const SAY_STREAM_MAX_MS = 120_000;

export type SayStreamSettle = {
  /** Nothing has arrived for `stallMs`: read the thread; a turn settles the stream. */
  readonly onStall?: (() => Promise<SayOnboardingResponse | null>) | undefined;
  readonly stallMs?: number | undefined;
  readonly maxMs?: number | undefined;
};

export async function sayStreamed(
  request: SayStreamRequest,
  onSentence: (text: string) => void,
  transport: typeof fetch = (input, init) => fetch(input, init),
  /** What Q is doing now (owner 2026-10-21), from real events in the turn. */
  onStage?: (stage: { readonly stage: string; readonly label: string }) => void,
  settle: SayStreamSettle = {},
): Promise<SayOnboardingResponse | null> {
  const { sessionId, ...body } = request;
  let response: Response;
  try {
    response = await transport(
      `${ONBOARDING_SAY_ROUTE}/${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        credentials: "same-origin",
      },
    );
  } catch {
    return null;
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => null);
    // The route's own refusal (no problem code: not composed, a bad id):
    // the API was never asked, so the server action asks it.
    if (codeOf(problem) === null) return null;
    throw refusal(response.status, problem);
  }
  if (response.body === null || !type.includes("text/event-stream")) {
    return null;
  }
  // Validated where it lands; loaded with the first streamed turn.
  const {
    QInterviewSentenceSchema,
    QInterviewStageSchema,
    SayOnboardingResponseSchema,
  } = await import("@capital-q/contracts");
  const parser = createSseParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const stallMs = settle.stallMs ?? SAY_STREAM_STALL_MS;
  const maxMs = settle.maxMs ?? SAY_STREAM_MAX_MS;
  const startedAt = Date.now();
  let lastEventAt = startedAt;
  // One read in flight at a time; a stall wakes before it resolves and the
  // same read is awaited again afterwards.
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  let settled = false;
  try {
    for (;;) {
      if (Date.now() - startedAt > maxMs) break;
      pending ??= reader.read();
      const next = await raceStall(
        pending,
        Math.max(0, stallMs - (Date.now() - lastEventAt)),
      );
      if (next === STALLED) {
        // D2: the DB had Q's turn within seconds while the stream sat
        // silent; the thread settles the turn, and the composer opens.
        const fromThread = (await settle.onStall?.()) ?? null;
        if (fromThread !== null) {
          settled = true;
          return fromThread;
        }
        lastEventAt = Date.now();
        continue;
      }
      pending = null;
      const { done, value } = next;
      const text =
        value === undefined ? "" : decoder.decode(value, { stream: !done });
      const messages = parser.feed(done ? `${text}\n\n` : text);
      if (messages.length > 0) lastEventAt = Date.now();
      for (const message of messages) {
        const data = parsed(message.data);
        if (message.event === "sentence") {
          const sentence = QInterviewSentenceSchema.safeParse(data);
          if (sentence.success) onSentence(sentence.data.text);
        } else if (message.event === "stage") {
          const stage = QInterviewStageSchema.safeParse(data);
          if (stage.success) onStage?.(stage.data);
        } else if (message.event === "result") {
          const turn = SayOnboardingResponseSchema.safeParse(data);
          if (turn.success) return turn.data;
          throw new OnboardingClientError(
            "UNAVAILABLE",
            "Q's answer came back in a form this screen can't read. Try again.",
          );
        } else if (message.event === "problem") {
          // Sentences were shown; the turn itself did not finish.
          throw new OnboardingClientError(
            "UNAVAILABLE",
            isPaused(data)
              ? "Your account is paused. Someone from the Capital Q team will be in touch."
              : "Q couldn't finish that reply. Try again.",
          );
        }
      }
      if (done) break;
    }
  } catch (error) {
    if (error instanceof OnboardingClientError) throw error;
  } finally {
    if (settled) {
      // The thread answered first; a result still on its way is not
      // waited for (it would say the same), and the read is let go.
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
  // The stream opened, so the turn ran on the server: it is never sent
  // again from here (a second send would be a second turn). What it saved
  // shows when the screen re-reads; the line can be sent again by hand.
  throw new OnboardingClientError(
    "NETWORK",
    Date.now() - startedAt > maxMs
      ? "Q is taking longer than usual. Your words were sent; what Q saved shows when you reload."
      : "I lost the connection to Q. Try again.",
  );
}

const STALLED = Symbol("stalled");

/** The next read, or STALLED once `waitMs` passes without it. */
function raceStall<T>(
  read: Promise<T>,
  waitMs: number,
): Promise<T | typeof STALLED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stall = new Promise<typeof STALLED>((resolve) => {
    timer = setTimeout(() => resolve(STALLED), waitMs);
  });
  return Promise.race([read, stall]).finally(() => clearTimeout(timer));
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function codeOf(problem: unknown): string | null {
  return typeof problem === "object" &&
    problem !== null &&
    "code" in problem &&
    typeof problem.code === "string"
    ? problem.code
    : null;
}

/** The API's refusal, worded as the server action words it (api-actions translate). */
function refusal(status: number, problem: unknown): OnboardingClientError {
  if (codeOf(problem) === "VERSION_CONFLICT") {
    return new OnboardingClientError(
      "CONFLICT",
      "This step changed in another tab. Showing the latest.",
    );
  }
  if (status === 401) {
    return new OnboardingClientError(
      "UNAVAILABLE",
      "Your session ended. Sign in again to continue.",
    );
  }
  if (status >= 500) {
    return new OnboardingClientError(
      "NETWORK",
      "Capital Q couldn't save that. Try again.",
    );
  }
  const detail =
    typeof problem === "object" &&
    problem !== null &&
    "detail" in problem &&
    typeof problem.detail === "string"
      ? problem.detail
      : "Capital Q couldn't take that. Try again.";
  return new OnboardingClientError("REJECTED", detail);
}

function isPaused(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "paused" in data &&
    data.paused === true
  );
}
