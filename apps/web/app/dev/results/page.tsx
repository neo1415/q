import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { ResultsDashboard } from "@/features/results/results-dashboard";
import { rangeOf } from "@/features/results/results-words";

import { reviewResults } from "./fixtures";

export const metadata: Metadata = {
  title: "Results (design review)",
  robots: { index: false },
};

/**
 * The Results dashboard in the real shell with fictional data, for design
 * review and screenshots. Development only; reads and writes nothing.
 * `?side=founder`, `?state=empty`, `?range=7d|30d|all`, `?stage=CONNECTED`.
 */

/** The review page's clock, read once per request (fixtures are relative to it). */
function reviewClock(): number {
  return Date.now();
}

export default async function ResultsReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const founder = one("side") === "founder";
  const empty = one("state") === "empty";
  const range = rangeOf(one("range"));
  const stage = one("stage") ?? null;
  const now = reviewClock();
  const { investor, founderResults, usage } = reviewResults(now, range, empty);
  return (
    <AppShell
      context={
        founder
          ? {
              scope: "founder_private",
              label: "Ledgerfold (fictional)",
              admin: false,
            }
          : {
              scope: "investor_private",
              label: "Savanna Seed Partners (fictional)",
              admin: false,
            }
      }
    >
      <PageContainer>
        <ResultsDashboard
          basePath={founder ? "/dev/results?side=founder" : "/dev/results"}
          range={range}
          stage={stage}
          download={`range=${range}`}
          usage={founder ? null : usage}
          results={founder ? founderResults : investor}
        />
      </PageContainer>
    </AppShell>
  );
}
