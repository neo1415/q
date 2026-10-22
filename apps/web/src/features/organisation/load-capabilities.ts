import { cache } from "react";

import { getMyCapabilities } from "@capital-q/api-client";
import type { MeCapabilitiesDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The person's capabilities in their active organisation, read once per
 * request (React `cache`): the app layout hands them to client components
 * and any page on the same request reuses the answer. Null when the read
 * fails; controls are then left to the server to decide, never guessed.
 */
export const loadMyCapabilities = cache(
  async (): Promise<MeCapabilitiesDto | null> => {
    const session = await apiSession();
    if (session === null) return null;
    return getMyCapabilities(session).catch(() => null);
  },
);
