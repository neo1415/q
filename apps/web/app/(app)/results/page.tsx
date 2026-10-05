import type { Metadata } from "next";
import Link from "next/link";

import { getMyUsage, getResults } from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { apiSession, qApiSession } from "@/features/q/context";
import { ResultsDashboard } from "@/features/results/results-dashboard";
import { rangeOf } from "@/features/results/results-words";

export const metadata: Metadata = { title: "Results" };
export const dynamic = "force-dynamic";

/**
 * Results (spec §5): what a person's activity on Capital Q produced, as a
 * dashboard for a period, with the report they can take into their
 * business. Recorded counts from the Results read; an investor's Q spend
 * is this month's, from their own usage read.
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
  const [session, qSession] = await Promise.all([apiSession(), qApiSession()]);
  const [results, usage] = await Promise.all([
    session === null ? null : getResults(session, query).catch(() => null),
    qSession === null ? null : getMyUsage(qSession).catch(() => null),
  ]);
  return (
    <PageContainer>
      {results === null ? (
        <ErrorState
          title="Results couldn't load"
          description="Try again in a moment. Nothing is lost."
          action={
            <Link className={buttonClassName("secondary")} href="/results">
              Try again
            </Link>
          }
        />
      ) : results.side === "NONE" ? (
        <EmptyState
          title="No results yet"
          description="Results appear once your company or investment firm is set up."
          action={
            <Link className={buttonClassName("primary")} href="/home">
              Set up with Q
            </Link>
          }
        />
      ) : (
        <ResultsDashboard
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
