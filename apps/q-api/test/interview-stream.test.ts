import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  openSentenceStream,
  wantsStream,
} from "../src/voice/interview-route.js";

/**
 * Turn latency L9: the typed interview turn, streamed. Sentences go out as
 * they are written, the whole turn ends the stream, and a turn that fails
 * before its first sentence still gets the route's ordinary error reply.
 */

function app(script: (stream: ReturnType<typeof openSentenceStream>) => void) {
  const server = Fastify();
  server.post("/turn", async (_request, reply) => {
    const stream = openSentenceStream(reply);
    script(stream);
    if (!stream.started()) {
      return reply.status(503).send({ code: "PROVIDER_UNAVAILABLE" });
    }
    return reply;
  });
  return server;
}

describe("the streamed interview turn", () => {
  it("is asked for with Accept: text/event-stream", () => {
    expect(wantsStream("text/event-stream")).toBe(true);
    expect(wantsStream("application/json, text/event-stream")).toBe(true);
    expect(wantsStream("application/json")).toBe(false);
    expect(wantsStream(undefined)).toBe(false);
  });

  it("sends each sentence, then the turn, as SSE frames in order", async () => {
    const server = app((stream) => {
      stream.sentence("Clinics in Lagos, noted.");
      stream.sentence("  ");
      stream.sentence("Who pays?");
      stream.end("result", { reply: "Clinics in Lagos, noted. Who pays?" });
      stream.sentence("never after the end");
    });
    const response = await server.inject({ method: "POST", url: "/turn" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toBe(
      [
        'event: sentence\ndata: {"text":"Clinics in Lagos, noted."}\n\n',
        'event: sentence\ndata: {"text":"Who pays?"}\n\n',
        'event: result\ndata: {"reply":"Clinics in Lagos, noted. Who pays?"}\n\n',
      ].join(""),
    );
    await server.close();
  });

  it("sends each stage as it happens, before any sentence (owner 2026-10-21)", async () => {
    const server = app((stream) => {
      stream.stage({ stage: "READING", label: "Reading what you said" });
      stream.sentence("Seed, noted.");
      stream.end("result", { reply: "Seed, noted." });
      stream.stage({ stage: "WRITING", label: "never after the end" });
    });
    const response = await server.inject({ method: "POST", url: "/turn" });
    expect(response.body).toBe(
      [
        'event: stage\ndata: {"stage":"READING","label":"Reading what you said"}\n\n',
        'event: sentence\ndata: {"text":"Seed, noted."}\n\n',
        'event: result\ndata: {"reply":"Seed, noted."}\n\n',
      ].join(""),
    );
    await server.close();
  });

  it("opens nothing before the first sentence: a failure is the ordinary reply", async () => {
    const server = app(() => undefined);
    const response = await server.inject({ method: "POST", url: "/turn" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "PROVIDER_UNAVAILABLE" });
    await server.close();
  });
});
