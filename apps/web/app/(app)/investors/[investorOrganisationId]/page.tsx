import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ApiProblemError,
  discoverInvestors,
  getConnectionStatus,
  getDiscoveredInvestor,
  getDiscoveredInvestorCard,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { founderFormContext } from "@/features/gateq/form/founder-prefill";
import { InvestorProfile } from "@/features/investors/investor-profile";
import { gateFor, investorGates } from "@/features/investors/investor-reads";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Investor" };
export const dynamic = "force-dynamic";

/**
 * One investor, as a founder may see them (ADR 0023; app prototype
 * "investor", option 2, "Tabbed: overview, looks for, gate", warm
 * charcoal). Everything here is what the investor chose to publish, read
 * under the founder's own session: their declared profile, their Q Card as
 * a participant reads it (the mandate fields they put on it), their
 * published gate with the founder's standing, Discover's public-profile
 * reasons, and the founder's own history with them. Never the private
 * mandate, portfolio or behaviour, which no read here can carry. What is
 * not published says so. An investor the founder may not see and one that
 * does not exist are the same not-found.
 */
export default async function InvestorPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
  readonly searchParams?: Promise<{ readonly tab?: string | string[] }>;
}) {
  const t = await serverT();
  const { investorOrganisationId } = await params;
  const context = await resolveOwnContext();
  const session = await apiSession();
  const section = (children: ReactNode) => (
    <QSection
      id="investor"
      kind="INVESTOR_PROFILE"
      refs={[{ kind: "INVESTOR_ORGANISATION", id: investorOrganisationId }]}
      total={1}
      label={t("an investor profile")}
    >
      {children}
    </QSection>
  );

  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <PageContainer>
        {section(
          <EmptyState
            title={t("This page is for founders.")}
            description={t(
              "Founders see investors who chose to be discoverable, and can ask to connect.",
            )}
            action={
              <Link href="/home" className={buttonClassName("secondary")}>
                {t("Go to Q")}
              </Link>
            }
          />,
        )}
      </PageContainer>
    );
  }

  const investor = await getDiscoveredInvestor(
    session,
    investorOrganisationId,
  ).catch((error: unknown) => {
    if (error instanceof ApiProblemError && error.status === 404) notFound();
    return null;
  });
  if (investor === null) {
    return (
      <PageContainer>
        {section(
          <EmptyState
            title={t("This investor couldn't load.")}
            description={t(
              "Nothing is wrong with your profile. Try again in a moment.",
            )}
            action={
              <Link
                href={`/investors/${investorOrganisationId}`}
                className={buttonClassName("secondary")}
              >
                {t("Try again")}
              </Link>
            }
          />,
        )}
      </PageContainer>
    );
  }

  const id = investor.investorOrganisationId;
  // Every read is the investor's own publication or the founder's own
  // history, side by side; each failing reads as "not known".
  const [status, relationships, card, gates, slate, form] = await Promise.all([
    getConnectionStatus(session, id).catch(() => null),
    ownRelationships(context),
    getDiscoveredInvestorCard(session, id)
      .then((answer) => answer.card)
      .catch(() => null),
    investorGates(session, [id]),
    discoverInvestors(session).catch(() => null),
    founderFormContext().catch(() => null),
  ]);
  const gate = gateFor(gates, id);
  const listed = slate?.items.find(
    (item) => item.investorOrganisationId.toLowerCase() === id.toLowerCase(),
  );
  const reasons = listed?.reasons ?? [];
  const record = (relationships ?? []).find(
    (item) =>
      item.counterpart.kind === "INVESTOR_ORGANISATION" &&
      item.counterpart.id === id,
  );

  return (
    // Warm charcoal (the chosen option): its primary buttons, logo tile and
    // open tab in warm charcoal; everything else follows the theme.
    <PageContainer className="cq-charcoal">
      {section(
        <InvestorProfile
          reads={{
            investor,
            status,
            card,
            gate,
            reasons,
            publishedFit: listed?.publishedFit,
            record,
            prefill: form?.prefill ?? null,
          }}
          tab={(await searchParams)?.tab}
        />,
      )}
    </PageContainer>
  );
}
