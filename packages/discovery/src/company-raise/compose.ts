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
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompany">;
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
  };
  readonly disclosure: Pick<DisclosureAccessService, "evaluateMany">;
  readonly policies: Pick<DisclosurePolicyRepository, "findAllForResource">;
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
  /** Media's playback rule, as a yes or no. */
  readonly mayPlay: (
    actor: ActorContext,
    companyId: string,
    mediaAssetId: string,
  ) => Promise<boolean>;
  /** The raise said in that pitch (Media's transcript + `firstPitchRaise`). */
  readonly pitchRaise: CompanyRaiseReaderPorts["pitchRaise"];
};

export function composeCompanyRaiseReader(
  ports: CompanyRaiseContextPorts,
): CompanyRaiseReader {
  return createCompanyRaiseReader({
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
    playablePitches: async (actor, companyId) => {
      const set = (
        await ports.pitches().findDiscoverablePitches([companyId])
      ).get(companyId);
      if (set === undefined) return [];
      const offered = [set, ...set.more].slice(0, RAISE_PITCHES_MAX);
      const playable = await Promise.all(
        offered.map((pitch) =>
          ports
            .mayPlay(actor, companyId, pitch.mediaAssetId)
            .catch(() => false),
        ),
      );
      return offered
        .filter((_, index) => playable[index] === true)
        .map((pitch) => ({
          mediaAssetId: pitch.mediaAssetId,
          // Both pitch audiences are offered to signed-in Capital Q
          // participants (INVESTORS is the network's investor subset);
          // ADR-001 has no narrower scope, and the reader only holds a
          // pitch the playback rule admitted.
          visibility: "network_visible" as const,
        }));
    },
    pitchRaise: ports.pitchRaise,
  });
}
