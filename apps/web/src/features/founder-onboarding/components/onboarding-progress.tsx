import { cx } from "@capital-q/ui";

import type { FounderOnboardingSessionView } from "../models/presentation";

/**
 * Semantic progress: the four founder sections, the current section
 * highlighted, and a programmatic description ("Business, step 2 of 3") so
 * the position is understandable without the visual bar. The bar itself is
 * a progressbar over all steps.
 */
export function OnboardingProgress({
  session,
}: {
  readonly session: FounderOnboardingSessionView;
}) {
  const currentSection = session.step.section;
  const sectionSteps = session.steps.filter(
    (step) => step.section === currentSection,
  );
  const positionInSection =
    sectionSteps.findIndex((step) => step.id === session.currentStepId) + 1;
  const overallIndex = session.steps.findIndex(
    (step) => step.id === session.currentStepId,
  );
  const completedCount = session.steps.filter(
    (step) => step.status === "completed" || step.status === "skipped",
  ).length;
  const percent = Math.round((completedCount / session.steps.length) * 100);
  const sectionLabel =
    session.sections.find((section) => section.id === currentSection)?.label ??
    "";
  const description = `${sectionLabel}, step ${String(positionInSection)} of ${String(sectionSteps.length)}`;

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex items-center gap-1" aria-label="Sections">
        {session.sections.map((section) => {
          const steps = session.steps.filter(
            (step) => step.section === section.id,
          );
          const done = steps.every(
            (step) => step.status === "completed" || step.status === "skipped",
          );
          const active = section.id === currentSection;
          return (
            <li
              key={section.id}
              className="flex min-w-0 flex-1 flex-col gap-1.5"
            >
              <span
                aria-hidden="true"
                className={cx(
                  "h-1 rounded-full",
                  active
                    ? "bg-(--cq-accent)"
                    : done
                      ? "bg-(--cq-accent-soft)"
                      : "bg-(--cq-surface-strong)",
                )}
              />
              <span
                aria-current={active ? "step" : undefined}
                className={cx(
                  "cq-caption truncate",
                  active
                    ? "font-semibold text-(--cq-text-primary)"
                    : "text-(--cq-text-tertiary)",
                )}
              >
                {section.label}
              </span>
            </li>
          );
        })}
      </ol>
      <div
        role="progressbar"
        aria-label="Founder setup progress"
        aria-valuemin={0}
        aria-valuemax={session.steps.length}
        aria-valuenow={overallIndex}
        aria-valuetext={`${description}. ${String(percent)}% complete.`}
        className="sr-only"
      />
      <p className="cq-caption text-(--cq-text-secondary)" data-progress-text>
        {description}
      </p>
    </div>
  );
}
