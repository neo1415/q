import type { Metadata } from "next";

import { PlanSection } from "@/features/billing/plan-section";

export const metadata: Metadata = { title: "Plan and billing · Settings" };
export const dynamic = "force-dynamic";

/**
 * Settings → Plan and billing (BILLING, ADR 0034; chosen design "Three
 * plans side by side", 2026-10-21). Also Organisation → Plan and billing;
 * both render the same screen and reads. Nothing on this page charges
 * anyone: checkout and the billing portal are the payment provider's own
 * hosted pages.
 */
export default async function PlanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const checkout = (await searchParams)["checkout"];
  return <PlanSection checkoutDone={checkout === "done"} />;
}
