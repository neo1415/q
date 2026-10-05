import {
  FIT_NOT_APPLICABLE_LABEL,
  FIT_OUTCOME_LABELS,
  type FitOutcome,
  type FitParameterResultDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

/**
 * One parameter's outcome as a glyph (ADR 0052). Each outcome has its own
 * SHAPE, so meaning never rests on colour: a filled check (strong), a half
 * disc (partial), a minus (mismatch), a dotted circle with a question mark
 * (unknown), a dash (no preference). Mismatch is neutral, never red;
 * unknown is quiet, never an alarm. Always paired with a word somewhere
 * the reader can see or hear it.
 */

export type FitGlyphKind = FitOutcome | "NOT_APPLICABLE";

export function glyphKindOf(result: FitParameterResultDto): FitGlyphKind {
  return result.applicable ? result.outcome : "NOT_APPLICABLE";
}

export function outcomeWord(kind: FitGlyphKind): string {
  return kind === "NOT_APPLICABLE"
    ? FIT_NOT_APPLICABLE_LABEL
    : FIT_OUTCOME_LABELS[kind];
}

const TONE: Readonly<Record<FitGlyphKind, string>> = {
  STRONG: "text-(--cq-positive)",
  PARTIAL: "text-(--cq-warning)",
  MISMATCH: "text-(--cq-text-secondary)",
  UNKNOWN: "text-(--cq-text-tertiary)",
  NOT_APPLICABLE: "text-(--cq-text-tertiary)",
};

export function FitGlyph({
  kind,
  size = 16,
  className,
}: {
  readonly kind: FitGlyphKind;
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      data-fit-glyph={kind}
      className={cx("shrink-0", TONE[kind], className)}
    >
      {kind === "STRONG" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="m4.8 8.2 2.1 2.1 4.3-4.4"
            stroke="var(--cq-surface-raised)"
            strokeWidth="1.7"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : kind === "PARTIAL" ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" />
        </>
      ) : kind === "MISMATCH" ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M5 8h6"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </>
      ) : kind === "UNKNOWN" ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="2.2 2"
          />
          <path
            d="M6.4 6.4a1.7 1.7 0 0 1 3.2.7c0 1.1-1.6 1.4-1.6 2.2M8 11.3v.05"
            stroke="currentColor"
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
          />
        </>
      ) : (
        <path
          d="M4.5 8h7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** The nine glyphs in a row: a compact summary, always beside the band in words. */
export function FitPips({
  parameters,
}: {
  readonly parameters: readonly FitParameterResultDto[];
}) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      {parameters.map((p) => (
        <FitGlyph key={p.parameter} kind={glyphKindOf(p)} size={14} />
      ))}
    </span>
  );
}
