import { randomUUID } from "node:crypto";

import type { QConversationMessage } from "@capital-q/q-runtime";
import { describe, expect, it } from "vitest";

import { conversationContextOf } from "../src/q/index.js";
import { TENANT } from "./fixtures.js";

/**
 * Guard I-top-five (2026-10-26, run c630d19a): five ranked answer cards
 * rendered past the turn's 3,200 characters and were cut after the second
 * card, mid-card. A turn too long to keep whole keeps every listed item,
 * in its place, with its short fields, before anything is cut.
 */
const NAMES = [
  "Dawaledger",
  "Marketlight Grids",
  "Tarmacly",
  "Harbourline Cargo",
  "Koolboks",
];
const card = (name: string, index: number) => ({
  name,
  key: name.toLowerCase().replace(/\s/gu, ""),
  hue: index + 1,
  line: "Series A · Nigeria",
  fit: { of: 6, score: 7.6, measured: 5 },
  said: `${name} is strong on stage, sector and cheque compatibility, partial on geography and thesis; round terms not known yet. Capital Q mandate fit 7.6 out of 10, 5 of 6 measures known; not a quality score.`,
  about: `${name} does something specific for a specific market, described at length so that the card is as long as a real one is.`,
  reasons: [
    "Raising Series A; you invest at Series A.",
    "In one of your sectors.",
    "Round terms not known yet.",
  ],
  measures: ["Stage", "Sector", "Geography", "Cheque", "Thesis", "Terms"].map(
    (label) => ({ label, level: "STRONG", value: null }),
  ),
  subject: { kind: "COMPANY", companyId: randomUUID() },
});
const listed = {
  id: randomUUID(),
  tenantId: TENANT,
  conversationId: randomUUID(),
  runId: randomUUID(),
  role: "Q",
  content: `Ranked by fit with your mandate, the top five: ${NAMES.join(", ")}.`,
  contentType: "TEXT",
  createdAt: new Date().toISOString(),
  blocks: [
    {
      kind: "ANSWER_CARDS",
      shape: "RANKED",
      cards: NAMES.map(card),
    },
  ],
} as unknown as QConversationMessage;

describe("a turn too long to keep whole", () => {
  it("keeps every card, numbered in order, and is not cut", () => {
    const { text } = conversationContextOf([listed]);
    expect(text.length).toBeLessThanOrEqual(3_200);
    expect(text.endsWith("…")).toBe(false);
    NAMES.forEach((name, index) => {
      expect(text).toContain(`{"#":${String(index + 1)},`);
      expect(text).toContain(`"name":"${name}"`);
    });
    // The lists inside a card are what gives way.
    expect(text).not.toContain("measures");
  });

  it("keeps a short turn whole", () => {
    const short = {
      ...listed,
      blocks: [{ kind: "ANSWER_CARDS", cards: [card("Dawaledger", 0)] }],
    } as unknown as QConversationMessage;
    expect(conversationContextOf([short]).text).toContain("measures");
  });
});
