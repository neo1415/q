import "server-only";

import { cache } from "react";

import type { MyOrganisationDto, TeamRole } from "@capital-q/contracts";

import { loadMyOrganisations } from "@/features/team/load-organisations";

import { loadMyCapabilities } from "./load-capabilities";
import { manages } from "./org-admin-sections";

export type OrgAdminContext = {
  readonly organisation: MyOrganisationDto;
  readonly role: TeamRole;
  /** Owners and admins; anyone else sees every section read-only. */
  readonly canManage: boolean;
  readonly organisations: readonly MyOrganisationDto[];
};

/**
 * The active organisation and the person's role in it, read once per
 * request for the /organisation layout and its sections. The role is the
 * server's capability answer when it reads, else the membership list's;
 * when neither reads, the page is drawn read-only. Null without an active
 * organisation. This decides drawing only: the API authorises every write.
 */
export const orgAdminContext = cache(
  async (): Promise<OrgAdminContext | null> => {
    const [organisations, capabilities] = await Promise.all([
      loadMyOrganisations(),
      loadMyCapabilities(),
    ]);
    const organisation = organisations.find((one) => one.active);
    if (organisation === undefined) return null;
    const role =
      capabilities !== null &&
      capabilities.organisationId === organisation.organisationId
        ? capabilities.role
        : organisation.role;
    return {
      organisation,
      role,
      canManage: capabilities === null ? false : manages(role),
      organisations,
    };
  },
);
