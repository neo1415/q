import type {
  CompanyScoresDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

import { listOrder } from "./relationships-view";

/**
 * The Pipeline's two score figures per company (owner 2026-10-17: "rank by
 * suitability so I see the best-suited first"). Both come straight from the
 * Q API's `CompanyScoresDto` (ADR 0074); nothing is computed or blended here.
 * Unknown stays unknown: a missing or unscored value is null, shown as "—"
 * and ranked after every known value, never treated as 0.
 */
export type PipelineScores = {
  /** Fit with this investor's mandate, 0-100; null when not scored. */
  readonly suitability: number | null;
  /** FDN InvestIQ on shared evidence, 0-100; null when not scored. */
  readonly investability: number | null;
};

export const UNKNOWN_SCORES: PipelineScores = {
  suitability: null,
  investability: null,
};

/** The figures a row shows, from the DTO the Q API returned (if any). */
export function pipelineScoresOf(
  dto: CompanyScoresDto | undefined | null,
): PipelineScores {
  if (dto === undefined || dto === null) return UNKNOWN_SCORES;
  return {
    suitability:
      dto.suitability !== null && dto.suitability.status === "SCORED"
        ? dto.suitability.score
        : null,
    investability:
      dto.investability.status === "SCORED" ? dto.investability.score : null,
  };
}

/** By company id, for the companies the Q API scored for this reader. */
export function pipelineScoresById(
  dtos: readonly CompanyScoresDto[],
): Readonly<Record<string, PipelineScores>> {
  return Object.fromEntries(
    dtos.map((dto) => [dto.companyId, pipelineScoresOf(dto)]),
  );
}

/**
 * Highest suitability first; unknown after every known value. Ties (and
 * unknowns among themselves) keep the order they came in, so the
 * projection's own order breaks them and paging stays reproducible.
 */
export function rankBySuitability<T>(
  rows: readonly T[],
  suitabilityOf: (row: T) => number | null,
): readonly T[] {
  return rows
    .map((row, at) => ({ row, at, score: suitabilityOf(row) }))
    .toSorted((a, b) => {
      if (a.score === null || b.score === null) {
        if (a.score !== b.score) return a.score === null ? 1 : -1;
        return a.at - b.at;
      }
      return b.score - a.score || a.at - b.at;
    })
    .map(({ row }) => row);
}

/** A company row's scores; undefined for an investor organisation row. */
export function scoreOf(
  scores: Readonly<Record<string, PipelineScores>> | undefined,
  item: RelationshipSummaryDto,
): PipelineScores | undefined {
  if (scores === undefined || item.counterpart.kind !== "COMPANY") {
    return undefined;
  }
  return scores[item.counterpart.id];
}

/**
 * The List layout's order: the projection's own time, then (an investor's
 * default) ranked by Suitability with unknown last. The server reads the
 * first page's details in this same order.
 */
export function listOrdered(
  items: readonly RelationshipSummaryDto[],
  scores: Readonly<Record<string, PipelineScores>> | undefined,
  sort: ListSort,
): readonly RelationshipSummaryDto[] {
  const byTime = items.toSorted(listOrder);
  return sort === "suitability" && scores !== undefined
    ? rankBySuitability(
        byTime,
        (item) => scoreOf(scores, item)?.suitability ?? null,
      )
    : byTime;
}

/** The List layout's two orders: by suitability (investor default) or time. */
export type ListSort = "suitability" | "recent";

/**
 * The List layout's order from the URL: a sort the person chose stays;
 * with none, an investor sees suitability first and a founder (who has no
 * suitability) the latest change first.
 */
export function listSortOf(
  value: string | undefined,
  side: "INVESTOR" | "COMPANY" | "NONE",
): ListSort {
  if (side !== "INVESTOR") return "recent";
  return value === "recent" ? "recent" : "suitability";
}
