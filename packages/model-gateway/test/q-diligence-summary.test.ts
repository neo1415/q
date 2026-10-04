import { describe, expect, it } from "vitest";

import type { Logger } from "@capital-q/observability";

import {
  createDiligenceDocumentSummariser,
  summaryLine,
  summaryText,
} from "../src/q/index.js";

/**
 * 2026-10-04: Q's one line on a document shared in diligence. The model is
 * faked: what is checked is what it is sent (that document's own text, and
 * nothing else) and what is kept (one clean bounded line, or nothing).
 */

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as Logger;

const TENANT = "00000000-0000-4000-8000-0000000000a1";

describe("diligence document summary", () => {
  it("sends only the document's own passages and title, as untrusted content, sensitivity CONFIDENTIAL", async () => {
    const sent: { sensitivity: string; text: string }[] = [];
    const summariser = createDiligenceDocumentSummariser({
      logger,
      gateway: {
        execute: (request) => {
          sent.push({
            sensitivity: request.sensitivity,
            text: JSON.stringify(request.messages),
          });
          return Promise.resolve({
            output: {
              kind: "STRUCTURED",
              value: {
                summary: "Pitch deck\n· 14 slides · ARR $84k (self-reported)",
              },
            },
          } as never);
        },
      },
    });
    const line = await summariser.summarise({
      title: "Pitch deck v3",
      pages: 14,
      passages: ["Ajopot   savings", "ARR $84k"],
      attribution: { tenantId: TENANT, correlationId: "cor_x" },
    });
    expect(line).toBe("Pitch deck · 14 slides · ARR $84k (self-reported)");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.sensitivity).toBe("CONFIDENTIAL");
    expect(sent[0]?.text).toContain("Ajopot savings\\nARR $84k");
    expect(sent[0]?.text).toContain("UNTRUSTED_CONTENT");
  });

  it("says nothing for an empty document or a failed call", async () => {
    const failing = createDiligenceDocumentSummariser({
      logger,
      gateway: { execute: () => Promise.reject(new Error("down")) },
    });
    const base = {
      title: "x",
      pages: null,
      attribution: { tenantId: TENANT, correlationId: "cor_x" },
    };
    expect(await failing.summarise({ ...base, passages: ["  "] })).toBeNull();
    expect(await failing.summarise({ ...base, passages: ["text"] })).toBeNull();
    expect(summaryLine({ summary: null })).toBeNull();
    expect(summaryLine({ summary: "a".repeat(200) + "b" })?.length).toBe(200);
    expect(summaryText(["a", "", " b "])).toBe("a\nb");
  });
});
