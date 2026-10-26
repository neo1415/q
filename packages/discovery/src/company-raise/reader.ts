import type { CompanyIdentity } from "@capital-q/companies";
import { CompanyIdSchema } from "@capital-q/companies";
import type {
  CompanyRaiseView,
  MarketplaceVisibility,
} from "@capital-q/contracts";
import { NO_RAISE_VIEW } from "@capital-q/contracts";
import {
  actorPrincipal,
  type DisclosureAccessService,
  type DisclosureAllowReason,
} from "@capital-q/permissions";
import type { ActorContext } from "@capital-q/security";

import {
  presentCompanyRaise,
  type PitchRaiseClaimFact,
  type RaiseObjectiveFact,
  type RaiseSharing,
  type RaiseViewerKind,
} from "./policy.js";

/**
 * `raiseFor(viewer, companyId)`: the one company read for the raise. It
 * gathers the policy's inputs through the contexts that own them, never
 * their tables:
 *
 *   objective   Capital's current ACTIVE objective (org-internal);
 *   disclosure  the evaluator's decision on that objective for THIS reader;
 *   sharing     the objective's disclosure-policy history (a revoked share
 *               means the founder hid it);
 *   pitch       the first raise said in a pitch this reader may play,
 *               newest first, read under Media's playback rule.
 *
 * Callers must already have decided the reader may see the company (the
 * slate reader, the profile route, Q's firewall). Any read that fails is
 * treated as the private answer: privacy wins, the result is NONE or the
 * disclosed objective, never a guess.
 */

/** Pitches read per company: the newest first, bounded for latency. */
export const RAISE_PITCHES_MAX = 6;

/** A bound so a feed page cannot fan out unboundedly. */
export const RAISE_BATCH_MAX = 50;

export type RaisePitchCandidate = {
  readonly mediaAssetId: string;
  /** The scope under which this reader may play it. */
  readonly visibility: MarketplaceVisibility;
};

export type RaisePolicyRow = {
  readonly scopeType: string;
  readonly revokedAt: unknown;
};

export type CompanyRaiseReaderPorts = {
  readonly findCanonicalCompany: (
    companyId: CompanyIdentity["id"],
  ) => Promise<CompanyIdentity | null>;
  /** Capital's current ACTIVE objective for the company, or null. */
  readonly currentObjective: (
    company: CompanyIdentity,
  ) => Promise<RaiseObjectiveFact | null>;
  readonly disclosure: Pick<DisclosureAccessService, "evaluateMany">;
  /** The objective's policy history, under platform authority; never a figure. */
  readonly objectivePolicies: (
    objectiveId: string,
  ) => Promise<readonly RaisePolicyRow[]>;
  /** Whether the actor acts for an investor organisation. */
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  /**
   * The company's discoverable pitches, newest first. Whether this reader
   * may play each is pitchRaise's to decide, under Media's playback rule,
   * so the rule is applied once per pitch read (coordinator 2026-10-26:
   * checked here first as well, it cost a viewer resolution and an asset
   * read per pitch, twice, for every company shown).
   */
  readonly pitches: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<readonly RaisePitchCandidate[]>;
  /**
   * The raise said in one pitch, read under the same playback rule: the
   * first raise with an amount, or null (none said, no transcript, or not
   * playable).
   */
  readonly pitchRaise: (
    actor: ActorContext,
    companyId: string,
    mediaAssetId: string,
  ) => Promise<{
    readonly atSeconds: number;
    readonly amount: string;
    readonly currency: string;
  } | null>;
  /**
   * The same reads for many companies at once (coordinator 2026-10-26,
   * live trace: the raise read each shown company one query at a time,
   * twice per top-five ranking). Each is optional; without it the reader
   * asks company by company, and either way it decides the same.
   */
  readonly findCanonicalCompanies?:
    | ((
        companyIds: readonly CompanyIdentity["id"][],
      ) => Promise<readonly CompanyIdentity[]>)
    | undefined;
  /** Each company's current ACTIVE objective, by company id (absent: none). */
  readonly currentObjectives?:
    | ((
        companies: readonly CompanyIdentity[],
      ) => Promise<ReadonlyMap<string, RaiseObjectiveFact>>)
    | undefined;
  /** Each objective's policy history, by objective id. */
  readonly objectivePoliciesMany?:
    | ((
        objectiveIds: readonly string[],
      ) => Promise<ReadonlyMap<string, readonly RaisePolicyRow[]>>)
    | undefined;
  /** Each company's discoverable pitches, newest first, by company id. */
  readonly pitchesMany?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, readonly RaisePitchCandidate[]>>)
    | undefined;
  /**
   * The raise said in each of these pitches, under the same playback rule
   * as pitchRaise, by media asset id (absent or null: none said, or not
   * playable to this reader).
   */
  readonly pitchRaises?:
    | ((
        actor: ActorContext,
        pitches: readonly {
          readonly companyId: string;
          readonly mediaAssetId: string;
        }[],
      ) => Promise<
        ReadonlyMap<
          string,
          {
            readonly atSeconds: number;
            readonly amount: string;
            readonly currency: string;
          } | null
        >
      >)
    | undefined;
};

export type CompanyRaiseReader = {
  readonly raiseFor: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<CompanyRaiseView>;
  readonly raisesFor: (
    actor: ActorContext,
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, CompanyRaiseView>>;
};

/**
 * An unrevoked network share is NETWORK; any share the founder revoked is
 * HIDDEN (they took it back, so privacy wins); otherwise PRIVATE, the
 * default nobody chose against.
 */
export function sharingFromPolicies(
  policies: readonly RaisePolicyRow[],
): RaiseSharing {
  const live = (p: RaisePolicyRow) =>
    p.revokedAt === null || p.revokedAt === undefined;
  if (policies.some((p) => live(p) && p.scopeType === "network_visible")) {
    return "NETWORK";
  }
  return policies.some((p) => !live(p)) ? "HIDDEN" : "PRIVATE";
}

async function settled<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch {
    return fallback;
  }
}

export function createCompanyRaiseReader(
  ports: CompanyRaiseReaderPorts,
): CompanyRaiseReader {
  const companiesOf = async (
    ids: readonly CompanyIdentity["id"][],
  ): Promise<readonly CompanyIdentity[]> => {
    const many = ports.findCanonicalCompanies;
    if (many !== undefined) {
      const found = await settled(many(ids), []);
      const byId = new Map(found.map((company) => [company.id, company]));
      return ids.flatMap((id) => {
        const company = byId.get(id);
        return company === undefined ? [] : [company];
      });
    }
    return (
      await Promise.all(
        ids.map((id) => settled(ports.findCanonicalCompany(id), null)),
      )
    ).filter((company): company is CompanyIdentity => company !== null);
  };

  const objectivesOf = async (
    companies: readonly CompanyIdentity[],
  ): Promise<readonly (RaiseObjectiveFact | null)[]> => {
    const many = ports.currentObjectives;
    if (many !== undefined) {
      const found = await settled(
        many(companies),
        new Map<string, RaiseObjectiveFact>(),
      );
      return companies.map((company) => found.get(company.id) ?? null);
    }
    return Promise.all(
      companies.map((company) =>
        settled(ports.currentObjective(company), null),
      ),
    );
  };

  /** Each objective's sharing; unknown sharing is hidden (privacy wins). */
  const sharingsOf = async (
    objectiveIds: readonly string[],
  ): Promise<ReadonlyMap<string, RaiseSharing>> => {
    if (objectiveIds.length === 0) return new Map();
    const many = ports.objectivePoliciesMany;
    if (many !== undefined) {
      const found = await settled<ReadonlyMap<
        string,
        readonly RaisePolicyRow[]
      > | null>(many(objectiveIds), null);
      return new Map(
        objectiveIds.map((id) => [
          id,
          found === null ? "HIDDEN" : sharingFromPolicies(found.get(id) ?? []),
        ]),
      );
    }
    return new Map(
      await Promise.all(
        objectiveIds.map(
          async (id) =>
            [
              id,
              await settled<RaiseSharing>(
                ports.objectivePolicies(id).then(sharingFromPolicies),
                "HIDDEN",
              ),
            ] as const,
        ),
      ),
    );
  };

  /**
   * The first raise said in a pitch this reader may play, per company:
   * each company's pitches newest first, bounded, stopping at its first
   * raise. Asked in rounds (every company's next pitch together), so the
   * same pitch wins as one by one, and older transcripts are not read for
   * nothing.
   */
  const pitchClaimsOf = async (
    actor: ActorContext,
    companyIds: readonly string[],
  ): Promise<ReadonlyMap<string, PitchRaiseClaimFact>> => {
    const claims = new Map<string, PitchRaiseClaimFact>();
    if (companyIds.length === 0) return claims;
    const manyPitches = ports.pitchesMany;
    const candidates: ReadonlyMap<string, readonly RaisePitchCandidate[]> =
      manyPitches !== undefined
        ? await settled(
            manyPitches(actor, companyIds),
            new Map<string, readonly RaisePitchCandidate[]>(),
          )
        : new Map(
            await Promise.all(
              companyIds.map(
                async (companyId) =>
                  [
                    companyId,
                    await settled(ports.pitches(actor, companyId), []),
                  ] as const,
              ),
            ),
          );
    for (let round = 0; round < RAISE_PITCHES_MAX; round += 1) {
      const asked = companyIds.flatMap((companyId) => {
        if (claims.has(companyId)) return [];
        const pitch = (candidates.get(companyId) ?? []).slice(
          0,
          RAISE_PITCHES_MAX,
        )[round];
        return pitch === undefined ? [] : [{ companyId, pitch }];
      });
      if (asked.length === 0) break;
      const many = ports.pitchRaises;
      const said: readonly ({
        readonly atSeconds: number;
        readonly amount: string;
        readonly currency: string;
      } | null)[] =
        many !== undefined
          ? await settled(
              many(
                actor,
                asked.map(({ companyId, pitch }) => ({
                  companyId,
                  mediaAssetId: pitch.mediaAssetId,
                })),
              ).then((byPitch) =>
                asked.map(
                  ({ pitch }) => byPitch.get(pitch.mediaAssetId) ?? null,
                ),
              ),
              asked.map(() => null),
            )
          : await Promise.all(
              asked.map(({ companyId, pitch }) =>
                settled(
                  ports.pitchRaise(actor, companyId, pitch.mediaAssetId),
                  null,
                ),
              ),
            );
      asked.forEach(({ companyId, pitch }, index) => {
        const raise = said[index] ?? null;
        if (raise !== null) {
          claims.set(companyId, {
            pitchId: pitch.mediaAssetId,
            atSeconds: raise.atSeconds,
            amount: raise.amount,
            currency: raise.currency,
            visibility: pitch.visibility,
          });
        }
      });
    }
    return claims;
  };

  const raisesFor = async (
    actor: ActorContext,
    companyIds: readonly string[],
  ): Promise<ReadonlyMap<string, CompanyRaiseView>> => {
    const ids = [...new Set(companyIds)]
      .slice(0, RAISE_BATCH_MAX)
      .flatMap((raw) => {
        const id = CompanyIdSchema.safeParse(raw);
        return id.success ? [id.data] : [];
      });
    const investorRead = settled(ports.isInvestor(actor), false);
    const companies = await companiesOf(ids);
    const objectives = await objectivesOf(companies);
    const owned = companies.map(
      (company) =>
        actor.organisationId !== undefined &&
        company.organisationId === actor.organisationId,
    );

    // One batched disclosure evaluation for every objective not the reader's own.
    const asked = companies.flatMap((_, index) => {
      const objective = objectives[index] ?? null;
      return objective === null || owned[index] === true
        ? []
        : [{ index, objective }];
    });
    const decisions =
      asked.length === 0
        ? []
        : await settled(
            ports.disclosure.evaluateMany(
              asked.map(({ objective }) => ({
                principal: actorPrincipal(actor),
                resource: { type: "capital_objective", id: objective.id },
                requestedAccess: "view" as const,
              })),
            ),
            [],
          );
    const allowReason = new Map<number, DisclosureAllowReason>();
    asked.forEach(({ index }, at) => {
      const decision = decisions[at];
      if (decision?.outcome === "ALLOW") {
        allowReason.set(index, decision.reasonCode);
      }
    });
    const investor = await investorRead;
    const viewers: readonly RaiseViewerKind[] = companies.map((_, index) =>
      owned[index] === true ? "OWNER" : investor ? "INVESTOR" : "FOUNDER",
    );
    // A disclosed objective, or a founder reading someone else's company,
    // needs neither the sharing history nor a pitch read.
    const settledByDisclosure = companies.map((_, index) => {
      const viewer = viewers[index];
      return (
        viewer === "FOUNDER" ||
        (viewer === "INVESTOR" &&
          objectives[index] !== null &&
          allowReason.has(index))
      );
    });
    const sharings = await sharingsOf(
      companies.flatMap((_, index) => {
        const objective = objectives[index] ?? null;
        return settledByDisclosure[index] === true || objective === null
          ? []
          : [objective.id];
      }),
    );
    const sharingAt = (index: number): RaiseSharing => {
      const objective = objectives[index] ?? null;
      return objective === null
        ? "PRIVATE"
        : (sharings.get(objective.id) ?? "HIDDEN");
    };
    const claims = await pitchClaimsOf(
      actor,
      companies.flatMap((company, index) =>
        settledByDisclosure[index] === true ||
        sharingAt(index) === "HIDDEN" ||
        (viewers[index] === "OWNER" && objectives[index] !== null)
          ? []
          : [company.id as string],
      ),
    );
    return new Map(
      companies.map((company, index) => {
        const viewer = viewers[index] ?? "FOUNDER";
        const objective = objectives[index] ?? null;
        const disclosedBecause = allowReason.get(index) ?? null;
        const view =
          settledByDisclosure[index] === true
            ? presentCompanyRaise({
                viewer,
                objective,
                disclosedBecause,
                sharing: "PRIVATE",
                pitchClaim: null,
              })
            : presentCompanyRaise({
                viewer,
                objective,
                disclosedBecause,
                sharing: sharingAt(index),
                pitchClaim: claims.get(company.id) ?? null,
              });
        return [company.id, view] as const;
      }),
    );
  };

  return {
    raisesFor,
    raiseFor: async (actor, companyId) =>
      (await raisesFor(actor, [companyId])).get(companyId) ?? NO_RAISE_VIEW,
  };
}
