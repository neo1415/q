import { ApiProblemError } from "@capital-q/api-client";

export const UNREACHABLE =
  "Couldn't reach Capital Q just now. Please try again.";
export const DOWNLOAD_UNAVAILABLE =
  "This document isn't available to download right now.";

/**
 * What a diligence failure says (QA sweep 2026-10-03: a refused download,
 * a 404, read "Couldn't reach Capital Q"). A refusal is the server's
 * answer, said as one: the operation's own words when it has them, else
 * the server's detail. Only a failure to get an answer at all (a network
 * error or a 5xx) says Capital Q couldn't be reached.
 */
export function diligenceErrorMessage(
  error: unknown,
  refused?: string,
): string {
  if (!(error instanceof ApiProblemError) || error.status >= 500) {
    return UNREACHABLE;
  }
  return refused ?? error.problem?.detail ?? UNREACHABLE;
}
