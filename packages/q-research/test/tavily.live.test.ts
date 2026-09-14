import { describe, expect, it } from "vitest";

import { createPublicWebResearchService } from "../src/application/research-service.js";
import { createTavilyResearchProvider } from "../src/providers/tavily.js";

/**
 * Live smoke against the real research provider (CQ-Q-RESEARCH-001 §37).
 *
 * Runs only through `pnpm test:live-model` with the key present; skipped
 * otherwise, never faked. The subject is a genuinely public one and the
 * query carries no Capital Q data. At most two search calls and one extract
 * call are made. Nothing here prints the key; the assertions check that no
 * output does either.
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const KEY = process.env["TAVILY_API_KEY"];
const runLive = LIVE && KEY !== undefined ? describe : describe.skip;

const actor = {
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorType: "HUMAN",
} as unknown as Parameters<
  ReturnType<typeof createPublicWebResearchService>["research"]
>[0]["actor"];

runLive("tavily live smoke", () => {
  it("searches a public subject, reads two sources and returns bounded provenance without the key", async () => {
    if (KEY === undefined) {
      throw new Error("unreachable");
    }
    const lines: string[] = [];
    const logger = {
      debug: (c: unknown, m: string) => lines.push(JSON.stringify([c, m])),
      info: (c: unknown, m: string) => lines.push(JSON.stringify([c, m])),
      warn: (c: unknown, m: string) => lines.push(JSON.stringify([c, m])),
      error: (c: unknown, m: string) => lines.push(JSON.stringify([c, m])),
      child: () => logger,
    };
    const service = createPublicWebResearchService({
      provider: createTavilyResearchProvider({
        apiKey: KEY,
        timeoutSeconds: 30,
      }),
      logger,
    });
    const outcome = await service.research({
      actor,
      runId: "90000000-0000-4000-8000-000000000001",
      correlationId: "cor_live_smoke",
      requestedQuery: "Nigerian Exchange Group overview",
      userText: "Give me a public overview of the Nigerian Exchange Group",
      subject: null,
      extractCount: 2,
    });
    expect(outcome.status).toBe("OK");
    if (outcome.status !== "OK") {
      throw new Error("unreachable");
    }
    expect(outcome.budget.searchCalls).toBeLessThanOrEqual(2);
    expect(outcome.budget.extractCalls).toBeLessThanOrEqual(1);
    expect(outcome.sources.length).toBeGreaterThan(0);
    expect(outcome.sources.length).toBeLessThanOrEqual(2);
    for (const source of outcome.sources) {
      expect(source.url.startsWith("https://")).toBe(true);
      expect(source.domain.length).toBeGreaterThan(3);
      expect(source.excerpt.length).toBeGreaterThan(0);
      expect(source.excerpt.length).toBeLessThanOrEqual(2_008);
    }
    const everything = JSON.stringify(outcome) + lines.join("\n");
    expect(everything).not.toContain(KEY);
    expect(everything).not.toMatch(/tvly-[A-Za-z0-9]/);
    expect(everything).not.toContain("requestId");
    // Presence and shape only, never values that could identify the key.
    console.log(
      `live research: ${String(outcome.budget.searchCalls)} search, ${String(outcome.budget.extractCalls)} extract, ${String(outcome.sources.length)} sources from ${outcome.sources.map((s) => s.domain).join(", ")}`,
    );
  });
});
