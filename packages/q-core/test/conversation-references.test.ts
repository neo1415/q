import { describe, expect, it } from "vitest";

import {
  labelsOf,
  resolveOptionReference,
  type ShownOption,
} from "../src/index.js";

/**
 * "The last four", "both", "the second one", "same as before", "not that
 * one" are answers, resolved against what the person actually saw
 * (CQ-QX-005 §5). Before this they could only fail.
 */

const SHOWN: readonly ShownOption[] = [
  { key: "technical", label: "Technical founding capability" },
  { key: "repeat", label: "Repeat founders" },
  { key: "domain", label: "Deep domain expertise" },
  { key: "sales", label: "Enterprise sales experience" },
  { key: "grit", label: "Resilience under pressure" },
  { key: "network", label: "Investor network" },
];

describe("a pointed-at choice resolves against the shown options", () => {
  it("takes the last four", () => {
    const out = resolveOptionReference(
      { target: "I5.founder_preferences", select: "LAST", count: 4 },
      SHOWN,
      null,
    );
    expect(out).toEqual({
      kind: "KEYS",
      keys: ["domain", "sales", "grit", "network"],
    });
  });

  it("takes the second one, and both of two named positions", () => {
    expect(
      resolveOptionReference(
        { target: "t", select: "ORDINAL", ordinals: [2] },
        SHOWN,
        null,
      ),
    ).toEqual({ kind: "KEYS", keys: ["repeat"] });
    expect(
      resolveOptionReference(
        { target: "t", select: "ORDINAL", ordinals: [1, 3, 3] },
        SHOWN,
        null,
      ),
    ).toEqual({ kind: "KEYS", keys: ["technical", "domain"] });
  });

  it("takes all of them for 'both' on a two-option set", () => {
    const two = SHOWN.slice(0, 2);
    expect(
      resolveOptionReference({ target: "t", select: "ALL" }, two, null),
    ).toEqual({ kind: "KEYS", keys: ["technical", "repeat"] });
  });

  it("repeats the previous selection for 'same as before', and says so when there is none", () => {
    expect(
      resolveOptionReference({ target: "t", select: "SAME_AS_BEFORE" }, SHOWN, [
        "grit",
      ]),
    ).toEqual({ kind: "KEYS", keys: ["grit"] });
    expect(
      resolveOptionReference(
        { target: "t", select: "SAME_AS_BEFORE" },
        SHOWN,
        null,
      ),
    ).toEqual({ kind: "UNRESOLVED", because: "NO_PREVIOUS_SELECTION" });
  });

  it("narrows a previous selection with 'not that one', or everything else on a fresh set", () => {
    expect(
      resolveOptionReference(
        { target: "t", select: "EXCLUDE", ordinals: [2] },
        SHOWN,
        ["technical", "repeat", "domain"],
      ),
    ).toEqual({ kind: "KEYS", keys: ["technical", "domain"] });
    expect(
      resolveOptionReference(
        { target: "t", select: "EXCLUDE", ordinals: [1, 2, 3, 4, 5] },
        SHOWN,
        null,
      ),
    ).toEqual({ kind: "KEYS", keys: ["network"] });
  });

  it("refuses a position that was never on screen rather than guessing", () => {
    expect(
      resolveOptionReference(
        { target: "t", select: "LAST", count: 9 },
        SHOWN,
        null,
      ),
    ).toEqual({ kind: "UNRESOLVED", because: "OUT_OF_RANGE" });
    expect(
      resolveOptionReference({ target: "t", select: "ALL" }, [], null),
    ).toEqual({ kind: "UNRESOLVED", because: "NO_OPTION_SET" });
  });

  it("names what was chosen in the options' own labels", () => {
    expect(labelsOf(["grit", "missing", "sales"], SHOWN)).toEqual([
      "Resilience under pressure",
      "Enterprise sales experience",
    ]);
  });
});
