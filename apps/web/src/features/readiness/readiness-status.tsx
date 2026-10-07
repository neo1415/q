import {
  READINESS_STATUS_LABELS,
  type ReadinessStatus,
} from "@capital-q/contracts";

/**
 * A pillar's status: a word with a shape, never colour alone (WCAG 1.4.1;
 * doc 18 §34). Strong is a filled dot, Developing a half-filled one, Gap a
 * diamond, and Not shared yet a dashed ring in neutral tones: unknown is
 * never styled as a weakness.
 */

const TONE: Readonly<Record<ReadinessStatus, string>> = {
  STRONG: "text-(--cq-positive) bg-(--cq-positive-soft)",
  DEVELOPING: "text-(--cq-accent) bg-(--cq-accent-soft)",
  GAP: "text-(--cq-warning) bg-(--cq-warning-soft)",
  UNKNOWN: "text-(--cq-text-secondary) bg-(--cq-surface-subtle)",
};

function Shape({ status }: { readonly status: ReadinessStatus }) {
  switch (status) {
    case "STRONG":
      return <circle cx="6" cy="6" r="5" fill="currentColor" />;
    case "DEVELOPING":
      return (
        <>
          <circle
            cx="6"
            cy="6"
            r="4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M6 1.5a4.5 4.5 0 0 0 0 9z" fill="currentColor" />
        </>
      );
    case "GAP":
      return (
        <rect
          x="2.5"
          y="2.5"
          width="7"
          height="7"
          transform="rotate(45 6 6)"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      );
    case "UNKNOWN":
      return (
        <circle
          cx="6"
          cy="6"
          r="4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeDasharray="2 1.6"
        />
      );
  }
}

export function ReadinessStatusBadge({
  status,
  count,
}: {
  readonly status: ReadinessStatus;
  /** Shown after the word in a tally ("Gap 2"). */
  readonly count?: number | undefined;
}) {
  return (
    <span
      className={`cq-label inline-flex shrink-0 items-center gap-1.5 rounded-full py-0.5 ps-2 pe-2.5 whitespace-nowrap ${TONE[status]}`}
      data-readiness-status={status}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <Shape status={status} />
      </svg>
      {READINESS_STATUS_LABELS[status]}
      {count === undefined ? null : ` ${String(count)}`}
    </span>
  );
}
