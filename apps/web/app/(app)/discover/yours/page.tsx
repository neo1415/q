import type { Metadata } from "next";
import Link from "next/link";

import { listYourCompanies } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { YourCompaniesList } from "@/features/discover/your-companies";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Your companies" };
export const dynamic = "force-dynamic";

const PAGE = 10;

/**
 * Your companies (founder decision 2026-10-02): pitches from the companies
 * this investor is connected with, has expressed interest in, or saved,
 * newest first, a page at a time by cursor. Separate from the recommended
 * feed; the server re-checks disclosure for each company and authorises
 * each play.
 */
export default async function YourCompaniesPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly cursor?: string | string[] }>;
} = {}) {
  const raw = (await searchParams)?.cursor;
  const cursor = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  const session = await apiSession();
  const page =
    session === null
      ? null
      : await listYourCompanies(session, {
          limit: PAGE,
          ...(cursor === undefined ? {} : { cursor }),
        }).catch(() => null);

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Your companies"
        description="Pitches from companies you're connected with, interested in or saved. Separate from your recommendations."
      />
      {page === null ? (
        <EmptyState
          title="Your companies couldn't load."
          description="Nothing is lost. Capital Q didn't answer just now; try again in a moment."
          action={
            <Link
              href="/discover/yours"
              className={buttonClassName("secondary")}
            >
              Try again
            </Link>
          }
        />
      ) : page.items.length === 0 ? (
        <EmptyState
          title="No pitches from your companies yet."
          description="When a company you're connected with, interested in or saved has a pitch you may watch, it appears here."
          action={
            <Link href="/discover" className={buttonClassName("secondary")}>
              Back to Discover
            </Link>
          }
        />
      ) : (
        <>
          <YourCompaniesList items={page.items} />
          {page.nextCursor === null ? null : (
            <Link
              href={`/discover/yours?cursor=${encodeURIComponent(page.nextCursor)}`}
              className={buttonClassName("secondary", undefined, "self-start")}
            >
              More
            </Link>
          )}
        </>
      )}
    </PageContainer>
  );
}
