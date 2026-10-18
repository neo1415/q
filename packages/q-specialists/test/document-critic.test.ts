import { describe, expect, it } from "vitest";

import type { QArtifactContent, QSlide } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";

import {
  createDeckPageRenderer,
  createVisionDocumentCritic,
  runDocumentPipeline,
  type DocumentCriticRun,
  type DocumentPipelineInput,
} from "../src/index.js";

/**
 * Deck wave 8: the vision critic behind the pipeline's typed port. Fakes
 * only: the gateway is a recording function and the pages are stand-in
 * PNG strings. Off by default, one round, twelve pages at most, typed
 * fixes applied by code, cost logged.
 */

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function slide(
  title: string,
  bullets: string[] = ["One clear point."],
): QSlide {
  return { layout: "BULLETS", title, bullets, bulletsRight: [], section: 0 };
}

function content(count: number): QArtifactContent {
  return {
    sections: [{ heading: "Summary", body: "", findings: [] }],
    gaps: [],
    deck: {
      direction: "MINIMAL_INSTITUTIONAL",
      markIsDraft: false,
      slides: [
        { ...slide("Ledgerline", []), layout: "TITLE" },
        ...Array.from({ length: count - 1 }, (_, i) =>
          slide(`Slide ${"abcdefghijklmnopqrstuvwxyz".charAt(i)}`, [
            "We reconcile bank feeds for small businesses every day.",
            "Accountants file VAT returns from the same screen.",
          ]),
        ),
      ],
    },
  };
}

type Call = {
  request: {
    taskClass: string;
    requiredCapabilities?: readonly string[];
    attribution: { purpose?: string };
    messages: readonly { role: string; images?: readonly unknown[] }[];
  };
};

function gateway(value: unknown, calls: Call[], fail = false): ModelGateway {
  return {
    execute: (request: Call["request"]) => {
      calls.push({ request });
      if (fail) return Promise.reject(new Error("provider down"));
      return Promise.resolve({
        output: { kind: "STRUCTURED", value },
        usage: { inputTokens: 15_600, cachedInputTokens: 0, outputTokens: 120 },
        cost: { currency: "USD", amount: 0.021, basis: "PRICE_SNAPSHOT" },
      });
    },
  } as unknown as ModelGateway;
}

const ATTRIBUTION = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  qRunId: "22222222-0000-4000-8000-000000000001",
  correlationId: "33333333-0000-4000-8000-000000000001",
};

const VERDICT = {
  rubric: { content: 3, design: 4, coherence: 5 },
  fixes: [
    { page: 3, kind: "SHORTEN_BODY", reason: "Two long lines." },
    { page: 1, kind: "DROP_IMAGE", reason: null },
    { page: 40, kind: "DEDUPE_TITLE", reason: null },
  ],
};

describe("the vision critic", () => {
  it("is off unless enabled: no pages drawn, no model asked", async () => {
    const calls: Call[] = [];
    let drawn = 0;
    const critic = createVisionDocumentCritic({
      enabled: false,
      gateway: gateway(VERDICT, calls),
      renderPages: () => {
        drawn += 1;
        return Promise.resolve([PNG]);
      },
      sensitivity: "CONFIDENTIAL",
      attribution: ATTRIBUTION,
    });
    expect(await critic.review({ content: content(4) })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(drawn).toBe(0);
  });

  it("looks at at most twelve pages through the gateway's vision route and returns typed fixes, with its cost", async () => {
    const calls: Call[] = [];
    const runs: DocumentCriticRun[] = [];
    let asked = 0;
    const critic = createVisionDocumentCritic({
      enabled: true,
      gateway: gateway(VERDICT, calls),
      renderPages: ({ maxPages }) => {
        asked = maxPages;
        return Promise.resolve(Array.from({ length: 20 }, () => PNG));
      },
      sensitivity: "CONFIDENTIAL",
      attribution: ATTRIBUTION,
      onRun: (run) => runs.push(run),
    });
    const fixes = await critic.review({ content: content(20) });
    expect(asked).toBe(12);
    expect(calls).toHaveLength(1);
    const request = calls[0]?.request;
    expect(request?.requiredCapabilities).toEqual(["VISION"]);
    expect(request?.attribution.purpose).toBe("DOCUMENT");
    const images = (request?.messages ?? []).flatMap(
      (message) => message.images ?? [],
    );
    expect(images).toHaveLength(12);
    for (const message of request?.messages ?? []) {
      expect((message.images ?? []).length).toBeLessThanOrEqual(2);
    }
    // Page 3 is slide index 2; the cover and pages it never saw are ignored.
    expect(fixes).toEqual([{ kind: "SHORTEN_BODY", slide: 2 }]);
    expect(runs).toEqual([
      {
        pages: 12,
        rubric: { content: 3, design: 4, coherence: 5 },
        fixes: 1,
        costUsd: 0.021,
        inputTokens: 15_600,
        outputTokens: 120,
      },
    ]);
  });

  it("a failed call asks for nothing", async () => {
    const calls: Call[] = [];
    const critic = createVisionDocumentCritic({
      enabled: true,
      gateway: gateway(VERDICT, calls, true),
      renderPages: () => Promise.resolve([PNG, PNG]),
      sensitivity: "CONFIDENTIAL",
      attribution: ATTRIBUTION,
    });
    expect(await critic.review({ content: content(3) })).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("runs one round in the pipeline, and code applies its fix", async () => {
    const calls: Call[] = [];
    const critic = createVisionDocumentCritic({
      enabled: true,
      gateway: gateway(
        {
          rubric: { content: 2, design: 4, coherence: 4 },
          fixes: [{ page: 2, kind: "DEDUPE_TITLE", reason: null }],
        },
        calls,
      ),
      renderPages: ({ content: shown }) =>
        Promise.resolve((shown.deck?.slides ?? []).map(() => PNG)),
      sensitivity: "CONFIDENTIAL",
      attribution: ATTRIBUTION,
    });
    const input: DocumentPipelineInput = {
      kind: "PITCH_DECK",
      grounding: [],
      sectorCodes: [],
      directionChosen: true,
      brand: null,
      critic,
      sensitivity: "CONFIDENTIAL",
      attribution: ATTRIBUTION,
    };
    const out = await runDocumentPipeline(content(4), input);
    expect(calls).toHaveLength(1);
    expect(out.content.deck?.slides[1]?.title).toBe("Slide a (continued)");
  });

  it("draws the pages it is shown from the deck's own PDF, capped", async () => {
    const seen: { header: string; maxPages: number }[] = [];
    const render = createDeckPageRenderer({
      rasterize: (pdf, maxPages) => {
        seen.push({
          header: new TextDecoder("latin1").decode(pdf.slice(0, 5)),
          maxPages,
        });
        return Promise.resolve(Array.from({ length: maxPages }, () => PNG));
      },
      fetch: () => Promise.reject(new Error("no network in tests")),
    });
    const pages = await render({ content: content(15), maxPages: 12 });
    expect(seen).toEqual([{ header: "%PDF-", maxPages: 12 }]);
    expect(pages).toHaveLength(12);
  });
});
