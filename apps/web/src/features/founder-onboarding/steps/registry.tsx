import type { ReactElement } from "react";

import type { FounderOnboardingActions } from "../controller/use-founder-onboarding";
import type { StepView } from "../models/presentation";
import { CapitalObjectiveStep } from "./capital-objective-step";
import { ChoiceStep } from "./choice-step";
import { CompanyBasicsStep } from "./company-basics-step";
import { IntelligenceStep } from "./intelligence-step";
import { MultiChoiceStep } from "./multi-choice-step";
import { NarrativeStep } from "./narrative-step";
import { ReviewStep } from "./review-step";
import { TaxonomyStep } from "./taxonomy-step";
import { TeamStep } from "./team-step";
import { TractionStep } from "./traction-step";

/**
 * Step kind → renderer. The journey itself (which screens, in what order,
 * with what content) comes from the session view; this only knows how to
 * draw each kind. Adding a kind is one case here and one component.
 */
export function renderStep(input: {
  readonly step: StepView;
  readonly formId: string;
  readonly busy: boolean;
  readonly actions: FounderOnboardingActions;
}): ReactElement {
  const { step, ...common } = input;
  switch (step.kind) {
    case "choice":
      return <ChoiceStep step={step} {...common} />;
    case "multi_choice":
      return <MultiChoiceStep step={step} {...common} />;
    case "narrative":
      return <NarrativeStep step={step} {...common} />;
    case "company_basics":
      return <CompanyBasicsStep step={step} {...common} />;
    case "taxonomy_select":
      return <TaxonomyStep step={step} {...common} />;
    case "review":
      return <ReviewStep step={step} {...common} />;
    case "team":
      return <TeamStep step={step} {...common} />;
    case "traction":
      return <TractionStep step={step} {...common} />;
    case "capital_objective":
      return <CapitalObjectiveStep step={step} {...common} />;
    case "snapshot":
      return <IntelligenceStep step={step} {...common} />;
  }
}
