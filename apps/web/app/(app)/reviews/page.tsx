import type { Metadata } from "next";

import { listReviews } from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { apiSession } from "@/features/q/context";
import { ReviewForm, SUBJECT_OPTIONS } from "@/features/reviews/review-form";

export const metadata: Metadata = { title: "Human review" };
export const dynamic = "force-dynamic";

const OUTCOME_WORDS = {
  UPHELD: "The decision stands",
  CHANGED: "The decision was changed",
  NEEDS_EVIDENCE: "More evidence is needed",
} as const;

const REF = /^[A-Za-z0-9_:.-]{1,200}$/;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Human review (appeals Stage 4, PADL #050): ask a person at Capital Q to
 * look again at something Capital Q or Q decided, and see the answers.
 */
export default async function ReviewsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const subjectRef =
    params["ref"] !== undefined && REF.test(params["ref"])
      ? params["ref"]
      : null;
  const session = await apiSession();
  const reviews =
    session === null
      ? null
      : await listReviews(session)
          .then((result) => result.rows)
          .catch(() => null);
  return (
    <PageContainer width="reading">
      <PageHeader
        title="Human review"
        description="Disagree with something Capital Q or Q decided? A person at Capital Q will look at it and answer within 3 days. A review checks the evidence; it doesn't bypass it."
      />
      <div className="flex flex-col gap-10">
        <PageSection id="ask" title="Ask for a review">
          <ReviewForm
            subject={params["subject"] ?? "OTHER"}
            subjectRef={subjectRef}
          />
        </PageSection>
        <PageSection id="yours" title="Your reviews">
          {reviews === null ? (
            <ErrorState
              title="Your reviews couldn't load"
              description="Try again in a moment. Nothing is lost."
            />
          ) : reviews.length === 0 ? (
            <EmptyState compact title="No reviews yet" />
          ) : (
            <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
              {reviews.map((review) => (
                <li key={review.reviewId} className="flex flex-col gap-1 py-3">
                  <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                    {SUBJECT_OPTIONS.find((o) => o.value === review.subjectType)
                      ?.label ?? "A decision"}{" "}
                    ·{" "}
                    {review.status === "OPEN"
                      ? `Waiting · answer by ${day(review.dueAt)}`
                      : review.outcome === null
                        ? "Decided"
                        : OUTCOME_WORDS[review.outcome]}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    Asked {day(review.createdAt)}
                    {review.source === "Q" ? " with Q" : ""}: &ldquo;
                    {review.reason}&rdquo;
                  </span>
                  {review.decisionReason === null ? null : (
                    <span className="cq-body-sm text-(--cq-text-primary)">
                      {review.decisionReason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </div>
    </PageContainer>
  );
}
