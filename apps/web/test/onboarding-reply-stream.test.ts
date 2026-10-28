import { beforeAll, describe, expect, it, vi } from "vitest";

import type {
  OnboardingInterviewTurn,
  SayOnboardingResponse,
} from "@capital-q/contracts";

import { createFixtureRuntimePort } from "../src/features/founder-onboarding/adapters/fixture-port";
import { OnboardingClientError } from "../src/features/onboarding-kit/client";
import {
  appendReplySentence,
  replyStreamText,
  settledReplyFromThread,
} from "../src/features/onboarding-kit/reply-stream-state";
import { sayStreamed } from "../src/features/onboarding-kit/say-stream";

/**
 * Live typed run 2026-10-28, D2: on four of twelve founder turns the
 * streamed reply printed its first sentence twice and the composer stayed
 * closed for 20-100 s, though the thread held Q's turn within seconds.
 * The stream is idempotent, and a turn settles by any route: the result
 * event, the thread once the stream goes quiet, or an error.
 */

const REQUEST = {
  sessionId: "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70",
  text: "We're Ajali Health, a telemedicine app for nurses in Kenya.",
  expectedSessionVersion: 3,
  idempotencyKey: "6a1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f71",
  recentTurns: [],
};

/** The turn as the thread settles it: a real session view, Q's reply. */
let SETTLED: SayOnboardingResponse;
beforeAll(async () => {
  const port = createFixtureRuntimePort({ storage: null, seed: "reset" });
  SETTLED = {
    view: await port.start("00000000-0000-4000-8000-000000000011"),
    understood: null,
    reply: "Got it, I've saved the website and Kenya. What stage are you at?",
    navigate: null,
    researching: null,
    degraded: false,
    askingAbout: [],
    pending: { recommendations: [], held: [] },
  };
});

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A stream that writes what it is told to, when it is told to. */
function openStream(): {
  readonly response: Response;
  readonly write: (text: string) => void;
  readonly close: () => void;
  readonly cancelled: () => boolean;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    // A server writing after the browser let go: the bytes go nowhere.
    write: (text) => {
      try {
        controller?.enqueue(encoder.encode(text));
      } catch {
        /* cancelled */
      }
    },
    close: () => {
      try {
        controller?.close();
      } catch {
        /* cancelled */
      }
    },
    cancelled: () => cancelled,
  };
}

const turn = (
  role: "PERSON" | "Q",
  text: string,
  createdAt = "2026-10-28T10:00:00.000Z",
): OnboardingInterviewTurn => ({ role, text, channel: "TEXT", createdAt });

describe("the streamed reply is idempotent", () => {
  it("drops a sentence that is already on screen (a replay from the start)", () => {
    let shown = appendReplySentence(null, "Got it, I've saved the website.");
    shown = appendReplySentence(shown, "And Kenya as the country.");
    // The stream starts over: both sentences come again.
    shown = appendReplySentence(shown, "Got it, I've saved the website. ");
    shown = appendReplySentence(shown, "And Kenya as the country.");
    shown = appendReplySentence(shown, "What stage are you at?");
    expect(shown).toEqual([
      "Got it, I've saved the website.",
      "And Kenya as the country.",
      "What stage are you at?",
    ]);
    expect(replyStreamText(shown)).toBe(
      "Got it, I've saved the website. And Kenya as the country. What stage are you at?",
    );
  });

  it("ignores empty sentences and starts from nothing", () => {
    expect(appendReplySentence(null, "   ")).toBeNull();
    expect(replyStreamText(null)).toBe("");
  });
});

describe("settling a turn from the thread", () => {
  it("reads Q's lines after the person's latest matching line", () => {
    const turns = [
      turn("Q", "What's your company called?"),
      turn("PERSON", "skip that"),
      turn("Q", "No problem. How many people work there?"),
      turn("PERSON", "skip that"),
      turn("Q", "We'll leave that open."),
      turn("Q", "Are the founders full-time?"),
    ];
    expect(settledReplyFromThread(turns, "skip that")).toBe(
      "We'll leave that open. Are the founders full-time?",
    );
  });

  it("is null while the thread does not yet answer", () => {
    expect(
      settledReplyFromThread([turn("PERSON", "skip that")], "skip that"),
    ).toBeNull();
    expect(
      settledReplyFromThread([turn("Q", "Hello.")], "never said"),
    ).toBeNull();
    expect(settledReplyFromThread([], "")).toBeNull();
  });
});

describe("a streamed turn whose done event never comes", () => {
  it("settles from the thread after the stall, and the stream is let go", async () => {
    const stream = openStream();
    const said: string[] = [];
    const onStall = vi.fn(() => Promise.resolve(SETTLED));
    const pending = sayStreamed(
      REQUEST,
      (text) => said.push(text),
      () => Promise.resolve(stream.response),
      undefined,
      { onStall, stallMs: 30, maxMs: 5_000 },
    );
    stream.write(
      frame("sentence", { text: "Got it, I've saved the website." }),
    );
    // Heartbeats keep the connection open; they are not events.
    stream.write(": ping\n\n");
    const outcome = await pending;
    expect(outcome).toEqual(SETTLED);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(said).toEqual(["Got it, I've saved the website."]);
    expect(stream.cancelled()).toBe(true);
  });

  it("keeps waiting while the thread has no answer yet, then takes the result", async () => {
    const stream = openStream();
    const onStall = vi.fn(() => Promise.resolve(null));
    const pending = sayStreamed(
      REQUEST,
      () => undefined,
      () => Promise.resolve(stream.response),
      undefined,
      { onStall, stallMs: 20, maxMs: 5_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(onStall.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The result arrives late but by the stream: it is the turn.
    stream.write(frame("result", SETTLED));
    stream.close();
    const outcome = await pending;
    expect(outcome?.reply).toBe(SETTLED.reply);
    expect(outcome?.view.session.id).toBe(SETTLED.view.session.id);
  });

  it("a late done after the poll settled changes nothing", async () => {
    const stream = openStream();
    const pending = sayStreamed(
      REQUEST,
      () => undefined,
      () => Promise.resolve(stream.response),
      undefined,
      { onStall: () => Promise.resolve(SETTLED), stallMs: 20, maxMs: 5_000 },
    );
    const outcome = await pending;
    // The server finishes afterwards; nothing is listening and nothing throws.
    stream.write(frame("result", { ...SETTLED, reply: "late" }));
    stream.close();
    expect(outcome).toEqual(SETTLED);
  });

  it("gives up with a plain word after the hard bound, so the composer opens", async () => {
    const stream = openStream();
    const outcome = await sayStreamed(
      REQUEST,
      () => undefined,
      () => Promise.resolve(stream.response),
      undefined,
      { onStall: () => Promise.resolve(null), stallMs: 10, maxMs: 60 },
    ).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(OnboardingClientError);
    expect(outcome).toMatchObject({
      kind: "NETWORK",
      message: expect.stringContaining("taking longer than usual") as string,
    });
  });
});
