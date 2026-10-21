/**
 * Where something is while it works, as one line (round 4, owner
 * 2026-10-21; ux-direction §5.1, §6.1, §7.1). Shared and plain: the caller
 * passes words it has already chosen and translated, from real progress
 * (a stage event, a saved step), never a timer or a guess.
 *
 * - `WorkingLine`: one line, replaced in place, fixed at one line high so
 *   nothing around it moves; truncated, never wrapping. "Looking at Nixo",
 *   "Saving your round size".
 * - `WorkingProgress`: durable work with a known total: "Deck for Nixo ·
 *   2 of 4 · Laying out each page" and a determinate bar of `of` segments.
 *   Pass `progress` only when the total is the work's real, fixed count.
 *
 * Tokens only; no spinner, glow or shimmer; a new line fades in by opacity
 * (`.cq-stage-line`, kept under reduced motion). Done, current and to-come
 * segments differ in fill and height, never colour alone.
 */

export type WorkingSize = "answer" | "caption";

export function WorkingLine({
  label,
  size = "caption",
  reserve = false,
  live = true,
  className,
  ...data
}: {
  /** The words to show, already translated; null when there are none. */
  readonly label: string | null;
  /** "answer": the size of an answer's first line; "caption": under a label. */
  readonly size?: WorkingSize | undefined;
  /** Keep the line's height when there is nothing to say (no shift). */
  readonly reserve?: boolean | undefined;
  /** False inside a region that already announces changes. */
  readonly live?: boolean | undefined;
  readonly className?: string | undefined;
  /** `data-*` attributes for tests and measurement. */
  readonly [key: `data-${string}`]: string | undefined;
}) {
  if (label === null && !reserve) return null;
  return (
    <p
      // One polite update per change; the line is the live region.
      role={live ? "status" : undefined}
      className={`m-0 min-w-0 truncate ${
        size === "answer" ? "cq-body" : "cq-caption"
      } text-(--cq-text-secondary) ${className ?? ""}`}
      {...data}
    >
      {label === null ? (
        // A non-breaking space holds exactly one line.
        " "
      ) : (
        // Keyed by its words: a new line fades in where the old one was.
        <span key={label} className="cq-stage-line" title={label}>
          {label}
        </span>
      )}
    </p>
  );
}

export function WorkingProgress({
  title,
  detail = [],
  progress,
  progressText,
  compact = false,
  className,
  ...data
}: {
  /** What the work is, already translated: "Deck for Nixo". */
  readonly title: string;
  /** Further parts, already translated: ["2 of 4", "Laying out each page"]. */
  readonly detail?: readonly string[] | undefined;
  /** The real, fixed count; omit when the total is not known. */
  readonly progress?:
    { readonly step: number; readonly of: number } | undefined;
  /** What a screen reader hears for the bar: "2 of 4: Laying out each page". */
  readonly progressText?: string | undefined;
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
  readonly [key: `data-${string}`]: string | undefined;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}
      {...data}
    >
      <p
        role="status"
        className={`m-0 min-w-0 truncate ${
          compact ? "cq-caption" : "cq-body-sm"
        } text-(--cq-text-primary)`}
      >
        <span className="font-medium">{title}</span>
        {detail.length > 0 ? (
          <span className="text-(--cq-text-secondary)">{` · ${detail.join(" · ")}`}</span>
        ) : null}
      </p>
      {progress === undefined ? null : (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.of}
          aria-valuenow={progress.step}
          aria-valuetext={progressText}
          aria-label={title}
          className="flex gap-1"
          data-working-step={progress.step}
          data-working-of={progress.of}
        >
          {Array.from({ length: progress.of }, (_, index) => {
            const done = index < progress.step - 1;
            const now = index === progress.step - 1;
            return (
              <span
                key={index}
                aria-hidden="true"
                className={`block flex-1 rounded-full transition-[background-color] duration-(--cq-motion-base) ease-(--cq-ease) ${
                  now ? "h-1.5" : "h-1 self-center"
                } ${
                  done || now
                    ? "bg-(--cq-text-primary)"
                    : "bg-(--cq-border-subtle)"
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
