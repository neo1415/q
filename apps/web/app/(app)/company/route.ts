import { resolveOwnContext, resolveOwnJourney } from "@/features/q/context";
import { companyLandingPath } from "@/features/q/own-paths";
import { redirectBeforeStreaming } from "@/features/q/redirect-response";

export const dynamic = "force-dynamic";

/**
 * `/company` on its own (D6, live typed run 2026-10-28): the founder's own
 * company page when they have one, otherwise the setup that creates it.
 * Decided here, on the server, from the session's own context.
 *
 * A route handler, not a page (live 2026-10-29, React #419): a page under
 * the app's loading boundary redirects only after that boundary has
 * streamed, so the redirect became a meta refresh over a boundary the
 * server "could not finish". Here it is a plain 307 before any HTML.
 */
export async function GET(): Promise<Response> {
  const [context, journey] = await Promise.all([
    resolveOwnContext(),
    resolveOwnJourney(),
  ]);
  return redirectBeforeStreaming(companyLandingPath(context, journey));
}
