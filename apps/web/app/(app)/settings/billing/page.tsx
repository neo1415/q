import type { Metadata } from "next";
import Link from "next/link";

import { getMyPlan } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { ManageBillingButton } from "@/features/billing/plan-actions";
import { sourceLine } from "@/features/billing/plan-words";
import {
  PLAN_TIERS,
  tierOfPlan,
  tierPrice,
  type PlanTier,
} from "@/features/billing/plan-tiers";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import {
  RowLink,
  SettingRow,
  SettingsCard,
} from "@/features/settings/settings-ui";

export const metadata: Metadata = { title: "Billing · Settings" };

/**
 * Settings → Billing (P5): the plan the account is on (from the billing
 * service, ADR 0034), the plans Capital Q will offer (a preview from
 * features/billing/plan-tiers.ts, the one place prices live), and payment.
 *
 * Honest by construction: the tier prices are a labelled preview that
 * nothing charges; there is no card form. Where a real payment-provider
 * account exists and the person may manage it, the real "Manage billing"
 * button shows; otherwise the payment card says payment is not on yet.
 */
export default async function BillingPage() {
  const session = await apiSession();
  const [plan, context] = await Promise.all([
    session === null ? null : getMyPlan(session).catch(() => null),
    resolveOwnContext(),
  ]);
  const currentTier = plan === null ? null : tierOfPlan(plan.plan.key);
  return (
    <PageContainer>
      <PageHeader
        title="Billing"
        description="Your plan, the plans on offer, and how you pay."
      />
      <div className="flex flex-col gap-8">
        {plan === null ? (
          <ErrorState
            title="Your plan couldn't load"
            description="Nothing changed and nothing was charged."
            action={
              <Link
                href="/settings/billing"
                className={buttonClassName("secondary", "compact")}
              >
                Try again
              </Link>
            }
          />
        ) : (
          <section
            aria-labelledby="billing-current"
            className="cq-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="cq-label text-(--cq-text-secondary)">
                Current plan
              </span>
              <h2
                id="billing-current"
                className="cq-title-lg text-(--cq-text-primary)"
                data-billing-plan
              >
                {plan.plan.name}
              </h2>
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {plan.source === "LAUNCH_DEFAULT"
                  ? "Free while Capital Q launches"
                  : sourceLine({
                      source: plan.source,
                      planName: plan.plan.name,
                      endsAt: plan.endsAt,
                    })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <RowLink href="/settings/plan">Allowances</RowLink>
              <RowLink href="/settings/usage">Usage</RowLink>
            </div>
          </section>
        )}

        <section
          aria-labelledby="billing-plans"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2
              id="billing-plans"
              className="cq-title-md text-(--cq-text-primary)"
            >
              Plans
            </h2>
            {PLAN_TIERS.preview ? (
              <span className="cq-caption inline-flex min-h-6 items-center rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-2.5 font-medium text-(--cq-text-secondary)">
                Preview pricing
              </span>
            ) : null}
          </div>
          <ul className="grid gap-3 lg:grid-cols-3">
            {PLAN_TIERS.tiers.map((tier) => (
              <TierCard
                key={tier.key}
                tier={tier}
                current={currentTier?.key === tier.key}
                suits={
                  currentTier === null &&
                  context.kind !== "NONE" &&
                  context.kind === tier.suits &&
                  // Of the two investor tiers, the individual one suits by default.
                  !(tier.key === "fund")
                }
              />
            ))}
          </ul>
          {PLAN_TIERS.preview ? (
            <p className="cq-caption text-(--cq-text-tertiary)">
              Prices are a preview in {PLAN_TIERS.currency} a month and may
              change before billing starts. Nothing is charged today.
            </p>
          ) : null}
        </section>

        <SettingsCard
          id="payment"
          title="Payment"
          description={
            plan?.hasBillingCustomer === true
              ? "Handled securely by our payment provider."
              : "Online payment isn't switched on yet."
          }
        >
          {plan?.hasBillingCustomer === true && plan.canManage ? (
            <SettingRow
              term="Payment method and invoices"
              hint="Opens our payment provider"
            >
              <ManageBillingButton />
            </SettingRow>
          ) : (
            <>
              <SettingRow term="Payment method">
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  None on file
                </span>
              </SettingRow>
              <SettingRow term="Invoices">
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  None yet
                </span>
              </SettingRow>
            </>
          )}
          <SettingRow
            term="Change plan"
            hint={
              plan?.canManage === false
                ? "An admin of your organisation can change its plan"
                : "Reply to any Capital Q email and the team changes it for you"
            }
          >
            {plan?.checkoutAvailable === true && plan.canManage ? (
              <RowLink href="/settings/plan">Choose a plan</RowLink>
            ) : (
              <span className="cq-body-sm text-(--cq-text-secondary)">
                Nothing is charged until you agree a price
              </span>
            )}
          </SettingRow>
        </SettingsCard>
      </div>
    </PageContainer>
  );
}

function TierCard({
  tier,
  current,
  suits,
}: {
  readonly tier: PlanTier;
  readonly current: boolean;
  readonly suits: boolean;
}) {
  return (
    <li
      className={`cq-panel flex flex-col gap-4 p-5 ${
        current
          ? "border-(--cq-accent) ring-1 ring-(--cq-accent) ring-inset"
          : ""
      }`}
      data-plan-tier={tier.key}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="cq-title-sm text-(--cq-text-primary)">{tier.name}</h3>
        {current ? (
          <span className="cq-caption inline-flex min-h-6 items-center rounded-full bg-(--cq-accent-soft) px-2.5 font-medium text-(--cq-text-primary)">
            Your plan
          </span>
        ) : suits ? (
          <span className="cq-caption inline-flex min-h-6 items-center rounded-full border border-(--cq-border-subtle) px-2.5 font-medium text-(--cq-text-secondary)">
            Suits you
          </span>
        ) : null}
      </div>
      <p className="flex items-baseline gap-1.5">
        <span className="cq-numeric text-3xl font-semibold tracking-tight text-(--cq-text-primary)">
          {tierPrice(tier.monthly)}
        </span>
        {tier.monthly === null ? null : (
          <span className="cq-body-sm text-(--cq-text-secondary)">a month</span>
        )}
      </p>
      <p className="cq-body-sm text-(--cq-text-secondary)">{tier.forWhom}</p>
      <ul className="cq-body-sm flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-4 text-(--cq-text-primary)">
        {tier.highlights.map((line) => (
          <li key={line} className="flex gap-2">
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 rounded-full bg-(--cq-accent)"
            />
            {line}
          </li>
        ))}
      </ul>
    </li>
  );
}
