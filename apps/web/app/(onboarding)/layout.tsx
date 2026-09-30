import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { requireSessionUser } from "@/auth/session";
import { resolveQStanding } from "@/features/q/context";

// Session-bound HTML is rendered per request and never prerendered or
// shared-cached (doc 15 s9.4).
export const dynamic = "force-dynamic";

/**
 * Onboarding route group: no application shell, no bottom navigation. The
 * onboarding screens bring their own focused frame with an always-visible
 * "Save & leave" exit.
 *
 * A session is required, an organisation is not: onboarding is exactly where
 * a newly authenticated person with no membership is meant to be. An
 * account Q paused (founder direction 2026-09-30) is shown only that.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  await requireSessionUser();
  if ((await resolveQStanding())?.paused === true) {
    redirect("/paused");
  }
  return <>{children}</>;
}
