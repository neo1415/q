import type { Metadata } from "next";
import Link from "next/link";

import { getMyUsage, getResults } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";
import { HubNavigation } from "@/features/relationships/hub-navigation";
import { hubTitle } from "@/features/relationships/hub-view";
import { ResultsDashboard } from "@/features/results/results-dashboard";
import { rangeOf } from "@/features/results/results-words";

export const metadata: Metadata = { title: "Reports · CRM" };
export const dynamic = "force-dynamic";

/**
 * Results (spec §5): what a person's activity on Capital Q produced, as a
 * dashboard for a period, with the report they can take into their
 * business. Recorded counts from the Results read; an investor's Q spend
 * is this month's, from their own usage read.
 *
 * Since the sidebar's Results became CRM (owner directive 2026-10-15 §D)
 * this page is the CRM's Reports tab. It keeps its URL, its period links
 * and its PDF/CSV downloads, so no older link or report breaks.
 */
export default async function ResultsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const range = rangeOf(params["range"]);
  const stage =
    params["stage"] !== undefined && /^[A-Z_]{2,40}$/.test(params["stage"])
      ? params["stage"]
      : null;
  // A custom period from an older link still reads (from/to, inclusive).
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = params["from"];
  const to = params["to"];
  const query =
    from !== undefined && day.test(from)
      ? { from, ...(to !== undefined && day.test(to) ? { to } : {}) }
      : { range };
  const [session, qSession, context] = await Promise.all([
    apiSession(),
    qApiSession(),
    resolveOwnContext(),
  ]);
  const side =
    context.kind === "FOUNDER"
      ? "COMPANY"
      : context.kind === "INVESTOR"
        ? "INVESTOR"
        : "NONE";
  const [results, usage] = await Promise.all([
    session === null ? null : getResults(session, query).catch(() => null),
    qSession === null ? null : getMyUsage(qSession).catch(() => null),
  ]);
  return (
    <PageContainer className="flex flex-col gap-4">
      <h1 className="cq-title-lg text-(--cq-text-primary)">{hubTitle(side)}</h1>
      <HubNavigation side={side} view="reports" />
      {results === null ? (
        <ErrorState
          title="Reports couldn't load"
          description="Try again in a moment. Nothing is lost."
          action={
            <Link className={buttonClassName("secondary")} href="/results">
              Try again
            </Link>
          }
        />
      ) : results.side === "NONE" ? (
        <EmptyState
          title="No reports yet"
          description="Reports appear once your company or investment firm is set up."
          action={
            <Link className={buttonClassName("primary")} href="/home">
              Set up with Q
            </Link>
          }
        />
      ) : (
        <ResultsDashboard
          heading="Reports"
          headingLevel={2}
          basePath="/results"
          range={range}
          stage={stage}
          download={new URLSearchParams(query).toString()}
          usage={results.side === "INVESTOR" ? usage : null}
          results={results}
        />
      )}
    </PageContainer>
  );
}
