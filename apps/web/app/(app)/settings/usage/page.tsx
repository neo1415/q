import type { Metadata } from "next";
import Link from "next/link";

import { getMyUsage } from "@capital-q/api-client";
import type { QUsageDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { allowanceLine } from "@/features/billing/plan-words";
import {
  callsLine,
  dollars,
  headline,
  taskName,
} from "@/features/billing/usage-words";
import { qApiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Usage · Settings" };

/**
 * Settings → Usage (lead 2026-10-03): what Q used for the person this
 * month, by task and by standing instruction, beside their plan's Q
 * limits. Read-only, their own usage only; nothing here is a charge.
 */
export default async function UsagePage() {
  const session = await qApiSession();
  const usage =
    session === null ? null : await getMyUsage(session).catch(() => null);
  return (
    <PageContainer width="reading">
      <PageHeader
        title="Usage"
        description="What Q's work for you cost to run this month. It's shown so you can see it; you aren't charged by it."
      />
      {usage === null ? (
        <ErrorState
          title="Your usage couldn't load"
          description="Nothing has changed. Try again in a moment."
          action={
            <Link
              href="/settings/usage"
              className={buttonClassName("secondary", "compact")}
            >
              Try again
            </Link>
          }
        />
      ) : (
        <Usage usage={usage} />
      )}
    </PageContainer>
  );
}

function Usage({ usage }: { readonly usage: QUsageDto }) {
  return (
    <div className="flex flex-col gap-10">
      <PageSection
        id="month"
        title={headline(usage)}
        description={callsLine(usage)}
      >
        {usage.byTask.length === 0 ? null : (
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {usage.byTask.map((row) => (
              <div
                key={row.purpose}
                className="flex items-baseline justify-between gap-6 py-3"
              >
                <dt className="cq-body text-(--cq-text-primary)">
                  {taskName(row.purpose)}
                </dt>
                <dd className="cq-body-sm cq-numeric text-(--cq-text-secondary)">
                  {dollars(row.usd)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </PageSection>
      {usage.instructions.length === 0 ? null : (
        <PageSection
          id="instructions"
          title="Standing instructions"
          description="Each instruction has its own monthly budget; when it's used, Q pauses and asks you."
        >
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {usage.instructions.map((row) => (
              <div
                key={row.instructionId}
                className="flex items-baseline justify-between gap-6 py-3"
              >
                <dt className="cq-body text-(--cq-text-primary)">{row.goal}</dt>
                <dd className="cq-body-sm cq-numeric shrink-0 text-(--cq-text-secondary)">
                  {dollars(row.usd)}
                  {row.budgetUsdMonth === null
                    ? ""
                    : ` of $${row.budgetUsdMonth}`}
                </dd>
              </div>
            ))}
          </dl>
        </PageSection>
      )}
      {usage.plan === null || usage.plan.features.length === 0 ? null : (
        <PageSection
          id="limits"
          title={`Your plan: ${usage.plan.name}`}
          description="Q's allowances on your plan this month."
        >
          <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {usage.plan.features.map((feature) => (
              <div
                key={feature.key}
                className="flex items-baseline justify-between gap-6 py-3"
              >
                <dt className="cq-body text-(--cq-text-primary)">
                  {feature.name}
                </dt>
                <dd className="cq-body-sm cq-numeric text-(--cq-text-secondary)">
                  {allowanceLine(feature)}
                </dd>
              </div>
            ))}
          </dl>
          <Link
            href="/settings/plan"
            className={buttonClassName("secondary", "compact")}
          >
            Your plan
          </Link>
        </PageSection>
      )}
    </div>
  );
}
