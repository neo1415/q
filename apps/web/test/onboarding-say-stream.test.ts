import { describe, expect, it } from "vitest";

import { OnboardingClientError } from "../src/features/onboarding-kit/client";
import { sayStreamed } from "../src/features/onboarding-kit/say-stream";

/**
 * Turn latency L9: a typed onboarding turn shows Q's reply a sentence at a
 * time. A stream that never opened leaves the turn to the server action; a
 * stream that opened is never sent again (a second send is a second turn).
 */

const REQUEST = {
  sessionId: "5f1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f70",
  text: "We sell to clinics in Lagos.",
  expectedSessionVersion: 3,
  idempotencyKey: "6a1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f71",
  recentTurns: [],
};

const VIEW = { not: "checked here" };

function sse(frames: readonly string[], chunked = false): Response {
  const encoder = new TextEncoder();
  const text = frames.join("");
  const parts = chunked ? (text.match(/[\s\S]{1,7}/gu) ?? []) : [text];
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

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("a streamed typed onboarding turn", () => {
  it("hears each sentence before the turn ends, in order, across chunk boundaries", async () => {
    const said: string[] = [];
    const result = {
      view: VIEW,
      understood: null,
      reply: "Clinics in Lagos, noted. Who pays?",
      navigate: null,
      researching: null,
      degraded: false,
      askingAbout: [],
      pending: { recommendations: [], held: [] },
    };
    const outcome = await sayStreamed(
      REQUEST,
      (text) => said.push(text),
      () =>
        Promise.resolve(
          sse(
            [
              frame("sentence", { text: "Clinics in Lagos, noted." }),
              frame("sentence", { text: "Who pays?" }),
              frame("result", result),
            ],
            true,
          ),
        ),
    ).catch((error: unknown) => error);
    expect(said).toEqual(["Clinics in Lagos, noted.", "Who pays?"]);
    // The result must be the API's own shape (this view is a placeholder):
    // one that is not is refused, never guessed at.
    expect(outcome).toBeInstanceOf(OnboardingClientError);
    expect(outcome).toMatchObject({ kind: "UNAVAILABLE" });
  });

  it("shows each stage as the turn reports it, before any sentence (owner 2026-10-21)", async () => {
    const seen: string[] = [];
    await sayStreamed(
      REQUEST,
      (text) => seen.push(`sentence:${text}`),
      () =>
        Promise.resolve(
          sse([
            frame("stage", {
              stage: "READING",
              label: "Reading what you said",
            }),
            frame("stage", { stage: "SAVING", label: "Saving your answers" }),
            frame("stage", { stage: "BOGUS", label: "never shown" }),
            frame("sentence", { text: "Clinics in Lagos, noted." }),
            frame("problem", { status: 503 }),
          ]),
        ),
      (stage) => seen.push(`stage:${stage.label}`),
    ).catch(() => undefined);
    expect(seen).toEqual([
      "stage:Reading what you said",
      "stage:Saving your answers",
      "sentence:Clinics in Lagos, noted.",
    ]);
  });

  it("a stream that never opened returns null: the server action asks instead", async () => {
    const offline = await sayStreamed(
      REQUEST,
      () => undefined,
      () => Promise.reject(new Error("offline")),
    );
    expect(offline).toBeNull();
    const noRoute = await sayStreamed(
      REQUEST,
      () => undefined,
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "not composed" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    expect(noRoute).toBeNull();
  });

  it("an API refusal is worded as the server action words it, and not retried", async () => {
    const conflict = sayStreamed(
      REQUEST,
      () => undefined,
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ code: "VERSION_CONFLICT", status: 409 }),
            {
              status: 409,
              headers: { "content-type": "application/problem+json" },
            },
          ),
        ),
    );
    await expect(conflict).rejects.toMatchObject({ kind: "CONFLICT" });
  });

  it("a stream that opened and dropped is an error, never a second send", async () => {
    let sends = 0;
    const dropped = sayStreamed(
      REQUEST,
      () => undefined,
      () => {
        sends += 1;
        return Promise.resolve(
          sse([frame("sentence", { text: "Clinics in Lagos, noted." })]),
        );
      },
    );
    await expect(dropped).rejects.toMatchObject({ kind: "NETWORK" });
    expect(sends).toBe(1);
  });

  it("a problem after the first sentence ends the turn as failed", async () => {
    const failed = sayStreamed(
      REQUEST,
      () => undefined,
      () =>
        Promise.resolve(
          sse([
            frame("sentence", { text: "One moment." }),
            frame("problem", { code: "PROVIDER_UNAVAILABLE", status: 503 }),
          ]),
        ),
    );
    await expect(failed).rejects.toBeInstanceOf(OnboardingClientError);
  });
});
