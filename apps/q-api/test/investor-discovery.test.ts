import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { QAnswerCardsBlockSchema } from "@capital-q/contracts/q";
import { runInvestorDiscovery } from "@capital-q/model-gateway/q";
import {
  createCounterpartDiscovery,
  createInMemoryKnownEntityStore,
  createKnownEntityIndex,
} from "@capital-q/q-research";
import type { QToolExecutionContext, QToolPort } from "@capital-q/q-runtime";
import {
  createDiscoverCounterpartsTool,
  DiscoverCounterpartsInputSchema,
} from "@capital-q/q-tools";
import { describe, expect, it } from "vitest";

import {
  loadPreparedSeed,
  parsePreparedSeed,
} from "../src/composition/prepared-entity-seed.js";

/**
 * D1 end to end on the REAL prepared Qatar five: the first read's words
 * become cards and a sentence by code, with no web search and no model.
 */

const seed = parsePreparedSeed(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../scripts/seed/research/qatar-five.v1.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ),
);

async function world() {
  const store = createInMemoryKnownEntityStore();
  await loadPreparedSeed(store, seed, { webOrigin: "https://app.example" });
  const known = createKnownEntityIndex({ store });
  await known.warm();
  let webCalls = 0;
  const counterparts = createCounterpartDiscovery({
    known,
    providers: [
      {
        code: "fake",
        search: () => {
          webCalls += 1;
          return Promise.resolve({ hits: [], latencyMs: 1 });
        },
        extract: () =>
          Promise.resolve({ pages: [], failedUrls: [], latencyMs: 1 }),
      },
    ],
  });
  const tool = createDiscoverCounterpartsTool({ counterparts } as never);
  const context = {
    actor: { tenantId: "t-1", userId: "u-1" },
  } as unknown as QToolExecutionContext;
  const tools: Pick<QToolPort, "execute"> = {
    execute: async (call) => {
      const input = DiscoverCounterpartsInputSchema.parse(call.arguments);
      // Authorisation is covered in q-tools; this exercises the answer.
      const data = await tool.execute(input, context, undefined);
      return {
        callId: call.callId,
        status: "SUCCEEDED",
        result: { ok: true, data },
      } as never;
    },
  };
  return { tools, context, webCalls: () => webCalls };
}

const ASKS = [
  {
    // "i need top three arab investors that may be interested in this"
    regions: ["Arab"],
    sector: null,
    stage: null,
    count: 3,
    aboutMyCompany: true,
  },
  // "Gulf money for us"
  {
    regions: ["Gulf"],
    sector: null,
    stage: null,
    count: null,
    aboutMyCompany: true,
  },
  // "who in Qatar might back us"
  {
    regions: ["Qatar"],
    sector: "fintech",
    stage: "seed",
    count: null,
    aboutMyCompany: true,
  },
] as const;

describe("investor discovery on the prepared Qatar five", () => {
  it.each(ASKS)(
    "answers %o with three investors, cards and Rehearse, no web",
    async (ask) => {
      const { tools, context, webCalls } = await world();
      const answer = await runInvestorDiscovery({
        ask,
        tools,
        context,
        available: new Set(["discover_investors"]),
      });
      expect(answer).not.toBeNull();
      expect(answer?.shown).toBe(3);
      expect(webCalls()).toBe(0);
      const text = answer?.text ?? "";
      expect(text).toMatch(/^Here are three .*investors who could fit this: /u);
      for (const name of ["QInvest", "AlRayan", "Muhannad Taslaq"]) {
        expect(text).toContain(name);
      }
      // The agency is a door-opener, not a fund; the executive is not an investor.
      expect(text).not.toContain("Invest Qatar");
      expect(text).not.toContain("Shadi");
      expect(text).toContain("none has said it is interested");
      const block = QAnswerCardsBlockSchema.parse(answer?.block);
      expect(block.cards).toHaveLength(3);
      for (const card of block.cards) {
        expect(card.external?.rehearse).toBe(true);
        expect(card.external?.externalPersonId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(card.reasons.join(" ")).toContain("Based in Qatar");
      }
      expect(
        block.followUps.every((line) => line.startsWith("Rehearse with")),
      ).toBe(true);
    },
  );

  it("names the agency honestly when asked for five", async () => {
    const { tools, context } = await world();
    const answer = await runInvestorDiscovery({
      ask: ASKS[0],
      tools,
      context,
      available: new Set(["discover_investors"]),
    });
    const five = await runInvestorDiscovery({
      ask: { ...ASKS[0], count: 5 },
      tools,
      context,
      available: new Set(["discover_investors"]),
    });
    expect(answer?.shown).toBe(3);
    expect(five?.shown).toBe(4);
    expect(five?.text).toContain(
      "Invest Qatar is not a fund, but it can open doors.",
    );
    const agency = five?.block?.cards.find(
      (card) => card.name === "Invest Qatar",
    );
    expect(agency?.view).toBe("Not a fund");
  });

  it("falls back (null) when the tool is not offered", async () => {
    const { tools, context } = await world();
    expect(
      await runInvestorDiscovery({
        ask: ASKS[0],
        tools,
        context,
        available: new Set(),
      }),
    ).toBeNull();
  });
});
