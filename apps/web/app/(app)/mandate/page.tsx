import { redirect } from "next/navigation";

import { resolveOwnContext, resolveOwnJourney } from "@/features/q/context";
import { mandateLandingPath } from "@/features/q/own-paths";

export const dynamic = "force-dynamic";

/**
 * `/mandate` (D6, live typed run 2026-10-28): the investor's mandate on
 * their profile when their organisation exists, otherwise the investor
 * setup that defines it. Decided on the server from the session's context.
 */
export default async function MandatePage(): Promise<never> {
  const [context, journey] = await Promise.all([
    resolveOwnContext(),
    resolveOwnJourney(),
  ]);
  redirect(mandateLandingPath(context, journey));
}
