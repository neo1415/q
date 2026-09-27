import type { Metadata } from "next";
import Link from "next/link";

import {
  getCompanyNetworkPreview,
  listSavedCompanies,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { countryLabel, stageLabel } from "@/features/company/declared-labels";
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
        description="Companies you saved from Discover to come back to. Saving is not interest; the company is not told."
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
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
          {companies.map((company) => {
            const facts = [
              stageLabel(company.currentStageCode),
              countryLabel(company.headquartersCountry),
            ].filter((part): part is string => part !== null);
            return (
              <li key={company.companyId}>
                <Link
                  href={`/company/${encodeURIComponent(company.companyId)}`}
                  className="flex min-h-11 items-center gap-3 py-3 text-(--cq-text-primary) hover:text-(--cq-accent)"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="cq-body font-medium">
                      {company.canonicalName}
                    </span>
                    {facts.length === 0 ? null : (
                      <span className="cq-caption text-(--cq-text-secondary)">
                        {facts.join(" · ")}
                      </span>
                    )}
                    {company.shortDescription === null ? null : (
                      <span className="cq-body-sm text-(--cq-text-secondary)">
                        {company.shortDescription}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    className="shrink-0 text-(--cq-text-tertiary)"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
