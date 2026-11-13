import { describe, expect, it } from "vitest";

import { CompanyIdSchema, type CompanyIdentity } from "@capital-q/companies";
import {
  CompanyRaiseViewSchema,
  type CompanyDeckView,
  type DeckFact,
  type DeckSection,
} from "@capital-q/contracts";
import type { DisclosureAllowReason } from "@capital-q/permissions";
import {
  ActorContextSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createCompanyRaiseReader,
  deckMoneyFrom,
  deckRaiseStatementOf,
  presentCompanyRaise,
  type CompanyRaiseReaderPorts,
  type DeckRaiseClaimFact,
  type PitchRaiseClaimFact,
  type RaiseObjectiveFact,
  type RaiseSharing,
  type RaiseViewerKind,
} from "../src/index.js";

/**
 * Live 2026-11-13: a comparison left Ajopot's raise blank while the same
 * table's cheque-fit row quoted the deck ("Raising NGN 1,200,000,000, in
 * their deck"). Ajopot's objective is founder-private; its deck, confirmed
 * for investors, states the raise. The one policy now knows the deck.
 */

const OBJECTIVE: RaiseObjectiveFact = {
  id: "55555555-0000-4000-8000-000000000001",
  amount: "987654321",
  currency: "NGN",
  startedAt: "2026-09-01T00:00:00.000Z",
};
const PITCH: PitchRaiseClaimFact = {
  pitchId: "55555555-0000-4000-8000-000000000002",
  atSeconds: 30,
  amount: "1500000",
  currency: "USD",
  visibility: "network_visible",
};
const DECK: DeckRaiseClaimFact = {
  amount: "1200000000",
  currency: "NGN",
  visibility: "network_visible",
};

describe("deckMoneyFrom: the deck's amount, parsed or nothing", () => {
  it.each([
    ["₦1.2bn", "1200000000", "NGN"],
    ["NGN 1,200,000,000", "1200000000", "NGN"],
    ["$1.8M", "1800000", "USD"],
    ["US$ 500k", "500000", "USD"],
    ["USD 2,500,000", "2500000", "USD"],
    ["€2 million", "2000000", "EUR"],
    ["£750k", "750000", "GBP"],
    ["KSh 50m", "50000000", "KES"],
    ["KES 50,000,000", "50000000", "KES"],
    ["R10m", "10000000", "ZAR"],
    ["1.5m USD", "1500000", "USD"],
    ["2 million dollars", "2000000", "USD"],
    ["$500k USD", "500000", "USD"],
    ["NGN 1,200,000,000.50", "1200000000.5", "NGN"],
    ["$4M.", "4000000", "USD"],
  ])("%s -> %s %s", (text, amount, currency) => {
    expect(deckMoneyFrom(text)).toEqual({ amount, currency });
  });

  it.each([
    "1.2bn",
    "TBD",
    "$1-2M",
    "$1M to $2M",
    "$1.8M seed plus $200k grant",
    "1,200,000 naira or $800k",
    "$500k EUR",
    "r10m",
    "R$ 5m",
    "$0",
    "1.200.000 €",
    "",
    null,
    undefined,
  ])("%s -> no claim", (text) => {
    expect(deckMoneyFrom(text)).toBeNull();
  });
});

const VIEWERS: readonly RaiseViewerKind[] = ["OWNER", "INVESTOR", "FOUNDER"];
const SHARINGS: readonly RaiseSharing[] = ["NETWORK", "PRIVATE", "HIDDEN"];
const REASONS: readonly (DisclosureAllowReason | null)[] = [
  null,
  "NETWORK_VISIBLE",
];

describe("presentCompanyRaise: objective > pitch > deck > none", () => {
  for (const viewer of VIEWERS)
    for (const objective of [OBJECTIVE, null])
      for (const disclosedBecause of REASONS)
        for (const sharing of SHARINGS)
          for (const pitchClaim of [PITCH, null])
            for (const deckClaim of [DECK, null])
              it(`${viewer} objective=${objective ? "yes" : "no"} disclosed=${String(disclosedBecause)} ${sharing} pitch=${pitchClaim ? "yes" : "no"} deck=${deckClaim ? "yes" : "no"}`, () => {
                const view = presentCompanyRaise({
                  viewer,
                  objective,
                  disclosedBecause,
                  sharing,
                  pitchClaim,
                  deckClaim,
                });
                expect(CompanyRaiseViewSchema.safeParse(view).success).toBe(
                  true,
                );
                const open = viewer !== "FOUNDER" && sharing !== "HIDDEN";
                const expected =
                  objective !== null &&
                  (viewer === "OWNER" || disclosedBecause !== null)
                    ? "DISCLOSED_OBJECTIVE"
                    : open && pitchClaim !== null
                      ? "PITCH_CLAIM"
                      : open && deckClaim !== null
                        ? "DECK_CLAIM"
                        : "NONE";
                expect(view.source).toBe(expected);
                if (view.source !== "DISCLOSED_OBJECTIVE") {
                  // The founder-private objective never leaks into a claim.
                  expect(JSON.stringify(view)).not.toContain(OBJECTIVE.amount);
                  expect(JSON.stringify(view)).not.toContain(OBJECTIVE.id);
                }
                if (view.source === "DECK_CLAIM") {
                  expect(view.money).toEqual({
                    amount: "1200000000",
                    currency: "NGN",
                  });
                  expect(view.truthClass).toBe("USER_CLAIM");
                  expect(view.evidenceStatus).toBe("SELF_REPORTED");
                  expect(view.pitch).toBeNull();
                  expect(view.asOf).toBeNull();
                  expect(view.visibility).toBe("network_visible");
                }
              });

  it("the contract refuses a deck claim dressed as verified or with a pitch", () => {
    const view = presentCompanyRaise({
      viewer: "INVESTOR",
      objective: OBJECTIVE,
      disclosedBecause: null,
      sharing: "PRIVATE",
      pitchClaim: null,
      deckClaim: DECK,
    });
    expect(view.source).toBe("DECK_CLAIM");
    expect(
      CompanyRaiseViewSchema.safeParse({
        ...view,
        truthClass: "VERIFIED",
        evidenceStatus: "EXTERNALLY_VERIFIED",
      }).success,
    ).toBe(false);
    expect(
      CompanyRaiseViewSchema.safeParse({
        ...view,
        evidenceStatus: "DOCUMENT_SUPPORTED",
      }).success,
    ).toBe(false);
    expect(
      CompanyRaiseViewSchema.safeParse({
        ...view,
        pitch: { pitchId: PITCH.pitchId, atSeconds: 1 },
      }).success,
    ).toBe(false);
    expect(
      CompanyRaiseViewSchema.safeParse({ ...view, money: null }).success,
    ).toBe(false);
  });
});

function amountFact(value: string): DeckFact {
  return {
    label: "Amount",
    value,
    unknownReason: null,
    kind: "FIGURE",
    asOf: null,
    pages: [9],
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "HIGH",
  };
}

function section(
  facts: readonly DeckFact[],
  status: DeckSection["status"] = "PRESENT",
): DeckSection {
  return {
    section: "THE_ASK",
    status,
    summary: "The round.",
    pages: [9],
    facts: [...facts],
    confidence: "HIGH",
  };
}

function deckView(
  over: {
    readonly viewer?: CompanyDeckView["viewer"];
    readonly sections?: readonly DeckSection[];
    readonly downloadable?: boolean;
    readonly noDeck?: boolean;
    readonly noReading?: boolean;
  } = {},
): CompanyDeckView {
  return {
    viewer: over.viewer ?? "INVESTOR",
    companyId: "55555555-0000-4000-8000-000000000009",
    deck:
      over.noDeck === true
        ? null
        : {
            documentId: "55555555-0000-4000-8000-00000000000a",
            title: "Deck",
            versionNumber: 1,
            pageCount: 10,
            uploadedAt: "2026-10-01T00:00:00.000Z",
            downloadable: over.downloadable ?? true,
            scanned: true,
          },
    extraction:
      over.noReading === true
        ? null
        : {
            extractionId: "55555555-0000-4000-8000-00000000000b",
            readAt: "2026-10-01T00:00:00.000Z",
            versionNumber: 1,
            confirmed: true,
            sections: [
              ...(over.sections ?? [
                section([amountFact("NGN 1,200,000,000")]),
              ]),
            ],
            readingNumber: 1,
          },
    coaching: null,
  };
}

describe("deckRaiseStatementOf: the reader's own deck view", () => {
  it("reads the confirmed ask's amount, scoped as the reader holds the deck", () => {
    expect(deckRaiseStatementOf(deckView())).toEqual({
      amountText: "NGN 1,200,000,000",
      visibility: "network_visible",
    });
    expect(
      deckRaiseStatementOf(deckView({ downloadable: false }))?.visibility,
    ).toBe("relationship_shared");
    expect(
      deckRaiseStatementOf(deckView({ viewer: "OWNER" }))?.visibility,
    ).toBe("organisation_private");
  });

  it("no deck, no reading, or an ask not present is no statement", () => {
    expect(deckRaiseStatementOf(null)).toBeNull();
    expect(deckRaiseStatementOf(deckView({ noDeck: true }))).toBeNull();
    expect(deckRaiseStatementOf(deckView({ noReading: true }))).toBeNull();
    expect(
      deckRaiseStatementOf(
        deckView({
          sections: [section([amountFact("NGN 1,200,000,000")], "NOT_IN_DECK")],
        }),
      ),
    ).toBeNull();
  });
});

const TENANT = "66666666-0000-4000-8000-000000000001";
const COMPANY_ORG = "66666666-0000-4000-8000-000000000002";
const INVESTOR_ORG = "66666666-0000-4000-8000-000000000003";
const COMPANY = "66666666-0000-4000-8000-000000000004";

function actorOf(organisationId: string): ActorContext {
  return ActorContextSchema.parse({
    userId: "66666666-0000-4000-8000-000000000010",
    tenantId: TENANT,
    organisationId,
    membershipId: "66666666-0000-4000-8000-000000000011",
    actorType: "HUMAN",
  });
}

function reader(over: Partial<CompanyRaiseReaderPorts> = {}) {
  const calls = { deckReads: 0 };
  const company: CompanyIdentity = {
    id: CompanyIdSchema.parse(COMPANY),
    tenantId: TenantIdSchema.parse(TENANT),
    organisationId: OrganisationIdSchema.parse(COMPANY_ORG),
    canonicalName: "Ajopot",
    companyStatus: "active",
  };
  const ports: CompanyRaiseReaderPorts = {
    findCanonicalCompany: (id) =>
      Promise.resolve(id === COMPANY ? company : null),
    // Founder-private: the evaluator denies every non-owner.
    currentObjective: () => Promise.resolve(OBJECTIVE),
    disclosure: {
      evaluateMany: (requests) =>
        Promise.resolve(
          requests.map((request) => ({
            outcome: "DENY" as const,
            resource: request.resource,
            requestedAccess: request.requestedAccess,
            reasonCode: "NO_MATCHING_SCOPE" as const,
          })),
        ),
    },
    objectivePolicies: () => Promise.resolve([]),
    isInvestor: (actor) =>
      Promise.resolve(actor.organisationId === INVESTOR_ORG),
    pitches: () => Promise.resolve([]),
    pitchRaise: () => Promise.resolve(null),
    deckRaises: (_actor, companyIds) => {
      calls.deckReads += 1;
      return Promise.resolve(
        new Map(
          companyIds.map((id) => [
            id,
            {
              amountText: "NGN 1,200,000,000",
              visibility: "network_visible" as const,
            },
          ]),
        ),
      );
    },
    ...over,
  };
  return { reader: createCompanyRaiseReader(ports), calls };
}

describe("raiseFor with a deck: Ajopot", () => {
  it("an investor sees the deck's raise, never the private objective", async () => {
    const { reader: r } = reader();
    const view = await r.raiseFor(actorOf(INVESTOR_ORG), COMPANY);
    expect(view).toEqual({
      source: "DECK_CLAIM",
      money: { amount: "1200000000", currency: "NGN" },
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      visibility: "network_visible",
      asOf: null,
      pitch: null,
    });
    expect(JSON.stringify(view)).not.toContain(OBJECTIVE.amount);
    expect(
      (await r.raisesFor(actorOf(INVESTOR_ORG), [COMPANY])).get(COMPANY),
    ).toEqual(view);
  });

  it("a pitch that says the raise still wins over the deck", async () => {
    const { reader: r } = reader({
      pitches: () =>
        Promise.resolve([
          { mediaAssetId: PITCH.pitchId, visibility: "network_visible" },
        ]),
      pitchRaise: () =>
        Promise.resolve({ atSeconds: 30, amount: "1500000", currency: "USD" }),
    });
    expect((await r.raiseFor(actorOf(INVESTOR_ORG), COMPANY)).source).toBe(
      "PITCH_CLAIM",
    );
  });

  it("a raise the founder hid is not read from the deck", async () => {
    const { reader: r, calls } = reader({
      objectivePolicies: () =>
        Promise.resolve([
          { scopeType: "relationship_shared", revokedAt: "2026-10-01" },
        ]),
    });
    expect((await r.raiseFor(actorOf(INVESTOR_ORG), COMPANY)).source).toBe(
      "NONE",
    );
    expect(calls.deckReads).toBe(0);
  });

  it("a founder reading another company gets nothing and reads no deck", async () => {
    const { reader: r, calls } = reader();
    const view = await r.raiseFor(
      actorOf("66666666-0000-4000-8000-0000000000ff"),
      COMPANY,
    );
    expect(view.source).toBe("NONE");
    expect(calls.deckReads).toBe(0);
  });

  it("an amount that does not parse, or a failed deck read, is NONE", async () => {
    const unparsed = reader({
      deckRaises: (_actor, ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              {
                amountText: "about a billion",
                visibility: "network_visible" as const,
              },
            ]),
          ),
        ),
    });
    expect(
      (await unparsed.reader.raiseFor(actorOf(INVESTOR_ORG), COMPANY)).source,
    ).toBe("NONE");
    const failed = reader({
      deckRaises: () => Promise.reject(new Error("down")),
    });
    expect(
      (await failed.reader.raiseFor(actorOf(INVESTOR_ORG), COMPANY)).source,
    ).toBe("NONE");
  });

  it("the owner still sees their own objective first", async () => {
    const { reader: r, calls } = reader();
    const view = await r.raiseFor(actorOf(COMPANY_ORG), COMPANY);
    expect(view.source).toBe("DISCLOSED_OBJECTIVE");
    expect(calls.deckReads).toBe(0);
  });
});
