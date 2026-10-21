import Link from "next/link";

import type { QUsageDto, QWorkDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState } from "@capital-q/ui/states";

import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";

import { UsageStory, type UsagePeriod } from "./usage-story";

/**
 * Settings → Usage (chosen design "What Q did, in words", 2026-10-21):
 * the work Q did for the person this month or last, and what it used. The
 * route reads their own usage and work; /dev/account-review hands in
 * fixtures. Nothing here is a charge.
 */
export function UsageView({
  t,
  usage,
  work,
  period,
}: {
  readonly t: (english: string) => string;
  readonly usage: QUsageDto | null;
  readonly work: readonly QWorkDto[] | null;
  readonly period: UsagePeriod;
}) {
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
