import { createHash } from "node:crypto";

import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import { CompanyIdSchema, type CompanyQueryPort } from "@capital-q/companies";
import type {
  CompanyDeckView,
  QViewDto,
  UnicornPotentialDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  createFitInputSource,
  createFitService,
  statedEvidenceFrom,
  type CompanyRaiseReader,
  type EligibilityPorts,
  type EligibilityService,
  type FilterMoney,
  type FitCandidate,
  type FitProfileItem,
  type FitService,
  type FitStatedEvidence,
} from "@capital-q/discovery";
import type { Logger } from "@capital-q/observability";
import {
  actorPrincipal,
  type DisclosureAccessService,
} from "@capital-q/permissions";
import {
  companyCardSharesRaise,
  createPostgresPublicIdentityRepository,
} from "@capital-q/public-identity";
import type { FitQViewer } from "@capital-q/q-specialists";
import {
  createPostgresInvestabilityStore,
  INVESTABILITY_METHOD_VERSION,
} from "@capital-q/readiness";
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
  readonly unicornPotential?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, UnicornPotentialDto>>)
    | undefined;
  readonly eligibilityPorts: EligibilityPorts;
  readonly eligibility: Pick<EligibilityService, "evaluate">;
  readonly companies: Pick<CompanyQueryPort, "findCanonicalCompany"> &
    Partial<Pick<CompanyQueryPort, "findCanonicalCompanyProfile">>;
  readonly capital: Pick<CapitalObjectiveQueryPort, "getCurrentForCompany">;
  readonly disclosure: Pick<DisclosureAccessService, "evaluateMany">;
  readonly relationships: (actor: ActorContext) => Promise<readonly string[]>;
  readonly requests: (actor: ActorContext) => Promise<readonly string[]>;
  readonly feed: Pick<InvestorFeedPort, "page">;
  /**
   * The one raise reader (Discover, profile and Q read the raise from it):
   * a raise said in a pitch this reader may play arrives as PITCH_CLAIM.
   */
  readonly raiseReader?: Pick<CompanyRaiseReader, "raisesFor"> | undefined;
  /** The deck as this reader may see it (investors: confirmed sections only). */
  readonly deckView?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<CompanyDeckView | null>)
    | undefined;
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

  // What each company STATED where this reader may see it: context beside
  // the fit and evidence for Q's view, never a scored input (fit/stated.ts).
  // Both reads are the reader's own; a failed read is simply no statement.
  const stated = async (
    actor: ActorContext,
    companyIds: readonly string[],
  ): Promise<ReadonlyMap<string, FitStatedEvidence>> => {
    const [raises, decks] = await Promise.all([
      dependencies.raiseReader === undefined
        ? Promise.resolve(null)
        : dependencies.raiseReader
            .raisesFor(actor, companyIds)
            .catch(() => null),
      Promise.all(
        companyIds.map((companyId) =>
          dependencies.deckView === undefined
            ? Promise.resolve(null)
            : dependencies.deckView(actor, companyId).catch(() => null),
        ),
      ),
    ]);
    const out = new Map<string, FitStatedEvidence>();
    companyIds.forEach((companyId, index) => {
      const said = statedEvidenceFrom({
        raise: raises?.get(companyId) ?? null,
        deck: decks[index] ?? null,
      });
      if (said.statedRound !== null || said.evidence.length > 0) {
        out.set(companyId, said);
      }
    });
    return out;
  };

  const cards = createPostgresPublicIdentityRepository();
  const inputs = createFitInputSource({
    sql: dependencies.sql,
    eligibilityPorts: dependencies.eligibilityPorts,
    identities: async (companyIds) => {
      const found = await Promise.all(companyIds.map(identity));
      // The company's own one line, only where its profile is classified
      // for the network (or beyond): the fit service asks only for
      // companies eligibility already admitted for this reader, and a
      // private profile's summary is never carried to someone else.
      const profiles = await Promise.all(
        found.map((c) =>
          c === null ||
          dependencies.companies.findCanonicalCompanyProfile === undefined
            ? Promise.resolve(null)
            : dependencies.companies
                .findCanonicalCompanyProfile(c.id)
                .catch(() => null),
        ),
      );
      return new Map(
        found.flatMap((c, index) => {
          if (c === null) return [];
          const profile = profiles[index] ?? null;
          const shared =
            profile !== null &&
            (profile.marketplaceVisibility === "network_visible" ||
              profile.marketplaceVisibility === "public_external");
          return [
            [
              c.id,
              {
                name: c.canonicalName,
                shortDescription: shared ? profile.shortDescription : null,
              },
            ] as const,
          ];
        }),
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
      // Owner 23 Oct: a raise the company put on its Q Card reaches every
      // signed-in investor; read through public-identity's own repository,
      // and a failed read is the private answer.
      const published = await Promise.all(
        objectives.map((o) =>
          cards
            .findCard(dependencies.sql, {
              subjectType: "COMPANY",
              subjectId: o.companyId,
            })
            .then(companyCardSharesRaise)
            .catch(() => false),
        ),
      );
      // Otherwise the raise is founder_private until shared: ask for THIS
      // reader.
      const asked = objectives.filter((_, index) => published[index] !== true);
      const decisions =
        asked.length === 0
          ? []
          : await dependencies.disclosure.evaluateMany(
              asked.map((o) => ({
                principal: actorPrincipal(actor),
                resource: { type: "capital_objective" as const, id: o.id },
                requestedAccess: "view" as const,
              })),
            );
      const disclosed = new Set(
        asked
          .filter((_, index) => decisions[index]?.outcome === "ALLOW")
          .map((o) => o.id),
      );
      objectives.forEach((o, index) => {
        if (published[index] === true || disclosed.has(o.id)) {
          out.set(o.companyId, {
            amount: o.target.amount,
            currency: o.target.currency,
          });
        }
      });
      return out;
    },
    stated,
  });

  const quiet = <T>(label: string, work: Promise<readonly T[]>) =>
    work.catch((error: unknown) => {
      dependencies.logger?.warn(
        { err: error, source: label },
        "fit candidates unavailable",
      );
      return [] as readonly T[];
    });

  // 2026-10-16: Investability (InvestIQ) from the investor-eligible
  // projection, read only for companies the fit service already admitted.
  const investabilityStore = createPostgresInvestabilityStore({
    sql: dependencies.sql,
  });
  const fit = createFitService({
    companyIdentities: async (ids) => {
      const found = await Promise.all(ids.map(identity));
      return new Map(
        found.flatMap((company) =>
          company === null
            ? []
            : [[company.id, { name: company.canonicalName }] as const],
        ),
      );
    },
    unicornPotential: dependencies.unicornPotential,
    investability: (companyIds) =>
      investabilityStore.current(companyIds, INVESTABILITY_METHOD_VERSION),
    investabilityMethodVersion: INVESTABILITY_METHOD_VERSION,
    investorSubject: dependencies.eligibilityPorts.investorSubject,
    eligibility: dependencies.eligibility,
    inputs,
    // F5 (2026-10-08): a network-shared real company nobody has joined.
    unclaimedPublic: async (companyIds) => {
      const rows = await dependencies.sql<{ id: string }[]>`
        select c.id
          from core.companies c
         where c.id = any(${[...companyIds]}::uuid[])
           and c.company_status = 'active'
           and c.marketplace_visibility in ('network_visible', 'public_external')
           and not exists (select 1 from identity.organisation_memberships m
                            where m.organisation_id = c.organisation_id
                              and m.membership_status = 'active')`;
      return new Set(rows.map((row) => row.id));
    },
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
            item.evidence ?? [],
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
        evidence: item.evidence ?? [],
        ...(item.evidenceConfidential === true
          ? { sensitivity: "CONFIDENTIAL" as const }
          : {}),
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
