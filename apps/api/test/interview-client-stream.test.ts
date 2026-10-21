import { describe, expect, it } from "vitest";

import {
  createQInterviewClient,
  QAccountPausedError,
  QInterviewUnavailableError,
} from "../src/q/interview-client.js";

/**
 * Turn latency L9: the api reads the interviewer's streamed turn, passing
 * each sentence on as it arrives and resolving to the same turn the JSON
 * form returns.
 */

const REQUEST = {
  onboardingSessionId: "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70",
  journeyType: "founder" as const,
  utterance: "We sell to clinics in Lagos.",
  channel: "text" as const,
  recentTurns: [],
};

const TURN = {
  reply: "Clinics in Lagos, noted. Who pays?",
  intent: "ANSWER",
  asking: null,
  recorded: [],
  skipped: [],
  questionForQ: null,
  researching: null,
  navigate: null,
  handoff: null,
  degraded: false,
  askingAbout: [],
  pending: { recommendations: [], held: [] },
};

const frame = (event: string, data: unknown) =>
  `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;

function streamed(text: string): Response {
  const encoder = new TextEncoder();
  const parts = text.match(/[\s\S]{1,5}/gu) ?? [];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function client(response: () => Response) {
  const asked: { accept: string | null }[] = [];
  const interview = createQInterviewClient({
    baseUrl: "http://q-api.test",
    fetch: (_input, init) => {
      asked.push({
        accept: new Headers(init?.headers).get("accept"),
      });
      return Promise.resolve(response());
    },
  });
  return { interview, asked };
}

describe("the api's streamed interview turn", () => {
  it("passes each sentence on, then resolves to the whole turn", async () => {
    const said: string[] = [];
    const { interview, asked } = client(() =>
      streamed(
        frame("sentence", { text: "Clinics in Lagos, noted." }) +
          ": a comment\n\n" +
          frame("sentence", { text: "Who pays?" }) +
          frame("result", TURN),
      ),
    );
    const turn = await interview.turnStream({
      accessToken: "t",
      request: REQUEST,
      onSentence: (text) => said.push(text),
    });
    expect(asked[0]?.accept).toBe("text/event-stream");
    expect(said).toEqual(["Clinics in Lagos, noted.", "Who pays?"]);
    // Whatever the interviewer's own schema keeps, the reply is its words.
    expect(turn.reply).toBe(TURN.reply);
  });

  it("an interviewer that answers JSON is read as before", async () => {
    const { interview } = client(
      () =>
        new Response(JSON.stringify(TURN), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const turn = await interview.turnStream({
      accessToken: "t",
      request: REQUEST,
      onSentence: () => undefined,
    });
    expect(turn.reply).toBe(TURN.reply);
  });

  it("a paused account mid-stream is QAccountPausedError; any other problem is unavailable", async () => {
    const paused = client(() =>
      streamed(
        frame("sentence", { text: "One moment." }) +
          frame("problem", { code: "PERMISSION_DENIED", paused: true }),
      ),
    );
    await expect(
      paused.interview.turnStream({
        accessToken: "t",
        request: REQUEST,
        onSentence: () => undefined,
      }),
    ).rejects.toBeInstanceOf(QAccountPausedError);
    const failed = client(() => streamed(frame("problem", { code: "X" })));
    await expect(
      failed.interview.turnStream({
        accessToken: "t",
        request: REQUEST,
        onSentence: () => undefined,
      }),
    ).rejects.toBeInstanceOf(QInterviewUnavailableError);
  });

  it("a stream that ends without the turn is unavailable, never an empty answer", async () => {
    const { interview } = client(() =>
      streamed(frame("sentence", { text: "Clinics in Lagos." })),
    );
    await expect(
      interview.turnStream({
        accessToken: "t",
        request: REQUEST,
        onSentence: () => undefined,
      }),
    ).rejects.toBeInstanceOf(QInterviewUnavailableError);
  });
});
