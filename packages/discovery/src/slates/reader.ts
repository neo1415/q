import { ContractValidationError } from "@capital-q/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { EligibilityPorts } from "../eligibility/ports.js";
import type { EligibilityService } from "../eligibility/service.js";
import { RANKING_CONFIG_V1 } from "../ranking/config.js";
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
  SlateKey,
  SlateRepository,
} from "./ports.js";
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
  "NO_DISCOVERABLE_COUNTERPARTS",
  /** No servable slate yet; a rebuild has been requested. */
  "RECOMMENDATIONS_REFRESHING",
  /** The cursor's slate is no longer servable; this page starts the current one. */
  "SLATE_RESTARTED",
] as const;
export type SlatePageNote = (typeof SLATE_PAGE_NOTES)[number];

export type SlatePageItem = CompanyCard & {
  readonly reasonCodes: readonly string[];
};

export type SlatePage = {
  /** Null when nothing servable exists yet. */
  readonly slateId: string | null;
  readonly rankingVersion: string;
  readonly items: readonly SlatePageItem[];
  readonly notes: readonly SlatePageNote[];
  readonly nextCursor: string | null;
};

export type PageCompaniesQuery = {
  readonly actor: ActorContext;
  readonly mandateId?: string | null | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | null | undefined;
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
  const { ports, eligibility, suppression, slates, cards, requester, logger } =
    dependencies;
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
  ): SlatePage => ({
    slateId,
    rankingVersion: RANKING_CONFIG_V1.version,
    items: [],
    notes,
    nextCursor: null,
  });

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
        if (servable(named, now)) {
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
          return empty([...notes, "RECOMMENDATIONS_REFRESHING"]);
        }
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
        return {
          slateId: slate.id,
          rankingVersion: slate.rankingConfigVersion,
          items: [],
          notes: [
            ...notes,
            ...(afterRank === 0
              ? (["NO_DISCOVERABLE_COUNTERPARTS"] as const)
              : []),
          ],
          nextCursor,
        };
      }

      // The read-time guards: REC-001 for this actor, and what this
      // organisation has passed on, both now and both in one batch.
      // Withheld companies leave a shorter page, never a substitute.
      const companyIds = pageItems.map((i) => i.companyId);
      const [evaluation, suppressedIds] = await Promise.all([
        eligibility.evaluate({
          actor: query.actor,
          mode: MODE,
          mandateId: key.mandateId,
          companyIds,
        }),
        suppression.suppressedCompanyIds({
          tenantId: key.tenantId,
          investorOrganisationId: key.investorOrganisationId,
          mandateId: key.mandateId,
          mandateVersion: lookup.mandate.version,
          companyIds,
        }),
      ]);
      const eligibleIds = new Set(
        evaluation.results
          .filter((r) => r.decision === "ELIGIBLE")
          .map((r) => r.companyId),
      );
      // A passed company stays in the slate, so the ordering remains
      // reproducible and the history remains auditable; it simply is not
      // offered again. The tail of a slate is still reachable, which is
      // why demotion alone was not suppression (REC-009R).
      const shown = pageItems.filter(
        (i) => eligibleIds.has(i.companyId) && !suppressedIds.has(i.companyId),
      );
      const cardById = await cards.cardsByIds(shown.map((i) => i.companyId));
      const items: SlatePageItem[] = [];
      for (const item of shown) {
        const card = cardById.get(item.companyId);
        // A company without a declared card is withheld, not invented.
        if (card === undefined) continue;
        items.push({
          ...card,
          reasonCodes: item.reasonCodes.filter((code) =>
            PUBLIC_REASON_CODES.includes(code),
          ),
        });
      }

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
          suppressed: suppressedIds.size,
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
      };
    },
  };
}
