import Link from "next/link";

import { FollowUpStack } from "./follow-up-stack";
import { ownReadiness } from "./readiness-data";
import { PrivateNote, ReadinessTally } from "./readiness-section";
import { serverT } from "@/features/i18n/server";

/**
 * Home's opening for a founder (Q.01/Q.04): the next question Q still
 * wants answered, then the next three steps of their plan, then the
 * readiness tally in words. Read on the server under their own session;
 * nothing renders when there is nothing to show or it cannot be read, so
 * Home stays Q first.
 */
export async function FounderNext() {
  const t = await serverT();
  const readiness = await ownReadiness();
  if (readiness === null) return null;
  const next = readiness.actions
    .filter((action) => action.state === "OPEN")
    .slice(0, 3);
  const followUps = readiness.followUps.filter((item) => item.answerable);
  if (next.length === 0 && followUps.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-6 text-start" data-founder-next>
      <PrivateNote />
      {followUps.length === 0 ? null : (
        <div id="follow-ups">
          <FollowUpStack followUps={followUps} unlessOnStage />
        </div>
      )}
      {next.length === 0 ? null : (
        <section
          aria-labelledby="next-actions-heading"
          className="flex flex-col gap-3"
          data-qp-anchor="fdr.01.home.next-actions"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2
              id="next-actions-heading"
              className="cq-title-sm text-(--cq-text-primary)"
            >
              Next{" "}
              {next.length === 1 ? "action" : `${String(next.length)} actions`}
            </h2>
            <Link
              href="/relationships?view=capital&tab=action-plan"
              className="cq-label text-(--cq-accent) underline-offset-2 hover:underline"
            >
              {t("Action plan")}
            </Link>
          </div>
          <ol className="overflow-hidden border border-(--cq-border-subtle) bg-(--cq-surface)">
            {next.map((action, index) => (
              <li
                key={action.key}
                className="grid grid-cols-[1.75rem_1fr] gap-3 border-t border-(--cq-border-subtle) px-4 py-3 first:border-t-0 sm:grid-cols-[1.75rem_1fr_auto]"
              >
                <span
                  aria-hidden="true"
                  className="cq-caption grid size-6 place-items-center border border-(--cq-border-strong) text-(--cq-text-secondary)"
                >
                  {index + 1}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="cq-body font-semibold text-(--cq-text-primary)">
                    {t(action.title)}
                  </span>
                  <span className="cq-body-sm text-(--cq-text-secondary)">
                    {t(action.why)}
                  </span>
                </div>
                <span className="cq-caption col-start-2 text-(--cq-text-tertiary) sm:col-start-3">
                  {t(action.ownerLabel)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section
        aria-labelledby="stop-raise-home"
        className="flex flex-col gap-2"
        data-qp-anchor="fdr.01.home.stop-raise"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="stop-raise-home"
            className="cq-title-sm text-(--cq-text-primary)"
          >
            {t("What could stop your raise")}
          </h2>
          <Link
            href="/relationships?view=capital&tab=readiness"
            className="cq-label text-(--cq-accent) underline-offset-2 hover:underline"
          >
            {t("Readiness")}
          </Link>
        </div>
        <ReadinessTally readiness={readiness} />
      </section>
    </div>
  );
}
