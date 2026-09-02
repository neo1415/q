import type { ReactNode } from "react";

import type { FounderOnboardingActions } from "../controller/use-founder-onboarding";
import type { StepKind, StepViewOfKind } from "../models/presentation";

/**
 * What every step renderer receives. A step owns its draft and its
 * validation; it submits a typed response and never touches the session.
 */
export type StepProps<TKind extends StepKind> = {
  readonly step: StepViewOfKind<TKind>;
  readonly formId: string;
  readonly busy: boolean;
  readonly actions: FounderOnboardingActions;
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
