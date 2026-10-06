import { describe, expect, it } from "vitest";

import { alertMatches } from "@capital-q/contracts";

import { createStartupAlertWatcher } from "../src/network/startup-alert-watcher.js";

/**
 * P14: a saved "Find a startup" alert tells its investor when a newly
 * ready company matches, once. Matching is deterministic over network-level
 * facts; unknown never matches; a raise question waits for the disclosure
 * evaluator (Discover) and is never guessed here.
 */

const LEDGERLINE = {
  name: "Ledgerline",
  description: "Checks every invoice and files VAT returns for Nigerian SMEs",
  stageCode: "seed",
  countryCode: "NG",
  sectorNodeIds: ["fintech-node", "financial-services-node"],
};

describe("alertMatches", () => {
  it("matches on stage, country and sector (a parent includes its children)", () => {
    expect(
      alertMatches(
        {
          stageCodes: ["seed"],
          countryCodes: ["NG"],
          sectorNodeIds: ["financial-services-node"],
        },
        LEDGERLINE,
      ),
    ).toBe(true);
    expect(alertMatches({ stageCodes: ["series_a"] }, LEDGERLINE)).toBe(false);
  });

  it("unknown is not a match, an empty alert matches nothing, a raise filter waits", () => {
    expect(
      alertMatches(
        { stageCodes: ["seed"] },
        { ...LEDGERLINE, stageCode: null },
      ),
    ).toBe(false);
    expect(alertMatches({}, LEDGERLINE)).toBe(false);
    expect(
      alertMatches(
        { countryCodes: ["NG"], raise: { min: "100000", currency: "USD" } },
        LEDGERLINE,
      ),
    ).toBe(false);
  });

  it("loose words match the name or description", () => {
    expect(alertMatches({ words: ["invoice"] }, LEDGERLINE)).toBe(true);
    expect(alertMatches({ words: ["aviation"] }, LEDGERLINE)).toBe(false);
  });
});

describe("the watcher", () => {
  it("tells each matching alert's investor once, and nobody for a hidden company", async () => {
    const inserts: unknown[][] = [];
    const answers: unknown[][] = [
      [
        {
          canonical_name: "Ledgerline",
          short_description: LEDGERLINE.description,
          current_stage_code: "seed",
          headquarters_country: "NG",
          sector_node_ids: LEDGERLINE.sectorNodeIds,
        },
      ],
      [
        {
          id: "alert-1",
          tenant_id: "t1",
          user_id: "u1",
          description: "seed fintech in Nigeria",
          filters: { stageCodes: ["seed"], countryCodes: ["NG"] },
        },
        {
          id: "alert-2",
          tenant_id: "t2",
          user_id: "u2",
          description: "aviation",
          filters: { words: ["aviation"] },
        },
      ],
      [{ id: "n1" }],
    ];
    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (
        strings.join("?").includes("insert into communication.notifications")
      ) {
        inserts.push(values);
      }
      return Promise.resolve(answers.shift() ?? []);
    };
    const watch = createStartupAlertWatcher({ sql: sql as never });
    expect(await watch("company-1")).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("startup-alert:alert-1:company-1");
    expect(inserts[0]).toContain("/company/company-1");

    const hidden = createStartupAlertWatcher({
      sql: (() => Promise.resolve([])) as never,
    });
    expect(await hidden("company-2")).toBe(0);
  });
});
