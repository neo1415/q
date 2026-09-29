import type { Metadata } from "next";
import Link from "next/link";

import {
  getCompanyNetworkPreview,
  listSavedCompanies,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { countryLabel, stageLabel } from "@/features/company/declared-labels";
import { SavedCompanies } from "@/features/discover/saved-companies";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Saved" };
export const dynamic = "force-dynamic";

/**
 * Saved (doc 17 §100; ux-direction §13): the companies an investor saved
 * to revisit. A save is "I want to come back to this", never interest.
 *
 * The list is the investor's own interaction state, identities only. Each
 * company is read back through the ordinary company path, which re-checks
 * disclosure: one that has since stopped being discoverable is simply not
 * shown, because once being saved must not leak it.
 */
export default async function SavedPage() {
  const session = await apiSession();
  const saved =
    session === null
      ? null
      : await listSavedCompanies(session).catch(() => null);

  const companies =
    session === null || saved === null
      ? []
      : (
          await Promise.all(
            saved.companyIds.map((companyId) =>
              getCompanyNetworkPreview(session, companyId).catch(() => null),
            ),
          )
        ).filter((company) => company !== null);

  return (
    <PageContainer>
      <PageHeader
        title="Saved"
        description="Saving isn’t interest. The company isn’t told."
      />
      {saved === null ? (
        <EmptyState
          title="Saved couldn't load."
          description="Nothing is lost. Capital Q didn't answer just now; try again in a moment."
          action={
            <Link
              href="/discover/saved"
              className={buttonClassName("secondary")}
            >
              Try again
            </Link>
          }
        />
      ) : companies.length === 0 ? (
        <EmptyState
          title="Nothing saved yet."
          description="Save a company in Discover and it stays here, across visits and devices."
          action={
            <Link href="/discover" className={buttonClassName("secondary")}>
              Go to Discover
            </Link>
          }
        />
      ) : (
        <SavedCompanies
          companies={companies.map((company) => {
            const facts = [
              stageLabel(company.currentStageCode),
              countryLabel(company.headquartersCountry),
            ].filter((part): part is string => part !== null);
            return {
              companyId: company.companyId,
              name: company.canonicalName,
              facts: facts.length === 0 ? null : facts.join(" · "),
              description: company.shortDescription,
            };
          })}
        />
      )}
    </PageContainer>
  );
}
