import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import {
  VisibilityScreen,
  VisibilityUnavailable,
} from "@/features/company/visibility-screen";
import { InvestorVisibilityScreen } from "@/features/investor/visibility-screen";
import { resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Visibility & Discovery" };

export const dynamic = "force-dynamic";

/**
 * Visibility & Discovery (CQ-PRE-REC-001 §31), both sides of the network.
 * The person's own subject is resolved on the server; the screen then reads
 * it and its network projection through the API under their session. A
 * founder decides whether investors can find the company; an investor
 * decides whether founders can find the profile. Neither switch is ever
 * flipped by finishing onboarding.
 */
export default async function VisibilityPage() {
  const context = await resolveOwnContext();
  return (
    <PageContainer>
      <PageHeader
        title="Visibility & Discovery"
        description={
          context.kind === "INVESTOR"
            ? "Who can see your investor profile, what they see, and whether founders can find you."
            : "Who can see your company, what they see, and whether investors can find you."
        }
      />
      {context.kind === "FOUNDER" ? (
        <VisibilityScreen companyId={context.companyId} />
      ) : context.kind === "INVESTOR" ? (
        <InvestorVisibilityScreen
          investorOrganisationId={context.investorOrganisationId}
        />
      ) : context.unavailable === true ? (
        // Not known to be nobody: Capital Q did not answer this render.
        <EmptyState
          title="Visibility couldn't load."
          description="Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment."
          action={
            <Link
              href="/company/visibility"
              className={buttonClassName("secondary")}
            >
              Try again
            </Link>
          }
        />
      ) : (
        <VisibilityUnavailable />
      )}
    </PageContainer>
  );
}
