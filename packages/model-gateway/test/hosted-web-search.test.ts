import type { Logger } from "@capital-q/observability";
import { describe, expect, it } from "vitest";

import type { ModelCatalogSnapshot } from "../src/catalog.js";
import { ModelProviderFailure } from "../src/errors.js";
import { createStaticModelCatalog } from "../src/infrastructure/postgres-catalog.js";
import { createInMemoryModelUsageRepository } from "../src/infrastructure/postgres-usage.js";
import { createDailySpendCap } from "../src/policy/spend-cap.js";
import {
  ANTHROPIC_FAST_MODEL,
  AnthropicAPIError,
} from "../src/providers/anthropic.js";
import {
  ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
  createAnthropicHostedWebSearch,
  webSearchResult,
  type AnthropicWebSearchClient,
} from "../src/providers/anthropic-web-search.js";
import {
  createHostedWebSearch,
  HOSTED_WEB_SEARCH_MAX_USES,
  HostedWebSearchUnavailable,
  hostedSearchCostUsd,
  parseModelSearchDailyCapUsd,
  type HostedWebSearchAdapter,
  type HostedWebSearchAdapterRequest,
} from "../src/web-search.js";

type Message = Parameters<typeof webSearchResult>[0];

/**
 * DECISIONS 103: the model-hosted web search through the gateway. No live
 * call anywhere: the vendor is a scripted client returning recorded
 * response shapes.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";
const PROVIDER_ID = "a1000000-0000-4000-8000-000000000004";
const MODEL_ID = "a2000000-0000-4000-8000-000000000031";
const NOW = new Date("2026-11-17T12:00:00.000Z");

function snapshot(
  overrides: {
    readonly providerStatus?: "ACTIVE" | "DISABLED";
    readonly privacy?: "UNREVIEWED" | "NO_TRAINING_DEFAULT_RETENTION";
    readonly priced?: boolean;
  } = {},
): ModelCatalogSnapshot {
  return {
    providers: [
      {
        id: PROVIDER_ID,
        code: "anthropic",
        name: "Anthropic",
        status: overrides.providerStatus ?? "ACTIVE",
        privacyPolicyClass:
          overrides.privacy ?? "NO_TRAINING_DEFAULT_RETENTION",
        supportsZeroRetention: false,
        regionSupport: [],
        ownerApprovedCeiling: "CONFIDENTIAL",
      },
    ],
    models: [
      {
        id: MODEL_ID,
        providerId: PROVIDER_ID,
        modelCode: ANTHROPIC_FAST_MODEL,
        modelFamily: "claude-haiku",
        modelType: "TEXT_GENERATION",
        status: "ACTIVE",
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsVision: true,
        supportsAudio: false,
        supportsRealtime: false,
        supportsPromptCache: true,
        supportsReasoning: true,
        sensitivityCeiling: "CONFIDENTIAL",
        qualityClass: "STANDARD",
        latencyClass: "FAST",
        effectiveFrom: "2026-11-06T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    prices:
      overrides.priced === false
        ? []
        : [
            {
              id: "a3000000-0000-4000-8000-000000000031",
              modelId: MODEL_ID,
              pricingRegion: "global",
              currency: "USD",
              inputPerMillion: 0.1,
              cachedInputPerMillion: 0.01,
              outputPerMillion: 0.5,
              effectiveFrom: "2026-11-06T00:00:00.000Z",
              effectiveTo: null,
            },
          ],
    routingPolicies: [],
    loadedAt: NOW.toISOString(),
  };
}

/** A recorded response: two searches, three results, two of them cited. */
function recordedMessage(): Message {
  return {
    id: "msg_recorded",
    type: "message",
    role: "assistant",
    model: ANTHROPIC_FAST_MODEL,
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 9_000,
      output_tokens: 400,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
    },
    content: [
      {
        type: "server_tool_use",
        id: "srvtoolu_1",
        name: "web_search",
        input: { query: "Kibo Health Systems" },
        caller: { type: "direct" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        caller: { type: "direct" },
        content: [
          {
            type: "web_search_result",
            url: "https://kibohealth.example/about",
            title: "About Kibo Health Systems",
            encrypted_content: "opaque",
            page_age: "2026-07-01",
          },
          {
            type: "web_search_result",
            url: "https://techpress.example/kibo-seed",
            title: "Kibo raises seed",
            encrypted_content: "opaque",
            page_age: "3 days ago",
          },
        ],
      },
      {
        type: "server_tool_use",
        id: "srvtoolu_2",
        name: "web_search",
        input: { query: "Kibo Health Systems Kenya" },
        caller: { type: "direct" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_2",
        caller: { type: "direct" },
        content: [
          {
            type: "web_search_result",
            url: "https://news.example/kibo-kenya",
            title: "Kibo in Kenya",
            encrypted_content: "opaque",
            page_age: null,
          },
          {
            type: "web_search_result",
            url: "https://kibohealth.example/about",
            title: "About Kibo Health Systems",
            encrypted_content: "opaque",
            page_age: null,
          },
        ],
      },
      {
        type: "text",
        text: "Kibo builds clinic software.",
        citations: [
          {
            type: "web_search_result_location",
            url: "https://news.example/kibo-kenya",
            title: "Kibo in Kenya",
            cited_text: "Kibo Health Systems expanded to Nairobi clinics.",
            encrypted_index: "opaque",
          },
          {
            type: "web_search_result_location",
            url: "https://kibohealth.example/about",
            title: "About Kibo Health Systems",
            cited_text: "Kibo Health Systems builds inventory software.",
            encrypted_index: "opaque",
          },
        ],
      },
    ],
  } as unknown as Message;
}

function scriptedClient(answer: () => Promise<Message>): {
  client: AnthropicWebSearchClient;
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  const client = {
    messages: {
      create: (body: unknown) => {
        bodies.push(body);
        return answer();
      },
    },
  } as unknown as AnthropicWebSearchClient;
  return { client, bodies };
}

function fixedCap(capUsd: number, spentUsd = 0) {
  return createDailySpendCap({
    capUsd,
    readSpentSinceUsd: () => Promise.resolve(spentUsd),
    now: () => NOW,
  });
}

const attribution = {
  tenantId: TENANT,
  userId: USER,
  qRunId: RUN,
  correlationId: "cor_research_test",
};

describe("anthropic hosted web search adapter", () => {
  it("declares one hosted search tool with a small use bound and nothing else", async () => {
    const { client, bodies } = scriptedClient(() =>
      Promise.resolve(recordedMessage()),
    );
    const adapter = createAnthropicHostedWebSearch({ apiKey: "x", client });
    await adapter.search(
      {
        modelCode: ANTHROPIC_FAST_MODEL,
        query: "Kibo Health Systems Kenya",
        allowedDomains: ["kibohealth.example"],
        maxUses: 3,
        maxOutputTokens: 1_024,
        instruction: "return the sources found",
      },
      { signal: new AbortController().signal },
    );
    const body = bodies[0] as {
      tools: {
        type: string;
        name: string;
        max_uses: number;
        allowed_domains: string[];
      }[];
      messages: { role: string; content: string }[];
    };
    expect(body.tools).toEqual([
      {
        type: ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
        name: "web_search",
        max_uses: 3,
        allowed_domains: ["kibohealth.example"],
      },
    ]);
    expect(body.messages).toEqual([
      { role: "user", content: "Kibo Health Systems Kenya" },
    ]);
  });

  it("normalises results: one per address, cited first, cited text kept, prose dropped", () => {
    const result = webSearchResult(recordedMessage());
    expect(result.searchRequests).toBe(2);
    expect(result.sources.map((s) => s.url)).toEqual([
      "https://kibohealth.example/about",
      "https://news.example/kibo-kenya",
      "https://techpress.example/kibo-seed",
    ]);
    expect(result.sources[0]).toEqual({
      url: "https://kibohealth.example/about",
      title: "About Kibo Health Systems",
      quotedText: "Kibo Health Systems builds inventory software.",
      pageAge: "2026-07-01",
    });
    expect(result.sources[2]?.quotedText).toBe("");
    expect(JSON.stringify(result)).not.toContain(
      "Kibo builds clinic software.",
    );
    expect(JSON.stringify(result)).not.toContain("opaque");
    expect(result.usage).toEqual({
      inputTokens: 9_000,
      cachedInputTokens: 0,
      outputTokens: 400,
    });
  });

  it("reports a search error object (HTTP 200) rather than an empty success", () => {
    const message = recordedMessage();
    const failed = {
      ...message,
      content: [
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_1",
          caller: { type: "direct" },
          content: {
            type: "web_search_tool_result_error",
            error_code: "too_many_requests",
          },
        },
      ],
    } as unknown as Message;
    const result = webSearchResult(failed);
    expect(result.sources).toEqual([]);
    expect(result.searchErrorCode).toBe("too_many_requests");
  });

  it("maps a vendor refusal to a ModelProviderFailure, never a vendor exception", async () => {
    const { client } = scriptedClient(() =>
      Promise.reject(
        AnthropicAPIError.generate(
          402,
          { type: "error", error: { type: "billing_error", message: "no" } },
          "no",
          new Headers(),
        ),
      ),
    );
    const adapter = createAnthropicHostedWebSearch({ apiKey: "x", client });
    await expect(
      adapter.search(
        {
          modelCode: ANTHROPIC_FAST_MODEL,
          query: "q",
          allowedDomains: [],
          maxUses: 3,
          maxOutputTokens: 1_024,
          instruction: "i",
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toBeInstanceOf(ModelProviderFailure);
  });
});

describe("hosted web search through the gateway", () => {
  function setup(
    options: {
      readonly catalog?: ModelCatalogSnapshot;
      readonly caps?: ReturnType<typeof fixedCap>[];
      readonly adapter?: HostedWebSearchAdapter;
    } = {},
  ) {
    const usage = createInMemoryModelUsageRepository();
    const seen: HostedWebSearchAdapterRequest[] = [];
    const adapter: HostedWebSearchAdapter = options.adapter ?? {
      code: "anthropic",
      search: (request) => {
        seen.push(request);
        return Promise.resolve(webSearchResult(recordedMessage()));
      },
    };
    const hosted = createHostedWebSearch({
      catalog: createStaticModelCatalog(options.catalog ?? snapshot()),
      adapter,
      usage,
      modelCode: ANTHROPIC_FAST_MODEL,
      caps: options.caps ?? [fixedCap(2)],
      now: () => NOW,
    });
    return { hosted, usage, seen };
  }

  it("runs one bounded search and records one priced ledger row under PUBLIC_WEB_SEARCH", async () => {
    const { hosted, usage, seen } = setup();
    const result = await hosted.search({
      query: "Kibo Health Systems Kenya",
      includeDomains: [],
      attribution,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.maxUses).toBe(HOSTED_WEB_SEARCH_MAX_USES);
    expect(seen[0]?.query).toBe("Kibo Health Systems Kenya");
    expect(result.providerCode).toBe("anthropic");
    expect(result.sources).toHaveLength(3);
    // 9,000 x 0.10/M + 400 x 0.50/M + 2 searches x 0.01.
    expect(result.costUsd).toBeCloseTo(0.0009 + 0.0002 + 0.02, 8);
    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0]).toMatchObject({
      tenantId: TENANT,
      userId: USER,
      qRunId: RUN,
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      purpose: "PUBLIC_WEB_SEARCH",
      success: true,
      costBasis: "PRICE_SNAPSHOT",
      inputTokens: 9_000,
      outputTokens: 400,
    });
    expect(usage.entries[0]?.costUsd).toBeCloseTo(result.costUsd, 8);
  });

  it("refuses past the daily cap without calling the vendor", async () => {
    const { hosted, usage, seen } = setup({ caps: [fixedCap(2, 2.5)] });
    await expect(
      hosted.search({ query: "q", includeDomains: [], attribution }),
    ).rejects.toMatchObject({ refusal: "CAP_REACHED" });
    expect(seen).toHaveLength(0);
    expect(usage.entries).toHaveLength(0);
  });

  it("counts its own spend toward the cap within the process", async () => {
    const cap = fixedCap(0.03);
    const { hosted, seen } = setup({ caps: [cap] });
    await hosted.search({ query: "q", includeDomains: [], attribution });
    await hosted.search({ query: "q", includeDomains: [], attribution });
    await expect(
      hosted.search({ query: "q", includeDomains: [], attribution }),
    ).rejects.toBeInstanceOf(HostedWebSearchUnavailable);
    expect(seen).toHaveLength(2);
  });

  it("is PUBLIC, so within any provider's ceiling; a disabled provider or an unpriced model is ineligible", async () => {
    // PUBLIC is within even an unreviewed provider's ceiling.
    const unreviewed = setup({ catalog: snapshot({ privacy: "UNREVIEWED" }) });
    await expect(
      unreviewed.hosted.search({ query: "q", includeDomains: [], attribution }),
    ).resolves.toBeDefined();
    for (const catalog of [
      snapshot({ providerStatus: "DISABLED" }),
      snapshot({ priced: false }),
    ]) {
      const { hosted, seen } = setup({ catalog });
      await expect(
        hosted.search({ query: "q", includeDomains: [], attribution }),
      ).rejects.toMatchObject({ refusal: "INELIGIBLE" });
      expect(seen).toHaveLength(0);
    }
  });

  it("records a failed attempt and reports it as unavailable", async () => {
    const { hosted, usage } = setup({
      adapter: {
        code: "anthropic",
        search: () =>
          Promise.reject(
            new ModelProviderFailure("refused", {
              failureClass: "RATE_LIMIT",
              providerCode: "anthropic",
            }),
          ),
      },
    });
    await expect(
      hosted.search({ query: "q", includeDomains: [], attribution }),
    ).rejects.toMatchObject({
      refusal: "PROVIDER_FAILED",
      failureClass: "RATE_LIMIT",
    });
    expect(usage.entries[0]).toMatchObject({
      success: false,
      errorCode: "RATE_LIMIT",
      purpose: "PUBLIC_WEB_SEARCH",
    });
  });

  it("refuses a request without a valid tenant", async () => {
    const { hosted, seen } = setup();
    await expect(
      hosted.search({
        query: "q",
        includeDomains: [],
        attribution: { tenantId: "not-a-uuid", correlationId: "c" },
      }),
    ).rejects.toMatchObject({ refusal: "INVALID_REQUEST" });
    expect(seen).toHaveLength(0);
  });
});

describe("hosted search cost and cap configuration", () => {
  it("adds the per-search fee to the token cost", () => {
    const price = snapshot().prices[0];
    if (price === undefined) throw new Error("fixture");
    expect(hostedSearchCostUsd(undefined, 3, price)).toBeCloseTo(0.03, 8);
  });

  it("defaults the daily cap to 2 USD, allows 0 to switch off, refuses nonsense", () => {
    expect(parseModelSearchDailyCapUsd({})).toBe(2);
    expect(
      parseModelSearchDailyCapUsd({ Q_MODEL_SEARCH_DAILY_USD_CAP: "0" }),
    ).toBe(0);
    expect(
      parseModelSearchDailyCapUsd({ Q_MODEL_SEARCH_DAILY_USD_CAP: "0.5" }),
    ).toBe(0.5);
    expect(() =>
      parseModelSearchDailyCapUsd({ Q_MODEL_SEARCH_DAILY_USD_CAP: "lots" }),
    ).toThrow();
    expect(() =>
      parseModelSearchDailyCapUsd({ Q_MODEL_SEARCH_DAILY_USD_CAP: "500" }),
    ).toThrow();
  });
});

describe("hosted web search: recorded failure shapes (2026-11-17)", () => {
  const adapterRequest: HostedWebSearchAdapterRequest = {
    modelCode: ANTHROPIC_FAST_MODEL,
    query: "Kibo Health Systems Kenya",
    allowedDomains: [],
    maxUses: 3,
    maxOutputTokens: 1_024,
    instruction: "return the sources found",
  };

  function capturingLogger() {
    const lines: {
      context: Readonly<Record<string, unknown>>;
      message: string;
    }[] = [];
    const push = (
      context: Readonly<Record<string, unknown>>,
      message: string,
    ): void => {
      lines.push({ context, message });
    };
    const logger: Logger = {
      debug: push,
      info: push,
      warn: push,
      error: push,
      child: () => logger,
    };
    return { logger, lines };
  }

  function gatewayOver(client: AnthropicWebSearchClient, logger: Logger) {
    const usage = createInMemoryModelUsageRepository();
    const hosted = createHostedWebSearch({
      catalog: createStaticModelCatalog(snapshot()),
      adapter: createAnthropicHostedWebSearch({ apiKey: "x", client }),
      usage,
      modelCode: ANTHROPIC_FAST_MODEL,
      caps: [fixedCap(2)],
      now: () => NOW,
      logger,
    });
    return { hosted, usage };
  }

  it("sends the request body the web search tool spec documents", async () => {
    const { client, bodies } = scriptedClient(() =>
      Promise.resolve(recordedMessage()),
    );
    const adapter = createAnthropicHostedWebSearch({ apiKey: "x", client });
    await adapter.search(adapterRequest, {
      signal: new AbortController().signal,
    });
    expect(bodies[0]).toEqual({
      model: ANTHROPIC_FAST_MODEL,
      max_tokens: 1_024,
      system: "return the sources found",
      // The fast model takes `disabled` at effort high or below.
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: "Kibo Health Systems Kenya" }],
    });
  });

  it("reads a text block that has no citations key at all (the API omits it)", async () => {
    const message = recordedMessage();
    const withBareText = {
      ...message,
      content: [
        // Recorded shape: prose before and between searches has no key.
        { type: "text", text: "I'll search for that." },
        ...message.content,
        { type: "text", text: "Based on the search results, " },
      ],
    } as unknown as Message;
    const { client } = scriptedClient(() => Promise.resolve(withBareText));
    const { logger } = capturingLogger();
    const { hosted, usage } = gatewayOver(client, logger);
    const result = await hosted.search({
      query: "Kibo Health Systems Kenya",
      includeDomains: [],
      attribution,
    });
    expect(result.sources).toHaveLength(3);
    expect(usage.entries[0]).toMatchObject({
      success: true,
      costBasis: "PRICE_SNAPSHOT",
      inputTokens: 9_000,
    });
  });

  it("records a 400 invalid_request as PERMANENT and logs status, type and request id", async () => {
    const { client } = scriptedClient(() =>
      Promise.reject(
        AnthropicAPIError.generate(
          400,
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "tools.0: something about the query Kibo",
            },
          },
          "tools.0: something about the query Kibo",
          new Headers({ "request-id": "req_011recorded" }),
        ),
      ),
    );
    const { logger, lines } = capturingLogger();
    const { hosted, usage } = gatewayOver(client, logger);
    await expect(
      hosted.search({
        query: "Kibo Health Systems Kenya",
        includeDomains: [],
        attribution,
      }),
    ).rejects.toMatchObject({
      refusal: "PROVIDER_FAILED",
      failureClass: "PERMANENT",
    });
    expect(usage.entries[0]).toMatchObject({
      success: false,
      errorCode: "PERMANENT",
      purpose: "PUBLIC_WEB_SEARCH",
    });
    const failed = lines.find(
      (line) => line.message === "model-hosted web search failed",
    );
    expect(failed?.context).toMatchObject({
      provider: "anthropic",
      failureClass: "PERMANENT",
      httpStatus: 400,
      errorType: "invalid_request_error",
      providerRequestId: "req_011recorded",
    });
    // No vendor message, no query text, no key.
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain("Kibo");
    expect(logged).not.toContain("something about");
  });

  it("logs a connection failure's error names and system code, still TRANSIENT", async () => {
    const socket = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    const fetchFailure = new TypeError("fetch failed", { cause: socket });
    const connection = new Error("Connection error.", { cause: fetchFailure });
    connection.name = "APIConnectionError";
    const { client } = scriptedClient(() =>
      Promise.reject(
        new ModelProviderFailure("anthropic connection failed", {
          failureClass: "TRANSIENT",
          providerCode: "anthropic",
          cause: connection,
        }),
      ),
    );
    const { logger, lines } = capturingLogger();
    const { hosted } = gatewayOver(client, logger);
    await expect(
      hosted.search({ query: "q", includeDomains: [], attribution }),
    ).rejects.toMatchObject({ failureClass: "TRANSIENT" });
    expect(
      lines.find((line) => line.message === "model-hosted web search failed")
        ?.context,
    ).toMatchObject({
      failureClass: "TRANSIENT",
      errorName: "APIConnectionError",
      causeName: "TypeError",
      causeCode: "ECONNRESET",
    });
  });

  it("prices an answer whose content cannot be read, instead of an unpriced TRANSIENT row", async () => {
    const unreadable = {
      ...recordedMessage(),
      content: null,
    } as unknown as Message;
    const { client } = scriptedClient(() => Promise.resolve(unreadable));
    const { logger } = capturingLogger();
    const { hosted, usage } = gatewayOver(client, logger);
    await expect(
      hosted.search({ query: "q", includeDomains: [], attribution }),
    ).rejects.toMatchObject({ refusal: "SEARCH_FAILED" });
    expect(usage.entries[0]).toMatchObject({
      success: false,
      errorCode: "INVALID_MODEL_OUTPUT",
      costBasis: "PRICE_SNAPSHOT",
      inputTokens: 9_000,
      outputTokens: 400,
    });
    // 9,000 x 0.10/M + 400 x 0.50/M + 2 searches x 0.01.
    expect(usage.entries[0]?.costUsd).toBeCloseTo(0.0211, 8);
  });
});
