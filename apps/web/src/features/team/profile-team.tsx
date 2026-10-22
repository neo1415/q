import Link from "next/link";

import { getTeam } from "@capital-q/api-client";
import type { TeamDto } from "@capital-q/contracts";
import { Avatar } from "@capital-q/ui/avatar";

import { ProfileSectionShell } from "@/features/profile/editable-section";
import { accountButton } from "@/features/settings/account-styles";
import { apiSession } from "@/features/q/context";

import { teamWords } from "./team-words";
import { serverT } from "@/features/i18n/server";

/**
 * The profile's Team section (G2): who works on this company or firm, in
 * one line, and the way to Settings → Team. Read under the person's own
 * session; a read that fails shows nothing rather than a wrong team.
 */
export async function ProfileTeamSection({
  given,
}: {
  /** Design review only (/dev/account-review): the team, given. */
  readonly given?: TeamDto | undefined;
} = {}) {
  const t = await serverT();
  const session = given === undefined ? await apiSession() : null;
  const team =
    given ??
    (session === null ? null : await getTeam(session).catch(() => null));
  if (team === null) return null;
  const words = teamWords(team.organisation.kind);
  const solo = team.members.length <= 1;
  return (
    <ProfileSectionShell id="team" title={t("Team")} variant="brief">
      {solo ? (
        <p className="m-0 max-w-[68ch] text-sm leading-normal text-(--cq-text-secondary)">
          {t(words.soloLine(team.organisation.name))}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" data-profile-team>
          {team.members.slice(0, 6).map((member) => (
            <li
              key={member.membershipId}
              className="flex items-center gap-3 border-t border-(--cq-border-subtle) py-2 first:border-t-0"
            >
              <Avatar
                name={member.name}
                size="sm"
                src={member.avatarUrl ?? undefined}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-(--cq-text-primary)">
                {member.name}
                {member.isYou ? (
                  <span className="ms-1.5 text-xs text-(--cq-text-tertiary)">
                    {t("You")}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-(--cq-text-secondary)">
                {member.role === "OWNER"
                  ? t("Owner")
                  : member.role === "ADMIN"
                    ? t("Admin")
                    : t("Member")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/settings/team"
        className={accountButton("secondary", "sm", "self-start")}
      >
        {solo && team.you.can.invite
          ? t("Invite your team")
          : t("Open your team")}
      </Link>
    </ProfileSectionShell>
  );
}
