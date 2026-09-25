import type { RelationshipStatusDto } from "@capital-q/contracts";

import {
  formatRelationshipDate,
  milestoneSentence,
  type RelationshipSide,
  visibilityWords,
} from "./relationship-words";

/**
 * What happened, in order (CQ-WEB-030; doc 17 §84; spec §12.5).
 *
 * The milestones are the per-party fold of the relationship's history, so
 * each side's timeline holds only what that side may see: a company's
 * starts at the investor's interest, never at their private discovery.
 * Each entry is dated and says, in words, who can see it. A hairline and
 * a small mark per entry -- no card, no colour carrying meaning.
 */
export function RelationshipTimeline({
  milestones,
  side,
  counterpart,
}: {
  readonly milestones: RelationshipStatusDto["milestones"];
  readonly side: RelationshipSide;
  readonly counterpart: string;
}) {
  return (
    <ol
      aria-label="What happened"
      className="flex max-w-(--cq-layout-reading) flex-col"
    >
      {milestones.map((milestone, index) => (
        <li
          key={`${milestone.state}-${milestone.at}`}
          className="relative flex gap-3 pb-5 last:pb-0"
          data-milestone={milestone.state}
        >
          {/* The line and dot are decoration; the text carries everything. */}
          <span
            aria-hidden="true"
            className="relative flex w-3 shrink-0 justify-center"
          >
            <span className="mt-1.5 size-2 rounded-full border border-(--cq-border-strong) bg-(--cq-surface)" />
            {index < milestones.length - 1 ? (
              <span className="absolute top-4 bottom-[-0.25rem] w-px bg-(--cq-border)" />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <time
              dateTime={milestone.at}
              className="cq-caption cq-numeric text-(--cq-text-tertiary)"
            >
              {formatRelationshipDate(milestone.at)}
            </time>
            <span className="cq-body text-(--cq-text-primary)">
              {milestoneSentence(milestone.state, side, counterpart)}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {visibilityWords(milestone.state, counterpart)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
