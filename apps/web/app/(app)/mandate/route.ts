import { resolveOwnContext, resolveOwnJourney } from "@/features/q/context";
import { mandateLandingPath } from "@/features/q/own-paths";
import { redirectBeforeStreaming } from "@/features/q/redirect-response";

export const dynamic = "force-dynamic";

/**
 * `/mandate` (D6, live typed run 2026-10-28): the investor's mandate on
 * their profile when their organisation exists, otherwise the investor
 * setup that defines it. Decided on the server from the session's context.
 * A route handler for the reason `/company` is one (React #419).
 */
export async function GET(): Promise<Response> {
  const [context, journey] = await Promise.all([
    resolveOwnContext(),
    resolveOwnJourney(),
  ]);
  return redirectBeforeStreaming(mandateLandingPath(context, journey));
}
