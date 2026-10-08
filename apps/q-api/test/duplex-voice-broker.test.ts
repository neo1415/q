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
import { spokenFactsOf } from "@capital-q/q-core";
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

// The founder's live turns (c10b845f), one fixture for every layer.
import {
  C10B_FIT_BLOCKS,
  C10B_TURNS,
} from "../../../packages/q-core/test/fixtures/voice-c10b845f.js";
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
import { isSmallTalk, routeDuplexTurn } from "../src/voice/duplex/routing.js";
import type {
  DuplexTranscriptEntry,
  DuplexTranscriptStore,
} from "../src/voice/duplex/transcript.js";
import {
  claimsInability,
  stallsForPermission,
} from "../src/voice/duplex/broker.js";
import { ownCompanyAskerNote } from "../src/composition/own-company-asker.js";

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
    readonly routeTurns?: boolean;
    readonly transcript?: DuplexTranscriptStore;
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
      routeTurns: options.routeTurns ?? true,
    },
    ...(options.transcript === undefined
      ? {}
      : { transcript: options.transcript }),
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
    expect(mint?.tools.map((t) => t.name)).toEqual([
      "ask_q",
      "set_listening",
      "decide_card",
    ]);
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
    expect(mint?.tools.map((t) => t.name)).toEqual([
      "ask_q",
      "set_listening",
      "decide_card",
    ]);
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

  it("hands a code-built answer to the voice as facts to say in its own words (founder live 2026-10-08)", async () => {
    const facts = spokenFactsOf({
      asked: C10B_TURNS.topThree.asked,
      text: C10B_TURNS.topThree.said,
      blocks: C10B_FIT_BLOCKS,
    });
    if (facts === null) throw new Error("no facts");
    const h = await opened({
      turn: async (_b, _t, _s, speaker) => {
        speaker.facts?.(facts);
        await speaker.speak(facts.fallback);
        return { kind: "SPOKEN", path: "Q" };
      },
    });
    const result = await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: {
        callId: "call_f",
        name: "ask_q",
        arguments: JSON.stringify({ request: C10B_TURNS.topThree.asked }),
      },
    });
    const output = JSON.parse(result?.output ?? "{}") as Record<
      string,
      unknown
    >;
    expect(output).toMatchObject({
      ok: true,
      speakInYourOwnWords: true,
      mustSay: [
        "Halyard Security",
        "Clearwater Assurance",
        "Tensorgate",
        "8.8",
      ],
      example: facts.fallback,
    });
    expect(output["say"]).toBeUndefined();
    expect(output["facts"]).toMatchObject({
      askedFor: 3,
      tiedTogether: [
        ["Halyard Security", "Clearwater Assurance", "Tensorgate"],
      ],
      moreOnTheSameScore: 4,
    });
    // Nothing internal reaches the voice: no ids, no field names of records.
    expect(result?.output).not.toMatch(/companyId|subject|hue|"key"/u);
  });

  it("relays the silence ladder's beats out of band, never into what Q says (ADR 0062)", async () => {
    let release: () => void = () => undefined;
    const h = await opened({
      turn: async (_b, _t, _s, speaker) => {
        speaker.narrate?.({ kind: "TONE" });
        speaker.narrate?.({ kind: "STAGE_LINE", text: "Looking at the deck…" });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await speaker.speak("Here is what I found.");
        return { kind: "SPOKEN", path: "Q" };
      },
    });
    const asked = h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: {
        callId: "call_n",
        name: "ask_q",
        arguments: JSON.stringify({ request: "Look at the deck." }),
      },
    });
    await Promise.resolve();
    const first = await h.broker.narration({
      actor: ACTOR,
      voiceSessionId: id,
      after: 0,
    });
    expect(first).toEqual({
      beats: [
        {
          sequence: 1,
          beat: { kind: "STAGE_LINE", text: "Looking at the deck…" },
        },
      ],
      idle: false,
    });
    // Someone else's poll on this line gets nothing.
    expect(
      await h.broker.narration({
        actor: STRANGER,
        voiceSessionId: id,
        after: 0,
      }),
    ).toBeNull();
    const waiting = h.broker.narration({
      actor: ACTOR,
      voiceSessionId: id,
      after: 1,
    });
    release();
    const result = await asked;
    expect(await waiting).toEqual({ beats: [], idle: true });
    expect(JSON.parse(result?.output ?? "{}")).toEqual({
      ok: true,
      say: "Here is what I found.",
    });
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
    const h = harness({ backchannel: false, routeTurns: false });
    const opened = await h.broker.open({ binding: binding() });
    if (opened.kind !== "DUPLEX") throw new Error("expected a duplex line");
    expect(opened.credential.listening).toBeUndefined();
    expect(h.mints[0]?.tools.map((t) => t.name)).toEqual([
      "ask_q",
      "decide_card",
    ]);
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

/**
 * VOICE-BRAIN (founder live 2026-10-08, Daniel Park of Tensorgate): on one
 * duplex call a single ask_q ran; everything else was the realtime model
 * answering alone ("I can't open files", "are you ready?", no strategy).
 * The server now decides who answers each finished turn.
 */
describe("the realtime model is the voice, never the brain (VOICE-BRAIN)", () => {
  const id = binding().voiceSessionId;
  function transcriptFake() {
    const entries: DuplexTranscriptEntry[] = [];
    const mirrored: { conversationId: string; messages: unknown }[] = [];
    const store: DuplexTranscriptStore = {
      record: (entry) => {
        entries.push(entry);
        return Promise.resolve();
      },
      mirror: ({ conversationId, messages }) => {
        mirrored.push({ conversationId, messages });
        return Promise.resolve(messages.length);
      },
    };
    return { store, entries, mirrored };
  }
  const heard = (transcript: string, extra: object = {}) => ({
    itemId: `item_${randomUUID().slice(0, 8)}`,
    transcript,
    ...extra,
  });

  it("mints a line on which the model never answers a turn by itself", async () => {
    const h = harness();
    const opened = await h.broker.open({ binding: binding() });
    if (opened.kind !== "DUPLEX") throw new Error("expected a duplex line");
    expect(h.mints[0]?.routeTurns).toBe(true);
    expect(h.mints[0]?.transcribeInput).toBe(true);
    expect(opened.credential.routeTurns).toBe(true);
  });

  // Founder fixtures (Tensorgate): documents, own company, strategy.
  const SUBSTANTIVE = [
    "Open my pitch deck.",
    "Read the data room's financials.",
    "What's in my one-pager?",
    "Can you open files?",
    "Show me an overview of the portfolio performance and risk metrics.",
    "How is my company doing?",
    "Give me a fundraising strategy.",
    "How should I approach Zino?",
    "What should I do next?",
  ];

  it.each(SUBSTANTIVE)(
    "%s -> Q's pipeline answers it, even though the model never called ask_q",
    async (said) => {
      const fake = transcriptFake();
      const h = harness({ transcript: fake.store });
      await h.broker.open({ binding: binding() });
      const result = await h.broker.heard({
        actor: ACTOR,
        voiceSessionId: id,
        heard: heard(said),
      });
      expect(result?.route).toBe("ASK_Q");
      if (result?.route !== "ASK_Q") throw new Error("expected ask_q");
      // The broker ran the same spoken turn ask_q runs, with their words.
      expect(h.turn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(result.arguments)).toEqual({ request: said });
      expect(JSON.parse(result.output)).toMatchObject({
        ok: true,
        say: `Heard: ${said}`,
      });
      expect(fake.entries[0]).toMatchObject({
        role: "USER",
        content: said,
        routed: "ask_q",
      });
    },
  );

  it.each([
    "Okay.",
    "Thanks!",
    "Hi Q, how are you?",
    "Mm-hmm",
    "got it, great",
  ])("%s -> small talk the voice may answer; Q is not run", async (said) => {
    const h = harness();
    await h.broker.open({ binding: binding() });
    const result = await h.broker.heard({
      actor: ACTOR,
      voiceSessionId: id,
      heard: heard(said),
    });
    expect(result).toEqual({ route: "SMALLTALK" });
    expect(h.turn).not.toHaveBeenCalled();
  });

  it("routes deterministically: capability questions and anything with content are Q's", () => {
    const plain = {
      guided: false,
      awaitingApproval: false,
      cardInFocus: false,
    };
    expect(isSmallTalk("can you see it?")).toBe(false);
    expect(isSmallTalk("yes, open it")).toBe(false);
    expect(isSmallTalk("can you hear me?")).toBe(true);
    expect(routeDuplexTurn("yes", plain)).toBe("SMALLTALK");
    // A yes to an approval Q asked for is Q's to take.
    expect(routeDuplexTurn("yes", { ...plain, awaitingApproval: true })).toBe(
      "ASK_Q",
    );
    // Q leads a guided line: even a hello is Q's.
    expect(routeDuplexTurn("hello", { ...plain, guided: true })).toBe("ASK_Q");
    // A short reply to a card in focus goes to decide_card via the voice.
    expect(routeDuplexTurn("send it", { ...plain, cardInFocus: true })).toBe(
      "MODEL",
    );
  });

  it("keeps both sides of the line, marks which turns went to Q, and mirrors model-only turns into the conversation", async () => {
    const fake = transcriptFake();
    const h = harness({ transcript: fake.store });
    const line = binding();
    await h.broker.open({ binding: line });
    // A Q answer starts the conversation.
    await h.broker.heard({
      actor: ACTOR,
      voiceSessionId: id,
      heard: heard("Open my pitch deck."),
    });
    line.thread.conversationId = "cb899610-72e5-442a-b99e-7fe8477cbf55";
    expect(
      h.broker.said({
        actor: ACTOR,
        voiceSessionId: id,
        said: { responseId: "resp_1", text: "It's open on your screen." },
      }),
    ).toBe(true);
    await h.broker.heard({
      actor: ACTOR,
      voiceSessionId: id,
      heard: heard("Thanks!"),
    });
    h.broker.said({
      actor: ACTOR,
      voiceSessionId: id,
      said: { responseId: "resp_2", text: "Any time." },
    });
    await Promise.resolve();
    expect(fake.entries.map((e) => [e.role, e.routed, e.content])).toEqual([
      ["USER", "ask_q", "Open my pitch deck."],
      ["Q", "ask_q", "It's open on your screen."],
      ["USER", "smalltalk", "Thanks!"],
      ["Q", "smalltalk", "Any time."],
    ]);
    // Only the model-only exchange is mirrored: Q's run stored its own.
    expect(fake.mirrored).toEqual([
      {
        conversationId: "cb899610-72e5-442a-b99e-7fe8477cbf55",
        messages: [
          { role: "USER", content: "Thanks!" },
          { role: "Q", content: "Any time." },
        ],
      },
    ]);
    // And Q's next answer reads that exchange.
    await h.broker.heard({
      actor: ACTOR,
      voiceSessionId: id,
      heard: heard("What's in my one-pager?"),
    });
    const lastCall = vi.mocked(h.turn).mock.calls.at(-1);
    expect(lastCall?.[1].map((t) => t.content)).toContain("Any time.");
  });

  it("a turn the model sent to ask_q itself is recorded as Q's", async () => {
    const fake = transcriptFake();
    const h = harness({ transcript: fake.store });
    await h.broker.open({ binding: binding() });
    await h.broker.tool({
      actor: ACTOR,
      voiceSessionId: id,
      call: {
        callId: "call_1",
        name: "ask_q",
        arguments: JSON.stringify({ request: "Read my deck" }),
      },
    });
    h.broker.said({
      actor: ACTOR,
      voiceSessionId: id,
      said: { responseId: "resp_1", text: "Your deck opens with the problem." },
    });
    expect(fake.entries.map((e) => [e.role, e.routed])).toEqual([
      ["USER", "ask_q"],
      ["Q", "ask_q"],
    ]);
  });

  it("logs one routed= line per user turn and flags a claimed inability or a stall", async () => {
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const h = harness();
    await h.broker.open({ binding: binding() });
    await h.broker.heard({
      actor: ACTOR,
      voiceSessionId: id,
      heard: heard("Give me a fundraising strategy."),
    });
    await h.broker.heard({
      actor: ACTOR,
      voiceSessionId: id,
      heard: heard("thanks"),
    });
    h.broker.said({
      actor: ACTOR,
      voiceSessionId: id,
      said: { responseId: "r1", text: "I can't open files, sorry. Ready?" },
    });
    const routed = info.mock.calls
      .filter((c) => c[1] === "duplex user turn routed")
      .map((c) => (c[0] as { routed: string }).routed);
    expect(routed).toEqual(["ask_q", "smalltalk"]);
    const warned = warn.mock.calls.map((c) => c[1]);
    expect(warned).toContain("duplex voice claimed an inability without Q");
    expect(warned).toContain(
      "duplex voice asked leave instead of doing the task",
    );
    info.mockRestore();
    warn.mockRestore();
  });

  it("detects self-claimed inability and asking leave, and not ordinary answers", () => {
    expect(claimsInability("I can't open files.")).toBe(true);
    expect(claimsInability("I don't have access to your documents.")).toBe(
      true,
    );
    expect(claimsInability("I'm unable to see your screen")).toBe(true);
    expect(claimsInability("Your deck opens with the problem.")).toBe(false);
    expect(stallsForPermission("Are you ready?")).toBe(true);
    expect(stallsForPermission("Sound good?")).toBe(true);
    expect(stallsForPermission("Shall I start?")).toBe(true);
    expect(stallsForPermission("Lead with traction: 40% month on month.")).toBe(
      false,
    );
  });

  it("tells the voice never to answer alone, claim inability or ask leave", async () => {
    const h = harness();
    await h.broker.open({ binding: binding() });
    const instructions = h.mints[0]?.instructions ?? "";
    expect(instructions).toContain(
      "Never answer a question from your own knowledge",
    );
    expect(instructions).toContain('never "I can\'t open files"');
    expect(instructions).toContain('Never "ready?", "sound good?", "shall I?"');
    expect(instructions).toContain("at most three sentences spoken");
  });

  it("a founder's 'portfolio' is their own company", () => {
    const note = ownCompanyAskerNote("Tensorgate");
    expect(note).toContain("they mean Tensorgate itself");
    expect(note).toContain("never answer that there are no portfolio metrics");
  });

  it("another person's line answers nothing", async () => {
    const h = harness();
    await h.broker.open({ binding: binding() });
    expect(
      await h.broker.heard({
        actor: STRANGER,
        voiceSessionId: id,
        heard: heard("Open my pitch deck."),
      }),
    ).toBeNull();
    expect(
      h.broker.said({
        actor: STRANGER,
        voiceSessionId: id,
        said: { responseId: "r", text: "x" },
      }),
    ).toBe(false);
    expect(h.turn).not.toHaveBeenCalled();
  });
});
