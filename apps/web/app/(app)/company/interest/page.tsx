import type { Metadata } from "next";
import Link from "next/link";

import { listIncomingInterest } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { IncomingInterest } from "@/features/network/incoming-interest";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Investor interest" };
export const dynamic = "force-dynamic";

/**
 * Investor interest in the founder's company (CQ-NET-011).
 *
 * The company is the person's own, resolved on the server; the list is
 * read through the API under their session, which answers only for the
 * company's members holding `company.interest.view`. An investor, or a
 * person with no company, has no inbox here.
 */
export default async function InvestorInterestPage() {
  const context = await resolveOwnContext();
  const session = await apiSession();

  const header = (
    <PageHeader
      title="Investor interest"
      description="Accepting connects you. It isn’t an investment."
    />
  );

  if (context.kind === "INVESTOR") {
    // The investor's own side of interest is their relationships (R30 #16).
    return (
      <PageContainer>
        {header}
        <EmptyState
          title="This is a founder's page."
          description="Interest you have expressed, and each company's answer, is under Relationships."
          action={
            <Link
              href="/relationships"
              className={buttonClassName("secondary")}
            >
              Go to Relationships
            </Link>
          }
        />
      </PageContainer>
    );
  }

  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          title="Nothing to answer here."
          description="Investor interest is addressed to a company. It appears here for the company's own team."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Back to Home
            </Link>
          }
        />
      </PageContainer>
    );
  }

  const incoming = await listIncomingInterest(session, context.companyId).catch(
    () => null,
  );
  return (
    <PageContainer>
      {header}
      {incoming === null ? (
        <EmptyState
          title="Investor interest couldn't load."
          description="Nothing is wrong with your company. Capital Q didn't answer just now; try again in a moment."
          action={
            <Link
              href="/company/interest"
              className={buttonClassName("secondary")}
            >
              Try again
            </Link>
          }
        />
      ) : (
        <IncomingInterest items={incoming.items} />
      )}
    </PageContainer>
  );
}
