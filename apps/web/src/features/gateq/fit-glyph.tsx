/**
 * Fit glyphs (design 2026-10-06): each standing is a distinct shape as well
 * as a colour, and always sits beside a word, so nothing is told by colour
 * alone. Decorative: the word next to it carries the meaning.
 */
export type GlyphKind = "fit" | "part" | "no" | "unk";

export function FitGlyph({
  kind,
  size = 16,
}: {
  readonly kind: GlyphKind;
  readonly size?: number;
}) {
  return (
    <svg
      className={`gq-fg gq-fg-${kind}`}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
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
