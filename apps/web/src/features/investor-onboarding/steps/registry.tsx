import type { ReactElement } from "react";

import type { StepView } from "../models/presentation";
import { AttributesStep } from "./attributes-step";
import { ChoiceStep } from "./choice-step";
import { FlagsStep } from "./flags-step";
import { HandoffStep } from "./handoff-step";
import { InvestorRoleStep } from "./investor-role-step";
import { MandateReviewStep } from "./mandate-review-step";
import { MandateSelectStep } from "./mandate-select-step";
import { NarrativeStep } from "./narrative-step";
import { RedFlagsStep } from "./red-flags-step";
import { StageChequeStep } from "./stage-cheque-step";
import type { InvestorOnboardingActions } from "./step-props";
import { TaxonomyFocusStep } from "./taxonomy-focus-step";

/**
 * Step kind → renderer. The journey (which screens, in what order, with
 * what content) comes from the session view; this only knows how to draw
 * each kind.
 */
export function renderStep(input: {
  readonly step: StepView;
  readonly formId: string;
  readonly busy: boolean;
  readonly actions: InvestorOnboardingActions;
}): ReactElement {
  const { step, ...common } = input;
  switch (step.kind) {
    case "choice":
      return <ChoiceStep step={step} {...common} />;
    case "narrative":
      return <NarrativeStep step={step} {...common} />;
    case "investor_role":
      return <InvestorRoleStep step={step} {...common} />;
    case "mandate_select":
      return <MandateSelectStep step={step} {...common} />;
    case "stage_cheque":
      return <StageChequeStep step={step} {...common} />;
    case "taxonomy_focus":
      return <TaxonomyFocusStep step={step} {...common} />;
    case "attributes":
      return <AttributesStep step={step} {...common} />;
    case "flags":
      return <FlagsStep step={step} {...common} />;
    case "red_flags":
      return <RedFlagsStep step={step} {...common} />;
    case "mandate_review":
      return <MandateReviewStep step={step} {...common} />;
    case "handoff":
      return <HandoffStep step={step} {...common} />;
  }
}
