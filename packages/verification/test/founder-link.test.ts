import { describe, expect, it } from "vitest";

import {
  linkDecisionBasis,
  linkFounder,
  matchNames,
  type IdentityCheck,
  type RegistryRecord,
} from "../src/index.js";

/** V1: the linking rule and the name matcher, as tables. */

const registry = (overrides: Partial<RegistryRecord> = {}): RegistryRecord => ({
  legalName: "EXAMPLE ROBOTICS LTD",
  registrationNumber: "01234567",
  jurisdictionCode: "GB",
  status: "ACTIVE",
  incorporatedOn: "2021-03-04",
  officers: [
    { name: "EXAMPLE, Ada Ngozi", role: "DIRECTOR", current: true },
    { name: "SAMPLE, Bo", role: "DIRECTOR", current: false },
    { name: "Mr Cai Placeholder", role: "PSC", current: true },
    { name: "SECRETARY, Dee", role: "SECRETARY", current: true },
  ],
  providerReference: "companies-house:01234567",
  ...overrides,
});

const identity = (overrides: Partial<IdentityCheck> = {}): IdentityCheck => ({
  idVerified: true,
  selfieMatched: true,
  nameOnId: "Ada Example",
  providerReference: "sumsub:5f00",
  ...overrides,
});

const consent = {
  givenAt: "2026-11-20T10:00:00Z",
  textVersion: "biometric-consent-v1",
  explicit: true as const,
};

describe("the name matcher", () => {
  it.each([
    ["Ada Example", "EXAMPLE, Ada Ngozi", "MATCH"],
    ["ADA NGOZI EXAMPLE", "Example, Ada Ngozi", "MATCH"],
    ["Adà Exämple", "Ada Example", "MATCH"],
    ["Dr. Ada Example", "Ada Example", "MATCH"],
    ["Cai Placeholder", "Mr Cai Placeholder", "MATCH"],
    ["Ada Exampel", "Ada Example", "PARTIAL"],
    ["Ada Example", "Ada Sample", "PARTIAL"],
    ["Adaeze Exampel", "Adaeze Example", "PARTIAL"],
    ["Bo Sample", "Ada Example", "NO_MATCH"],
    ["", "Ada Example", "NO_MATCH"],
  ])("%s vs %s: %s", (left, right, expected) => {
    expect(matchNames(left, right)).toBe(expected);
  });
});

describe("the linking rule", () => {
  it.each([
    ["a current director", { identity: identity() }, "FOUNDER_ID_VERIFIED"],
    [
      "a PSC",
      { identity: identity({ nameOnId: "Cai Placeholder" }) },
      "FOUNDER_ID_VERIFIED",
    ],
    [
      "a former director only",
      { identity: identity({ nameOnId: "Bo Sample" }) },
      "REVIEW:FORMER_OFFICER_ONLY",
    ],
    [
      "a secretary is not an officer that links",
      { identity: identity({ nameOnId: "Dee Secretary" }) },
      "REVIEW:NOT_AN_OFFICER",
    ],
    [
      "a name that partly matches",
      { identity: identity({ nameOnId: "Ada Exampel" }) },
      "REVIEW:NAME_PARTLY_MATCHES",
    ],
    [
      "someone not on the register",
      { identity: identity({ nameOnId: "Zed Nobody" }) },
      "REVIEW:NOT_AN_OFFICER",
    ],
    [
      "a dissolved company",
      { registry: registry({ status: "DISSOLVED" }) },
      "REVIEW:REGISTRY_NOT_ACTIVE",
    ],
    [
      "an ID that failed",
      { identity: identity({ idVerified: false }) },
      "REVIEW:ID_NOT_VERIFIED",
    ],
    [
      "a selfie that did not match",
      { identity: identity({ selfieMatched: false }) },
      "REVIEW:SELFIE_NOT_MATCHED",
    ],
    [
      "no name on the ID",
      { identity: identity({ nameOnId: null }) },
      "REVIEW:NO_NAME_ON_ID",
    ],
    ["no register yet", { registry: null }, "NOT_READY:REGISTRY"],
    [
      "an ID check still pending",
      { identity: identity({ selfieMatched: null }) },
      "NOT_READY:IDENTITY",
    ],
    ["no consent", { consent: null }, "NOT_READY:CONSENT"],
  ] as const)("%s", (_label, overrides, expected) => {
    const outcome = linkFounder({
      registry: registry(),
      identity: identity(),
      consent,
      ...overrides,
    });
    const said =
      outcome.kind === "FOUNDER_ID_VERIFIED"
        ? outcome.kind
        : outcome.kind === "REVIEW"
          ? `REVIEW:${outcome.reasons.join(",")}`
          : `NOT_READY:${outcome.missing.join(",")}`;
    expect(said).toBe(expected);
  });

  it("a dissolved company and a stranger give both reasons to the reviewer", () => {
    const outcome = linkFounder({
      registry: registry({ status: "DISSOLVED" }),
      identity: identity({ nameOnId: "Zed Nobody" }),
      consent,
    });
    expect(outcome).toEqual({
      kind: "REVIEW",
      reasons: ["REGISTRY_NOT_ACTIVE", "NOT_AN_OFFICER"],
    });
  });

  it("the decision basis says what was checked, never the ID number or the consent", () => {
    const basis = linkDecisionBasis({
      registry: registry(),
      officer: { name: "EXAMPLE, Ada Ngozi", role: "DIRECTOR" },
      identityProvider: "SUMSUB",
    });
    // The consent is its own record (evidence.verification_consents).
    expect(basis).not.toContain("consent");
    expect(basis).toContain("director on the register");
    expect(basis.length).toBeLessThanOrEqual(1000);
  });
});
