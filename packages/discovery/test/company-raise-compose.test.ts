import { describe, expect, it } from "vitest";

import { CompanyIdSchema, type CompanyIdentity } from "@capital-q/companies";
import {
  ActorContextSchema,
  OrganisationIdSchema,
  TenantIdSchema,
} from "@capital-q/security";

import { composeCompanyRaiseReader } from "../src/index.js";

/**
 * Coordinator 2026-10-26 (fit_top_candidates still ~800 round trips): the
 * composed raise reader asked Media's playback rule of every pitch first,
 * then read each pitch's transcript, which applies the same rule again.
 * Each check resolves the viewer's company and reads the asset, so a
 * company's pitches cost two of them each. The rule is now applied once
 * per pitch read, by the transcript read, and a pitch it refuses still
 * says nothing.
 */

const TENANT = "11111111-0000-4000-8000-000000000001";
const INVESTOR_ORG = "11111111-0000-4000-8000-0000000000aa";
const COMPANIES = [
  "22222222-0000-4000-8000-000000000001",
  "22222222-0000-4000-8000-000000000002",
  "22222222-0000-4000-8000-000000000003",
];
const pitchOf = (companyId: string, n: number) =>
  `5555555${String(n)}${companyId.slice(8)}`;

const investor = ActorContextSchema.parse({
  userId: "33333333-0000-4000-8000-000000000001",
  tenantId: TENANT,
  organisationId: INVESTOR_ORG,
  actorType: "HUMAN",
});

function composed() {
  /** Playback rule applications, by pitch. */
  const checks: string[] = [];
  const reader = composeCompanyRaiseReader({
    sql: {} as never,
    companies: {
      findCanonicalCompany: (id) =>
        Promise.resolve<CompanyIdentity>({
          id: CompanyIdSchema.parse(id),
          tenantId: TenantIdSchema.parse(TENANT),
          organisationId: OrganisationIdSchema.parse(
            "44444444-0000-4000-8000-000000000001",
          ),
          canonicalName: "Example",
          companyStatus: "active",
        }),
    },
    // No objective: the raise can only come from a pitch.
    capital: { getCurrentForCompany: () => Promise.resolve(null) },
    disclosure: { evaluateMany: () => Promise.resolve([]) },
    policies: { findAllForResource: () => Promise.resolve([]) },
    isInvestor: () => Promise.resolve(true),
    pitches: () => ({
      findDiscoverablePitches: (ids) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              {
                mediaAssetId: pitchOf(id, 1),
                more: [
                  { mediaAssetId: pitchOf(id, 2) },
                  { mediaAssetId: pitchOf(id, 3) },
                ],
              },
            ]),
          ),
        ),
    }),
    // Media's transcript read: the newest pitch is not playable to this
    // reader (and says a raise); the third says one and is playable.
    pitchRaise: (_actor, companyId, mediaAssetId) => {
      checks.push(mediaAssetId);
      const playable = mediaAssetId !== pitchOf(companyId, 1);
      const says =
        mediaAssetId === pitchOf(companyId, 1) ||
        mediaAssetId === pitchOf(companyId, 3);
      return Promise.resolve(
        playable && says
          ? { atSeconds: 9, amount: "3000000", currency: "USD" }
          : null,
      );
    },
  });
  return { reader, checks };
}

describe("the composed raise reader applies the playback rule once per pitch read", () => {
  it("one check per pitch read, newest first, stopping at the first raise", async () => {
    const { reader, checks } = composed();
    const views = await reader.raisesFor(investor, COMPANIES);
    // Three pitches each, all read (the third says the raise): nine checks,
    // where a check before each read made it eighteen.
    expect(checks).toHaveLength(9);
    expect(new Set(checks).size).toBe(9);
    for (const companyId of COMPANIES) {
      const view = views.get(companyId);
      expect(view?.source).toBe("PITCH_CLAIM");
      expect(view?.pitch?.pitchId).toBe(pitchOf(companyId, 3));
    }
  });

  it("a pitch the rule refuses never gives the raise, even one it says", async () => {
    const { reader } = composed();
    const view = await reader.raiseFor(investor, COMPANIES[0] ?? "");
    expect(view.pitch?.pitchId).not.toBe(pitchOf(COMPANIES[0] ?? "", 1));
  });
});
