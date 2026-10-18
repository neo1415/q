"use server";

import {
  chooseOnboardingNudge,
  claimBriefingOnboardingNudge,
} from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * The setup reminder's two browser-side steps. The person's own reminders
 * only: the API keys them by the signed-in session, never by anything sent
 * here. Failures are quiet; nothing on the page depends on them.
 */

/**
 * The reminder card was actually seen: count today's reminder. Called by
 * the browser when the card is on screen in a visible tab, so a prefetch
 * or a background render never uses the day's reminder up.
 */
export async function claimSetupReminderAction(): Promise<boolean> {
  const session = await apiSession();
  if (session === null) return false;
  try {
    await claimBriefingOnboardingNudge(session);
    return true;
  } catch {
    return false;
  }
}

/**
 * "Later": reminders are put off for a few days (the server's policy says
 * how many), and the card goes at once.
 */
export async function remindSetupLaterAction(): Promise<boolean> {
  const session = await apiSession();
  if (session === null) return false;
  try {
    await chooseOnboardingNudge(session, "LATER");
    return true;
  } catch {
    return false;
  }
}
