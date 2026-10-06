import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
  type QSensitivityClass,
} from "@capital-q/contracts";
import { createInMemoryModelUsageRepository } from "@capital-q/model-gateway";
import {
  createRealtimeVoiceGateway,
  type RealtimeMintRequest,
  type RealtimeSessionProvider,
} from "@capital-q/model-gateway/realtime";
import { OPENAI_REALTIME_MINI_PRICES } from "@capital-q/model-gateway/realtime/openai";
import { createLogger } from "@capital-q/observability";
import {
  quoteOccursIn,
  type MemoryItem,
  type MemoryService,
  type RememberCommand,
} from "@capital-q/q-knowledge";
import type {
  ContextFirewallPort,
  ContextFirewallRequest,
} from "@capital-q/q-runtime";
import {
  allow,
  createQToolExecutor,
  deny,
  createQToolRegistry,
  defineQTool,
  type AnyQToolDefinition,
} from "@capital-q/q-tools";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import type { VoiceSessionBinding } from "../src/voice/bindings.js";
import {
  createDuplexBroker,
  DUPLEX_CAP_NOTICE,
  type DuplexBrokerDependencies,
} from "../src/voice/duplex/broker.js";
import {
  DUPLEX_DEFAULTS,
  duplexConfigFrom,
} from "../src/voice/duplex/config.js";
import {
  DUPLEX_INSTRUCTIONS_PREFIX,
  GUIDED_CONDUCT,
} from "../src/voice/duplex/instructions.js";
import {
  createMemoryListeningStore,
  LISTENING_MEMORY_KEY,
  nextListeningLevel,
  type DuplexListeningStore,
} from "../src/voice/duplex/listening.js";
import { utteranceRefOf } from "../src/voice/utterance.js";
import { utcDayStart } from "../src/voice/duplex/spend.js";
import type { VoiceTurnHandler } from "../src/voice/turn.js";

/**
 * DUPLEX: the full-duplex broker. Fakes for the provider, the ledger and
 * the turn handler; the real Tool Registry and executor, so a relayed call
 * is shown to pass through authorize. No live provider call: the realtime
 * adapter here is a fake and the key is never read.
 */

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

const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function planFor(
  runId: string,
  maxSensitivity: QSensitivityClass = "PUBLIC",
): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId: ACTOR.tenantId,
    actor: { userId: ACTOR.userId, organisationId: ACTOR.organisationId },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity,
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

function readTool(
  providerName: string,
  authorizeCalls: string[],
  permitted = true,
): AnyQToolDefinition {
  return defineQTool<{ readonly q: string }, { readonly echo: string }, null>({
    id: `test.${providerName}`,
    version: 1,
    status: "ACTIVE",
    providerName,
    description: "Echoes.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: ["GENERAL_QUESTION"],
    requiredScopeKinds: [],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "test",
    visibleStage: null,
    input: z.object({ q: z.string().max(10) }).strict(),
    output: z.object({ echo: z.string() }).strict(),
    authorize: () => {
      authorizeCalls.push(providerName);
      return Promise.resolve(
        permitted
          ? allow<null>("PUBLIC", null)
          : deny<null>("NOT_AVAILABLE", "Not for you."),
      );
    },
    execute: (input) => Promise.resolve({ echo: input.q }),
  });
}

function binding(rehearsal = false): VoiceSessionBinding {
  return {
    voiceSessionId: "5f000000-0000-4000-8000-000000000001",
    providerConversationId: "dg_5f000000-0000-4000-8000-000000000001",
    actor: ACTOR,
    accessToken: "eyPRIVATE.bearer",
    voice: "FEMALE",
    thread: {
      conversationId: undefined,
      subjects: undefined,
      onboarding: undefined,
      ...(rehearsal
        ? {
            rehearsal: {
              rehearsalId: "6f000000-0000-4000-8000-000000000001",
            },
          }
        : {}),
    },
    issuedAt: 0,
    connectBy: 1,
    connectedAt: 0,
  };
}

function harness(
  options: {
    readonly enabled?: boolean;
    readonly spent?: number | (() => number);
    readonly ledgerThrows?: boolean;
    readonly deny?: boolean;
    readonly maxSensitivity?: QSensitivityClass;
    readonly turn?: VoiceTurnHandler;
    readonly allowDirect?: boolean;
    readonly recordThrows?: boolean;
    readonly backchannel?: boolean;
    readonly listening?: DuplexListeningStore;
  } = {},
) {
  const order: string[] = [];
  const authorizeCalls: string[] = [];
  const mints: RealtimeMintRequest[] = [];
  const firewallRequests: ContextFirewallRequest[] = [];
  let clock = 1_000_000;
  const provider: RealtimeSessionProvider = {
    code: "fake",
    modelCode: "fake-realtime",
    providerId: "a1000000-0000-4000-8000-000000000003",
    modelId: "a2000000-0000-4000-8000-000000000022",
    prices: OPENAI_REALTIME_MINI_PRICES,
    mint: () => {
      order.push("mint");
      return Promise.resolve({
        clientSecret: "ek_fake_secret",
        expiresAt: new Date(clock + 60_000),
        callsUrl: "https://realtime.invalid/v1/realtime/calls",
      });
    },
  };
  const usage = createInMemoryModelUsageRepository();
  const gateway = createRealtimeVoiceGateway({
    provider,
    enabled: true,
    providerCeiling: "PUBLIC",
    usage: options.recordThrows
      ? { record: () => Promise.reject(new Error("db down")) }
      : usage,
  });
  const realMint = gateway.mint;
  const firewall: ContextFirewallPort = {
    plan: (request) => {
      order.push("firewall");
      firewallRequests.push(request);
      return Promise.resolve(
        options.deny === true
          ? {
              outcome: "DENIED",
              reason: "NO_AUTHORISED_CONTEXT",
              denied: [],
            }
          : {
              outcome: "AUTHORISED",
              plan: planFor(request.runId, options.maxSensitivity),
            },
      );
    },
  };
  const registry = createQToolRegistry([
    readTool("get_thing", authorizeCalls, options.allowDirect ?? true),
  ]);
  const executor = createQToolExecutor({ registry });
  const execute = vi.fn(executor.execute);
  // The registry refuses non-read tools by construction; a PREPARE tool is
  // added to the offer here to prove the broker filters by class itself.
  const tools = {
    offer: async (context: Parameters<typeof executor.offer>[0]) => [
      ...(await executor.offer(context)),
      {
        toolName: "test.propose_thing",
        toolVersion: 1,
        classification: "PREPARE" as const,
        definition: {
          name: "propose_thing",
          description: "Prepares.",
          inputJsonSchema: { type: "object" },
        },
        visibleStage: null,
      },
    ],
    execute,
  };
  const turn: VoiceTurnHandler =
    options.turn ??
    vi.fn<VoiceTurnHandler>(async (_binding, transcript, _signal, speaker) => {
      await speaker.speak(`Heard: ${transcript.at(-1)?.content ?? ""}`);
      return { kind: "SPOKEN", path: "Q" } as const;
    });
  const spent = options.spent ?? 0;
  const dependencies: DuplexBrokerDependencies = {
    config: {
      ...DUPLEX_DEFAULTS,
      enabled: options.enabled ?? true,
      backchannel: options.backchannel ?? true,
    },
    ...(options.listening === undefined
      ? {}
      : { listening: options.listening }),
    gateway: {
      ...gateway,
      mint: (request) => {
        mints.push(request);
        return realMint(request);
      },
    },
    firewall,
    tools,
    turn,
    spend: {
      spentTodayUsd: () => {
        order.push("ledger");
        if (options.ledgerThrows === true)
          return Promise.reject(new Error("db down"));
        return Promise.resolve(typeof spent === "number" ? spent : spent());
      },
    },
    logger,
    now: () => clock,
  };
  return {
    broker: createDuplexBroker(dependencies),
    order,
    authorizeCalls,
    mints,
    firewallRequests,
    usage,
    execute,
    turn,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const REPORT = {
  responseId: "resp_1",
  inputTextTokens: 2_000,
  inputAudioTokens: 1_000,
  cachedTextTokens: 1_800,
  cachedAudioTokens: 0,
  outputTextTokens: 50,
  outputAudioTokens: 600,
};

describe("duplex config", () => {
  it("is off by default with the safe caps", () => {
    const config = duplexConfigFrom({});
    expect(config).toEqual(DUPLEX_DEFAULTS);
    expect(config.enabled).toBe(false);
    expect(config.maxSessionMs).toBe(600_000);
    expect(config.dailyCapUsd).toBe(1);
    expect(config.idleMs).toBe(30_000);
  });

  it("turns on only for an explicit on, and never lifts a cap on nonsense", () => {
    expect(duplexConfigFrom({ CQ_VOICE_REALTIME: "yes please" }).enabled).toBe(
      false,
    );
    const config = duplexConfigFrom({
      CQ_VOICE_REALTIME: "on",
      CQ_VOICE_REALTIME_DAILY_CAP_USD: "1e9",
      CQ_VOICE_REALTIME_MAX_SESSION_SECONDS: "-4",
      CQ_VOICE_REALTIME_IDLE_SECONDS: "45",
    });
    expect(config.enabled).toBe(true);
    expect(config.dailyCapUsd).toBe(1);
    expect(config.maxSessionMs).toBe(600_000);
    expect(config.idleMs).toBe(45_000);
  });

  it("counts the day from midnight UTC", () => {
    expect(
      utcDayStart(new Date("2026-10-04T23:59:00+05:00")).toISOString(),
    ).toBe("2026-10-04T00:00:00.000Z");
  });
});

describe("opening a duplex line", () => {
  it("falls back while the flag is off, before the firewall or the provider", async () => {
    const h = harness({ enabled: false });
    expect(await h.broker.open({ binding: binding() })).toEqual({
      kind: "FALLBACK",
      reason: "OFF",
    });
    expect(h.order).toEqual([]);
  });

  it("authorises and plans before minting, and mints only what the plan offers", async () => {
    const h = harness();
    const opened = await h.broker.open({
      binding: binding(),
      firstMessage: "Hi Ada. I'm listening.",
      locale: "fr-FR",
    });
    expect(opened.kind).toBe("DUPLEX");
    // Cap, then the Context Firewall, then the provider: nothing a model
    // sees is chosen before the plan exists.
    expect(h.order).toEqual(["ledger", "firewall", "mint"]);
    expect(h.firewallRequests[0]).toMatchObject({
      actor: ACTOR,
      capability: "ANSWER",
      subjects: [],
    });
    const mint = h.mints[0];
    expect(mint?.sensitivity).toBe("PUBLIC");
    // ask_q and set_listening only: every answer goes through Q (founder
    // 2026-10-06), never a read tool of the voice model's own.
    expect(mint?.tools.map((t) => t.name)).toEqual(["ask_q", "set_listening"]);
    expect(mint?.instructions.startsWith(DUPLEX_INSTRUCTIONS_PREFIX)).toBe(
      true,
    );
    expect(mint?.instructions).toContain("Hi Ada. I'm listening.");
    expect(mint?.instructions).toContain("fr-FR");
    expect(mint?.instructions).not.toContain("eyPRIVATE");
    if (opened.kind !== "DUPLEX") throw new Error("expected a duplex line");
    expect(opened.credential).toMatchObject({
      clientSecret: "ek_fake_secret",
      maxSessionMs: 600_000,
      idleMs: 30_000,
    });
  });

  it("keeps the instruction prefix identical across lines, for the provider's cache", async () => {
    const h = harness();
    await h.broker.open({ binding: binding(), firstMessage: "One." });
    await h.broker.open({ binding: binding(), firstMessage: "Two." });
    const [a, b] = h.mints;
    expect(a?.instructions.slice(0, DUPLEX_INSTRUCTIONS_PREFIX.length)).toBe(
      b?.instructions.slice(0, DUPLEX_INSTRUCTIONS_PREFIX.length),
    );
  });

  it("falls back when the firewall denies, without minting", async () => {
    const h = harness({ deny: true });
    expect(await h.broker.open({ binding: binding() })).toEqual({
      kind: "FALLBACK",
      reason: "DENIED",
    });
    expect(h.mints).toHaveLength(0);
  });

  it("falls back when the plan is above the provider's ceiling", async () => {
    const h = harness({ maxSensitivity: "CONFIDENTIAL" });
    expect(await h.broker.open({ binding: binding() })).toEqual({
      kind: "FALLBACK",
      reason: "MINT_UNAVAILABLE",
    });
    expect(h.order).not.toContain("mint");
  });

  it("falls back at the daily cap, counting what open lines hold", async () => {
    expect(
      await harness({ spent: 0.8 }).broker.open({ binding: binding() }),
    ).toEqual({ kind: "FALLBACK", reason: "CAP_REACHED" });
    const h = harness({ spent: 0.4 });
    expect((await h.broker.open({ binding: binding() })).kind).toBe("DUPLEX");
    // A second person's line: 0.40 spent + 0.25 held + 0.25 asked ≤ 1.00.
    const other = {
      ...binding(),
      voiceSessionId: "5f000000-0000-4000-8000-000000000002",
      actor: STRANGER,
    };
    expect((await h.broker.open({ binding: other })).kind).toBe("DUPLEX");
    const third = {
      ...binding(),
      voiceSessionId: "5f000000-0000-4000-8000-000000000003",
      actor: {
        ...ACTOR,
        userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000003"),
      },
    };
    expect(await h.broker.open({ binding: third })).toEqual({
      kind: "FALLBACK",
      reason: "CAP_REACHED",
    });
  });

  it("fails closed when today's spend cannot be read", async () => {
    const h = harness({ ledgerThrows: true });
    expect(await h.broker.open({ binding: binding() })).toEqual({
      kind: "FALLBACK",
      reason: "LEDGER_UNAVAILABLE",
    });
    expect(h.order).not.toContain("firewall");
  });

  it("leads a welcome or interview line through ask_q alone, never its own greeting", async () => {
    // Founder live 2026-10-05: the welcome line answered "I'm raising"
    // with "Good to connect, how can I assist you today?".
    const h = harness();
    const base = binding();
    await h.broker.open({
      binding: { ...base, thread: { ...base.thread, welcome: true } },
      firstMessage: "Hi, I'm Q. Are you raising, or investing?",
    });
    const mint = h.mints[0];
    expect(mint?.instructions.startsWith(DUPLEX_INSTRUCTIONS_PREFIX)).toBe(
      true,
    );
    expect(mint?.instructions).toContain(GUIDED_CONDUCT);
    expect(mint?.tools.map((t) => t.name)).toEqual(["ask_q", "set_listening"]);
  });

  it("never opens a rehearsal line", async () => {
    const h = harness();
    expect(await h.broker.open({ binding: binding(true) })).toEqual({
      kind: "FALLBACK",
      reason: "REHEARSAL",
    });
  });
});

describe("relaying the model's tool calls", () => {
  async function opened(options: Parameters<typeof harness>[0] = {}) {
    const h = harness(options);
    await h.broker.open({ binding: binding() });
    return h;
  }
  const id = binding().voiceSessionId;

  it("sends ask_q through the standard spoken turn and returns what Q would say", async () => {
    const h = await opened();
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: {
        callId: "call_1",
        name: "ask_q",
        arguments: JSON.stringify({ request: "How is my raise going?" }),
      },
    });
    expect(h.turn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result?.output ?? "{}")).toEqual({
      ok: true,
      say: "Heard: How is my raise going?",
    });
    expect(result?.approvalPending).toBe(false);
  });

  it("each ask_q is its own utterance, after what Q said on the line (voiceq-63)", async () => {
    const h = await opened();
    const ask = (request: string, callId: string) =>
      h.broker.tool({
        actor: ACTOR,
        voiceSessionId: id,
        call: { callId, name: "ask_q", arguments: JSON.stringify({ request }) },
      });
    await ask("Book a meeting with Nixo in the next five minutes.", "c1");
    await ask("Yes, approve the meeting with Nixo.", "c2");
    const calls = vi.mocked(h.turn).mock.calls;
    const first = calls[0]?.[1] ?? [];
    const second = calls[1]?.[1] ?? [];
    expect(second).toEqual([
      {
        role: "user",
        content: "Book a meeting with Nixo in the next five minutes.",
      },
      {
        role: "agent",
        content: "Heard: Book a meeting with Nixo in the next five minutes.",
      },
      { role: "user", content: "Yes, approve the meeting with Nixo." },
    ]);
    // Live 2026-10-04 both had one ref, and the second hid the first.
    expect(utteranceRefOf(id, second)).not.toBe(utteranceRefOf(id, first));
  });

  it("says a proposal is waiting when the turn left one for approval", async () => {
    const h = await opened({
      turn: async (_b, _t, _s, speaker) => {
        await speaker.speak(
          "Update your round size to two million. Shall I go ahead?",
        );
        return { kind: "SPOKEN", path: "Q" };
      },
    });
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: {
        callId: "call_2",
        name: "ask_q",
        arguments: JSON.stringify({
          request: "Change my round to two million",
        }),
      },
    });
    expect(result?.approvalPending).toBe(true);
  });

  it("runs an offered read tool through the executor's authorize", async () => {
    const h = await opened();
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: { callId: "call_3", name: "get_thing", arguments: '{"q":"hi"}' },
    });
    expect(h.authorizeCalls).toEqual(["get_thing"]);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result?.output ?? "{}")).toEqual({
      ok: true,
      data: { echo: "hi" },
    });
  });

  it("returns the executor's refusal when authorize denies", async () => {
    const h = await opened({ allowDirect: false });
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: { callId: "call_4", name: "get_thing", arguments: '{"q":"hi"}' },
    });
    expect(JSON.parse(result?.output ?? "{}")).toEqual({
      ok: false,
      error: "Not for you.",
    });
  });

  it("never runs a tool this line was not offered", async () => {
    const h = await opened();
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: { callId: "call_5", name: "propose_thing", arguments: "{}" },
    });
    expect(h.execute).not.toHaveBeenCalled();
    expect(JSON.parse(result?.output ?? "{}")).toMatchObject({ ok: false });
  });

  it("is another person's line: not found", async () => {
    const h = await opened();
    expect(
      await h.broker.tool({
        actor: STRANGER,
        voiceSessionId: id,
        call: { callId: "c", name: "ask_q", arguments: '{"request":"x"}' },
      }),
    ).toBeNull();
    expect(h.turn).not.toHaveBeenCalled();
  });
});

describe("usage and the caps", () => {
  const id = binding().voiceSessionId;

  it("records each response once under VOICE_REALTIME and carries on under the cap", async () => {
    const h = harness();
    await h.broker.open({ binding: binding() });
    const first = await h.broker.usage({
      actor: ACTOR,
      voiceSessionId: id,
      report: REPORT,
    });
    const again = await h.broker.usage({
      actor: ACTOR,
      voiceSessionId: id,
      report: REPORT,
    });
    expect(first).toEqual({ continue: true });
    expect(again).toEqual({ continue: true });
    expect(h.usage.entries).toHaveLength(1);
    expect(h.usage.entries[0]).toMatchObject({
      purpose: "VOICE_REALTIME",
      taskClass: "REALTIME_VOICE",
      costBasis: "ESTIMATED",
      correlationId: `rt_${id}`,
    });
    expect(h.usage.entries[0]?.costUsd).toBeGreaterThan(0);
  });

  it("ends the line with one sentence when today's spend reaches the cap", async () => {
    let spent = 0.2;
    const h = harness({ spent: () => spent });
    await h.broker.open({ binding: binding() });
    spent = 1.0;
    expect(
      await h.broker.usage({
        actor: ACTOR,
        voiceSessionId: id,
        report: REPORT,
      }),
    ).toEqual({ continue: false, notice: DUPLEX_CAP_NOTICE });
    // The line is gone: the browser carries on on the standard voice.
    expect(
      await h.broker.usage({
        actor: ACTOR,
        voiceSessionId: id,
        report: { ...REPORT, responseId: "resp_2" },
      }),
    ).toBeNull();
  });

  it("ends the line at its maximum length", async () => {
    const h = harness();
    await h.broker.open({ binding: binding() });
    // A line in use: a response every twenty seconds, then ten minutes.
    let last = null as Awaited<ReturnType<typeof h.broker.usage>>;
    for (let n = 1; n <= 30; n += 1) {
      h.advance(20_000);
      last = await h.broker.usage({
        actor: ACTOR,
        voiceSessionId: id,
        report: { ...REPORT, responseId: `resp_${String(n)}` },
      });
      if (n < 30) expect(last).toEqual({ continue: true });
    }
    expect(last).toEqual({ continue: false });
  });

  it("rejoins a dropped line with the same minted session, and keeps it past its length (I1)", async () => {
    let spent = 0.2;
    const h = harness({ spent: () => spent });
    await h.broker.open({ binding: binding() });
    // A line in use for its full ten minutes.
    let last = null as Awaited<ReturnType<typeof h.broker.usage>>;
    for (let n = 1; n <= 30; n += 1) {
      h.advance(20_000);
      last = await h.broker.usage({
        actor: ACTOR,
        voiceSessionId: id,
        report: { ...REPORT, responseId: `len_${String(n)}` },
      });
    }
    // At its length the line is kept for the browser to rejoin.
    expect(last).toEqual({ continue: false });
    const rejoined = await h.broker.rejoin({
      actor: ACTOR,
      voiceSessionId: id,
      cause: "MAX_LENGTH",
    });
    expect(rejoined?.credential?.clientSecret).toBeDefined();
    expect(h.mints).toHaveLength(2);
    expect(h.mints[1]).toEqual(h.mints[0]);
    // The fresh call has the full length again.
    expect(
      await h.broker.usage({
        actor: ACTOR,
        voiceSessionId: id,
        report: { ...REPORT, responseId: "resp_2" },
      }),
    ).toEqual({ continue: true });
    // Past the cap a rejoin is refused with the sentence, and the line goes.
    spent = 1.0;
    expect(
      await h.broker.rejoin({
        actor: ACTOR,
        voiceSessionId: id,
        cause: "NETWORK",
      }),
    ).toEqual({ notice: DUPLEX_CAP_NOTICE });
    expect(
      await h.broker.rejoin({
        actor: ACTOR,
        voiceSessionId: id,
        cause: "NETWORK",
      }),
    ).toBeNull();
  });

  it("never rejoins another person's line", async () => {
    const h = harness();
    await h.broker.open({ binding: binding() });
    expect(
      await h.broker.rejoin({
        actor: STRANGER,
        voiceSessionId: id,
        cause: "NETWORK",
      }),
    ).toBeNull();
    expect(h.mints).toHaveLength(1);
  });

  it("forgets a line that went silent past its idle window", async () => {
    const h = harness();
    await h.broker.open({ binding: binding() });
    h.advance(30_000 + 61_000);
    expect(h.broker.size()).toBe(0);
  });

  it("stops when a response's spend cannot be recorded", async () => {
    const h = harness({ recordThrows: true });
    await h.broker.open({ binding: binding() });
    expect(
      await h.broker.usage({
        actor: ACTOR,
        voiceSessionId: id,
        report: REPORT,
      }),
    ).toEqual({ continue: false });
  });

  it("releases the line's reservation when it ends", async () => {
    const h = harness({ spent: 0.5 });
    await h.broker.open({ binding: binding() });
    expect(
      h.broker.end({ actor: ACTOR, voiceSessionId: id, reason: "ENDED" }),
    ).toBe(true);
    expect(h.broker.size()).toBe(0);
    expect(
      h.broker.end({ actor: ACTOR, voiceSessionId: id, reason: "ENDED" }),
    ).toBe(false);
  });
});

describe("listening like a person (BACKCHANNEL)", () => {
  const id = binding().voiceSessionId;
  /** A memory fake: keeps items, and refuses a quote nobody said, as the gate does. */
  function memoryFake() {
    const items: MemoryItem[] = [];
    const commands: RememberCommand[] = [];
    let tick = 0;
    const memory: Pick<MemoryService, "list" | "remember"> = {
      list: () =>
        Promise.resolve(items.filter((item) => item.validTo === null)),
      remember: (command) => {
        commands.push(command);
        const quote = command.candidate.quote ?? "";
        if (!command.userTurns.some((turn) => quoteOccursIn(quote, turn))) {
          return Promise.resolve({
            outcome: "REFUSED",
            reason: "QUOTE_NOT_IN_TURNS",
          });
        }
        for (const item of items) {
          if (item.memoryKey === command.candidate.memoryKey) {
            Object.assign(item, { validTo: "2026-10-04T00:00:00.000Z" });
          }
        }
        tick += 1;
        const item = {
          id: randomUUID(),
          memoryType: command.candidate.memoryType,
          memoryKey: command.candidate.memoryKey,
          structuredValue: command.candidate.structuredValue,
          validFrom: `2026-10-04T10:00:0${String(tick)}.000Z`,
          validTo: null,
          status: "active",
        } as unknown as MemoryItem;
        items.push(item);
        return Promise.resolve({
          outcome: "REMEMBERED",
          reason: "RECORDED",
          item,
        });
      },
    };
    return { memory, items, commands };
  }

  const setListening = (
    change: string,
    quote: string,
    heard: string[],
    listening: "OFF" | "SUBTLE" | "NATURAL" = "SUBTLE",
  ) => ({
    callId: "call_listen",
    name: "set_listening",
    arguments: JSON.stringify({ change, quote }),
    heard,
    listening,
  });

  it("offers set_listening, the patient detector and the transcriber, with the default level", async () => {
    const h = harness({
      listening: createMemoryListeningStore(memoryFake().memory),
    });
    const opened = await h.broker.open({ binding: binding() });
    if (opened.kind !== "DUPLEX") throw new Error("expected a duplex line");
    expect(opened.credential.listening).toMatchObject({
      level: "SUBTLE",
      setAt: null,
    });
    expect(opened.credential.listening?.backchannelInstructions).toContain(
      "never call a tool",
    );
    expect(h.mints[0]).toMatchObject({
      transcribeInput: true,
      turnEagerness: "AUTO",
    });
    expect(h.mints[0]?.instructions).toContain("set_listening");
  });

  it("leaves the line exactly as before when switched off", async () => {
    const h = harness({ backchannel: false });
    const opened = await h.broker.open({ binding: binding() });
    if (opened.kind !== "DUPLEX") throw new Error("expected a duplex line");
    expect(opened.credential.listening).toBeUndefined();
    expect(h.mints[0]?.tools.map((t) => t.name)).toEqual(["ask_q"]);
    expect(h.mints[0]?.transcribeInput).toBeUndefined();
    expect(h.mints[0]?.instructions).not.toContain("set_listening");
    // And the tool is not there to call.
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: setListening("OFF", "stop doing that", ["stop doing that"]),
    });
    expect(result?.listening).toBeUndefined();
  });

  it("'stop doing that' turns them off at once, persists through the Write Gate, and the next line opens off", async () => {
    const fake = memoryFake();
    const store = createMemoryListeningStore(fake.memory);
    const h = harness({ listening: store });
    await h.broker.open({ binding: binding() });
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: setListening("OFF", "stop doing that", [
        "okay so the round is going well",
        "Q, stop doing that.",
      ]),
    });
    expect(result?.listening).toBe("OFF");
    expect(JSON.parse(result?.output ?? "{}")).toMatchObject({
      ok: true,
      level: "OFF",
      remembered: true,
    });
    // Written by code: fixed key, deterministic words, Q_PROPOSED with the
    // provider's transcripts as the person's turns.
    expect(fake.commands[0]).toMatchObject({
      writeMode: "Q_PROPOSED",
      candidate: {
        memoryType: "preference",
        memoryKey: LISTENING_MEMORY_KEY,
        structuredValue: { listening: "OFF" },
      },
    });
    expect(fake.commands[0]?.userTurns).toContain("Q, stop doing that.");
    // The next line remembers.
    const again = await h.broker.open({ binding: binding() });
    if (again.kind !== "DUPLEX") throw new Error("expected a duplex line");
    expect(again.credential.listening?.level).toBe("OFF");
    expect(again.credential.listening?.setAt).not.toBeNull();
    expect(h.mints[1]?.turnEagerness).toBe("HIGH");
  });

  it("applies the change on the line but remembers nothing the person did not say", async () => {
    const fake = memoryFake();
    const h = harness({ listening: createMemoryListeningStore(fake.memory) });
    await h.broker.open({ binding: binding() });
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: setListening("OFF", "stop doing that", ["tell me about Kazikit"]),
    });
    expect(result?.listening).toBe("OFF");
    expect(JSON.parse(result?.output ?? "{}")).toMatchObject({
      remembered: false,
    });
    expect(fake.items).toHaveLength(0);
  });

  it("steps LESS and MORE one level from where the line is, and stops at the ends", async () => {
    const h = harness({
      listening: createMemoryListeningStore(memoryFake().memory),
    });
    await h.broker.open({ binding: binding() });
    const level = async (change: string, from: "OFF" | "SUBTLE" | "NATURAL") =>
      (
        await h.broker.tool({
          actor: ACTOR,
          voiceSessionId: id,
          call: setListening(change, "less of that", ["less of that"], from),
        })
      )?.listening;
    expect(await level("LESS", "NATURAL")).toBe("SUBTLE");
    expect(await level("LESS", "SUBTLE")).toBe("OFF");
    expect(await level("LESS", "OFF")).toBe("OFF");
    expect(await level("MORE", "SUBTLE")).toBe("NATURAL");
    expect(await level("MORE", "NATURAL")).toBe("NATURAL");
    expect(nextListeningLevel("OFF", "MORE")).toBe("SUBTLE");
    // An unknown change is refused, and changes nothing.
    const refused = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: setListening("LOUDER", "louder", ["louder"]),
    });
    expect(refused?.listening).toBeUndefined();
  });

  it("opens with the default when the remembered level cannot be read", async () => {
    const h = harness({
      listening: {
        read: () => Promise.reject(new Error("db down")),
        remember: () => Promise.resolve(false),
      },
    });
    const opened = await h.broker.open({ binding: binding() });
    if (opened.kind !== "DUPLEX") throw new Error("expected a duplex line");
    expect(opened.credential.listening?.level).toBe("SUBTLE");
  });

  it("counts backchannels, bridges and transcription in the same VOICE_REALTIME ledger, under the cap", async () => {
    let spent = 0;
    const h = harness({ spent: () => spent });
    await h.broker.open({ binding: binding() });
    for (const [responseId, kind] of [
      ["bc_1", "BACKCHANNEL"],
      ["br_1", "BRIDGE"],
      ["tx_item_1", "TRANSCRIPTION"],
    ] as const) {
      await h.broker.usage({
        actor: ACTOR,
        voiceSessionId: id,
        report: {
          responseId,
          kind,
          inputTextTokens: 400,
          inputAudioTokens: 100,
          cachedTextTokens: 380,
          cachedAudioTokens: 0,
          outputTextTokens: 4,
          outputAudioTokens: kind === "TRANSCRIPTION" ? 0 : 15,
        },
      });
    }
    expect(h.usage.entries).toHaveLength(3);
    expect(
      h.usage.entries.every((entry) => entry.purpose === "VOICE_REALTIME"),
    ).toBe(true);
    // Small: about a tenth of a cent each, even with transcription priced
    // at the session's (higher) rates as this fake provider does.
    const total = h.usage.entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(0.005);
    // And the cap still governs them.
    spent = 1;
    expect(
      await h.broker.usage({
        actor: ACTOR,
        voiceSessionId: id,
        report: { ...REPORT, responseId: "bc_2", kind: "BACKCHANNEL" },
      }),
    ).toEqual({ continue: false, notice: DUPLEX_CAP_NOTICE });
  });
});
