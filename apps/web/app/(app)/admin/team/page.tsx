import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminTeam } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { GrantRole, RevokeRole } from "@/features/admin/team-controls";
import { ROLE_WORDS, when } from "@/features/admin/words";

export const metadata: Metadata = { title: "Team · Admin" };

const ROLE_DOES: Readonly<Record<string, string>> = {
  platform_owner: "Everything, including the team and roles.",
  operator: "Accounts, verification, Q monitor, kill switches, email.",
  trust_and_safety: "Accounts, verification, reports, break-glass.",
  support: "Looks up accounts and verification; reinstates Q's pauses.",
  analyst: "Reads figures, Q monitor and audit. Changes nothing.",
};

export default async function AdminTeamPage() {
  const context = await adminContext();
  if (context === null) notFound();
  const team = await getAdminTeam(context.session)
    .then((result) => result.rows)
    .catch(() => null);
  const manage = context.can("roles.manage");
  return (
    <div className="flex flex-col gap-10">
      <PageSection id="team" title="Console team">
        {team === null ? (
          <ErrorState
            title="The team couldn't load"
            description="Try again in a moment."
          />
        ) : (
          <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {team.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="cq-body text-(--cq-text-primary)">
                    {member.name ?? "Unnamed member"} ·{" "}
                    {ROLE_WORDS[member.role] ?? member.role}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {member.email ?? "No email"} · since{" "}
                    {when(member.grantedAt)}
                    {member.grantedByName === null
                      ? ""
                      : ` · added by ${member.grantedByName}`}
                  </span>
                </div>
                {manage && member.userId !== context.me.userId ? (
                  <RevokeRole
                    userId={member.userId}
                    name={member.name ?? "this admin"}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection id="roles" title="What each role can do">
        <dl className="flex flex-col gap-2">
          {Object.entries(ROLE_DOES).map(([role, does]) => (
            <div key={role} className="flex flex-col sm:flex-row sm:gap-3">
              <dt className="cq-body-sm font-medium text-(--cq-text-primary) sm:w-48">
                {ROLE_WORDS[role]}
              </dt>
              <dd className="cq-body-sm text-(--cq-text-secondary)">{does}</dd>
            </div>
          ))}
        </dl>
      </PageSection>
      {manage ? (
        <PageSection id="grant" title="Add or change a role">
          <GrantRole />
        </PageSection>
      ) : null}
    </div>
  );
}
