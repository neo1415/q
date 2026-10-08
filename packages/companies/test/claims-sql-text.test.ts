import { describe, expect, it } from "vitest";

import { createCompanyClaims } from "../src/index.js";

/**
 * 2026-10-08 (F1): `GET /v1/companies/claimable` answered 500 for everyone
 * ("trailing junk after parameter at or near $37undefined$38"). A `'\2'`
 * inside the tagged SQL template is an invalid escape, so the template's
 * cooked text for that segment was `undefined` and postgres.js sent the
 * word "undefined" to Postgres. Every segment sent must be real text.
 */

function recordingSql() {
  const sent: (string | undefined)[][] = [];
  const sql = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    sent.push([...strings]);
    return {
      then: (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve(resolve([])),
    };
  };
  return { sql, sent };
}

describe("claim SQL text (F1)", () => {
  it.each(["Bumpa", "getbumpa.com", "zzqqxxvv", "fintech in Nigeria"])(
    "search for %s sends no undefined segment",
    async (text) => {
      const { sql, sent } = recordingSql();
      const claims = createCompanyClaims({ sql: sql as never });
      await claims.search({ userId: "u1" }, text);
      expect(sent.length).toBeGreaterThan(0);
      for (const strings of sent) {
        expect(strings.every((s) => typeof s === "string")).toBe(true);
      }
    },
  );

  it("a claim request from a person with no organisation sends no undefined segment", async () => {
    const { sql, sent } = recordingSql();
    const claims = createCompanyClaims({ sql: sql as never });
    const out = await claims.request(
      { userId: "u1" },
      "00000000-0000-4000-8000-000000000001",
      { method: "REGISTRY_DOCUMENT", clientRequestId: "claim-0001" },
    );
    // Nothing visible in this scripted database: the same as not existing.
    expect(out).toBeNull();
    for (const strings of sent) {
      expect(strings.every((s) => typeof s === "string")).toBe(true);
    }
  });
});
