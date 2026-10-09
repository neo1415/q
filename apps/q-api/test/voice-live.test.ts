import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  QConversationIdSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QSensitivityClass,
} from "@capital-q/contracts";
import { createInMemoryModelUsageRepository } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import { spokenFactsOfAttention } from "@capital-q/q-core";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import { createLiveBroker, liveMoveOf } from "../src/voice/live/broker.js";
import { LIVE_DEFAULTS, liveConfigFrom } from "../src/voice/live/config.js";
import { livePrompt } from "../src/voice/live/prompt.js";
import {
  createGptLiveProvider,
  GPT_LIVE_USD_PER_SECOND,
  LiveProviderError,
  type LiveVoiceProvider,
} from "../src/voice/providers/gpt-live.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";
import { APPROVAL_QUESTION } from "../src/voice/turn.js";

/**
 * V: the GPT-Live line. No live provider call: the provider is a fake (or
 * a fake fetch) and the key is a disabled placeholder.
 */

const DISABLED_KEY = "disabled-locally-000000000000";
const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const STRANGER: ActorContext = {
  ...ACTOR,
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
};
const SESSION = "5f000000-0000-4000-8000-000000000001";
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function binding(rehearsal = false): VoiceSessionBinding {
  return {
    voiceSessionId: SESSION,
    providerConversationId: `dg_${SESSION}`,
    actor: ACTOR,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
      ...(rehearsal
        ? { rehearsal: { rehearsalId: "6f000000-0000-4000-8000-000000000001" } }
        : {}),
    },
    issuedAt: 0,
    connectBy: 1,
    connectedAt: 0,
  };
}

function firewall(
  options: { deny?: boolean; sensitivity?: QSensitivityClass } = {},
): ContextFirewallPort {
  return {
    plan: (request) =>
      Promise.resolve(
        options.deny === true
          ? { outcome: "DENIED", reason: "NO_AUTHORISED_CONTEXT", denied: [] }
          : {
              outcome: "AUTHORISED",
              plan: PermittedContextPlanSchema.parse({
                contractVersion: 1,
                policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
                planId: randomUUID(),
                fingerprint: "0".repeat(64),
                runId: request.runId,
                tenantId: ACTOR.tenantId,
                actor: {
                  userId: ACTOR.userId,
                  organisationId: ACTOR.organisationId,
                },
                purpose: {
                  capability: "ANSWER",
                  taskClass: "GENERAL_QUESTION",
                },
                subjects: [],
                scopes: [],
                denied: [],
                maxSensitivity: options.sensitivity ?? "PUBLIC",
                allowedLayers: [],
                combinationConstraints: [],
                evaluatedAt: new Date().toISOString(),
                revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
                revalidateOnResume: true,
              }),
            },
      ),
  };
}

type Deferred = { resolve: () => void };

function setup(
  options: {
    deny?: boolean;
    sensitivity?: QSensitivityClass;
    synthetic?: boolean;
    spent?: number;
    answer?: string;
    hold?: boolean;
  } = {},
) {
  let clock = 1_000_000;
  const runs: string[] = [];
  const holds: Deferred[] = [];
  const created: { sdp: string; instructions: string; voice: string }[] = [];
  const provider: LiveVoiceProvider = {
    providerId: "a1000000-0000-4000-8000-000000000003",
    modelId: "a2000000-0000-4000-8000-000000000022",
    createWebRtcSession: ({ config, sdp }) => {
      created.push({
        sdp,
        instructions: config.instructions,
        voice: config.voice,
      });
      return Promise.resolve({
        sessionId: "live_fake",
        sdp: "v=0 answer",
        model: "gpt-live-1",
      });
    },
  };
  const turn: VoiceTurnHandler = async (
    _binding,
    transcript,
    signal,
    speaker,
  ) => {
    const last = transcript[transcript.length - 1];
    runs.push(last?.content ?? "");
    if (options.hold === true) {
      await new Promise<void>((resolve) => {
        holds.push({ resolve });
        signal.addEventListener("abort", () => {
          resolve();
        });
      });
      if (signal.aborted) return { kind: "INTERRUPTED", path: "Q" };
    }
    await speaker.speak(options.answer ?? `Answer to ${last?.content ?? ""}.`);
    return { kind: "SPOKEN", path: "Q" };
  };
  const usage = createInMemoryModelUsageRepository();
  const broker = createLiveBroker({
    config: { ...LIVE_DEFAULTS, enabled: true },
    provider,
    firewall: firewall(options),
    turn,
    spend: { spentTodayUsd: () => Promise.resolve(options.spent ?? 0) },
    usage,
    providerCeiling: "PUBLIC",
    syntheticDemo: options.synthetic === true,
    logger,
    now: () => clock,
  });
  return {
    broker,
    runs,
    holds,
    created,
    usage,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const open = (broker: ReturnType<typeof setup>["broker"], rehearsal = false) =>
  broker.open({ binding: binding(rehearsal), sdp: "v=0 offer" });

const ask = (
  broker: ReturnType<typeof setup>["broker"],
  delegationId: string,
  request: string,
  actor: ActorContext = ACTOR,
) =>
  broker.delegate({
    actor,
    voiceSessionId: SESSION,
    delegation: { delegationId, request },
  });

const TENSORGATE = "0f2a6a0e-4b1c-4c3d-8e5f-6a7b8c9d0e1f";

describe("GPT-Live provider adapter", () => {
  it("posts the SDP offer with the session and client delegation, key in the header only", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const bodyOf = (init: RequestInit | undefined) =>
      typeof init?.body === "string" ? init.body : "";
    const provider = createGptLiveProvider({
      apiKey: DISABLED_KEY,
      fetch: (url, init) => {
        calls.push({
          url:
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.href
                : url.url,
          init: init ?? {},
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: { id: "live_1", model: "gpt-live-1" },
              transport: { sdp: "v=0 answer sdp" },
            }),
            { status: 201 },
          ),
        );
      },
    });
    const session = await provider.createWebRtcSession({
      config: { instructions: "Be Q.", voice: "marin" },
      sdp: "v=0 offer sdp",
    });
    expect(session).toEqual({
      sessionId: "live_1",
      sdp: "v=0 answer sdp",
      model: "gpt-live-1",
    });
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/live/sessions");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${DISABLED_KEY}`);
    const body = JSON.parse(bodyOf(calls[0]?.init)) as Record<string, unknown>;
    expect(body).toEqual({
      session: {
        model: "gpt-live-1",
        instructions: "Be Q.",
        audio: { output: { voice: "marin" } },
        delegation: { type: "client" },
      },
      transport: { type: "webrtc", sdp: "v=0 offer sdp" },
    });
    expect(bodyOf(calls[0]?.init)).not.toContain(DISABLED_KEY);
  });

  it("maps a refusal to a status without the provider's body", async () => {
    const provider = createGptLiveProvider({
      apiKey: DISABLED_KEY,
      fetch: () =>
        Promise.resolve(
          new Response('{"error":{"message":"secret detail"}}', {
            status: 401,
          }),
        ),
    });
    const failure = await provider
      .createWebRtcSession({
        config: { instructions: "x", voice: "marin" },
        sdp: "v=0 offer sdp",
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveProviderError);
    expect((failure as LiveProviderError).status).toBe(401);
    expect((failure as Error).message).not.toContain("secret detail");
  });

  it("never fills in a model the provider did not report", async () => {
    const provider = createGptLiveProvider({
      apiKey: DISABLED_KEY,
      fetch: () =>
        Promise.resolve(
          Response.json(
            { session: { id: "live_2" }, transport: { sdp: "v=0 answer sdp" } },
            { status: 201 },
          ),
        ),
    });
    const session = await provider.createWebRtcSession({
      config: { instructions: "x", voice: "marin" },
      sdp: "v=0 offer sdp",
    });
    expect(session.model).toBeNull();
  });

  it("refuses an unreadable answer", async () => {
    const provider = createGptLiveProvider({
      apiKey: DISABLED_KEY,
      fetch: () =>
        Promise.resolve(new Response('{"session":{}}', { status: 201 })),
    });
    await expect(
      provider.createWebRtcSession({
        config: { instructions: "x", voice: "marin" },
        sdp: "v=0 offer sdp",
      }),
    ).rejects.toBeInstanceOf(LiveProviderError);
  });
});

describe("GPT-Live prompt", () => {
  it("has the three policies and no scripted filler", () => {
    const prompt = livePrompt({ role: "investor" });
    for (const heading of [
      "Backchannel policy:",
      "Interruption policy:",
      "Delegation policy:",
      "Backend tools:",
      "Delegate to the backend when:",
      "Do not delegate to the backend when:",
    ]) {
      expect(prompt).toContain(heading);
    }
    expect(prompt).toContain("always speak natural, standard English");
    expect(prompt).toContain("Never switch into Pidgin");
    expect(prompt).not.toContain("Call opening:");
    expect(prompt).toContain("laugh naturally and lightly");
    expect(prompt).toContain("Never leave them in silence");
    expect(prompt).toContain("no invented idioms");
    expect(prompt).toContain("still waiting");
  });

  it("opens with a warm hello and the delegated briefing when asked", () => {
    const prompt = livePrompt({ briefingOpening: true, firstName: "Amaka" });
    expect(prompt).toContain("Call opening:");
    expect(prompt).toContain('"Amaka"');
  });
});

describe("GPT-Live config", () => {
  it("is off by default, caps are bounded, and the preview is local-only", () => {
    expect(liveConfigFrom({}, "local").enabled).toBe(false);
    expect(
      liveConfigFrom({ CQ_VOICE_LIVE_MAX_SESSION_SECONDS: "99999" }, "local")
        .maxSessionMs,
    ).toBe(20 * 60_000);
    expect(
      liveConfigFrom({ CQ_VOICE_LIVE_MAX_SESSION_SECONDS: "3600" }, "local")
        .maxSessionMs,
    ).toBe(60 * 60_000);
    expect(liveConfigFrom({}, "local").idleMs).toBe(180_000);
    expect(liveConfigFrom({}, "local").delegationDeadlineMs).toBe(90_000);
    expect(liveConfigFrom({ CQ_VOICE_PREVIEW: "on" }, "local").preview).toBe(
      true,
    );
    expect(
      liveConfigFrom({ CQ_VOICE_PREVIEW: "on" }, "production").preview,
    ).toBe(false);
    expect(liveConfigFrom({ CQ_VOICE_PREVIEW: "on" }, "staging").preview).toBe(
      false,
    );
    expect(liveConfigFrom({}, "local").preview).toBe(false);
  });

  it("outside a local deployment opens only to the named people", () => {
    const FOUNDER = "a0000000-0000-4000-8000-0000000000f1";
    // Switched on with nobody named: nobody may open a paid line.
    const nobody = liveConfigFrom({ CQ_VOICE_LIVE: "on" }, "staging");
    expect(nobody.allowedUsers?.size).toBe(0);
    expect(nobody.preview).toBe(false);
    const named = liveConfigFrom(
      {
        CQ_VOICE_LIVE: "on",
        CQ_VOICE_PREVIEW: "on",
        CQ_VOICE_LIVE_USERS: ` ${FOUNDER.toUpperCase()} , not-an-id`,
      },
      "staging",
    );
    expect([...(named.allowedUsers ?? [])]).toEqual([FOUNDER]);
    expect(named.preview).toBe(true);
    // A local deployment: anyone signed in, as before.
    expect(liveConfigFrom({ CQ_VOICE_LIVE: "on" }, "local").allowedUsers).toBe(
      null,
    );
  });
});

describe("GPT-Live line", () => {
  it("opens with the SDP answer and the provider's model", async () => {
    const { broker, created } = setup();
    const opened = await open(broker);
    expect(opened.kind).toBe("OPEN");
    if (opened.kind !== "OPEN") return;
    expect(opened.result).toMatchObject({
      sdp: "v=0 answer",
      model: "gpt-live-1",
      provider: "openai",
    });
    expect(created[0]?.voice).toBe("marin");
    expect(created[0]?.instructions).toContain("Delegation policy:");
  });

  it("refuses a rehearsal, a denied plan, an ineligible plan and a spent cap", async () => {
    expect((await open(setup().broker, true)).kind).toBe("REFUSED");
    expect(await open(setup({ deny: true }).broker)).toEqual({
      kind: "REFUSED",
      reason: "DENIED",
    });
    expect(await open(setup({ sensitivity: "CONFIDENTIAL" }).broker)).toEqual({
      kind: "REFUSED",
      reason: "INELIGIBLE",
    });
    expect(
      (
        await open(
          setup({ sensitivity: "CONFIDENTIAL", synthetic: true }).broker,
        )
      ).kind,
    ).toBe("OPEN");
    expect(await open(setup({ spent: 0.99 }).broker)).toEqual({
      kind: "REFUSED",
      reason: "CAP_REACHED",
    });
  });

  it("runs Q once per delegation id, however often it is repeated", async () => {
    const { broker, runs, holds } = setup({ hold: true });
    await open(broker);
    const first = ask(broker, "dlg_1", "What are the top three companies?");
    const repeat = ask(broker, "dlg_1", "What are the top three companies?");
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(runs).toEqual(["What are the top three companies?"]);
    holds[0]?.resolve();
    const [a, b] = await Promise.all([first, repeat]);
    expect(a?.commentary).toContain(
      "Answer to What are the top three companies?",
    );
    expect(b).toEqual(a);
    expect(runs).toHaveLength(1);
    // After it settled, the same id still never starts a second run.
    await ask(broker, "dlg_1", "What are the top three companies?");
    expect(runs).toHaveLength(1);
  });

  it("queues a newer delegation behind the running one, so the slow answer is never cancelled", async () => {
    const { broker, runs, holds } = setup({ hold: true });
    await open(broker);
    const older = ask(broker, "dlg_1", "Give me three good examples");
    await Promise.resolve();
    const newer = ask(broker, "dlg_2", "Still waiting, can you do it?");
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    // The nudge has not started a run over the slow one.
    expect(runs).toEqual(["Give me three good examples"]);
    holds[0]?.resolve();
    const first = await older;
    expect(first?.failed).toBe(false);
    expect(first?.commentary).toContain("Give me three good examples");
    // Marked stale (a newer one exists): the client still speaks it while
    // the newer one is pending.
    expect(first?.stale).toBe(true);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(runs).toEqual([
      "Give me three good examples",
      "Still waiting, can you do it?",
    ]);
    holds[1]?.resolve();
    expect((await newer)?.stale).toBe(false);
  });

  it("cancels a queued delegation without ever running it", async () => {
    const { broker, runs, holds } = setup({ hold: true });
    await open(broker);
    const first = ask(broker, "dlg_1", "Research Ajopot");
    await Promise.resolve();
    const queued = ask(broker, "dlg_2", "Research Ledgerfold");
    await Promise.resolve();
    const cancelling = broker.cancel({
      actor: ACTOR,
      voiceSessionId: SESSION,
      delegationId: "dlg_2",
    });
    holds[0]?.resolve();
    await first;
    expect(await cancelling).toBe(true);
    expect((await queued)?.failed).toBe(true);
    expect(runs).toEqual(["Research Ajopot"]);
  });

  it("closes the line when today's spend cap is reached mid-call", async () => {
    let spent = 0;
    const usage = createInMemoryModelUsageRepository();
    const broker = createLiveBroker({
      config: { ...LIVE_DEFAULTS, enabled: true, dailyCapUsd: 1 },
      provider: {
        providerId: "p",
        modelId: "m",
        createWebRtcSession: () =>
          Promise.resolve({
            sessionId: "s",
            sdp: "v=0 a",
            model: "gpt-live-1",
          }),
      },
      firewall: firewall(),
      turn: () => Promise.resolve({ kind: "NOTHING" }),
      spend: { spentTodayUsd: () => Promise.resolve(spent) },
      usage,
      providerCeiling: "PUBLIC",
      syntheticDemo: false,
      logger,
    });
    await broker.open({ binding: binding(), sdp: "v=0 offer" });
    const fine = await broker.usage({
      actor: ACTOR,
      voiceSessionId: SESSION,
      report: { seconds: 30 },
    });
    expect(fine?.capReached).toBeUndefined();
    expect(fine?.remainingMs).toBeGreaterThan(0);
    spent = 1.2;
    const capped = await broker.usage({
      actor: ACTOR,
      voiceSessionId: SESSION,
      report: { seconds: 60 },
    });
    expect(capped).toMatchObject({ capReached: true, remainingMs: 0 });
  });

  it("says when the provider refused for quota, so the client skips every OpenAI line", async () => {
    const refusing = (status: number) =>
      createLiveBroker({
        config: { ...LIVE_DEFAULTS, enabled: true },
        provider: {
          providerId: "p",
          modelId: "m",
          createWebRtcSession: () =>
            Promise.reject(new LiveProviderError("refused", status)),
        },
        firewall: firewall(),
        turn: () => Promise.resolve({ kind: "NOTHING" }),
        spend: { spentTodayUsd: () => Promise.resolve(0) },
        usage: createInMemoryModelUsageRepository(),
        providerCeiling: "PUBLIC",
        syntheticDemo: false,
        logger,
      });
    expect(await open(refusing(429))).toEqual({
      kind: "REFUSED",
      reason: "PROVIDER_QUOTA",
    });
    expect(await open(refusing(500))).toEqual({
      kind: "REFUSED",
      reason: "PROVIDER_UNAVAILABLE",
    });
  });

  it("runs the onboarding interview through its own turn handler, guided", async () => {
    const instructions: string[] = [];
    const threads: unknown[] = [];
    const broker = createLiveBroker({
      config: { ...LIVE_DEFAULTS, enabled: true },
      provider: {
        providerId: "p",
        modelId: "m",
        createWebRtcSession: ({ config }) => {
          instructions.push(config.instructions);
          return Promise.resolve({
            sessionId: "s",
            sdp: "v=0 a",
            model: "gpt-live-1",
          });
        },
      },
      firewall: firewall(),
      // The same handler the standard line uses: an onboarding binding is
      // routed to the interview there (turn.ts, path INTERVIEW).
      turn: async (bound, _transcript, _signal, speaker) => {
        threads.push(bound.thread.onboarding);
        await speaker.speak("Great. What does your company do?");
        return { kind: "SPOKEN", path: "INTERVIEW" };
      },
      spend: { spentTodayUsd: () => Promise.resolve(0) },
      usage: createInMemoryModelUsageRepository(),
      providerCeiling: "PUBLIC",
      syntheticDemo: false,
      logger,
    });
    const onboarding = {
      sessionId: "7f000000-0000-4000-8000-000000000001",
      journeyType: "founder" as const,
    };
    await broker.open({
      binding: { ...binding(), thread: { ...binding().thread, onboarding } },
      sdp: "v=0 offer",
    });
    expect(instructions[0]).toContain("Guided call:");
    const result = await ask(broker, "dlg_1", "We're called Ledgerfold.");
    expect(threads).toEqual([onboarding]);
    expect(result?.commentary).toContain("What does your company do?");
  });

  it("puts the person's names into the session instructions", async () => {
    const { broker, created } = setup();
    await broker.open({
      binding: binding(),
      sdp: "v=0 offer",
      names: ["Tensorgate", "Ledgerline", "Tensorgate"],
    });
    expect(created[0]?.instructions).toContain('"Tensorgate", "Ledgerline"');
  });

  it("never tells the person it ran out of time", async () => {
    const { broker, tick } = setup({ hold: true });
    void tick;
    await open(broker);
    const result = ask(broker, "dlg_1", "Three examples");
    await Promise.resolve();
    await broker.cancel({
      actor: ACTOR,
      voiceSessionId: SESSION,
      delegationId: "dlg_1",
    });
    const settled = await result;
    expect(settled?.commentary ?? "").not.toMatch(/in time/i);
  });

  it("carries the line's own history into the next run", async () => {
    const seen: string[][] = [];
    const { broker } = setup();
    // Spy through a second line with a recording turn.
    const recording = createLiveBroker({
      config: { ...LIVE_DEFAULTS, enabled: true },
      provider: {
        providerId: "p",
        modelId: "m",
        createWebRtcSession: () =>
          Promise.resolve({
            sessionId: "s",
            sdp: "v=0 a",
            model: "gpt-live-1",
          }),
      },
      firewall: firewall(),
      turn: async (_b, transcript, _s, speaker) => {
        seen.push(transcript.map((t) => `${t.role}:${t.content}`));
        await speaker.speak("Ledgerfold, Ajopot and Maji Loop.");
        return { kind: "SPOKEN", path: "Q" };
      },
      spend: { spentTodayUsd: () => Promise.resolve(0) },
      usage: createInMemoryModelUsageRepository(),
      providerCeiling: "PUBLIC",
      syntheticDemo: false,
      logger,
    });
    void broker;
    await recording.open({ binding: binding(), sdp: "v=0 offer" });
    await ask(recording, "dlg_1", "Top three");
    await ask(recording, "dlg_2", "Wait, what about the second one?");
    expect(seen[1]).toEqual([
      "user:Top three",
      "agent:Ledgerfold, Ajopot and Maji Loop.",
      "user:Wait, what about the second one?",
    ]);
  });

  it("keeps running when the caller lets go, and cancels only on request, confirmed", async () => {
    const { broker, holds } = setup({ hold: true });
    await open(broker);
    const pending = ask(broker, "dlg_1", "Research Ajopot");
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(holds).toHaveLength(1);
    const cancelled = await broker.cancel({
      actor: ACTOR,
      voiceSessionId: SESSION,
      delegationId: "dlg_1",
    });
    expect(cancelled).toBe(true);
    expect((await pending)?.failed).toBe(true);
    expect(
      await broker.cancel({
        actor: ACTOR,
        voiceSessionId: SESSION,
        delegationId: "dlg_1",
      }),
    ).toBe(false);
  });

  it("speaks an attention briefing in its spoken form: never a counterpart's quoted message", async () => {
    const facts = spokenFactsOfAttention({
      items: [
        {
          key: "msg-1",
          source: "UNANSWERED_MESSAGE",
          title: "Spheros is waiting for your reply",
          note: 'They wrote: "Thanks so much, the rest is on your screen"',
          counterpart: "Spheros",
          since: "2026-10-09T07:00:00.000Z",
          decidable: false,
        },
        {
          key: "msg-2",
          source: "UNANSWERED_MESSAGE",
          title: "Shiftwell messaged you",
          note: 'They wrote: "Quick question about the mandate fit"',
          counterpart: "Shiftwell",
          since: "2026-10-09T07:00:00.000Z",
          decidable: false,
        },
      ],
      activity: null,
      unread: [],
      readAt: "2026-10-09T07:00:00.000Z",
    });
    const broker = createLiveBroker({
      config: { ...LIVE_DEFAULTS, enabled: true },
      provider: {
        providerId: "p",
        modelId: "m",
        createWebRtcSession: () =>
          Promise.resolve({
            sessionId: "s",
            sdp: "v=0 a",
            model: "gpt-live-1",
          }),
      },
      firewall: firewall(),
      // The voice turn hands a code-built answer to a speaker that speaks
      // in its own words as facts (turn.ts fromFacts), and the written
      // answer, quotes and all, as the fact-built line alongside.
      turn: async (_b, _t, _s, speaker) => {
        speaker.facts?.(facts);
        await speaker.speak(
          'Spheros is waiting for your reply. They wrote: "Thanks so much, the rest is on your screen".',
        );
        return { kind: "SPOKEN", path: "Q" };
      },
      spend: { spentTodayUsd: () => Promise.resolve(0) },
      usage: createInMemoryModelUsageRepository(),
      providerCeiling: "PUBLIC",
      syntheticDemo: false,
      logger,
    });
    await broker.open({ binding: binding(), sdp: "v=0 offer" });
    const result = await ask(broker, "dlg_1", "What needs my attention today?");
    const said = result?.commentary ?? "";
    expect(said).toContain("Spheros");
    expect(said).toContain("Shiftwell");
    expect(said).not.toMatch(
      /Thanks so much|rest is on your screen|Quick question|They wrote/u,
    );
  });

  it("says when the run moved the screen (the board's move for this turn), and only then", async () => {
    let board = {
      sequence: 4,
      navigate: null as string | null,
      clientActions: [] as unknown[],
    };
    const broker = createLiveBroker({
      config: { ...LIVE_DEFAULTS, enabled: true },
      provider: {
        providerId: "p",
        modelId: "m",
        createWebRtcSession: () =>
          Promise.resolve({
            sessionId: "s",
            sdp: "v=0 a",
            model: "gpt-live-1",
          }),
      },
      firewall: firewall(),
      turn: async (_b, transcript, _s, speaker) => {
        const asked = transcript[transcript.length - 1]?.content ?? "";
        // The turn handler records its move on the board, as turn.ts does.
        board = asked.startsWith("Open")
          ? {
              sequence: board.sequence + 1,
              navigate: null,
              clientActions: [
                { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: TENSORGATE },
              ],
            }
          : { sequence: board.sequence + 1, navigate: null, clientActions: [] };
        await speaker.speak("Opening Tensorgate.");
        return { kind: "SPOKEN", path: "MOVE" };
      },
      spend: { spentTodayUsd: () => Promise.resolve(0) },
      usage: createInMemoryModelUsageRepository(),
      providerCeiling: "PUBLIC",
      syntheticDemo: false,
      logger,
      board: { read: () => board },
    });
    await broker.open({ binding: binding(), sdp: "v=0 offer" });
    expect((await ask(broker, "dlg_1", "Open Tensorgate"))?.move).toEqual({
      navigate: null,
      action: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: TENSORGATE },
    });
    expect(
      (await ask(broker, "dlg_2", "Tell me about it"))?.move,
    ).toBeUndefined();
  });

  it("a data-room document opened in the viewer is not a move the voice waits on", () => {
    const doc = {
      kind: "OPEN_RECORD_PAGE",
      page: "DATA_ROOM_DOCUMENT",
      id: TENSORGATE,
      companyId: TENSORGATE,
    };
    expect(liveMoveOf({ navigate: null, clientActions: [doc] })).toBeNull();
    expect(liveMoveOf({ navigate: null, clientAction: doc })).toBeNull();
    // A route move and then a document: the route is still the move.
    expect(
      liveMoveOf({
        navigate: "DISCOVER",
        clientActions: [doc, { kind: "SET_THEME", theme: "dark" }],
      }),
    ).toEqual({ navigate: "DISCOVER", action: null });
    // Not a valid intent: never a move.
    expect(
      liveMoveOf({
        navigate: "NOWHERE",
        clientActions: [{ kind: "OPEN_RECORD_PAGE" }],
      }),
    ).toBeNull();
  });

  it("stores the line's final transcript, both sides, routed 'live', as the person on it", async () => {
    let clock = 5_000_000;
    const stored: {
      actor: ActorContext;
      voiceSessionId: string;
      conversationId: string | null;
      role: string;
      content: string;
      routed: string;
      spokenAt: Date;
    }[] = [];
    const conversation = QConversationIdSchema.parse(
      "7f000000-0000-4000-8000-000000000001",
    );
    const broker = createLiveBroker({
      config: { ...LIVE_DEFAULTS, enabled: true },
      provider: {
        providerId: "p",
        modelId: "m",
        createWebRtcSession: () =>
          Promise.resolve({ sessionId: "s", sdp: "v=0 a", model: null }),
      },
      firewall: firewall(),
      turn: () => Promise.resolve({ kind: "SPOKEN", path: "Q" }),
      spend: { spentTodayUsd: () => Promise.resolve(0) },
      usage: createInMemoryModelUsageRepository(),
      providerCeiling: "PUBLIC",
      syntheticDemo: false,
      logger,
      now: () => clock,
      transcripts: {
        record: (entry) => {
          stored.push({ ...entry });
          return Promise.resolve();
        },
      },
    });
    const line = binding();
    await broker.open({
      binding: {
        ...line,
        thread: { ...line.thread, conversationId: conversation },
      },
      sdp: "v=0 offer",
    });
    clock += 10_000;
    const recorded = await broker.transcript({
      actor: ACTOR,
      voiceSessionId: SESSION,
      report: {
        segments: [
          { role: "USER", text: "Open Tensorgate", at: clock - 4_000 },
          { role: "Q", text: "Tensorgate is open now.", at: clock - 3_000 },
          // A browser clock before the line or ahead of the server: clamped.
          { role: "Q", text: "Anything else?", at: 1 },
          { role: "USER", text: "No thanks", at: clock + 99_000 },
        ],
      },
    });
    expect(recorded).toBe(4);
    expect(stored.map((one) => [one.role, one.content, one.routed])).toEqual([
      ["USER", "Open Tensorgate", "live"],
      ["Q", "Tensorgate is open now.", "live"],
      ["Q", "Anything else?", "live"],
      ["USER", "No thanks", "live"],
    ]);
    for (const one of stored) {
      expect(one.actor).toEqual(ACTOR);
      expect(one.voiceSessionId).toBe(SESSION);
      expect(one.conversationId).toBe(conversation);
    }
    expect(stored[2]?.spokenAt.getTime()).toBe(5_000_000);
    expect(stored[3]?.spokenAt.getTime()).toBe(clock);
    // Someone else's line, or a line that is gone: nothing is stored.
    const before = stored.length;
    expect(
      await broker.transcript({
        actor: STRANGER,
        voiceSessionId: SESSION,
        report: { segments: [{ role: "USER", text: "hi", at: clock }] },
      }),
    ).toBeNull();
    broker.end({ actor: ACTOR, voiceSessionId: SESSION, reason: "ended" });
    expect(
      await broker.transcript({
        actor: ACTOR,
        voiceSessionId: SESSION,
        report: { segments: [{ role: "USER", text: "hi", at: clock }] },
      }),
    ).toBeNull();
    expect(stored).toHaveLength(before);
  });

  it("marks an approval as waiting, never done", async () => {
    const { broker } = setup({
      answer: `I've drafted the intro to Savanna Seed. ${APPROVAL_QUESTION}`,
    });
    await open(broker);
    const result = await ask(broker, "dlg_1", "Send an intro to Savanna Seed");
    expect(result?.approvalPending).toBe(true);
    expect(result?.commentary).toContain("never say it is done");
    expect(result?.commentary).not.toContain(APPROVAL_QUESTION);
  });

  it("is someone else's line: the same as no line", async () => {
    const { broker } = setup();
    await open(broker);
    expect(await ask(broker, "dlg_1", "Top three", STRANGER)).toBeNull();
    expect(
      await broker.cancel({
        actor: STRANGER,
        voiceSessionId: SESSION,
        delegationId: "dlg_1",
      }),
    ).toBeNull();
    expect(
      await broker.usage({
        actor: STRANGER,
        voiceSessionId: SESSION,
        report: { seconds: 10 },
      }),
    ).toBeNull();
    expect(
      broker.end({ actor: STRANGER, voiceSessionId: SESSION, reason: "x" }),
    ).toBe(false);
  });

  it("refuses delegations past the hard cap and tells the client to close", async () => {
    const { broker, runs, tick } = setup();
    await open(broker);
    tick(LIVE_DEFAULTS.maxSessionMs + 1);
    const result = await ask(broker, "dlg_1", "Top three");
    expect(result).toMatchObject({ ended: true, commentary: null });
    expect(runs).toHaveLength(0);
  });

  it("records billed seconds once, at the per-second price, on the realtime ledger", async () => {
    const { broker, usage } = setup();
    await open(broker);
    await broker.usage({
      actor: ACTOR,
      voiceSessionId: SESSION,
      report: { seconds: 20 },
    });
    await broker.usage({
      actor: ACTOR,
      voiceSessionId: SESSION,
      report: { seconds: 20 },
    });
    const final = await broker.usage({
      actor: ACTOR,
      voiceSessionId: SESSION,
      report: { seconds: 31, final: true },
    });
    expect(final?.recordedSeconds).toBe(31);
    expect(usage.entries).toHaveLength(2);
    expect(usage.entries.every((e) => e.purpose === "VOICE_REALTIME")).toBe(
      true,
    );
    const cost = usage.entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
    expect(cost).toBeCloseTo(31 * GPT_LIVE_USD_PER_SECOND, 6);
    // Ending after a final report adds nothing.
    broker.end({ actor: ACTOR, voiceSessionId: SESSION, reason: "done" });
    expect(usage.entries).toHaveLength(2);
  });

  it("bills an unreported line at wall-clock: unknown spend is not zero", async () => {
    const { broker, usage, tick } = setup();
    await open(broker);
    tick(40_000);
    broker.end({ actor: ACTOR, voiceSessionId: SESSION, reason: "gone" });
    await Promise.resolve();
    expect(usage.entries[0]?.costUsd).toBeCloseTo(
      40 * GPT_LIVE_USD_PER_SECOND,
      6,
    );
  });
});
