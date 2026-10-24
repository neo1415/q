import {
  QInterviewSentenceSchema,
  QInterviewStageSchema,
  QInterviewTurnResponseSchema,
  Q_INTERVIEW_STREAM_EVENTS,
  Q_SSE_CONTENT_TYPE,
  Q_INTERVIEW_PATH,
  Q_INTERVIEW_TURN_SEGMENT,
  type QInterviewStage,
  type QInterviewTurnRequest,
  type QInterviewTurnResponse,
} from "@capital-q/contracts";

import { sseFrames } from "./sse-frames.js";

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
  /**
   * The same turn, streamed (onboarding L9): `onSentence` hears each of
   * Q's finished sentences as q-api sends it; the promise resolves to the
   * whole turn, exactly as `turn` would, and fails the same ways.
   */
  turnStream: (input: {
    readonly accessToken: string;
    readonly request: QInterviewTurnRequest;
    readonly onSentence: (text: string) => void;
    /** Each stage of the turn as q-api reports it (owner 2026-10-21). */
    readonly onStage?: ((stage: QInterviewStage) => void) | undefined;
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

/**
 * Q refused the turn because the account is paused (founder direction
 * 2026-09-30). Passed on as itself so the screen can say so, never as
 * "Q is unavailable".
 */
export class QAccountPausedError extends Error {
  constructor() {
    super(
      "Your account is paused. Someone from the Capital Q team will be in touch.",
    );
    this.name = "QAccountPausedError";
  }
}

/** A streamed turn's overall cap: long turns finish; a stuck one lets go. */
export const STREAM_MAX_MS = 5 * 60_000;

export function createQInterviewClient(options: {
  readonly baseUrl: string;
  /** A slow model must not hold an HTTP worker open indefinitely. */
  readonly timeoutMs?: number;
  /** A stream's overall cap; its silence is bounded by `timeoutMs`. */
  readonly streamMaxMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}): QInterviewClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 60_000;
  const streamMaxMs = options.streamMaxMs ?? STREAM_MAX_MS;
  // Resolved per call, not captured: a test that replaces globalThis.fetch
  // after composition still sees its own double.
  const call: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  /** One POST to the interviewer, its status already judged. */
  const post = async (
    accessToken: string,
    request: QInterviewTurnRequest,
    signal: AbortSignal,
    accept?: string,
  ): Promise<Response> => {
    let response: Response;
    try {
      response = await call(
        `${base}${Q_INTERVIEW_PATH}${Q_INTERVIEW_TURN_SEGMENT}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            ...(accept === undefined ? {} : { accept }),
          },
          body: JSON.stringify(request),
          signal,
        },
      );
    } catch (error) {
      throw new QInterviewUnavailableError(
        error instanceof Error ? error.message : "unreachable",
      );
    }
    if (response.status === 403) {
      const refusal: unknown = await response.json().catch(() => null);
      if (pausedRefusal(refusal)) throw new QAccountPausedError();
    }
    if (!response.ok) {
      throw new QInterviewUnavailableError(
        `the interviewer answered ${String(response.status)}`,
      );
    }
    return response;
  };

  /** A deadline for one call; never a reason to hold the loop open. */
  const deadline = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  };

  /**
   * A stream's deadline: `timeoutMs` of silence, renewed by every byte the
   * interviewer sends (its heartbeat comes every few seconds), within an
   * overall cap. QA F-67 (24 Oct): the whole stream had 60 s; a first
   * answer saving nine facts ran longer, the stream was cut while the turn
   * went on to save, and the screen said "I lost the connection to Q".
   */
  const streamDeadline = () => {
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    let idle = setTimeout(abort, timeoutMs);
    idle.unref?.();
    const cap = setTimeout(abort, streamMaxMs);
    cap.unref?.();
    return {
      signal: controller.signal,
      touch: () => {
        clearTimeout(idle);
        idle = setTimeout(abort, timeoutMs);
        idle.unref?.();
      },
      clear: () => {
        clearTimeout(idle);
        clearTimeout(cap);
      },
    };
  };

  return {
    turn: async ({ accessToken, request }) => {
      const limit = deadline();
      let response: Response;
      try {
        response = await post(accessToken, request, limit.signal);
      } finally {
        limit.clear();
      }
      // Another service's body is external data: unknown until parsed.
      const body: unknown = await response.json();
      return parsedTurn(body);
    },

    turnStream: async ({ accessToken, request, onSentence, onStage }) => {
      // Bounded by silence, not only its first byte: a model that stalls
      // mid-reply still lets go, and a long turn that keeps talking is
      // never cut for being long (overall cap aside).
      const limit = streamDeadline();
      try {
        const response = await post(
          accessToken,
          request,
          limit.signal,
          Q_SSE_CONTENT_TYPE,
        );
        const type = response.headers.get("content-type") ?? "";
        if (!type.includes(Q_SSE_CONTENT_TYPE)) {
          // An interviewer without the streamed form answers as before.
          const body: unknown = await response.json();
          return parsedTurn(body);
        }
        if (response.body === null) {
          throw new QInterviewUnavailableError("the interviewer sent no body");
        }
        let result: QInterviewTurnResponse | null = null;
        // Every byte renews the deadline, heartbeat comments included.
        const watched = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform: (chunk, controller) => {
              limit.touch();
              controller.enqueue(chunk);
            },
          }),
        );
        for await (const frame of sseFrames(watched)) {
          const data = jsonOrNull(frame.data);
          if (frame.event === Q_INTERVIEW_STREAM_EVENTS.SENTENCE) {
            const sentence = QInterviewSentenceSchema.safeParse(data);
            if (sentence.success) onSentence(sentence.data.text);
          } else if (frame.event === Q_INTERVIEW_STREAM_EVENTS.STAGE) {
            const stage = QInterviewStageSchema.safeParse(data);
            if (stage.success) onStage?.(stage.data);
          } else if (frame.event === Q_INTERVIEW_STREAM_EVENTS.RESULT) {
            result = parsedTurn(data);
          } else if (frame.event === Q_INTERVIEW_STREAM_EVENTS.PROBLEM) {
            if (pausedRefusal(data)) throw new QAccountPausedError();
            throw new QInterviewUnavailableError(
              "the interviewer could not finish the turn",
            );
          }
        }
        if (result === null) {
          throw new QInterviewUnavailableError(
            "the interviewer's stream ended without a turn",
          );
        }
        return result;
      } catch (error) {
        if (
          error instanceof QAccountPausedError ||
          error instanceof QInterviewUnavailableError
        ) {
          throw error;
        }
        throw new QInterviewUnavailableError(
          error instanceof Error ? error.message : "the stream failed",
        );
      } finally {
        limit.clear();
      }
    },
  };
}

function pausedRefusal(refusal: unknown): boolean {
  return (
    typeof refusal === "object" &&
    refusal !== null &&
    "paused" in refusal &&
    refusal.paused === true
  );
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parsedTurn(body: unknown): QInterviewTurnResponse {
  const parsed = QInterviewTurnResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new QInterviewUnavailableError(
      "the interviewer answered in a shape this service does not accept",
    );
  }
  return parsed.data;
}
