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

  // Production 2026-10-25 (run 3d8c2636): "Who is the founder of
  // Paystack?" -- the skim named the company with the role asked for; the
  // person wanted is not named, so the full reading takes it.
  it("an organisation with a role asked of it is not a lookup of the organisation", () => {
    expect(
      fastLaneOf(
        {
          kind: "PERSON_SEARCH",
          confidence: "HIGH",
          count: null,
          discover: null,
          person: {
            ...PERSON,
            name: "Paystack",
            kind: "ORGANIZATION",
            city: null,
            country: null,
            role: "founder",
          },
        },
        "Who is the founder of Paystack?",
      ),
    ).toBeNull();
    // A named person with their role is still a lookup of that person.
    expect(
      fastLaneOf(
        {
          kind: "PERSON_SEARCH",
          confidence: "HIGH",
          count: null,
          discover: null,
          person: { ...PERSON, role: "finance director" },
        },
        "find Shadi Qishta, finance director in Doha",
      )?.questionKind,
    ).toBe("PERSON_SEARCH");
  });
});
