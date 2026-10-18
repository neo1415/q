import { describe, expect, it } from "vitest";

import { DECK_SECTIONS, type DeckSectionReading } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import { createPostgresDataRoom } from "../src/index.js";

/**
 * Q.08 regression (2026-10-07): the reading was sent as
 * `JSON.stringify(sections)::jsonb`, which postgres.js encodes a second
 * time, so every row was a JSON string and the table's
 * `jsonb_typeof(sections) = 'array'` check rejected all 21 production decks.
 * The sections must travel as a json parameter holding the array itself.
 */
describe("deck extraction insert", () => {
  it("sends the twelve sections as a json array parameter, never a string", async () => {
    const JSON_PARAM = Symbol("json");
    const params: unknown[] = [];
    const sql = Object.assign(
      (_strings: TemplateStringsArray, ...values: unknown[]) => {
        params.push(...values);
        return Promise.resolve([{ id: "x" }]);
      },
      { json: (value: unknown) => ({ [JSON_PARAM]: value }) },
    ) as unknown as DatabaseExecutor;
    const sections: DeckSectionReading[] = DECK_SECTIONS.map((section) => ({
      section,
      status: "NOT_IN_DECK",
      summary: null,
      pages: [],
      facts: [],
      confidence: "LOW",
      criteria: { clear: false, strong: false, exceptional: false, note: null },
    }));
    await createPostgresDataRoom().insertExtraction(sql, {
      tenantId: "t",
      companyId: "c",
      documentId: "d",
      documentVersionId: "v",
      promptVersion: 1,
      schemaVersion: 1,
      pageCount: 7,
      sections,
    });
    expect(
      params.some(
        (value) => typeof value === "string" && value.startsWith("["),
      ),
    ).toBe(false);
    // F26: set_aside is a json parameter too (empty here), before sections.
    const json = params.filter(
      (value): value is Record<symbol, unknown> =>
        typeof value === "object" && value !== null && JSON_PARAM in value,
    );
    expect(json.map((value) => Array.isArray(value[JSON_PARAM]))).toEqual([
      true,
      true,
    ]);
    expect((json[0]?.[JSON_PARAM] as unknown[]).length).toBe(0);
    expect((json[1]?.[JSON_PARAM] as unknown[]).length).toBe(12);
  });
});
