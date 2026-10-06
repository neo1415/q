import type { FitKind } from "./explore-words";

/**
 * A reason's glyph: a distinct shape for each kind, always beside its
 * words, so meaning never rests on colour alone.
 */
const COLOUR: Readonly<Record<FitKind, string>> = {
  fit: "text-(--cq-positive)",
  part: "text-(--cq-warning)",
  no: "text-(--cq-text-secondary)",
  unk: "text-(--cq-text-tertiary)",
};

export function FitGlyph({
  kind,
  className = "size-3.5",
}: {
  readonly kind: FitKind;
  readonly className?: string | undefined;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-fit={kind}
      className={`shrink-0 ${COLOUR[kind]} ${className}`}
    >
      {kind === "fit" ? (
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
      ) : kind === "part" ? (
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
      ) : kind === "no" ? (
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
      ) : (
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
      )}
    </svg>
  );
}
