import "server-only";

import { listMyGateqApplications } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/** B8: one confirmed email, one application per gateway in this window. */
const WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

export type AppliedHere = {
  readonly fund: string;
  readonly sentAt: string;
};

/**
 * Live D5 (2026-11-13): a founder who had already applied opened the
 * gateway again and got a fresh form, learning of the 180-day rule only at
 * Submit, after redoing the form and the interview. Their own sent
 * application here, within the window, is found on entry instead (from
 * their own applications list, under their own session). Null when signed
 * out, when there is none, or when the list cannot be read: the form then
 * shows as before and Submit still enforces the rule.
 */
export async function appliedHere(
  gatewayPublicId: string,
  now: Date = new Date(),
): Promise<AppliedHere | null> {
  const session = await apiSession();
  if (session === null) return null;
  try {
    const mine = await listMyGateqApplications(session);
    const since = now.getTime() - WINDOW_MS;
    const hit = mine.applications.find(
      (application) =>
        application.gatewayPublicId === gatewayPublicId &&
        Date.parse(application.sentAt) >= since,
    );
    return hit === undefined ? null : { fund: hit.fund, sentAt: hit.sentAt };
  } catch {
    return null;
  }
}

/** "13 November 2026", the same calendar as the founder's list. */
export function appliedOnWords(sentAt: string): string {
  return new Date(sentAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
