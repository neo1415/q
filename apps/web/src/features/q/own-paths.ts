import type { OwnContext } from "./context";

/**
 * Where the bare `/company` and `/mandate` addresses lead (live typed run
 * 2026-10-28, D6): both were 404s, though a founder's company page and an
 * investor's mandate exist. Resolved on the server from the person's own
 * context; nothing a client sends decides it. Someone without the subject
 * yet is taken to the setup that creates it.
 */
export function companyLandingPath(context: OwnContext): string {
  return context.kind === "FOUNDER"
    ? `/company/${encodeURIComponent(context.companyId)}`
    : "/onboarding/founder";
}

/** The investor's mandate lives on their profile (one page, edit in place). */
export function mandateLandingPath(context: OwnContext): string {
  return context.kind === "INVESTOR"
    ? "/profile#mandate"
    : "/onboarding/investor";
}
