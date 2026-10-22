import type { Metadata } from "next";

import { getMyPlan, getPlanCatalogue } from "@capital-q/api-client";

import type { PlanSide } from "@/features/billing/plan-board";
import { PlanView } from "@/features/billing/plan-view";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Plan and billing · Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings → Plan and billing (BILLING, ADR 0034; chosen design "Three
 * plans side by side", 2026-10-21). The account's plan comes from the
 * billing service; the three tiers and their preview prices from
 * plan-tiers.ts, the one place prices live; what each tier includes from
 * the billing catalogue. Nothing on this page charges anyone: checkout and
 * the billing portal are the payment provider's own hosted pages.
 */
export default async function PlanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();
  const checkout = (await searchParams)["checkout"];
  const [session, context] = await Promise.all([
    apiSession(),
    resolveOwnContext(),
  ]);
  const [plan, catalogue] =
    session === null
      ? [null, null]
      : await Promise.all([
          getMyPlan(session).catch(() => null),
          getPlanCatalogue(session).catch(() => null),
        ]);
  const side: PlanSide =
    context.kind === "FOUNDER" || context.kind === "INVESTOR"
      ? context.kind
      : null;
  return (
    <PlanView
      t={t}
      plan={plan}
      catalogue={catalogue}
      side={side}
      accountName={context.kind === "NONE" ? null : context.label}
      checkoutDone={checkout === "done"}
    />
  );
}
