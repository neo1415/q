import type { Metadata } from "next";

import { listReviews } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";
import { ReviewsView } from "@/features/reviews/reviews-view";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Ask for a review" };
export const dynamic = "force-dynamic";

const REF = /^[A-Za-z0-9_:.-]{1,200}$/;

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
    <ReviewsView
      t={t}
      subject={params["subject"] ?? "Q_ASSESSMENT"}
      subjectRef={subjectRef}
      reviews={reviews}
    />
  );
}
