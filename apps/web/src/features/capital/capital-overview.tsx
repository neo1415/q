import Link from "next/link";

import type {
  CapitalLedgerDto,
  ReadinessAction,
  ReadinessDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { capitalTabHref } from "./capital-tabs";
import { money, percent, shareOf } from "./money";
import { INSTRUMENT_LABELS } from "./round-labels";
import { NOTICE_WORDS, STATUS_WORDS } from "./round-words";

/**
 * Capital's Overview tab (design: docs/design/2026-10-08/capital-tabs): a
 * short landing. The raise in one card, what could stop it, and the next
 * three steps, each with the way to the tab that holds the rest.
 */

/** Commitments waiting on the founder's own next step. */
export function needsYouCount(ledger: CapitalLedgerDto): number {
  return ledger.commitments.filter((item) => item.next !== null).length;
}

/** Open steps in the action plan's Now column. */
export function nowCount(readiness: ReadinessDto): number {
  return readiness.actions.filter(
    (action) => action.state === "OPEN" && action.priority === "NOW",
  ).length;
}

const ORDER: Readonly<Record<ReadinessAction["priority"], number>> = {
  NOW: 0,
  NEXT: 1,
  LATER: 2,
};

/** The next open steps, Now before Next before Later, in the plan's order. */
export function nextSteps(
  readiness: ReadinessDto,
  limit = 3,
): readonly ReadinessAction[] {
  return readiness.actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => action.state === "OPEN")
    .sort(
      (a, b) =>
        ORDER[a.action.priority] - ORDER[b.action.priority] ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map(({ action }) => action);
}

const PRIORITY_WORDS: Readonly<Record<ReadinessAction["priority"], string>> = {
  NOW: "Now",
  NEXT: "Next",
  LATER: "Later",
};

const card =
  "flex flex-col gap-3 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 sm:p-6";

export function RaiseSummary({
  ledger,
}: {
  readonly ledger: CapitalLedgerDto | null;
}) {
  if (ledger === null) {
    return (
      <section
        className={card}
        aria-labelledby="overview-raise"
        data-state="error"
      >
        <h2
          id="overview-raise"
          className="cq-title-sm text-(--cq-text-primary)"
        >
          Your raise
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Your rounds couldn&apos;t load.
        </p>
        <div>
          <Link
            href={capitalTabHref("raise")}
            className={buttonClassName("secondary")}
          >
            Open Raise &amp; rounds
          </Link>
        </div>
      </section>
    );
  }
  const current =
    ledger.rounds.find((round) => round.id === ledger.currentRoundId) ?? null;
  const waiting = needsYouCount(ledger);
  if (current === null) {
    return (
      <section className={card} aria-labelledby="overview-raise">
        <h2
          id="overview-raise"
          className="cq-title-sm text-(--cq-text-primary)"
        >
          No round open
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Open one to track what you raise in it.
        </p>
        <div>
          <Link
            href={capitalTabHref("raise")}
            className={buttonClassName("primary")}
          >
            Open a round
          </Link>
        </div>
      </section>
    );
  }
  const currency = current.target.currency;
  const raised = shareOf(current.sums.raised, current.target.amount);
  return (
    <section
      className={card}
      aria-labelledby="overview-raise"
      data-overview-raise
    >
      <div className="flex flex-col gap-0.5">
        <h2
          id="overview-raise"
          className="cq-title-sm text-(--cq-text-primary)"
        >
          {current.name}
        </h2>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {INSTRUMENT_LABELS[current.instrument]} ·{" "}
          {STATUS_WORDS[current.status]}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <p className="cq-display cq-numeric text-(--cq-text-primary)">
          {money(current.sums.raised, currency)}
        </p>
        <p className="cq-body-sm cq-numeric text-(--cq-text-secondary)">
          raised of {money(current.target.amount, currency)}, {percent(raised)}
          {" · "}
          {money(current.sums.confirmed, currency)} confirmed
          {" · "}
          {money(current.sums.pledged, currency)} pledged
        </p>
      </div>
      {current.notices.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {current.notices.map((notice) => (
            <li
              key={notice}
              data-notice={notice}
              className="cq-body-sm text-(--cq-text-secondary)"
            >
              {NOTICE_WORDS[notice]}
            </li>
          ))}
        </ul>
      )}
      <div>
        <Link
          href={capitalTabHref("raise")}
          className={buttonClassName("secondary")}
        >
          {waiting === 0
            ? "Open the round"
            : `Open the round · ${String(waiting)} commitment${waiting === 1 ? " needs" : "s need"} you`}
        </Link>
      </div>
    </section>
  );
}

export function StopYourRaise({
  readiness,
}: {
  readonly readiness: ReadinessDto | null;
}) {
  return (
    <section className={card} aria-labelledby="overview-stop">
      <h2 id="overview-stop" className="cq-title-sm text-(--cq-text-primary)">
        What could stop your raise
      </h2>
      {readiness === null ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Your readiness couldn&apos;t load.
        </p>
      ) : readiness.blockers.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Nothing that investors at your stage usually ask for first is missing
          from what you&apos;ve shared.
        </p>
      ) : (
        <ol className="flex flex-col">
          {readiness.blockers.slice(0, 3).map((blocker, index) => (
            <li
              key={blocker.id}
              className="grid grid-cols-[1.5rem_1fr] gap-3 border-t border-(--cq-border-subtle) py-3 first:border-t-0 first:pt-0"
            >
              <span
                aria-hidden="true"
                className="cq-caption grid size-6 place-items-center rounded-full bg-(--cq-warning-soft) font-semibold text-(--cq-warning)"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="cq-body font-semibold text-(--cq-text-primary)">
                  {blocker.title}
                </span>
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {blocker.why}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div>
        <Link
          href={capitalTabHref("readiness")}
          className={buttonClassName("secondary")}
        >
          See readiness
        </Link>
      </div>
    </section>
  );
}

export function NextSteps({
  readiness,
}: {
  readonly readiness: ReadinessDto | null;
}) {
  const steps = readiness === null ? [] : nextSteps(readiness);
  return (
    <section className={card} aria-labelledby="overview-next" data-next-steps>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="overview-next" className="cq-title-sm text-(--cq-text-primary)">
          Next steps
        </h2>
        <Link
          href={capitalTabHref("action-plan")}
          className={buttonClassName("secondary")}
        >
          Open the action plan
        </Link>
      </div>
      {readiness === null ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Your action plan couldn&apos;t load.
        </p>
      ) : steps.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Nothing open. Steps appear here when Q finds a gap worth closing.
        </p>
      ) : (
        <ol className="flex flex-col">
          {steps.map((step, index) => (
            <li
              key={step.key}
              className="grid grid-cols-[1.5rem_1fr] gap-3 border-t border-(--cq-border-subtle) py-3 first:border-t-0"
            >
              <span
                aria-hidden="true"
                className="cq-caption grid size-6 place-items-center rounded-full bg-(--cq-surface-subtle) font-semibold text-(--cq-text-secondary)"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="cq-body font-semibold text-(--cq-text-primary)">
                  {step.title}{" "}
                  <span className="cq-caption rounded-full border border-(--cq-border-subtle) px-2 py-0.5 font-normal text-(--cq-text-secondary)">
                    {PRIORITY_WORDS[step.priority]}
                  </span>
                </span>
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  {step.next}
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  {step.ownerLabel}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
