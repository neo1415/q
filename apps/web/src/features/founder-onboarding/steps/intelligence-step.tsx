"use client";

import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { IntelligenceSnapshot } from "@capital-q/ui/intelligence-snapshot";
import { InlineNotice } from "@capital-q/ui/states";

import type { StepProps } from "./step-props";

/**
 * F8. "Here's what we have so far": structured, sourced from the founder's
 * own answers, no score, no investor matches, no "complete" banner and no
 * claim that Q has analysed anything. The shell supplies the actions.
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
