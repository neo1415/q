import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminReviews } from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { ReviewQueue } from "@/features/admin/review-queue";

export const metadata: Metadata = { title: "Reviews · Admin" };

export default async function AdminReviewsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly all?: string | undefined }>;
}) {
  const context = await adminContext();
  if (context === null || !context.can("reviews.read")) notFound();
  const all = (await searchParams).all === "1";
  const rows = await getAdminReviews(context.session, all)
    .then((result) => result.rows)
    .catch(() => null);
  return (
    <PageSection
      id="reviews"
      title="Human reviews"
      description="People asking for a person to look again at a decision (appeals Stage 4). Answer within 3 days."
    >
      <div className="flex flex-col gap-3">
        <Link
          href={all ? "/admin/reviews" : "/admin/reviews?all=1"}
          className="cq-body-sm inline-flex min-h-11 items-center self-start underline underline-offset-4"
        >
          {all ? "Show only open reviews" : "Show decided reviews too"}
        </Link>
        {rows === null ? (
          <ErrorState
            title="Reviews couldn't load"
            description="Try again in a moment."
          />
        ) : rows.length === 0 ? (
          <EmptyState compact title="No reviews waiting" />
        ) : (
          <ReviewQueue
            rows={rows}
            canDecide={context.can("reviews.decide")}
            viewerId={context.me.userId}
          />
        )}
      </div>
    </PageSection>
  );
}
