import { describe, expect, it } from "vitest";

import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type ModelProvider,
} from "../src/index.js";
import {
  runWebDiscovery,
  type WebDiscoveryAsk,
} from "../src/q/web-discovery.js";
import {
  createWebDiscoveryReader,
  WEB_DISCOVERY_READER_LIMITS,
  type WebDiscoveryReaderLimits,
} from "../src/q/web-discovery-reader.js";
import { TENANT, testCatalog } from "./fixtures.js";

/**
 * Live 2026-11-06 (Savanna Seed, production c71eb2ee4): the page reader got
 * nine pages in one call, timed out twice at 12 s, and the discovery said
 * the pages "didn't name specific companies". Reproduced with a scripted
 * model whose time grows with the pages it is given (300 ms a page here,
 * against a 1.5 s attempt deadline: one call with nine pages cannot
 * finish, a call with three can).
 */

const PAGE_MS = 300;
const LIMITS: WebDiscoveryReaderLimits = {
  ...WEB_DISCOVERY_READER_LIMITS,
  attemptTimeoutMs: 1_500,
  deadlineMs: 6_000,
};

const COMPANIES = {
  companies: ["Tidewell Analytics", "Corallo Robotics", "Marrow Grid"].map(
    (name) => ({
      name,
      founders: [],
      does: null,
      sector: null,
      stage: null,
      place: null,
      sourceRefs: [0],
      quote: name,
    }),
  ),
};

/** A scripted model that takes PAGE_MS for every page it is shown. */
function slowModel(code: "alpha" | "beta", perPageMs: number): ModelProvider {
  const inner = createFakeModelProvider({
    code,
    script: [{ kind: "JSON", value: COMPANIES }],
  });
  return {
    code,
    capabilities: () => inner.capabilities(),
    generate: async (request, context) => {
      const text = request.messages.map((m) => m.content).join("\n");
      const pages = text.split("https://").length - 1;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, pages * perPageMs);
        context.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
      return inner.generate(request, context);
    },
  };
}

function gatewayOf(perPageMs: number) {
  return createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    registry: createModelProviderRegistry([
      slowModel("alpha", perPageMs),
      slowModel("beta", perPageMs),
    ]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
}

type Page = {
  readonly url: string;
  readonly title: string;
  readonly text: string;
};

/** Nine pages: three name the companies, the rest are filler lists. */
const DIRECTORY_PAGES: readonly Page[] = [
  {
    url: "https://startupdirectory.example/pre-seed-picks",
    title: "Pre-seed startups to watch",
    text: "Our picks: Tidewell Analytics in Leeds, Corallo Robotics in Lisbon, Marrow Grid in Accra and Kobo Harbour in Ibadan.",
  },
  ...Array.from({ length: 8 }, (_, i) => ({
    url: `https://list${String(i)}.example/startups`,
    title: `Startup list ${String(i)}`,
    text: "A list of programmes, events and accelerators for founders.",
  })),
];

/** A result on a company's own site. */
const OWN_SITE: Page = {
  url: "https://koboharbour.example/about",
  title: "About Kobo Harbour | Savings for Ibadan",
  text: "Kobo Harbour is a savings app for families in Ibadan.",
};

function scriptedWeb(pages: readonly Page[]) {
  const timeline: string[] = [];
  const port: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: async (proposal: QToolProposal): Promise<QToolCallOutcome> => {
      const ok = (data: unknown): QToolCallOutcome => ({
        callId: proposal.callId,
        toolName: "public_web.search",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "PUBLIC",
        result: { ok: true, data },
        latencyMs: 1,
      });
      if (proposal.name === "research_public_web") {
        timeline.push(`start ${proposal.callId}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        timeline.push(`end ${proposal.callId}`);
        return ok({
          status: "OK",
          sources: pages.map((page, i) => ({
            index: i + 1,
            url: page.url,
            domain: new URL(page.url).hostname,
            title: page.title,
            publishedAt: null,
            retrievedAt: "2026-11-06T10:59:00Z",
            excerpt: page.text,
            extracted: true,
            instructionRiskSignals: 0,
          })),
        });
      }
      if (proposal.name === "search_companies") return ok({ items: [] });
      throw new Error(`unexpected ${proposal.name}`);
    },
  };
  return { port, timeline };
}

const ASK: WebDiscoveryAsk = {
  text: "hey, find me new companies online and their founders",
  sectors: ["fintech"],
  countries: ["NG"],
  stages: [],
  count: null,
};

async function discover(
  pages: readonly Page[],
  limits: WebDiscoveryReaderLimits,
  perPageMs = PAGE_MS,
) {
  const web = scriptedWeb(pages);
  const answer = await runWebDiscovery({
    ask: ASK,
    mandate: null,
    tools: web.port,
    context: {} as QToolExecutionContext,
    available: new Set(["research_public_web", "search_companies"]),
    reader: createWebDiscoveryReader({ gateway: gatewayOf(perPageMs), limits }),
    attribution: {
      tenantId: TENANT,
      userId: "44444444-4444-4444-8444-444444444444",
      correlationId: "cor_web_discovery_timeout",
    },
  });
  return { answer, web };
}

describe("web discovery: the page reader under a slow model (live 2026-11-06)", () => {
  it("reproduces production: nine pages in one call time out, and nothing is listed", async () => {
    const { answer } = await discover(DIRECTORY_PAGES, {
      ...LIMITS,
      pagesPerCall: 12,
    });
    expect(answer?.outcome).toBe("NONE");
    expect(answer?.readerFailed).toBe(true);
    expect(answer?.companies).toEqual([]);
    // Said as it is: the pages were not read, not that they named nothing.
    expect(answer?.text).toMatch(/couldn't read them in time/u);
  }, 20_000);

  it("read three pages a call, side by side, the same pages list the companies", async () => {
    const { answer } = await discover(DIRECTORY_PAGES, LIMITS);
    expect(answer?.outcome).toBe("FOUND");
    expect(answer?.readerFailed).toBe(false);
    expect(answer?.companies.map((c) => c.name).sort()).toEqual([
      "Corallo Robotics",
      "Marrow Grid",
      "Tidewell Analytics",
    ]);
    // A list site named after its own title is not a company.
    expect(answer?.text).not.toContain("list 0");
  }, 20_000);

  it("when every reading fails, a company's own site still names it (deterministic)", async () => {
    const { answer } = await discover(
      [...DIRECTORY_PAGES.slice(0, 2), OWN_SITE],
      LIMITS,
      10_000,
    );
    expect(answer?.readerFailed).toBe(true);
    expect(answer?.outcome).toBe("FOUND");
    // Its own site, and the directory names it too; "Startup list 0" on
    // list0.example is a list's own name, named by no other page.
    expect(answer?.companies.map((c) => c.name)).toEqual(["Kobo Harbour"]);
    // Nothing guessed: no founder, nothing it does beyond the page.
    expect(answer?.companies[0]?.founders).toEqual([]);
    expect(answer?.text).toContain("founders not named in the sources I read");
    // The directory's names need the reader; none is guessed from it.
    expect(answer?.text).not.toContain("Tidewell");
  }, 20_000);

  it("the first search lands before the others start, so a resting key is skipped by them", async () => {
    const { web } = await discover(DIRECTORY_PAGES, LIMITS);
    const [first, second, ...rest] = web.timeline;
    expect(first).toMatch(/^start /u);
    expect(second).toBe(first?.replace("start", "end"));
    // The rest went side by side.
    expect(rest.slice(0, 2).every((step) => step.startsWith("start"))).toBe(
      true,
    );
  }, 20_000);
});
