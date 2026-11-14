import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { IntakeRefusedError } from "../src/contracts/index.js";
import {
  createGateqVoiceInterview,
  dialBackBearer,
  effectiveVoiceSeconds,
  GATEQ_VOICE_DEFAULTS,
  gateqVoiceConfigFrom,
  GateqVoiceRefusedError,
  type GateqVoiceConfig,
  type GateqVoiceSessionRow,
  type GateqVoiceSessionStore,
} from "../src/voice/voice-interview.js";

const APP = "00000000-0000-4000-8000-0000000000a1";
const OTHER_APP = "00000000-0000-4000-8000-0000000000a2";
const TENANT = "00000000-0000-4000-8000-0000000000b1";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000b2";
const TOKEN = "gqs_applicant_token_000000000000001";
const OTHER_TOKEN = "gqs_applicant_token_000000000000002";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

/** As the Postgres store: every read keyed by application AND tenant. */
function memoryStore(clock: () => number) {
  const rows: GateqVoiceSessionRow[] = [];
  const live = (r: GateqVoiceSessionRow) =>
    r.status === "LIVE" && Date.parse(r.endsAt) > clock();
  const mine =
    (input: { applicationId: string; tenantId: string }) =>
    (r: GateqVoiceSessionRow) =>
      r.applicationId === input.applicationId && r.tenantId === input.tenantId;
  const reserved: Parameters<GateqVoiceSessionStore["reserve"]>[0][] = [];
  const store: GateqVoiceSessionStore = {
    reserve: (input) => {
      reserved.push(input);
      const i = rows.findIndex((r) => mine(input)(r) && live(r));
      const open = rows[i];
      if (open !== undefined) {
        rows[i] = { ...open, bridgeTokenHash: input.bridgeTokenHash };
        return Promise.resolve({
          kind: "EXISTING" as const,
          row: rows[i] ?? open,
        });
      }
      const used = rows.filter(
        (r) => mine(input)(r) && r.endedReason !== "PROVIDER_FAILED",
      ).length;
      if (used >= input.perApplication)
        return Promise.resolve({ kind: "ALLOWANCE" as const });
      if (rows.filter(live).length >= input.concurrency)
        return Promise.resolve({ kind: "CONCURRENCY" as const });
      const row: GateqVoiceSessionRow = {
        id: input.id,
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        status: "LIVE",
        endedReason: null,
        guestCredentialSealed: input.guestCredentialSealed,
        bridgeTokenHash: input.bridgeTokenHash,
        maxSeconds: input.maxSeconds,
        createdAt: new Date(clock()).toISOString(),
        endsAt: new Date(clock() + input.maxSeconds * 1000).toISOString(),
      };
      rows.push(row);
      return Promise.resolve({ kind: "CREATED" as const, row });
    },
    end: (input) => {
      const i = rows.findIndex((r) => r.id === input.id);
      const row = rows[i];
      if (row === undefined) return Promise.resolve(null);
      if (row.status !== "ENDED")
        rows[i] = { ...row, status: "ENDED", endedReason: input.reason };
      return Promise.resolve(rows[i] ?? null);
    },
    openForApplication: (input) =>
      Promise.resolve(rows.find((r) => mine(input)(r) && live(r)) ?? null),
    countForApplication: (input) =>
      Promise.resolve(
        rows.filter(
          (r) => mine(input)(r) && r.endedReason !== "PROVIDER_FAILED",
        ).length,
      ),
    byBridgeTokenHash: (hash) =>
      Promise.resolve(rows.find((r) => r.bridgeTokenHash === hash) ?? null),
    expired: () =>
      Promise.resolve(
        rows.filter(
          (r) => r.status === "LIVE" && Date.parse(r.endsAt) <= clock(),
        ),
      ),
  };
  return { store, rows, reserved };
}

function world(
  config: Partial<GateqVoiceConfig> = {},
  options: {
    provider?: "none" | "failing" | "elevenlabs" | "elevenlabs-failing";
    lineSecret?: string;
  } = {},
) {
  let now = Date.parse("2026-11-14T09:00:00Z");
  const clock = () => now;
  const { store, rows, reserved } = memoryStore(clock);
  const bearers: string[] = [];
  const issued: string[] = [];
  const dialBack = {
    kind: "DIAL_BACK" as const,
    name: "elevenlabs" as const,
    issueLine: vi.fn(() => {
      if (options.provider === "elevenlabs-failing")
        return Promise.reject(new Error("provider 503"));
      const id = `conv_${String(issued.length + 1)}`;
      issued.push(id);
      return Promise.resolve({
        providerConversationId: id,
        token: `el-webrtc-${id}`,
      });
    }),
  };
  const provider =
    options.provider === "none"
      ? null
      : options.provider === "elevenlabs" ||
          options.provider === "elevenlabs-failing"
        ? dialBack
        : {
            openLine: vi.fn(
              (input: {
                greeting: string;
                bridge: { path: string; bearer: string };
              }) => {
                if (options.provider === "failing")
                  return Promise.reject(new Error("provider 503"));
                bearers.push(input.bridge.bearer);
                return Promise.resolve({
                  provider: "deepgram" as const,
                  token: `dg-${String(bearers.length)}`,
                  agent: { greeting: input.greeting },
                });
              },
            ),
          };
  const apps: Record<string, { id: string; tenantId: string; status: string }> =
    {
      [TOKEN]: { id: APP, tenantId: TENANT, status: "IN_PROGRESS" },
      [OTHER_TOKEN]: {
        id: OTHER_APP,
        tenantId: OTHER_TENANT,
        status: "IN_PROGRESS",
      },
    };
  const intake = {
    authorise: vi.fn((token: string) => {
      const app = apps[token];
      if (app === undefined)
        return Promise.reject(new IntakeRefusedError("SESSION_INVALID"));
      return Promise.resolve({ application: app, sessionId: "s" } as never);
    }),
    assertInterviewReady: vi.fn(() => Promise.resolve()),
  };
  const conversation = {
    openingFor: vi.fn(() => Promise.resolve("What does the company do?")),
    turn: vi.fn(
      (input: {
        token: string;
        message: string;
        clientTurnId: string;
        channel?: string | undefined;
      }) => Promise.resolve({ reply: `Heard: ${input.message}` } as never),
    ),
  };
  const voice = createGateqVoiceInterview({
    config: { ...GATEQ_VOICE_DEFAULTS, enabled: true, ...config },
    store,
    provider,
    sealer: { seal: (p) => `sealed:${p}`, open: (s) => s.slice(7) },
    intake,
    conversation,
    bridgePath: "/v1/gateq/voice/bridge",
    lineSecret:
      options.lineSecret ?? "line-secret-for-tests-000000000000000000",
    now: clock,
  });
  return {
    voice,
    rows,
    reserved,
    issued,
    dialBack,
    bearers,
    provider,
    conversation,
    apps,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("configuration", () => {
  it("defaults: off, 15 minutes, three per application, four at once, 180 s paid cap", () => {
    const config = gateqVoiceConfigFrom({});
    expect(config).toEqual(GATEQ_VOICE_DEFAULTS);
    expect(effectiveVoiceSeconds(config)).toBe(180);
  });
  it("reads each limit and keeps safe defaults for malformed values", () => {
    expect(
      gateqVoiceConfigFrom({
        CQ_GATEQ_VOICE_INTERVIEW: "1",
        CQ_GATEQ_VOICE_MAX_SECONDS: "120",
        CQ_GATEQ_VOICE_PAID_RUN_CAP_SECONDS: "x",
        CQ_GATEQ_VOICE_PER_APPLICATION: "2",
        CQ_GATEQ_VOICE_CONCURRENCY: "-1",
      }),
    ).toEqual({
      enabled: true,
      maxSeconds: 120,
      paidRunCapSeconds: 180,
      perApplication: 2,
      concurrency: 4,
    });
  });
});

describe("the guest credential binds the session to one application", () => {
  it("a forged credential is refused before anything else, even when voice is off", async () => {
    for (const w of [world(), world({ enabled: false })]) {
      await expect(w.voice.availability("forged")).rejects.toBeInstanceOf(
        IntakeRefusedError,
      );
      await expect(
        w.voice.start({ token: "forged", correlationId: "c" }),
      ).rejects.toBeInstanceOf(IntakeRefusedError);
    }
  });

  it("another application's credential neither sees nor ends this one's session, and its line is its own", async () => {
    const w = world();
    const mine = await w.voice.start({ token: TOKEN, correlationId: "c" });
    expect(await w.voice.current(OTHER_TOKEN)).toBeNull();
    expect(
      await w.voice.end({ token: OTHER_TOKEN, continueByTyping: true }),
    ).toBeNull();
    expect((await w.voice.current(TOKEN))?.id).toBe(mine.session.id);
    // The bridge acts only with the sealed credential of the line's own
    // application, never the other one's.
    await w.voice.bridgeTurn({
      bearer: w.bearers[0] ?? "",
      utterance: "We sell to banks.",
      utteranceId: "user-1",
      correlationId: "c",
    });
    expect(w.conversation.turn).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN, channel: "voice" }),
    );
  });

  it("a session row under another tenant is invisible to an application of the same id", async () => {
    const w = world();
    await w.voice.start({ token: TOKEN, correlationId: "c" });
    // The same application id presented under another tenant.
    w.apps[OTHER_TOKEN] = {
      id: APP,
      tenantId: OTHER_TENANT,
      status: "IN_PROGRESS",
    };
    expect(await w.voice.current(OTHER_TOKEN)).toBeNull();
    expect(
      await w.voice.end({ token: OTHER_TOKEN, continueByTyping: false }),
    ).toBeNull();
  });

  it("an unknown or short bearer is no line", async () => {
    const w = world();
    await w.voice.start({ token: TOKEN, correlationId: "c" });
    expect(await w.voice.knowsLine("short")).toBe(false);
    expect(await w.voice.knowsLine("x".repeat(43))).toBe(false);
    expect(await w.voice.knowsLine(w.bearers[0] ?? "")).toBe(true);
    expect(
      await w.voice.bridgeTurn({
        bearer: "x".repeat(43),
        utterance: "hi",
        utteranceId: "user-1",
        correlationId: "c",
      }),
    ).toEqual({ kind: "UNKNOWN_SESSION" });
    expect(w.conversation.turn).not.toHaveBeenCalled();
  });
});

describe("allowance and gating", () => {
  it("not offered when switched off or without a provider; start refuses as DISABLED", async () => {
    for (const w of [
      world({ enabled: false }),
      world({}, { provider: "none" }),
    ]) {
      expect(await w.voice.availability(TOKEN)).toEqual({
        available: false,
        reason: "NOT_OFFERED",
        remaining: 0,
      });
      await expect(
        w.voice.start({ token: TOKEN, correlationId: "c" }),
      ).rejects.toEqual(new GateqVoiceRefusedError("DISABLED"));
    }
  });

  it("a submitted application is not offered voice", async () => {
    const w = world();
    w.apps[TOKEN] = { id: APP, tenantId: TENANT, status: "SUBMITTED" };
    expect((await w.voice.availability(TOKEN)).reason).toBe("SUBMITTED");
    await expect(
      w.voice.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toBeInstanceOf(IntakeRefusedError);
  });

  it("each session spends the per-application allowance; when used up the offer says so and start refuses", async () => {
    const w = world({ perApplication: 2 });
    expect((await w.voice.availability(TOKEN)).remaining).toBe(2);
    await w.voice.start({ token: TOKEN, correlationId: "c" });
    await w.voice.end({ token: TOKEN, continueByTyping: true });
    await w.voice.start({ token: TOKEN, correlationId: "c" });
    // An open session can still be rejoined while the allowance is spent.
    expect((await w.voice.availability(TOKEN)).available).toBe(true);
    await w.voice.end({ token: TOKEN, continueByTyping: true });
    expect(await w.voice.availability(TOKEN)).toEqual({
      available: false,
      reason: "APPLICATION_SESSIONS_USED",
      remaining: 0,
    });
    await expect(
      w.voice.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toEqual(new GateqVoiceRefusedError("ALLOWANCE_EXHAUSTED"));
  });

  it("the concurrency cap refuses a new line across applications", async () => {
    const w = world({ concurrency: 1 });
    await w.voice.start({ token: TOKEN, correlationId: "c" });
    await expect(
      w.voice.start({ token: OTHER_TOKEN, correlationId: "c" }),
    ).rejects.toEqual(new GateqVoiceRefusedError("CONCURRENCY_LIMIT"));
  });

  it("the session lasts the paid-run cap and the bridge refuses every line after it", async () => {
    const w = world({ maxSeconds: 900, paidRunCapSeconds: 180 });
    const opened = await w.voice.start({ token: TOKEN, correlationId: "c" });
    expect(opened.session.maxSeconds).toBe(180);
    w.advance(181_000);
    expect(
      await w.voice.bridgeTurn({
        bearer: w.bearers[0] ?? "",
        utterance: "Still here",
        utteranceId: "user-1",
        correlationId: "c",
      }),
    ).toEqual({ kind: "CLOSED" });
    expect(w.conversation.turn).not.toHaveBeenCalled();
    expect(await w.voice.sweep()).toEqual({ ended: 1, failed: 0 });
    expect(w.rows[0]?.endedReason).toBe("TIME_LIMIT");
  });
});

describe("lines, reconnects and failure", () => {
  it("a reconnect returns the same session and clock with a new bearer; the old bearer stops working", async () => {
    const w = world();
    const first = await w.voice.start({ token: TOKEN, correlationId: "c" });
    w.advance(30_000);
    const second = await w.voice.start({ token: TOKEN, correlationId: "c" });
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.endsAt).toBe(first.session.endsAt);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]?.bridgeTokenHash).toBe(sha(w.bearers[1] ?? ""));
    expect(await w.voice.knowsLine(w.bearers[0] ?? "")).toBe(false);
  });

  it("a redelivered line is the same turn; the same index on a new line is a new turn", async () => {
    const w = world();
    await w.voice.start({ token: TOKEN, correlationId: "c" });
    const say = (bearer: string) =>
      w.voice.bridgeTurn({
        bearer,
        utterance: "We have 40 customers.",
        utteranceId: "user-1",
        correlationId: "c",
      });
    await say(w.bearers[0] ?? "");
    await say(w.bearers[0] ?? "");
    await w.voice.start({ token: TOKEN, correlationId: "c" });
    await say(w.bearers[1] ?? "");
    const ids = w.conversation.turn.mock.calls.map((c) => c[0].clientTurnId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids.every((id) => id.startsWith("voice-"))).toBe(true);
  });

  it("a provider failure refuses honestly, closes the row and does not spend the allowance", async () => {
    const w = world({ perApplication: 1 }, { provider: "failing" });
    await expect(
      w.voice.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toEqual(new GateqVoiceRefusedError("PROVIDER_UNAVAILABLE"));
    expect(w.rows[0]?.endedReason).toBe("PROVIDER_FAILED");
    expect(await w.voice.availability(TOKEN)).toMatchObject({
      available: true,
      remaining: 1,
    });
  });

  it("an empty line is no turn; the guest credential never reaches the provider", async () => {
    const w = world();
    await w.voice.start({ token: TOKEN, correlationId: "c" });
    expect(
      await w.voice.bridgeTurn({
        bearer: w.bearers[0] ?? "",
        utterance: "   ",
        utteranceId: "user-1",
        correlationId: "c",
      }),
    ).toEqual({ kind: "REPLY", reply: "" });
    expect(w.conversation.turn).not.toHaveBeenCalled();
    expect(
      JSON.stringify(
        w.provider !== null && "openLine" in w.provider
          ? w.provider.openLine.mock.calls
          : [],
      ),
    ).not.toContain(TOKEN);
  });
});

describe("ElevenLabs (dial-back): Q's own voice, the canonical interviewer", () => {
  it("issues a one-conversation token, records ELEVENLABS, and hands back Q's server-composed opening", async () => {
    const w = world({}, { provider: "elevenlabs" });
    const opened = await w.voice.start({ token: TOKEN, correlationId: "c1" });
    expect(opened.line).toEqual({
      provider: "elevenlabs",
      token: "el-webrtc-conv_1",
      firstMessage: "What does the company do?",
    });
    // The bearer is derived, never handed out, and never the guest credential.
    expect(JSON.stringify(opened)).not.toContain(TOKEN);
    expect(JSON.stringify(w.dialBack.issueLine.mock.calls)).not.toContain(
      TOKEN,
    );
    expect(w.rows[0]?.bridgeTokenHash).toBe(
      sha(dialBackBearer("line-secret-for-tests-000000000000000000", "conv_1")),
    );
    expect(w.reserved[0]?.provider).toBe("ELEVENLABS");
  });

  it("each heard line is the same canonical turn, channel voice, under the applicant's own credential", async () => {
    const w = world({}, { provider: "elevenlabs" });
    await w.voice.start({ token: TOKEN, correlationId: "c1" });
    expect(await w.voice.dialBackOpened("conv_1")).toBe(true);
    const first = await w.voice.dialBackTurn({
      providerConversationId: "conv_1",
      utterance: "We sell payroll software to clinics.",
      utteranceIndex: 1,
      correlationId: "c2",
    });
    expect(first).toEqual({
      kind: "REPLY",
      reply: "Heard: We sell payroll software to clinics.",
    });
    const call = w.conversation.turn.mock.calls[0]?.[0];
    expect(call?.token).toBe(TOKEN);
    expect(call?.channel).toBe("voice");
    // A re-sent transcript names the same line: the same turn id.
    await w.voice.dialBackTurn({
      providerConversationId: "conv_1",
      utterance: "We sell payroll software to clinics.",
      utteranceIndex: 1,
      correlationId: "c3",
    });
    expect(w.conversation.turn.mock.calls[1]?.[0].clientTurnId).toBe(
      call?.clientTurnId,
    );
  });

  it("another application's conversation reaches only its own application; an unknown one reaches nothing", async () => {
    const w = world({}, { provider: "elevenlabs" });
    await w.voice.start({ token: TOKEN, correlationId: "c1" });
    await w.voice.start({ token: OTHER_TOKEN, correlationId: "c2" });
    await w.voice.dialBackTurn({
      providerConversationId: "conv_2",
      utterance: "Our own line.",
      utteranceIndex: 1,
      correlationId: "c3",
    });
    expect(w.conversation.turn.mock.calls[0]?.[0].token).toBe(OTHER_TOKEN);
    for (const id of ["conv_9", "", "../conv_1", "x".repeat(200)]) {
      expect(await w.voice.dialBackOpened(id)).toBe(false);
      expect(
        await w.voice.dialBackTurn({
          providerConversationId: id,
          utterance: "hello",
          utteranceIndex: 1,
          correlationId: "c4",
        }),
      ).toEqual({ kind: "UNKNOWN_SESSION" });
    }
    expect(w.conversation.turn).toHaveBeenCalledTimes(1);
  });

  it("another server secret derives no line: a conversation id alone is not a credential", async () => {
    const w = world({}, { provider: "elevenlabs", lineSecret: "a".repeat(40) });
    await w.voice.start({ token: TOKEN, correlationId: "c1" });
    expect(
      await w.voice.bridgeTurn({
        bearer: dialBackBearer("b".repeat(40), "conv_1"),
        utterance: "hi",
        utteranceId: "1",
        correlationId: "c2",
      }),
    ).toEqual({ kind: "UNKNOWN_SESSION" });
  });

  it("is not offered without a line secret; a provider failure spends no allowance", async () => {
    const unset = world({}, { provider: "elevenlabs", lineSecret: "short" });
    expect((await unset.voice.availability(TOKEN)).reason).toBe("NOT_OFFERED");
    const failing = world({}, { provider: "elevenlabs-failing" });
    await expect(
      failing.voice.start({ token: TOKEN, correlationId: "c1" }),
    ).rejects.toMatchObject({ reason: "PROVIDER_UNAVAILABLE" });
    expect(failing.rows).toHaveLength(0);
    expect((await failing.voice.availability(TOKEN)).remaining).toBe(3);
  });

  it("past the end the dial-back line is closed and no further turn is taken", async () => {
    const w = world({}, { provider: "elevenlabs" });
    await w.voice.start({ token: TOKEN, correlationId: "c1" });
    await w.voice.dialBackTurn({
      providerConversationId: "conv_1",
      utterance: "Spoken line.",
      utteranceIndex: 1,
      correlationId: "c2",
    });
    w.advance(181_000);
    expect(await w.voice.dialBackOpened("conv_1")).toBe(false);
    expect(
      await w.voice.dialBackTurn({
        providerConversationId: "conv_1",
        utterance: "Too late.",
        utteranceIndex: 2,
        correlationId: "c3",
      }),
    ).toEqual({ kind: "CLOSED" });
    expect(w.conversation.turn).toHaveBeenCalledTimes(1);
  });

  it("a reconnect is a new conversation on the same session and clock; the old conversation stops", async () => {
    const w = world({}, { provider: "elevenlabs" });
    const first = await w.voice.start({ token: TOKEN, correlationId: "c1" });
    const again = await w.voice.start({ token: TOKEN, correlationId: "c2" });
    expect(again.session.id).toBe(first.session.id);
    expect(again.session.endsAt).toBe(first.session.endsAt);
    expect(await w.voice.dialBackOpened("conv_1")).toBe(false);
    expect(await w.voice.dialBackOpened("conv_2")).toBe(true);
  });
});
