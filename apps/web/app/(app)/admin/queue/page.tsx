import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAdminReviews,
  getAdminVerificationQueue,
} from "@capital-q/api-client";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { adminContext } from "@/features/admin/admin-context";
import { QueueKeys } from "@/features/admin/queue-keys";
import { ReviewQueue } from "@/features/admin/review-queue";
import { VerificationQueue } from "@/features/admin/verification-queue";

export const metadata: Metadata = { title: "Queue · Admin" };

type Tab = "verification" | "reviews";

/**
 * The review queue (design-48; lead decision): verification requests and
 * human reviews on one page, one tab each with its count, oldest first.
 * /admin/verification and /admin/reviews redirect here. Each tab is read
 * only with its own permission, exactly as the two pages were.
 */
export default async function AdminQueuePage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly tab?: string | undefined;
    readonly all?: string | undefined;
  }>;
}) {
  const context = await adminContext();
  const canVerify = context?.can("verification.read") ?? false;
  const canReview = context?.can("reviews.read") ?? false;
  if (context === null || (!canVerify && !canReview)) notFound();
  const query = await searchParams;
  const all = query.all === "1";
  const [verification, reviews] = await Promise.all([
    canVerify
      ? getAdminVerificationQueue(context.session)
          .then((result) => result.rows)
          .catch(() => null)
      : Promise.resolve(undefined),
    canReview
      ? getAdminReviews(context.session, all)
          .then((result) => result.rows)
          .catch(() => null)
      : Promise.resolve(undefined),
  ]);
  const tab: Tab =
    query.tab === "reviews" && canReview
      ? "reviews"
      : query.tab === "verification" && canVerify
        ? "verification"
        : canVerify
          ? "verification"
          : "reviews";

  const tabs = [
    canVerify
      ? {
          key: "verification" as const,
          label: "Verification",
          rows: verification,
        }
      : null,
    canReview
      ? { key: "reviews" as const, label: "Reviews", rows: reviews }
      : null,
  ].filter((entry) => entry !== null);

  return (
    <section aria-labelledby="queue-heading" className="flex flex-col gap-4">
      <h2 id="queue-heading" className="cq-title-md text-(--cq-text-primary)">
        Queue
      </h2>
      <nav
        aria-label="Queues"
        className="inline-flex gap-1 self-start rounded-(--cq-radius-md) bg-(--cq-surface-subtle) p-1"
      >
        {tabs.map((entry) => (
          <Link
            key={entry.key}
            href={`/admin/queue?tab=${entry.key}`}
            aria-current={entry.key === tab ? "page" : undefined}
            className={`cq-body-sm inline-flex min-h-11 items-center gap-2 rounded-(--cq-radius-sm) px-3 ${
              entry.key === tab
                ? "bg-(--cq-surface-raised) font-medium text-(--cq-text-primary) shadow-(--cq-shadow-xs)"
                : "text-(--cq-text-secondary)"
            }`}
          >
            {entry.label}{" "}
            {entry.rows === null || entry.rows === undefined ? null : (
              <span className="cq-numeric">{entry.rows.length}</span>
            )}
          </Link>
        ))}
      </nav>
      {tab === "verification" ? (
        verification === null || verification === undefined ? (
          <ErrorState
            title="The queue couldn't load"
            description="No decision was made or lost."
          />
        ) : verification.length === 0 ? (
          <EmptyState compact title="No requests waiting" />
        ) : (
          <QueueKeys hint="J / K move · V verify · D decline">
            <VerificationQueue
              rows={verification}
              canDecide={context.can("verification.decide")}
            />
          </QueueKeys>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <Link
            href={
              all
                ? "/admin/queue?tab=reviews"
                : "/admin/queue?tab=reviews&all=1"
            }
            className="cq-body-sm inline-flex min-h-11 items-center self-start underline underline-offset-4"
          >
            {all ? "Open only" : "Include decided"}
          </Link>
          {reviews === null || reviews === undefined ? (
            <ErrorState
              title="Reviews couldn't load"
              description="No decision was made or lost."
            />
          ) : reviews.length === 0 ? (
            <EmptyState compact title="No reviews waiting" />
          ) : (
            <QueueKeys hint="J / K move · V changed · M needs evidence · D upheld">
              <ReviewQueue
                rows={reviews}
                canDecide={context.can("reviews.decide")}
                viewerId={context.me.userId}
              />
            </QueueKeys>
          )}
        </div>
      )}
    </section>
  );
}
