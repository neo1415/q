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
  countLine,
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
      <PageHeader title="Plan" />
      {plan === null ? (
        <ErrorState
          title="Your plan couldn't load"
          description="Nothing changed and nothing was charged."
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

/** Usage at or past this share of a limit shows a meter (design-48). */
const NEAR_LIMIT = 80;

function CurrentPlan({ plan }: { readonly plan: BillingAccountPlanDto }) {
  const resets = plan.features
    .map((feature) => resetLine(feature))
    .find((line) => line !== null);
  const free = plan.source === "LAUNCH_DEFAULT";
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="plan-current" className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <h2
            id="plan-current"
            className="cq-title-lg text-(--cq-text-primary)"
            data-plan-name
          >
            {free
              ? plan.plan.name
              : sourceLine({
                  source: plan.source,
                  planName: plan.plan.name,
                  endsAt: plan.endsAt,
                })}
          </h2>
          {/* Only the launch plan's price is known here: it is free. No
              other price is ever shown or guessed (lead, design-48). */}
          {free ? (
            <span className="cq-body cq-numeric font-semibold text-(--cq-text-primary)">
              $0.00/mo USD
            </span>
          ) : null}
        </div>
        {free ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Free while Capital Q launches
          </p>
        ) : null}
      </section>

      <PageSection id="month" title="This month">
        <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
          {plan.features.map((feature) => {
            const percent = usedPercent(feature);
            return (
              <li
                key={feature.key}
                className="flex min-h-12 flex-col justify-center gap-2 py-2"
                data-plan-feature={feature.key}
              >
                <div className="flex items-baseline justify-between gap-6">
                  <span className="cq-body text-(--cq-text-primary)">
                    {feature.name}
                  </span>
                  <span className="cq-body-sm cq-numeric shrink-0 text-(--cq-text-primary)">
                    {countLine(feature)}
                  </span>
                </div>
                {percent === null || percent < NEAR_LIMIT ? null : (
                  <Progress label={`${feature.name} used`} value={percent} />
                )}
              </li>
            );
          })}
        </ul>
        {resets === undefined ? null : (
          <p className="cq-caption pt-2 text-(--cq-text-tertiary)">{resets}</p>
        )}
      </PageSection>

      {plan.hasBillingCustomer && plan.canManage ? (
        <div>
          <ManageBillingButton />
        </div>
      ) : null}

      <details
        className="border-y border-(--cq-border-subtle)"
        data-never-limited
      >
        <summary className="cq-body flex min-h-12 cursor-pointer items-center text-(--cq-text-primary)">
          What&rsquo;s never limited
        </summary>
        <p className="cq-body-sm pb-3 text-(--cq-text-secondary)">
          Q&rsquo;s diagnosis, Discover, interest, chat and meetings, on every
          plan.
        </p>
      </details>
    </div>
  );
}

function Plans({
  plan,
  catalogue,
}: {
  readonly plan: BillingAccountPlanDto;
  readonly catalogue: BillingCatalogueDto | null;
}) {
  if (!plan.checkoutAvailable) {
    // Online payment is off: no plan list and no prices, one way to ask.
    return plan.canManage ? (
      <details data-ask-plan>
        <summary
          className={buttonClassName(
            "secondary",
            "regular",
            "w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          )}
        >
          Ask to change plan
        </summary>
        <p className="cq-body-sm pt-3 text-(--cq-text-secondary)">
          Reply to any Capital Q email and the team changes it for you. Nothing
          is charged until you agree a price.
        </p>
      </details>
    ) : (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        An admin of your organisation can change its plan.
      </p>
    );
  }
  if (catalogue === null) {
    return (
      <ErrorState
        compact
        title="The plans couldn't load"
        description="Your plan above is unaffected."
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
      description="Pay securely with our payment provider. Cancel any time."
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
            <ChoosePlanButton
              planKey={candidate.key}
              planName={candidate.name}
            />
          </li>
        ))}
      </ul>
    </PageSection>
  );
}
