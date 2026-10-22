import { ICON_STROKE, Info } from "@capital-q/ui/icons";

/**
 * "Demonstration data" (owner 2026-10-22): a company whose profile carries
 * owner-approved demonstration figures says so wherever it is shown -- its
 * profile, its Q Card -- in words, never by colour alone. It is about the
 * figures, not about verification, which keeps its own label.
 */
export function DemonstrationNote({
  subject = "profile",
}: {
  /** What carries the figures: "profile" or "card". */
  readonly subject?: "profile" | "card";
}) {
  return (
    <p
      role="note"
      data-demonstration-data
      className="cq-body-sm flex items-start gap-2 rounded-lg border border-(--cq-border) bg-(--cq-surface-subtle) px-3 py-2 text-(--cq-text-secondary)"
    >
      <Info
        aria-hidden="true"
        size={16}
        strokeWidth={ICON_STROKE}
        className="mt-0.5 shrink-0"
      />
      <span>
        <strong className="font-semibold text-(--cq-text-primary)">
          Demonstration data.
        </strong>{" "}
        The figures on this {subject} are illustrative, supplied by the company
        to demonstrate Capital Q, and are not verified.
      </span>
    </p>
  );
}
