import type { OwnContext } from "./context";

/**
 * Where the bare `/company` and `/mandate` addresses lead, decided on the
 * server from the person's own context and journey; nothing a client sends
 * decides it. Production re-test 2026-10-28: both sent a person into the
 * OTHER side's setup (a founder to investor setup, an investor to founder
 * setup) and a second onboarding session was created. Now each person goes
 * to their own side: a redirect never starts the other journey, and only
 * somebody with no journey at all is offered the welcome choice.
 */
export type OwnJourney = "founder" | "investor" | null;

export function companyLandingPath(
  context: OwnContext,
  journey: OwnJourney,
): string {
  if (context.kind === "FOUNDER") {
    return `/company/${encodeURIComponent(context.companyId)}`;
  }
  // An investor's own page is their profile (their firm and mandate).
  if (context.kind === "INVESTOR" || journey === "investor") return "/profile";
  return journey === "founder" ? "/onboarding/founder" : "/welcome";
}

/** The investor's mandate lives on their profile (one page, edit in place). */
export function mandateLandingPath(
  context: OwnContext,
  journey: OwnJourney,
): string {
  if (context.kind === "INVESTOR") return "/profile#mandate";
  // A founder has no mandate: their own home.
  if (context.kind === "FOUNDER" || journey === "founder") return "/home";
  return journey === "investor" ? "/onboarding/investor" : "/welcome";
}
