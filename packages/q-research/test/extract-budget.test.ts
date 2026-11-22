import { afterEach, describe, expect, it, vi } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createPublicWebResearchService,
  EXTRACT_BUDGET_MS,
} from "../src/application/research-service.js";
import type { PublicWebResearchProvider } from "../src/ports.js";

// W4-F (audit finding 9): the tests that measure time run it fake, so no
// assertion depends on how fast the machine is (each turns it on itself).
afterEach(() => {
  vi.useRealTimers();
});

/**
 * Run fake time forward in small steps until `work` settles, so a
 * deadline or a slow stub plays out exactly, however busy the machine.
 */
async function settled<T>(work: Promise<T>, stepMs = 5): Promise<T> {
  let done = false;
  // Watched, not consumed: a rejection still reaches the caller.
  void work.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let at = 0; !done && at < 120_000; at += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  return work;
}

/**
 * Production 2026-10-25 (run 37b56282): "Who is the founder of Paystack?"
 * waited 8 s on a page extract after the search snippets already held the
 * answer -- 16.5 s in all. The reads have their own budget; past it the
 * answer goes on the snippets, with the same sources.
 */

const actor: ActorContext = ActorContextSchema.parse({
  userId: "44444444-4444-4444-8444-444444444444",
  tenantId: "33333333-3333-4333-8333-333333333333",
  organisationId: "22222222-2222-4222-8222-222222222222",
  actorType: "HUMAN",
});

function provider(extractMs: number): PublicWebResearchProvider & {
  readonly reads: () => number;
} {
  let reads = 0;
  return {
    code: "serper",
    reads: () => reads,
    search: () =>
      Promise.resolve({
        hits: [
          {
            url: "https://en.wikipedia.org/wiki/Paystack",
            title: "Paystack - Wikipedia",
            snippet:
              "Paystack was founded in 2015 by Shola Akinlade and Ezra Olubi.",
            publishedAt: null,
            relevance: 0.9,
          },
        ],
        latencyMs: 5,
      }),
    extract: (request) => {
      reads += 1;
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              pages: request.urls.map((url) => ({
                url,
                title: "Paystack",
                text: "Paystack was founded by Shola Akinlade and Ezra Olubi in Lagos.",
              })),
              failedUrls: [],
              latencyMs: extractMs,
            }),
          extractMs,
        ),
      );
    },
  };
}

const ask = (runId: string) => ({
  actor,
  runId,
  correlationId: "cor_extract",
  requestedQuery: "Paystack founder",
  entityName: "Paystack",
  userText: "Who is the founder of Paystack?",
  subject: null,
});

describe("page reads never hold the answer past their budget", () => {
  it("is three seconds by default", () => {
    expect(EXTRACT_BUDGET_MS).toBe(3_000);
  });

  it("a slow read: the answer goes on the snippets, the same sources, on time", async () => {
    vi.useFakeTimers();
    const slow = provider(400);
    const service = createPublicWebResearchService({
      provider: slow,
      extractBudgetMs: 50,
    });
    const started = Date.now();
    const outcome = await settled(service.research(ask("run-slow")));
    expect(Date.now() - started).toBeLessThan(300);
    expect(outcome.status).toBe("OK");
    if (outcome.status !== "OK") return;
    expect(outcome.sources.map((source) => source.domain)).toEqual([
      "en.wikipedia.org",
    ]);
    expect(outcome.sources[0]?.extracted).toBe(false);
    expect(outcome.sources[0]?.excerpt).toContain("Shola Akinlade");
  });

  it("a read inside the budget still enriches the source", async () => {
    const quick = provider(5);
    const service = createPublicWebResearchService({
      provider: quick,
      extractBudgetMs: 500,
    });
    const outcome = await service.research(ask("run-quick"));
    expect(outcome.status).toBe("OK");
    if (outcome.status !== "OK") return;
    expect(outcome.sources[0]?.extracted).toBe(true);
  });
});
