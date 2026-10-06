"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ComponentType,
  type FormEvent,
} from "react";

import type {
  NamedPicture,
  QApprovalView,
  QPendingApproval,
  QWorkDonePageDto,
  QWorkDto,
  QWorkSuggestionDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button, IconButton } from "@capital-q/ui/button";
import {
  ArrowUp,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ICON_SIZE,
  ICON_STROKE,
  MessageSquare,
  Mic,
  MoreHorizontal,
} from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@capital-q/ui/menu";
import { Skeleton } from "@capital-q/ui/states";

import {
  approveQApprovalAction,
  askQAction,
  readQApprovalAction,
  rejectQApprovalAction,
} from "@/features/q/actions";
import { EntityAvatar, type EntityKind } from "@/features/entity/entity-avatar";
import { EmailDraftEditor } from "@/features/integrations/email-draft-editor";
import { useQSessionOptional } from "@/features/q/q-session";

import { groupNotices, type NoticeGroup } from "./notice-groups";
import type { WorkforceView } from "./workforce-actions";
import { WorkforceCost } from "./workforce-cost";
import { WorkforcePanel } from "./workforce-panel";
import {
  LiveLine,
  WorkforceTeamView,
  useClock,
  useWorkforceLive,
} from "./workforce-section";
import { dollars as usd } from "./workforce-view";
import { noticesRead, refreshNotices, useNotices } from "./notice-store";
import {
  answerWorkAction,
  markReadAction,
  stopWorkAction,
} from "./work-actions";
import {
  dismissSuggestionAction,
  listDoneAction,
  preparedAction,
  setPausedAction,
  type Prepared,
} from "./work-page-actions";

/**
 * Work, Q's work page (WORK-58, founder-approved mockups 2026-10-04).
 *
 * One input ("Give Q a task…", typed or spoken); what Q suggests from the
 * person's own account, each card expanding into Q's plan and the exact
 * approval it binds to; what needs their yes; what runs, as one line each
 * with its spend; what is done, collapsed. Numbers over sentences, one
 * primary action per area, no explanatory paragraphs.
 *
 * Nothing here acts on its own: a task or a tapped card asks Q to prepare
 * it through the normal propose path, and the person approves the exact
 * payload on the usual approval card.
 */

type Props = {
  readonly suggestions: readonly QWorkSuggestionDto[] | null;
  readonly approvals: readonly QPendingApproval[] | null;
  readonly work: readonly QWorkDto[] | null;
  readonly done: QWorkDonePageDto | null;
  /**
   * A suggestion whose card Q already prepared, shown open with its exact
   * approval (the design review page renders it this way).
   */
  readonly prepared?:
    { readonly key: string; readonly view: QApprovalView } | undefined;
  /**
   * Q's team (founder brief J5): its jobs as run logs, who is on what and
   * this month's cost. Absent: the section is not shown; null: it failed.
   */
  readonly workforce?: WorkforceView | null | undefined;
  /** The view shown first (the design review page picks one). */
  readonly initialView?: WorkView | undefined;
  /** False: never read the team again (the design review page). */
  readonly liveReads?: boolean | undefined;
};

export function WorkPage({
  suggestions,
  approvals,
  work,
  done,
  prepared,
  workforce,
  initialView,
  liveReads = true,
}: Props) {
  const running = (work ?? []).filter((item) => item.status === "ACTIVE");
  const timeLanes = running.flatMap((item) =>
    item.lanes
      .filter((lane) => lane.stage === "NEEDS_TIMES" && lane.offered.length > 0)
      .map((lane) => ({ work: item, lane })),
  );
  const [cards, setCards] = useState(suggestions ?? []);
  const [pending, setPending] = useState(approvals ?? []);
  // The Work count in the navigation is these notices (founder 2026-10-05:
  // "it says 2 things, but the page says nothing"): they are listed here.
  const notices = groupNotices(useNotices().items ?? []).needsYou;
  const nothingElse =
    running.length === 0 &&
    pending.length === 0 &&
    notices.length === 0 &&
    timeLanes.length === 0 &&
    (done === null || (done.items.length === 0 && done.thisWeek === 0));

  const needsCount =
    pending.length + timeLanes.length + notices.length + cards.length;
  const doneCount = done?.thisWeek ?? 0;
  // The first screen shows what matters (founder, demo 2026-10-06: the page
  // "just flows down forever"): what waits on them, else what runs.
  const [view, setView] = useState<WorkView>(
    initialView ??
      (needsCount > 0
        ? "needs"
        : running.length > 0 || (workforce?.overview.jobs.open ?? 0) > 0
          ? "progress"
          : "done"),
  );
  // Q's team, read again while the page is visible (P7): In progress,
  // Team and Cost share one reader so they never disagree.
  const live = useWorkforceLive(
    workforce,
    view === "team" || view === "progress",
    liveReads,
  );
  const now = useClock();
  const team = live.data;
  const hasTeam = workforce !== undefined;
  const views: readonly (readonly [WorkView, string, number | string])[] = [
    ["needs", "Needs you", needsCount],
    ["progress", "In progress", running.length],
    ["done", "Done", doneCount],
    ...(hasTeam
      ? ([
          ["team", "Team", team === null ? "" : team.overview.jobs.open],
          ["cost", "Cost", team === null ? "" : usd(team.overview.spentUsd)],
        ] as const)
      : []),
  ];
  const teamNeedsYou = (team?.overview.jobs.needsYou ?? 0) > 0;

  return (
    <div
      className={cx(
        "mx-auto flex w-full flex-col gap-5",
        // The team map needs the room; reading views keep the measure.
        view === "team" || view === "cost"
          ? "max-w-(--cq-layout-content)"
          : "max-w-(--cq-layout-reading)",
      )}
      data-work-page
    >
      <TaskComposer />
      <div
        role="tablist"
        aria-label="Work"
        className="sticky top-[calc(var(--cq-header-height)+var(--cq-safe-top))] z-(--cq-z-sticky) -mx-4 flex gap-1 overflow-x-auto border-b border-(--cq-border-subtle) bg-(--cq-canvas) px-3 [scrollbar-width:none] lg:top-0 lg:-mx-1 lg:px-1"
        data-work-views
      >
        {views.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`work-tab-${key}`}
            aria-selected={view === key}
            aria-controls={`work-view-${key}`}
            onClick={(event) => {
              setView(key);
              event.currentTarget.scrollIntoView({
                block: "nearest",
                inline: "nearest",
              });
            }}
            className={cx(
              "-mb-px flex min-h-11 flex-none items-center gap-1.5 border-b-2 px-2.5 whitespace-nowrap cq-label motion-safe:transition-colors motion-safe:duration-(--cq-motion-fast) lg:px-3",
              view === key
                ? "border-(--cq-text-primary) text-(--cq-text-primary)"
                : "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
            )}
          >
            {label}
            <span
              className={cx(
                "cq-numeric",
                key === "team" && teamNeedsYou
                  ? "font-semibold text-(--cq-accent)"
                  : "font-normal text-(--cq-text-tertiary)",
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>
      {hasTeam &&
      (view === "team" || view === "progress" || view === "cost") ? (
        <div className="-mt-3 flex justify-end">
          <LiveLine live={live} now={now} />
        </div>
      ) : null}
      <div
        role="tabpanel"
        id="work-view-needs"
        aria-labelledby="work-tab-needs"
        hidden={view !== "needs"}
        className="flex flex-col gap-7"
      >
        <NeedsYou
          approvals={pending}
          lanes={timeLanes}
          notices={notices}
          onDecided={(id) => {
            setPending((now) => now.filter((a) => a.approvalId !== id));
          }}
        />
        <Suggestions
          items={cards}
          prepared={prepared}
          failed={suggestions === null}
          onGone={(key) => {
            setCards((now) => now.filter((card) => card.key !== key));
          }}
        />
        {needsCount === 0 ? (
          <p className="cq-body-sm text-(--cq-text-tertiary)">
            Nothing waits on you.
          </p>
        ) : null}
      </div>
      <div
        role="tabpanel"
        id="work-view-progress"
        aria-labelledby="work-tab-progress"
        hidden={view !== "progress"}
        className="flex flex-col gap-7"
      >
        <Running items={running} failed={work === null} />
        {nothingElse ? (
          <p className="cq-body-sm text-(--cq-text-tertiary)">
            Nothing running yet.
          </p>
        ) : null}
        {hasTeam ? (
          <WorkforcePanel
            overview={team?.overview ?? null}
            jobs={team?.jobs ?? null}
            part="jobs"
          />
        ) : null}
      </div>
      {hasTeam ? (
        <div
          role="tabpanel"
          id="work-view-team"
          aria-labelledby="work-tab-team"
          hidden={view !== "team"}
        >
          {team === null ? (
            <TeamUnavailable onRetry={live.refresh} />
          ) : view === "team" ? (
            <WorkforceTeamView
              view={team}
              work={work}
              now={Math.max(now, live.updatedAt)}
              onGoTo={setView}
              onChanged={live.refresh}
            />
          ) : null}
        </div>
      ) : null}
      {hasTeam ? (
        <div
          role="tabpanel"
          id="work-view-cost"
          aria-labelledby="work-tab-cost"
          hidden={view !== "cost"}
        >
          {team === null ? (
            <TeamUnavailable onRetry={live.refresh} />
          ) : (
            <WorkforceCost overview={team.overview} jobs={team.jobs} />
          )}
        </div>
      ) : null}
      <div
        role="tabpanel"
        id="work-view-done"
        aria-labelledby="work-tab-done"
        hidden={view !== "done"}
      >
        {nothingElse ? (
          <p className="cq-body-sm text-(--cq-text-tertiary)">
            Nothing finished yet.
          </p>
        ) : (
          <Done initial={done} defaultOpen />
        )}
      </div>
    </div>
  );
}

type WorkView = "needs" | "progress" | "done" | "team" | "cost";

function TeamUnavailable({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="cq-body-sm m-0 text-(--cq-text-secondary)">
        Q’s team couldn’t load. It keeps working; this view catches up.
      </p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Rows shown before "Show N more" in a long group. */
const GROUP_PREVIEW = 5;

function ShowMore({
  hidden,
  onShow,
}: {
  readonly hidden: number;
  readonly onShow: () => void;
}) {
  if (hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={onShow}
      className="mt-1 inline-flex min-h-11 items-center gap-1 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
    >
      Show {hidden} more
      <ChevronDown
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// The one input
// ---------------------------------------------------------------------------

function TaskComposer() {
  const session = useQSessionOptional();
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<Asked | null>(null);
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const task = text.trim();
    if (task.length === 0) return;
    startTransition(async () => {
      setNotice(null);
      const started = await askQAction(task).catch(() => null);
      if (started?.ok !== true) {
        setNotice(started?.message ?? "Q couldn't take that just now.");
        return;
      }
      setText("");
      setAsked({
        runId: started.value.runId,
        conversationId: started.value.conversationId ?? null,
      });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={submit}
        className="flex min-h-14 items-center gap-2 rounded-(--cq-radius-xl) border border-(--cq-border) bg-(--cq-surface-raised) py-1.5 pr-1.5 pl-4 shadow-(--cq-shadow-xs) focus-within:border-(--cq-border-strong) lg:min-h-16"
        data-work-composer
      >
        <label htmlFor="work-task" className="sr-only">
          Give Q a task
        </label>
        <input
          id="work-task"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Give Q a task…"
          autoComplete="off"
          maxLength={2000}
          className="min-w-0 flex-1 bg-transparent cq-body-lg text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary) lg:text-lg"
        />
        {text.trim().length > 0 ? (
          <button
            type="submit"
            aria-label="Give Q this task"
            disabled={busy}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-(--cq-accent) text-(--cq-text-inverse) motion-safe:transition-transform motion-safe:duration-(--cq-motion-fast) active:scale-[0.97] disabled:opacity-50 lg:size-12"
          >
            <ArrowUp aria-hidden="true" size={20} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Talk to Q"
            disabled={session === null}
            onClick={() => void session?.talk()}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-(--cq-accent) text-(--cq-text-inverse) motion-safe:transition-transform motion-safe:duration-(--cq-motion-fast) active:scale-[0.97] disabled:opacity-50 lg:size-12"
            data-work-mic
          >
            <Mic aria-hidden="true" size={20} strokeWidth={2} />
          </button>
        )}
      </form>
      {notice === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {notice}
        </p>
      )}
      {asked === null ? null : (
        <div className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-4">
          <PreparedPlan
            asked={asked}
            onClose={() => setAsked(null)}
            closeLabel="Close"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// What a task becomes: Q prepares, the person approves the exact card
// ---------------------------------------------------------------------------

type Asked = {
  readonly runId: string;
  readonly conversationId: string | null;
};

const POLL_MS = 1_200;
const POLL_LIMIT = 75;

/** Follows a run Q was asked to prepare until a card, an answer or a failure. */
function usePrepared(runId: string): Prepared | null {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  useEffect(() => {
    let live = true;
    let tries = 0;
    let timer = 0;
    const read = async () => {
      tries += 1;
      const result = await preparedAction(runId).catch(() => null);
      if (!live) return;
      const value: Prepared =
        result?.ok === true ? result.value : { state: "FAILED" };
      if (value.state === "WORKING" && tries < POLL_LIMIT) {
        setPrepared(value);
        timer = window.setTimeout(() => void read(), POLL_MS);
        return;
      }
      setPrepared(value.state === "WORKING" ? { state: "FAILED" } : value);
    };
    void read();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [runId]);
  return prepared;
}

function PreparedPlan({
  asked,
  onClose,
  closeLabel,
  onDecided,
}: {
  readonly asked: Asked;
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly onDecided?: ((approved: boolean) => void) | undefined;
}) {
  const prepared = usePrepared(asked.runId);
  const qPage =
    asked.conversationId === null
      ? "/home"
      : `/home?c=${encodeURIComponent(asked.conversationId)}`;

  if (prepared === null || prepared.state === "WORKING") {
    return (
      <div className="flex flex-col gap-2" role="status">
        <span className="cq-body-sm text-(--cq-text-secondary)">
          Q is preparing it…
        </span>
        <Skeleton lines={2} />
      </div>
    );
  }
  if (prepared.state === "FAILED") {
    return (
      <div className="flex flex-wrap items-center gap-3" role="status">
        <span className="cq-body-sm text-(--cq-text-secondary)">
          Q couldn&rsquo;t prepare that. Nothing was done.
        </span>
        <Link
          href={qPage}
          className="cq-body-sm font-medium text-(--cq-accent) underline-offset-4 hover:underline"
        >
          Ask Q
        </Link>
      </div>
    );
  }
  if (prepared.state === "ANSWER") {
    return (
      <div className="flex flex-col gap-3">
        <p className="cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)">
          {prepared.text}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={qPage}
            className="inline-flex min-h-11 items-center rounded-md px-3 cq-body-sm font-medium text-(--cq-accent) hover:bg-(--cq-surface-subtle) lg:min-h-10"
          >
            Continue with Q
          </Link>
          <Button variant="quiet" size="compact" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <ApprovalPlan
      approvalId={prepared.approvalId}
      editHref={qPage}
      onDone={(approved) => {
        onDecided?.(approved);
        if (onDecided === undefined) onClose();
      }}
      onNotNow={onClose}
      notNowLabel={closeLabel}
    />
  );
}

/**
 * The approval card, minimal: Q's plan in a line, the exact content it
 * binds to, what Q does alone and what it asks first, and Approve. The
 * full bound text stays one tap away, never hidden.
 */
function ApprovalPlan({
  approvalId,
  initialView,
  editHref,
  onDone,
  onNotNow,
  notNowLabel = "Not now",
}: {
  readonly approvalId: string;
  /** Already read on the server: shown at once, read again on a revision. */
  readonly initialView?: QApprovalView | undefined;
  readonly editHref?: string | undefined;
  readonly onDone: (approved: boolean) => void;
  readonly onNotNow: () => void;
  readonly notNowLabel?: string | undefined;
}) {
  const [view, setView] = useState<QApprovalView | null>(initialView ?? null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (initialView !== undefined && version === 0) return;
    let live = true;
    void readQApprovalAction(approvalId)
      .catch(() => null)
      .then((result) => {
        if (!live) return;
        if (result?.ok === true) setView(result.value);
        else setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [approvalId, version, initialView]);

  const approve = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await approveQApprovalAction(approvalId).catch(() => null);
      if (result?.ok === true) {
        setMessage("Approved. Q is doing it now.");
        onDone(true);
      } else {
        setMessage(
          result?.message ?? "That didn't go through. Nothing was sent.",
        );
      }
    });

  if (failed) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
        This couldn&rsquo;t load. Nothing was sent; it still waits for your yes.
      </p>
    );
  }
  if (view === null) return <Skeleton lines={3} />;

  const plan = readPlan(view.action.preview);
  const canDecide = view.canDecide;

  return (
    <div className="flex flex-col gap-3" data-approval-plan>
      <p className="cq-body text-(--cq-text-primary)">{view.action.summary}</p>
      {plan.quote === null ? null : (
        <blockquote className="rounded-(--cq-radius-md) bg-(--cq-surface-sunken) px-3 py-2.5 cq-body-sm whitespace-pre-wrap text-(--cq-text-secondary)">
          <span className="sr-only">What Q will send: </span>
          {plan.quote}
        </blockquote>
      )}
      {plan.alone === null && plan.asks === null ? null : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 cq-body-sm">
          {plan.alone === null ? null : (
            <>
              <dt className="text-(--cq-text-tertiary)">On its own</dt>
              <dd className="text-(--cq-text-primary)">{plan.alone}</dd>
            </>
          )}
          {plan.asks === null ? null : (
            <>
              <dt className="text-(--cq-text-tertiary)">Asks first</dt>
              <dd className="text-(--cq-text-primary)">{plan.asks}</dd>
            </>
          )}
        </dl>
      )}
      {plan.rest === null ? null : (
        <div>
          <button
            type="button"
            aria-expanded={full}
            onClick={() => setFull((now) => !now)}
            className="inline-flex min-h-11 items-center gap-1 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary) lg:min-h-8"
          >
            Full plan
            <ChevronDown
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
              className={cx(
                "motion-safe:transition-transform motion-safe:duration-(--cq-motion-fast)",
                full && "rotate-180",
              )}
            />
          </button>
          {full ? (
            <p className="mt-1 cq-body-sm whitespace-pre-wrap text-(--cq-text-secondary)">
              {plan.rest}
            </p>
          ) : null}
        </div>
      )}
      {view.action.actionType === "email.send" && canDecide ? (
        // An email's words can be edited; the server asks again (BIZ-007).
        <EmailDraftEditor
          approvalId={approvalId}
          onRevised={() => setVersion((now) => now + 1)}
        />
      ) : null}
      {canDecide ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Already decided or expired.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="primary"
          disabled={pending || !canDecide}
          onClick={approve}
          className="motion-safe:transition-transform active:scale-[0.97]"
        >
          Approve
        </Button>
        {editHref === undefined ? null : (
          <Link
            href={editHref}
            className="inline-flex min-h-11 items-center rounded-md px-4 cq-body-sm font-medium text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) lg:min-h-10"
          >
            Edit
          </Link>
        )}
        <Button
          variant="quiet"
          disabled={pending}
          onClick={onNotNow}
          className="text-(--cq-text-secondary)"
        >
          {notNowLabel}
        </Button>
      </div>
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * The bound preview, laid out: a standing instruction's grant names what
 * Q does on its own ("On my own…") and what it asks first ("I ask you
 * first…"); anything else is the content itself (a message), quoted. The
 * rest of a grant stays available under "Full plan", word for word.
 */
export function readPlan(preview: string | undefined): {
  readonly quote: string | null;
  readonly alone: string | null;
  readonly asks: string | null;
  readonly rest: string | null;
} {
  if (preview === undefined || preview.trim().length === 0) {
    return { quote: null, alone: null, asks: null, rest: null };
  }
  const parts = preview.split(/\n{2,}/u);
  const find = (prefix: RegExp) => parts.find((part) => prefix.test(part));
  const alone = find(/^On my own/u);
  const asks = find(/^I ask you first/u);
  if (alone === undefined && asks === undefined) {
    return { quote: preview, alone: null, asks: null, rest: null };
  }
  const items = (part: string | undefined) =>
    part === undefined
      ? null
      : part
          .split("\n")
          .slice(1)
          .map((line) => line.replace(/^- /u, "").replace(/\s*\(.*$/u, ""))
          .filter((line) => line.length > 0)
          .join(", ") || null;
  return {
    quote: null,
    alone: items(alone),
    asks: items(asks) ?? "Anything else",
    rest: preview,
  };
}

// ---------------------------------------------------------------------------
// Q suggests
// ---------------------------------------------------------------------------

function SectionHead({
  id,
  title,
  count,
  aside,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: number | undefined;
  readonly aside?: string | undefined;
}) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <h2 id={id} className="cq-title-sm text-(--cq-text-primary)">
        {title}
        {count === undefined ? null : (
          <span className="sr-only">, {count}</span>
        )}
      </h2>
      {count === undefined ? null : (
        <span
          aria-hidden="true"
          className="cq-body cq-numeric text-(--cq-text-tertiary)"
        >
          {count}
        </span>
      )}
      {aside === undefined ? null : (
        <span className="ml-auto cq-label cq-numeric font-normal text-(--cq-text-tertiary)">
          {aside}
        </span>
      )}
    </div>
  );
}

function Suggestions({
  items,
  prepared,
  failed,
  onGone,
}: {
  readonly items: readonly QWorkSuggestionDto[];
  readonly prepared?:
    { readonly key: string; readonly view: QApprovalView } | undefined;
  readonly failed: boolean;
  readonly onGone: (key: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(prepared?.key ?? null);
  if (items.length === 0 && !failed) return null;
  return (
    <section aria-labelledby="work-suggests" data-work-suggests>
      <SectionHead id="work-suggests" title="Q suggests" />
      {failed ? (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          Suggestions couldn&rsquo;t load.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)">
          {items.map((item, index) => (
            <li
              key={item.key}
              className={cx(
                "relative",
                index > 0 &&
                  "before:absolute before:top-0 before:right-0 before:left-[4.75rem] before:border-t before:border-(--cq-border-subtle)",
              )}
            >
              <SuggestionCard
                item={item}
                open={open === item.key}
                preparedView={
                  prepared?.key === item.key ? prepared.view : undefined
                }
                onToggle={() =>
                  setOpen((now) => (now === item.key ? null : item.key))
                }
                onGone={() => {
                  setOpen(null);
                  onGone(item.key);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SuggestionCard({
  item,
  open,
  preparedView,
  onToggle,
  onGone,
}: {
  readonly item: QWorkSuggestionDto;
  readonly open: boolean;
  /** Already prepared: shown at once, and Q is not asked again. */
  readonly preparedView?: QApprovalView | undefined;
  readonly onToggle: () => void;
  readonly onGone: () => void;
}) {
  // Q prepares on the first tap only: one model call, never ahead of time.
  const [asked, setAsked] = useState<Asked | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const starting = useRef(false);
  const panel = `suggestion-${item.key.replace(/[^A-Za-z0-9_-]/gu, "-")}`;

  const toggle = () => {
    onToggle();
    if (open || asked !== null || starting.current) return;
    if (preparedView !== undefined) return;
    starting.current = true;
    void askQAction(item.prompt)
      .catch(() => null)
      .then((started) => {
        starting.current = false;
        if (started?.ok !== true) {
          setNotice(started?.message ?? "Q couldn't prepare that just now.");
          return;
        }
        setAsked({
          runId: started.value.runId,
          conversationId: started.value.conversationId ?? null,
        });
      });
  };

  const notNow = async (approvalId: string | null) => {
    // What was prepared for this card only is declined: nothing is sent.
    if (approvalId !== null) {
      await rejectQApprovalAction(approvalId).catch(() => null);
    }
    await dismissSuggestionAction(item.key).catch(() => null);
    onGone();
  };

  return (
    <div
      className={cx(
        "motion-safe:transition-colors motion-safe:duration-(--cq-motion-fast)",
        open && "bg-(--cq-surface-raised)",
      )}
      data-suggestion={item.kind}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={toggle}
        className="grid min-h-[4.5rem] w-full grid-cols-[3.25rem_minmax(0,1fr)_1.25rem] items-center gap-3 py-3.5 pr-4 pl-3 text-left motion-safe:transition-transform motion-safe:duration-(--cq-motion-fast) active:scale-[0.99]"
      >
        <span className="flex flex-col items-center" aria-hidden="true">
          <span className="text-2xl leading-none font-medium tracking-tight cq-numeric text-(--cq-text-primary)">
            {item.lead}
          </span>
          <span className="mt-1 text-[11px] leading-none text-(--cq-text-tertiary)">
            {item.unit}
          </span>
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <NamedMark named={item.named} size={20} />
            <span className="block truncate cq-body font-medium text-(--cq-text-primary)">
              {item.subject}
            </span>
          </span>
          <span className="block truncate cq-body-sm text-(--cq-text-secondary)">
            {item.question}
          </span>
          <span className="sr-only">
            {`, ${String(item.lead)} ${item.unit}`}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          size={ICON_SIZE.regular}
          strokeWidth={ICON_STROKE}
          className={cx(
            "text-(--cq-text-tertiary) motion-safe:transition-transform motion-safe:duration-(--cq-motion-base)",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div
          id={panel}
          className="pr-4 pb-4 pl-[4.75rem] motion-safe:transition-[opacity,transform] motion-safe:duration-(--cq-motion-base) motion-safe:ease-(--cq-ease) starting:opacity-0 motion-safe:starting:-translate-y-1"
        >
          {preparedView !== undefined ? (
            <ApprovalPlan
              approvalId={preparedView.approvalId}
              initialView={preparedView}
              onDone={(approved) => {
                if (approved) onGone();
              }}
              onNotNow={() => void notNow(preparedView.approvalId)}
            />
          ) : notice !== null ? (
            <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
              {notice}
            </p>
          ) : asked === null ? (
            <div role="status" className="flex flex-col gap-2">
              <span className="cq-body-sm text-(--cq-text-secondary)">
                Q is preparing it…
              </span>
              <Skeleton lines={2} />
            </div>
          ) : (
            <SuggestionPlan
              asked={asked}
              onApproved={onGone}
              onNotNow={(approvalId) => void notNow(approvalId)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function SuggestionPlan({
  asked,
  onApproved,
  onNotNow,
}: {
  readonly asked: Asked;
  readonly onApproved: () => void;
  readonly onNotNow: (approvalId: string | null) => void;
}) {
  const prepared = usePrepared(asked.runId);
  if (prepared?.state === "APPROVAL") {
    const approvalId = prepared.approvalId;
    return (
      <ApprovalPlan
        approvalId={approvalId}
        editHref={
          asked.conversationId === null
            ? "/home"
            : `/home?c=${encodeURIComponent(asked.conversationId)}`
        }
        onDone={(approved) => {
          if (approved) onApproved();
        }}
        onNotNow={() => onNotNow(approvalId)}
      />
    );
  }
  return (
    <PreparedPlan
      asked={asked}
      onClose={() => onNotNow(null)}
      closeLabel="Not now"
    />
  );
}

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

const NAMED_KIND: Readonly<Record<NamedPicture["kind"], EntityKind>> = {
  PERSON: "person",
  COMPANY: "company",
  INVESTOR_ORGANISATION: "investor",
};

/**
 * The picture of who a row names, as the server signed it for this reader
 * (the name's scope). Without a name to draw initials from, a row with no
 * picture keeps its icon: `null` here.
 */
export function namedMarkShown(
  named: NamedPicture | null | undefined,
  name: string | undefined,
): named is NamedPicture {
  if (named === null || named === undefined) return false;
  return name !== undefined || named.photoUrl !== null;
}

function NamedMark({
  named,
  name,
  size,
}: {
  readonly named: NamedPicture | null | undefined;
  /** The name the row prints; absent, only a real picture is drawn. */
  readonly name?: string | undefined;
  readonly size: number;
}) {
  if (!namedMarkShown(named, name)) return null;
  return (
    <EntityAvatar
      kind={NAMED_KIND[named.kind]}
      name={name ?? ""}
      src={named.photoUrl}
      size={size}
      decorative
    />
  );
}

type TimeLane = {
  readonly work: QWorkDto;
  readonly lane: QWorkDto["lanes"][number];
};

function NeedsYou({
  approvals,
  lanes,
  notices,
  onDecided,
}: {
  readonly approvals: readonly QPendingApproval[];
  readonly lanes: readonly TimeLane[];
  readonly notices: readonly NoticeGroup[];
  readonly onDecided: (approvalId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const left = lanes.filter((item) => !answered.has(item.lane.id));
  const count = approvals.length + left.length + notices.length;
  if (count === 0) return null;
  // Times to pick first (someone is waiting on a reply), then approvals,
  // then notices; past the preview, one "Show N more".
  const shownLanes = all ? left : left.slice(0, GROUP_PREVIEW);
  const roomA = Math.max(0, GROUP_PREVIEW - shownLanes.length);
  const shownApprovals = all ? approvals : approvals.slice(0, roomA);
  const roomN = Math.max(0, roomA - shownApprovals.length);
  const shownNotices = all ? notices : notices.slice(0, roomN);
  const hiddenCount =
    count - shownLanes.length - shownApprovals.length - shownNotices.length;
  return (
    <section aria-labelledby="work-needs-you" data-work-needs-you>
      <SectionHead id="work-needs-you" title="Needs you" count={count} />
      <ul className="border-t border-(--cq-border-subtle)">
        {shownLanes.map(({ work, lane }) => (
          <li key={lane.id} className="border-b border-(--cq-border-subtle)">
            <NeedRow
              Icon={CalendarDays}
              named={lane.counterpart}
              namedName={lane.counterpartName}
              title={`Pick a time with ${lane.counterpartName}`}
              meta={`${String(lane.offered.length)} ${lane.offered.length === 1 ? "time" : "times"} offered`}
              open={open === lane.id}
              onReview={() =>
                setOpen((now) => (now === lane.id ? null : lane.id))
              }
            />
            {open === lane.id ? (
              <TimePicker
                work={work}
                lane={lane}
                onAnswered={() => {
                  setOpen(null);
                  setAnswered((now) => new Set([...now, lane.id]));
                }}
              />
            ) : null}
          </li>
        ))}
        {shownApprovals.map((item) => (
          <li
            key={item.approvalId}
            className="border-b border-(--cq-border-subtle)"
          >
            <NeedRow
              Icon={MessageSquare}
              named={item.named}
              title={item.summary}
              meta={`Asked ${shortAge(item.requestedAt)}`}
              open={open === item.approvalId}
              onReview={() =>
                setOpen((now) =>
                  now === item.approvalId ? null : item.approvalId,
                )
              }
            />
            {open === item.approvalId ? (
              <div className="pb-4 pl-11">
                <ApprovalPlan
                  approvalId={item.approvalId}
                  onDone={() => {
                    setOpen(null);
                    onDecided(item.approvalId);
                  }}
                  onNotNow={() => setOpen(null)}
                />
                <DeclineLink
                  approvalId={item.approvalId}
                  onDeclined={() => {
                    setOpen(null);
                    onDecided(item.approvalId);
                  }}
                />
              </div>
            ) : null}
          </li>
        ))}
        {shownNotices.map((group) => (
          <li key={group.key} className="border-b border-(--cq-border-subtle)">
            <NoticeRow group={group} />
          </li>
        ))}
      </ul>
      <ShowMore hidden={hiddenCount} onShow={() => setAll(true)} />
    </section>
  );
}

/**
 * A notice that waits on them, as the bell lists it: opening it is dealing
 * with it, so it is read and leaves (the same rule as the bell's "Needs you").
 */
function NoticeRow({ group }: { readonly group: NoticeGroup }) {
  const { notice } = group;
  const done = () => {
    void markReadAction(group.ids.slice(0, 50)).then((result) => {
      if (!result.ok) return;
      noticesRead(group.ids.length);
      void refreshNotices(true);
    });
  };
  const meta =
    group.count > 1
      ? `${String(group.count)} like this · ${shortAge(notice.createdAt)}`
      : (notice.body ?? shortAge(notice.createdAt));
  return (
    <div className="flex min-h-16 items-center gap-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
        <Bell aria-hidden="true" size={16} strokeWidth={ICON_STROKE} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate cq-body-sm font-medium text-(--cq-text-primary)">
          {notice.title}
        </p>
        <p className="truncate cq-label font-normal text-(--cq-text-tertiary)">
          {meta}
        </p>
      </div>
      {notice.linkPath === null ? (
        <Button variant="secondary" size="compact" onClick={done}>
          Got it
        </Button>
      ) : (
        <Link
          href={notice.linkPath}
          onClick={done}
          className="inline-flex min-h-11 items-center rounded-md border border-(--cq-border-strong) px-3 cq-body-sm font-medium text-(--cq-text-primary) hover:bg-(--cq-surface-subtle) pointer-fine:min-h-9"
        >
          Open
        </Link>
      )}
    </div>
  );
}

function NeedRow({
  Icon,
  named,
  namedName,
  title,
  meta,
  open,
  onReview,
}: {
  readonly Icon: ComponentType<{
    readonly size?: number;
    readonly strokeWidth?: number;
    readonly "aria-hidden"?: boolean | "true";
  }>;
  /** Who the row names: their picture (or initials, given the name). */
  readonly named?: NamedPicture | null | undefined;
  readonly namedName?: string | undefined;
  readonly title: string;
  readonly meta: string;
  readonly open: boolean;
  readonly onReview: () => void;
}) {
  return (
    <div className="flex min-h-16 items-center gap-3 py-2.5">
      {namedMarkShown(named, namedName) ? (
        <NamedMark named={named} name={namedName} size={32} />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
          <Icon aria-hidden="true" size={16} strokeWidth={ICON_STROKE} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate cq-body-sm font-medium text-(--cq-text-primary)">
          {title}
        </p>
        <p className="truncate cq-label font-normal text-(--cq-text-tertiary)">
          {meta}
        </p>
      </div>
      <Button
        variant="secondary"
        size="compact"
        aria-expanded={open}
        onClick={onReview}
        className="motion-safe:transition-transform active:scale-[0.97]"
      >
        {open ? "Close" : "Review"}
      </Button>
    </div>
  );
}

function DeclineLink({
  approvalId,
  onDeclined,
}: {
  readonly approvalId: string;
  readonly onDeclined: () => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="quiet"
      size="compact"
      disabled={pending}
      className="mt-1 text-(--cq-text-secondary)"
      onClick={() =>
        startTransition(async () => {
          const result = await rejectQApprovalAction(approvalId).catch(
            () => null,
          );
          if (result?.ok === true) onDeclined();
        })
      }
    >
      Decline
    </Button>
  );
}

function TimePicker({
  work,
  lane,
  onAnswered,
}: {
  readonly work: QWorkDto;
  readonly lane: QWorkDto["lanes"][number];
  readonly onAnswered: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const answer = (
    choice:
      | { readonly kind: "BOOK_AT"; readonly at: string }
      | {
          readonly kind: "PASS";
        },
  ) =>
    startTransition(async () => {
      setMessage(null);
      const result = await answerWorkAction(work.id, lane.id, choice).catch(
        () => null,
      );
      if (result?.ok === true) onAnswered();
      else setMessage(result?.message ?? "That didn't go through.");
    });
  return (
    <div className="flex flex-col gap-2 pb-4 pl-11">
      <div className="flex flex-wrap gap-2">
        {lane.offered.map((slot) => (
          <Button
            key={slot.start}
            variant="secondary"
            size="compact"
            disabled={pending}
            onClick={() => answer({ kind: "BOOK_AT", at: slot.start })}
          >
            {slot.label}
          </Button>
        ))}
        <Button
          variant="quiet"
          size="compact"
          disabled={pending}
          className="text-(--cq-text-secondary)"
          onClick={() => answer({ kind: "PASS" })}
        >
          Pass
        </Button>
      </div>
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const KIND_WORDS: Readonly<Record<QWorkDto["kind"], string>> = {
  INVESTOR_OUTREACH: "Outreach",
  FOUNDER_STAND_IN: "Stand-in",
  STANDING_INSTRUCTION: "Standing instruction",
};

/** "1.84" -> 184; money stays exact (integer cents), never a float sum. */
function cents(amount: string): number {
  const [whole = "0", fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function dollars(totalCents: number): string {
  return `$${String(Math.floor(totalCents / 100))}.${String(totalCents % 100).padStart(2, "0")}`;
}

function Running({
  items,
  failed,
}: {
  readonly items: readonly QWorkDto[];
  readonly failed: boolean;
}) {
  const [rows, setRows] = useState(items);
  const [all, setAll] = useState(false);
  if (failed) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
        Q&rsquo;s work couldn&rsquo;t load. Try again in a moment.
      </p>
    );
  }
  if (rows.length === 0) return null;
  const month = rows.reduce(
    (sum, item) =>
      sum + (item.spend === null ? 0 : cents(item.spend.spentUsdMonth)),
    0,
  );
  const anySpend = rows.some((item) => item.spend !== null);
  return (
    <section aria-labelledby="work-running" data-work-running>
      <SectionHead
        id="work-running"
        title="Running"
        count={rows.length}
        aside={anySpend ? `${dollars(month)} this month` : undefined}
      />
      <ul className="border-t border-(--cq-border-subtle)">
        {(all ? rows : rows.slice(0, GROUP_PREVIEW)).map((item) => (
          <li key={item.id} className="border-b border-(--cq-border-subtle)">
            <RunningRow
              item={item}
              onChanged={(next) =>
                setRows((now) =>
                  next === null
                    ? now.filter((row) => row.id !== item.id)
                    : now.map((row) => (row.id === item.id ? next : row)),
                )
              }
            />
          </li>
        ))}
      </ul>
      <ShowMore
        hidden={all ? 0 : rows.length - GROUP_PREVIEW}
        onShow={() => setAll(true)}
      />
    </section>
  );
}

const STATE_WORDS = {
  WORKING: "Working",
  WAITING: "Waiting",
  PAUSED: "Paused",
} as const;

function RunningRow({
  item,
  onChanged,
}: {
  readonly item: QWorkDto;
  /** The row as it now stands; null once stopped. */
  readonly onChanged: (next: QWorkDto | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const state = item.run?.state ?? "WORKING";
  const instruction = item.kind === "STANDING_INSTRUCTION";
  const pausedByYou =
    state === "PAUSED" && item.run?.pauseReason === "PAUSED_BY_YOU";
  const goal = item.goal ?? item.summary ?? KIND_WORDS[item.kind];
  const spent = item.spend === null ? null : cents(item.spend.spentUsdMonth);
  const budget = item.spend === null ? null : cents(item.spend.budgetUsdMonth);
  const share =
    spent === null || budget === null || budget === 0
      ? 0
      : Math.min(100, Math.round((spent / budget) * 100));

  const setPaused = (paused: boolean) =>
    startTransition(async () => {
      setMessage(null);
      const result = await setPausedAction(item.id, paused).catch(() => null);
      if (result?.ok !== true) {
        setMessage(result?.message ?? "That didn't go through.");
        return;
      }
      onChanged({
        ...item,
        run: paused
          ? { state: "PAUSED", pauseReason: "PAUSED_BY_YOU" }
          : { state: "WORKING", pauseReason: null },
      });
    });

  const stop = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await stopWorkAction(item.id, null).catch(() => null);
      if (result?.ok === true) onChanged(null);
      else setMessage(result?.message ?? "Q couldn't stop that just now.");
    });

  return (
    <div className="py-2.5">
      <div className="flex min-h-12 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate cq-body-sm font-medium text-(--cq-text-primary)">
            {goal}
          </p>
          <p className="flex min-w-0 items-center gap-1.5 cq-label font-normal text-(--cq-text-tertiary)">
            <StateMark state={state} />
            <span aria-hidden="true">·</span>
            <span className="truncate">
              {item.lastStep === null
                ? state === "PAUSED" && !pausedByYou
                  ? "Waiting for your yes"
                  : "Nothing done yet"
                : `${item.lastStep.words} · ${shortAge(item.lastStep.at)}`}
            </span>
          </p>
        </div>
        {spent === null || budget === null ? null : (
          <div className="w-24 shrink-0 text-right">
            <p className="cq-label font-normal cq-numeric whitespace-nowrap text-(--cq-text-secondary)">
              <span className="font-medium text-(--cq-text-primary)">
                {dollars(spent)}
              </span>{" "}
              / {dollars(budget).replace(/\.00$/u, "")}
              <span className="sr-only"> spent this month</span>
            </p>
            <div
              aria-hidden="true"
              className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-(--cq-surface-strong)"
            >
              <div
                className={cx(
                  "h-full rounded-full",
                  share >= 100
                    ? "bg-(--cq-warning)"
                    : "bg-(--cq-text-tertiary)",
                )}
                style={{ width: `${String(share)}%` }}
              />
            </div>
          </div>
        )}
        <MenuRoot>
          <MenuTrigger>
            <IconButton
              aria-label={`Options for ${goal}`}
              size="compact"
              className="-mr-2 text-(--cq-text-tertiary)"
              disabled={pending}
            >
              <MoreHorizontal
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            {instruction && state !== "PAUSED" ? (
              <MenuItem onClick={() => setPaused(true)}>Pause</MenuItem>
            ) : null}
            {instruction && pausedByYou ? (
              <MenuItem onClick={() => setPaused(false)}>Resume</MenuItem>
            ) : null}
            <MenuItem
              onClick={() => {
                router.push(`/work/${item.id}`);
              }}
            >
              What Q did
            </MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger" onClick={() => setConfirming(true)}>
              Stop
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="cq-body-sm text-(--cq-text-secondary)">
            Stop this for good?
          </span>
          <Button
            variant="danger"
            size="compact"
            disabled={pending}
            onClick={stop}
          >
            Stop
          </Button>
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Keep it
          </Button>
        </div>
      ) : null}
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

/** Status is a shape and a word, never colour alone. */
function StateMark({
  state,
}: {
  readonly state: "WORKING" | "WAITING" | "PAUSED";
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 font-medium",
        state === "WORKING" && "text-(--cq-positive)",
        state === "WAITING" && "text-(--cq-text-secondary)",
        state === "PAUSED" && "text-(--cq-warning)",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "inline-block",
          state === "WORKING" && "size-[7px] rounded-full bg-current",
          state === "WAITING" &&
            "size-[7px] rounded-full border-[1.5px] border-current",
          state === "PAUSED" && "h-2 w-[7px] border-x-2 border-current",
        )}
      />
      {STATE_WORDS[state]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Done: collapsed by default, paged
// ---------------------------------------------------------------------------

function Done({
  initial,
  defaultOpen = false,
}: {
  readonly initial: QWorkDonePageDto | null;
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState(initial?.items ?? []);
  const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
  const [pending, startTransition] = useTransition();
  const more = useCallback(() => {
    if (cursor === null) return;
    startTransition(async () => {
      const result = await listDoneAction(cursor).catch(() => null);
      if (result?.ok !== true) return;
      setItems((now) => [...now, ...result.value.items]);
      setCursor(result.value.nextCursor);
    });
  }, [cursor]);
  if (initial === null) return null;
  return (
    <section aria-labelledby="work-done" data-work-done>
      <h2 id="work-done" className="sr-only">
        Done
      </h2>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="work-done-list"
        onClick={() => setOpen((now) => !now)}
        className="flex min-h-13 w-full items-center gap-2 border-y border-(--cq-border-subtle) text-left"
      >
        <span className="cq-title-sm text-(--cq-text-primary)">Done</span>
        <span className="cq-body cq-numeric text-(--cq-text-tertiary)">
          {initial.thisWeek} this week
        </span>
        <ChevronDown
          aria-hidden="true"
          size={ICON_SIZE.regular}
          strokeWidth={ICON_STROKE}
          className={cx(
            "ml-auto text-(--cq-text-tertiary) motion-safe:transition-transform motion-safe:duration-(--cq-motion-base)",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div id="work-done-list">
          {items.length === 0 ? (
            <p className="py-3 cq-body-sm text-(--cq-text-tertiary)">
              Nothing finished yet.
            </p>
          ) : (
            <ul>
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex min-h-12 items-center gap-3 border-b border-(--cq-border-subtle) py-2"
                >
                  {namedMarkShown(item.named, undefined) ? (
                    <NamedMark named={item.named} size={24} />
                  ) : (
                    <Check
                      aria-hidden="true"
                      size={16}
                      strokeWidth={ICON_STROKE}
                      className="shrink-0 text-(--cq-text-tertiary)"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate cq-body-sm text-(--cq-text-primary)">
                    {item.words}
                  </span>
                  <span className="shrink-0 cq-label font-normal cq-numeric text-(--cq-text-tertiary)">
                    {shortAge(item.at)}
                  </span>
                  {item.linkPath === null ? null : (
                    <Link
                      href={item.linkPath}
                      aria-label={`Open what this changed: ${item.words}`}
                      className="flex size-11 shrink-0 items-center justify-center rounded-md text-(--cq-text-tertiary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) lg:size-8"
                    >
                      <ArrowUpRight
                        aria-hidden="true"
                        size={ICON_SIZE.compact}
                        strokeWidth={ICON_STROKE}
                      />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {cursor === null ? null : (
            <Button
              variant="quiet"
              size="compact"
              disabled={pending}
              onClick={more}
              className="mt-2 text-(--cq-text-secondary)"
            >
              Show more
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** "2h", "3d", "Thu 4 Oct" -- short, in the reader's own locale. */
export function shortAge(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(at));
}
