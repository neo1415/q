import {
  ContractValidationError,
  type DiscoverFilterDimension,
  type DiscoverFilters,
} from "@capital-q/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  ELIGIBILITY_BATCH_MAX,
  ELIGIBILITY_POLICY_VERSION,
} from "../eligibility/contracts.js";
import {
  excludingRules,
  unverifiableHardExclusions,
  unverifiedExclusions,
} from "../eligibility/policy.js";
import type { EligibilityPorts } from "../eligibility/ports.js";
import type { EligibilityService } from "../eligibility/service.js";
import { RANKING_CONFIG_CURRENT } from "../ranking/config.js";
import type { ProactiveSuppressionPort } from "../rerank/suppression.js";
import {
  decodeSlateCursor,
  encodeSlateCursor,
  SLATE_POLICY_V1,
  type RecommendationItem,
  type RecommendationSlate,
  type SlatePolicy,
} from "./contracts.js";
import type {
  CompanyCard,
  CompanyCardPort,
  DiscoverablePoolPort,
  SlateKey,
  SlateRepository,
} from "./ports.js";
import {
  activeFilters,
  discoverFiltersFingerprint,
  evaluateDiscoverFilters,
  raiseFilterActive,
  type DiscoverFilterFactsPort,
} from "./filters.js";
import type { RefreshRequester } from "./refresh.js";

/**
 * Serving a persisted slate (CQ-REC-006 Checkpoint D; doc 19 §65, doc 20
 * §78–§81).
 *
 *   actor → investor organisation + ACTIVE mandate → the CURRENT slate
 *   → one page of items after the cursor's rank
 *   → the read-time safety guard: REC-001 re-evaluated for this actor, now
 *   → pass suppression: what this organisation has dismissed (REC-009R)
 *   → the companies' declared cards → the page, with a continuation key
 *
 * A cursor is a position, never authority: every page re-resolves the
 * actor, checks the slate is theirs and servable, and re-checks each
 * company's eligibility and disclosure at read time. What a slate stored
 * an hour ago is an ordering; whether the company may be shown is decided
 * now. Nothing internal reaches the page: no score, no snapshot, no
 * provenance, no mandate field.
 *
 * Both withholdings work the same way and for the same reason. A slate is
 * built at most once per TTL, so anything that can change in between —
 * a revoked grant, a company leaving the marketplace, an investor passing
 * on something — has to be checked here or it is checked too late. A
 * withheld company leaves a shorter page and is never replaced, because
 * substituting would make the page's contents depend on what was hidden.
 */

/** Reason codes a page may carry: declared alignment, never missingness. */
export const PUBLIC_REASON_CODES: readonly string[] = [
  "STAGE_ALIGNED",
  "GEOGRAPHY_COUNTRY_ALIGNED",
  "GEOGRAPHY_REGION_ALIGNED",
  "TAXONOMY_EXACT",
  "TAXONOMY_RELATED",
  "SEMANTIC_SIMILARITY_PRESENT",
];

export const SLATE_PAGE_NOTES = [
  "NO_ACTIVE_MANDATE",
  /** Nothing is discoverable to this investor at all. */
  "NO_DISCOVERABLE_COUNTERPARTS",
  /** Companies are discoverable, and every one is removed by a declared hard rule (`excludingRules`). */
  "NONE_PASS_HARD_RULES",
  /** Companies are discoverable and pass the hard rules, but none matched what the mandate asks for. */
  "NONE_MATCH_MANDATE",
  /** No servable slate yet; a rebuild has been requested. */
  "RECOMMENDATIONS_REFRESHING",
  /** The cursor's slate is no longer servable; this page starts the current one. */
  "SLATE_RESTARTED",
  /** The reader's Discover filters left nothing in the slate. */
  "NONE_MATCH_FILTERS",
] as const;
export type SlatePageNote = (typeof SLATE_PAGE_NOTES)[number];

export type SlatePageItem = CompanyCard & {
  readonly reasonCodes: readonly string[];
  /**
   * Declared exclusions this company's own facts could not answer (ADR
   * 0020), as rule codes (`stage`, `geography.country`, `taxonomy`). The
   * company is shown; the investor is told the rule was not checked.
   */
  readonly unverifiedExclusions: readonly string[];
  /**
   * Filters the reader applied that this company's facts could not answer
   * (kept, never silently excluded). Absent when no filter was applied.
   */
  readonly filterUnknown?: readonly DiscoverFilterDimension[] | undefined;
};

export type SlatePage = {
  /** Null when nothing servable exists yet. */
  readonly slateId: string | null;
  readonly rankingVersion: string;
  readonly items: readonly SlatePageItem[];
  readonly notes: readonly SlatePageNote[];
  readonly nextCursor: string | null;
  /**
   * Declared hard exclusions V1 cannot evaluate for any company (e.g.
   * `red_flag`), said once per page rather than on every card. They
   * withhold nothing (ADR 0020).
   */
  readonly unverifiableExclusions: readonly string[];
  /** With NONE_PASS_HARD_RULES: the declared rules that removed every company. */
  readonly excludingRules: readonly string[];
  /** How many companies are discoverable to this investor; null when not counted. */
  readonly discoverableCount: number | null;
};

export type PageCompaniesQuery = {
  readonly actor: ActorContext;
  readonly mandateId?: string | null | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | null | undefined;
  /**
   * The reader's Discover filters: they narrow this page at read time and
   * never re-rank. The cursor carries their fingerprint; a request whose
   * filters differ from its cursor's starts from the first page.
   */
  readonly filters?: DiscoverFilters | null | undefined;
};

export type SlateReadService = {
  readonly pageCompanies: (query: PageCompaniesQuery) => Promise<SlatePage>;
};

/** The cursor was not issued by this server for this actor. A 400, never a hint. */
export class SlateCursorRejectedError extends Error {
  constructor() {
    super("The cursor is not one this server issued for you.");
    this.name = "SlateCursorRejectedError";
  }
}

export type SlateReadServiceDependencies = {
  readonly ports: Pick<EligibilityPorts, "investorSubject" | "mandates">;
  readonly eligibility: EligibilityService;
  /**
   * REC-009R. Required: a reader composed without it would serve companies
   * this organisation has already dismissed, which is precisely the defect
   * it exists to close.
   */
  readonly suppression: ProactiveSuppressionPort;
  readonly slates: SlateRepository;
  readonly cards: CompanyCardPort;
  /**
   * Required: without it an empty slate cannot say *why* it is empty, and
   * "nobody is discoverable" was shown to an investor whose rules had
   * removed twelve discoverable companies.
   */
  readonly pool: DiscoverablePoolPort;
  /**
   * The facts Discover filters need beyond the declared card (sector,
   * a raise shared with this reader, verification, a pitch). Absent, a
   * filter on them treats the fact as unknown.
   */
  readonly filterFacts?: DiscoverFilterFactsPort | undefined;
  /** When present, a missing or expired slate asks for a rebuild. */
  readonly requester?: RefreshRequester | undefined;
  readonly policy?: SlatePolicy | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

const MODE = "INVESTOR_DISCOVER" as const;

function servable(slate: RecommendationSlate, now: Date): boolean {
  return (
    (slate.status === "CURRENT" || slate.status === "SUPERSEDED") &&
    slate.expiresAt !== null &&
    Date.parse(slate.expiresAt) > now.getTime()
  );
}

export function createSlateReadService(
  dependencies: SlateReadServiceDependencies,
): SlateReadService {
  const {
    ports,
    eligibility,
    suppression,
    slates,
    cards,
    pool,
    requester,
    logger,
  } = dependencies;
  const filterFacts = dependencies.filterFacts ?? {};
  const policy = dependencies.policy ?? SLATE_POLICY_V1;
  const clock = dependencies.clock ?? (() => new Date());
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    pages: meter.createCounter("discovery.slates.pages"),
    served: meter.createHistogram("discovery.slates.page_items"),
    guarded: meter.createHistogram("discovery.slates.page_items_withheld"),
  };

  const empty = (
    notes: readonly SlatePageNote[],
    slateId: string | null = null,
    extra: Partial<
      Pick<
        SlatePage,
        "unverifiableExclusions" | "excludingRules" | "discoverableCount"
      >
    > = {},
  ): SlatePage => ({
    slateId,
    rankingVersion: RANKING_CONFIG_CURRENT.version,
    items: [],
    notes,
    nextCursor: null,
    unverifiableExclusions: extra.unverifiableExclusions ?? [],
    excludingRules: extra.excludingRules ?? [],
    discoverableCount: extra.discoverableCount ?? null,
  });

  /**
   * Why a first page is empty, truthfully (ADR 0020). In order: nothing is
   * discoverable; the slate predates a change in what is discoverable (or
   * the policy that built it), so it is rebuilt rather than believed; every
   * discoverable company is removed by a declared hard rule, named; or they
   * pass the rules and none matched the mandate. Never the wrong one.
   */
  const classifyEmpty = async (input: {
    readonly key: SlateKey;
    readonly investorOrganisationId: string;
    readonly actor: ActorContext;
    readonly slate: RecommendationSlate;
    readonly outdatedPolicy: boolean;
    readonly notes: readonly SlatePageNote[];
  }): Promise<
    Pick<SlatePage, "notes" | "excludingRules" | "discoverableCount">
  > => {
    const summary = await pool.summary({
      excludeOrganisationId: input.investorOrganisationId,
      sample: ELIGIBILITY_BATCH_MAX,
    });
    const say = (
      note: SlatePageNote,
      rules: readonly string[] = [],
    ): Pick<SlatePage, "notes" | "excludingRules" | "discoverableCount"> => ({
      notes: [...input.notes, note],
      excludingRules: rules,
      discoverableCount: summary.discoverable,
    });
    if (summary.discoverable === 0) return say("NO_DISCOVERABLE_COUNTERPARTS");

    const stale =
      input.outdatedPolicy ||
      (summary.latestChangeAt !== null &&
        Date.parse(summary.latestChangeAt) >
          Date.parse(input.slate.generatedAt));
    if (stale && requester !== undefined) {
      await requester.request({
        ...input.key,
        reason: "SLATE_EXPIRED",
        priority: "HIGH",
      });
      return say("RECOMMENDATIONS_REFRESHING");
    }

    const evaluation = await eligibility.evaluate({
      actor: input.actor,
      mode: MODE,
      mandateId: input.key.mandateId,
      companyIds: summary.sampleCompanyIds,
    });
    if (evaluation.results.some((r) => r.decision === "ELIGIBLE")) {
      return say("NONE_MATCH_MANDATE");
    }
    const rules = [
      ...new Set(evaluation.results.flatMap((r) => excludingRules(r))),
    ].sort();
    return rules.length > 0
      ? say("NONE_PASS_HARD_RULES", rules)
      : say("NO_DISCOVERABLE_COUNTERPARTS");
  };

  /**
   * The read-time guards for a run of slate items, in rank order: REC-001
   * for this actor, what this organisation has passed on, and a declared
   * card. Withheld companies leave a gap, never a substitute.
   */
  const guard = async (input: {
    readonly actor: ActorContext;
    readonly key: SlateKey;
    readonly mandateVersion: number;
    readonly items: readonly RecommendationItem[];
  }): Promise<{
    readonly items: readonly (SlatePageItem & { readonly rank: number })[];
    readonly suppressed: number;
  }> => {
    const companyIds = input.items.map((i) => i.companyId);
    const [evaluation, suppressedIds] = await Promise.all([
      eligibility.evaluate({
        actor: input.actor,
        mode: MODE,
        mandateId: input.key.mandateId,
        companyIds,
      }),
      suppression.suppressedCompanyIds({
        tenantId: input.key.tenantId,
        investorOrganisationId: input.key.investorOrganisationId,
        mandateId: input.key.mandateId,
        mandateVersion: input.mandateVersion,
        companyIds,
      }),
    ]);
    const resultById = new Map(
      evaluation.results.map((r) => [r.companyId, r] as const),
    );
    const eligibleIds = new Set(
      evaluation.results
        .filter((r) => r.decision === "ELIGIBLE")
        .map((r) => r.companyId),
    );
    // A passed company stays in the slate, so the ordering remains
    // reproducible and the history remains auditable; it simply is not
    // offered again. The tail of a slate is still reachable, which is
    // why demotion alone was not suppression (REC-009R).
    const shown = input.items.filter(
      (i) => eligibleIds.has(i.companyId) && !suppressedIds.has(i.companyId),
    );
    const cardById = await cards.cardsByIds(shown.map((i) => i.companyId));
    const items: (SlatePageItem & { readonly rank: number })[] = [];
    for (const item of shown) {
      const card = cardById.get(item.companyId);
      // A company without a declared card is withheld, not invented.
      if (card === undefined) continue;
      const result = resultById.get(item.companyId);
      items.push({
        ...card,
        rank: item.rank,
        reasonCodes: item.reasonCodes.filter((code) =>
          PUBLIC_REASON_CODES.includes(code),
        ),
        unverifiedExclusions:
          result === undefined ? [] : unverifiedExclusions(result),
      });
    }
    return { items, suppressed: suppressedIds.size };
  };

  /** The filters' verdict on guarded items, in rank order; ranks unchanged. */
  const applyFilters = async (input: {
    readonly actor: ActorContext;
    readonly filters: DiscoverFilters;
    readonly items: readonly (SlatePageItem & { readonly rank: number })[];
  }): Promise<ReadonlyMap<string, SlatePageItem>> => {
    const { filters, actor } = input;
    const ids = input.items.map((i) => i.companyId);
    const out = new Map<string, SlatePageItem>();
    if (ids.length === 0) return out;
    const none = <T>(): Promise<T | null> => Promise.resolve(null);
    const [sectors, raises, verified, pitched] = await Promise.all([
      filters.sectorNodeIds.length > 0 && filterFacts.sectors !== undefined
        ? filterFacts.sectors(ids)
        : none<ReadonlyMap<string, readonly string[]>>(),
      raiseFilterActive(filters) && filterFacts.disclosedRaises !== undefined
        ? filterFacts.disclosedRaises({ actor, companyIds: ids })
        : none<ReadonlyMap<string, { amount: string; currency: string }>>(),
      filters.verifiedOnly && filterFacts.verified !== undefined
        ? filterFacts.verified(ids)
        : none<ReadonlySet<string>>(),
      filters.hasPitch && filterFacts.withPitch !== undefined
        ? filterFacts.withPitch(ids)
        : none<ReadonlySet<string>>(),
    ]);
    for (const { rank: _rank, ...item } of input.items) {
      const verdict = evaluateDiscoverFilters(filters, {
        stageCode: item.currentStageCode,
        country: item.headquartersCountry,
        sectorNodeIds:
          sectors === null ? null : (sectors.get(item.companyId) ?? []),
        raise: raises?.get(item.companyId) ?? null,
        verified: verified?.has(item.companyId) ?? false,
        hasPitch: pitched?.has(item.companyId) ?? false,
      });
      if (verdict.pass) {
        out.set(item.companyId, { ...item, filterUnknown: verdict.unknown });
      }
    }
    return out;
  };

  /**
   * A filtered page: scan the slate forward from the cursor in rank order,
   * guard each run of items exactly as an unfiltered page does, keep what
   * the filters pass, and stop at a full page or the slate's end. The scan
   * is bounded by the candidate budget a slate is built from, so one
   * request reads at most one slate's worth of items. The continuation is
   * the last rank considered, with the filters' fingerprint, so the next
   * page resumes the same scan under the same filters.
   */
  const pageFiltered = async (input: {
    readonly actor: ActorContext;
    readonly key: SlateKey;
    readonly mandateVersion: number;
    readonly slate: RecommendationSlate;
    readonly afterRank: number;
    readonly limit: number;
    readonly filters: DiscoverFilters;
    readonly fingerprint: string;
    readonly notes: readonly SlatePageNote[];
    readonly unverifiable: readonly string[];
    readonly outdatedPolicy: boolean;
    readonly investorOrganisationId: string;
  }): Promise<SlatePage> => {
    const { slate, limit } = input;
    const batchSize = Math.min(
      policy.candidatePoolMax,
      ELIGIBILITY_BATCH_MAX,
      Math.max(limit * 3, 30),
    );
    const items: SlatePageItem[] = [];
    let after = input.afterRank;
    let lastConsidered = input.afterRank;
    let scanned = 0;
    let exhausted = false;
    let more = false;
    while (items.length < limit && scanned < policy.candidatePoolMax) {
      const batch = await slates.pageItems({
        slateId: slate.id,
        afterRank: after,
        limit: Math.min(batchSize, policy.candidatePoolMax - scanned),
      });
      if (batch.length === 0) {
        exhausted = true;
        break;
      }
      scanned += batch.length;
      const guarded = await guard({
        actor: input.actor,
        key: input.key,
        mandateVersion: input.mandateVersion,
        items: batch,
      });
      const passed = await applyFilters({
        actor: input.actor,
        filters: input.filters,
        items: guarded.items,
      });
      for (const item of batch) {
        if (items.length === limit) {
          more = true;
          break;
        }
        lastConsidered = item.rank;
        const kept = passed.get(item.companyId);
        if (kept !== undefined) items.push(kept);
      }
      if (more) break;
      const last = batch[batch.length - 1];
      if (last !== undefined) after = last.rank;
      if (batch.length < batchSize) {
        exhausted = true;
        break;
      }
    }
    const nextCursor =
      more || !exhausted
        ? encodeSlateCursor({
            v: 1,
            slateId: slate.id,
            afterRank: lastConsidered,
            f: input.fingerprint,
          })
        : null;

    metrics.pages.add(1, { outcome: items.length > 0 ? "SERVED" : "EMPTY" });
    metrics.served.record(items.length);
    logger?.debug(
      {
        slateId: slate.id,
        afterRank: input.afterRank,
        scanned,
        served: items.length,
        filtered: true,
        restarted: input.notes.includes("SLATE_RESTARTED"),
      },
      "recommendation slate page served (filtered)",
    );
    const base = {
      slateId: slate.id,
      rankingVersion: slate.rankingConfigVersion,
      items,
      nextCursor,
      unverifiableExclusions: input.unverifiable,
      excludingRules: [],
      discoverableCount: null,
    };
    if (items.length > 0 || input.afterRank > 0 || nextCursor !== null) {
      return { ...base, notes: input.notes };
    }
    // An empty first page. When the slate itself is empty, the filters are
    // not the reason: say what is, as an unfiltered page would.
    if (scanned === 0) {
      return {
        ...base,
        ...(await classifyEmpty({
          key: input.key,
          investorOrganisationId: input.investorOrganisationId,
          actor: input.actor,
          slate,
          outdatedPolicy: input.outdatedPolicy,
          notes: input.notes,
        })),
      };
    }
    return { ...base, notes: [...input.notes, "NONE_MATCH_FILTERS"] };
  };

  return {
    pageCompanies: async (query) => {
      const now = clock();
      const limit = Math.max(
        1,
        Math.min(
          policy.pageSizeMax,
          Math.trunc(query.limit ?? policy.pageSizeDefault),
        ),
      );
      // Decode before any read: a malformed cursor costs nothing.
      let cursor;
      if (query.cursor !== undefined && query.cursor !== null) {
        try {
          cursor = decodeSlateCursor(query.cursor);
        } catch (error: unknown) {
          if (error instanceof ContractValidationError) {
            throw new SlateCursorRejectedError();
          }
          throw error;
        }
      }

      const subject = await ports.investorSubject.investorOrganisationFor(
        query.actor,
      );
      if (subject === null) {
        metrics.pages.add(1, { outcome: "NOT_AN_INVESTOR" });
        return empty(["NO_ACTIVE_MANDATE"]);
      }
      const lookup = await ports.mandates.activeMandate({
        tenantId: query.actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
        mandateId: query.mandateId ?? null,
      });
      if (
        lookup.kind !== "FOUND" ||
        lookup.mandate.status !== "ACTIVE" ||
        lookup.mandate.investorOrganisationId !== subject.investorOrganisationId
      ) {
        metrics.pages.add(1, { outcome: "NO_ACTIVE_MANDATE" });
        return empty(["NO_ACTIVE_MANDATE"]);
      }
      const key: SlateKey = {
        tenantId: query.actor.tenantId,
        investorOrganisationId: subject.investorOrganisationId,
        mandateId: lookup.mandate.mandateId,
        mode: MODE,
      };

      const unverifiable = unverifiableHardExclusions(lookup.mandate);
      const filters = activeFilters(query.filters);
      const fingerprint =
        filters === null ? undefined : discoverFiltersFingerprint(filters);
      const notes: SlatePageNote[] = [];
      let slate: RecommendationSlate | null = null;
      let afterRank = 0;
      if (cursor !== undefined) {
        const named = await slates.findById(cursor.slateId);
        // Somebody else's slate is indistinguishable from a forged cursor.
        if (
          named === null ||
          named.tenantId !== key.tenantId ||
          named.investorOrganisationId !== key.investorOrganisationId ||
          named.mandateId !== key.mandateId ||
          named.mode !== key.mode
        ) {
          throw new SlateCursorRejectedError();
        }
        if (cursor.f !== fingerprint) {
          // Other filters than the scroll was read under: pages would not
          // be consistent, so this one starts from the first page.
          notes.push("SLATE_RESTARTED");
        } else if (servable(named, now)) {
          slate = named;
          afterRank = cursor.afterRank;
        } else {
          // Invalidated, expired or failed under the reader: start again
          // from whatever is current, and say so.
          notes.push("SLATE_RESTARTED");
        }
      }
      if (slate === null) {
        const current = await slates.findCurrent(key);
        if (current !== null && servable(current, now)) {
          slate = current;
        } else {
          if (requester !== undefined) {
            await requester.request({
              ...key,
              reason: current === null ? "NO_CURRENT_SLATE" : "SLATE_EXPIRED",
              priority: "NORMAL",
            });
          }
          metrics.pages.add(1, { outcome: "REFRESHING" });
          return empty([...notes, "RECOMMENDATIONS_REFRESHING"], null, {
            unverifiableExclusions: unverifiable,
          });
        }
      }
      // A slate computed under a superseded eligibility policy is an
      // ordering nobody would compute again: ask for a rebuild. Its items
      // are still re-checked below under the current policy, so a
      // non-empty one keeps serving meanwhile.
      const outdatedPolicy =
        slate.eligibilityPolicyVersion !== ELIGIBILITY_POLICY_VERSION;
      if (outdatedPolicy && afterRank === 0 && requester !== undefined) {
        await requester.request({
          ...key,
          reason: "SLATE_EXPIRED",
          priority: "HIGH",
        });
      }

      if (filters !== null && fingerprint !== undefined) {
        return pageFiltered({
          actor: query.actor,
          key,
          mandateVersion: lookup.mandate.version,
          slate,
          afterRank,
          limit,
          filters,
          fingerprint,
          notes,
          unverifiable,
          outdatedPolicy,
          investorOrganisationId: subject.investorOrganisationId,
        });
      }

      // One more than the page so the continuation is known without a count.
      const fetched = await slates.pageItems({
        slateId: slate.id,
        afterRank,
        limit: limit + 1,
      });
      const pageItems: readonly RecommendationItem[] = fetched.slice(0, limit);
      const last = pageItems[pageItems.length - 1];
      const nextCursor =
        fetched.length > limit && last !== undefined
          ? encodeSlateCursor({ v: 1, slateId: slate.id, afterRank: last.rank })
          : null;

      if (pageItems.length === 0) {
        metrics.pages.add(1, { outcome: "EMPTY" });
        const base = {
          slateId: slate.id,
          rankingVersion: slate.rankingConfigVersion,
          items: [],
          nextCursor,
          unverifiableExclusions: unverifiable,
          excludingRules: [],
          discoverableCount: null,
        };
        if (afterRank > 0) return { ...base, notes };
        return {
          ...base,
          ...(await classifyEmpty({
            key,
            investorOrganisationId: subject.investorOrganisationId,
            actor: query.actor,
            slate,
            outdatedPolicy,
            notes,
          })),
        };
      }

      // The read-time guards: REC-001 for this actor, and what this
      // organisation has passed on, both now and both in one batch.
      // Withheld companies leave a shorter page, never a substitute.
      const guarded = await guard({
        actor: query.actor,
        key,
        mandateVersion: lookup.mandate.version,
        items: pageItems,
      });
      const items: SlatePageItem[] = guarded.items.map(
        ({ rank: _rank, ...item }) => item,
      );
      const suppressedCount = guarded.suppressed;

      metrics.pages.add(1, { outcome: "SERVED" });
      metrics.served.record(items.length);
      metrics.guarded.record(pageItems.length - items.length);
      // Identifiers and counts only.
      logger?.debug(
        {
          slateId: slate.id,
          afterRank,
          fetched: pageItems.length,
          served: items.length,
          withheld: pageItems.length - items.length,
          suppressed: suppressedCount,
          restarted: notes.includes("SLATE_RESTARTED"),
        },
        "recommendation slate page served",
      );
      return {
        slateId: slate.id,
        rankingVersion: slate.rankingConfigVersion,
        items,
        notes,
        nextCursor,
        unverifiableExclusions: unverifiable,
        excludingRules: [],
        discoverableCount: null,
      };
    },
  };
}
