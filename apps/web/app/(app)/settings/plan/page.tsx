import type { Metadata } from "next";
import Link from "next/link";

import { getMyPlan, getPlanCatalogue } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState, InlineNotice } from "@capital-q/ui/states";

import { PlanBoard, type PlanSide } from "@/features/billing/plan-board";
import { PLAN_TIERS } from "@/features/billing/plan-tiers";
import { AccountToastProvider } from "@/features/settings/account-kit";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
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
  const free = plan?.source === "LAUNCH_DEFAULT";
  return (
    <AccountToastProvider>
      <AccountColumn className="max-w-[calc(1120px+4rem)]">
        <QSection id="plan" kind="BILLING" label={t("your plan")}>
          <AccountHead
            title={t("Plan and billing")}
            back={{ href: "/settings", label: t("Settings") }}
            sub={
              plan === null
                ? undefined
                : `${t(
                    free
                      ? `You are on the ${plan.plan.name} plan, free while Capital Q launches.`
                      : `You are on the ${plan.plan.name} plan.`,
                  )} ${
                    PLAN_TIERS.preview
                      ? t(
                          "Prices here are a preview, before tax. Nothing is charged today.",
                        )
                      : t("Prices are before tax.")
                  }`
            }
          />
          {plan === null ? (
            <ErrorState
              title={t("Your plan couldn't load")}
              description={t("Nothing changed and nothing was charged.")}
              action={
                <Link
                  href="/settings/plan"
                  className={buttonClassName("secondary", "compact")}
                >
                  {t("Try again")}
                </Link>
              }
            />
          ) : (
            <>
              {checkout === "done" ? (
                <div className="mb-4">
                  <InlineNotice tone="positive" title={t("Thank you")}>
                    {t(
                      "Your payment went through. Your plan changes as soon as the payment provider confirms it, usually within a minute.",
                    )}
                  </InlineNotice>
                </div>
              ) : null}
              <PlanBoard
                plan={plan}
                catalogue={catalogue}
                side={side}
                accountName={context.kind === "NONE" ? null : context.label}
              />
              <p className="mt-3.5 text-xs text-(--cq-text-tertiary)">
                {t(
                  "No plan changes how companies or investors are ranked. There is no paid placement on Capital Q.",
                )}
              </p>
            </>
          )}
        </QSection>
      </AccountColumn>
    </AccountToastProvider>
  );
}
