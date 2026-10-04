import { describe, expect, it, vi } from "vitest";

import { createInMemoryModelUsageRepository } from "../src/infrastructure/postgres-usage.js";
import {
  createRealtimeVoiceGateway,
  realtimeCostUsd,
  type RealtimeSessionProvider,
} from "../src/realtime/index.js";
import {
  createOpenAIRealtimeProvider,
  OPENAI_REALTIME_MINI_PRICES,
} from "../src/realtime/openai.js";
import type { SyntheticDemoRoutingAllowance } from "../src/policy/synthetic-demo.js";

/**
 * DUPLEX: the realtime gateway. No live provider call anywhere here: the
 * adapter's fetch is a fake, and the key is the disabled placeholder.
 */

const DISABLED_KEY = "disabled-locally-000000000000";
const ATTRIBUTION = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  correlationId: "rt_test",
};

function fakeProvider(): RealtimeSessionProvider & { readonly calls: number } {
  const state = { calls: 0 };
  return {
    code: "fake",
    modelCode: "fake-realtime",
    providerId: "a1000000-0000-4000-8000-000000000003",
    modelId: "a2000000-0000-4000-8000-000000000022",
    prices: OPENAI_REALTIME_MINI_PRICES,
    get calls() {
      return state.calls;
    },
    mint: () => {
      state.calls += 1;
      return Promise.resolve({
        clientSecret: "ek_fake",
        expiresAt: new Date(0),
        callsUrl: "https://realtime.invalid/calls",
      });
    },
  };
}

const MINT = {
  instructions: "You are Q.",
  tools: [],
  voice: "FEMALE" as const,
  maxOutputTokens: 800,
  secretTtlSeconds: 60,
  attribution: ATTRIBUTION,
};

describe("realtime voice cost", () => {
  it("bills cached input at the cached rate and the rest at full rate", () => {
    const usd = realtimeCostUsd(
      {
        inputTextTokens: 1_000_000,
        inputAudioTokens: 1_000_000,
        cachedTextTokens: 500_000,
        cachedAudioTokens: 500_000,
        outputTextTokens: 1_000_000,
        outputAudioTokens: 1_000_000,
      },
      OPENAI_REALTIME_MINI_PRICES,
    );
    // 0.3 + 0.03 + 5 + 0.15 + 2.4 + 20
    expect(usd).toBeCloseTo(27.88, 6);
  });

  it("never prices a negative or impossible count", () => {
    expect(
      realtimeCostUsd(
        {
          inputTextTokens: -5,
          inputAudioTokens: Number.NaN,
          cachedTextTokens: 10,
          cachedAudioTokens: 10,
          outputTextTokens: 0,
          outputAudioTokens: 0,
        },
        OPENAI_REALTIME_MINI_PRICES,
      ),
    ).toBe(0);
  });
});

describe("realtime voice gateway", () => {
  it("mints nothing while off", async () => {
    const provider = fakeProvider();
    const gateway = createRealtimeVoiceGateway({
      provider,
      enabled: false,
      providerCeiling: "PUBLIC",
    });
    expect(await gateway.mint({ ...MINT, sensitivity: "PUBLIC" })).toEqual({
      status: "UNAVAILABLE",
    });
    expect(provider.calls).toBe(0);
  });

  it("refuses a plan above the provider's ceiling without the synthetic attestation", async () => {
    const provider = fakeProvider();
    const gateway = createRealtimeVoiceGateway({
      provider,
      enabled: true,
      providerCeiling: "PUBLIC",
    });
    expect(
      await gateway.mint({ ...MINT, sensitivity: "CONFIDENTIAL" }),
    ).toEqual({ status: "INELIGIBLE" });
    expect(provider.calls).toBe(0);
  });

  it("mints under the synthetic-demo attestation", async () => {
    const provider = fakeProvider();
    const allowance: SyntheticDemoRoutingAllowance = {
      permitted: true,
      attestation: ["test"],
    };
    const gateway = createRealtimeVoiceGateway({
      provider,
      enabled: true,
      providerCeiling: "PUBLIC",
      syntheticDemo: allowance,
    });
    const minted = await gateway.mint({ ...MINT, sensitivity: "CONFIDENTIAL" });
    expect(minted.status).toBe("MINTED");
  });

  it("records each response under VOICE_REALTIME with its estimated cost", async () => {
    const usage = createInMemoryModelUsageRepository();
    const gateway = createRealtimeVoiceGateway({
      provider: fakeProvider(),
      enabled: true,
      providerCeiling: "PUBLIC",
      usage,
    });
    const cost = await gateway.record({
      usage: {
        inputTextTokens: 1000,
        inputAudioTokens: 2000,
        cachedTextTokens: 800,
        cachedAudioTokens: 0,
        outputTextTokens: 100,
        outputAudioTokens: 1500,
      },
      attribution: ATTRIBUTION,
    });
    expect(cost).toBeGreaterThan(0);
    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0]).toMatchObject({
      taskClass: "REALTIME_VOICE",
      purpose: "VOICE_REALTIME",
      costBasis: "ESTIMATED",
      costUsd: cost,
      inputTokens: 3000,
      cachedInputTokens: 800,
      outputTokens: 1600,
      success: true,
    });
  });
});

describe("openai realtime adapter", () => {
  it("mints a client secret server-side and never returns the key", async () => {
    const fetchFake = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ value: "ek_minted", expires_at: 1_900_000_000 }),
          { status: 200 },
        ),
      ),
    );
    const provider = createOpenAIRealtimeProvider({
      apiKey: DISABLED_KEY,
      fetch: fetchFake,
    });
    const grant = await provider.mint(
      {
        modelCode: provider.modelCode,
        instructions: "You are Q.",
        tools: [
          {
            name: "ask_q",
            description: "Ask Q.",
            inputJsonSchema: { type: "object", properties: {} },
          },
        ],
        voice: "MALE",
        maxOutputTokens: 800,
        secretTtlSeconds: 60,
      },
      { signal: new AbortController().signal },
    );
    expect(grant.clientSecret).toBe("ek_minted");
    expect(JSON.stringify(grant)).not.toContain(DISABLED_KEY);
    const [url, init] = fetchFake.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as {
      session: {
        model: string;
        max_output_tokens: number;
        tools: { type: string; name: string }[];
        audio: {
          input: { turn_detection: { interrupt_response: boolean } };
          output: { voice: string };
        };
      };
    };
    expect(body.session.model).toBe("gpt-realtime-mini");
    expect(body.session.max_output_tokens).toBe(800);
    expect(body.session.tools[0]).toMatchObject({
      type: "function",
      name: "ask_q",
    });
    expect(body.session.audio.input.turn_detection.interrupt_response).toBe(
      true,
    );
    expect(body.session.audio.output.voice).toBe("cedar");
  });

  it("maps a refusal to a coded failure, never a vendor message", async () => {
    const provider = createOpenAIRealtimeProvider({
      apiKey: DISABLED_KEY,
      fetch: () => Promise.resolve(new Response("nope", { status: 401 })),
    });
    await expect(
      provider.mint(
        {
          modelCode: provider.modelCode,
          instructions: "x",
          tools: [],
          voice: "FEMALE",
          maxOutputTokens: 10,
          secretTtlSeconds: 60,
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ failureClass: "AUTHENTICATION" });
  });
});
