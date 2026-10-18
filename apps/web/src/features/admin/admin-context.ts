import "server-only";

import { cache } from "react";

import { getAdminMe, type ApiSession } from "@capital-q/api-client";
import type { AdminMeDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The signed-in admin's session and role for this request, read once and
 * shared by the console layout and its pages. Null for anyone else.
 */
export const adminContext = cache(
  async (): Promise<{
    readonly session: ApiSession;
    readonly me: AdminMeDto;
    readonly can: (permission: string) => boolean;
  } | null> => {
    const session = await apiSession();
    if (session === null) return null;
    const me = await getAdminMe(session).catch(() => null);
    if (me === null) return null;
    return {
      session,
      me,
      can: (permission) => me.permissions.includes(permission),
    };
  },
);
