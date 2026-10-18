import type { Metadata } from "next";
import Link from "next/link";

import { getMyUsage } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { UsageView } from "@/features/billing/usage-view";
import { monthName } from "@/features/billing/usage-words";
import { qApiSession } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Usage · Settings" };

/**
 * Settings → Usage (lead 2026-10-03; design-48): what Q's work for the
 * person cost this month, by purpose and by standing instruction. Read-only,
 * their own usage only; nothing here is a charge.
 */
export default async function UsagePage() {
  const t = await serverT();
  const session = await qApiSession();
  const usage =
    session === null ? null : await getMyUsage(session).catch(() => null);
  return (
    <PageContainer>
      <QSection id="usage" kind="BILLING" label="usage">
        <PageHeader
          title={t("Usage")}
          description={
            usage === null
              ? undefined
              : `${monthName(usage.month)} · what Q's work for you cost, nothing charged`
          }
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
          <UsageView usage={usage} />
        )}
      </QSection>
    </PageContainer>
  );
}
