import "server-only";

import { ApiProblemError, getReadiness } from "@capital-q/api-client";
import type { ReadinessDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The founder's own readiness, read under their session. Null: not a
 * founder of a company (the API's 404) or it could not be read; the page
 * then says so in one sentence rather than showing an empty diagnosis.
 */
export async function ownReadiness(): Promise<ReadinessDto | null> {
  const session = await apiSession();
  if (session === null) return null;
  try {
    return await getReadiness(session);
  } catch (error: unknown) {
    if (error instanceof ApiProblemError) return null;
    return null;
  }
}
