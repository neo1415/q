import type { Metadata } from "next";

import { getMyUsage, listQWork } from "@capital-q/api-client";

import type { UsagePeriod } from "@/features/billing/usage-story";
import { UsageView } from "@/features/billing/usage-view";
import { qApiSession } from "@/features/q/context";
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
  return <UsageView t={t} usage={usage} work={work} period={period} />;
}
