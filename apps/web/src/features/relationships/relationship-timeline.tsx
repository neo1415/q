import type { RelationshipStatusDto } from "@capital-q/contracts";

import {
  formatRelationshipDate,
  milestoneSentence,
  type RelationshipSide,
  visibilityWords,
} from "./relationship-words";
import { timelineRuns } from "./timeline-runs";

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
  const runs = timelineRuns(milestones);
  return (
    <ol
      aria-label="What happened"
      className="flex max-w-(--cq-layout-reading) flex-col"
    >
      {runs.map((run, index) => {
        const first = run.steps[0];
        if (first === undefined) return null;
        const last = run.steps[run.steps.length - 1] ?? first;
        return (
          <li
            key={`${index}-${first.state}-${first.at}`}
            className="relative flex gap-3 pb-5 last:pb-0"
            data-milestone={first.state}
          >
            {/* The line and dot are decoration; the text carries everything. */}
            <span
              aria-hidden="true"
              className="relative flex w-3 shrink-0 justify-center"
            >
              <span className="mt-1.5 size-2 rounded-full border border-(--cq-border-strong) bg-(--cq-surface)" />
              {index < runs.length - 1 ? (
                <span className="absolute top-4 bottom-[-0.25rem] w-px bg-(--cq-border)" />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <time
                dateTime={first.at}
                className="cq-caption cq-numeric text-(--cq-text-tertiary)"
              >
                {formatRelationshipDate(first.at)}
              </time>
              <span className="cq-body text-(--cq-text-primary)">
                {milestoneSentence(first.state, side, counterpart)}
              </span>
              {run.steps.slice(1).map((step) => (
                <span
                  key={step.state}
                  className="cq-body text-(--cq-text-primary)"
                >
                  Then: {milestoneSentence(step.state, side, counterpart)}
                </span>
              ))}
              {run.times > 1 ? (
                <span className="cq-caption cq-numeric text-(--cq-text-secondary)">
                  {run.steps.length > 1
                    ? `This back-and-forth happened ${run.times} times that day.`
                    : `Happened ${run.times} times that day.`}
                </span>
              ) : null}
              <span className="cq-caption text-(--cq-text-secondary)">
                {visibilityWords(last.state, counterpart)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
