import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QSensitivityClass,
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
import { createLiveBroker } from "../src/voice/live/broker.js";
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
    ).toBe(180_000);
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
    await Promise.resolve();
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

  it("returns an older result stale once a newer delegation exists, and keeps its reference", async () => {
    const { broker, runs, holds } = setup({ hold: true });
    await open(broker);
    const older = ask(broker, "dlg_1", "Top three companies");
    await Promise.resolve();
    const newer = ask(broker, "dlg_2", "What about the second one?");
    await Promise.resolve();
    holds[0]?.resolve();
    holds[1]?.resolve();
    expect((await older)?.stale).toBe(true);
    expect((await newer)?.stale).toBe(false);
    expect(runs).toEqual(["Top three companies", "What about the second one?"]);
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
    await Promise.resolve();
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
