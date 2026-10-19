import type {
  CompanyScoresDto,
  PipelineUnicornSort,
  RelationshipSummaryDto,
  UnicornPotentialDto,
} from "@capital-q/contracts";

import { listOrder } from "./relationships-view";

/**
 * The Pipeline's score figures per company (owner 2026-10-17: "rank by
 * suitability so I see the best-suited first"; 2026-10-18: Unicorn
 * Potential beside them). All come straight from the Q API's
 * `CompanyScoresDto` (ADR 0074); nothing is computed or blended here.
 * Unknown stays unknown: a missing or unscored value is null, shown in
 * words or "—" and ranked after every known value, never treated as 0.
 */
export type PipelineScores = {
  /** Fit with this investor's mandate, 0-100; null when not scored. */
  readonly suitability: number | null;
  /** FDN InvestIQ on shared evidence, 0-100; null when not scored. */
  readonly investability: number | null;
  /**
   * The persisted Unicorn Potential assessment, only when the Q API sent
   * it (premium and visibility, decided server-side). Absent: not shown.
   */
  readonly unicorn?: UnicornCell | undefined;
};

/** What a row needs of the assessment: never its evidence or pillars. */
export type UnicornCell = {
  readonly status: UnicornPotentialDto["status"];
  /** 0-100 only when SCORED. */
  readonly score: number | null;
  /** Weighted evidence coverage (0-1) behind an unscored assessment. */
  readonly coverage?: number | undefined;
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
  const unicorn = dto.unicornPotential;
  return {
    suitability:
      dto.suitability !== null && dto.suitability.status === "SCORED"
        ? dto.suitability.score
        : null,
    investability:
      dto.investability.status === "SCORED" ? dto.investability.score : null,
    ...(unicorn === undefined
      ? {}
      : {
          unicorn: {
            status: unicorn.status,
            score: unicorn.status === "SCORED" ? unicorn.overallScore : null,
            ...(unicorn.status === "INSUFFICIENT_EVIDENCE"
              ? { coverage: unicorn.coverage }
              : {}),
          },
        }),
  };
}

/** Whether the Q API sent this reader any Unicorn Potential (premium). */
export function hasUnicornScores(
  scores: Readonly<Record<string, PipelineScores>> | undefined,
): boolean {
  return (
    scores !== undefined &&
    Object.values(scores).some((entry) => entry.unicorn !== undefined)
  );
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
  return rankByScore(rows, suitabilityOf);
}

/** Highest first, unknown last, ties in the order given (any one score). */
export function rankByScore<T>(
  rows: readonly T[],
  scoreOfRow: (row: T) => number | null,
): readonly T[] {
  return rows
    .map((row, at) => ({ row, at, score: scoreOfRow(row) }))
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
  if (scores === undefined) return byTime;
  if (sort === "suitability") {
    return rankBySuitability(
      byTime,
      (item) => scoreOf(scores, item)?.suitability ?? null,
    );
  }
  return sort === "unicorn" && hasUnicornScores(scores)
    ? rankByScore(
        byTime,
        (item) => scoreOf(scores, item)?.unicorn?.score ?? null,
      )
    : byTime;
}

/**
 * The List layout's orders: by suitability (investor default), by Unicorn
 * Potential (premium), or time.
 */
export type ListSort = "suitability" | "unicorn" | "recent";

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
  return value === "recent"
    ? "recent"
    : value === "unicorn"
      ? "unicorn"
      : "suitability";
}

/** The lowest score each Unicorn view keeps (band edges); null: no floor. */
const UNICORN_FLOOR: Readonly<Record<PipelineUnicornSort, number | null>> = {
  unicorn: null,
  "unicorn-scored": 0,
  "unicorn-40": 40,
  "unicorn-60": 60,
  "unicorn-80": 80,
  "unicorn-insufficient": null,
};

/**
 * A Unicorn Potential view over the reader's whole authorised pipeline,
 * read in the projection's own order: ranked by the persisted score,
 * highest first, ties and unscored rows in the order given. "unicorn"
 * keeps every row (unscored after the scored); a floor keeps scored rows
 * at or above it; "unicorn-insufficient" keeps the rows with no score.
 * Insufficient evidence is never a low score: it only ever sorts last.
 */
export function unicornView<T>(
  rows: readonly T[],
  cellOf: (row: T) => UnicornCell | undefined,
  view: PipelineUnicornSort,
): readonly T[] {
  if (view === "unicorn-insufficient") {
    return rows.filter((row) => {
      const cell = cellOf(row);
      return cell !== undefined && cell.score === null;
    });
  }
  const floor = UNICORN_FLOOR[view];
  const kept =
    floor === null
      ? rows
      : rows.filter((row) => {
          const score = cellOf(row)?.score ?? null;
          return score !== null && score >= floor;
        });
  return rankByScore(kept, (row) => cellOf(row)?.score ?? null);
}
