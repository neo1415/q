import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CAPITAL_Q_KNOWLEDGE_PACK,
  PILOT_CERTIFICATION_LEDGER,
  PackEntrySchema,
  packEntriesFor,
} from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

describe("Capital Q demo-founder knowledge pack", () => {
  it("states every business figure as unknown, never as a fact", () => {
    const business = packEntriesFor(CAPITAL_Q_KNOWLEDGE_PACK, "BUSINESS");
    expect(business.length).toBeGreaterThanOrEqual(6);
    for (const entry of business) {
      expect(entry.truthClass).toBe("UNKNOWN");
      expect(entry.evidenceStatus).toBe("NO_EVIDENCE");
      expect(entry.liveCapability).toBe(false);
      expect(entry.statement).toMatch(
        /does not know it and will not estimate it/u,
      );
    }
  });

  it("rests every live capability on a current certification entry", () => {
    const certified = new Set(
      PILOT_CERTIFICATION_LEDGER.map((e) => e.featureId),
    );
    const live = CAPITAL_Q_KNOWLEDGE_PACK.entries.filter(
      (e) => e.liveCapability,
    );
    expect(live.length).toBe(4);
    for (const entry of live) {
      expect(entry.source.kind).toBe("CERTIFICATION");
      if (entry.source.kind === "CERTIFICATION") {
        expect(certified.has(entry.source.featureId)).toBe(true);
      }
      // Re-certification is due: never presented as current.
      expect(entry.lifecycleStatus).toBe("STALE");
    }
  });

  it("cites only source files that exist, and quotes the locked category", () => {
    for (const entry of CAPITAL_Q_KNOWLEDGE_PACK.entries) {
      if (entry.source.kind !== "SPEC") continue;
      const text = readFileSync(`${repo}${entry.source.ref}`, "utf8");
      expect(text.length).toBeGreaterThan(0);
    }
    const padl = readFileSync(
      `${repo}docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt`,
      "utf8",
    );
    expect(padl).toContain(
      "Capital Q is an AI-native Investment Intelligence Operating System for private capital.",
    );
  });

  it("refuses an invented metric, an unsourced claim, or a capability without a certificate", () => {
    const base = CAPITAL_Q_KNOWLEDGE_PACK.entries[0];
    expect(base).toBeDefined();
    expect(
      PackEntrySchema.safeParse({
        ...base,
        statement: "Capital Q saves analysts 40% of their time.",
      }).success,
    ).toBe(false);
    expect(
      PackEntrySchema.safeParse({ ...base, source: { kind: "NONE" } }).success,
    ).toBe(false);
    expect(
      PackEntrySchema.safeParse({ ...base, liveCapability: true }).success,
    ).toBe(false);
    expect(
      PackEntrySchema.safeParse({
        ...base,
        truthClass: "UNKNOWN",
        evidenceStatus: "DOCUMENT_SUPPORTED",
      }).success,
    ).toBe(false);
  });
});
