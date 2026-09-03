import type { ReactNode } from "react";

import { requireSessionUser } from "@/auth/session";

// Session-bound HTML is rendered per request and never prerendered or
// shared-cached (doc 15 s9.4).
export const dynamic = "force-dynamic";

/**
 * Onboarding route group: no application shell, no bottom navigation. The
 * onboarding screens bring their own focused frame with an always-visible
 * "Save & leave" exit.
 *
 * A session is required, an organisation is not: onboarding is exactly where
 * a newly authenticated person with no membership is meant to be.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  await requireSessionUser();
  return <>{children}</>;
}
