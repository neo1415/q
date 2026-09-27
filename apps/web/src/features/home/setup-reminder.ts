import "server-only";

import { cache } from "react";

import { peekBriefingOnboardingNudge } from "@capital-q/api-client";
import type { OnboardingNudgeView } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Whether Home carries a setup reminder today (founder directive
 * 2026-09-27), read once per request and shared by the welcome and the
 * briefing so the two never disagree and never both prompt.
 *
 * A read, never a claim: rendering Home -- or prefetching it -- changes
 * nothing. The reminder is claimed by the browser once its card is
 * actually seen (setup-nudge-actions.ts). A read that fails or is slow is
 * no reminder, never an error.
 */

const READ_BUDGET_MS = 1500;

export const resolveSetupReminder = cache(
  async (): Promise<OnboardingNudgeView | null> => {
    const session = await apiSession();
    if (session === null) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), READ_BUDGET_MS);
    });
    try {
      const read = peekBriefingOnboardingNudge(session).then((r) => r.nudge);
      return await Promise.race([read, late]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
);
