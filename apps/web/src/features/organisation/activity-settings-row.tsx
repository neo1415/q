"use client";

import Link from "next/link";

import { useT } from "@/features/i18n/language";
import { SRow } from "@/features/settings/account-layout";
import { accountButton } from "@/features/settings/account-styles";

import { useCapabilities } from "./capabilities";
import { CAP } from "./role-words";

/**
 * Settings → Team, for admins and owners only: the way to the team's
 * activity. Shown only when the server says they hold
 * organisation.activity.view; the page itself is refused by the API to
 * anyone else, so this is a convenience, not a guard.
 */
export function ActivitySettingsRow() {
  const t = useT();
  const capabilities = useCapabilities();
  if (capabilities?.capabilities.includes(CAP.ACTIVITY_VIEW) !== true) {
    return null;
  }
  return (
    <SRow
      title={t("Activity")}
      description={t(
        "Who did what for the team, newest first, including what Q did with someone's approval.",
      )}
    >
      <Link
        href="/settings/activity"
        className={accountButton("secondary", "sm")}
        data-settings-activity
      >
        {t("Open activity")}
      </Link>
    </SRow>
  );
}
