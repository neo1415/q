import { describe, expect, it } from "vitest";

import { asksToGo, pageRequestOf } from "../src/page-request.js";
import { namedRecordRequestOf } from "../src/named-record-request.js";

/**
 * Owner 2026-10-15: "I asked for a map, it showed the map ... but
 * immediately switched to the profile of that company." Hosted, "show me a
 * map of where Tensorgate is" was answered "Opening Tensorgate…" by code.
 * A drawing asked for is never a page or a record to open.
 */
describe("a map, chart or timeline asked for is not a move", () => {
  const drawings = [
    "show me on a map where my top companies are based",
    "So , tell me about Show me Wait, show me a map of where Tensorgate is on the on the world",
    "Show me a map of where Tensorgate is",
    "show me Tensorgate on a map",
    "Can you show me a chart of my pipeline by stage?",
    "pull up a timeline of Tensorgate's raise",
    "Now show me the map You showed me before",
    "open a world map of my portfolio",
  ];

  it.each(drawings)("%s: no page, no record, no move", (text) => {
    expect(pageRequestOf(text)).toBeNull();
    expect(namedRecordRequestOf(text)).toBeNull();
    expect(asksToGo(text)).toBe(false);
  });

  it("still opens pages and records asked for by name", () => {
    expect(pageRequestOf("open discover")?.kind).toBe("PAGE");
    expect(pageRequestOf("take me to the explore page")?.kind).toBe("PAGE");
    expect(namedRecordRequestOf("Open Tensorgate")?.name).toBe("Tensorgate");
    expect(namedRecordRequestOf("show me Tensorgate's data room")).toEqual({
      name: "Tensorgate",
      facet: "DATA_ROOM",
      explicit: true,
    });
    expect(asksToGo("take me to Tensorgate")).toBe(true);
  });
});
