import type { Metadata } from "next";
import Link from "next/link";

import { getMyUsage, listQWork } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState } from "@capital-q/ui/states";

import { UsageStory, type UsagePeriod } from "@/features/billing/usage-story";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { qApiSession } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Usage · Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings → Usage (lead 2026-10-03; chosen design "What Q did, in words",
 * 2026-10-21): the work Q did for the person this month or last, and what
 * it used. Read-only, their own usage and work only; nothing here is a
 * charge.
 */
export default async function UsagePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();
  // The query string is input: only "previous" changes anything.
  const period: UsagePeriod =
    (await searchParams)["month"] === "previous" ? "previous" : "current";
  const session = await qApiSession();
  const [usage, work] =
    session === null
      ? [null, null]
      : await Promise.all([
          getMyUsage(session, { month: period }).catch(() => null),
          listQWork(session)
            .then((list) => list.items)
            .catch(() => null),
        ]);
  return (
    <AccountColumn>
      <QSection id="usage" kind="BILLING" label="usage">
        <AccountHead
          title={t("Work Q did for you")}
          back={{ href: "/settings", label: t("Settings") }}
          sub={t(
            "Usage told as the work it paid for. Totals are at the bottom.",
          )}
        />
        {usage === null ? (
          <ErrorState
            title={t("Usage couldn't load")}
            description={t("Nothing is charged either way.")}
            action={
              <Link
                href="/settings/usage"
                className={buttonClassName("secondary", "compact")}
              >
                {t("Try again")}
              </Link>
            }
          />
        ) : (
          <UsageStory
            usage={usage}
            work={work}
            period={period}
            planName={usage.plan?.name ?? null}
          />
        )}
      </QSection>
    </AccountColumn>
  );
}
