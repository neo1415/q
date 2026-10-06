import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getFitTop, listInvestorMandates } from "@capital-q/api-client";

import { PageContainer } from "@/components/app-shell/page-container";
import { FitTopView, type FitTopState } from "@/features/fit/fit-top-view";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";

export const metadata: Metadata = { title: "Your top three" };
export const dynamic = "force-dynamic";

/**
 * "Q, give me the top three" (brief B2; ADR 0052): the investor's own
 * candidates ranked by fit with their mandate, side by side. Read under
 * their own session from the Q API; the same comparison Q's
 * `fit_top_candidates` tool returns.
 */
export default async function FitTopPage() {
  const context = await resolveOwnContext();
  if (context.kind !== "INVESTOR") redirect("/investors");
  return (
    <PageContainer>
      <FitTopView state={await topState(context.investorOrganisationId)} />
    </PageContainer>
  );
}

async function topState(investorOrganisationId: string): Promise<FitTopState> {
  const session = await qApiSession();
  if (session === null) return { kind: "ERROR" };
  try {
    const comparison = await getFitTop(session, 3);
    if (
      comparison.considered === 0 &&
      (await hasNoActiveMandate(investorOrganisationId))
    ) {
      return { kind: "NO_MANDATE" };
    }
    return { kind: "READY", comparison };
  } catch {
    return { kind: "ERROR" };
  }
}

async function hasNoActiveMandate(
  investorOrganisationId: string,
): Promise<boolean> {
  const session = await apiSession();
  if (session === null) return false;
  try {
    const mandates = await listInvestorMandates(
      session,
      investorOrganisationId,
      {
        status: "ACTIVE",
        limit: 1,
      },
    );
    return mandates.items.length === 0;
  } catch {
    return false;
  }
}
