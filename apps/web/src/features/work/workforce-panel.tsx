"use client";

import { useRouter } from "next/navigation";
import {
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";

import type {
  WorkforceDraftDto,
  WorkforceJobDetailDto,
  WorkforceOverviewDto,
  QApprovalView,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";
import {
  Check,
  ChevronDown,
  Hand,
  ICON_STROKE,
  RotateCw,
  Square,
  X,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { approveQApprovalAction } from "@/features/q/actions";

import { moreWorkforceJobsAction } from "./workforce-actions";

import {
  costRows,
  dollars,
  draftChain,
  gradeRules,
  jobLines,
  jobStatus,
  jobSubtitle,
  jobTitle,
  markAgainst,
  needsYou,
  outOfTen,
  teamMembers,
  type JobLine,
  type StepState,
} from "./workforce-view";
import { workStateOf } from "./job-state";
import { WorkforceDocuments } from "./workforce-documents";
import { WorkforcePlan } from "./workforce-plan";
import { WorkLiveLine, isLiveWork } from "./work-live-line";
import { useT } from "@/features/i18n/language";

/**
 * Q's team (founder brief J5; approved mockup 2026-10-06 b/workforce): on
 * the Work page, each job as a run log -- the specialist that owns each
 * step, the hand-offs, the reviewer's score against the bar (a draft sent
 * back, the one that passed), and the approval tied to the exact text --
 * beside who is on what and what Q's work cost this month against the
 * limit. Two columns on a desktop; Now, Team and Cost tabs on a phone.
 *
 * Approving here is the Approval Engine's own approve on the draft's card,
 * the same call the card's button makes; the approval binds to the text
 * shown.
 */

type Tab = "now" | "team" | "cost";

const ICON = { size: 14, strokeWidth: ICON_STROKE } as const;
const subscribeHydration = () => () => undefined;

/** HH:MM in the reader's own clock; the server's may differ, so no warning. */
function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function WorkforcePanel({
  overview,
  jobs,
  initialTab = "now",
  openDraftId,
  part = "all",
  nextCursor = null,
}: {
  readonly overview: WorkforceOverviewDto | null;
  readonly jobs: readonly WorkforceJobDetailDto[] | null;
  readonly initialTab?: Tab | undefined;
  /**
   * The Work page shows the jobs under In progress and the team and cost
   * under their own tabs (P7); the design review page shows it all.
   */
  readonly part?: "all" | "jobs" | undefined;
  /** A draft shown open (the design review page renders it this way). */
  readonly openDraftId?: string | undefined;
  /** Older jobs, read a page at a time by cursor; null: none. */
  readonly nextCursor?: string | null | undefined;
}) {
  const t = useT();

  const [older, setOlder] = useState<readonly WorkforceJobDetailDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  const [loading, startLoading] = useTransition();
  const [moreFailed, setMoreFailed] = useState(false);
  const more = () => {
    if (cursor === null) return;
    startLoading(async () => {
      const page = await moreWorkforceJobsAction(cursor).catch(() => null);
      if (page === null) {
        setMoreFailed(true);
        return;
      }
      setMoreFailed(false);
      setOlder((was) => {
        const ids = new Set(was.map((one) => one.job.id));
        return [...was, ...page.jobs.filter((one) => !ids.has(one.job.id))];
      });
      setCursor(page.nextCursor);
    });
  };
  const [tab, setTab] = useState<Tab>(initialTab);
  const [reading, setReading] = useState<{
    readonly job: WorkforceJobDetailDto;
    readonly draftId: string;
  } | null>(() => {
    if (openDraftId === undefined || jobs === null) return null;
    const job = jobs.find((one) =>
      one.drafts.some((draft) => draft.id === openDraftId),
    );
    return job === undefined ? null : { job, draftId: openDraftId };
  });

  if (overview === null || jobs === null) {
    return (
      <section aria-labelledby="workforce-heading" data-workforce>
        <h2 id="workforce-heading" className="cq-title-sm">
          {t("Q’s team")}
        </h2>
        <p className="cq-body-sm mt-1 text-(--cq-text-secondary)">
          {t("Q’s team couldn’t load. Try again in a moment.")}
        </p>
      </section>
    );
  }

  const needs = jobs.filter(needsYou).length;
  const open = Math.max(
    overview.jobs.open,
    jobs.filter((job) => job.job.status !== "DONE").length,
  );

  return (
    <section
      aria-labelledby="workforce-heading"
      className="flex flex-col"
      data-workforce
    >
      <header className="mb-2.5 flex flex-wrap items-end gap-2 lg:mb-[18px] lg:gap-4">
        <div>
          <h2
            id="workforce-heading"
            className="m-0 text-[24px] leading-[1.2] font-medium tracking-[-0.01em]"
          >
            {t("Q’s team")}
          </h2>
          <p className="cq-body-sm mt-0.5 text-(--cq-text-secondary)">
            {open} {open === 1 ? "job" : "jobs"}. {needs}{" "}
            {needs === 1 ? "needs" : "need"} {t("you.")}
          </p>
        </div>
        <div className="flex w-full items-baseline gap-2 lg:ms-auto lg:block lg:w-auto lg:text-end">
          <b className="cq-numeric font-(family-name:--cq-font-editorial) text-[22px] leading-none font-medium">
            {t(dollars(overview.spentUsd))}
          </b>
          <span className="cq-label text-(--cq-text-secondary) lg:mt-1 lg:block lg:font-normal">
            {t("this month")}
            {overview.limitUsd === null
              ? ""
              : t(
                  `, of your ${dollars(overview.limitUsd).replace(".00", "")} limit`,
                )}
          </span>
        </div>
      </header>

      {part === "jobs" ? (
        <div className="min-w-0">
          {jobs.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t(
                "No jobs yet. Give Q a task above and its team takes it from there.",
              )}
            </p>
          ) : (
            [
              ...jobs,
              ...older.filter(
                (one) => !jobs.some((job) => job.job.id === one.job.id),
              ),
            ].map((job) => (
              <JobCard
                key={job.job.id}
                job={job}
                onRead={(draftId) => {
                  setReading({ job, draftId });
                }}
              />
            ))
          )}
          {cursor === null ? null : (
            <button
              type="button"
              onClick={more}
              disabled={loading}
              className="inline-flex min-h-11 items-center gap-1 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary) disabled:opacity-60"
              data-more-jobs
            >
              {moreFailed
                ? t("Couldn’t load more. Try again")
                : t("Show older jobs")}
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label={t("Q’s team")}
            className="-mx-4 mb-3.5 flex gap-1 border-b border-(--cq-border-subtle) px-3 lg:hidden"
          >
            {(
              [
                ["now", "Now"],
                ["team", "Team"],
                ["cost", "Cost"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => {
                  setTab(key);
                }}
                className={cx(
                  "min-h-11 cursor-pointer border-b-2 bg-transparent px-3 font-medium",
                  tab === key
                    ? "border-(--cq-accent) text-(--cq-text-primary)"
                    : "border-transparent text-(--cq-text-secondary)",
                )}
              >
                {t(label)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className={cx("min-w-0", tab !== "now" && "hidden lg:block")}>
              <h3 className="mb-2.5 hidden text-[15px] font-semibold lg:block">
                {t("Now")}
              </h3>
              {jobs.length === 0 ? (
                <p className="cq-body-sm text-(--cq-text-secondary)">
                  {t(
                    "No jobs yet. Give Q a task above and its team takes it from there.",
                  )}
                </p>
              ) : (
                jobs.map((job) => (
                  <JobCard
                    key={job.job.id}
                    job={job}
                    onRead={(draftId) => {
                      setReading({ job, draftId });
                    }}
                  />
                ))
              )}
            </div>
            <div className={cx("min-w-0", tab === "now" && "hidden lg:block")}>
              <div className={cx(tab === "cost" && "hidden lg:block")}>
                <Team overview={overview} />
              </div>
              <div className={cx(tab === "team" && "hidden lg:block")}>
                <Cost overview={overview} first={tab === "cost"} />
              </div>
            </div>
          </div>
        </>
      )}

      <DraftSheet
        reading={reading}
        onClose={() => {
          setReading(null);
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// A job, as a run log
// ---------------------------------------------------------------------------

function StatusIcon({
  icon,
}: {
  readonly icon: "hand" | "refresh" | "check" | "stop";
}) {
  const props = { ...ICON, "aria-hidden": true } as const;
  switch (icon) {
    case "hand":
      return <Hand {...props} />;
    case "check":
      return <Check {...props} />;
    case "stop":
      return <Square {...props} />;
    case "refresh":
      return <RotateCw {...props} />;
  }
}

/** A job's latest steps shown before "Show N earlier steps". */
const JOB_LINES_PREVIEW = 6;

function JobCard({
  job,
  onRead,
}: {
  readonly job: WorkforceJobDetailDto;
  readonly onRead: (draftId: string) => void;
}) {
  const t = useT();

  const needs = needsYou(job);
  const status = jobStatus(job.job, needs);
  const [all, setAll] = useState(false);
  // Zino, 2026-10-08: the writer's and reviewer's drafts are not rows; each
  // message's outcome line opens "How Q wrote this" (the draft sheet).
  const lines = (
    job.job.status === "DONE" && !needs ? [] : jobLines(job)
  ).filter(
    (line) =>
      line.kind !== "step" ||
      !(line.key.startsWith("draft:") || line.key.startsWith("grade:")),
  );
  const shown = all ? lines : lines.slice(-JOB_LINES_PREVIEW);
  return (
    <article
      className="mb-3 overflow-hidden rounded-[16px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) [contain-intrinsic-size:auto_160px] [content-visibility:auto]"
      data-job={job.job.id}
      data-work-state={workStateOf(job.job)}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 py-3 pe-2 ps-4">
        <div className="min-w-0">
          <h4 className="m-0 text-[15.5px] font-semibold">
            {t(jobTitle(job.job.goal))}
          </h4>
          <p className="mt-0.5 text-[13px] text-(--cq-text-secondary)">
            <span suppressHydrationWarning>{t(jobSubtitle(job, clock))}</span>
          </p>
        </div>
        <span
          className={cx(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium whitespace-nowrap",
            status.tone === "needs"
              ? "bg-(--cq-accent-soft) text-(--cq-accent)"
              : "bg-(--cq-surface-subtle)",
          )}
        >
          <StatusIcon icon={status.icon} />
          {t(status.label)}
        </span>
      </div>
      {/* Owner 2026-10-24: a document being made shows where it stands. */}
      {isLiveWork(job.job.workState) ? (
        <div className="border-t border-(--cq-border-subtle) px-4 py-3">
          <WorkLiveLine jobId={job.job.id} />
        </div>
      ) : null}
      <WorkforcePlan plan={job.plan} />
      {lines.length > shown.length ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 w-full border-t border-(--cq-border-subtle) px-4 text-start cq-label font-normal text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
        >
          {t(`Show ${String(lines.length - shown.length)} earlier steps`)}
        </button>
      ) : null}
      {shown.length > 0 ? (
        <ol className="m-0 list-none border-t border-(--cq-border-subtle) px-4 pt-1 pb-3">
          {shown.map((line, index) =>
            line.kind === "handoff" ? (
              <li
                key={line.key}
                className="flex items-center gap-1.5 pb-0.5 ps-[62px] text-[12.5px] text-(--cq-text-tertiary) lg:ps-[66px]"
              >
                <ChevronDown {...ICON} aria-hidden="true" />
                {line.text}
              </li>
            ) : (
              <Step
                key={line.key}
                line={line}
                last={index === shown.length - 1}
                onRead={onRead}
              />
            ),
          )}
        </ol>
      ) : null}
      <WorkforceDocuments
        documents={job.documents ?? []}
        unavailable={job.documentsUnavailable ?? false}
      />
      <PreparedApprovals
        approvals={job.approvals ?? []}
        unavailable={job.approvalsUnavailable ?? false}
      />
    </article>
  );
}

function approvalState(view: QApprovalView): string {
  switch (view.action.actionStatus) {
    case "EXECUTED":
      return "Completed";
    case "FAILED":
      return "Action failed";
    case "RECONCILIATION_REQUIRED":
      return "Outcome needs checking";
    case "EXECUTING":
      return "In progress";
    case "APPROVED":
    case "AWAITING_APPROVAL":
    case "PROPOSED":
    case "REJECTED":
    case "EXPIRED":
    case "WITHDRAWN":
      return {
        APPROVED: "Approved; waiting to run.",
        PENDING: "This approval can’t be decided right now.",
        REJECTED: "Rejected",
        EXPIRED: "Expired",
        REVOKED: "Withdrawn",
      }[view.status];
  }
}

function PreparedApprovals({
  approvals,
  unavailable,
}: {
  readonly approvals: readonly QApprovalView[];
  readonly unavailable: boolean;
}) {
  const t = useT();

  if (approvals.length === 0 && !unavailable) return null;
  return (
    <section
      aria-label={t("Prepared actions")}
      className="border-t border-(--cq-border-subtle) px-4 py-3"
    >
      {approvals.map((view) => (
        <details
          key={view.approvalId}
          data-workforce-approval={view.approvalId}
        >
          <summary className="cq-label cursor-pointer py-2">
            {t(view.action.summary)}
          </summary>
          <p className="cq-body-sm mb-3 whitespace-pre-line text-(--cq-text-secondary)">
            {t(view.action.preview ?? view.action.summary)}
          </p>
          {view.status === "PENDING" &&
          view.canDecide &&
          view.action.actionStatus === "AWAITING_APPROVAL" ? (
            <ApproveButton approvalId={view.approvalId}>
              {t("Approve this action")}
            </ApproveButton>
          ) : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {t(approvalState(view))}
            </p>
          )}
        </details>
      ))}
      {unavailable ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t("An approval from this job isn’t available right now.")}
        </p>
      ) : null}
    </section>
  );
}

function StateDot({ state }: { readonly state: StepState }) {
  const t = useT();

  const base =
    "relative z-[1] mt-1.5 grid h-[22px] w-[22px] place-items-center rounded-full";
  switch (state) {
    case "done":
      return (
        <span
          className={cx(base, "bg-(--cq-positive) text-(--cq-surface-raised)")}
        >
          <Check {...ICON} aria-hidden="true" />
          <span className="sr-only">{t("Done")}</span>
        </span>
      );
    case "run":
      return (
        <span
          className={cx(
            base,
            "bg-(--cq-surface-raised) border-2 border-(--cq-accent)",
          )}
        >
          <span className="h-2 w-2 rounded-full bg-(--cq-accent) motion-safe:animate-pulse" />
          <span className="sr-only">{t("Working")}</span>
        </span>
      );
    case "back":
      return (
        <span
          className={cx(
            base,
            "bg-(--cq-surface-raised) border-2 border-(--cq-warning) text-(--cq-warning)",
          )}
        >
          <RotateCw {...ICON} aria-hidden="true" />
          <span className="sr-only">{t("Sent back")}</span>
        </span>
      );
    case "you":
      return (
        <span
          className={cx(
            base,
            "bg-(--cq-surface-raised) border-2 border-(--cq-accent) text-(--cq-accent)",
          )}
        >
          <Hand {...ICON} aria-hidden="true" />
          <span className="sr-only">{t("Needs you")}</span>
        </span>
      );
    case "wait":
      return (
        <span
          className={cx(
            base,
            "bg-(--cq-surface-raised) border-2 border-dashed border-(--cq-border-strong)",
          )}
        >
          <span className="sr-only">{t("Waiting")}</span>
        </span>
      );
  }
}

function Mono({
  text,
  tone,
}: {
  readonly text: string;
  readonly tone: "lead" | "you" | "plain";
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid h-[30px] w-[30px] place-items-center rounded-[10px] text-[11.5px] font-semibold tracking-[0.01em] lg:h-[34px] lg:w-[34px] lg:text-[12.5px]",
        tone === "lead"
          ? "cq-cinema bg-(--cq-stage-canvas) text-(--cq-stage-q-core)"
          : tone === "you"
            ? "bg-(--cq-accent-soft) text-(--cq-accent)"
            : "bg-(--cq-surface-subtle) text-(--cq-text-secondary)",
      )}
    >
      {text}
    </span>
  );
}

function Step({
  line,
  last,
  onRead,
}: {
  readonly line: Extract<JobLine, { kind: "step" }>;
  readonly last: boolean;
  readonly onRead: (draftId: string) => void;
}) {
  const t = useT();

  const [hidden, setHidden] = useState(false);
  return (
    <li
      className="relative grid grid-cols-[22px_30px_minmax(0,1fr)] items-start gap-2.5 py-2 lg:grid-cols-[22px_34px_minmax(0,1fr)_auto]"
      data-step={line.state}
      data-work-role={line.role}
      data-work-draft={line.draftId}
    >
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute top-[30px] -bottom-2 start-2.5 w-[1.5px] bg-(--cq-border-subtle)"
        />
      )}
      <StateDot state={line.state} />
      <Mono text={line.mono} tone={line.tone} />
      <div className="min-w-0">
        <span className="block text-[12.5px] text-(--cq-text-tertiary)">
          {line.who}
        </span>
        <b className="text-[14.5px] font-medium">{t(line.title)}</b>
        {line.what === null ? null : (
          <div className="mt-0.5 text-[14px] text-(--cq-text-secondary)">
            {t(line.what)}
          </div>
        )}
        {line.grade === undefined ? null : (
          <div className="cq-numeric mt-0.5 flex items-baseline gap-1">
            <b className="font-(family-name:--cq-font-editorial) text-[18px] leading-none font-medium">
              {t(line.grade.score)}
            </b>
            <small className="text-[12px] text-(--cq-text-tertiary)">
              {t("out of 10")}
              {line.grade.bar === null
                ? ""
                : t(`, the bar is ${line.grade.bar}`)}
            </small>
          </div>
        )}
        {line.feedback === undefined || line.feedback.length === 0 ? null : (
          <p className="mt-1.5 mb-0 rounded-[10px] bg-(--cq-surface-subtle) px-2.5 py-2 text-[13.5px] text-(--cq-text-secondary)">
            {t(line.feedback)}
          </p>
        )}
        {line.readDraftId !== undefined && !hidden ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {line.approval === undefined ? null : (
              <ApproveButton approvalId={line.approval.approvalId} />
            )}
            <Button
              variant="secondary"
              onClick={() => {
                if (line.readDraftId !== undefined) onRead(line.readDraftId);
              }}
            >
              {t("Read the draft")}
            </Button>
            {line.approval === undefined ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  setHidden(true);
                }}
              >
                {t("Not now")}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <time
        className="cq-numeric hidden pt-1 text-[12.5px] text-(--cq-text-tertiary) lg:block"
        dateTime={line.at ?? undefined}
        suppressHydrationWarning
      >
        {line.at === null
          ? line.state === "you"
            ? "now"
            : ""
          : t(clock(line.at))}
      </time>
    </li>
  );
}

export function ApproveButton({
  approvalId,
  children = "Approve and send",
  onDone,
}: {
  readonly approvalId: string;
  readonly children?: ReactNode;
  /** After the approval went through (the live view reads again). */
  readonly onDone?: (() => void) | undefined;
}) {
  const t = useT();

  const router = useRouter();
  const [busy, start] = useTransition();
  const interactive = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="primary"
        disabled={busy || !interactive}
        onClick={() => {
          start(async () => {
            setError(null);
            const result = await approveQApprovalAction(approvalId).catch(
              () => null,
            );
            if (result?.ok !== true) {
              setError(result?.message ?? "That didn't go through. Try again.");
              return;
            }
            onDone?.();
            router.refresh();
          });
        }}
      >
        {children}
      </Button>
      {error === null ? null : (
        <p
          role="alert"
          className="cq-body-sm w-full text-(--cq-text-secondary)"
        >
          {t(error)}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Who's on it, and what it cost
// ---------------------------------------------------------------------------

function Team({ overview }: { readonly overview: WorkforceOverviewDto }) {
  const t = useT();

  const members = teamMembers(overview);
  return (
    <section aria-labelledby="workforce-team">
      <h3 id="workforce-team" className="mb-2.5 text-[15px] font-semibold">
        {t("Who’s on it")}
      </h3>
      <ul className="m-0 list-none rounded-[16px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-0 py-1">
        {members.map((member) => (
          <li
            key={member.role}
            className="grid min-h-14 grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-2 [&+&]:border-t [&+&]:border-(--cq-border-subtle)"
          >
            <Mono
              text={member.mono}
              tone={member.role === "LEAD" ? "lead" : "plain"}
            />
            <div className="min-w-0">
              <strong className="block text-[14.5px] font-medium">
                {member.name}
              </strong>
              <span className="block truncate text-[13px] text-(--cq-text-secondary)">
                {t(member.line)}
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-(--cq-text-secondary)">
              <span
                aria-hidden="true"
                className={cx(
                  "h-[7px] w-[7px] rounded-full",
                  member.state === "on"
                    ? "bg-(--cq-accent)"
                    : member.state === "you"
                      ? "bg-(--cq-warning)"
                      : "bg-(--cq-border-strong)",
                )}
              />
              {t(member.label)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cost({
  overview,
  first,
}: {
  readonly overview: WorkforceOverviewDto;
  readonly first: boolean;
}) {
  const t = useT();

  const rows = costRows(overview);
  const limit =
    overview.limitUsd === null
      ? null
      : dollars(overview.limitUsd).replace(".00", "");
  return (
    <section
      aria-labelledby="workforce-cost"
      className={cx(
        "border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3.5",
        first ? "mt-0 lg:mt-4" : "mt-4",
      )}
    >
      <h3 id="workforce-cost" className="mb-2.5 text-[15px] font-semibold">
        {t("Cost of Q’s work this month")}
      </h3>
      {rows.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t("Nothing spent yet this month.")}
        </p>
      ) : (
        <table className="w-full border-collapse text-[13.5px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td className="w-[120px] py-[5px] align-middle">{row.name}</td>
                <td className="py-[5px] align-middle">
                  <div
                    className="h-2 min-w-0.5 rounded-[4px] bg-(--cq-accent) opacity-85"
                    style={{ width: `${String(row.share)}%` }}
                  />
                </td>
                <td className="cq-numeric w-16 py-[5px] text-end align-middle">
                  {t(dollars(row.usd))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-2 flex justify-between border-t border-(--cq-border-subtle) pt-2.5 text-[14px]">
        <span>{t("Total")}</span>
        <b className="cq-numeric">
          {t(dollars(overview.spentUsd))}
          {limit === null ? "" : t(` of ${limit}`)}
        </b>
      </div>
      <p className="mt-2 text-[13px] text-(--cq-text-secondary)">
        {limit === null
          ? t("No monthly limit is set for Q’s work.")
          : overview.paused
            ? t(
                "The limit is reached: Q starts no new work this month until you raise it.",
              )
            : t(`Q pauses new work and asks you at ${limit}.`)}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The drafts behind one message, side by side
// ---------------------------------------------------------------------------

function DraftCard({
  draft,
  before,
  after,
}: {
  readonly draft: WorkforceDraftDto;
  readonly before: WorkforceDraftDto | undefined;
  readonly after: WorkforceDraftDto | undefined;
}) {
  const t = useT();

  // A draft sent back shows what its redraft cut; the redraft, what it added.
  const marked =
    after !== undefined
      ? markAgainst(draft.body, after.body, "cut")
      : markAgainst(draft.body, before?.body ?? null, "add");
  const rules = gradeRules(draft.grade);
  return (
    <div
      className="border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-3.5 py-3"
      data-work-draft={draft.id}
      data-work-draft-outcome={draft.outcome?.outcome ?? "NONE"}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-[14px] font-semibold">
          {t("Draft")} {draft.attempt}
        </strong>
        {draft.grade === null ? null : (
          <span className="cq-numeric flex items-baseline gap-1">
            <b className="font-(family-name:--cq-font-editorial) text-[18px] leading-none font-medium">
              {t(outOfTen(draft.grade.score))}
            </b>
            <small className="text-[12px] text-(--cq-text-tertiary)">
              {t("of 10")}
            </small>
          </span>
        )}
      </header>
      <p className="m-0 mb-2 font-(family-name:--cq-font-editorial) text-[15px] leading-[1.55] whitespace-pre-line text-(--cq-text-primary)">
        {marked.map((part, index) =>
          part.mark === null ? (
            <span key={index}>{part.text}</span>
          ) : (
            <mark
              key={index}
              className={cx(
                "text-inherit",
                part.mark === "cut"
                  ? "bg-[color-mix(in_oklab,var(--cq-warning)_18%,transparent)] line-through decoration-(--cq-warning)"
                  : "bg-[color-mix(in_oklab,var(--cq-positive)_18%,transparent)]",
              )}
            >
              <span className="sr-only">
                {part.mark === "cut" ? t("Cut: ") : t("Added: ")}
              </span>
              {part.text}
            </mark>
          ),
        )}
      </p>
      {rules.length === 0 ? null : (
        <ul className="m-0 mt-2 grid list-none gap-1.5 p-0 text-[13.5px]">
          {rules.map((rule) => (
            <li
              key={rule.text}
              className="grid grid-cols-[18px_1fr] gap-1.5 text-(--cq-text-secondary)"
            >
              <span
                className={cx(
                  "mt-0.5",
                  rule.ok ? "text-(--cq-positive)" : "text-(--cq-warning)",
                )}
              >
                {rule.ok ? (
                  <Check
                    size={16}
                    strokeWidth={ICON_STROKE}
                    aria-label={t("Meets")}
                  />
                ) : (
                  <X
                    size={16}
                    strokeWidth={ICON_STROKE}
                    aria-label={t("Misses")}
                  />
                )}
              </span>
              {rule.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DraftSheet({
  reading,
  onClose,
}: {
  readonly reading: {
    readonly job: WorkforceJobDetailDto;
    readonly draftId: string;
  } | null;
  readonly onClose: () => void;
}) {
  const t = useT();

  const draft = reading?.job.drafts.find((one) => one.id === reading.draftId);
  const chain =
    reading === null || draft === undefined
      ? []
      : draftChain(reading.job.drafts, draft).slice(-2);
  const pending =
    draft?.outcome?.outcome === "OFFERED" &&
    draft.outcome.approvalStatus === "PENDING" &&
    draft.outcome.approvalId !== null
      ? draft.outcome.approvalId
      : null;
  return (
    <SheetRoot
      open={reading !== null && draft !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {reading === null || draft === undefined ? null : (
        <SheetContent
          title={t(jobTitle(reading.job.job.goal))}
          description={
            draft.counterpartName === null
              ? t("From you.")
              : t(`To ${draft.counterpartName}. From you.`)
          }
          className="lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:w-[520px] lg:-translate-x-1/2 lg:-translate-y-1/2"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {chain.map((one, index) => (
              <DraftCard
                key={one.id}
                draft={one}
                before={index > 0 ? chain[index - 1] : undefined}
                after={index < chain.length - 1 ? chain[index + 1] : undefined}
              />
            ))}
          </div>
          {pending === null ? (
            <p className="mt-2.5 text-[13px] text-(--cq-text-secondary)">
              {draft.outcome?.outcome === "HELD"
                ? t("Q didn’t send this. Send your own, or ask Q to try again.")
                : t("This draft is no longer waiting for you.")}
            </p>
          ) : (
            <>
              <p className="mt-2.5 text-[13px] text-(--cq-text-secondary)">
                {t(
                  "You approve this exact text. If it changes, it needs your approval again.",
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <ApproveButton approvalId={pending} />
                <Button variant="secondary" onClick={onClose}>
                  {t("Not now")}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      )}
    </SheetRoot>
  );
}
