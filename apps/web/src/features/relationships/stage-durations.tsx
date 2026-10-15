import { cx } from "@capital-q/ui";

import { STATE_WORDS, formatRelationshipDate } from "./relationship-words";
import { durationWords, stageSpans } from "./stage-spans";

/**
 * Time in each stage, as one proportional strip (dataviz: a single
 * part-to-whole bar of real durations). Segments share one neutral fill
 * with 2px gaps; the current stage carries the accent and is also named
 * as "now" in words, so nothing is said by colour alone. Labels sit in an
 * ordered list under the strip rather than on the segments, so short
 * stages never collide; the list is also the accessible reading.
 */
export function StageDurations({
  milestones,
  now,
}: {
  readonly milestones: Parameters<typeof stageSpans>[0];
  readonly now: number;
}) {
  const spans = stageSpans(milestones, now);
  if (spans.length === 0) return null;
  const total = Math.max(
    1,
    spans.reduce((sum, span) => sum + span.ms, 0),
  );
  return (
    <figure className="flex flex-col gap-3" data-stage-durations>
      <figcaption className="cq-body-sm text-(--cq-text-secondary)">
        Time in each stage
      </figcaption>
      <div aria-hidden="true" className="flex h-2 w-full gap-0.5">
        {spans.map((span) => (
          <span
            key={span.key}
            title={`${STATE_WORDS[span.state]}: ${durationWords(span.ms)}`}
            className={cx(
              "h-2 min-w-1 rounded-(--cq-radius-xs)",
              span.to === null ? "bg-(--cq-accent)" : "bg-(--cq-text-tertiary)",
            )}
            style={{ flexGrow: span.ms / total, flexBasis: 0 }}
          />
        ))}
      </div>
      <ol className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {spans.map((span) => (
          <li
            key={span.key}
            className="cq-body-sm flex items-baseline justify-between gap-3"
          >
            <span className="text-(--cq-text-primary)">
              {STATE_WORDS[span.state]}
              {span.to === null ? (
                <span className="text-(--cq-text-secondary)"> · now</span>
              ) : null}
            </span>
            <span className="cq-numeric whitespace-nowrap text-(--cq-text-secondary)">
              {durationWords(span.ms)}
              <span className="sr-only">
                {`, from ${formatRelationshipDate(span.from)}`}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
