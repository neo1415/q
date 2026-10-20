import type {
  FitProfileDto,
  RelationshipSummaryDto,
  SavedRelationshipViewList,
} from "@capital-q/contracts";
import type { RelationshipDigest } from "./relationship-data";
import { RelationshipsBoard } from "./relationships-board";
import {
  RelationshipsEmpty as Empty,
  RelationshipsUnavailable,
} from "./relationships-empty";
import type { ListSort, PipelineScores } from "./pipeline-scores";
import type { CommitmentFact } from "./relationships-view";

/**
 * The Relationships page body (R27; founder critique 2026-10-04). One row
 * per canonical relationship with its one next step (see
 * RelationshipsBoard), or one sentence and one way forward when there is
 * nothing to list. The notices queue ("Needs you") is the CRM Overview's
 * (research 2026-10-15 §3.3), so it is not repeated here.
 */
export function RelationshipsIndex({
  side,
  items,
  unread,
  digests = {},
  now = readClock(),
  fits,
  scores,
  sort,
  commitments,
  layoutHrefs,
  exportScope,
  views,
}: {
  /** The Pipeline's layout switch; absent: none (a preview). */
  readonly layoutHrefs?:
    | { readonly list: string; readonly table: string; readonly board: string }
    | undefined;
  /** The export scope for the whole list; null: unavailable just now. */
  readonly exportScope?: string | null | undefined;
  /** The saved views; null when they could not be read. */
  readonly views?: SavedRelationshipViewList | null | undefined;
  /** Suitability and Investability by company id (investor only). */
  readonly scores?: Readonly<Record<string, PipelineScores>> | undefined;
  /** The list's order; an investor's default is Suitability. */
  readonly sort?: ListSort | undefined;
  /** Commitments waiting on this side, by relationship id (Capital). */
  readonly commitments?: Readonly<Record<string, CommitmentFact>> | undefined;
  /** Fit with the investor's own mandate by company id (ADR 0052; B3). */
  readonly fits?: Readonly<Record<string, FitProfileDto | null>> | undefined;
  readonly side: "INVESTOR" | "COMPANY" | "NONE";
  readonly digests?: Readonly<Record<string, RelationshipDigest>> | undefined;
  readonly items: readonly RelationshipSummaryDto[] | undefined;
  /** R34: unread chat messages per relationship id. */
  readonly unread?: ReadonlyMap<string, number> | undefined;
  readonly now?: number | undefined;
}) {
  if (side === "NONE") {
    return (
      <Empty
        sentence="Relationships belong to a company or an investor organisation. Set yours up, and every relationship it has gathers here."
        href="/welcome"
        action="Set up"
      />
    );
  }
  if (items === undefined) {
    return <RelationshipsUnavailable />;
  }
  if (items.length === 0) {
    return side === "INVESTOR" ? (
      <Empty
        sentence="No relationships yet. Expressing interest in a company from Discover starts one."
        href="/discover"
        action="Open Discover"
      />
    ) : (
      <Empty
        sentence="No investor relationships yet. When an investor expresses interest in your company, it appears here. Investors can only find you once your company is visible."
        href="/company/visibility"
        action="Check visibility"
      />
    );
  }
  return (
    <RelationshipsBoard
      side={side}
      items={items}
      digests={digests}
      unread={Object.fromEntries(unread ?? new Map<string, number>())}
      now={now}
      fits={fits}
      scores={scores}
      sort={sort}
      commitments={commitments}
      layoutHrefs={layoutHrefs}
      exportScope={exportScope}
      views={views}
    />
  );
}

function readClock(): number {
  return Date.now();
}
