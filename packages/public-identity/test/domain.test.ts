import { describe, expect, it } from "vitest";

import {
  createSubjectDirectory,
  DEFAULT_FIELD_SCOPES,
  fitFieldScopes,
  holdUntil,
  newPublicCode,
  normaliseHandle,
  projectCardFields,
  readStoredScopes,
  renamedAwayStatus,
} from "../src/index.js";

/**
 * Handle rules and the card's allowlist (BIZ-004), pure.
 */

describe("handles", () => {
  it("forgives case, space and a leading @, and nothing else", () => {
    expect(normaliseHandle("  @Kivu-Freight ")).toEqual({
      ok: true,
      handle: "kivu-freight",
    });
    for (const bad of [
      "ab",
      "-kivu",
      "kivu-",
      "kivu--freight",
      "kivu freight",
      "kivu_freight",
      "kivü",
      "x".repeat(31),
      "",
    ]) {
      expect(normaliseHandle(bad)).toEqual({ ok: false, reason: "SHAPE" });
    }
  });

  it("holds a renamed-away handle for 90 days, and retires a verified organisation's", () => {
    const at = new Date("2026-09-26T10:00:00.000Z");
    expect(holdUntil(at).toISOString()).toBe("2026-12-25T10:00:00.000Z");
    expect(renamedAwayStatus(false)).toBe("HELD");
    expect(renamedAwayStatus(true)).toBe("RETIRED");
  });

  it("makes opaque 10-character codes from the random source", () => {
    const code = newPublicCode((size) => new Uint8Array(size).fill(7));
    expect(code).toMatch(/^[a-z0-9]{10}$/);
    expect(newPublicCode((size) => new Uint8Array(size).fill(8))).not.toBe(
      code,
    );
  });
});

const FACTS = {
  canonicalName: "Kivu Freight",
  shortDescription: "Cross-border freight booking.",
  websiteUrl: "https://kivu.example",
  currentStageCode: "seed",
  headquartersCity: null,
  headquartersCountry: "KE",
  foundedDate: "2023-04-01",
  // A founder-private figure a sloppy directory might pass through: it has
  // no card key, so it can never be projected.
  runwayMonths: "FOUNDER-PRIVATE-RUNWAY-DO-NOT-EMIT",
  primaryDescription: "ORGANISATION-PRIVATE-DESCRIPTION-DO-NOT-EMIT",
};

describe("the card projection", () => {
  it("shows the public only public_external fields, and never anything off the allowlist", () => {
    const fields = projectCardFields(
      "COMPANY",
      DEFAULT_FIELD_SCOPES.COMPANY,
      FACTS,
      "PUBLIC",
    );
    expect(fields.map((field) => field.key)).toEqual([
      "shortDescription",
      "websiteUrl",
    ]);
    expect(fields.every((field) => field.scope === "public_external")).toBe(
      true,
    );
    const text = JSON.stringify(fields);
    expect(text).not.toContain("FOUNDER-PRIVATE");
    expect(text).not.toContain("ORGANISATION-PRIVATE");
    expect(text).not.toContain("seed");
  });

  it("adds network_visible fields for a signed-in participant, public first, and leaves unknowns out", () => {
    const fields = projectCardFields(
      "COMPANY",
      DEFAULT_FIELD_SCOPES.COMPANY,
      FACTS,
      "PARTICIPANT",
    );
    expect(fields.map((field) => `${field.key}:${field.scope}`)).toEqual([
      "shortDescription:public_external",
      "websiteUrl:public_external",
      "currentStageCode:network_visible",
      "headquartersCountry:network_visible",
      "foundedDate:network_visible",
    ]);
    // City is not stated: absent, not blank.
    expect(fields.some((field) => field.key === "headquartersCity")).toBe(
      false,
    );
    expect(JSON.stringify(fields)).not.toContain("DO-NOT-EMIT");
  });

  it("refuses a field that is not on this subject type's card, and keeps the name public", () => {
    expect(
      fitFieldScopes("COMPANY", { publicDescription: "public_external" }),
    ).toEqual({ ok: false, fields: ["publicDescription"] });
    expect(
      fitFieldScopes("INVESTOR_ORGANISATION", {
        displayName: "network_visible",
        hqCountry: "public_external",
      }),
    ).toEqual({
      ok: true,
      scopes: { displayName: "public_external", hqCountry: "public_external" },
    });
  });

  it("reads stored scopes defensively: unknown keys and scopes are dropped", () => {
    expect(
      readStoredScopes("COMPANY", {
        canonicalName: "network_visible",
        websiteUrl: "public_external",
        runwayMonths: "public_external",
      }),
    ).toEqual({ canonicalName: "public_external" });
    expect(
      readStoredScopes("COMPANY", {
        websiteUrl: "public_external",
        foundedDate: "network_visible",
      }),
    ).toEqual({
      websiteUrl: "public_external",
      foundedDate: "network_visible",
      canonicalName: "public_external",
    });
    expect(readStoredScopes("COMPANY", "garbage")).toEqual({
      canonicalName: "public_external",
    });
  });
});

describe("the subject directory", () => {
  it("copies only card fields from the canonical read, so nothing else can be projected", async () => {
    // What a canonical row also holds, which the directory must drop.
    const canonical = {
      tenantId: "t",
      organisationId: "o",
      canonicalName: "Kivu Freight",
      shortDescription: "Freight.",
      currentStageCode: "seed",
      headquartersCity: null,
      headquartersCountry: "KE",
      websiteUrl: null,
      foundedDate: null,
      primaryDescription: "ORGANISATION-PRIVATE-DO-NOT-COPY",
    };
    const directory = createSubjectDirectory({
      findCompany: () => Promise.resolve(canonical),
      findInvestor: () => Promise.resolve(null),
      companyVerification: () =>
        Promise.reject(new Error("verification unavailable")),
    });
    const facts = await directory.find({
      subjectType: "COMPANY",
      subjectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(JSON.stringify(facts)).not.toContain("DO-NOT-COPY");
    // Verification that cannot be read is not verified.
    expect(facts?.verified).toEqual({
      organisation: false,
      founderIdentity: false,
    });
    expect(
      await directory.find({
        subjectType: "INVESTOR_ORGANISATION",
        subjectId: "00000000-0000-4000-8000-000000000002",
      }),
    ).toBeNull();
  });
});
