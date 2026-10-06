import Link from "next/link";

import { getTeam } from "@capital-q/api-client";
import { Avatar } from "@capital-q/ui/avatar";
import { buttonClassName } from "@capital-q/ui/button";

import { ProfileSectionShell } from "@/features/profile/editable-section";
import { apiSession } from "@/features/q/context";

import { teamWords } from "./team-words";

/**
 * The profile's Team section (G2): who works on this company or firm, in
 * one line, and the way to Settings → Team. Read under the person's own
 * session; a read that fails shows nothing rather than a wrong team.
 */
export async function ProfileTeamSection() {
  const session = await apiSession();
  const team = session === null ? null : await getTeam(session).catch(() => null);
  if (team === null) return null;
  const words = teamWords(team.organisation.kind);
  const solo = team.members.length <= 1;
  return (
    <ProfileSectionShell
      id="team"
      title="Team"
      description={
        solo
          ? `Just you, for now. You are ${team.organisation.name}.`
          : `${String(team.members.length)} people work on ${team.organisation.name}.`
      }
      action={
        <Link href="/settings/team" className={buttonClassName("secondary", "compact")}>
          {solo && team.you.can.invite ? "Invite your team" : "Open"}
        </Link>
      }
    >
      <ul className="flex flex-col" data-profile-team>
        {team.members.slice(0, 6).map((member) => (
          <li key={member.membershipId} className="flex items-center gap-3 py-1.5">
            <Avatar name={member.name} size="sm" />
            <span className="min-w-0 flex-1 truncate cq-body-sm text-(--cq-text-primary)">
              {member.name}
              {member.isYou ? <span className="ml-1.5 cq-caption text-(--cq-text-tertiary)">You</span> : null}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {member.role === "OWNER" ? "Owner" : member.role === "ADMIN" ? "Admin" : "Member"}
            </span>
          </li>
        ))}
      </ul>
      {solo ? (
        <p className="cq-caption text-(--cq-text-tertiary)">
          Invite a colleague and this becomes a shared {words.word}.
        </p>
      ) : null}
    </ProfileSectionShell>
  );
}
