import type { ReactNode } from "react";

/**
 * Onboarding route group: no application shell, no bottom navigation. The
 * onboarding screens bring their own focused frame with an always-visible
 * "Save & leave" exit.
 */
export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return <>{children}</>;
}
