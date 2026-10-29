import type { Metadata } from "next";

import { twoStepEnabled } from "@/auth/session";
import { serverT } from "@/features/i18n/server";
import { FormNotice } from "@/features/auth/components/form-notice";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { TwoStepSettings } from "@/features/settings/two-step-settings";

export const metadata: Metadata = { title: "Security · Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings → Security: two-step verification with an authenticator app.
 * Whether it is on is the Auth server's answer for this session's user,
 * never a value from the address or the browser.
 */
export default async function SecurityPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();
  const outcome = (await searchParams)["two-step"];
  const enabled = await twoStepEnabled();

  return (
    <AccountColumn width="form">
      <AccountHead
        title={t("Security")}
        back={{ href: "/settings#security", label: t("Settings") }}
        sub={t(
          "Two-step verification keeps your account safe if your password is ever known to someone else.",
        )}
      />
      <div className="flex flex-col gap-4">
        {outcome === "on" && enabled === true ? (
          <FormNotice tone="positive">
            {t(
              "Two-step verification is on. You'll be asked for a code next time you sign in.",
            )}
          </FormNotice>
        ) : null}
        {outcome === "off" && enabled === false ? (
          <FormNotice tone="info">
            {t("Two-step verification is off.")}
          </FormNotice>
        ) : null}
        {enabled === null ? (
          <FormNotice tone="warning">
            {t("That didn't work. Try again in a moment.")}
          </FormNotice>
        ) : (
          <TwoStepSettings enabled={enabled} />
        )}
      </div>
    </AccountColumn>
  );
}
