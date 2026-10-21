import type { PendingClaimDto, TeamDto } from "@capital-q/contracts";

import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";

import { CompanyClaims } from "./company-claims";
import { TeamError } from "./settings-nav";
import { TeamPage } from "./team-page";

/**
 * Settings → Team (G1/G2; chosen design "Invite first", 2026-10-21). The
 * route reads the team and the company's claims under the person's own
 * session; /dev/account-review hands in fixtures. A null team is a read
 * that failed. `claimsFor` names the company only for its admins, who see
 * "nobody has asked" when no claim waits.
 */
export function TeamSettingsView({
  t,
  team,
  claims,
  claimsFor,
  reviewRoleFor,
}: {
  readonly t: (english: string) => string;
  readonly team: TeamDto | null;
  readonly claims: readonly PendingClaimDto[];
  readonly claimsFor: string | null;
  /** Design review only: see TeamPage. */
  readonly reviewRoleFor?: string | undefined;
}) {
  return (
    <AccountColumn>
      <QSection id="team" kind="TEAM" label={t("your team")}>
        <AccountHead
          title={t("Team")}
          back={{ href: "/settings", label: t("Settings") }}
        />
        {team === null ? (
          <TeamError />
        ) : (
          <TeamPage initial={team} reviewRoleFor={reviewRoleFor} />
        )}
        <div className="pt-3.5">
          <CompanyClaims initial={claims} companyName={claimsFor} />
        </div>
      </QSection>
    </AccountColumn>
  );
}
