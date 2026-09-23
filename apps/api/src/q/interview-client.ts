import {
  QInterviewTurnResponseSchema,
  Q_INTERVIEW_PATH,
  Q_INTERVIEW_TURN_SEGMENT,
  type QInterviewTurnRequest,
  type QInterviewTurnResponse,
} from "@capital-q/contracts";

/**
 * The typed way this service reaches the one Q interviewer (QX-004 core
 * gate: one Q).
 *
 * Capital Q had grown two conversational implementations: the interviewer
 * in q-api, which the spoken thread used, and a template engine in the
 * browser, which is what a typed demo actually met. This is the transport
 * that lets the typed path use the same interviewer, so a keyboard and a
 * microphone differ in how a turn arrives and in nothing else.
 *
 * It carries the caller's own bearer. The interviewer then reads and
 * writes the onboarding session under exactly that authority, which is why
 * a typed turn can do precisely what the person could have done by
 * tapping, and no more. No service credential passes through here.
 */

export type QInterviewClient = {
  turn: (input: {
    readonly accessToken: string;
    readonly request: QInterviewTurnRequest;
  }) => Promise<QInterviewTurnResponse>;
};

/** The interviewer was not reachable; the caller decides what to say. */
export class QInterviewUnavailableError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super("The Q interviewer is not available.");
    this.name = "QInterviewUnavailableError";
    this.detail = detail;
  }
}

export function createQInterviewClient(options: {
  readonly baseUrl: string;
  /** A slow model must not hold an HTTP worker open indefinitely. */
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}): QInterviewClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 60_000;
  // Resolved per call, not captured: a test that replaces globalThis.fetch
  // after composition still sees its own double.
  const call: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return {
    turn: async ({ accessToken, request }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      // Never a reason to hold the loop open on its own.
      timer.unref?.();
      let response: Response;
      try {
        response = await call(
          `${base}${Q_INTERVIEW_PATH}${Q_INTERVIEW_TURN_SEGMENT}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(request),
            signal: controller.signal,
          },
        );
      } catch (error) {
        throw new QInterviewUnavailableError(
          error instanceof Error ? error.message : "unreachable",
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new QInterviewUnavailableError(
          `the interviewer answered ${String(response.status)}`,
        );
      }
      // Another service's body is external data: unknown until parsed.
      const body: unknown = await response.json();
      const parsed = QInterviewTurnResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new QInterviewUnavailableError(
          "the interviewer answered in a shape this service does not accept",
        );
      }
      return parsed.data;
    },
  };
}
