import { describe, expect, it } from "vitest";

import {
  Q_SITE_MAP,
  QNavigateTargetSchema,
  type QNavigateTarget,
} from "@capital-q/contracts";

import { spokenPlace } from "../src/q/navigation-decision.js";

/**
 * Live re-check of cb28c00e5 (16 Nov 2026, turn C): the move line said
 * "I've opened For you." -- a tab's raw title. Every one of their own
 * screens (a destination code can move to with no record) is said as a
 * place ("your Discover feed"), never as the site map's raw title.
 */
const NO_RECORDS = { companies: [], investors: [], things: [], own: null };

/** Every destination code can open with no record, with its raw title. */
function ownPlaces(): readonly (readonly [string, string])[] {
  const places: (readonly [string, string])[] = [];
  for (const page of Q_SITE_MAP.pages) {
    if (page.audience === "ADMIN") continue;
    for (const destination of page.destinations)
      places.push([destination, page.title]);
    for (const tab of page.tabs)
      for (const destination of tab.destinations)
        places.push([destination, tab.title]);
  }
  return places;
}

describe("live re-check cb28c00e5: a move line names their own screen as a place", () => {
  it("DISCOVER is 'your Discover feed', not 'For you'", () => {
    const target = QNavigateTargetSchema.parse({ page: "DISCOVER" });
    expect(spokenPlace(target, NO_RECORDS as never)).toBe("your Discover feed");
  });

  it("the pipeline is 'your pipeline', not 'Pipeline'", () => {
    const target = QNavigateTargetSchema.parse({ page: "CRM_PIPELINE" });
    expect(spokenPlace(target, NO_RECORDS as never)).toBe("your pipeline");
  });

  it.each(ownPlaces())("%s is never said as its raw title %o", (page, raw) => {
    const parsed = QNavigateTargetSchema.safeParse({ page });
    // A destination the navigate contract does not carry is never moved to.
    if (!parsed.success) return;
    const target: QNavigateTarget = parsed.data;
    const said = spokenPlace(target, NO_RECORDS as never);
    // Titles that already read as a place: the product's own name, and
    // Q's own team ("I've opened Q's team.").
    if (raw === "GateQ" || raw === "Q's team") {
      expect(said).toBe(raw);
      return;
    }
    expect(said).not.toBe(raw);
    // Lower-case mid-sentence ("your …", "the …", "Q's …", "a …", "people
    // search"), so "I've opened …" reads as a sentence.
    expect(said).toMatch(/^(?:your|the|a|people|founders'|Q's|GateQ's)\b/u);
  });
});
