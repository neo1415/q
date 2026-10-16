"use client";

import type { AdminReviewRowDto } from "@capital-q/contracts";

import { decideReviewAction } from "./console-actions";
import { ReasonAction } from "./console-ui";
import { DecisionBar, QUEUE_ITEM } from "./queue-keys";
import { useT } from "@/features/i18n/language";

const SUBJECT_WORDS: Readonly<Record<string, string>> = {
  READINESS_ASSESSMENT: "Readiness reading",
  VERIFICATION_DECISION: "Verification decision",
  ACCOUNT_ACTION: "Account action",
  Q_ASSESSMENT: "Q assessment",
  OTHER: "Other",
};

const OUTCOME_WORDS = {
  UPHELD: "Upheld",
  CHANGED: "Changed",
  NEEDS_EVIDENCE: "Needs evidence",
} as const;

/** The queue's keys (design-48): V changes, M asks for more, D upholds. */
export const REVIEW_KEYS = {
  CHANGED: "v",
  NEEDS_EVIDENCE: "m",
  UPHELD: "d",
} as const;

/**
 * Appeals Stage 4: the queue, due date first. A decision names its
 * outcome and reason; the person is told. Changing the underlying decision
 * itself happens through its own console section (verification, accounts).
 */
export function ReviewQueue({
  rows,
  canDecide,
  viewerId,
}: {
  readonly rows: readonly AdminReviewRowDto[];
  readonly canDecide: boolean;
  readonly viewerId: string;
}) {
  const t = useT();

  return (
    <ul className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
      {rows.map((row) => (
        <li
          key={row.reviewId}
          {...QUEUE_ITEM}
          className={`flex flex-col gap-2 py-4 ${QUEUE_ITEM.className}`}
        >
          <div className="flex flex-col gap-1">
            <span className="cq-body font-medium text-(--cq-text-primary)">
              {t(SUBJECT_WORDS[row.subjectType] ?? row.subjectType)} ·{" "}
              {row.status === "OPEN"
                ? row.overdue
                  ? t("Overdue")
                  : t(
                      `Due ${new Date(row.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
                    )
                : row.outcome === null
                  ? t("Decided")
                  : t(OUTCOME_WORDS[row.outcome])}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {row.requesterName ?? t("A member")}
              {row.organisationName === null
                ? ""
                : t(` · ${row.organisationName}`)}
              {row.source === "Q" ? t(" · offered by Q") : ""}
              {row.subjectRef === null ? "" : t(` · ref ${row.subjectRef}`)}
            </span>
            <span className="cq-body-sm text-(--cq-text-primary)">
              &ldquo;{t(row.reason)}&rdquo;
            </span>
            {row.decisionReason === null ? null : (
              <span className="cq-caption text-(--cq-text-secondary)">
                {row.decidedByName ?? t("An admin")}: {t(row.decisionReason)}
              </span>
            )}
          </div>
          {canDecide &&
          row.status === "OPEN" &&
          row.requesterUserId !== viewerId ? (
            <DecisionBar>
              {(["CHANGED", "NEEDS_EVIDENCE", "UPHELD"] as const).map(
                (outcome) => (
                  <ReasonAction
                    key={outcome}
                    label={t(OUTCOME_WORDS[outcome])}
                    shortcut={REVIEW_KEYS[outcome]}
                    wide
                    title={t(`${OUTCOME_WORDS[outcome]}: tell them why`)}
                    description={
                      outcome === "CHANGED"
                        ? t(
                            "Make the change itself in its own section first (verification, accounts). They'll see this reason.",
                          )
                        : t(
                            "They'll see this reason in a notice and on their Reviews page.",
                          )
                    }
                    confirm="Send decision"
                    variant={outcome === "CHANGED" ? "primary" : "secondary"}
                    reasonLabel="Reason"
                    run={(reason) =>
                      decideReviewAction({
                        reviewId: row.reviewId,
                        outcome,
                        reason,
                      })
                    }
                  />
                ),
              )}
            </DecisionBar>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
