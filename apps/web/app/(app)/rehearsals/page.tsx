import type { Metadata } from "next";
import Link from "next/link";

import {
  getMyPlan,
  getRehearsalPartners,
  listRehearsals,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { remainingOf, unitsOf } from "@/features/billing/plan-words";
import { apiSession, qApiSession } from "@/features/q/context";
import { RehearsalsHome } from "@/features/rehearsal/rehearsals-home";

export const metadata: Metadata = { title: "Rehearsals" };
export const dynamic = "force-dynamic";

/**
 * Rehearsals (REHEARSE, founder direction 2026-10-01; redesigned
 * 2026-10-05): start a rehearsal by picking the person, the score trend,
 * and every past rehearsal with its review. Q plays the other person. How many a month
 * is the account's plan (BILLING, ADR 0034); the page says what is left.
 */

export default async function RehearsalsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const [session, billingSession] = await Promise.all([
    qApiSession(),
    apiSession(),
  ]);
  const [partners, history, plan] =
    session === null
      ? [null, null, null]
      : await Promise.all([
          getRehearsalPartners(session).catch(() => null),
          listRehearsals(session).catch(() => null),
          billingSession === null
            ? null
            : getMyPlan(billingSession).catch(() => null),
        ]);
  // BILLING block: what the plan leaves this month, said in words.
  const allowance =
    plan?.features.find((feature) => feature.key === "q.rehearsals") ?? null;
  const left = allowance === null ? null : remainingOf(allowance);
  // end BILLING block

  if (partners === null) {
    return (
      <PageContainer>
        <EmptyState
          title="Rehearsals couldn't load."
          description="Try again in a moment."
          action={
            <Link href="/rehearsals" className={buttonClassName("secondary")}>
              Try again
            </Link>
          }
        />
      </PageContainer>
    );
  }
  if (partners.role === null) {
    return (
      <PageContainer>
        <EmptyState
          title="Rehearsals are for founders and investors."
          description="Finish setting up your company or your fund, then rehearse your meetings here."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Go to Q
            </Link>
          }
        />
      </PageContainer>
    );
  }

  const allowanceWords =
    allowance === null || left === null
      ? null
      : {
          words:
            left === 0
              ? `You've used this month's ${allowance.unitPlural} on your ${plan?.plan.name ?? ""} plan.`
              : `${String(left)} ${unitsOf(allowance, left)} left this month on your ${plan?.plan.name ?? ""} plan.`,
          out: left === 0,
        };
  return (
    <PageContainer>
      <RehearsalsHome
        basePath="/rehearsals"
        partners={{ ...partners, role: partners.role }}
        history={history}
        allowance={allowanceWords}
        withId={
          params["with"] !== undefined && /^[0-9a-f-]{36}$/.test(params["with"])
            ? params["with"]
            : null
        }
      />
    </PageContainer>
  );
}
