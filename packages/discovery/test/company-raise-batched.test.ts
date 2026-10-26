import { describe, expect, it } from "vitest";

import { CompanyIdSchema, type CompanyIdentity } from "@capital-q/companies";
import {
  ActorContextSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createCompanyRaiseReader,
  type CompanyRaiseReaderPorts,
  type RaiseObjectiveFact,
  type RaisePolicyRow,
} from "../src/index.js";

/**
 * Coordinator 2026-10-26 (live trace, a top-five ranking: the raise read
 * each shown company one query at a time, twice). The reader's batch
 * ports read each kind once for the set; every reader's answer for every
 * company is the one the one-by-one ports give, failures included.
 */

const TENANT = "44444444-0000-4000-8000-000000000001";
const OWN_ORG = "44444444-0000-4000-8000-0000000000a1";
const INVESTOR_ORG = "44444444-0000-4000-8000-0000000000b1";
const OTHER_ORG = "44444444-0000-4000-8000-0000000000c1";
const id = (n: number) => `44444444-0000-4000-8000-00000000000${String(n)}`;

type Shape = {
  readonly objective: "DISCLOSED" | "PRIVATE" | "REVOKED" | "NETWORK" | null;
  /** The pitches newest first; the amount each says (null: says none). */
  readonly pitches: readonly (string | null)[];
  readonly own?: boolean;
};
const SHAPES: Record<string, Shape> = {
  [id(1)]: { objective: "DISCLOSED", pitches: ["1000000"] },
  [id(2)]: { objective: "PRIVATE", pitches: ["2000000"] },
  [id(3)]: { objective: "REVOKED", pitches: ["3000000"] },
  [id(4)]: { objective: null, pitches: [null, "4000000", "4500000"] },
  [id(5)]: { objective: null, pitches: [] },
  [id(6)]: { objective: "NETWORK", pitches: [] },
  [id(7)]: { objective: "PRIVATE", pitches: [null], own: true },
};
const IDS = Object.keys(SHAPES);

const actorOf = (organisationId: string): ActorContext =>
  ActorContextSchema.parse({
    userId: "44444444-0000-4000-8000-000000000010",
    tenantId: TENANT,
    organisationId,
    membershipId: "44444444-0000-4000-8000-000000000011",
    actorType: "HUMAN",
  });

const companyOf = (companyId: string): CompanyIdentity => ({
  id: CompanyIdSchema.parse(companyId),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(
    SHAPES[companyId]?.own === true ? OWN_ORG : `${companyId.slice(0, 34)}aa`,
  ),
  canonicalName: "Example",
  companyStatus: "active",
});
const objectiveOf = (companyId: string): RaiseObjectiveFact | null =>
  SHAPES[companyId]?.objective == null
    ? null
    : {
        id: `obj-${companyId}`,
        amount: "9000000",
        currency: "USD",
        startedAt: "2026-09-01T00:00:00.000Z",
      };
const policiesOf = (objectiveId: string): readonly RaisePolicyRow[] => {
  const shape = SHAPES[objectiveId.replace(/^obj-/u, "")]?.objective;
  return shape === "REVOKED"
    ? [{ scopeType: "network_visible", revokedAt: "2026-10-01" }]
    : shape === "NETWORK"
      ? [{ scopeType: "network_visible", revokedAt: null }]
      : [];
};
const pitchId = (companyId: string, n: number) => `p${String(n)}-${companyId}`;

function ports(options: { batched: boolean; policiesFail?: boolean }) {
  const calls = { oneByOne: 0, batched: 0 };
  const one = <T>(value: T) => {
    calls.oneByOne += 1;
    return Promise.resolve(value);
  };
  const many = <T>(value: T) => {
    calls.batched += 1;
    return Promise.resolve(value);
  };
  const said = (companyId: string, mediaAssetId: string) => {
    const index = Number(mediaAssetId.slice(1, 2));
    const amount = SHAPES[companyId]?.pitches[index] ?? null;
    return amount === null
      ? null
      : { atSeconds: 10 + index, amount, currency: "USD" };
  };
  const base: CompanyRaiseReaderPorts = {
    findCanonicalCompany: (companyId) => one(companyOf(companyId)),
    currentObjective: (company) => one(objectiveOf(company.id)),
    disclosure: {
      evaluateMany: (requests) =>
        Promise.resolve(
          requests.map((request) => {
            const disclosed =
              SHAPES[request.resource.id.replace(/^obj-/u, "")]?.objective ===
              "DISCLOSED";
            return disclosed
              ? {
                  outcome: "ALLOW" as const,
                  resource: request.resource,
                  requestedAccess: request.requestedAccess,
                  grantedAccess: request.requestedAccess,
                  reasonCode: "RELATIONSHIP_PARTY" as const,
                  via: { kind: "INTRINSIC" as const },
                }
              : {
                  outcome: "DENY" as const,
                  resource: request.resource,
                  requestedAccess: request.requestedAccess,
                  reasonCode: "NO_MATCHING_SCOPE" as const,
                };
          }),
        ),
    },
    objectivePolicies: (objectiveId) =>
      options.policiesFail === true
        ? Promise.reject(new Error("down"))
        : one(policiesOf(objectiveId)),
    isInvestor: (actor) =>
      Promise.resolve(actor.organisationId === INVESTOR_ORG),
    pitches: (_actor, companyId) =>
      one(
        (SHAPES[companyId]?.pitches ?? []).map((_, n) => ({
          mediaAssetId: pitchId(companyId, n),
          visibility: "network_visible" as const,
        })),
      ),
    pitchRaise: (_actor, companyId, mediaAssetId) =>
      one(said(companyId, mediaAssetId)),
  };
  if (!options.batched) return { ports: base, calls };
  return {
    calls,
    ports: {
      ...base,
      findCanonicalCompanies: (ids) => many(ids.map(companyOf)),
      currentObjectives: (companies) =>
        many(
          new Map(
            companies.flatMap((company) => {
              const objective = objectiveOf(company.id);
              return objective === null ? [] : [[company.id, objective]];
            }),
          ),
        ),
      objectivePoliciesMany: (objectiveIds) =>
        options.policiesFail === true
          ? Promise.reject(new Error("down"))
          : many(new Map(objectiveIds.map((o) => [o, policiesOf(o)]))),
      pitchesMany: (_actor, companyIds) =>
        many(
          new Map(
            companyIds.map((companyId) => [
              companyId,
              (SHAPES[companyId]?.pitches ?? []).map((_, n) => ({
                mediaAssetId: pitchId(companyId, n),
                visibility: "network_visible" as const,
              })),
            ]),
          ),
        ),
      pitchRaises: (_actor, pitches) =>
        many(
          new Map(
            pitches.map((p) => [
              p.mediaAssetId,
              said(p.companyId, p.mediaAssetId),
            ]),
          ),
        ),
    } satisfies CompanyRaiseReaderPorts,
  };
}

const viewers = [
  ["an investor", actorOf(INVESTOR_ORG)],
  ["their own founder", actorOf(OWN_ORG)],
  ["a founder elsewhere", actorOf(OTHER_ORG)],
] as const;

describe("the raise of many companies, read together, decides as one by one", () => {
  for (const [label, who] of viewers) {
    it(`${label}: every company's raise is the one the one-by-one reads give`, async () => {
      const batched = ports({ batched: true });
      const alone = ports({ batched: false });
      const together = await createCompanyRaiseReader(batched.ports).raisesFor(
        who,
        IDS,
      );
      expect(together).toEqual(
        await createCompanyRaiseReader(alone.ports).raisesFor(who, IDS),
      );
      expect(batched.calls.oneByOne).toBe(0);
    });
  }

  it("each kind is read once per round, whatever the number of companies", async () => {
    const { ports: p, calls } = ports({ batched: true });
    const views = await createCompanyRaiseReader(p).raisesFor(
      actorOf(INVESTOR_ORG),
      IDS,
    );
    // companies, objectives, policies, pitch sets, and one pitch round per
    // depth asked (the 4th company's raise is in its second pitch).
    expect(calls.batched).toBe(6);
    expect(views.get(id(1))?.source).toBe("DISCLOSED_OBJECTIVE");
    expect(views.get(id(4))?.pitch?.pitchId).toBe(pitchId(id(4), 1));
    // Denied stays denied: a private objective is never the raise shown.
    expect(views.get(id(2))?.money?.amount).not.toBe("9000000");
    // A revoked share hides the raise, its pitch included.
    expect(views.get(id(3))?.source).toBe("NONE");
  });

  it("a failed policy read hides the raise either way (privacy wins)", async () => {
    const batched = ports({ batched: true, policiesFail: true });
    const alone = ports({ batched: false, policiesFail: true });
    const who = actorOf(INVESTOR_ORG);
    expect(
      await createCompanyRaiseReader(batched.ports).raisesFor(who, IDS),
    ).toEqual(await createCompanyRaiseReader(alone.ports).raisesFor(who, IDS));
  });
});
