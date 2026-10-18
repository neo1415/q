import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";

import { withoutUnaskedMoves } from "../src/q/unasked-moves.js";

const TENSORGATE = "6b2f9851-d7e3-4197-9fd1-beffbdc153fe";

const map: QResultBlock = {
  kind: "MAP",
  title: "Where Tensorgate is based",
  basis: "From the companies' published profiles",
  places: [
    { label: "Tensorgate", countryCode: "US", subject: null, note: null },
  ],
};
const openProfile: QResultBlock = {
  kind: "UI_INTENT",
  intent: { kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: TENSORGATE },
};
const navigate: QResultBlock = {
  kind: "UI_INTENT",
  intent: { kind: "NAVIGATE", destination: "DISCOVER" },
};
const theme: QResultBlock = {
  kind: "UI_INTENT",
  intent: { kind: "SET_THEME", theme: "dark" },
};

/**
 * Owner 2026-10-15: the model drew a MAP and called open_page in the same
 * turn (hosted runs 19:19 and 19:21: MAP + OPEN_RECORD_PAGE), so the map
 * was replaced by the profile the moment it landed.
 */
describe("an answer that draws never also moves the person unasked", () => {
  it("drops the move beside a map they asked to see", () => {
    expect(
      withoutUnaskedMoves(
        [map, openProfile],
        "show me on a map where my top companies are based",
      ),
    ).toEqual([map]);
    expect(
      withoutUnaskedMoves(
        [map, openProfile, navigate],
        "Now show me the map You showed me before",
      ),
    ).toEqual([map]);
  });

  it("drops a move answering a map request even when no map was drawn", () => {
    expect(
      withoutUnaskedMoves(
        [openProfile],
        "show me a map of where Tensorgate is on the world",
      ),
    ).toEqual([]);
  });

  it("keeps a move their own words asked for, and every non-move act", () => {
    expect(
      withoutUnaskedMoves(
        [map, openProfile],
        "Open Tensorgate and show me a chart of its raise",
      ),
    ).toEqual([map, openProfile]);
    expect(
      withoutUnaskedMoves([map, theme], "show me a map, in dark mode"),
    ).toEqual([map, theme]);
  });

  it("leaves an answer that draws nothing alone", () => {
    expect(withoutUnaskedMoves([openProfile], "Open Tensorgate")).toEqual([
      openProfile,
    ]);
    expect(
      withoutUnaskedMoves([openProfile], "tell me about Tensorgate"),
    ).toEqual([openProfile]);
  });
});
