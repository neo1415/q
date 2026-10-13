import { randomUUID } from "node:crypto";

import Fastify, { type onRequestHookHandler } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  Q_VOICE_LIVE_TRIAL_SPENT,
} from "@capital-q/contracts";
import { createInMemoryModelUsageRepository } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import {
  createLiveBroker,
  TRIAL_PERSIST_TICKS,
  TRIAL_TICK_MS,
} from "../src/voice/live/broker.js";
import { liveConfigFrom } from "../src/voice/live/config.js";
import { LiveOpenResultSchema } from "../src/voice/live/contracts.js";
import { registerLiveVoiceRoutes } from "../src/voice/live/routes.js";
import {
  createSpeechMeter,
  liveTrialGrantsFrom,
  speechSignalOf,
  SPEECH_OPEN_STALE_MS,
  SPEECH_PULSE_MS,
  withHint,
  type LiveTrialUsageStore,
} from "../src/voice/live/trial.js";
import {
  createGptLiveProvider,
  type LiveVoiceProvider,
  LiveProviderError,
} from "../src/voice/providers/gpt-live.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * The GPT-Live trial (owner 2026-10-12): a cumulative allowance of active
 * speech for named people. No live provider call: the provider and its
 * sideband are fakes, and every key is a disabled placeholder.
 */

process.env.OPENAI_API_KEY = "disabled-locally-000000000000";

// The two trial accounts (lead, read-only lookup 2026-10-12).
const TENSORGATE_DANIEL = "d068e858-01b6-49b5-8b57-901c29ff32e8";
const PARTECH_INVESTOR = "5c9bc620-d213-452f-834b-b853805fbae3";
const ALLOW_LISTED = "b0000000-0000-4000-8000-0000000000aa";
const NOBODY = "b0000000-0000-4000-8000-0000000000bb";

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const OTHER_TENANT = TenantIdSchema.parse(
  "c0000000-0000-4000-8000-000000000002",
);
const actorOf = (userId: string, tenantId = TENANT): ActorContext => ({
  userId: UserIdSchema.parse(userId),
  tenantId,
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
});
const TRIAL = actorOf(TENSORGATE_DANIEL);
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function binding(
  actor: ActorContext,
  voiceSessionId: string = randomUUID(),
): VoiceSessionBinding {
  return {
    voiceSessionId,
    providerConversationId: `dg_${voiceSessionId}`,
    actor,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
    },
    issuedAt: 0,
    connectBy: 1,
    connectedAt: 0,
  };
}

const firewall: ContextFirewallPort = {
  plan: (request) =>
    Promise.resolve({
      outcome: "AUTHORISED",
      plan: PermittedContextPlanSchema.parse({
        contractVersion: 1,
        policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
        planId: randomUUID(),
        fingerprint: "0".repeat(64),
        runId: request.runId,
        tenantId: request.actor.tenantId,
        actor: {
          userId: request.actor.userId,
          organisationId: request.actor.organisationId,
        },
        purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
        subjects: [],
        scopes: [],
        denied: [],
        maxSensitivity: "PUBLIC",
        allowedLayers: [],
        combinationConstraints: [],
        evaluatedAt: new Date().toISOString(),
        revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
        revalidateOnResume: true,
      }),
    }),
};

/** The same semantics as the Postgres store: per session, only grows. */
function memoryStore(): LiveTrialUsageStore & {
  readonly rows: Map<string, number>;
  readonly voices: Map<string, string>;
  readonly claims: Map<
    string,
    { claimId: string; tenantId: string; voiceSessionId: string }
  >;
  failing: boolean;
} {
  const rows = new Map<string, number>();
  const voices = new Map<string, string>();
  const claims = new Map<
    string,
    { claimId: string; tenantId: string; voiceSessionId: string }
  >();
  const prefix = (actor: ActorContext) => `${actor.tenantId}|${actor.userId}|`;
  const store = {
    rows,
    voices,
    claims,
    failing: false,
    usedSeconds: (actor: ActorContext) => {
      if (store.failing) return Promise.reject(new Error("db down"));
      let total = 0;
      for (const [key, value] of rows) {
        if (key.split("|")[1] === actor.userId) total += value;
      }
      return Promise.resolve(total);
    },
    record: (input: {
      readonly actor: ActorContext;
      readonly providerSessionId: string;
      readonly voiceSessionId: string;
      readonly seconds: number;
    }) => {
      const key = `${prefix(input.actor)}${input.providerSessionId}`;
      voices.set(key, input.voiceSessionId);
      rows.set(
        key,
        Math.max(rows.get(key) ?? 0, Math.round(input.seconds * 100) / 100),
      );
      return store.usedSeconds(input.actor);
    },
  };
  return store;
}

type Sideband = {
  readonly onEvent: (event: unknown) => void;
  readonly onLost: () => void;
  stopped: boolean;
};

/** One fake broker instance (a q-api process) over a shared store. */
function instance(
  store: ReturnType<typeof memoryStore> | undefined,
  options: {
    readonly trial?: string;
    readonly clock?: { now: number };
    readonly observe?: boolean;
    readonly closeConfirmed?: boolean;
    readonly observerReady?: boolean;
    readonly observerReadiness?: Promise<boolean>;
    readonly contextRead?: Promise<null>;
    readonly closeAvailable?: boolean;
    readonly createError?: Error;
    readonly missingClaims?: boolean;
  } = {},
) {
  const clock = options.clock ?? { now: 1_000_000 };
  const sidebands: Sideband[] = [];
  const closed: string[] = [];
  let sessions = 0;
  const created: string[] = [];
  const provider: LiveVoiceProvider = {
    providerId: "a1000000-0000-4000-8000-000000000003",
    modelId: "a2000000-0000-4000-8000-000000000023",
    createWebRtcSession: () => {
      if (options.createError !== undefined)
        return Promise.reject(options.createError);
      sessions += 1;
      const id = `live_${String(sessions)}_${randomUUID().slice(0, 8)}`;
      created.push(id);
      return Promise.resolve({ sessionId: id, sdp: "v=0 answer", model: null });
    },
    ...(options.closeAvailable === false
      ? {}
      : {
          closeSession: (id: string) => {
            closed.push(id);
            return Promise.resolve(options.closeConfirmed !== false);
          },
        }),
    ...(options.observe === false
      ? {}
      : {
          observeSession: (
            _id: string,
            handlers: {
              readonly onEvent: (event: unknown) => void;
              readonly onLost: () => void;
            },
          ) => {
            const sideband: Sideband = { ...handlers, stopped: false };
            sidebands.push(sideband);
            return {
              ready:
                options.observerReadiness ??
                Promise.resolve(options.observerReady !== false),
              stop: () => {
                sideband.stopped = true;
              },
            };
          },
        }),
  };
  const turn: VoiceTurnHandler = async (_b, _t, _s, speaker) => {
    await speaker.speak("Answer.");
    return { kind: "SPOKEN", path: "Q" };
  };
  const config = liveConfigFrom(
    {
      CQ_VOICE_LIVE: "on",
      CQ_VOICE_LIVE_USERS: ALLOW_LISTED,
      CQ_VOICE_LIVE_TRIAL:
        options.trial ??
        JSON.stringify({ [TENSORGATE_DANIEL]: 300, [PARTECH_INVESTOR]: 300 }),
    },
    "production",
  );
  const broker = createLiveBroker({
    config,
    provider,
    firewall,
    turn,
    spend: { spentTodayUsd: () => Promise.resolve(0) },
    usage: createInMemoryModelUsageRepository(),
    providerCeiling: "PUBLIC",
    syntheticDemo: false,
    logger,
    now: () => clock.now,
    contextFor: () => options.contextRead ?? Promise.resolve(null),
    trialUsage: store,
    trialClaims:
      store === undefined || options.missingClaims === true
        ? undefined
        : {
            held: (actor) => Promise.resolve(store.claims.has(actor.userId)),
            claim: async ({ actor, allowanceSeconds, voiceSessionId }) => {
              const used = await store.usedSeconds(actor);
              if (store.claims.has(actor.userId) || used >= allowanceSeconds)
                return null;
              const claimId = randomUUID();
              store.claims.set(actor.userId, {
                claimId,
                tenantId: actor.tenantId,
                voiceSessionId,
              });
              return { claimId, remainingSeconds: allowanceSeconds - used };
            },
            release: ({
              actor,
              claimId,
              providerSessionId,
              finalSeconds,
              providerTerminated,
            }) => {
              const claim = store.claims.get(actor.userId);
              if (
                claim?.claimId !== claimId ||
                claim.tenantId !== actor.tenantId ||
                providerTerminated !== true
              )
                return Promise.resolve(false);
              if (providerSessionId === null) {
                if (finalSeconds !== 0) return Promise.resolve(false);
              } else {
                const key = `${actor.tenantId}|${actor.userId}|${providerSessionId}`;
                if (
                  (store.rows.get(key) ?? -1) < finalSeconds ||
                  store.voices.get(key) !== claim.voiceSessionId
                )
                  return Promise.resolve(false);
              }
              store.claims.delete(actor.userId);
              return Promise.resolve(true);
            },
          },
  });
  /** The newest line's provider sideband, as the provider would speak. */
  const emit = (type: string) => {
    sidebands[sidebands.length - 1]?.onEvent({ type });
  };
  return {
    broker,
    config,
    clock,
    sidebands,
    closed,
    created,
    emit,
    tick: (ms: number) => {
      clock.now += ms;
    },
  };
}

type Instance = ReturnType<typeof instance>;

/** One side speaking for `seconds`, with its words streaming as it goes. */
function speak(line: Instance, side: "user" | "q", seconds: number) {
  line.emit(
    side === "user"
      ? "input_audio_buffer.speech_started"
      : "output_audio_buffer.started",
  );
  for (let half = 0; half < seconds * 2; half += 1) {
    line.tick(500);
    line.emit(
      side === "user"
        ? "session.input_transcript.delta"
        : "session.output_transcript.delta",
    );
  }
  line.emit(
    side === "user"
      ? "input_audio_buffer.speech_stopped"
      : "output_audio_buffer.stopped",
  );
}

/** `seconds` of the person speaking, then the same of Q. */
function converse(line: Instance, seconds: number) {
  speak(line, "user", seconds);
  speak(line, "q", seconds);
}

async function openLine(line: Instance, actor: ActorContext = TRIAL) {
  const outcome = await line.broker.open({
    binding: binding(actor),
    sdp: "v=0 offer",
  });
  if (outcome.kind !== "OPEN") return { outcome, voiceSessionId: "" };
  return { outcome, voiceSessionId: outcome.result.voiceSessionId };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("trial grants (CQ_VOICE_LIVE_TRIAL)", () => {
  it("takes user ids with whole seconds, and drops anything malformed or past the bound", () => {
    const grants = liveTrialGrantsFrom(
      JSON.stringify({
        [TENSORGATE_DANIEL.toUpperCase()]: 300,
        [PARTECH_INVESTOR]: 300,
        "not-a-user": 300,
        "b0000000-0000-4000-8000-000000000003": 99_999,
        "b0000000-0000-4000-8000-000000000004": "300",
        "b0000000-0000-4000-8000-000000000005": 0,
        "b0000000-0000-4000-8000-000000000006": 12.5,
      }),
    );
    expect([...grants]).toEqual([
      [TENSORGATE_DANIEL, 300],
      [PARTECH_INVESTOR, 300],
    ]);
    expect(liveTrialGrantsFrom("{oops").size).toBe(0);
    expect(liveTrialGrantsFrom("[300]").size).toBe(0);
    expect(liveTrialGrantsFrom(undefined).size).toBe(0);
  });

  it("leaves the allow-list exactly as it was, and grants nobody else", () => {
    const { config } = instance(undefined);
    expect([...(config.allowedUsers ?? [])]).toEqual([ALLOW_LISTED]);
    expect(config.trial.has(NOBODY)).toBe(false);
    expect(config.trial.has(ALLOW_LISTED)).toBe(false);
    expect(liveConfigFrom({}, "production").trial.size).toBe(0);
  });
});

describe("measuring active speech", () => {
  it("counts both sides' speech and none of the silence between", () => {
    const meter = createSpeechMeter();
    meter.signal({ kind: "start", side: "user" }, 0);
    meter.signal({ kind: "stop", side: "user" }, 3_000);
    // A minute of silence: nobody speaks.
    expect(meter.measuredMs(63_000)).toBe(3_000);
    // Q's words stream for 2 s as transcript deltas every 200 ms.
    for (let at = 63_000; at <= 65_000; at += 200) {
      meter.signal({ kind: "pulse", side: "q" }, at);
    }
    expect(meter.measuredMs(70_000)).toBe(3_000 + 2_000 + SPEECH_PULSE_MS);
    // More silence never adds anything.
    expect(meter.measuredMs(500_000)).toBe(3_000 + 2_000 + SPEECH_PULSE_MS);
  });

  it("counts overlapping speech once (a barge-in is not double time)", () => {
    const meter = createSpeechMeter();
    meter.signal({ kind: "start", side: "q" }, 0);
    meter.signal({ kind: "start", side: "user" }, 4_000);
    meter.signal({ kind: "stop", side: "q" }, 5_000);
    meter.signal({ kind: "stop", side: "user" }, 8_000);
    expect(meter.measuredMs(10_000)).toBe(8_000);
  });

  it("counts an open stretch while it lasts, and a lost stop only briefly", () => {
    const meter = createSpeechMeter();
    meter.signal({ kind: "start", side: "q" }, 0);
    expect(meter.measuredMs(5_000)).toBe(5_000);
    // The stopped event never comes: silence is not charged past the bound.
    expect(meter.measuredMs(600_000)).toBe(SPEECH_OPEN_STALE_MS);
  });

  it("reads the provider's events, and ignores everything else", () => {
    expect(
      speechSignalOf({ type: "input_audio_buffer.speech_started" }),
    ).toEqual({ kind: "start", side: "user" });
    expect(speechSignalOf({ type: "session.output_transcript.delta" })).toEqual(
      { kind: "pulse", side: "q" },
    );
    expect(speechSignalOf({ type: "session.delegation.created" })).toBeNull();
    expect(speechSignalOf({ type: "toString" })).toBeNull();
    expect(speechSignalOf("input_audio_buffer.speech_started")).toBeNull();
    expect(speechSignalOf(null)).toBeNull();
  });

  it("a browser hint only ever raises the charge, never past the wall clock", () => {
    expect(withHint(50, undefined, 120)).toBe(50);
    expect(withHint(50, 0, 120)).toBe(50);
    expect(withHint(50, -100, 120)).toBe(50);
    expect(withHint(50, 80, 120)).toBe(80);
    expect(withHint(50, 86_400, 120)).toBe(120);
    expect(withHint(50, Number.NaN, 120)).toBe(50);
  });
});

describe("the trial line (broker)", () => {
  it("does not return OPEN after observer loss during context loading", async () => {
    let finishContext: (context: null) => void = () => undefined;
    const contextRead = new Promise<null>((resolve) => {
      finishContext = resolve;
    });
    const store = memoryStore();
    const line = instance(store, { contextRead });
    const opening = openLine(line);
    await settle();
    line.sidebands[0]?.onLost();
    finishContext(null);
    expect((await opening).outcome).toEqual({
      kind: "REFUSED",
      reason: "LEDGER_UNAVAILABLE",
    });
    expect(line.closed).toHaveLength(1);
    expect(store.claims.size).toBe(1);
  });

  it("withholds usable SDP until the server observer confirms readiness", async () => {
    let confirm: (ready: boolean) => void = () => undefined;
    const readiness = new Promise<boolean>((resolve) => {
      confirm = resolve;
    });
    const line = instance(memoryStore(), { observerReadiness: readiness });
    let resolved = false;
    const opening = openLine(line).then((result) => {
      resolved = true;
      return result;
    });
    await settle();
    expect(line.created).toHaveLength(1);
    expect(resolved).toBe(false);
    confirm(true);
    expect((await opening).outcome.kind).toBe("OPEN");
  });

  it("bounds a never-settled observer and retains the unknown claim", async () => {
    vi.useFakeTimers();
    try {
      const store = memoryStore();
      const line = instance(store, {
        observerReadiness: new Promise<boolean>(() => undefined),
      });
      const opening = openLine(line);
      await vi.advanceTimersByTimeAsync(5_001);
      expect((await opening).outcome).toEqual({
        kind: "REFUSED",
        reason: "LEDGER_UNAVAILABLE",
      });
      expect(line.closed).toHaveLength(1);
      expect(store.claims.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses usable SDP and retains unknown allowance if observer readiness fails", async () => {
    const store = memoryStore();
    const line = instance(store, { observerReady: false });
    expect((await openLine(line)).outcome).toEqual({
      kind: "REFUSED",
      reason: "LEDGER_UNAVAILABLE",
    });
    expect(line.closed).toEqual([line.created[0]]);
    await settle();
    expect(store.claims.size).toBe(1);
  });

  it("refuses before paid creation without server termination capability", async () => {
    const line = instance(memoryStore(), { closeAvailable: false });
    expect((await openLine(line)).outcome).toEqual({
      kind: "REFUSED",
      reason: "LEDGER_UNAVAILABLE",
    });
    expect(line.created).toEqual([]);
  });

  it("refuses paid trial creation without durable admission", async () => {
    const store = memoryStore();
    const line = instance(store, { missingClaims: true });
    expect((await openLine(line)).outcome).toEqual({
      kind: "REFUSED",
      reason: "LEDGER_UNAVAILABLE",
    });
    expect(line.created).toEqual([]);
  });

  it("atomically admits only one concurrent instance before either provider is created", async () => {
    const store = memoryStore();
    const first = instance(store);
    const second = instance(store);
    const outcomes = await Promise.all([openLine(first), openLine(second)]);
    expect(outcomes.map((value) => value.outcome.kind).sort()).toEqual([
      "OPEN",
      "REFUSED",
    ]);
    expect(first.created.length + second.created.length).toBe(1);
    const opened =
      outcomes[0]?.outcome.kind === "OPEN"
        ? { line: first, value: outcomes[0] }
        : { line: second, value: outcomes[1] };
    if (opened.value === undefined)
      throw new Error("missing concurrent outcome");
    opened.line.broker.end({
      actor: TRIAL,
      voiceSessionId: opened.value.voiceSessionId,
      reason: "ended",
    });
    await settle();
  });

  it("retains the durable claim across restart when provider termination is unconfirmed", async () => {
    const store = memoryStore();
    const line = instance(store, { closeConfirmed: false });
    const opened = await openLine(line);
    speak(line, "user", 2);
    line.broker.end({
      actor: TRIAL,
      voiceSessionId: opened.voiceSessionId,
      reason: "ended",
    });
    await settle();
    expect(await store.usedSeconds(TRIAL)).toBe(2);
    const restarted = instance(store);
    expect((await openLine(restarted)).outcome).toEqual({
      kind: "REFUSED",
      reason: "TRIAL_IN_USE",
    });
    expect(restarted.created).toEqual([]);
  });

  it("ends on observer loss without charging future silence or refunding unknown allowance", async () => {
    const store = memoryStore();
    const line = instance(store);
    await openLine(line);
    speak(line, "user", 2);
    line.sidebands[0]?.onLost();
    line.tick(4 * 60 * 1000);
    await settle();
    expect(line.closed).toEqual([line.created[0]]);
    expect(await store.usedSeconds(TRIAL)).toBe(2);
    const restarted = instance(store);
    expect((await openLine(restarted)).outcome).toEqual({
      kind: "REFUSED",
      reason: "TRIAL_IN_USE",
    });
  });

  it.each([280, 290])(
    "ends continuously observed open speech before stop when %s seconds were already used",
    async (used) => {
      vi.useFakeTimers();
      const store = memoryStore();
      await store.record({
        actor: TRIAL,
        providerSessionId: "prior",
        voiceSessionId: "prior",
        seconds: used,
      });
      const line = instance(store);
      await openLine(line);
      line.emit("input_audio_buffer.speech_started");
      for (let seconds = 0; seconds < 25; seconds += 1) {
        line.tick(1000);
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(line.closed).toEqual([line.created[0]]);
      expect(await store.usedSeconds(TRIAL)).toBe(300);
    },
  );

  it("releases a provisional claim only after an explicit rejected creation", async () => {
    const store = memoryStore();
    const line = instance(store, {
      createError: new LiveProviderError("quota", 429),
    });
    expect((await openLine(line)).outcome).toEqual({
      kind: "REFUSED",
      reason: "PROVIDER_QUOTA",
    });
    expect(store.claims.size).toBe(0);
    const resumed = instance(store);
    const opened = await openLine(resumed);
    expect(opened.outcome.kind).toBe("OPEN");
    resumed.broker.end({
      actor: TRIAL,
      voiceSessionId: opened.voiceSessionId,
      reason: "ended",
    });
    await settle();
  });

  it.each([
    new Error("network response lost"),
    new LiveProviderError("server error", 503),
  ])(
    "retains a provisional claim on ambiguous provider creation: %s",
    async (error) => {
      const store = memoryStore();
      const line = instance(store, { createError: error });
      expect((await openLine(line)).outcome).toEqual({
        kind: "REFUSED",
        reason: "PROVIDER_UNAVAILABLE",
      });
      expect(store.claims.size).toBe(1);
      const restarted = instance(store);
      expect((await openLine(restarted)).outcome).toEqual({
        kind: "REFUSED",
        reason: "TRIAL_IN_USE",
      });
      expect(restarted.created).toEqual([]);
    },
  );

  it("audit: concurrent instances cannot each consume the remaining allowance", async () => {
    const store = memoryStore();
    await store.record({
      actor: TRIAL,
      providerSessionId: "prior",
      voiceSessionId: "prior",
      seconds: 290,
    });
    const first = instance(store);
    const second = instance(store);
    const a = await openLine(first);
    const b = await openLine(second);
    speak(first, "user", 8);
    speak(second, "user", 8);
    first.broker.end({
      actor: TRIAL,
      voiceSessionId: a.voiceSessionId,
      reason: "audit_end",
    });
    second.broker.end({
      actor: TRIAL,
      voiceSessionId: b.voiceSessionId,
      reason: "audit_end",
    });
    await settle();
    expect(await store.usedSeconds(TRIAL)).toBeLessThanOrEqual(300);
  });

  it("audit: an immediate reconnect cannot reuse unflushed speech", async () => {
    const store = memoryStore();
    const line = instance(store);
    await openLine(line);
    speak(line, "user", 299);
    const reconnect = await openLine(line);
    expect(
      reconnect.outcome.kind === "OPEN" &&
        reconnect.outcome.result.trial?.remainingSeconds,
    ).toBe(1);
    line.broker.end({
      actor: TRIAL,
      voiceSessionId: reconnect.voiceSessionId,
      reason: "audit_end",
    });
    await settle();
  });

  it("audit: a failed durable usage write closes the paid line", async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const line = instance(store);
    const a = await openLine(line);
    speak(line, "user", 3);
    const failedStore = vi
      .spyOn(store, "record")
      .mockRejectedValue(new Error("db write unavailable"));
    line.tick(TRIAL_TICK_MS * TRIAL_PERSIST_TICKS);
    await vi.advanceTimersByTimeAsync(TRIAL_TICK_MS * TRIAL_PERSIST_TICKS);
    expect(line.closed).toEqual([line.created[0]]);
    failedStore.mockRestore();
    line.broker.end({
      actor: TRIAL,
      voiceSessionId: a.voiceSessionId,
      reason: "audit_end",
    });
  });

  it("opens with the remaining allowance and charges speech, not silence", async () => {
    const store = memoryStore();
    const line = instance(store);
    const { outcome, voiceSessionId } = await openLine(line);
    expect(outcome.kind).toBe("OPEN");
    if (outcome.kind !== "OPEN") return;
    expect(LiveOpenResultSchema.parse(outcome.result).trial).toEqual({
      allowanceSeconds: 300,
      remainingSeconds: 300,
    });
    converse(line, 10);
    // Four minutes of idle silence with the line open.
    line.tick(4 * 60 * 1000);
    const report = await line.broker.usage({
      actor: TRIAL,
      voiceSessionId,
      report: { seconds: 260 },
    });
    expect(report?.trial).toEqual({
      allowanceSeconds: 300,
      remainingSeconds: 280,
    });
    expect(report?.trialSpent).toBeUndefined();
    expect(
      line.broker.end({ actor: TRIAL, voiceSessionId, reason: "ended" }),
    ).toBe(true);
    await settle();
    expect([...store.rows.values()]).toEqual([20]);
    expect(line.sidebands[0]?.stopped).toBe(true);
  });

  it("keeps the allowance across a reconnect, another device and a restart", async () => {
    vi.useFakeTimers();
    const settle = () => vi.advanceTimersByTimeAsync(0);
    const store = memoryStore();
    const first = instance(store);
    const a = await openLine(first);
    converse(first, 50);
    first.broker.end({
      actor: TRIAL,
      voiceSessionId: a.voiceSessionId,
      reason: "ended",
    });
    await settle();

    // A restart: a new process, nothing in memory, the same database.
    const restarted = instance(store);
    const b = await openLine(restarted);
    expect(b.outcome.kind === "OPEN" && b.outcome.result.trial).toEqual({
      allowanceSeconds: 300,
      remainingSeconds: 200,
    });

    // Another device on another instance, at the same time: each sees the
    // other's use once it is saved.
    const device = instance(store, { clock: restarted.clock });
    const c = await openLine(device);
    expect(c.outcome).toEqual({ kind: "REFUSED", reason: "TRIAL_IN_USE" });
    expect(device.created).toEqual([]);
    converse(restarted, 40);
    restarted.broker.end({
      actor: TRIAL,
      voiceSessionId: b.voiceSessionId,
      reason: "ended",
    });
    await settle();
    expect(await store.usedSeconds(TRIAL)).toBe(180);
    const resumed = await openLine(device);
    expect(
      resumed.outcome.kind === "OPEN" &&
        resumed.outcome.result.trial?.remainingSeconds,
    ).toBe(120);
    // The device's line learns of it on its next save and is ended once
    // its own speech takes the rest (120 s).
    device.tick(TRIAL_TICK_MS * TRIAL_PERSIST_TICKS);
    await vi.advanceTimersByTimeAsync(TRIAL_TICK_MS * TRIAL_PERSIST_TICKS);
    speak(device, "q", 119);
    expect(device.closed).toEqual([]);
    speak(device, "q", 2);
    expect(device.closed).toEqual([device.created[0]]);
    // A reconnect (the browser renews the call) is refused: it is spent.
    await settle();
    expect((await openLine(device)).outcome).toEqual({
      kind: "REFUSED",
      reason: "TRIAL_SPENT",
    });
  });

  it("refuses to open once the allowance is spent, before any provider session", async () => {
    const store = memoryStore();
    await store.record({
      actor: TRIAL,
      providerSessionId: "live_old",
      voiceSessionId: "line-old",
      seconds: 300,
    });
    const line = instance(store);
    const { outcome } = await openLine(line);
    expect(outcome).toEqual({ kind: "REFUSED", reason: "TRIAL_SPENT" });
    expect(line.created).toEqual([]);
    expect(await line.broker.trialFor(TRIAL)).toEqual({
      allowanceSeconds: 300,
      remainingSeconds: 0,
    });
  });

  it("refuses when its use cannot be read: unknown is not unused", async () => {
    const store = memoryStore();
    store.failing = true;
    const line = instance(store);
    expect((await openLine(line)).outcome).toEqual({
      kind: "REFUSED",
      reason: "LEDGER_UNAVAILABLE",
    });
    expect(line.created).toEqual([]);
    const unstored = instance(undefined);
    expect((await openLine(unstored)).outcome).toEqual({
      kind: "REFUSED",
      reason: "LEDGER_UNAVAILABLE",
    });
  });

  it("ends the line mid-session when the allowance is consumed, and closes its provider session", async () => {
    const store = memoryStore();
    await store.record({
      actor: TRIAL,
      providerSessionId: "live_old",
      voiceSessionId: "line-old",
      seconds: 290,
    });
    const line = instance(store);
    const { voiceSessionId } = await openLine(line);
    line.emit("input_audio_buffer.speech_started");
    line.tick(9_000);
    line.emit("session.input_transcript.delta");
    expect(line.closed).toEqual([]);
    line.tick(1_500);
    line.emit("session.input_transcript.delta");
    expect(line.closed).toEqual([line.created[0]]);
    // The line is gone: the browser's next request finds nothing.
    expect(
      await line.broker.delegate({
        actor: TRIAL,
        voiceSessionId,
        delegation: { delegationId: "d1", request: "Open Discover" },
      }),
    ).toBeNull();
    await settle();
    expect(await store.usedSeconds(TRIAL)).toBeGreaterThanOrEqual(300);
    expect((await openLine(line)).outcome).toEqual({
      kind: "REFUSED",
      reason: "TRIAL_SPENT",
    });
  });

  it("ends a line whose speech runs on with no further event, on its own timer", async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    await store.record({
      actor: TRIAL,
      providerSessionId: "live_old",
      voiceSessionId: "line-old",
      seconds: 295,
    });
    const line = instance(store);
    await openLine(line);
    line.emit("output_audio_buffer.started");
    line.tick(6_000);
    await vi.advanceTimersByTimeAsync(TRIAL_TICK_MS);
    expect(line.closed).toEqual([line.created[0]]);
  });

  it("tells the browser to close when its usage report finds the allowance spent", async () => {
    const store = memoryStore();
    const line = instance(store, {
      trial: JSON.stringify({ [TENSORGATE_DANIEL]: 30 }),
    });
    const { voiceSessionId } = await openLine(line);
    speak(line, "q", 29);
    const before = await line.broker.usage({
      actor: TRIAL,
      voiceSessionId,
      report: { seconds: 29 },
    });
    expect(before?.trial?.remainingSeconds).toBe(1);
    expect(before?.remainingMs).toBeGreaterThan(0);
    // The browser heard more than the sideband did: its count consumes.
    line.tick(2_000);
    const after = await line.broker.usage({
      actor: TRIAL,
      voiceSessionId,
      report: { seconds: 31, speechSeconds: 31 },
    });
    expect(after).toMatchObject({ remainingMs: 0, trialSpent: true });
    expect(after?.trial?.remainingSeconds).toBe(0);
  });

  it("a browser hint cannot add allowance: low hints are ignored, high ones are bounded by the wall clock", async () => {
    const store = memoryStore();
    const line = instance(store);
    const { voiceSessionId } = await openLine(line);
    converse(line, 25);
    const low = await line.broker.usage({
      actor: TRIAL,
      voiceSessionId,
      report: { seconds: 50, speechSeconds: 0 },
    });
    expect(low?.trial?.remainingSeconds).toBe(250);
    line.tick(10_000);
    const honest = await line.broker.usage({
      actor: TRIAL,
      voiceSessionId,
      report: { seconds: 60, speechSeconds: 58 },
    });
    expect(honest?.trial?.remainingSeconds).toBe(242);
    // A later, lower hint does not give any of it back.
    const lower = await line.broker.usage({
      actor: TRIAL,
      voiceSessionId,
      report: { seconds: 60, speechSeconds: 1 },
    });
    expect(lower?.trial?.remainingSeconds).toBe(242);
    const high = await line.broker.usage({
      actor: TRIAL,
      voiceSessionId,
      report: { seconds: 60, speechSeconds: 86_400 },
    });
    // At most the 60 s the line has existed.
    expect(high?.trial?.remainingSeconds).toBe(240);
  });

  it("refuses before paid creation when server speech cannot be observed", async () => {
    const store = memoryStore();
    const line = instance(store, { observe: false });
    expect((await openLine(line)).outcome).toEqual({
      kind: "REFUSED",
      reason: "LEDGER_UNAVAILABLE",
    });
    expect(line.created).toEqual([]);
    expect(store.claims.size).toBe(0);
  });

  it("leaves everyone else as they were: no trial, no meter, no row", async () => {
    const store = memoryStore();
    const line = instance(store);
    for (const userId of [ALLOW_LISTED, NOBODY]) {
      const actor = actorOf(userId);
      const { outcome, voiceSessionId } = await openLine(line, actor);
      expect(outcome.kind).toBe("OPEN");
      if (outcome.kind !== "OPEN") continue;
      expect(outcome.result.trial).toBeUndefined();
      line.tick(400_000);
      const report = await line.broker.usage({
        actor,
        voiceSessionId,
        report: { seconds: 400, speechSeconds: 400 },
      });
      expect(report?.trial).toBeUndefined();
      expect(report?.trialSpent).toBeUndefined();
      expect(await line.broker.trialFor(actor)).toBeNull();
    }
    expect(line.sidebands).toEqual([]);
    expect(store.rows.size).toBe(0);
  });

  it("keeps a person's budget across tenant contexts without exposing another person's use", async () => {
    const store = memoryStore();
    await store.record({
      actor: TRIAL,
      providerSessionId: "live_old",
      voiceSessionId: "line-old",
      seconds: 300,
    });
    expect(
      await store.usedSeconds(actorOf(TENSORGATE_DANIEL, OTHER_TENANT)),
    ).toBe(300);
    expect(await store.usedSeconds(actorOf(NOBODY))).toBe(0);
  });
});

describe("the live routes for the trial", () => {
  function server(store: ReturnType<typeof memoryStore>) {
    const line = instance(store);
    const app = Fastify();
    const withContext: onRequestHookHandler = (request, _reply, done) => {
      const user = request.headers["x-test-user"];
      request.actorContext = actorOf(typeof user === "string" ? user : NOBODY);
      done();
    };
    registerLiveVoiceRoutes(app, {
      broker: line.broker,
      withContext,
      binding: () => Promise.resolve(null),
      issue: (request) => binding(request.actorContext ?? TRIAL),
      connect: () => undefined,
      allowedUsers: line.config.allowedUsers,
      preview: { enabled: true, providers: () => ({}) },
    });
    const ask = (method: "GET" | "POST", url: string, user: string) =>
      app.inject({
        method,
        url,
        headers: {
          "x-test-user": user,
          authorization: `Bearer ${user}${"x".repeat(20)}`,
        },
        ...(method === "POST" ? { payload: { sdp: "v=0 offer here" } } : {}),
      });
    return { app, ask };
  }

  it("does not cache a trial's yes while a durable account claim is held", async () => {
    const { app, ask } = server(memoryStore());
    const available = "/v1/q/voice/live/available";
    expect((await ask("GET", available, PARTECH_INVESTOR)).json()).toEqual({
      available: true,
    });
    expect(
      (await ask("POST", "/v1/q/voice/live/sessions", PARTECH_INVESTOR))
        .statusCode,
    ).toBe(201);
    expect((await ask("GET", available, PARTECH_INVESTOR)).json()).toEqual({
      available: false,
    });
    await app.close();
  });

  it("opens for the trial and the allow-list, refuses a spent trial with 429 and its code, 404 for anyone else", async () => {
    const store = memoryStore();
    const { app, ask } = server(store);
    const sessions = "/v1/q/voice/live/sessions";
    const opened = await ask("POST", sessions, PARTECH_INVESTOR);
    expect(opened.statusCode).toBe(201);
    expect(opened.json<{ trial?: unknown }>().trial).toEqual({
      allowanceSeconds: 300,
      remainingSeconds: 300,
    });
    const listed = await ask("POST", sessions, ALLOW_LISTED);
    expect(listed.statusCode).toBe(201);
    expect(listed.json<{ trial?: unknown }>().trial).toBeUndefined();
    expect((await ask("POST", sessions, NOBODY)).statusCode).toBe(404);

    await store.record({
      actor: TRIAL,
      providerSessionId: "live_old",
      voiceSessionId: "line-old",
      seconds: 300,
    });
    const spent = await ask("POST", sessions, TENSORGATE_DANIEL);
    expect(spent.statusCode).toBe(429);
    expect(spent.json<{ code?: string }>().code).toBe(Q_VOICE_LIVE_TRIAL_SPENT);

    const available = "/v1/q/voice/live/available";
    // This account already has an admitted provider line above: it cannot
    // start a fresh unrestricted call while its durable claim is held.
    expect((await ask("GET", available, PARTECH_INVESTOR)).json()).toEqual({
      available: false,
    });
    expect((await ask("GET", available, ALLOW_LISTED)).json()).toEqual({
      available: true,
    });
    expect((await ask("GET", available, TENSORGATE_DANIEL)).json()).toEqual({
      available: false,
    });
    expect((await ask("GET", available, NOBODY)).json()).toEqual({
      available: false,
    });
    // The developer preview stays the allow-list's alone.
    expect(
      (await ask("GET", "/v1/q/voice/live/preview", PARTECH_INVESTOR))
        .statusCode,
    ).toBe(404);
    await app.close();
  });
});

describe("observing a GPT-Live session over the sideband (fake socket)", () => {
  it("passes the session's events on, and reports a lost socket once", () => {
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    const urls: string[] = [];
    const provider = createGptLiveProvider({
      apiKey: "disabled-locally-000000000000",
      sideband: (url) => {
        urls.push(url);
        return {
          readyState: 1,
          send: () => undefined,
          close: () => undefined,
          addEventListener: (type, listener) => {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
          },
        };
      },
    });
    const events: unknown[] = [];
    let lost = 0;
    const watch = provider.observeSession?.("sess_abc123", {
      onEvent: (event) => events.push(event),
      onLost: () => {
        lost += 1;
      },
    });
    const emit = (type: string, event: unknown) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    };
    emit("message", {
      data: JSON.stringify({ type: "input_audio_buffer.speech_started" }),
    });
    emit("message", { data: "not json" });
    emit("close", {});
    emit("close", {});
    expect(urls).toEqual([
      "wss://api.openai.com/v1/live/sessions/sess_abc123/attach",
    ]);
    expect(events).toEqual([{ type: "input_audio_buffer.speech_started" }]);
    expect(lost).toBe(1);
    watch?.stop();
  });
});
