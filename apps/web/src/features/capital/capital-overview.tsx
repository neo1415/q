"use client";

import Link from "next/link";

import type {
  CapitalLedgerDto,
  LedgerCommitmentDto,
  ReadinessAction,
  ReadinessDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Flag } from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { QControl } from "@/features/q/control/q-control";
import { crmButton } from "@/features/relationships/crm-kit";
import { formatDay } from "@/components/date-format";

import { CommitmentStepButton } from "./commitment-sheet";
import { capitalTabHref } from "./capital-tabs";
import { money } from "./money";
import { RaiseBar, raiseParts } from "./raise-bar";
import { instrumentLabel } from "./round-labels";
import { NOTICE_WORDS, STATUS_WORDS } from "./round-words";
import { useT } from "@/features/i18n/language";

/**
 * Capital's Summary tab (design 2026-10-20, "Sub-tab strip"): the raise in
 * one card with its bar split by how far each amount has come, what could
 * stop it, and the next three steps as cards, each with its one action.
 * Money waiting on the founder comes first; then the action plan.
 */

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

const card =
  "flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5";

export function RaiseSummary({
  ledger,
}: {
  readonly ledger: CapitalLedgerDto | null;
}) {
  const t = useT();
  if (ledger === null) {
    return (
      <section
        className={card}
        aria-labelledby="overview-raise"
        data-state="error"
      >
        <h2
          id="overview-raise"
          className="text-base font-semibold text-(--cq-text-primary)"
        >
          {t("Your raise")}
        </h2>
        <p className="text-sm text-(--cq-text-secondary)">
          Your rounds couldn&apos;t load.
        </p>
        <div>
          <Link
            href={capitalTabHref("raise")}
            className={crmButton("secondary")}
          >
            {t("Open Raise & rounds")}
          </Link>
        </div>
      </section>
    );
  }
  const current =
    ledger.rounds.find((round) => round.id === ledger.currentRoundId) ?? null;
  if (current === null) {
    return (
      <section className={card} aria-labelledby="overview-raise">
        <h2
          id="overview-raise"
          className="text-base font-semibold text-(--cq-text-primary)"
        >
          {t("No round open")}
        </h2>
        <p className="text-sm text-(--cq-text-secondary)">
          {t("Open one to track what you raise in it.")}
        </p>
        <div>
          <Link href={capitalTabHref("raise")} className={crmButton("primary")}>
            {t("Open a round")}
          </Link>
        </div>
      </section>
    );
  }
  const terms = [
    instrumentLabel(current.instrument),
    STATUS_WORDS[current.status].toLowerCase(),
  ].join(", ");
  return (
    <section
      className={card}
      aria-labelledby="overview-raise"
      data-overview-raise
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2
          id="overview-raise"
          className="text-base font-semibold text-(--cq-text-primary)"
        >
          {t(
            `${current.name}, ${money(current.target.amount, current.target.currency)}`,
          )}
        </h2>
        <span className="text-xs text-(--cq-text-tertiary)">{t(terms)}</span>
      </div>
      <RaiseBar parts={raiseParts(current, ledger.commitments)} words={t} />
      {current.notices.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {current.notices.map((notice) => (
            <li
              key={notice}
              data-notice={notice}
              className="text-[13px] text-(--cq-text-secondary)"
            >
              {t(NOTICE_WORDS[notice])}
            </li>
          ))}
        </ul>
      )}
      <span className="text-xs text-(--cq-text-tertiary)">
        {t("Raised counts only money you confirmed received.")}
      </span>
    </section>
  );
}

export function StopYourRaise({
  readiness,
}: {
  readonly readiness: ReadinessDto | null;
}) {
  const t = useT();
  return (
    <QControl id="section.risks" kind="SECTION">
      <section className={card} aria-labelledby="overview-stop">
        <h2
          id="overview-stop"
          className="text-[13px] font-medium text-(--cq-text-secondary)"
        >
          {t("What could stop it")}
        </h2>
        {readiness === null ? (
          <p className="text-sm text-(--cq-text-secondary)">
            Your readiness couldn&apos;t load.
          </p>
        ) : readiness.blockers.length === 0 ? (
          <p className="text-sm text-(--cq-text-secondary)">
            {t(
              "Nothing that investors at your stage usually ask for first is missing from what you've shared.",
            )}
          </p>
        ) : (
          <QControl id="list.risks" kind="LIST">
            <ol className="flex flex-col gap-2">
              {readiness.blockers.slice(0, 3).map((blocker) => (
                <li
                  key={blocker.id}
                  className="flex items-start gap-2.5 text-sm text-(--cq-text-primary)"
                >
                  <Flag
                    size={15}
                    aria-hidden="true"
                    className="mt-0.5 flex-none text-(--cq-text-secondary)"
                  />
                  <span>
                    {t(blocker.title)}{" "}
                    <span className="text-(--cq-text-secondary)">
                      {t(blocker.why)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </QControl>
        )}
        <Link
          href={capitalTabHref("readiness")}
          className={crmButton("quiet", "self-start")}
        >
          {t("See readiness")}
        </Link>
      </section>
    </QControl>
  );
}

type Step =
  | { readonly kind: "money"; readonly item: LedgerCommitmentDto }
  | { readonly kind: "plan"; readonly action: ReadinessAction };

function moneyStepWords(item: LedgerCommitmentDto): {
  readonly title: string;
  readonly why: string;
} {
  const amount = money(item.amount, item.currencyCode);
  switch (item.next) {
    case "CONFIRM_RECEIVED":
      return {
        title: `Confirm ${item.counterpartName}'s ${amount}`,
        why: `They marked it sent on ${formatDay(item.at)}.`,
      };
    case "CONFIRM_AMOUNT":
      return {
        title: `Confirm ${item.counterpartName}'s ${amount}`,
        why:
          item.status === "DETECTED"
            ? "Q heard it in your call. Nothing counts until you confirm."
            : "They stated it. Confirming tells them you agree.",
      };
    case "MARK_SENT":
    case null:
      return { title: `${item.counterpartName}, ${amount}`, why: "" };
  }
}

export function NextSteps({
  readiness,
  ledger = null,
  currentRoundId = null,
}: {
  readonly readiness: ReadinessDto | null;
  /** Money waiting on the founder comes first. */
  readonly ledger?: CapitalLedgerDto | null;
  readonly currentRoundId?: string | null;
}) {
  const t = useT();
  const { askNow } = useGlobalQ();
  const money_ = (ledger?.commitments ?? [])
    .filter((item) => item.next !== null)
    .map((item): Step => ({ kind: "money", item }));
  const plan = (readiness === null ? [] : nextSteps(readiness)).map(
    (action): Step => ({ kind: "plan", action }),
  );
  const steps = [...money_, ...plan].slice(0, 3);
  return (
    <QControl id="section.next-steps" kind="SECTION">
      <section
        className="flex flex-col gap-3"
        aria-labelledby="overview-next"
        data-next-steps
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2
            id="overview-next"
            className="text-lg font-semibold tracking-[-0.01em] text-(--cq-text-primary)"
          >
            {t("Next three steps")}
          </h2>
          <Link
            href={capitalTabHref("action-plan")}
            className={crmButton("quiet", "ms-auto")}
          >
            {t("Open the action plan")}
          </Link>
        </div>
        {readiness === null && money_.length === 0 ? (
          <p className="text-sm text-(--cq-text-secondary)">
            Your action plan couldn&apos;t load.
          </p>
        ) : steps.length === 0 ? (
          <p className="text-sm text-(--cq-text-secondary)">
            {t(
              "Nothing open. Steps appear here when Q finds a gap worth closing.",
            )}
          </p>
        ) : (
          <ol className="grid gap-3 md:grid-cols-3">
            {steps.map((step, index) => {
              const variant = index === 0 ? "primary" : "secondary";
              const words =
                step.kind === "money"
                  ? moneyStepWords(step.item)
                  : { title: step.action.title, why: step.action.next };
              return (
                <li
                  key={step.kind === "money" ? step.item.id : step.action.key}
                  className="flex flex-col gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-3.5"
                  data-next-step-card={step.kind}
                >
                  <span className="text-xs font-semibold text-(--cq-accent)">
                    {t(`Step ${String(index + 1)}`)}
                  </span>
                  <b className="font-semibold text-(--cq-text-primary)">
                    {t(words.title)}
                  </b>
                  {words.why === "" ? null : (
                    <span className="text-[13px] text-(--cq-text-secondary)">
                      {t(words.why)}
                    </span>
                  )}
                  <span className="mt-auto flex">
                    {step.kind === "money" ? (
                      <CommitmentStepButton
                        item={step.item}
                        side="COMPANY"
                        currentRoundId={currentRoundId}
                        variant={variant}
                        className="w-full"
                      />
                    ) : step.action.askQ !== null ? (
                      <button
                        type="button"
                        className={cx(crmButton(variant), "w-full")}
                        onClick={() => {
                          if (step.action.askQ !== null)
                            askNow(step.action.askQ);
                        }}
                      >
                        {t("Let Q do it")}
                      </button>
                    ) : (
                      <Link
                        href={step.action.href ?? capitalTabHref("action-plan")}
                        className={cx(crmButton(variant), "w-full")}
                      >
                        {step.action.href === null
                          ? t("See it in the plan")
                          : t("Go there")}
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </QControl>
  );
}
