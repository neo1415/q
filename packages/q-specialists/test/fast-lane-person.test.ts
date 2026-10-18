import { describe, expect, it } from "vitest";

import { fastLaneOf } from "../src/fast-lane.js";

describe("fastLaneOf (W2 person search)", () => {
  const PERSON = {
    name: "Shadi Qishta",
    kind: "PERSON" as const,
    city: "Doha",
    country: "Qatar",
    organization: null,
    role: null,
    freshSearch: false,
  };

  it("carries only what the person said into a read-only person search", () => {
    expect(
      fastLaneOf(
        {
          kind: "PERSON_SEARCH",
          confidence: "HIGH",
          count: null,
          discover: null,
          person: PERSON,
        },
        "find Shadi Qishta, Doha, Qatar",
      ),
    ).toEqual({
      questionKind: "PERSON_SEARCH",
      personSearch: {
        name: "Shadi Qishta",
        entityKind: "PERSON",
        city: "Doha",
        country: "Qatar",
        organization: null,
        role: null,
        freshSearch: false,
      },
    });
  });

  it("waits for the full reading when not sure or when no person was named", () => {
    expect(
      fastLaneOf(
        {
          kind: "PERSON_SEARCH",
          confidence: "MEDIUM",
          count: null,
          discover: null,
          person: PERSON,
        },
        "find Shadi",
      ),
    ).toBeNull();
    expect(
      fastLaneOf(
        {
          kind: "PERSON_SEARCH",
          confidence: "HIGH",
          count: null,
          discover: null,
          person: null,
        },
        "find someone",
      ),
    ).toBeNull();
  });
});
