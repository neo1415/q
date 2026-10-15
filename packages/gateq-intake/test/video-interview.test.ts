import { describe, expect, it, vi } from "vitest";

import { IntakeRefusedError } from "../src/contracts/index.js";
import {
  createGateqVideoInterview,
  effectiveMaxSeconds,
  GATEQ_VIDEO_DEFAULTS,
  gateqVideoConfigFrom,
  GateqVideoRefusedError,
  type GateqVideoConfig,
  type GateqVideoSessionRow,
  type GateqVideoSessionStore,
} from "../src/video/video-interview.js";

const APP = "00000000-0000-4000-8000-0000000000a1";
const OTHER_APP = "00000000-0000-4000-8000-0000000000a2";
const TENANT = "00000000-0000-4000-8000-0000000000b1";
const TOKEN = "gqs_applicant_token_000000000000001";
const OTHER_TOKEN = "gqs_applicant_token_000000000000002";

function memoryStore(clock: () => number): GateqVideoSessionStore & {
  rows: GateqVideoSessionRow[];
  /** Stands in for the database's shared allowance and monthly safeguard. */
  limits: { remaining: number; platformFull: boolean };
} {
  const rows: GateqVideoSessionRow[] = [];
  const limits = { remaining: 5, platformFull: false };
  const hashes = new Map<string, string>();
  const open = (r: GateqVideoSessionRow) =>
    r.status !== "ENDED" && Date.parse(r.endsAt) > clock();
  return {
    rows,
    limits,
    allowanceFor: () =>
      Promise.resolve({
        weeklySessions: 5,
        remaining: limits.remaining,
        resetsAt: "2026-10-19T00:00:00.000Z",
      }),
    reserve: (input) => {
      const existing = rows.find(
        (r) => r.applicationId === input.applicationId && open(r),
      );
      if (existing !== undefined)
        return Promise.resolve({ kind: "EXISTING" as const, row: existing });
      if (
        rows.filter((r) => r.applicationId === input.applicationId).length >=
        input.perApplication
      )
        return Promise.resolve({ kind: "ALLOWANCE" as const });
      if (rows.filter(open).length >= input.concurrency)
        return Promise.resolve({ kind: "CONCURRENCY" as const });
      if (limits.platformFull)
        return Promise.resolve({ kind: "PLATFORM_LIMIT" as const });
      if (limits.remaining <= 0)
        return Promise.resolve({ kind: "WEEKLY_ALLOWANCE" as const });
      limits.remaining -= 1;
      const now = clock();
      const row: GateqVideoSessionRow = {
        id: input.id,
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        status: "STARTING",
        endedReason: null,
        providerConversationId: null,
        joinUrlSealed: null,
        guestCredentialSealed: input.guestCredentialSealed,
        maxSeconds: input.maxSeconds,
        createdAt: new Date(now).toISOString(),
        endsAt: new Date(now + input.maxSeconds * 1000).toISOString(),
      };
      rows.push(row);
      hashes.set(input.bridgeTokenHash, row.id);
      return Promise.resolve({ kind: "CREATED" as const, row });
    },
    markLive: (input) => {
      const i = rows.findIndex((r) => r.id === input.id);
      const row = rows[i];
      if (row !== undefined && row.status === "STARTING")
        rows[i] = {
          ...row,
          status: "LIVE",
          providerConversationId: input.providerConversationId,
          joinUrlSealed: input.joinUrlSealed,
        };
      return Promise.resolve();
    },
    end: (input) => {
      const i = rows.findIndex((r) => r.id === input.id);
      const row = rows[i];
      if (row === undefined) return Promise.resolve(null);
      if (row.status !== "ENDED")
        rows[i] = {
          ...row,
          status: "ENDED",
          endedReason: input.reason,
          providerConversationId:
            row.providerConversationId ?? input.providerConversationId ?? null,
        };
      return Promise.resolve(rows[i] ?? null);
    },
    openForApplication: (applicationId) =>
      Promise.resolve(
        rows.find(
          (r) => r.applicationId === applicationId && r.status !== "ENDED",
        ) ?? null,
      ),
    countForApplication: (applicationId) =>
      Promise.resolve(
        rows.filter((r) => r.applicationId === applicationId).length,
      ),
    byBridgeTokenHash: (hash) => {
      const id = hashes.get(hash);
      return Promise.resolve(rows.find((r) => r.id === id) ?? null);
    },
    expired: () =>
      Promise.resolve(
        rows.filter(
          (r) => r.status !== "ENDED" && Date.parse(r.endsAt) <= clock(),
        ),
      ),
  };
}

function world(config: Partial<GateqVideoConfig> = {}) {
  let now = Date.parse("2026-10-15T09:00:00Z");
  const clock = () => now;
  const store = memoryStore(clock);
  const bearers: string[] = [];
  const provider = {
    createRoom: vi.fn(
      (input: {
        sessionId: string;
        maxSeconds: number;
        testMode: boolean;
        greeting: string;
        bridge: { path: string; bearer: string };
      }) => {
        bearers.push(input.bridge.bearer);
        return Promise.resolve({
          conversationId: `c${String(bearers.length)}`,
          joinUrl: `https://tavus.daily.co/c${String(bearers.length)}?t=x`,
        });
      },
    ),
    endRoom: vi.fn(() => Promise.resolve()),
  };
  const apps: Record<string, { id: string; status: string }> = {
    [TOKEN]: { id: APP, status: "IN_PROGRESS" },
    [OTHER_TOKEN]: { id: OTHER_APP, status: "IN_PROGRESS" },
  };
  const intake = {
    authorise: vi.fn((token: string) => {
      const app = apps[token];
      if (app === undefined)
        return Promise.reject(new IntakeRefusedError("SESSION_INVALID"));
      return Promise.resolve({
        application: { ...app, tenantId: TENANT },
        sessionId: "s",
      } as never);
    }),
    assertInterviewReady: vi.fn(() => Promise.resolve()),
  };
  const conversation = {
    openingFor: vi.fn(() => Promise.resolve("Hello, I'm Q.")),
    turn: vi.fn(
      (input: { token: string; message: string; clientTurnId: string }) =>
        Promise.resolve({ reply: `Heard: ${input.message}` } as never),
    ),
  };
  const video = createGateqVideoInterview({
    config: { ...GATEQ_VIDEO_DEFAULTS, enabled: true, ...config },
    store,
    provider,
    sealer: { seal: (p) => `sealed:${p}`, open: (s) => s.slice(7) },
    intake,
    conversation,
    bridgePath: "/v1/gateq/video/bridge",
    now: clock,
  });
  return {
    video,
    store,
    provider,
    conversation,
    intake,
    bearers,
    apps,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("configuration", () => {
  it("defaults: off, 8 minutes, one per application, two at once, test mode, 180 s paid cap", () => {
    const config = gateqVideoConfigFrom({});
    expect(config).toEqual(GATEQ_VIDEO_DEFAULTS);
    expect(effectiveMaxSeconds(config)).toBe(180);
  });
  it("reads every limit, keeps safe defaults for malformed values, and pays only when explicitly false", () => {
    const config = gateqVideoConfigFrom({
      CQ_GATEQ_VIDEO_INTERVIEW: "1",
      CQ_GATEQ_VIDEO_MAX_SECONDS: "600",
      CQ_GATEQ_VIDEO_PAID_RUN_CAP_SECONDS: "abc",
      CQ_GATEQ_VIDEO_PER_APPLICATION: "2",
      CQ_GATEQ_VIDEO_CONCURRENCY: "-3",
      CQ_GATEQ_VIDEO_TEST_MODE: "no",
    });
    expect(config).toEqual({
      enabled: true,
      maxSeconds: 600,
      paidRunCapSeconds: 180,
      perApplication: 2,
      concurrency: 2,
      testMode: true,
    });
    expect(
      gateqVideoConfigFrom({ CQ_GATEQ_VIDEO_TEST_MODE: "false" }).testMode,
    ).toBe(false);
    expect(effectiveMaxSeconds({ ...config, paidRunCapSeconds: 3600 })).toBe(
      600,
    );
  });
});

describe("the GateQ video interview session", () => {
  it("is refused while switched off, before any provider call", async () => {
    const w = world({ enabled: false });
    expect(await w.video.available(TOKEN)).toBe(false);
    await expect(
      w.video.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toMatchObject({ reason: "DISABLED" });
    expect(w.provider.createRoom).not.toHaveBeenCalled();
  });

  it("starts one room with Q's opening, the capped duration and a bridge bearer it never stores in clear", async () => {
    const w = world();
    const session = await w.video.start({ token: TOKEN, correlationId: "c" });
    expect(session).toMatchObject({ status: "LIVE", maxSeconds: 180 });
    expect(session.joinUrl).toContain("tavus.daily.co");
    expect(w.provider.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSeconds: 180,
        testMode: true,
        greeting: "Hello, I'm Q.",
      }),
    );
    const row = w.store.rows[0];
    expect(row?.guestCredentialSealed).toBe(`sealed:${TOKEN}`);
    expect(JSON.stringify(w.store.rows)).not.toContain(w.bearers[0] ?? "x");
  });

  it("a retry or reconnect returns the same session and clock, never a second room", async () => {
    const w = world();
    const first = await w.video.start({ token: TOKEN, correlationId: "c" });
    w.advance(30_000);
    const again = await w.video.start({ token: TOKEN, correlationId: "c2" });
    expect(again.id).toBe(first.id);
    expect(again.endsAt).toBe(first.endsAt);
    expect(w.provider.createRoom).toHaveBeenCalledTimes(1);
  });

  it("allows one session per application by default, even after it ended", async () => {
    const w = world();
    expect(await w.video.available(TOKEN)).toBe(true);
    await w.video.start({ token: TOKEN, correlationId: "c" });
    await w.video.end({ token: TOKEN, continueByTyping: true });
    // No offer that can only lead to a refusal (live 2026-10-15).
    expect(await w.video.available(TOKEN)).toBe(false);
    await expect(
      w.video.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toMatchObject({ reason: "ALLOWANCE_EXHAUSTED" });
  });

  it("offers no video once the person's shared weekly allowance is spent, and refuses a start", async () => {
    const w = world();
    w.store.limits.remaining = 0;
    expect(await w.video.available(TOKEN)).toBe(false);
    expect(await w.video.allowance(TOKEN)).toMatchObject({ remaining: 0 });
    await expect(
      w.video.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toMatchObject({ reason: "ALLOWANCE_EXHAUSTED" });
    expect(w.provider.createRoom).not.toHaveBeenCalled();
  });

  it("fails closed, before any provider call, when the account's monthly safeguard is reached", async () => {
    const w = world();
    w.store.limits.platformFull = true;
    await expect(
      w.video.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toMatchObject({ reason: "PROVIDER_UNAVAILABLE" });
    expect(w.provider.createRoom).not.toHaveBeenCalled();
  });

  it("caps concurrent sessions across applications", async () => {
    const w = world({ concurrency: 1 });
    await w.video.start({ token: TOKEN, correlationId: "c" });
    await expect(
      w.video.start({ token: OTHER_TOKEN, correlationId: "c" }),
    ).rejects.toBeInstanceOf(GateqVideoRefusedError);
  });

  it("refuses a submitted application and an unknown credential", async () => {
    const w = world();
    w.apps[TOKEN] = { id: APP, status: "SUBMITTED" };
    await expect(
      w.video.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toMatchObject({ refusal: "ALREADY_SUBMITTED" });
    await expect(
      w.video.start({ token: "gqs_forged", correlationId: "c" }),
    ).rejects.toBeInstanceOf(IntakeRefusedError);
    expect(w.provider.createRoom).not.toHaveBeenCalled();
  });

  it("closes the row and falls back to typing when the provider fails, spending the attempt", async () => {
    const w = world();
    w.provider.createRoom.mockRejectedValueOnce(new Error("credit"));
    await expect(
      w.video.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toMatchObject({ reason: "PROVIDER_UNAVAILABLE" });
    expect(w.store.rows[0]).toMatchObject({
      status: "ENDED",
      endedReason: "PROVIDER_FAILED",
    });
  });

  it("a room made but never saved as live is ended and recorded, so the ledger counts it in full", async () => {
    const w = world();
    vi.spyOn(w.store, "markLive").mockRejectedValueOnce(new Error("db blip"));
    await expect(
      w.video.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toMatchObject({ reason: "PROVIDER_UNAVAILABLE" });
    expect(w.provider.endRoom).toHaveBeenCalledWith("c1");
    // The closed row names the room: the settle trigger then counts 180 s
    // instead of releasing it (migration 20261226150000).
    expect(w.store.rows[0]).toMatchObject({
      status: "ENDED",
      endedReason: "PROVIDER_FAILED",
      providerConversationId: "c1",
    });
  });

  it("a provider that made no room leaves nothing to end or count", async () => {
    const w = world();
    w.provider.createRoom.mockRejectedValueOnce(new Error("refused"));
    await expect(
      w.video.start({ token: TOKEN, correlationId: "c" }),
    ).rejects.toMatchObject({ reason: "PROVIDER_UNAVAILABLE" });
    expect(w.provider.endRoom).not.toHaveBeenCalled();
    expect(w.store.rows[0]?.providerConversationId).toBeNull();
  });

  it("ends the provider room before recording the end, and typing continues the same interview", async () => {
    const w = world();
    await w.video.start({ token: TOKEN, correlationId: "c" });
    const ended = await w.video.end({ token: TOKEN, continueByTyping: true });
    expect(w.provider.endRoom).toHaveBeenCalledWith("c1");
    expect(ended).toMatchObject({
      status: "ENDED",
      endedReason: "CONTINUED_BY_TYPING",
      joinUrl: null,
    });
    expect(await w.video.current(TOKEN)).toBeNull();
  });
});

describe("the provider bridge", () => {
  it("speaks the canonical interview's reply, as the applicant, with a stable turn id per heard line", async () => {
    const w = world();
    await w.video.start({ token: TOKEN, correlationId: "c" });
    const bearer = w.bearers[0] ?? "";
    const first = await w.video.bridgeTurn({
      bearer,
      utterance: "We sell water by the litre.",
      utteranceId: "u1",
      correlationId: "c",
    });
    expect(first).toEqual({
      kind: "REPLY",
      reply: "Heard: We sell water by the litre.",
    });
    await w.video.bridgeTurn({
      bearer,
      utterance: "We sell water by the litre.",
      utteranceId: "u1",
      correlationId: "c",
    });
    const calls = w.conversation.turn.mock.calls.map(([input]) => input);
    expect(calls[0]?.token).toBe(TOKEN);
    expect(calls[0]?.clientTurnId).toMatch(/^video-[0-9a-f]{40}$/u);
    // A redelivered line is the same canonical turn (the service dedupes).
    expect(calls[1]?.clientTurnId).toBe(calls[0]?.clientTurnId);
  });

  it("refuses an unknown bearer and every line after the end", async () => {
    const w = world();
    await w.video.start({ token: TOKEN, correlationId: "c" });
    expect(
      await w.video.bridgeTurn({
        bearer: "x".repeat(43),
        utterance: "hi",
        utteranceId: "u",
        correlationId: "c",
      }),
    ).toEqual({ kind: "UNKNOWN_SESSION" });
    w.advance(181_000);
    expect(
      await w.video.bridgeTurn({
        bearer: w.bearers[0] ?? "",
        utterance: "still there?",
        utteranceId: "u2",
        correlationId: "c",
      }),
    ).toEqual({ kind: "CLOSED" });
    expect(w.conversation.turn).not.toHaveBeenCalled();
  });

  it("the sweep ends rooms past their deadline and keeps a failed end for the next pass", async () => {
    const w = world();
    await w.video.start({ token: TOKEN, correlationId: "c" });
    w.advance(181_000);
    w.provider.endRoom.mockRejectedValueOnce(new Error("provider down"));
    expect(await w.video.sweep()).toEqual({ ended: 0, failed: 1 });
    expect(w.store.rows[0]?.status).toBe("LIVE");
    expect(await w.video.sweep()).toEqual({ ended: 1, failed: 0 });
    expect(w.store.rows[0]).toMatchObject({
      status: "ENDED",
      endedReason: "TIME_LIMIT",
    });
  });
});
