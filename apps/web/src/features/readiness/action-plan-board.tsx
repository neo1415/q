"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ReadinessAction, ReadinessDto } from "@capital-q/contracts";

import { useGlobalQ } from "@/components/app-shell/global-q";

import { markPlanStepAction } from "./readiness-actions";
import { ReadinessStatusBadge } from "./readiness-status";

/**
 * The action plan (Q.04): what to improve, why it matters to investors,
 * what to do next, who does it and whether it is done (design:
 * docs/design/2026-10-07/founder-readiness, "board"). Steps close
 * themselves when Q sees the evidence; the founder may also tick one, and
 * that tick never moves a pillar. Where Q can do the work, the card says
 * so and asks Q, which prepares it for the founder's approval: nothing is
 * changed from here.
 *
 * Desktop: Now / Next / Done columns. Phone: the same columns behind a
 * segmented control, one at a time.
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

function PlanCard({ action }: { readonly action: ReadinessAction }) {
  const router = useRouter();
  const { askNow } = useGlobalQ();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const status =
    columnOf(action) === "DONE"
      ? null
      : action.priority === "NOW"
        ? ("GAP" as const)
        : null;

  const toggle = (done: boolean) =>
    startTransition(async () => {
      const out = await markPlanStepAction(action.key, done);
      setMessage(out.ok ? null : out.message);
      if (out.ok) router.refresh();
    });

  return (
    <li
      className="flex flex-col gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
      data-plan-step={action.key}
      data-state={action.state}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="cq-caption rounded-full border border-(--cq-border) px-2 py-0.5 text-(--cq-text-secondary)">
          {PILLAR_LABEL[action.pillar] ?? action.pillar}
        </span>
        {status === null ? null : <ReadinessStatusBadge status={status} />}
      </div>
      <h4
        className={`cq-body font-semibold text-(--cq-text-primary) ${action.state === "OPEN" ? "" : "line-through decoration-(--cq-text-tertiary)"}`}
      >
        {action.title}
      </h4>
      {action.state === "OPEN" ? (
        <dl className="cq-body-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-(--cq-text-tertiary)">Why</dt>
          <dd className="text-(--cq-text-secondary)">{action.why}</dd>
          <dt className="text-(--cq-text-tertiary)">Next</dt>
          <dd className="text-(--cq-text-secondary)">{action.next}</dd>
          <dt className="text-(--cq-text-tertiary)">Done when</dt>
          <dd className="text-(--cq-text-secondary)">{action.doneWhen}</dd>
          <dt className="text-(--cq-text-tertiary)">Owner</dt>
          <dd className="text-(--cq-text-secondary)">{action.ownerLabel}</dd>
        </dl>
      ) : (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {doneLine(action)}
        </p>
      )}
      {action.state === "OPEN" && action.askQ !== null ? (
        <p className="cq-caption flex items-start gap-2 border-t border-dashed border-(--cq-border) pt-2 text-(--cq-text-secondary)">
          Q can do this for you. It prepares it and nothing is saved until you
          approve it.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {action.state === "OPEN" && action.askQ !== null ? (
          <button
            type="button"
            onClick={() => {
              if (action.askQ !== null) askNow(action.askQ);
            }}
            className="cq-label inline-flex min-h-11 items-center rounded-(--cq-radius-md) bg-(--cq-accent) px-3 text-(--cq-text-inverse) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-9"
          >
            Let Q do it
          </button>
        ) : null}
        {action.state === "OPEN" && action.href !== null ? (
          <Link
            href={action.href}
            className="cq-label inline-flex min-h-11 items-center rounded-(--cq-radius-md) border border-(--cq-border) px-3 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-9"
          >
            {action.href === "/home" ? "Answer Q's question" : "Go there"}
          </Link>
        ) : null}
        {action.state === "DONE_BY_EVIDENCE" ? null : (
          <label className="cq-body-sm inline-flex min-h-11 cursor-pointer items-center gap-2 text-(--cq-text-secondary) lg:min-h-9">
            <input
              type="checkbox"
              className="size-4 accent-(--cq-positive)"
              checked={action.state === "MARKED_DONE"}
              disabled={pending}
              onChange={(event) => toggle(event.target.checked)}
            />
            {action.state === "MARKED_DONE" ? "Done" : "Mark done"}
          </label>
        )}
      </div>
      {message === null ? null : (
        <p role="status" className="cq-caption text-(--cq-text-secondary)">
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
  const [shown, setShown] = useState<Column>("NOW");
  const byColumn = (column: Column) =>
    readiness.actions.filter((action) => columnOf(action) === column);

  return (
    <div className="flex flex-col gap-4" data-action-plan>
      <div
        role="tablist"
        aria-label="Plan columns"
        className="flex gap-1 rounded-(--cq-radius-md) border border-(--cq-border) p-1 lg:hidden"
      >
        {COLUMNS.map((column) => (
          <button
            key={column.key}
            type="button"
            role="tab"
            aria-selected={shown === column.key}
            onClick={() => setShown(column.key)}
            className={`cq-body-sm min-h-11 flex-1 rounded-(--cq-radius-sm) ${shown === column.key ? "bg-(--cq-surface-raised) font-semibold text-(--cq-text-primary)" : "text-(--cq-text-secondary)"}`}
          >
            {column.label} {byColumn(column.key).length}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const items = byColumn(column.key);
          return (
            <section
              key={column.key}
              aria-label={column.label}
              className={`flex-col gap-3 rounded-(--cq-radius-lg) lg:flex lg:min-h-80 lg:bg-(--cq-surface-subtle) lg:p-3 ${shown === column.key ? "flex" : "hidden"}`}
            >
              <h3 className="cq-body hidden items-center justify-between px-1.5 font-semibold text-(--cq-text-primary) lg:flex">
                {column.label}
                <span className="cq-caption font-normal text-(--cq-text-tertiary)">
                  {items.length}
                </span>
              </h3>
              {items.length === 0 ? (
                <p className="cq-body-sm px-1.5 text-(--cq-text-secondary)">
                  {column.key === "DONE"
                    ? "Nothing closed yet. Steps close themselves when Q sees the evidence."
                    : "Nothing here right now."}
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {items.map((action) => (
                    <PlanCard key={action.key} action={action} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
