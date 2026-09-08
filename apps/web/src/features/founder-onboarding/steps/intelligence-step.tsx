"use client";

import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { IntelligenceSnapshot } from "@capital-q/ui/intelligence-snapshot";
import { InlineNotice } from "@capital-q/ui/states";

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
    <div className="flex flex-col gap-6">
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
      <div className="flex flex-col gap-3">
        <ContextIndicator scope="organisation_private" detail="your company" />
        <InlineNotice tone="info" title="Investors don't see this.">
          Becoming discoverable is a separate step later, with its own readiness
          checks and verification. Nothing here changes who can see your
          company.
        </InlineNotice>
      </div>
    </div>
  );
}
