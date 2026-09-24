"use client";

import { ICON_SIZE, ICON_STROKE, Lock } from "@capital-q/ui/icons";
import { IntelligenceSnapshot } from "@capital-q/ui/intelligence-snapshot";

import { CompanyIntelligencePanel } from "./company-intelligence-panel";
import type { StepProps } from "./step-props";

/**
 * F8. Two things, kept apart on purpose.
 *
 * A deterministic snapshot of what the founder entered — structured, no
 * score, no investor matches, no "complete" banner.
 *
 * And, since CQ-C5-R2B, Q's first reading of the company, asked through the
 * ordinary Q boundary so it is the same Company Intelligence the rest of the
 * product uses. It appears only when the session is bound to a company Q can
 * be asked about; otherwise the snapshot stands alone rather than a reading
 * of nothing being invented.
 */
export function IntelligenceStep({ step }: StepProps<"snapshot">) {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="sr-only">{step.title}</h1>
      <IntelligenceSnapshot
        headline={step.headline}
        summary={step.summary}
        sections={step.sections}
        nextSteps={step.nextSteps}
        nextStepsTitle="What would help next"
        provenanceNote={step.provenanceNote}
      />
      {step.companyId !== undefined && step.companyName !== undefined ? (
        <CompanyIntelligencePanel
          companyId={step.companyId}
          companyName={step.companyName}
        />
      ) : null}
      {/*
        One quiet line, not a notice: nothing here needs attention, it only
        needs to be true. Becoming discoverable is a separate, later choice
        with its own readiness checks; nothing on this screen changes who can
        see the company.
      */}
      <p className="cq-status-line items-start" data-visibility-note>
        <Lock
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
          className="mt-0.5 shrink-0"
        />
        <span>
          <span>Investors don&apos;t see this.</span> Private to your company.
          Becoming discoverable is a separate step later, with its own readiness
          checks and verification.
        </span>
      </p>
    </div>
  );
}
