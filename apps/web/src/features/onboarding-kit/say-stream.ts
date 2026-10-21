import {
  QInterviewStreamEventSchema,
  SayOnboardingResponseSchema,
  type QInterviewStreamEvent,
  type SayOnboardingResponse,
} from "@capital-q/contracts";

import { OnboardingClientError } from "./client";

/**
 * One typed onboarding turn through /api/onboarding-say (onboarding speed
 * 2026-10-20, L9): Q's sentences arrive as they are written, then the
 * settled turn, which is returned in the shape the whole-turn path gives.
 *
 * The settled reply is the one kept and shown in the end: the reply guards
 * may still change what was streamed. A stream that ends without its
 * settled turn is a failure, never a half-reply presented as whole.
 */
export async function sayStreaming(
  input: {
    readonly sessionId: string;
    readonly text: string;
    readonly recentTurns: readonly {
      readonly role: "person" | "q";
      readonly text: string;
    }[];
    readonly focus?: string | undefined;
  },
  onSentence: (sentence: string) => void,
  doFetch: typeof fetch = fetch,
): Promise<SayOnboardingResponse> {
  let response: Response;
  try {
    response = await doFetch("/api/onboarding-say", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        onboardingSessionId: input.sessionId,
        utterance: input.text,
        recentTurns: input.recentTurns.slice(-16),
        ...(input.focus === undefined ? {} : { focus: input.focus }),
      }),
    });
  } catch {
    throw new OnboardingClientError(
      "NETWORK",
      "Couldn't reach Capital Q. Try again.",
    );
  }
  if (!response.ok || response.body === null) {
    const message = await response
      .json()
      .then((body: unknown) =>
        typeof body === "object" &&
        body !== null &&
        typeof Reflect.get(body, "message") === "string"
          ? String(Reflect.get(body, "message"))
          : null,
      )
      .catch(() => null);
    throw new OnboardingClientError(
      response.status === 401 || response.status === 403
        ? "REJECTED"
        : "NETWORK",
      message ?? "Q couldn't answer that just now. Try again.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let settled: SayOnboardingResponse | null = null;
  const handle = (event: QInterviewStreamEvent) => {
    if (event.type === "sentence") {
      onSentence(event.text);
      return;
    }
    if (event.type === "error") {
      throw new OnboardingClientError(
        event.code === "PAUSED" ? "REJECTED" : "NETWORK",
        event.message,
      );
    }
    const turn = event.turn;
    settled = SayOnboardingResponseSchema.parse({
      view: event.view,
      understood: null,
      reply: turn.reply,
      navigate: turn.navigate,
      researching: turn.researching,
      degraded: turn.degraded,
      askingAbout: turn.askingAbout,
      pending: turn.pending,
      ...(turn.conduct === undefined ? {} : { conduct: turn.conduct }),
      ...(turn.gestures === undefined ? {} : { gestures: turn.gestures }),
    });
  };
  const lineOf = (line: string) => {
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const event = QInterviewStreamEventSchema.safeParse(parsed);
    if (event.success) handle(event.data);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        lineOf(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
    }
    lineOf(buffered + decoder.decode());
  } catch (error: unknown) {
    if (error instanceof OnboardingClientError) throw error;
    throw new OnboardingClientError(
      "NETWORK",
      "The connection to Q dropped. Try again.",
    );
  }
  if (settled === null) {
    throw new OnboardingClientError(
      "NETWORK",
      "The connection to Q dropped. Try again.",
    );
  }
  return settled;
}
