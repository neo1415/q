import { describe, expect, it, vi } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  GateqVideoRefusedError,
  IntakeRefusedError,
  type GateqVideoInterview,
} from "@capital-q/gateq-intake";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/** Guest routes and the provider bridge need no signed-in actor. */
const NO_SECURITY: ApiSecurityDependencies = {
  authenticator: { authenticate: () => Promise.resolve(null) },
  resolver: {
    resolveHumanContext: () => Promise.resolve({ status: "CONTEXT_REQUIRED" }),
  },
  identities: { lookup: () => Promise.resolve(null) },
};

const TOKEN = "gqs_applicant_token_000000000000001";
const SESSION = {
  id: "00000000-0000-4000-8000-0000000000c1",
  status: "LIVE" as const,
  joinUrl: "https://tavus.daily.co/c1?t=x",
  endsAt: "2026-10-15T09:03:00.000Z",
  liveAt: "2026-10-15T09:00:00.000Z",
  maxSeconds: 180,
  endedReason: null,
};

function build(overrides: Partial<GateqVideoInterview> = {}) {
  const forged = () =>
    Promise.reject(new IntakeRefusedError("SESSION_INVALID"));
  const video = {
    available: vi.fn((token: string) =>
      token === TOKEN ? Promise.resolve(true) : forged(),
    ),
    current: vi.fn((token: string) =>
      token === TOKEN ? Promise.resolve(SESSION) : forged(),
    ),
    allowance: vi.fn((token: string) =>
      token === TOKEN
        ? Promise.resolve({
            weeklySessions: 5,
            remaining: 3,
            resetsAt: "2026-10-19T00:00:00.000Z",
          })
        : forged(),
    ),
    start: vi.fn((input: { token: string }) =>
      input.token === TOKEN ? Promise.resolve(SESSION) : forged(),
    ),
    end: vi.fn(() =>
      Promise.resolve({
        ...SESSION,
        status: "ENDED" as const,
        joinUrl: null,
        endedReason: "CONTINUED_BY_TYPING" as const,
      }),
    ),
    bridgeTurn: vi.fn((input: { bearer: string; utterance: string }) =>
      Promise.resolve(
        input.bearer === "b".repeat(43)
          ? { kind: "REPLY" as const, reply: `Heard ${input.utterance}` }
          : { kind: "UNKNOWN_SESSION" as const },
      ),
    ),
    providerEvent: vi.fn((input: { token: string }) =>
      Promise.resolve(
        input.token === "e".repeat(43)
          ? { kind: "ACCEPTED" as const, liveAt: SESSION.liveAt }
          : { kind: "UNKNOWN_SESSION" as const },
      ),
    ),
    sweep: vi.fn(),
    ...overrides,
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), NO_SECURITY, {
    gateqVideo: { video },
  });
  return { app, video };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("the provider's room events", () => {
  it("passes the joined event with the path secret, and answers 204", async () => {
    const { app, video } = build();
    const response = await app.inject({
      method: "POST",
      url: `/v1/gateq/video/events/${"e".repeat(43)}`,
      payload: {
        event_type: "system.replica_joined",
        conversation_id: "c1",
        message_type: "system",
        properties: { replica_id: "r1" },
      },
    });
    expect(response.statusCode).toBe(204);
    expect(video.providerEvent).toHaveBeenCalledWith({
      token: "e".repeat(43),
      eventType: "system.replica_joined",
      conversationId: "c1",
    });
  });

  it("an unknown secret is a 404 and a body without an event is a 422", async () => {
    const { app } = build();
    const unknown = await app.inject({
      method: "POST",
      url: `/v1/gateq/video/events/${"x".repeat(43)}`,
      payload: { event_type: "system.replica_joined" },
    });
    expect(unknown.statusCode).toBe(404);
    const malformed = await app.inject({
      method: "POST",
      url: `/v1/gateq/video/events/${"e".repeat(43)}`,
      payload: { nothing: true },
    });
    expect([400, 422]).toContain(malformed.statusCode);
  });

  it("reports when the applicant's time began", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/gateq/apply/video",
      headers: auth(TOKEN),
    });
    expect(
      response.json<{ session: { liveAt: string | null } }>().session.liveAt,
    ).toBe(SESSION.liveAt);
  });
});

describe("the GateQ video interview routes", () => {
  it("reads the applicant's own session, with the AI disclosure", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/gateq/apply/video",
      headers: auth(TOKEN),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      available: true,
      session: {
        id: SESSION.id,
      },
      // The shared weekly allowance, for "3 video sessions left this week".
      allowance: { weeklySessions: 5, remaining: 3 },
    });
    expect(response.body).toMatch(/AI interviewer/);
  });

  it("still answers when the allowance cannot be read; typing is never blocked by it", async () => {
    const { app } = build({
      allowance: vi.fn(() => Promise.reject(new Error("db down"))),
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/gateq/apply/video",
      headers: auth(TOKEN),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ allowance: null });
  });

  it("a forged or missing credential is the same 404 as a missing application", async () => {
    const { app } = build();
    for (const headers of [auth("gqs_forged"), {}]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/gateq/apply/video",
        headers,
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it("a refusal (switched off, allowance, busy, provider) is a 409 that offers typing", async () => {
    const { app } = build({
      start: () => Promise.reject(new GateqVideoRefusedError("DISABLED")),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/gateq/apply/video",
      headers: auth(TOKEN),
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatch(/continue by typing/);
  });

  it("ends with the typed fallback and validates the body", async () => {
    const { app, video } = build();
    const bad = await app.inject({
      method: "POST",
      url: "/v1/gateq/apply/video/end",
      headers: auth(TOKEN),
      payload: { continueByTyping: "yes" },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/gateq/apply/video/end",
      headers: auth(TOKEN),
      payload: { continueByTyping: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(video.end).toHaveBeenCalledWith({
      token: TOKEN,
      continueByTyping: true,
    });
  });
});

describe("the provider bridge", () => {
  it("answers the last applicant line as a chat-completions stream, numbering lines stably", async () => {
    const { app, video } = build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/gateq/video/bridge/chat/completions",
      headers: auth("b".repeat(43)),
      payload: {
        model: "x",
        messages: [
          { role: "system", content: "conduct" },
          { role: "assistant", content: "Hello, I'm Q." },
          { role: "user", content: "We sell water." },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("Heard We sell water.");
    expect(response.body).toContain("data: [DONE]");
    expect(video.bridgeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        utterance: "We sell water.",
        utteranceId: "user-1",
      }),
    );
  });

  it("answers the provider's setup probe without recording it as the applicant", async () => {
    const { app, video } = build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/gateq/video/bridge/chat/completions",
      headers: auth("b".repeat(43)),
      payload: {
        messages: [
          {
            role: "user",
            content:
              "This is an automated connectivity check sent during custom LLM configuration. Confirm your streaming chat completions endpoint is working by responding with exactly: 'Custom LLM configuration test successful.'",
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      "Custom LLM configuration test successful.",
    );
    expect(video.bridgeTurn).not.toHaveBeenCalled();
  });

  it("hears the probe sentence as speech once the interview is under way", async () => {
    const { app, video } = build();
    const probe =
      "This is an automated connectivity check sent during custom LLM configuration.";
    await app.inject({
      method: "POST",
      url: "/v1/gateq/video/bridge/chat/completions",
      headers: auth("b".repeat(43)),
      payload: {
        messages: [
          { role: "user", content: "We sell water." },
          { role: "user", content: probe },
        ],
      },
    });
    expect(video.bridgeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ utterance: probe, utteranceId: "user-2" }),
    );
  });

  it("refuses a missing or unknown bearer", async () => {
    const { app } = build();
    for (const headers of [{}, auth("x".repeat(43))]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/gateq/video/bridge/chat/completions",
        headers,
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it("a failed canonical turn is spoken as a short retry, never a broken stream", async () => {
    const { app } = build({
      bridgeTurn: () => Promise.reject(new Error("model down")),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/gateq/video/bridge/chat/completions",
      headers: auth("b".repeat(43)),
      payload: { messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("say it again");
  });
});
