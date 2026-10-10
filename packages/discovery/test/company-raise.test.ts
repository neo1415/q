import { describe, expect, it } from "vitest";

import { CompanyIdSchema, type CompanyIdentity } from "@capital-q/companies";
import { CompanyRaiseViewSchema } from "@capital-q/contracts";
import type { DisclosureAllowReason } from "@capital-q/permissions";
import {
  ActorContextSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createCompanyRaiseReader,
  presentCompanyRaise,
  sharingFromPolicies,
  type CompanyRaiseReaderPorts,
  type PitchRaiseClaimFact,
  type RaiseObjectiveFact,
  type RaiseSharing,
  type RaiseViewerKind,
} from "../src/index.js";

const OBJECTIVE: RaiseObjectiveFact = {
  id: "22222222-0000-4000-8000-000000000001",
  amount: "2000000",
  currency: "USD",
  startedAt: "2026-09-01T00:00:00.000Z",
};
const CLAIM: PitchRaiseClaimFact = {
  pitchId: "22222222-0000-4000-8000-000000000002",
  atSeconds: 14,
  amount: "1500000",
  currency: "USD",
  visibility: "network_visible",
};

const VIEWERS: readonly RaiseViewerKind[] = ["OWNER", "INVESTOR", "FOUNDER"];
const SHARINGS: readonly RaiseSharing[] = ["NETWORK", "PRIVATE", "HIDDEN"];
const REASONS: readonly (DisclosureAllowReason | null)[] = [
  null,
  "RELATIONSHIP_PARTY",
  "NETWORK_VISIBLE",
];

describe("presentCompanyRaise: the policy matrix", () => {
  // Every combination is a valid wire value, and the axes follow the source.
  for (const viewer of VIEWERS)
    for (const objective of [OBJECTIVE, null])
      for (const disclosedBecause of REASONS)
        for (const sharing of SHARINGS)
          for (const pitchClaim of [CLAIM, null])
            it(`${viewer} objective=${objective ? "yes" : "no"} disclosed=${String(disclosedBecause)} ${sharing} pitch=${pitchClaim ? "yes" : "no"}`, () => {
              const view = presentCompanyRaise({
                viewer,
                objective,
                disclosedBecause,
                sharing,
                pitchClaim,
              });
              expect(CompanyRaiseViewSchema.safeParse(view).success).toBe(true);
              const expected =
                objective !== null &&
                (viewer === "OWNER" || disclosedBecause !== null)
                  ? "DISCLOSED_OBJECTIVE"
                  : viewer !== "FOUNDER" &&
                      sharing !== "HIDDEN" &&
                      pitchClaim !== null
                    ? "PITCH_CLAIM"
                    : "NONE";
              expect(view.source).toBe(expected);
              if (view.source === "DISCLOSED_OBJECTIVE") {
                expect(view.money).toEqual({
                  amount: "2000000",
                  currency: "USD",
                });
                expect(view.asOf).toBe(OBJECTIVE.startedAt);
              }
              if (view.source === "PITCH_CLAIM") {
                // Never the private objective's figure, never verified.
                expect(view.money).toEqual({
                  amount: "1500000",
                  currency: "USD",
                });
                expect(view.truthClass).toBe("USER_CLAIM");
                expect(view.evidenceStatus).toBe("SELF_REPORTED");
                expect(view.pitch).toEqual({
                  pitchId: CLAIM.pitchId,
                  atSeconds: 14,
                });
              }
              if (view.source === "NONE") {
                expect(view.money).toBeNull();
                expect(view.truthClass).toBe("UNKNOWN");
              }
            });

  it("names the scope the reader holds the objective under", () => {
    const at = (reason: DisclosureAllowReason) =>
      presentCompanyRaise({
        viewer: "INVESTOR",
        objective: OBJECTIVE,
        disclosedBecause: reason,
        sharing: "PRIVATE",
        pitchClaim: null,
      }).visibility;
    expect(at("NETWORK_VISIBLE")).toBe("network_visible");
    expect(at("RELATIONSHIP_PARTY")).toBe("relationship_shared");
    expect(at("EXPLICIT_RECIPIENT")).toBe("specifically_shared");
  });

  it("a founder-private objective never reaches an investor, even when the pitch disagrees", () => {
    const view = presentCompanyRaise({
      viewer: "INVESTOR",
      objective: OBJECTIVE,
      disclosedBecause: null,
      sharing: "PRIVATE",
      pitchClaim: CLAIM,
    });
    expect(view.source).toBe("PITCH_CLAIM");
    expect(JSON.stringify(view)).not.toContain(OBJECTIVE.amount);
    expect(JSON.stringify(view)).not.toContain(OBJECTIVE.id);
  });

  it("the contract refuses a pitch claim dressed as verified", () => {
    const view = presentCompanyRaise({
      viewer: "INVESTOR",
      objective: null,
      disclosedBecause: null,
      sharing: "PRIVATE",
      pitchClaim: CLAIM,
    });
    expect(
      CompanyRaiseViewSchema.safeParse({
        ...view,
        truthClass: "VERIFIED",
        evidenceStatus: "PLATFORM_VERIFIED",
      }).success,
    ).toBe(false);
  });
});

describe("sharingFromPolicies", () => {
  it("reads the founder's choice from the policy history", () => {
    expect(sharingFromPolicies([])).toBe("PRIVATE");
    expect(
      sharingFromPolicies([{ scopeType: "network_visible", revokedAt: null }]),
    ).toBe("NETWORK");
    expect(
      sharingFromPolicies([
        { scopeType: "relationship_shared", revokedAt: "2026-10-01" },
      ]),
    ).toBe("HIDDEN");
    expect(
      sharingFromPolicies([
        { scopeType: "relationship_shared", revokedAt: null },
      ]),
    ).toBe("PRIVATE");
  });
});

const TENANT = "33333333-0000-4000-8000-000000000001";
const COMPANY_ORG = "33333333-0000-4000-8000-000000000002";
const INVESTOR_ORG = "33333333-0000-4000-8000-000000000003";
const COMPANY = "33333333-0000-4000-8000-000000000004";

function actorOf(organisationId: string): ActorContext {
  return ActorContextSchema.parse({
    userId: "33333333-0000-4000-8000-000000000010",
    tenantId: TENANT,
    organisationId,
    membershipId: "33333333-0000-4000-8000-000000000011",
    actorType: "HUMAN",
  });
}

function reader(over: Partial<CompanyRaiseReaderPorts> = {}) {
  const calls = { pitchReads: 0, policyReads: 0 };
  const company: CompanyIdentity = {
    id: CompanyIdSchema.parse(COMPANY),
    tenantId: TenantIdSchema.parse(TENANT),
    organisationId: OrganisationIdSchema.parse(COMPANY_ORG),
    canonicalName: "Example",
    companyStatus: "active",
  };
  const ports: CompanyRaiseReaderPorts = {
    findCanonicalCompany: (id) =>
      Promise.resolve(id === COMPANY ? company : null),
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
    } as CompanyRaiseReaderPorts["disclosure"],
    objectivePolicies: () => {
      calls.policyReads += 1;
      return Promise.resolve([]);
    },
    isInvestor: (actor) =>
      Promise.resolve(actor.organisationId === INVESTOR_ORG),
    playablePitches: () =>
      Promise.resolve([
        {
          mediaAssetId: "44444444-0000-4000-8000-000000000001",
          visibility: "network_visible",
        },
        { mediaAssetId: CLAIM.pitchId, visibility: "network_visible" },
      ]),
    pitchRaise: (_actor, _company, mediaAssetId) => {
      calls.pitchReads += 1;
      return Promise.resolve(
        mediaAssetId === CLAIM.pitchId
          ? { atSeconds: 14, amount: "1500000", currency: "USD" }
          : null,
      );
    },
    ...over,
  };
  return { reader: createCompanyRaiseReader(ports), calls };
}

describe("createCompanyRaiseReader", () => {
  it("raiseFor and raisesFor give the same answer (one read model)", async () => {
    const { reader: r } = reader();
    const investor = actorOf(INVESTOR_ORG);
    const one = await r.raiseFor(investor, COMPANY);
    const many = await r.raisesFor(investor, [COMPANY]);
    expect(many.get(COMPANY)).toEqual(one);
    expect(one.source).toBe("PITCH_CLAIM");
    expect(one.pitch?.pitchId).toBe(CLAIM.pitchId);
  });

  it("the owner sees their own objective without a pitch read", async () => {
    const { reader: r, calls } = reader();
    const view = await r.raiseFor(actorOf(COMPANY_ORG), COMPANY);
    expect(view.source).toBe("DISCLOSED_OBJECTIVE");
    expect(view.visibility).toBe("founder_private");
    expect(calls.pitchReads).toBe(0);
  });

  it("a hidden raise is not read from the pitch", async () => {
    const { reader: r, calls } = reader({
      objectivePolicies: () =>
        Promise.resolve([
          { scopeType: "relationship_shared", revokedAt: "2026-10-01" },
        ]),
    });
    const view = await r.raiseFor(actorOf(INVESTOR_ORG), COMPANY);
    expect(view.source).toBe("NONE");
    expect(calls.pitchReads).toBe(0);
  });

  it("a failing policy read is treated as hidden (privacy wins)", async () => {
    const { reader: r } = reader({
      objectivePolicies: () => Promise.reject(new Error("down")),
    });
    expect((await r.raiseFor(actorOf(INVESTOR_ORG), COMPANY)).source).toBe(
      "NONE",
    );
  });

  it("a failing disclosure read never shows the objective", async () => {
    const { reader: r } = reader({
      disclosure: {
        evaluateMany: () => Promise.reject(new Error("down")),
      } as CompanyRaiseReaderPorts["disclosure"],
      playablePitches: () => Promise.resolve([]),
    });
    const view = await r.raiseFor(actorOf(INVESTOR_ORG), COMPANY);
    expect(view.source).toBe("NONE");
  });

  it("a founder reading another company gets no pitch-derived raise", async () => {
    const { reader: r, calls } = reader();
    const view = await r.raiseFor(
      actorOf("33333333-0000-4000-8000-0000000000ff"),
      COMPANY,
    );
    expect(view.source).toBe("NONE");
    expect(calls.pitchReads).toBe(0);
  });

  it("an unknown company is NONE", async () => {
    const { reader: r } = reader();
    expect(
      (
        await r.raiseFor(
          actorOf(INVESTOR_ORG),
          "33333333-0000-4000-8000-0000000000aa",
        )
      ).source,
    ).toBe("NONE");
  });
});
