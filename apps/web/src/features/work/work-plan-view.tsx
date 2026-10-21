"use client";

import { useMemo, useState, useTransition } from "react";

import type { WorkforceJobDetailDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Clock, Flag, Play } from "@capital-q/ui/icons";

import { useQSessionOptional } from "@/features/q/q-session";
import { CrmSheet, useCrmToast } from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import { ApprovalDetail } from "./work-inbox";
import { StepMark, UnknownTag, WorkTag, workButton } from "./work-kit";
import { planEntries, type PlanEntry } from "./work-plan";
import { moreWorkforceJobsAction, type WorkforceView } from "./workforce-actions";
import { dollars } from "./workforce-view";

/**
 * How Q is handling it, option 2: the plan (owner 2026-10-21; prototype
 * workteam-2, gold). Every piece of Q's work -- the tasks its team runs
 * and each standing instruction's day -- on the left; the open one's plan
 * on the right: what it works towards, its state, two figures that
 * disagree (kept, never picked), each step with its worker, what it did
 * and what it rests on, the step that waits for the person's yes, and
 * what is missing or not known. On a phone the work is a row of chips.
 */
export function WorkPlanView({
  view,
  onChanged,
}: {
  readonly view: WorkforceView;
  /** After a decision: read the team again now. */
  readonly onChanged: () => void;
}) {
  const t = useT();
  const [older, setOlder] = useState<readonly WorkforceJobDetailDto[]>([]);
  const [cursor, setCursor] = useState(view.nextCursor ?? null);
  const [loading, startLoading] = useTransition();
  const entries = useMemo(
    () =>
      planEntries({
        jobs: [
          ...view.jobs,
          ...older.filter(
            (one) => !view.jobs.some((job) => job.job.id === one.job.id),
          ),
        ],
        instructions: view.overview.instructions ?? [],
      }),
    [view, older],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const entry = entries.find((one) => one.id === picked) ?? entries[0] ?? null;

  const more = () =>
    startLoading(async () => {
      if (cursor === null) return;
      const page = await moreWorkforceJobsAction(cursor).catch(() => null);
      if (page === null) return;
      setOlder((was) => [...was, ...page.jobs]);
      setCursor(page.nextCursor);
    });

  if (entry === null) {
    return (
      <div
        className="flex flex-col items-center gap-2.5 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) p-7 text-center text-(--cq-text-secondary)"
        data-work-plan-empty
      >
        <b className="text-base text-(--cq-text-primary)">
          {t("Nothing in hand yet")}
        </b>
        <span className="cq-body-sm">
          {t(
            "When you give Q a task or a standing instruction, its plan shows here, step by step.",
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="cq-wk-tplan" data-work-plan>
      <div
        className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden"
        role="tablist"
        aria-label={t("Q’s work")}
      >
        {entries.map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            aria-selected={one.id === entry.id}
            onClick={() => setPicked(one.id)}
            className={cx(
              "inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-(--cq-motion-fast)",
              one.id === entry.id
                ? "border-[var(--cq-tile,var(--cq-text-primary))] bg-[var(--cq-tile,var(--cq-text-primary))] text-[var(--cq-on-tile,var(--cq-text-inverse))]"
                : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-primary)",
            )}
            data-plan-chip={one.id}
          >
            {t(shortTitle(one.title))}
          </button>
        ))}
      </div>
      <nav className="cq-wk-jlist hidden lg:flex" aria-label={t("Q’s work")}>
        {entries.map((one) => (
          <button
            key={one.id}
            type="button"
            className="cq-wk-qi"
            aria-current={one.id === entry.id ? "true" : undefined}
            onClick={() => setPicked(one.id)}
            data-plan-entry={one.id}
          >
            <span className="cq-wk-qbody">
              <b>{t(one.title)}</b>
              <span className="cq-label font-normal text-(--cq-text-tertiary)">
                {t(one.state)}
              </span>
            </span>
          </button>
        ))}
        {cursor === null ? null : (
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-2.5 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            disabled={loading}
            onClick={more}
          >
            {loading ? t("Loading…") : t("Show older work")}
          </button>
        )}
      </nav>
      <div className="cq-wk-plan-card">
        <Plan key={entry.id} entry={entry} onChanged={onChanged} />
      </div>
    </div>
  );
}

function shortTitle(title: string): string {
  const words = title.split(/\s+/u);
  return words.length <= 3 ? title : `${words.slice(0, 3).join(" ")}…`;
}

function Plan({
  entry,
  onChanged,
}: {
  readonly entry: PlanEntry;
  readonly onChanged: () => void;
}) {
  const t = useT();
  const toast = useCrmToast();
  const session = useQSessionOptional();
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const approval = open === null ? null : (entry.approvals.get(open) ?? null);

  return (
    <div className="cq-wk-in flex flex-col gap-4" data-plan={entry.id}>
      <div className="cq-label font-normal text-(--cq-text-tertiary)">
        {t("Working towards")}
      </div>
      <h2 className="cq-wk-pg">{t(entry.goal)}</h2>
      <div className="flex flex-wrap items-center gap-2.5">
        <WorkTag
          tone={entry.waiting ? "move" : "positive"}
          icon={
            entry.waiting ? (
              <Clock aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )
          }
        >
          {t(entry.state)}
        </WorkTag>
        <span className="cq-label font-normal text-(--cq-text-tertiary)">
          {t(entry.forWords)}
        </span>
        {entry.spentUsd === null ? null : (
          <span className="cq-label font-normal cq-numeric text-(--cq-text-tertiary)">
            {t(`${dollars(entry.spentUsd)} spent`)}
          </span>
        )}
      </div>
      {entry.contradictions.map((note) => (
        <div
          key={note}
          className="cq-wk-contra"
          data-resolved={asked.has(note) ? true : undefined}
          data-plan-contradiction
        >
          <Flag size={18} aria-hidden="true" />
          <div>
            <b>{t("Two figures disagree")}</b>
            <p className="m-0 mt-1 mb-2.5 text-(--cq-text-secondary)">
              {t(note)}{" "}
              {t("Both are kept until you confirm which is current.")}
            </p>
            {asked.has(note) ? (
              <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
                {t(
                  "Asked Q. Tell it which is current in the Q panel; the other stays in history.",
                )}
              </p>
            ) : session === null ? null : (
              <button
                type="button"
                className={workButton("secondary", "h-auto min-h-11 lg:min-h-9")}
                onClick={() => {
                  void session.q.ask(
                    `Two figures disagree in "${entry.title}": ${note} Which is current? Show me where each comes from so I can confirm one.`,
                  );
                  setAsked((was) => new Set([...was, note]));
                }}
              >
                {t("Confirm which is current")}
              </button>
            )}
          </div>
        </div>
      ))}
      <ol className="cq-wk-pplan" aria-label={t("The plan")}>
        {entry.steps.map((step) => {
          const waiting =
            step.approvalId !== null && !decided.has(step.approvalId);
          const state =
            step.approvalId !== null && !waiting ? "done" : step.state;
          return (
            <li key={step.key} data-step={state} data-plan-step={state}>
              <StepMark state={state} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="cq-wk-pt">{t(step.title)}</span>
                  <span className="shrink-0 cq-label font-normal text-(--cq-text-tertiary)">
                    {step.who === null ? null : (
                      <span className="me-1.5">{t(step.who)}</span>
                    )}
                    {step.at === null
                      ? t(state === "done" ? "Done" : "Next")
                      : t(step.at)}
                  </span>
                </div>
                {step.did === null ? null : (
                  <p className="m-0 my-1 cq-body-sm text-(--cq-text-secondary)">
                    {t(step.did)}
                  </p>
                )}
                {step.note === null ? null : (
                  <p className="m-0 my-1 cq-label font-normal text-(--cq-text-secondary)">
                    {t(step.note)}
                  </p>
                )}
                {step.why === null ? null : (
                  <p className="m-0 my-1 cq-label font-normal text-(--cq-text-tertiary)">
                    {t("Why:")} {t(step.why)}
                  </p>
                )}
                {step.based.length === 0 ? null : (
                  <span className="cq-label font-normal text-(--cq-text-tertiary)">
                    {t("Based on:")} {step.based.join("; ")}
                  </span>
                )}
                {waiting && step.approvalId !== null ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={workButton("primary")}
                      onClick={() => setOpen(step.approvalId)}
                      data-plan-review={step.approvalId}
                    >
                      {t("Review it")}
                    </button>
                    <span className="cq-label font-normal text-(--cq-text-tertiary)">
                      {t("Needs your approval")}
                    </span>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {entry.missing.length === 0 ? null : (
        <div
          className="flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-3"
          data-plan-missing
        >
          <div className="cq-label font-normal text-(--cq-text-tertiary)">
            {t("Missing or not known")}
          </div>
          {entry.missing.map((one) => (
            <div key={one.what} className="flex flex-wrap items-center gap-2">
              {one.status === "UNKNOWN" ? (
                <UnknownTag />
              ) : (
                <WorkTag tone="gap" icon={<i className="cq-wk-hatch" aria-hidden="true" />}>
                  {t("Missing")}
                </WorkTag>
              )}
              <b className="font-medium">{t(one.what)}</b>
              <span className="cq-label font-normal text-(--cq-text-tertiary)">
                {t(one.words)}
              </span>
            </div>
          ))}
        </div>
      )}
      <CrmSheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
        title={t("Your yes")}
        sub={t(entry.title)}
      >
        {open === null ? null : (
          <ApprovalDetail
            approvalId={open}
            initial={approval}
            name={null}
            named={null}
            relationshipId={null}
            drafts={[]}
            inSheet
            onFinished={() => {
              setDecided((was) => new Set([...was, open]));
              setOpen(null);
              toast(t("Decided. The plan moves on."));
              onChanged();
            }}
          />
        )}
      </CrmSheet>
    </div>
  );
}
