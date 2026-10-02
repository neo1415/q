import type { Metadata } from "next";
import Link from "next/link";

import {
  getCompanyNetworkPreview,
  listPassedCompanies,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { countryLabel, stageLabel } from "@/features/company/declared-labels";
import { PassedCompanies } from "@/features/discover/passed-companies";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Passed" };
export const dynamic = "force-dynamic";

/**
 * Passed (doc 19 §66–68): the companies an investor passed on, with Undo
 * pass. A pass hides a company from the feed, never from the investor:
 * each is read back through the ordinary company path, which re-checks
 * disclosure, so one that has since stopped being discoverable is simply
 * not shown.
 */
export default async function PassedPage() {
  const session = await apiSession();
  const passed =
    session === null
      ? null
      : await listPassedCompanies(session).catch(() => null);
  const companies =
    session === null || passed === null
      ? []
      : (
          await Promise.all(
            passed.companyIds.map((companyId) =>
              getCompanyNetworkPreview(session, companyId).catch(() => null),
            ),
          )
        ).filter((company) => company !== null);

  return (
    <PageContainer>
      <PageHeader
        title="Passed"
        description="Passing only hides a company from your feed. The company isn't told, and your mandate doesn't change."
      />
      {passed === null ? (
        <EmptyState
          title="Passed couldn't load."
          description="Nothing is lost. Capital Q didn't answer just now; try again in a moment."
          action={
            <Link
              href="/discover/passed"
              className={buttonClassName("secondary")}
            >
              Try again
            </Link>
          }
        />
      ) : companies.length === 0 ? (
        <EmptyState
          title="Nothing passed."
          description="Companies you pass on in Discover are listed here, so you can bring any of them back."
          action={
            <Link href="/discover" className={buttonClassName("secondary")}>
              Go to Discover
            </Link>
          }
        />
      ) : (
        <PassedCompanies
          companies={companies.map((company) => {
            const facts = [
              stageLabel(company.currentStageCode),
              countryLabel(company.headquartersCountry),
            ].filter((part): part is string => part !== null);
            return {
              companyId: company.companyId,
              name: company.canonicalName,
              facts: facts.length === 0 ? null : facts.join(" · "),
              pitch: company.pitch,
            };
          })}
        />
      )}
    </PageContainer>
  );
}
