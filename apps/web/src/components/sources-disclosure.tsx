import type { ReactNode } from "react";

/**
 * Provenance, one tap away (R23; ADR 0018).
 *
 * The answer or the value comes first and stands on its own. What it rests
 * on -- truth class, evidence status, lifecycle, the sources themselves --
 * is behind a small "Sources" control, closed by default. Collapsed is not
 * removed: everything the server sent is rendered inside, so assistive
 * technology and a curious reader reach it with one press, and nothing is
 * summarised into a verdict on the way.
 */
export function SourcesDisclosure({
  children,
  count,
  label = "Sources",
}: {
  readonly children: ReactNode;
  /** How many items sit behind it, when that is a meaningful number. */
  readonly count?: number | undefined;
  readonly label?: string | undefined;
}) {
  return (
    <details className="cq-sources" data-sources>
      <summary className="cq-sources-summary">
        {label}
        {count !== undefined && count > 0 ? (
          <span className="text-(--cq-text-tertiary)"> · {String(count)}</span>
        ) : null}
      </summary>
      <div className="flex flex-col gap-2 pt-1 pb-2">{children}</div>
    </details>
  );
}
