import type { Metadata } from "next";
import Link from "next/link";

import { getMyPlan, getPlanCatalogue } from "@capital-q/api-client";
import type {
  BillingAccountPlanDto,
  BillingCatalogueDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState, InlineNotice, Progress } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import {
  ChoosePlanButton,
  ManageBillingButton,
} from "@/features/billing/plan-actions";
import {
  allowanceLine,
  resetLine,
  sourceLine,
  usedPercent,
} from "@/features/billing/plan-words";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Your plan · Settings" };

/**
 * Settings → Plan (BILLING, ADR 0034): what the account's plan includes,
 * how much of each feature is used this month, and the way to change plan.
 * Every feature is listed whether or not the plan includes it, so nothing
 * is hidden; the diagnosis, Discover, interest, chat and meetings are not
 * listed because no plan ever limits them.
 */
export default async function PlanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const checkout = (await searchParams)["checkout"];
  const session = await apiSession();
  const [plan, catalogue] =
    session === null
      ? [null, null]
      : await Promise.all([
          getMyPlan(session).catch(() => null),
          getPlanCatalogue(session).catch(() => null),
        ]);
  return (
    <PageContainer width="reading">
      <PageHeader
        title="Your plan"
        description="What your plan includes and how much you've used this month. Q's diagnosis, Discover, interest, chat and meetings are never limited by a plan."
      />
      {plan === null ? (
        <ErrorState
          title="Your plan couldn't load"
          description="Nothing has changed. Try again in a moment."
          action={
            <Link
              href="/settings/plan"
              className={buttonClassName("secondary", "compact")}
            >
              Try again
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          {checkout === "done" ? (
            <InlineNotice tone="positive" title="Thank you">
              Your payment went through. Your plan changes as soon as the
              payment provider confirms it, usually within a minute.
            </InlineNotice>
          ) : null}
          <CurrentPlan plan={plan} />
          <Plans plan={plan} catalogue={catalogue} />
        </div>
      )}
    </PageContainer>
  );
}

function CurrentPlan({ plan }: { readonly plan: BillingAccountPlanDto }) {
  return (
    <PageSection
      id="current"
      title={sourceLine({
        source: plan.source,
        planName: plan.plan.name,
        endsAt: plan.endsAt,
      })}
      description={
        plan.account === "PERSON"
          ? "Your own plan, while you act without an organisation."
          : "Your organisation's plan, shared by everyone in it."
      }
    >
      <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {plan.features.map((feature) => {
          const percent = usedPercent(feature);
          const reset = resetLine(feature);
          return (
            <li key={feature.key} className="flex flex-col gap-2 py-4">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                <span className="cq-body font-medium text-(--cq-text-primary)">
                  {feature.name}
                </span>
                <span className="cq-body-sm cq-numeric text-(--cq-text-secondary)">
                  {allowanceLine(feature)}
                </span>
              </div>
              <span className="cq-caption text-(--cq-text-secondary)">
                {feature.description}
                {reset === null ? "" : ` ${reset}.`}
                {feature.overridden
                  ? " Set for your account by Capital Q."
                  : ""}
              </span>
              {percent === null ? null : (
                <Progress
                  label={`${feature.name} used`}
                  value={percent}
                  className="max-w-md"
                />
              )}
            </li>
          );
        })}
      </ul>
      {plan.hasBillingCustomer && plan.canManage ? (
        <div className="pt-4">
          <ManageBillingButton />
        </div>
      ) : null}
    </PageSection>
  );
}

function Plans({
  plan,
  catalogue,
}: {
  readonly plan: BillingAccountPlanDto;
  readonly catalogue: BillingCatalogueDto | null;
}) {
  if (catalogue === null) {
    return (
      <ErrorState
        compact
        title="The plans couldn't load"
        description="Your own plan above is unaffected. Try again in a moment."
      />
    );
  }
  const offered = catalogue.plans.filter(
    (candidate) => candidate.selfServe && candidate.key !== plan.plan.key,
  );
  return (
    <PageSection
      id="plans"
      title="Plans"
      description={
        plan.checkoutAvailable
          ? "Choose a plan to pay securely with our payment provider. You can cancel any time."
          : plan.canManage
            ? "Online payment isn't switched on yet. To change your plan now, reply to any Capital Q email and the team will change it for you."
            : "An admin of your organisation can change its plan."
      }
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {offered.map((candidate) => (
          <li
            key={candidate.key}
            className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) p-4"
          >
            <div className="flex flex-col gap-1">
              <span className="cq-title-sm text-(--cq-text-primary)">
                {candidate.name}
              </span>
              <span className="cq-body-sm text-(--cq-text-secondary)">
                {candidate.description}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {candidate.features.map((feature) => (
                <li
                  key={feature.key}
                  className="cq-caption cq-numeric flex justify-between gap-4 text-(--cq-text-secondary)"
                >
                  <span>{feature.name}</span>
                  <span className="text-(--cq-text-primary)">
                    {!feature.included
                      ? "Not included"
                      : feature.limit === null
                        ? "Unlimited"
                        : `${String(feature.limit)}${feature.kind === "MONTHLY" ? " a month" : ""}`}
                  </span>
                </li>
              ))}
            </ul>
            {plan.checkoutAvailable ? (
              <ChoosePlanButton
                planKey={candidate.key}
                planName={candidate.name}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
