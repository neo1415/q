import type { ReactNode } from "react";

import type { OnboardingActions } from "../../onboarding-kit/controller";
import type {
  StepKind,
  StepResponse,
  StepViewOfKind,
} from "../models/presentation";

export type InvestorOnboardingActions = OnboardingActions<StepResponse>;

/**
 * What every investor step renderer receives. A step owns its draft and its
 * validation; it submits a typed composite response and never touches the
 * session.
 */
export type StepProps<TKind extends StepKind> = {
  readonly step: StepViewOfKind<TKind>;
  readonly formId: string;
  readonly busy: boolean;
  readonly actions: InvestorOnboardingActions;
};

export function StepHeading({
  title,
  prompt,
  help,
  children,
}: {
  readonly title: string;
  readonly prompt?: string | undefined;
  readonly help?: string | undefined;
  readonly children?: ReactNode | undefined;
}) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="cq-title-lg text-(--cq-text-primary)">
        {prompt ?? title}
      </h1>
      {help !== undefined ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">{help}</p>
      ) : null}
      {children}
    </header>
  );
}

/** Small explicit legend for a preference strength, so the meaning is never hidden. */
export function StrengthNote({ children }: { readonly children: ReactNode }) {
  return (
    <p className="cq-caption text-(--cq-text-tertiary)" data-strength-note>
      {children}
    </p>
  );
}
