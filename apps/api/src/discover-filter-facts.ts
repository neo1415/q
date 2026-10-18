import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type { CompanyQueryPort } from "@capital-q/companies";
import { CompanyIdSchema } from "@capital-q/companies";
import type {
  DiscoverFilterFactsPort,
  FilterMoney,
} from "@capital-q/discovery";
import type { DiscoverablePitchQueryPort } from "@capital-q/media";
import {
  actorPrincipal,
  type DisclosureAccessService,
} from "@capital-q/permissions";

/**
 * The Discover filter facts other contexts own (ux/discover-filters),
 * composed here because the API is where those contexts meet:
 *
 *   disclosedRaises  the company's current raise, only where the
 *                    disclosure evaluator allows THIS reader to view it.
 *                    A raise is founder_private until shared with a named
 *                    relationship, so for most readers it is not shared,
 *                    and the filter says "Raise not shared" rather than
 *                    letting a private figure narrow an investor's feed
 *                    (the Context Firewall).
 *   verified         Capital Q's own organisation verification, as the Q
 *                    Card states it publicly.
 *   withPitch        a publishable pitch, from the Media context's port.
 *
 * Each is asked only when its filter is on, for companies the read-time
 * guards already allowed this reader to see.
 */
export function createDiscoverFilterFacts(ports: {
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompany">;
  readonly capital: Pick<CapitalObjectiveQueryPort, "getCurrentForCompany">;
  readonly disclosure: Pick<DisclosureAccessService, "evaluateMany">;
  readonly verification: () => {
    readonly companyStandings: (subject: {
      readonly tenantId: string;
      readonly organisationId: string;
    }) => Promise<{ readonly organisation: { readonly verified: boolean } }>;
  };
  readonly pitches: () => Pick<
    DiscoverablePitchQueryPort,
    "findDiscoverablePitches"
  >;
}): Omit<DiscoverFilterFactsPort, "sectors"> {
  const identities = async (companyIds: readonly string[]) =>
    (
      await Promise.all(
        companyIds.map(async (raw) => {
          const id = CompanyIdSchema.safeParse(raw);
          return id.success
            ? ports.companies.findCanonicalCompany(id.data)
            : null;
        }),
      )
    ).filter((company) => company !== null);

  return {
    disclosedRaises: async ({ actor, companyIds }) => {
      const out = new Map<string, FilterMoney>();
      const objectives = (
        await Promise.all(
          (await identities(companyIds)).map((company) =>
            ports.capital.getCurrentForCompany(company.tenantId, company.id),
          ),
        )
      ).filter(
        (objective): objective is NonNullable<typeof objective> =>
          objective !== null && objective.status === "ACTIVE",
      );
      if (objectives.length === 0) return out;
      const decisions = await ports.disclosure.evaluateMany(
        objectives.map((objective) => ({
          principal: actorPrincipal(actor),
          resource: { type: "capital_objective", id: objective.id },
          requestedAccess: "view",
        })),
      );
      objectives.forEach((objective, index) => {
        if (decisions[index]?.outcome === "ALLOW") {
          out.set(objective.companyId, {
            amount: objective.target.amount,
            currency: objective.target.currency,
          });
        }
      });
      return out;
    },
    verified: async (companyIds) => {
      const standings = await Promise.all(
        (await identities(companyIds)).map(async (company) => ({
          companyId: company.id,
          standing: await ports
            .verification()
            .companyStandings({
              tenantId: company.tenantId,
              organisationId: company.organisationId,
            })
            .catch(() => null),
        })),
      );
      return new Set(
        standings
          .filter((s) => s.standing?.organisation.verified === true)
          .map((s) => s.companyId),
      );
    },
    withPitch: async (companyIds) =>
      new Set(
        (await ports.pitches().findDiscoverablePitches(companyIds)).keys(),
      ),
  };
}
