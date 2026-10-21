import type { Metadata } from "next";

import { listReviews } from "@capital-q/api-client";
import { ICON_SIZE, ICON_STROKE, UserRound } from "@capital-q/ui/icons";

import { apiSession } from "@/features/q/context";
import { ReviewForm } from "@/features/reviews/review-form";
import { SUBJECT_OPTIONS } from "@/features/reviews/review-subjects";
import { AccountToastProvider } from "@/features/settings/account-kit";
import {
  AccountColumn,
  AccountHead,
  GroupHead,
} from "@/features/settings/account-layout";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Ask for a review" };
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
    timeZone: "UTC",
  });
}

/**
 * Ask for a review (appeals Stage 4, PADL #050; chosen design "Short
 * form, answer promised", 2026-10-21): a person at Capital Q, not Q, looks
 * again at something Q said or did. A review checks the evidence; it
 * doesn't bypass it. Answers already given are listed under the form.
 */
export default async function ReviewsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await serverT();
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
    <AccountToastProvider>
      <AccountColumn width="form">
        <QSection id="reviews" kind="REVIEW_LIST" label="reviews">
          <AccountHead
            title={t("Ask for a review")}
            sub={t(
              "If something Q said or did looks wrong, a person can look at it.",
            )}
          />
          <div className="flex flex-col gap-4">
            <p className="m-0 flex items-start gap-2 text-[13px] text-(--cq-text-secondary)">
              <UserRound
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
                aria-hidden="true"
                className="mt-px flex-none"
              />
              <span>
                {t(
                  "A person at Capital Q reads it, not Q. They answer within 3 days, and you get a notice.",
                )}
              </span>
            </p>
            <ReviewForm
              subject={params["subject"] ?? "Q_ASSESSMENT"}
              subjectRef={subjectRef}
            />
          </div>
          {reviews === null || reviews.length === 0 ? null : (
            <section aria-labelledby="reviews-yours">
              <GroupHead id="reviews-yours" title={t("Your requests")} />
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {reviews.map((review) => (
                  <li
                    key={review.reviewId}
                    className="flex flex-col gap-2 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-[18px] py-4"
                    data-review={review.status}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <b className="text-[15px] font-medium text-(--cq-text-primary)">
                        {t(
                          SUBJECT_OPTIONS.find(
                            (o) => o.value === review.subjectType,
                          )?.label ?? "Something else",
                        )}
                      </b>
                      <span className="text-xs text-(--cq-text-tertiary)">
                        {t(`Asked ${day(review.createdAt)}`)}
                        {" · "}
                        {review.status === "OPEN"
                          ? t(`With Capital Q, answer by ${day(review.dueAt)}`)
                          : review.outcome === null
                            ? t("Decided")
                            : t(OUTCOME_WORDS[review.outcome])}
                      </span>
                    </div>
                    <p className="m-0 text-sm text-(--cq-text-secondary)">
                      &ldquo;{review.reason}&rdquo;
                    </p>
                    {review.decisionReason === null ? null : (
                      <p className="m-0 rounded-e-[10px] border-s-[3px] border-(--cq-positive) bg-(--cq-surface) px-3.5 py-2.5 text-sm text-(--cq-text-primary)">
                        {review.decisionReason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {reviews === null ? (
            <p className="mt-6 text-[13px] text-(--cq-text-tertiary)">
              {t("Your earlier requests couldn't load. Nothing is lost.")}
            </p>
          ) : null}
        </QSection>
      </AccountColumn>
    </AccountToastProvider>
  );
}
