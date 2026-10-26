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
  ECB_SOURCE,
  MARKET_SOURCE,
  createEcbFxRateProvider,
  createLiveFxRates,
  createMarketFxRateProvider,
  createPostgresFxReferenceRates,
  statedEvidenceFrom,
  type CompanyRaiseReader,
  type EligibilityPorts,
  type EligibilityService,
  type FilterMoney,
  type FitCandidate,
  type FitProfileItem,
  type FitService,
  type FitStatedEvidence,
  type FxReferenceRates,
} from "@capital-q/discovery";

/** How long a read of the stored reference rates is kept (they change daily). */
const FX_KEEP_MS = 10 * 60 * 1000;
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
import { TenantIdSchema, type ActorContext } from "@capital-q/security";

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
    Partial<
      Pick<
        CompanyQueryPort,
        | "findCanonicalCompanyProfile"
        | "findCanonicalCompanyProfiles"
        | "findCanonicalCompanies"
      >
    >;
  readonly capital: Pick<CapitalObjectiveQueryPort, "getCurrentForCompany"> &
    Partial<Pick<CapitalObjectiveQueryPort, "getCurrentForCompanies">>;
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
  /** The same, for many companies in one read (one findability check). */
  readonly deckViews?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, CompanyDeckView | null>>)
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
      // Coordinator 2026-10-26: the decks of the companies shown are read
      // together, so the investor's findability is asked once, not per deck.
      dependencies.deckViews !== undefined
        ? dependencies.deckViews(actor, companyIds).then(
            (views) =>
              companyIds.map((companyId) => views.get(companyId) ?? null),
            () => companyIds.map(() => null),
          )
        : Promise.all(
            companyIds.map((companyId) =>
              dependencies.deckView === undefined
                ? Promise.resolve(null)
                : dependencies.deckView(actor, companyId).catch(() => null),
            ),
          ),
    ]);
    const out = new Map<string, FitStatedEvidence>();
    companyIds.forEach((companyId, index) => {
      const raiseView = raises?.get(companyId);
      const said = statedEvidenceFrom({
        raise: raiseView ?? null,
        deck: decks[index] ?? null,
      });
      // Coordinator 2026-10-26: the raise view read here is the one the
      // fit tool's cards show, so it is kept rather than read again. A
      // failed read keeps none, and the tool reads it itself.
      if (
        said.statedRound !== null ||
        said.evidence.length > 0 ||
        raiseView !== undefined
      ) {
        out.set(
          companyId,
          raiseView === undefined ? said : { ...said, raiseView },
        );
      }
    });
    return out;
  };

  const cards = createPostgresPublicIdentityRepository();
  // Owner 23 Oct 2026: "if you don't know something, go to the internet
  // and find it." The current exchange rates: stored when fresh, otherwise
  // fetched now (the ECB's reference rates, then the public market feed
  // for currencies the ECB does not publish) and stored for everyone after.
  // Kept for a few minutes so a feed of fits reads them once.
  const liveFx = createLiveFxRates({
    store: createPostgresFxReferenceRates({ sql: dependencies.sql }),
    providers: [
      { source: ECB_SOURCE, provider: createEcbFxRateProvider({}) },
      { source: MARKET_SOURCE, provider: createMarketFxRateProvider({}) },
    ],
  });
  let fxKept: {
    readonly at: number;
    readonly rates: Promise<readonly FxReferenceRates[]>;
  } | null = null;
  const fxRates = (): Promise<readonly FxReferenceRates[]> => {
    const now = Date.now();
    if (fxKept === null || now - fxKept.at > FX_KEEP_MS) {
      fxKept = { at: now, rates: liveFx.current().catch(() => []) };
    }
    return fxKept.rates;
  };
  /**
   * Owner 2026-10-25 (the network rank took ~18 s): identities, current
   * raises and Q Cards for a batch of companies are each ONE read, never
   * one query per company queued behind the connection pool. A port
   * without the batch read keeps the one-by-one read.
   */
  const identitiesOf = async (companyIds: readonly string[]) => {
    const ids = companyIds.flatMap((raw) => {
      const id = CompanyIdSchema.safeParse(raw);
      return id.success ? [id.data] : [];
    });
    if (ids.length === 0) return [];
    const many = dependencies.companies.findCanonicalCompanies;
    if (many !== undefined) return many(ids);
    return (await Promise.all(ids.map(identity))).filter((c) => c !== null);
  };
  const objectivesOf = async (
    companies: readonly { readonly tenantId: string; readonly id: string }[],
  ) => {
    const many = dependencies.capital.getCurrentForCompanies;
    const pairs = companies.flatMap((c) => {
      const tenantId = TenantIdSchema.safeParse(c.tenantId);
      const companyId = CompanyIdSchema.safeParse(c.id);
      return tenantId.success && companyId.success
        ? [{ tenantId: tenantId.data, companyId: companyId.data }]
        : [];
    });
    if (pairs.length === 0) return [];
    return many !== undefined
      ? many(pairs)
      : (
          await Promise.all(
            pairs.map((p) =>
              dependencies.capital.getCurrentForCompany(
                p.tenantId,
                p.companyId,
              ),
            ),
          )
        ).filter((o) => o !== null);
  };

  const inputs = createFitInputSource({
    fxRates,
    sql: dependencies.sql,
    eligibilityPorts: dependencies.eligibilityPorts,
    identities: async (companyIds, options) => {
      const found = await identitiesOf(companyIds);
      // A ranking reads names only (owner 2026-10-24, egress incident).
      const lines = options?.lines !== false;
      // The company's own one line, only where its profile is classified
      // for the network (or beyond): the fit service asks only for
      // companies eligibility already admitted for this reader, and a
      // private profile's summary is never carried to someone else.
      // Coordinator 2026-10-26 (live trace): one read for the companies
      // shown, where the port has it; a failed read is no line, as for one.
      const profilesMany = dependencies.companies.findCanonicalCompanyProfiles;
      const profiles =
        lines && profilesMany !== undefined
          ? await profilesMany(
              found.flatMap((c) => (c === null ? [] : [c.id])),
            ).then(
              (rows) => {
                const byId = new Map(rows.map((row) => [row.id, row]));
                return found.map((c) =>
                  c === null ? null : (byId.get(c.id) ?? null),
                );
              },
              () => found.map(() => null),
            )
          : await Promise.all(
              found.map((c) =>
                c === null ||
                !lines ||
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
      const companies = await identitiesOf(companyIds);
      const objectives = (await objectivesOf(companies)).filter(
        (o) => o.status === "ACTIVE",
      );
      if (objectives.length === 0) return out;
      // Owner 23 Oct: a raise the company put on its Q Card reaches every
      // signed-in investor; read through public-identity's own repository,
      // and a failed read is the private answer.
      const cardsBy = await cards
        .findCards(
          dependencies.sql,
          "COMPANY",
          objectives.map((o) => o.companyId),
        )
        .then((found) => new Map(found.map((card) => [card.subjectId, card])))
        .catch(() => null);
      const published = objectives.map(
        (o) =>
          cardsBy !== null &&
          companyCardSharesRaise(cardsBy.get(o.companyId) ?? null),
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
    // One read for every company, as the inputs read their identities.
    companyIdentities: async (ids) =>
      new Map(
        (await identitiesOf(ids)).flatMap((company) =>
          company === null
            ? []
            : [[company.id, { name: company.canonicalName }] as const],
        ),
      ),
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

  return { fit: withRankCache(fit), qViews };
}

/** How long one person's network ranking is reused. */
export const RANK_CACHE_MS = 120_000;
const RANK_CACHE_MAX = 200;

/**
 * Owner 2026-10-24 (egress incident): a ranking over the whole network,
 * the fallback when no slate is servable, is kept for two minutes per
 * person, so the typed, spoken and translated turns of one session do not
 * each read the network again. Keyed by the person (user, tenant,
 * organisation) and the exact companies and limit: never shared between
 * people. A mandate edited in those two minutes is ranked on the next
 * ask after they pass; a failure is never kept.
 */
export function withRankCache(
  fit: FitService,
  clock: () => Date = () => new Date(),
): FitService {
  const rank = fit.rank;
  if (rank === undefined) return fit;
  const kept = new Map<
    string,
    { readonly at: number; readonly result: Awaited<ReturnType<typeof rank>> }
  >();
  return {
    ...fit,
    rank: async (actor, companyIds, limit) => {
      const key = [
        actor.userId,
        actor.tenantId,
        actor.organisationId ?? "",
        String(limit),
        [...new Set(companyIds)].sort().join(","),
      ].join("|");
      const now = clock().getTime();
      const hit = kept.get(key);
      if (hit !== undefined && now - hit.at < RANK_CACHE_MS) {
        // Its phases were another call's: a hit says it was one.
        return hit.result.kind === "OK"
          ? { ...hit.result, phasesMs: { cacheHit: 0 } }
          : hit.result;
      }
      const result = await rank(actor, companyIds, limit);
      if (result.kind === "OK") {
        kept.delete(key);
        kept.set(key, { at: now, result });
        // Bounded: the oldest goes first.
        for (const old of kept.keys()) {
          if (kept.size <= RANK_CACHE_MAX) break;
          kept.delete(old);
        }
      }
      return result;
    },
  };
}
