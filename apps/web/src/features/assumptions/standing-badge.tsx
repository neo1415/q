import {
  ASSUMPTION_STANDING_LABELS,
  type AssumptionStanding,
  type GateCriterionStanding,
} from "@capital-q/contracts";

/**
 * A claim's standing (evidenced, claimed, not known yet) and a gate
 * criterion's (met, not met, not known yet): a word with a shape, never
 * colour alone (WCAG 1.4.1). Unknown is a dashed ring in neutral tones,
 * never styled as a weakness.
 */

type Shape = "FILLED" | "HALF" | "DIAMOND" | "DASHED";

const TONE: Readonly<Record<Shape, string>> = {
  FILLED: "text-(--cq-positive) bg-(--cq-positive-soft)",
  HALF: "text-(--cq-accent) bg-(--cq-accent-soft)",
  DIAMOND: "text-(--cq-warning) bg-(--cq-warning-soft)",
  DASHED: "text-(--cq-text-secondary) bg-(--cq-surface-subtle)",
};

function Mark({ shape }: { readonly shape: Shape }) {
  switch (shape) {
    case "FILLED":
      return <circle cx="6" cy="6" r="5" fill="currentColor" />;
    case "HALF":
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
    case "DIAMOND":
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
    case "DASHED":
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

function Badge({
  shape,
  word,
  data,
}: {
  readonly shape: Shape;
  readonly word: string;
  readonly data: string;
}) {
  return (
    <span
      className={`cq-label inline-flex shrink-0 items-center gap-1.5 rounded-full py-0.5 ps-2 pe-2.5 whitespace-nowrap ${TONE[shape]}`}
      data-standing={data}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <Mark shape={shape} />
      </svg>
      {word}
    </span>
  );
}

const CLAIM_SHAPE: Readonly<Record<AssumptionStanding, Shape>> = {
  EVIDENCED: "FILLED",
  CLAIMED: "HALF",
  UNKNOWN: "DASHED",
};

export function StandingBadge({
  standing,
  count,
}: {
  readonly standing: AssumptionStanding;
  readonly count?: number | undefined;
}) {
  return (
    <Badge
      shape={CLAIM_SHAPE[standing]}
      word={`${ASSUMPTION_STANDING_LABELS[standing]}${count === undefined ? "" : ` ${String(count)}`}`}
      data={standing}
    />
  );
}

const GATE_SHAPE: Readonly<Record<GateCriterionStanding, Shape>> = {
  MET: "FILLED",
  NOT_MET: "DIAMOND",
  UNKNOWN: "DASHED",
};
const GATE_WORDS: Readonly<Record<GateCriterionStanding, string>> = {
  MET: "Met",
  NOT_MET: "Not met",
  UNKNOWN: "Not known yet",
};

export function GateStandingBadge({
  standing,
}: {
  readonly standing: GateCriterionStanding;
}) {
  return (
    <Badge
      shape={GATE_SHAPE[standing]}
      word={GATE_WORDS[standing]}
      data={standing}
    />
  );
}
