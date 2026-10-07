import type { Metadata } from "next";
import Link from "next/link";

import {
  getCompanyAssumptions,
  getFitCompare,
  type ApiSession,
} from "@capital-q/api-client";
import {
  FitCompareQuerySchema,
  type AssumptionBoardDto,
  type FitComparisonDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ArrowLeft, ICON_SIZE } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { FitComparisonView } from "@/features/fit/fit-comparison";
import { apiSession, qApiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Compare" };
export const dynamic = "force-dynamic";

/**
 * Q.10 "Compares opportunities" from Saved (2026-10-07): 2 to 4 companies
 * the investor picked, side by side on the same fit as the top three, and
 * what each has evidenced, claimed or not shared yet. Each id is re-checked
 * by the fit service and the assumptions read; one the reader may not see
 * is simply absent. The same comparison Q's `fit_compare` returns.
 */
export default async function SavedComparePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly ids?: string | string[] }>;
}) {
  const query = FitCompareQuerySchema.safeParse({
    ids: [(await searchParams).ids].flat()[0] ?? "",
  });
  const [q, session] = await Promise.all([qApiSession(), apiSession()]);
  const comparison =
    !query.success || q === null
      ? null
      : await getFitCompare(q, query.data.ids).catch(() => null);
  const evidence =
    comparison === null || session === null
      ? new Map<string, AssumptionBoardDto>()
      : await boards(session, comparison);

  return (
    <PageContainer className="flex flex-col gap-6">
      <Link
        href="/discover/saved"
        className={buttonClassName("quiet", "compact", "self-start")}
      >
        <ArrowLeft size={ICON_SIZE.compact} aria-hidden="true" />
        Back to Saved
      </Link>
      <PageHeader
        title="Side by side"
        description="Your picks on the same fit as your top three. Unknown never counts against a company, and the order is never paid for."
      />
      {!query.success ? (
        <EmptyState
          title="Pick 2 to 4 companies to compare."
          description="Tick them in Saved, then compare them side by side."
          action={
            <Link
              href="/discover/saved"
              className={buttonClassName("secondary")}
            >
              Go to Saved
            </Link>
          }
        />
      ) : comparison === null ? (
        <EmptyState
          title="The comparison didn't load."
          description="Nothing is lost. Try again in a moment."
        />
      ) : comparison.entries.length === 0 ? (
        <EmptyState
          title="None of these can be compared on fit right now."
          description="You may have no active mandate, or these companies are no longer visible to you."
          action={
            <Link href="/profile" className={buttonClassName("secondary")}>
              Check your mandate
            </Link>
          }
        />
      ) : (
        <>
          <FitComparisonView comparison={comparison} />
          <section
            aria-labelledby="compare-evidence"
            className="flex flex-col gap-3"
            data-compare-evidence
          >
            <h2
              id="compare-evidence"
              className="cq-title-sm text-(--cq-text-primary)"
            >
              What each has on record
            </h2>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {comparison.entries.map((entry) => {
                const board = evidence.get(entry.companyId);
                return (
                  <div key={entry.companyId} className="flex flex-col gap-0.5">
                    <dt className="cq-body-sm font-medium text-(--cq-text-primary)">
                      {entry.name}
                    </dt>
                    <dd className="cq-body-sm text-(--cq-text-secondary)">
                      {board === undefined
                        ? "Nothing they shared with you covers this yet."
                        : `${String(board.counts.evidenced)} evidenced · ${String(board.counts.claimed)} claimed · ${String(board.counts.unknown)} not known yet`}
                      {" · "}
                      <Link
                        href={`/company/${encodeURIComponent(entry.companyId)}#assumptions`}
                        className="underline underline-offset-4"
                      >
                        Assumptions to test
                      </Link>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Fit rules version {comparison.configLabel}. Saving isn&rsquo;t
            interest; no company is told you compared it.
          </p>
        </>
      )}
    </PageContainer>
  );
}

async function boards(
  session: ApiSession,
  comparison: FitComparisonDto,
): Promise<ReadonlyMap<string, AssumptionBoardDto>> {
  const read = await Promise.all(
    comparison.entries.map((entry) =>
      getCompanyAssumptions(session, entry.companyId).catch(() => null),
    ),
  );
  return new Map(
    read
      .filter((board): board is AssumptionBoardDto => board !== null)
      .map((board) => [board.companyId, board]),
  );
}
