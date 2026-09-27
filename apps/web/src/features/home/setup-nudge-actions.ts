"use server";

import { chooseOnboardingNudge } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * "Later" on the setup reminder card: reminders are put off for a few days
 * (the server's policy says how many). The person's own reminders only:
 * the API keys them by the signed-in session, never by anything sent here.
 * A failure is quiet; the card is gone either way and nothing depends on it.
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
