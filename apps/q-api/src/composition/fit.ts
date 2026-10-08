import { createHash } from "node:crypto";

import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";
import type { QViewDto } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  createFitInputSource,
  createFitService,
  type EligibilityPorts,
  type EligibilityService,
  type FilterMoney,
  type FitCandidate,
  type FitProfileItem,
  type FitService,
} from "@capital-q/discovery";
import type { Logger } from "@capital-q/observability";
import {
  actorPrincipal,
  type DisclosureAccessService,
} from "@capital-q/permissions";
import type { FitQViewer } from "@capital-q/q-specialists";
import type { InvestorFeedPort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * Fit with the investor's own mandate, composed for the Q API (B1-B3;
 * ADR 0052): the fit service over the slate read pipeline's eligibility,
 * the investor's own candidates (relationships, company requests, feed),
 * and Q's view beside it, cached.
 *
 * Every port here is the reader's: the raise only where disclosure lets
 * THIS actor view the capital objective (it is founder_private until
 * shared), names only for companies eligibility already admitted.
 */

export type FitQViews = {
  readonly viewFor: (input: {
    readonly actor: ActorContext;
    readonly item: FitProfileItem;
    readonly correlationId: string;
  }) => Promise<QViewDto>;
};

export type FitCompositionDependencies = {
  readonly sql: DatabaseExecutor;
  readonly eligibilityPorts: EligibilityPorts;
  readonly eligibility: Pick<EligibilityService, "evaluate">;
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompany">;
  readonly capital: Pick<CapitalObjectiveQueryPort, "getCurrentForCompany">;
  readonly disclosure: Pick<DisclosureAccessService, "evaluateMany">;
  readonly relationships: (actor: ActorContext) => Promise<readonly string[]>;
  readonly requests: (actor: ActorContext) => Promise<readonly string[]>;
  readonly feed: Pick<InvestorFeedPort, "page">;
  readonly viewer: FitQViewer;
  readonly logger?: Logger | undefined;
};

const FEED_CANDIDATES = 20;
const Q_VIEW_CACHE_MAX = 500;

export function createFitComposition(
  dependencies: FitCompositionDependencies,
): {
  readonly fit: FitService;
  readonly qViews: FitQViews;
} {
  const identity = async (raw: string) => {
    const id = CompanyIdSchema.safeParse(raw);
    return id.success
      ? dependencies.companies.findCanonicalCompany(id.data)
      : null;
  };

  const inputs = createFitInputSource({
    sql: dependencies.sql,
    eligibilityPorts: dependencies.eligibilityPorts,
    identities: async (companyIds) => {
      const found = await Promise.all(companyIds.map(identity));
      return new Map(
        found
          .filter((c) => c !== null)
          .map((c) => [
            c.id,
            // The fit service asks only for companies eligibility already
            // admitted for this reader; the one line is the company's own
            // declared summary, shown wherever its name is.
            {
              name: c.canonicalName,
              shortDescription: c.shortDescription,
            },
          ]),
      );
    },
    raises: async (actor, companyIds) => {
      const out = new Map<string, FilterMoney>();
      const companies = (await Promise.all(companyIds.map(identity))).filter(
        (c) => c !== null,
      );
      const objectives = (
        await Promise.all(
          companies.map((c) =>
            dependencies.capital.getCurrentForCompany(c.tenantId, c.id),
          ),
        )
      ).filter(
        (o): o is NonNullable<typeof o> => o !== null && o.status === "ACTIVE",
      );
      if (objectives.length === 0) return out;
      // The raise is founder_private until shared: ask for THIS reader.
      const decisions = await dependencies.disclosure.evaluateMany(
        objectives.map((o) => ({
          principal: actorPrincipal(actor),
          resource: { type: "capital_objective" as const, id: o.id },
          requestedAccess: "view" as const,
        })),
      );
      objectives.forEach((o, index) => {
        if (decisions[index]?.outcome === "ALLOW") {
          out.set(o.companyId, {
            amount: o.target.amount,
            currency: o.target.currency,
          });
        }
      });
      return out;
    },
  });

  const quiet = <T>(label: string, work: Promise<readonly T[]>) =>
    work.catch((error: unknown) => {
      dependencies.logger?.warn(
        { err: error, source: label },
        "fit candidates unavailable",
      );
      return [] as readonly T[];
    });

  const fit = createFitService({
    investorSubject: dependencies.eligibilityPorts.investorSubject,
    eligibility: dependencies.eligibility,
    inputs,
    candidates: async (actor) => {
      const [relationships, requests, feed] = await Promise.all([
        quiet("relationships", dependencies.relationships(actor)),
        quiet("requests", dependencies.requests(actor)),
        dependencies.feed
          .page(actor, FEED_CANDIDATES)
          .then((page) => page?.items.map((i) => i.companyId) ?? [])
          .catch(() => [] as string[]),
      ]);
      const out: FitCandidate[] = [
        ...relationships.map((companyId) => ({
          companyId,
          source: "RELATIONSHIP" as const,
        })),
        ...requests.map((companyId) => ({
          companyId,
          source: "REQUEST" as const,
        })),
        ...feed.map((companyId) => ({ companyId, source: "FEED" as const })),
      ];
      return out;
    },
    logger: dependencies.logger,
  });

  // Q's view is cached per investor organisation and per exact profile
  // (its rows, band and config; never its timestamp), so a changed fit
  // gets a fresh view and an unchanged one costs nothing.
  const cache = new Map<string, QViewDto>();
  const qViews: FitQViews = {
    viewFor: async ({ actor, item, correlationId }) => {
      const subject =
        await dependencies.eligibilityPorts.investorSubject.investorOrganisationFor(
          actor,
        );
      const profile = item.assessment.profile;
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            subject?.investorOrganisationId ?? actor.userId,
            item.name,
            item.line,
            { ...profile, computedAt: "" },
          ]),
        )
        .digest("hex");
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const view = await dependencies.viewer.view({
        tenantId: actor.tenantId,
        userId: actor.userId,
        correlationId,
        companyName: item.name,
        companyLine: item.line,
        profile,
      });
      // An unavailable view is not cached: the next open may succeed.
      if (view.status === "READY") {
        if (cache.size >= Q_VIEW_CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, view);
      }
      return view;
    },
  };

  return { fit, qViews };
}
