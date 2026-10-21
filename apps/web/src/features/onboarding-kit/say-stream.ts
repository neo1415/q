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
};

export async function sayStreamed(
  request: SayStreamRequest,
  onSentence: (text: string) => void,
  transport: typeof fetch = (input, init) => fetch(input, init),
  /** What Q is doing now (owner 2026-10-21), from real events in the turn. */
  onStage?: (stage: { readonly stage: string; readonly label: string }) => void,
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const text =
        value === undefined ? "" : decoder.decode(value, { stream: !done });
      for (const message of parser.feed(done ? `${text}\n\n` : text)) {
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
    reader.releaseLock();
  }
  // The stream opened, so the turn ran on the server: it is never sent
  // again from here (a second send would be a second turn). What it saved
  // shows when the screen re-reads; the line can be sent again by hand.
  throw new OnboardingClientError(
    "NETWORK",
    "I lost the connection to Q. Try again.",
  );
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
