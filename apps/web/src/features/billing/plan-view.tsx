import Link from "next/link";

import type {
  BillingAccountPlanDto,
  BillingCatalogueDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState, InlineNotice } from "@capital-q/ui/states";

import { QSection } from "@/features/q/q-section";
import { AccountToastProvider } from "@/features/settings/account-kit";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";

import { PlanBoard, type PlanSide } from "./plan-board";
import { PLAN_TIERS } from "./plan-tiers";

/**
 * Settings → Plan and billing (BILLING, ADR 0034; chosen design "Three
 * plans side by side", 2026-10-21). The route reads the account's plan and
 * the catalogue; /dev/account-review hands in fixtures. Nothing on this
 * page charges anyone: checkout and the billing portal are the payment
 * provider's own hosted pages.
 */
export function PlanView({
  t,
  plan,
  catalogue,
  side,
  accountName,
  checkoutDone,
  reviewSheet,
}: {
  readonly t: (english: string) => string;
  readonly plan: BillingAccountPlanDto | null;
  readonly catalogue: BillingCatalogueDto | null;
  readonly side: PlanSide;
  readonly accountName: string | null;
  /** Back from the payment provider's checkout. */
  readonly checkoutDone: boolean;
  /** Design review only (passed through to PlanBoard) */
  readonly reviewSheet?: "billing" | "talk" | undefined;
}) {
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
              {checkoutDone ? (
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
                accountName={accountName}
                reviewSheet={reviewSheet}
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
