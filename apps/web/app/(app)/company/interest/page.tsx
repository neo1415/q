import type { Metadata } from "next";
import Link from "next/link";

import {
  listCompanyRelationships,
  listIncomingInterest,
} from "@capital-q/api-client";
import type { RelationshipStateV2 } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { IncomingInterest } from "@/features/network/incoming-interest";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

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
  const t = await serverT();
  const context = await resolveOwnContext();
  const session = await apiSession();

  const header = (
    <PageHeader
      title={t("Investor interest")}
      description={t("Accepting connects you. It isn’t an investment.")}
    />
  );

  if (context.kind === "INVESTOR") {
    // The investor's own side of interest is their relationships (R30 #16).
    return (
      <PageContainer>
        <QSection
          id="interest"
          kind="INTEREST_LIST"
          total={0}
          label={t("investor interest")}
        >
          {header}
          <EmptyState
            title={t("This is a founder's page.")}
            description={t(
              "Interest you have expressed, and each company's answer, is under Relationships.",
            )}
            action={
              <Link
                href="/relationships"
                className={buttonClassName("secondary")}
              >
                {t("Go to Relationships")}
              </Link>
            }
          />
        </QSection>
      </PageContainer>
    );
  }

  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <PageContainer>
        <QSection
          id="interest"
          kind="INTEREST_LIST"
          total={0}
          label={t("investor interest")}
        >
          {header}
          <EmptyState
            title={t("Nothing to answer here.")}
            description={t(
              "Investor interest is addressed to a company. It appears here for the company's own team.",
            )}
            action={
              <Link href="/home" className={buttonClassName("secondary")}>
                {t("Back to Home")}
              </Link>
            }
          />
        </QSection>
      </PageContainer>
    );
  }

  const [incoming, relationships] = await Promise.all([
    listIncomingInterest(session, context.companyId).catch(() => null),
    // Where each pair stands now: an accepted interest is history, and the
    // relationship may have moved on (demo audit 2026-10-03: "Connected"
    // beside a pair in diligence).
    listCompanyRelationships(session, context.companyId).catch(() => null),
  ]);
  const now = new Map<string, RelationshipStateV2>(
    (relationships?.items ?? [])
      .filter((item) => item.counterpart.kind === "INVESTOR_ORGANISATION")
      .map((item) => [item.counterpart.id, item.state]),
  );
  return (
    <PageContainer>
      <QSection
        id="interest"
        kind="INTEREST_LIST"
        refs={(incoming?.items ?? []).slice(0, 12).map((item) => ({
          kind: "INVESTOR_ORGANISATION" as const,
          id: item.investorOrganisationId,
        }))}
        total={incoming?.items.length ?? 0}
        label={t("investor interest")}
      >
        {header}
        {incoming === null ? (
          <EmptyState
            title={t("Investor interest couldn't load.")}
            description={t(
              "Nothing is wrong with your company. Capital Q didn't answer just now; try again in a moment.",
            )}
            action={
              <Link
                href="/company/interest"
                className={buttonClassName("secondary")}
              >
                {t("Try again")}
              </Link>
            }
          />
        ) : (
          <IncomingInterest items={incoming.items} currentStates={now} />
        )}
      </QSection>
    </PageContainer>
  );
}
