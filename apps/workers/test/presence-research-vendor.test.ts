import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderCredential } from "@capital-q/config/model-providers";
import { PublicWebSearchRequestSchema } from "@capital-q/q-research";

import { composeWorkerResearchProvider } from "../src/presence/composition.js";

/**
 * P0-4 (onboarding plan 2026-11-07, RC4): production's SERP_API_KEY holds
 * a Serper.dev key under a SerpApi name. q-api settles the vendor with the
 * detecting provider (composition/research.ts); the worker sent the key to
 * SerpApi alone, so every worker search failed authentication. The worker
 * must ask Serper.dev too, as q-api does.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker research: the SERP key reaches the vendor it belongs to", () => {
  it("tries Serper.dev with SERP_API_KEY, not SerpApi alone", async () => {
    const hosts: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      hosts.push(new URL(url).hostname);
      // Refused everywhere: only which vendors were asked matters here.
      return Promise.resolve(new Response("{}", { status: 401 }));
    });
    const { provider } = composeWorkerResearchProvider({
      tavily: undefined,
      brightData: undefined,
      serpApi: new ProviderCredential("disabled-locally-000000000000"),
    });
    expect(provider).toBeDefined();
    await provider
      ?.search(
        PublicWebSearchRequestSchema.parse({ query: "Tamarind Ledger" }),
        {},
      )
      .catch(() => undefined);
    expect(hosts.some((host) => host.endsWith("serper.dev"))).toBe(true);
  });
});
