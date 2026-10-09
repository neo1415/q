import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type { CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  createCompanyRaiseReader,
  RAISE_PITCHES_MAX,
  type CompanyRaiseReader,
} from "@capital-q/discovery";
import {
  extractPitchClaims,
  MediaAssetIdSchema,
  type DiscoverablePitchQueryPort,
  type TimedCue,
} from "@capital-q/media";
import type {
  DisclosureAccessService,
  DisclosurePolicyRepository,
} from "@capital-q/permissions";
import type { ActorContext } from "@capital-q/security";

/**
 * The API's composition of `raiseFor` (R2): Discover's card and the
 * company profile both read the raise from this one reader, so the same
 * reader is told the same thing on both. Each input comes through the
 * port of the context that owns it; nothing here reads another context's
 * tables.
 */

/** The first raise with an amount said in these cues, or null. */
export function firstPitchRaise(cues: readonly TimedCue[]): {
  readonly atSeconds: number;
  readonly amount: string;
  readonly currency: string;
} | null {
  const said = extractPitchClaims(cues).find(
    (claim) => claim.kind === "RAISE" && claim.money !== undefined,
  );
  return said?.money === undefined
    ? null
    : {
        atSeconds: Math.floor(said.atMs / 1000),
        amount: said.money.amount,
        currency: said.money.currency,
      };
}

export function createApiCompanyRaiseReader(ports: {
  readonly sql: DatabaseExecutor;
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompany">;
  readonly capital: Pick<CapitalObjectiveQueryPort, "getCurrentForCompany">;
  readonly disclosure: Pick<DisclosureAccessService, "evaluateMany">;
  readonly policies: Pick<DisclosurePolicyRepository, "findAllForResource">;
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  readonly pitches: () => Pick<
    DiscoverablePitchQueryPort,
    "findDiscoverablePitches"
  >;
  /** Media's playback rule, as a yes or no. */
  readonly mayPlay: (
    actor: ActorContext,
    companyId: string,
    mediaAssetId: string,
  ) => Promise<boolean>;
  /** The pitch's transcript cues under the same playback rule, or null. */
  readonly pitchCues: (
    actor: ActorContext,
    companyId: string,
    mediaAssetId: string,
  ) => Promise<readonly TimedCue[] | null>;
}): CompanyRaiseReader {
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
          // Both audiences are offered to signed-in Capital Q participants
          // (INVESTORS is the investor subset of the network); ADR-001 has
          // no narrower scope, and the reader only holds a pitch the
          // playback rule admitted.
          visibility: "network_visible" as const,
        }));
    },
    pitchRaise: async (actor, companyId, mediaAssetId) => {
      if (!MediaAssetIdSchema.safeParse(mediaAssetId).success) return null;
      const cues = await ports.pitchCues(actor, companyId, mediaAssetId);
      return cues === null ? null : firstPitchRaise(cues);
    },
  });
}
