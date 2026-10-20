"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ReadinessAction, ReadinessDto } from "@capital-q/contracts";
import { Check } from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";

import { crmButton } from "@/features/relationships/crm-kit";

import { markPlanStepAction } from "./readiness-actions";
import { useT } from "@/features/i18n/language";

/**
 * The action plan (Q.04): what to improve, why it matters to investors,
 * what to do next, who does it and whether it is done (design:
 * docs/design/2026-10-07/founder-readiness, "board"). Steps close
 * themselves when Q sees the evidence; the founder may also tick one, and
 * that tick never moves a pillar. Where Q can do the work, the card says
 * so and asks Q, which prepares it for the founder's approval: nothing is
 * changed from here.
 *
 * Now / Next / Done columns on the stone ground (design 2026-10-20), one
 * under another on a phone. Tick a step and it moves to Done at once; the
 * server confirms it, and an untick moves it back.
 */

const COLUMNS = [
  { key: "NOW", label: "Now" },
  { key: "NEXT", label: "Next" },
  { key: "DONE", label: "Done" },
] as const;
type Column = (typeof COLUMNS)[number]["key"];

const PILLAR_LABEL: Readonly<Record<string, string>> = {
  FOUNDER: "Team",
  MARKET_OPPORTUNITY: "Market",
  PRODUCT_AND_SOLUTION: "Product",
  COMMERCIAL_VALIDATION: "Traction",
  BUSINESS_ECONOMICS: "Financials",
  EXECUTION_CAPACITY: "Execution",
  GOVERNANCE_AND_TRUST: "Governance & trust",
  INVESTMENT_READINESS: "Raise & documents",
};

function columnOf(action: ReadinessAction): Column {
  if (action.state !== "OPEN") return "DONE";
  return action.priority === "NOW" ? "NOW" : "NEXT";
}

function doneLine(action: ReadinessAction): string {
  if (action.state === "DONE_BY_EVIDENCE") return "Closed by evidence";
  const at =
    action.doneAt === null
      ? ""
      : ` · ${new Date(action.doneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  return `You marked it done${at}`;
}

function PlanCard({
  action,
  onDone,
}: {
  readonly action: ReadinessAction;
  /** Ticked here: the card moves to Done before the server answers. */
  readonly onDone: (key: string, done: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { askNow } = useGlobalQ();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const done = action.state !== "OPEN";

  const toggle = (next: boolean) => {
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      onDone(action.key, next);
    }, 350);
    startTransition(async () => {
      const out = await markPlanStepAction(action.key, next);
      setMessage(out.ok ? null : out.message);
      if (out.ok) router.refresh();
      else onDone(action.key, !next);
    });
  };

  return (
    <li
      className={`flex flex-col gap-2 rounded-[10px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-3 py-2.5 transition-[opacity,transform] duration-[220ms] ease-(--cq-ease) ${leaving ? "-translate-y-1.5 opacity-0" : ""}`}
      data-plan-step={action.key}
      data-state={action.state}
    >
      <div className="flex items-start gap-2.5">
        {action.state === "DONE_BY_EVIDENCE" ? (
          <span
            aria-hidden="true"
            className="mt-px inline-grid size-5 flex-none place-items-center rounded-(--cq-radius-sm) border-[1.5px] border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-text-inverse)"
          >
            <Check size={12} strokeWidth={2.6} />
          </span>
        ) : (
          <button
            type="button"
            role="checkbox"
            aria-checked={done || leaving}
            aria-label={t(done ? "Done" : "Mark done")}
            disabled={pending}
            onClick={() => toggle(!done)}
            className={`mt-px inline-grid size-5 flex-none place-items-center rounded-(--cq-radius-sm) border-[1.5px] transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) ${done || leaving ? "border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-text-inverse)" : "border-(--cq-border) bg-(--cq-surface-raised) text-transparent"}`}
          >
            <Check size={12} strokeWidth={2.6} aria-hidden="true" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h4
            className={`text-sm text-(--cq-text-primary) ${done ? "line-through decoration-(--cq-text-tertiary)" : ""}`}
          >
            {t(action.title)}
          </h4>
          <span className="mt-0.5 block text-xs text-(--cq-text-tertiary)">
            {t(PILLAR_LABEL[action.pillar] ?? action.pillar)} ·{" "}
            <span>{done ? t(doneLine(action)) : t(action.ownerLabel)}</span>
          </span>
        </div>
      </div>
      {done ? null : (
        <details className="group ps-[30px]">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center text-xs font-medium text-(--cq-text-secondary) hover:text-(--cq-text-primary) [&::-webkit-details-marker]:hidden">
            {t("Why and how")}
          </summary>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 text-[13px]">
            <dt className="text-(--cq-text-tertiary)">{t("Why")}</dt>
            <dd className="text-(--cq-text-secondary)">{t(action.why)}</dd>
            <dt className="text-(--cq-text-tertiary)">{t("Next")}</dt>
            <dd className="text-(--cq-text-secondary)">{t(action.next)}</dd>
            <dt className="text-(--cq-text-tertiary)">{t("Done when")}</dt>
            <dd className="text-(--cq-text-secondary)">{t(action.doneWhen)}</dd>
          </dl>
        </details>
      )}
      {!done && (action.askQ !== null || action.href !== null) ? (
        <div className="flex flex-wrap items-center gap-2 ps-[30px]">
          {action.askQ !== null ? (
            <button
              type="button"
              onClick={() => {
                if (action.askQ !== null) askNow(action.askQ);
              }}
              className={crmButton("primary")}
              title={t(
                "Q can do this for you. It prepares it and nothing is saved until you approve it.",
              )}
            >
              {t("Let Q do it")}
            </button>
          ) : null}
          {action.href !== null ? (
            <Link href={action.href} className={crmButton("secondary")}>
              {action.href === "/home" ? "Answer Q's question" : t("Go there")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {message === null ? null : (
        <p role="status" className="text-xs text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </li>
  );
}

export function ActionPlanBoard({
  readiness,
}: {
  readonly readiness: ReadinessDto;
}) {
  const t = useT();
  // Ticks made here, until the refreshed plan arrives with them.
  const [ticked, setTicked] = useState<Readonly<Record<string, boolean>>>({});
  const actions = readiness.actions.map((action) =>
    action.key in ticked && action.state !== "DONE_BY_EVIDENCE"
      ? {
          ...action,
          state: ticked[action.key]
            ? ("MARKED_DONE" as const)
            : ("OPEN" as const),
        }
      : action,
  );
  const byColumn = (column: Column) =>
    actions.filter((action) => columnOf(action) === column);

  return (
    <div className="grid gap-3 lg:grid-cols-3" data-action-plan>
      {COLUMNS.map((column) => {
        const items = byColumn(column.key);
        return (
          <section
            key={column.key}
            aria-label={t(column.label)}
            className="flex flex-col gap-2 rounded-(--cq-radius-lg) bg-(--cq-surface-strong) p-2.5 lg:min-h-60"
          >
            <h3 className="flex items-center justify-between px-1.5 py-1 text-[13px] font-semibold text-(--cq-text-primary)">
              {t(column.label)}
              <span className="text-xs font-normal text-(--cq-text-tertiary)">
                {items.length}
              </span>
            </h3>
            {items.length === 0 ? (
              <p className="px-1.5 text-[13px] text-(--cq-text-secondary)">
                {column.key === "DONE"
                  ? t(
                      "Nothing closed yet. Steps close themselves when Q sees the evidence.",
                    )
                  : t("Nothing here right now.")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((action) => (
                  <PlanCard
                    key={action.key}
                    action={action}
                    onDone={(key, done) =>
                      setTicked((current) => ({ ...current, [key]: done }))
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
