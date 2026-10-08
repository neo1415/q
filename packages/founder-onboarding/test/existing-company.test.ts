import { describe, expect, it } from "vitest";

import {
  companyNameKey,
  existingCanonicalCompany,
} from "../src/integration/write-targets.js";

/**
 * F3 (2026-10-08): founder onboarding named "Bumpa" and created a second
 * Bumpa. A name already on Capital Q (one the network may see, outside the
 * founder's own organisation) is claimed, never created again.
 */
describe("company name key", () => {
  it.each([
    ["Bumpa", "bumpa"],
    ["Bumpa Ltd.", "bumpa"],
    ["BUMPA limited", "bumpa"],
    ["Koolboks Inc", "koolboks"],
    ["Société Générale", "societegenerale"],
    ["ekko", "ekko"],
  ])("%s is %s", (name, key) => {
    expect(companyNameKey(name)).toBe(key);
  });
});

describe("existing canonical company", () => {
  function fakeSql(rows: unknown[]) {
    const sent: { strings: (string | undefined)[]; values: unknown[] }[] = [];
    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
      sent.push({ strings: [...strings], values });
      return Promise.resolve(rows);
    };
    return { sql: sql as never, sent };
  }

  it("names the existing company, asking only about network-visible ones outside the founder's organisation", async () => {
    const { sql, sent } = fakeSql([{ canonical_name: "Bumpa" }]);
    await expect(
      existingCanonicalCompany(sql, "Bumpa Ltd", null),
    ).resolves.toBe("Bumpa");
    const text = sent[0]?.strings.join("?") ?? "";
    expect(sent[0]?.strings.every((s) => typeof s === "string")).toBe(true);
    expect(text).toContain("'network_visible', 'public_external'");
    expect(text).toContain("c.organisation_id <>");
    expect(sent[0]?.values).toContain("bumpa");
  });

  it("is null when nothing matches, and never asks for a one-letter name", async () => {
    const none = fakeSql([]);
    await expect(
      existingCanonicalCompany(none.sql, "Zzq", null),
    ).resolves.toBeNull();
    const short = fakeSql([{ canonical_name: "X" }]);
    await expect(
      existingCanonicalCompany(short.sql, "X", null),
    ).resolves.toBeNull();
    expect(short.sent).toHaveLength(0);
  });
});
