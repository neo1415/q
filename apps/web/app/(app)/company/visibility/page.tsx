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
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Visibility and discovery" };

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
  const t = await serverT();
  const context = await resolveOwnContext();
  return (
    <PageContainer>
      <QSection
        id="visibility"
        kind="VISIBILITY"
        refs={
          context.kind === "FOUNDER"
            ? [{ kind: "COMPANY", id: context.companyId }]
            : context.kind === "INVESTOR"
              ? [
                  {
                    kind: "INVESTOR_ORGANISATION",
                    id: context.investorOrganisationId,
                  },
                ]
              : []
        }
        label={t("visibility and discovery")}
      >
        {/* A founder's page is option 3 of the chosen designs: being
            visible and being recommended, said separately. */}
        <PageHeader
          title={
            context.kind === "FOUNDER"
              ? t("Visibility")
              : t("Visibility and discovery")
          }
          description={
            context.kind === "INVESTOR"
              ? "Who can see your investor profile, what they see, and whether founders can find you."
              : context.kind === "FOUNDER"
                ? t(
                    "Being visible and being recommended are separate: both are needed for investors to be shown your company.",
                  )
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
            title={t("Visibility couldn't load.")}
            description={t(
              "Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment.",
            )}
            action={
              <Link
                href="/company/visibility"
                className={buttonClassName("secondary")}
              >
                {t("Try again")}
              </Link>
            }
          />
        ) : (
          <VisibilityUnavailable />
        )}
      </QSection>
    </PageContainer>
  );
}
