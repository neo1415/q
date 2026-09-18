import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  ELIGIBILITY_BATCH_MAX,
  ELIGIBILITY_POLICY_VERSION,
  ELIGIBILITY_SUPPORTED_MODES,
  type EligibilityResult,
  type RecommendationContext,
  type RecommendationMode,
} from "./contracts.js";
import { evaluateHardEligibility } from "./policy.js";
import type {
  ActiveMandateLookup,
  CompanyClassification,
  EligibilityPorts,
  RelationshipStanding,
} from "./ports.js";

/**
 * The application service REC-002 (candidate generation) calls. It resolves
 * the investor subject from the trusted actor, reads canonical state
 * through the owning contexts' ports, and hands snapshots to the pure
 * policy. It ranks nothing, persists nothing and calls no model.
 *
 * Cross-tenant by design: the investor lives in one tenant, a candidate in
 * another. The only authority in play is the actor's — their organisation,
 * their mandate — and the disclosure evaluator's answer for each company.
 * Nothing the client sends names a tenant, an organisation or a mandate
 * the actor does not own.
 */

export class RecommendationModeUnsupportedError extends Error {
  readonly mode: RecommendationMode;
  constructor(mode: RecommendationMode) {
    super(
      `eligibility policy ${ELIGIBILITY_POLICY_VERSION} evaluates ${ELIGIBILITY_SUPPORTED_MODES.join(", ")}; ${mode} is a later packet`,
    );
    this.name = "RecommendationModeUnsupportedError";
    this.mode = mode;
  }
}

export class EligibilityBatchTooLargeError extends RangeError {
  constructor(size: number) {
    super(
      `eligibility evaluates at most ${String(ELIGIBILITY_BATCH_MAX)} companies per call; got ${String(size)}`,
    );
    this.name = "EligibilityBatchTooLargeError";
  }
}

export type EvaluateEligibilityQuery = {
  readonly actor: ActorContext;
  readonly mode?: RecommendationMode | undefined;
  /** Pins one of the actor's own mandates; otherwise the single ACTIVE one is used. */
  readonly mandateId?: string | null | undefined;
  readonly companyIds: readonly string[];
};

export type EligibilityEvaluation = {
  readonly context: RecommendationContext;
  /** One result per distinct requested company, in request order. Unknown ids are absent. */
  readonly results: readonly EligibilityResult[];
};

/** The actor's organisation is not an investor organisation; nothing can be evaluated for it. */
export class InvestorSubjectNotResolvedError extends Error {
  constructor() {
    super("the acting organisation has no canonical investor organisation");
    this.name = "InvestorSubjectNotResolvedError";
  }
}

export type EligibilityService = {
  readonly evaluate: (
    query: EvaluateEligibilityQuery,
  ) => Promise<EligibilityEvaluation>;
};

export type EligibilityServiceDependencies = {
  readonly ports: EligibilityPorts;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

export function createEligibilityService(
  dependencies: EligibilityServiceDependencies,
): EligibilityService {
  const { ports, logger } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    evaluations: meter.createCounter("discovery.eligibility.evaluations"),
    duration: meter.createHistogram("discovery.eligibility.duration_ms"),
  };

  return {
    evaluate: async (query) => {
      const mode = query.mode ?? "INVESTOR_DISCOVER";
      if (!(ELIGIBILITY_SUPPORTED_MODES as readonly string[]).includes(mode)) {
        throw new RecommendationModeUnsupportedError(mode);
      }
      const companyIds = [...new Set(query.companyIds)];
      if (companyIds.length > ELIGIBILITY_BATCH_MAX) {
        throw new EligibilityBatchTooLargeError(companyIds.length);
      }
      const started = performance.now();

      const subject = await ports.investorSubject.investorOrganisationFor(
        query.actor,
      );
      if (subject === null) {
        throw new InvestorSubjectNotResolvedError();
      }
      const investorOrganisationId = subject.investorOrganisationId;

      const [mandate, taxonomyVersion] = await Promise.all([
        ports.mandates.activeMandate({
          tenantId: query.actor.tenantId,
          investorOrganisationId,
          mandateId: query.mandateId ?? null,
        }),
        ports.taxonomyVersions?.currentVersions() ?? Promise.resolve(null),
      ]);
      // A mandate that is not the actor's own can never be FOUND: the port
      // reads under the actor's tenant and organisation, so a foreign id
      // resolves exactly as a missing one.
      const mandateForPolicy: ActiveMandateLookup =
        mandate.kind === "FOUND" &&
        mandate.mandate.investorOrganisationId !== investorOrganisationId
          ? { kind: "NONE" }
          : mandate;

      const context: RecommendationContext = {
        tenantId: query.actor.tenantId,
        investorOrganisationId,
        mode,
        mandateId:
          mandateForPolicy.kind === "FOUND"
            ? mandateForPolicy.mandate.mandateId
            : null,
        taxonomyVersion,
        eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
      };

      if (companyIds.length === 0) {
        return { context, results: [] };
      }

      const facts = await ports.companies.findMany(companyIds);
      const factsById = new Map(facts.map((f) => [f.companyId, f] as const));
      const known = companyIds.filter((id) => factsById.has(id));

      const [classifications, permitted, standings] = await Promise.all([
        ports.classifications.listActive(
          known.map((id) => {
            const f = factsById.get(id);
            return { companyId: id, tenantId: f?.tenantId ?? "" };
          }),
        ),
        ports.discoverability.permittedToView(query.actor, known),
        ports.relationships.standings(investorOrganisationId, known),
      ]);

      const evaluatedAt = clock().toISOString();
      const none: readonly CompanyClassification[] = [];
      const noRelationship: RelationshipStanding = { kind: "NONE" };
      const results = known.map((companyId) => {
        const company = factsById.get(companyId);
        if (company === undefined) {
          throw new Error("company facts vanished between reads");
        }
        return evaluateHardEligibility({
          mode,
          investorOrganisationId,
          mandate: mandateForPolicy,
          company,
          classifications: classifications.get(companyId) ?? none,
          permittedToView: permitted.get(companyId) === true,
          relationship: standings.get(companyId) ?? noRelationship,
          taxonomyVersion,
          evaluatedAt,
        });
      });

      const durationMs = performance.now() - started;
      metrics.duration.record(durationMs, { mode });
      const tally = { ELIGIBLE: 0, INELIGIBLE: 0, UNDETERMINED: 0 };
      for (const r of results) tally[r.decision] += 1;
      for (const [decision, count] of Object.entries(tally)) {
        if (count > 0) metrics.evaluations.add(count, { mode, decision });
      }
      // Safe diagnostics only: counts, versions and duration. No company
      // name, no mandate content, no reason detail per company.
      logger?.debug(
        {
          mode,
          eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
          mandateVersion:
            mandateForPolicy.kind === "FOUND"
              ? mandateForPolicy.mandate.version
              : null,
          requested: companyIds.length,
          evaluated: results.length,
          ...tally,
          durationMs: Math.round(durationMs),
        },
        "hard eligibility evaluated",
      );
      return { context, results };
    },
  };
}
