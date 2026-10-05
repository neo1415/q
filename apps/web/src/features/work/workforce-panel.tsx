"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import type {
  WorkforceDraftDto,
  WorkforceJobDetailDto,
  WorkforceOverviewDto,
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
}: {
  readonly overview: WorkforceOverviewDto | null;
  readonly jobs: readonly WorkforceJobDetailDto[] | null;
  readonly initialTab?: Tab | undefined;
  /** A draft shown open (the design review page renders it this way). */
  readonly openDraftId?: string | undefined;
}) {
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
          Q’s team
        </h2>
        <p className="cq-body-sm mt-1 text-(--cq-text-secondary)">
          Q’s team couldn’t load. Try again in a moment.
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
            Q’s team
          </h2>
          <p className="cq-body-sm mt-0.5 text-(--cq-text-secondary)">
            {open} {open === 1 ? "job" : "jobs"}. {needs}{" "}
            {needs === 1 ? "needs" : "need"} you.
          </p>
        </div>
        <div className="flex w-full items-baseline gap-2 lg:ml-auto lg:block lg:w-auto lg:text-right">
          <b className="cq-numeric font-(family-name:--cq-font-editorial) text-[22px] leading-none font-medium">
            {dollars(overview.spentUsd)}
          </b>
          <span className="cq-label text-(--cq-text-secondary) lg:mt-1 lg:block lg:font-normal">
            this month
            {overview.limitUsd === null
              ? ""
              : `, of your ${dollars(overview.limitUsd).replace(".00", "")} limit`}
          </span>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Q’s team"
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
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className={cx("min-w-0", tab !== "now" && "hidden lg:block")}>
          <h3 className="mb-2.5 hidden text-[15px] font-semibold lg:block">
            Now
          </h3>
          {jobs.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              No jobs yet. Give Q a task above and its team takes it from there.
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

function JobCard({
  job,
  onRead,
}: {
  readonly job: WorkforceJobDetailDto;
  readonly onRead: (draftId: string) => void;
}) {
  const needs = needsYou(job);
  const status = jobStatus(job.job, needs);
  const lines = job.job.status === "DONE" && !needs ? [] : jobLines(job);
  return (
    <article
      className="mb-3 overflow-hidden rounded-[16px] border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
      data-job={job.job.id}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 py-3 pr-2 pl-4">
        <div className="min-w-0">
          <h4 className="m-0 text-[15.5px] font-semibold">
            {jobTitle(job.job.goal)}
          </h4>
          <p className="mt-0.5 text-[13px] text-(--cq-text-secondary)">
            <span suppressHydrationWarning>{jobSubtitle(job, clock)}</span>
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
          {status.label}
        </span>
      </div>
      {lines.length > 0 ? (
        <ol className="m-0 list-none border-t border-(--cq-border-subtle) px-4 pt-1 pb-3">
          {lines.map((line, index) =>
            line.kind === "handoff" ? (
              <li
                key={line.key}
                className="flex items-center gap-1.5 pb-0.5 pl-[62px] text-[12.5px] text-(--cq-text-tertiary) lg:pl-[66px]"
              >
                <ChevronDown {...ICON} aria-hidden="true" />
                {line.text}
              </li>
            ) : (
              <Step
                key={line.key}
                line={line}
                last={index === lines.length - 1}
                onRead={onRead}
              />
            ),
          )}
        </ol>
      ) : null}
    </article>
  );
}

function StateDot({ state }: { readonly state: StepState }) {
  const base =
    "relative z-[1] mt-1.5 grid h-[22px] w-[22px] place-items-center rounded-full";
  switch (state) {
    case "done":
      return (
        <span
          className={cx(base, "bg-(--cq-positive) text-(--cq-surface-raised)")}
        >
          <Check {...ICON} aria-hidden="true" />
          <span className="sr-only">Done</span>
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
          <span className="sr-only">Working</span>
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
          <span className="sr-only">Sent back</span>
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
          <span className="sr-only">Needs you</span>
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
          <span className="sr-only">Waiting</span>
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
          ? "bg-(--cq-stage-canvas) text-(--cq-stage-q-core)"
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
  const [hidden, setHidden] = useState(false);
  return (
    <li
      className="relative grid grid-cols-[22px_30px_minmax(0,1fr)] items-start gap-2.5 py-2 lg:grid-cols-[22px_34px_minmax(0,1fr)_auto]"
      data-step={line.state}
    >
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute top-[30px] -bottom-2 left-2.5 w-[1.5px] bg-(--cq-border-subtle)"
        />
      )}
      <StateDot state={line.state} />
      <Mono text={line.mono} tone={line.tone} />
      <div className="min-w-0">
        <span className="block text-[12.5px] text-(--cq-text-tertiary)">
          {line.who}
        </span>
        <b className="text-[14.5px] font-medium">{line.title}</b>
        {line.what === null ? null : (
          <div className="mt-0.5 text-[14px] text-(--cq-text-secondary)">
            {line.what}
          </div>
        )}
        {line.grade === undefined ? null : (
          <div className="cq-numeric mt-0.5 flex items-baseline gap-1">
            <b className="font-(family-name:--cq-font-editorial) text-[18px] leading-none font-medium">
              {line.grade.score}
            </b>
            <small className="text-[12px] text-(--cq-text-tertiary)">
              out of 10
              {line.grade.bar === null ? "" : `, the bar is ${line.grade.bar}`}
            </small>
          </div>
        )}
        {line.feedback === undefined || line.feedback.length === 0 ? null : (
          <p className="mt-1.5 mb-0 rounded-[10px] bg-(--cq-surface-subtle) px-2.5 py-2 text-[13.5px] text-(--cq-text-secondary)">
            {line.feedback}
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
              Read the draft
            </Button>
            {line.approval === undefined ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  setHidden(true);
                }}
              >
                Not now
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
          : clock(line.at)}
      </time>
    </li>
  );
}

function ApproveButton({
  approvalId,
  children = "Approve and send",
}: {
  readonly approvalId: string;
  readonly children?: ReactNode;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="primary"
        disabled={busy}
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
          {error}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Who's on it, and what it cost
// ---------------------------------------------------------------------------

function Team({ overview }: { readonly overview: WorkforceOverviewDto }) {
  const members = teamMembers(overview);
  return (
    <section aria-labelledby="workforce-team">
      <h3 id="workforce-team" className="mb-2.5 text-[15px] font-semibold">
        Who’s on it
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
                {member.line}
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
              {member.label}
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
  const rows = costRows(overview);
  const limit =
    overview.limitUsd === null
      ? null
      : dollars(overview.limitUsd).replace(".00", "");
  return (
    <section
      aria-labelledby="workforce-cost"
      className={cx(
        "rounded-[16px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-3.5",
        first ? "mt-0 lg:mt-4" : "mt-4",
      )}
    >
      <h3 id="workforce-cost" className="mb-2.5 text-[15px] font-semibold">
        Cost of Q’s work this month
      </h3>
      {rows.length === 0 ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Nothing spent yet this month.
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
                <td className="cq-numeric w-16 py-[5px] text-right align-middle">
                  {dollars(row.usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-2 flex justify-between border-t border-(--cq-border-subtle) pt-2.5 text-[14px]">
        <span>Total</span>
        <b className="cq-numeric">
          {dollars(overview.spentUsd)}
          {limit === null ? "" : ` of ${limit}`}
        </b>
      </div>
      <p className="mt-2 text-[13px] text-(--cq-text-secondary)">
        {limit === null
          ? "No monthly limit is set for Q’s work."
          : overview.paused
            ? `The limit is reached: Q starts no new work this month until you raise it.`
            : `Q pauses new work and asks you at ${limit}.`}
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
  // A draft sent back shows what its redraft cut; the redraft, what it added.
  const marked =
    after !== undefined
      ? markAgainst(draft.body, after.body, "cut")
      : markAgainst(draft.body, before?.body ?? null, "add");
  const rules = gradeRules(draft.grade);
  return (
    <div className="rounded-[14px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-3.5 py-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-[14px] font-semibold">
          Draft {draft.attempt}
        </strong>
        {draft.grade === null ? null : (
          <span className="cq-numeric flex items-baseline gap-1">
            <b className="font-(family-name:--cq-font-editorial) text-[18px] leading-none font-medium">
              {outOfTen(draft.grade.score)}
            </b>
            <small className="text-[12px] text-(--cq-text-tertiary)">
              of 10
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
                "rounded-[3px] text-inherit",
                part.mark === "cut"
                  ? "bg-[color-mix(in_oklab,var(--cq-warning)_18%,transparent)] line-through decoration-(--cq-warning)"
                  : "bg-[color-mix(in_oklab,var(--cq-positive)_18%,transparent)]",
              )}
            >
              <span className="sr-only">
                {part.mark === "cut" ? "Cut: " : "Added: "}
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
                    aria-label="Meets"
                  />
                ) : (
                  <X size={16} strokeWidth={ICON_STROKE} aria-label="Misses" />
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

function DraftSheet({
  reading,
  onClose,
}: {
  readonly reading: {
    readonly job: WorkforceJobDetailDto;
    readonly draftId: string;
  } | null;
  readonly onClose: () => void;
}) {
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
          title={jobTitle(reading.job.job.goal)}
          description={
            draft.counterpartName === null
              ? "From you."
              : `To ${draft.counterpartName}. From you.`
          }
          className="lg:inset-x-auto lg:top-1/2 lg:bottom-auto lg:left-1/2 lg:w-[520px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[20px]"
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
                ? "Q didn’t send this. Send your own, or ask Q to try again."
                : "This draft is no longer waiting for you."}
            </p>
          ) : (
            <>
              <p className="mt-2.5 text-[13px] text-(--cq-text-secondary)">
                You approve this exact text. If it changes, it needs your
                approval again.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <ApproveButton approvalId={pending} />
                <Button variant="secondary" onClick={onClose}>
                  Not now
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      )}
    </SheetRoot>
  );
}
