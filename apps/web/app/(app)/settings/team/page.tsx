import type { Metadata } from "next";

import { getTeam } from "@capital-q/api-client";

import { PageContainer } from "@/components/app-shell/page-container";
import { apiSession } from "@/features/q/context";
import { SettingsNav, TeamError } from "@/features/team/settings-nav";
import { TeamPage } from "@/features/team/team-page";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

/**
 * Settings → Team (G1/G2): the person's company (founders) or firm
 * (investors) as a team, read under their own session from the API, which
 * answers for their ACTIVE organisation and decides what they may do.
 */
export default async function TeamSettingsPage() {
  const session = await apiSession();
  const team =
    session === null ? null : await getTeam(session).catch(() => null);
  return (
    <PageContainer>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNav current="team" />
        <div className="max-w-[52rem] min-w-0">
          {team === null ? <TeamError /> : <TeamPage initial={team} />}
        </div>
      </div>
    </PageContainer>
  );
}
