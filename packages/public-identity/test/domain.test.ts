import { describe, expect, it } from "vitest";

import type { CardDetail } from "@capital-q/contracts";

import {
  companyCardSharesRaise,
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
      scopes: {
        displayName: "public_external",
        photo: "public_external",
        hqCountry: "public_external",
      },
    });
  });

  it("gives the photo the name's scope, whatever was asked (founder decision 2026-10-04)", () => {
    expect(
      fitFieldScopes("COMPANY", {
        photo: "network_visible",
        cover: "network_visible",
      }),
    ).toEqual({
      ok: true,
      scopes: {
        canonicalName: "public_external",
        photo: "public_external",
        cover: "network_visible",
      },
    });
    expect(readStoredScopes("INVESTOR_ORGANISATION", {})).toEqual({
      displayName: "public_external",
      photo: "public_external",
    });
  });

  it("reads stored scopes defensively: unknown keys and scopes are dropped", () => {
    expect(
      readStoredScopes("COMPANY", {
        canonicalName: "network_visible",
        websiteUrl: "public_external",
        runwayMonths: "public_external",
      }),
    ).toEqual({ canonicalName: "public_external", photo: "public_external" });
    expect(
      readStoredScopes("COMPANY", {
        websiteUrl: "public_external",
        foundedDate: "network_visible",
      }),
    ).toEqual({
      websiteUrl: "public_external",
      foundedDate: "network_visible",
      canonicalName: "public_external",
      photo: "public_external",
    });
    expect(readStoredScopes("COMPANY", "garbage")).toEqual({
      canonicalName: "public_external",
      photo: "public_external",
    });
  });
});

describe("the company's longer description on its card (owner 2026-11-19)", () => {
  const story = { ...FACTS, primaryDescription: "MEMBERS-ONLY-STORY" };

  it("is off on a new card: no audience sees it until the owner adds it", () => {
    for (const audience of ["PUBLIC", "PARTICIPANT"] as const) {
      const fields = projectCardFields(
        "COMPANY",
        DEFAULT_FIELD_SCOPES.COMPANY,
        story,
        audience,
      );
      expect(JSON.stringify(fields)).not.toContain("MEMBERS-ONLY-STORY");
    }
  });

  it("kept to members, reaches a signed-in participant and never the public link", () => {
    const scopes = {
      ...DEFAULT_FIELD_SCOPES.COMPANY,
      primaryDescription: "network_visible",
    } as const;
    const anonymous = projectCardFields("COMPANY", scopes, story, "PUBLIC");
    expect(JSON.stringify(anonymous)).not.toContain("MEMBERS-ONLY-STORY");
    expect(anonymous.some((f) => f.key === "primaryDescription")).toBe(false);
    const member = projectCardFields("COMPANY", scopes, story, "PARTICIPANT");
    expect(member.find((f) => f.key === "primaryDescription")).toEqual({
      key: "primaryDescription",
      value: "MEMBERS-ONLY-STORY",
      scope: "network_visible",
    });
  });

  it("made public by the owner, reaches anyone; unstated, reaches no one", () => {
    const scopes = {
      ...DEFAULT_FIELD_SCOPES.COMPANY,
      primaryDescription: "public_external",
    } as const;
    expect(
      fitFieldScopes("COMPANY", { primaryDescription: "public_external" }).ok,
    ).toBe(true);
    expect(
      projectCardFields("COMPANY", scopes, story, "PUBLIC").find(
        (f) => f.key === "primaryDescription",
      )?.scope,
    ).toBe("public_external");
    expect(
      projectCardFields(
        "COMPANY",
        scopes,
        { ...story, primaryDescription: "   " },
        "PUBLIC",
      ).some((f) => f.key === "primaryDescription"),
    ).toBe(false);
  });

  it("is not an investor's or a person's field", () => {
    expect(
      fitFieldScopes("INVESTOR_ORGANISATION", {
        primaryDescription: "network_visible",
      }),
    ).toEqual({ ok: false, fields: ["primaryDescription"] });
    expect(
      fitFieldScopes("PERSON", { primaryDescription: "network_visible" }),
    ).toEqual({ ok: false, fields: ["primaryDescription"] });
  });
});

describe("an investor card's wider declared fields (owner 2026-11-19)", () => {
  const NEW_FIELDS = [
    "mandateChequeRange",
    "mandateInvestmentRole",
    "inboundPreference",
    "portfolioHighlights",
  ] as const;
  const INVESTOR_FACTS = {
    displayName: "Savanna Capital",
    investorType: "VC",
    publicDescription: "Seed funds for East African logistics.",
    mandateChequeRange: "SECRET-RANGE USD 250,000 to 2,000,000",
    mandateInvestmentRole: "SECRET-ROLE Lead rounds",
    inboundPreference: "QUALIFIED",
    portfolioHighlights: "SECRET-PORTFOLIO Kivu Freight; Lake Cold Chain",
  };
  const RANGE: CardDetail = {
    kind: "METRICS",
    metrics: [
      {
        label: "Smallest cheque",
        amount: "250000",
        currency: "USD",
        unit: null,
        period: null,
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
      {
        label: "Largest cheque",
        amount: "2000000",
        currency: "USD",
        unit: null,
        period: null,
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
    ],
  };
  const DETAILS = {
    mandateChequeRange: { public_external: RANGE, network_visible: RANGE },
  };
  const project = (
    scopes: Parameters<typeof projectCardFields>[1],
    audience: "PUBLIC" | "PARTICIPANT",
  ) =>
    projectCardFields(
      "INVESTOR_ORGANISATION",
      scopes,
      INVESTOR_FACTS,
      audience,
      DETAILS,
    );

  it("is off on a new card: no audience sees any of them until the owner adds it", () => {
    for (const key of NEW_FIELDS) {
      expect(DEFAULT_FIELD_SCOPES.INVESTOR_ORGANISATION[key]).toBeUndefined();
    }
    for (const audience of ["PUBLIC", "PARTICIPANT"] as const) {
      const fields = project(
        DEFAULT_FIELD_SCOPES.INVESTOR_ORGANISATION,
        audience,
      );
      expect(JSON.stringify(fields)).not.toMatch(/SECRET-|QUALIFIED|250000/);
    }
    // A stored card from before these fields existed reads the same.
    const stored = readStoredScopes("INVESTOR_ORGANISATION", {
      displayName: "public_external",
    });
    for (const key of NEW_FIELDS) expect(stored[key]).toBeUndefined();
  });

  it("follows the scope the owner chose: off, members only or public, per audience", () => {
    const matrix: Record<string, Record<"PUBLIC" | "PARTICIPANT", boolean>> = {
      off: { PUBLIC: false, PARTICIPANT: false },
      network_visible: { PUBLIC: false, PARTICIPANT: true },
      public_external: { PUBLIC: true, PARTICIPANT: true },
    };
    for (const key of NEW_FIELDS) {
      for (const [scope, expected] of Object.entries(matrix)) {
        const requested = scope === "off" ? {} : { [key]: scope };
        const fit = fitFieldScopes("INVESTOR_ORGANISATION", requested);
        expect(fit.ok).toBe(true);
        if (!fit.ok) continue;
        for (const audience of ["PUBLIC", "PARTICIPANT"] as const) {
          const field = project(fit.scopes, audience).find(
            (candidate) => candidate.key === key,
          );
          expect(field !== undefined, `${key} ${scope} ${audience}`).toBe(
            expected[audience],
          );
          if (field !== undefined) expect(field.scope).toBe(scope);
        }
      }
    }
  });

  it("carries the cheque range's exact ends only beside its own field and scope", () => {
    const members = project(
      { mandateChequeRange: "network_visible" },
      "PARTICIPANT",
    ).find((field) => field.key === "mandateChequeRange");
    expect(members?.detail).toEqual(RANGE);
    // Without a detail built for it, the range is not shown at all.
    expect(
      projectCardFields(
        "INVESTOR_ORGANISATION",
        { mandateChequeRange: "public_external" },
        INVESTOR_FACTS,
        "PUBLIC",
        { mandateChequeRange: { network_visible: RANGE } },
      ).some((field) => field.key === "mandateChequeRange"),
    ).toBe(false);
  });

  it("is refused on a company's or a person's card", () => {
    for (const key of NEW_FIELDS) {
      for (const subjectType of ["COMPANY", "PERSON"] as const) {
        expect(
          fitFieldScopes(subjectType, { [key]: "network_visible" }),
        ).toEqual({ ok: false, fields: [key] });
        // And dropped if somehow stored there.
        expect(
          readStoredScopes(subjectType, { [key]: "public_external" })[key],
        ).toBeUndefined();
      }
    }
  });

  it("the directory copies the firm's own declared facts, the range only with its exact ends", async () => {
    const directory = createSubjectDirectory({
      findCompany: () => Promise.resolve(null),
      findInvestor: () =>
        Promise.resolve({
          tenantId: "00000000-0000-4000-8000-0000000000a1",
          organisationId: "00000000-0000-4000-8000-0000000000a2",
          displayName: "Savanna Capital",
          investorType: "VC",
          publicDescription: null,
          hqCountry: "KE",
          websiteUrl: null,
          deploymentState: null,
          verificationState: "unverified",
          inboundPreference: "OPEN",
        }),
      findInvestorMandateFacts: () =>
        Promise.resolve({
          mandateInvestmentRole: "Lead rounds",
          mandateChequeRange: "USD 250,000 to 2,000,000",
          chequeRange: { currency: "USD", min: "250000", max: "2000000" },
        }),
      findInvestorPortfolio: () =>
        Promise.resolve([" Kivu Freight ", "Lake; Cold Chain", "Kivu Freight"]),
      companyVerification: () =>
        Promise.resolve({ organisation: false, founderIdentity: false }),
    });
    const read = await directory.find({
      subjectType: "INVESTOR_ORGANISATION",
      subjectId: "00000000-0000-4000-8000-0000000000a3",
    });
    expect(read?.facts).toMatchObject({
      mandateInvestmentRole: "Lead rounds",
      mandateChequeRange: "USD 250,000 to 2,000,000",
      inboundPreference: "OPEN",
      // Names only, deduplicated; a ";" can never split one name in two.
      portfolioHighlights: "Kivu Freight; Lake, Cold Chain",
    });
    expect(read?.details?.["mandateChequeRange"]?.public_external).toEqual(
      RANGE,
    );

    // A text with no exact ends behind it, a failed portfolio read and no
    // stated rule: each unknown, never a guess.
    const sparse = createSubjectDirectory({
      findCompany: () => Promise.resolve(null),
      findInvestor: () =>
        Promise.resolve({
          tenantId: "00000000-0000-4000-8000-0000000000a1",
          organisationId: "00000000-0000-4000-8000-0000000000a2",
          displayName: "Savanna Capital",
          investorType: "VC",
          publicDescription: null,
          hqCountry: null,
          websiteUrl: null,
          deploymentState: null,
          verificationState: "unverified",
        }),
      findInvestorMandateFacts: () =>
        Promise.resolve({ mandateChequeRange: "USD 250,000 to 2,000,000" }),
      findInvestorPortfolio: () => Promise.reject(new Error("down")),
      companyVerification: () =>
        Promise.resolve({ organisation: false, founderIdentity: false }),
    });
    const thin = await sparse.find({
      subjectType: "INVESTOR_ORGANISATION",
      subjectId: "00000000-0000-4000-8000-0000000000a3",
    });
    expect(thin?.facts["mandateChequeRange"]).toBeNull();
    expect(thin?.facts["portfolioHighlights"]).toBeNull();
    expect(thin?.facts["inboundPreference"]).toBeNull();
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
      primaryDescription: "The longer story.",
      // Not a card field: whatever the read carries, it never travels.
      legalName: "ORGANISATION-PRIVATE-DO-NOT-COPY",
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
    // The longer description is a card field: copied, then shown only
    // through a scope the owner chose (below).
    expect(facts?.facts["primaryDescription"]).toBe("The longer story.");
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

describe("companyCardSharesRaise (owner 23 Oct 2026)", () => {
  it("an ACTIVE card with a currentRaise scope shares it with signed-in investors", () => {
    expect(
      companyCardSharesRaise({
        status: "ACTIVE",
        fieldScopes: { currentRaise: "public_external" },
      }),
    ).toBe(true);
    expect(
      companyCardSharesRaise({
        status: "ACTIVE",
        fieldScopes: { currentRaise: "network_visible" },
      }),
    ).toBe(true);
  });

  it("no scope, a revoked card, a malformed record or no card shares nothing", () => {
    expect(
      companyCardSharesRaise({
        status: "ACTIVE",
        fieldScopes: { canonicalName: "public_external" },
      }),
    ).toBe(false);
    expect(
      companyCardSharesRaise({
        status: "REVOKED",
        fieldScopes: { currentRaise: "public_external" },
      }),
    ).toBe(false);
    expect(
      companyCardSharesRaise({
        status: "ACTIVE",
        fieldScopes: { currentRaise: "founder_private" },
      }),
    ).toBe(false);
    expect(companyCardSharesRaise(null)).toBe(false);
  });
});
