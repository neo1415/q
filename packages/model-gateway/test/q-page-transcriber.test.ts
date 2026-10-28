import { describe, expect, it } from "vitest";

import type { Logger } from "@capital-q/observability";

import { createPageTranscriber, type PageImage } from "../src/q/index.js";

/**
 * Deck reading 2026-10-28: picture-only pages transcribed through the
 * gateway. The model is faked; what is checked is what it is sent (vision
 * required, the document's own sensitivity, images two per message) and
 * what is kept (only pages it was shown, within the page and dollar caps).
 */

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as Logger;
const attribution = {
  tenantId: "00000000-0000-4000-8000-0000000000a1",
  correlationId: "cor_x",
};
const image = (page: number): PageImage => ({
  page,
  mediaType: "image/jpeg",
  dataBase64: "AAAAAAAAAAAAAAAAAAAAAAAA",
});

type Sent = {
  sensitivity: string;
  capabilities: readonly string[] | undefined;
  imagesPerMessage: number[];
  taskClass: string;
};

function gateway(
  reply: (pages: number[]) => unknown,
  costUsd = 0.01,
): {
  sent: Sent[];
  execute: Parameters<typeof createPageTranscriber>[0]["gateway"]["execute"];
} {
  const sent: Sent[] = [];
  return {
    sent,
    execute: (request) => {
      const messages = request.messages as readonly {
        content: string;
        images?: readonly unknown[];
      }[];
      sent.push({
        sensitivity: request.sensitivity,
        capabilities: request.requiredCapabilities,
        imagesPerMessage: messages
          .filter((m) => m.images !== undefined)
          .map((m) => m.images?.length ?? 0),
        taskClass: request.taskClass,
      });
      const pages = messages
        .filter((m) => m.images !== undefined)
        .flatMap((m) => (m.content.match(/\d+/g) ?? []).map(Number));
      return Promise.resolve({
        output: { kind: "STRUCTURED", value: reply(pages) },
        cost: { currency: "USD", amount: costUsd, basis: "ESTIMATED" },
        usage: { inputTokens: 1, outputTokens: 1 },
      } as never);
    },
  };
}

describe("page transcriber", () => {
  it("asks a vision model under the document's sensitivity, two pictures per message", async () => {
    const fake = gateway((pages) => ({
      pages: pages.map((page) => ({
        page,
        text: `text of ${String(page)}`,
        legible: true,
        language: "en",
      })),
    }));
    const run = await createPageTranscriber({
      gateway: fake,
      logger,
    }).transcribe({
      images: [image(2), image(5), image(7)],
      sensitivity: "CONFIDENTIAL",
      attribution,
    });
    expect(fake.sent).toEqual([
      {
        sensitivity: "CONFIDENTIAL",
        capabilities: ["VISION"],
        imagesPerMessage: [2, 1],
        taskClass: "STRUCTURED_EXTRACTION",
      },
    ]);
    expect(run.transcriptions.map((t) => [t.page, t.text])).toEqual([
      [2, "text of 2"],
      [5, "text of 5"],
      [7, "text of 7"],
    ]);
    expect(run.untranscribed).toEqual([]);
  });

  it("keeps only pages it was shown, each once", async () => {
    const fake = gateway(() => ({
      pages: [
        { page: 3, text: "real", legible: true, language: null },
        { page: 3, text: "again", legible: true, language: null },
        { page: 40, text: "invented", legible: true, language: null },
      ],
    }));
    const run = await createPageTranscriber({ gateway: fake }).transcribe({
      images: [image(3), image(4)],
      sensitivity: "CONFIDENTIAL",
      attribution,
    });
    expect(run.transcriptions.map((t) => [t.page, t.text])).toEqual([
      [3, "real"],
    ]);
    expect(run.untranscribed).toEqual([4]);
  });

  it("stops at the page cap and the dollar cap, and on a refusal", async () => {
    const pagesOf = (pages: number[]) => ({
      pages: pages.map((page) => ({ page, text: "t", legible: true })),
    });
    const capped = gateway(pagesOf, 0.3);
    const run = await createPageTranscriber({
      gateway: capped,
      maxPages: 10,
      maxCostUsd: 0.5,
    }).transcribe({
      images: Array.from({ length: 20 }, (_u, at) => image(at + 1)),
      sensitivity: "CONFIDENTIAL",
      attribution,
    });
    // 10 pages allowed, 4 per request: the third request is never made
    // because two requests already spent 0.6 of a 0.5 cap.
    expect(capped.sent).toHaveLength(2);
    expect(run.transcriptions).toHaveLength(8);
    expect(run.untranscribed).toHaveLength(12);

    let calls = 0;
    const refusing = await createPageTranscriber({
      gateway: {
        execute: () => {
          calls += 1;
          return Promise.reject(new Error("no eligible vision provider"));
        },
      },
    }).transcribe({
      images: Array.from({ length: 9 }, (_u, at) => image(at + 1)),
      sensitivity: "HIGHLY_CONFIDENTIAL",
      attribution,
    });
    expect(calls).toBe(1);
    expect(refusing.transcriptions).toEqual([]);
    expect(refusing.untranscribed).toHaveLength(9);
  });
});
