import { describe, expect, it } from "vitest";

import type { QArtifactContent } from "@capital-q/contracts";
import { createDeckPageRenderer } from "@capital-q/q-specialists";

import { pdfPagesToPng } from "../src/documents/page-images.js";

/**
 * Deck wave 8: the vision critic's pages are the deck's own PDF, drawn by
 * pdf.js on the worker. Local only: no network, no model.
 */

function content(count: number): QArtifactContent {
  return {
    sections: [{ heading: "Summary", body: "", findings: [] }],
    gaps: [],
    deck: {
      direction: "MINIMAL_INSTITUTIONAL",
      markIsDraft: false,
      slides: Array.from({ length: count }, (_, i) => ({
        layout: i === 0 ? ("TITLE" as const) : ("BULLETS" as const),
        title: i === 0 ? "Ledgerline" : "Traction",
        bullets: i === 0 ? [] : ["Paying businesses through accountants."],
        bulletsRight: [],
        section: 0,
      })),
    },
  };
}

describe("deck pages as PNG", () => {
  it("draws each page at slide size, never more than asked", async () => {
    const render = createDeckPageRenderer({
      rasterize: (pdf, maxPages) => pdfPagesToPng(pdf, maxPages),
      fetch: () => Promise.reject(new Error("no network in tests")),
    });
    const pages = await render({ content: content(4), maxPages: 3 });
    expect(pages).toHaveLength(3);
    for (const page of pages) {
      const bytes = Buffer.from(page, "base64");
      // The PNG signature, and a 960x540 header.
      expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect(bytes.readUInt32BE(16)).toBe(960);
      expect(bytes.readUInt32BE(20)).toBe(540);
      // Under the gateway's per-image ceiling.
      expect(page.length).toBeLessThan(700_000);
    }
  });
});
