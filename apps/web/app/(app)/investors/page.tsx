import type { Metadata } from "next";
import Link from "next/link";

import {
  discoverInvestors,
  listConnectionRequests,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { InvestorCards } from "@/features/investors/investor-cards";
import { ConnectionRequestsInbox } from "@/features/network/connection-requests-inbox";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Investors" };
export const dynamic = "force-dynamic";

/**
 * Investors (ADR 0023). A founder sees the investors who chose to be
 * discoverable, as cards that open each investor's page, where a
 * Connection Request is the one way to reach them. An investor sees the
 * requests founders sent their organisation. The person's own side decides
 * which; every list is the API's, read under their own session.
 */
export default async function InvestorsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly cursor?: string | string[] }>;
} = {}) {
  const context = await resolveOwnContext();
  const session = await apiSession();

  if (context.kind === "INVESTOR" && session !== null) {
    const inbox = await listConnectionRequests(session).catch(() => null);
    return (
      <PageContainer>
        <PageHeader
          title="Founder requests"
          description="Founders who asked to connect with your organisation. Accepting connects you both; it is not an investment."
        />
        {inbox === null ? (
          <EmptyState
            title="Requests couldn't load."
            description="Nothing is wrong with your setup. Try again in a moment."
            action={
              <Link href="/investors" className={buttonClassName("secondary")}>
                Try again
              </Link>
            }
          />
        ) : (
          <ConnectionRequestsInbox items={inbox.items} />
        )}
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Who can send you a request follows the choice you set in{" "}
          <Link
            href="/company/visibility"
            className="text-(--cq-text-primary) underline underline-offset-4"
          >
            Visibility
          </Link>
          .
        </p>
      </PageContainer>
    );
  }

  if (context.kind !== "FOUNDER" || session === null) {
    return (
      <PageContainer>
        <PageHeader
          title="Investors"
          description="Investors who chose to be discoverable on Capital Q."
        />
        <EmptyState
          title={
            context.kind === "NONE" && context.unavailable === true
              ? "Investors couldn't load."
              : "Tell Q what you're here to do first."
          }
          description={
            context.kind === "NONE" && context.unavailable === true
              ? "Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment."
              : "Investors show here for founders once your company is set up."
          }
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Go to Q
            </Link>
          }
        />
      </PageContainer>
    );
  }

  const raw = (await searchParams)?.cursor;
  const cursor = typeof raw === "string" && raw.length <= 200 ? raw : null;
  const slate = await discoverInvestors(session, {
    ...(cursor === null ? {} : { cursor }),
  }).catch(() => null);

  return (
    <PageContainer>
      <PageHeader
        title="Investors"
        description="Investors who chose to be discoverable, what each has said publicly, and whether they take requests from founders."
      />
      {slate === null ? (
        <EmptyState
          title="Investors couldn't load."
          description="Nothing is wrong with your profile. Try again in a moment."
          action={
            <Link href="/investors" className={buttonClassName("secondary")}>
              Try again
            </Link>
          }
        />
      ) : slate.items.length === 0 ? (
        <EmptyState
          title="No investors are discoverable yet."
          description="An investor appears here when they choose to be found. Nothing about their mandate is shown unless they publish it."
        />
      ) : (
        <>
          <InvestorCards items={slate.items} />
          {slate.nextCursor === null ? null : (
            <div className="flex justify-center">
              <Link
                href={`/investors?cursor=${encodeURIComponent(slate.nextCursor)}`}
                className={buttonClassName("secondary")}
              >
                More investors
              </Link>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
