import type { Metadata } from "next";

import { getTeam, listCompanyClaims } from "@capital-q/api-client";

import { apiSession, resolveOwnContext } from "@/features/q/context";
import { TeamSettingsView } from "@/features/team/team-settings-view";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

/**
 * Settings → Team (G1/G2; chosen design "Invite first", 2026-10-21): the
 * person's company (founders) or firm (investors) as a team, read under
 * their own session from the API, which answers for their ACTIVE
 * organisation and decides what they may do.
 */
export default async function TeamSettingsPage() {
  const t = await serverT();
  const session = await apiSession();
  const context = await resolveOwnContext();
  const [team, claims] =
    session === null
      ? [null, []]
      : await Promise.all([
          getTeam(session).catch(() => null),
          // P14: claims on their company; the API answers only its admins.
          context.kind === "FOUNDER"
            ? listCompanyClaims(session, context.companyId)
                .then((out) => out.claims)
                .catch(() => [])
            : Promise.resolve([]),
        ]);
  // Only a company's admins see its claims, so only they see "nobody".
  const claimsFor =
    context.kind === "FOUNDER" && team !== null && team.you.can.invite
      ? team.organisation.name
      : null;
  return (
    <TeamSettingsView t={t} team={team} claims={claims} claimsFor={claimsFor} />
  );
}
