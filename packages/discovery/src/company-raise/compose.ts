import type { CompanyIdentity, CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import type {
  DisclosureAccessService,
  DisclosurePolicyRepository,
} from "@capital-q/permissions";
import type { ActorContext } from "@capital-q/security";

import {
  createCompanyRaiseReader,
  RAISE_PITCHES_MAX,
  type CompanyRaiseReader,
  type CompanyRaiseReaderPorts,
} from "./reader.js";

/**
 * `raiseFor` composed over the owning contexts' ports, one way for every
 * deployable (the API's Discover and profile routes, the Q API's tools),
 * so no app re-derives the raise. The ports are structural: discovery
 * reads Capital and Media only through what the app hands it.
 */
export type CompanyRaiseContextPorts = {
  readonly sql: DatabaseExecutor;
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompany"> &
    Partial<Pick<CompanyQueryPort, "findCanonicalCompanies">>;
  /** Capital's current objective (the founder's own record, org-internal). */
  readonly capital: {
    readonly getCurrentForCompany: (
      tenantId: CompanyIdentity["tenantId"],
      companyId: CompanyIdentity["id"],
    ) => Promise<{
      readonly id: string;
      readonly status: string;
      readonly target: { readonly amount: string; readonly currency: string };
      readonly startedAt: string;
    } | null>;
    /** The ACTIVE objective of each of many companies, in one read. */
    readonly getCurrentForCompanies?:
      | ((
          companies: readonly {
            readonly tenantId: CompanyIdentity["tenantId"];
            readonly companyId: CompanyIdentity["id"];
          }[],
        ) => Promise<
          readonly {
            readonly id: string;
            readonly companyId: string;
            readonly status: string;
            readonly target: {
              readonly amount: string;
              readonly currency: string;
            };
            readonly startedAt: string;
          }[]
        >)
      | undefined;
  };
  readonly disclosure: Pick<DisclosureAccessService, "evaluateMany">;
  readonly policies: Pick<DisclosurePolicyRepository, "findAllForResource"> &
    Partial<Pick<DisclosurePolicyRepository, "findAllForResources">>;
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  /** Media's discoverable pitch sets (newest first, then `more`). */
  readonly pitches: () => {
    readonly findDiscoverablePitches: (
      companyIds: readonly string[],
    ) => Promise<
      ReadonlyMap<
        string,
        {
          readonly mediaAssetId: string;
          readonly more: readonly { readonly mediaAssetId: string }[];
        }
      >
    >;
  };
  /**
   * pitchRaise for many pitches at once, under the same playback rule
   * (absent: each pitch is read alone).
   */
  readonly pitchRaises?: CompanyRaiseReaderPorts["pitchRaises"];
  /**
   * The raise said in that pitch (Media's transcript + `firstPitchRaise`),
   * read under Media's playback rule: null for a pitch this reader may not
   * play. It is the only playback check the raise makes.
   */
  readonly pitchRaise: CompanyRaiseReaderPorts["pitchRaise"];
};

export function composeCompanyRaiseReader(
  ports: CompanyRaiseContextPorts,
): CompanyRaiseReader {
  const objectiveFact = (objective: {
    readonly id: string;
    readonly status: string;
    readonly target: { readonly amount: string; readonly currency: string };
    readonly startedAt: string;
  }) =>
    objective.status !== "ACTIVE"
      ? null
      : {
          id: objective.id,
          amount: objective.target.amount,
          currency: objective.target.currency,
          startedAt: objective.startedAt,
        };
  const findMany = ports.companies.findCanonicalCompanies;
  const objectivesMany = ports.capital.getCurrentForCompanies;
  const policiesMany = ports.policies.findAllForResources;
  // Coordinator 2026-10-26 (live trace, a top-five ranking): each of these
  // was one query per company shown, twice; now one read for the set.
  return createCompanyRaiseReader({
    ...(findMany === undefined
      ? {}
      : { findCanonicalCompanies: (ids) => findMany(ids) }),
    ...(objectivesMany === undefined
      ? {}
      : {
          currentObjectives: async (companies) => {
            const found = await objectivesMany(
              companies.map((company) => ({
                tenantId: company.tenantId,
                companyId: company.id,
              })),
            );
            const out = new Map<
              string,
              NonNullable<ReturnType<typeof objectiveFact>>
            >();
            for (const objective of found) {
              const fact = objectiveFact(objective);
              if (fact !== null) out.set(objective.companyId, fact);
            }
            return out;
          },
        }),
    ...(policiesMany === undefined
      ? {}
      : {
          objectivePoliciesMany: async (objectiveIds) => {
            const rows = await policiesMany(
              ports.sql,
              objectiveIds.map((id) => ({
                type: "capital_objective" as const,
                id,
              })),
            );
            const out = new Map<
              string,
              { readonly scopeType: string; readonly revokedAt: unknown }[]
            >(objectiveIds.map((id) => [id, []]));
            for (const policy of rows) {
              out.get(policy.resource.id)?.push({
                scopeType: policy.scopeType,
                revokedAt: policy.revokedAt,
              });
            }
            return out;
          },
        }),
    pitchesMany: async (_actor, companyIds) => {
      const sets = await ports.pitches().findDiscoverablePitches(companyIds);
      return new Map(
        companyIds.map((companyId) => {
          const set = sets.get(companyId);
          return [
            companyId,
            set === undefined
              ? []
              : [set, ...set.more].slice(0, RAISE_PITCHES_MAX).map((pitch) => ({
                  mediaAssetId: pitch.mediaAssetId,
                  visibility: "network_visible" as const,
                })),
          ] as const;
        }),
      );
    },
    ...(ports.pitchRaises === undefined
      ? {}
      : { pitchRaises: ports.pitchRaises }),
    findCanonicalCompany: (companyId) =>
      ports.companies.findCanonicalCompany(companyId),
    currentObjective: async (company) => {
      const objective = await ports.capital.getCurrentForCompany(
        company.tenantId,
        company.id,
      );
      return objective === null || objective.status !== "ACTIVE"
        ? null
        : {
            id: objective.id,
            amount: objective.target.amount,
            currency: objective.target.currency,
            startedAt: objective.startedAt,
          };
    },
    disclosure: ports.disclosure,
    objectivePolicies: async (objectiveId) =>
      (
        await ports.policies.findAllForResource(ports.sql, {
          type: "capital_objective",
          id: objectiveId,
        })
      ).map((policy) => ({
        scopeType: policy.scopeType,
        revokedAt: policy.revokedAt,
      })),
    isInvestor: ports.isInvestor,
    pitches: async (_actor, companyId) => {
      const set = (
        await ports.pitches().findDiscoverablePitches([companyId])
      ).get(companyId);
      if (set === undefined) return [];
      return [set, ...set.more].slice(0, RAISE_PITCHES_MAX).map((pitch) => ({
        mediaAssetId: pitch.mediaAssetId,
        // Both pitch audiences are offered to signed-in Capital Q
        // participants (INVESTORS is the network's investor subset);
        // ADR-001 has no narrower scope, and a raise is only ever read
        // from a pitch the playback rule admitted (pitchRaise).
        visibility: "network_visible" as const,
      }));
    },
    pitchRaise: ports.pitchRaise,
  });
}
