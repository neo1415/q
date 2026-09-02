import { cx } from "../primitives/class-names.js";
import { EvidenceStatus, type EvidenceKind } from "./evidence-status.js";
import { QMark } from "./q-mark.js";

/**
 * Structured first-value intelligence: what stands out, what needs
 * attention, what investors may ask, the highest-impact next steps. Prose
 * with provenance, not a score. Readiness ≠ quality ≠ fit ≠ interest, and
 * nothing here ranks or grades the company.
 */

export type SnapshotItem = {
  readonly id: string;
  readonly text: string;
  readonly evidence?: EvidenceKind | undefined;
  readonly evidenceDetail?: string | undefined;
};

export type SnapshotSection = {
  readonly id: string;
  readonly title: string;
  readonly items: readonly SnapshotItem[];
};

export type IntelligenceSnapshotProps = {
  readonly headline: string;
  readonly summary?: string | undefined;
  readonly sections: readonly SnapshotSection[];
  readonly nextSteps: readonly { readonly id: string; readonly text: string }[];
  readonly nextStepsTitle?: string | undefined;
  readonly provenanceNote?: string | undefined;
  readonly className?: string | undefined;
};

export function IntelligenceSnapshot({
  headline,
  summary,
  sections,
  nextSteps,
  nextStepsTitle = "Highest-impact next steps",
  provenanceNote,
  className,
}: IntelligenceSnapshotProps) {
  return (
    <article className={cx("flex flex-col gap-7", className)}>
      <header className="flex items-start gap-3">
        <QMark size="md" state="COMPLETE" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="cq-title-lg text-(--cq-text-primary)">{headline}</h2>
          {summary !== undefined ? (
            <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
              {summary}
            </p>
          ) : null}
        </div>
      </header>

      {sections.map((section) => (
        <section
          key={section.id}
          aria-labelledby={`snapshot-${section.id}`}
          className="flex flex-col gap-3"
        >
          <h3
            id={`snapshot-${section.id}`}
            className="cq-title-md text-(--cq-text-primary)"
          >
            {section.title}
          </h3>
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {section.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 py-3">
                <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-primary)">
                  {item.text}
                </p>
                {item.evidence !== undefined ? (
                  <EvidenceStatus
                    kind={item.evidence}
                    detail={item.evidenceDetail}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {nextSteps.length > 0 ? (
        <section
          aria-labelledby="snapshot-next"
          className="flex flex-col gap-3"
        >
          <h3
            id="snapshot-next"
            className="cq-title-md text-(--cq-text-primary)"
          >
            {nextStepsTitle}
          </h3>
          <ol className="flex flex-col gap-2">
            {nextSteps.map((step, index) => (
              <li key={step.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-(--cq-accent-soft) cq-caption cq-numeric font-semibold text-(--cq-accent)"
                >
                  {index + 1}
                </span>
                <p className="cq-body text-(--cq-text-primary)">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {provenanceNote !== undefined ? (
        <p className="cq-caption text-(--cq-text-tertiary)">{provenanceNote}</p>
      ) : null}
    </article>
  );
}
