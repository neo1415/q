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
  /** Pitches this reader may play, newest first (Media's playback rule). */
  readonly playablePitches: (
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
  const pitchClaimFor = async (
    actor: ActorContext,
    companyId: string,
  ): Promise<PitchRaiseClaimFact | null> => {
    const pitches = (
      await settled(ports.playablePitches(actor, companyId), [])
    ).slice(0, RAISE_PITCHES_MAX);
    // In order, newest first, stopping at the first raise: the same pitch
    // wins on every surface, and older transcripts are not read for nothing.
    for (const pitch of pitches) {
      const said = await settled(
        ports.pitchRaise(actor, companyId, pitch.mediaAssetId),
        null,
      );
      if (said !== null) {
        return {
          pitchId: pitch.mediaAssetId,
          atSeconds: said.atSeconds,
          amount: said.amount,
          currency: said.currency,
          visibility: pitch.visibility,
        };
      }
    }
    return null;
  };

  const sharingOf = (objective: RaiseObjectiveFact | null) =>
    objective === null
      ? Promise.resolve<RaiseSharing>("PRIVATE")
      : settled(
          ports.objectivePolicies(objective.id).then(sharingFromPolicies),
          // Unknown sharing is treated as hidden: privacy wins.
          "HIDDEN",
        );

  const raisesFor = async (
    actor: ActorContext,
    companyIds: readonly string[],
  ): Promise<ReadonlyMap<string, CompanyRaiseView>> => {
    const ids = [...new Set(companyIds)].slice(0, RAISE_BATCH_MAX);
    const investorRead = settled(ports.isInvestor(actor), false);
    const companies = (
      await Promise.all(
        ids.map(async (raw) => {
          const id = CompanyIdSchema.safeParse(raw);
          return id.success
            ? settled(ports.findCanonicalCompany(id.data), null)
            : null;
        }),
      )
    ).filter((company): company is CompanyIdentity => company !== null);
    const objectives = await Promise.all(
      companies.map((company) =>
        settled(ports.currentObjective(company), null),
      ),
    );
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

    const views = await Promise.all(
      companies.map(async (company, index) => {
        const objective = objectives[index] ?? null;
        const viewer: RaiseViewerKind =
          owned[index] === true ? "OWNER" : investor ? "INVESTOR" : "FOUNDER";
        const disclosedBecause = allowReason.get(index) ?? null;
        // A disclosed objective, or a founder reading someone else's
        // company, needs neither the sharing history nor a pitch read.
        if (
          viewer === "FOUNDER" ||
          (viewer === "INVESTOR" &&
            objective !== null &&
            disclosedBecause !== null)
        ) {
          return presentCompanyRaise({
            viewer,
            objective,
            disclosedBecause,
            sharing: "PRIVATE",
            pitchClaim: null,
          });
        }
        const sharing = await sharingOf(objective);
        const pitchClaim =
          sharing === "HIDDEN" || (viewer === "OWNER" && objective !== null)
            ? null
            : await pitchClaimFor(actor, company.id);
        return presentCompanyRaise({
          viewer,
          objective,
          disclosedBecause,
          sharing,
          pitchClaim,
        });
      }),
    );
    return new Map(
      companies.map((company, index) => [
        company.id as string,
        views[index] ?? NO_RAISE_VIEW,
      ]),
    );
  };

  return {
    raisesFor,
    raiseFor: async (actor, companyId) =>
      (await raisesFor(actor, [companyId])).get(companyId) ?? NO_RAISE_VIEW,
  };
}
