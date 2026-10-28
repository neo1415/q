"use client";

import "./work.css";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import type {
  QApprovalView,
  QPendingApproval,
  QWorkDonePageDto,
  QWorkDto,
  QWorkSuggestionDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";
import {
  ChevronDown,
  ICON_SIZE,
  ICON_STROKE,
  Mic,
  Send,
} from "@capital-q/ui/icons";
import { Skeleton } from "@capital-q/ui/states";

import {
  approveQApprovalAction,
  askQAction,
  readQApprovalAction,
} from "@/features/q/actions";
import { ChatDraftEditor } from "@/features/integrations/chat-draft-editor";
import { EmailDraftEditor } from "@/features/integrations/email-draft-editor";
import { useQControlGroup } from "@/features/q/control/q-control";
import { useQSessionOptional } from "@/features/q/q-session";
import {
  CrmToastProvider,
  QRing,
  useCrmToast,
} from "@/features/relationships/crm-kit";

import { useDismissedHeld } from "./decision-queue";
import { decisionGroups } from "./decisions";
import { groupNotices, summarisesCards } from "./notice-groups";
import { readPlan } from "./plan-words";
import { usePrepared } from "./use-prepared";
import { WorkCostDays } from "./work-cost-days";
import { needRows, WorkInbox, type InboxRowKind } from "./work-inbox";
import { workButton, WorkSwitch, type WorkView } from "./work-kit";
import { WorkPlanView } from "./work-plan-view";
import type { WorkforceView } from "./workforce-actions";
import { useClock, useWorkforceLive } from "./workforce-section";
import { dollars as usd } from "./workforce-view";
import { useNotices } from "./notice-store";
import { useT } from "@/features/i18n/language";

/**
 * Work, Q's work page (WORK-58; chosen designs 2026-10-21).
 *
 * Three views behind one switch: Tasks, as an inbox with its preview
 * (option 2, gold), How Q is handling it, as the plan (option 2, gold),
 * and Cost, day by day (option 3, warm charcoal). One input ("Give Q a
 * task…", typed or spoken) sits above the inbox.
 *
 * Nothing here acts on its own: a task or a tapped card asks Q to prepare
 * it through the normal propose path, and the person approves the exact
 * payload on the usual approval card.
 */

type Props = {
  readonly suggestions: readonly QWorkSuggestionDto[] | null;
  readonly approvals: readonly QPendingApproval[] | null;
  /**
   * The waiting cards read in full on the server (their exact bound
   * content), by approval id, so a decision shows its message at once.
   */
  readonly views?: Readonly<Record<string, QApprovalView>> | undefined;
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
   * this month's cost. Absent: the switch is not shown; null: it failed.
   */
  readonly workforce?: WorkforceView | null | undefined;
  /** The view shown first (the design review page picks one). */
  readonly initialView?: WorkView | undefined;
  /** False: never read the team again (the design review page). */
  readonly liveReads?: boolean | undefined;
  /** The kind of row whose preview shows first (the design review page). */
  readonly initialKind?: InboxRowKind | undefined;
};

/** Each view's option: its primary buttons and dark tiles. */
const VIEW_SCOPE: Readonly<Record<WorkView, string>> = {
  work: "cq-gold",
  team: "cq-gold",
  cost: "cq-charcoal",
};

export function WorkPage(props: Props) {
  return (
    <CrmToastProvider>
      <WorkPageBody {...props} />
    </CrmToastProvider>
  );
}

function WorkPageBody({
  suggestions,
  approvals,
  views,
  work,
  done,
  prepared,
  workforce,
  initialView,
  liveReads = true,
  initialKind,
}: Props) {
  const t = useT();

  const running = (work ?? []).filter((item) => item.status === "ACTIVE");
  const timeLanes = running.flatMap((item) =>
    item.lanes
      .filter((lane) => lane.stage === "NEEDS_TIMES" && lane.offered.length > 0)
      .map((lane) => ({ work: item, lane })),
  );
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const dismissedHeld = useDismissedHeld();
  // The Work count in the navigation is these notices (founder 2026-10-05:
  // "it says 2 things, but the page says nothing"): they are listed here.
  // D-13: a notice that only summarises the cards below is not a second
  // thing waiting on them.
  const notices = groupNotices(useNotices().items ?? []).needsYou.filter(
    // (When the cards could not be read, the summary is all they have.)
    (group) => approvals === null || !summarisesCards(group.notice),
  );
  const [view, setView] = useState<WorkView>(initialView ?? "work");
  // Recovery D6 / C: the page's own controls, by literal ids, for Q.
  const viewsRef = useRef<HTMLDivElement>(null);
  useQControlGroup({
    kind: "TAB",
    ref: viewsRef,
    ids: {
      "tab.work-team": '[data-work-view="team"]',
      "tab.work-cost": '[data-work-view="cost"]',
      "tab.work-main": '[data-work-view="work"]',
    },
  });
  const live = useWorkforceLive(
    workforce,
    view === "team" || view === "work",
    liveReads,
  );
  const now = useClock();
  const team = live.data;
  const hasTeam = workforce !== undefined;
  const jobs = useMemo(() => team?.jobs ?? [], [team]);
  const viewMap = useMemo(() => new Map(Object.entries(views ?? {})), [views]);
  const groups = useMemo(
    () =>
      decisionGroups({
        approvals: (approvals ?? []).filter(
          (approval) => !gone.has(approval.approvalId),
        ),
        views: viewMap,
        jobs,
        now,
        dismissedHeld: new Set([...dismissedHeld, ...gone]),
        known: done?.items,
      }),
    [approvals, gone, viewMap, jobs, now, dismissedHeld, done],
  );
  const needs = useMemo(
    () =>
      needRows({
        groups,
        lanes: timeLanes.filter((one) => !gone.has(one.lane.id)),
        notices: notices.filter((one) => !gone.has(one.key)),
      }),
    [groups, timeLanes, notices, gone],
  );
  const decided = (key: string) => setGone((was) => new Set([...was, key]));

  return (
    <div
      className={cx(
        "cq-wk mx-auto flex w-full max-w-(--cq-layout-wide) flex-col gap-[18px]",
        VIEW_SCOPE[view],
      )}
      data-work-page
      data-work-option={view}
    >
      {hasTeam ? (
        <div
          ref={viewsRef}
          className="-mt-1.5 flex flex-wrap items-center gap-3"
          data-work-views
        >
          <WorkSwitch
            value={view}
            onChange={setView}
            costLabel={
              team === null || team === undefined
                ? undefined
                : t(`Cost, ${usd(team.overview.spentUsd)}`)
            }
          />
        </div>
      ) : null}
      {view === "work" ? (
        <WorkInbox
          composer={<TaskComposer />}
          needs={needs}
          approvalsFailed={approvals === null}
          suggestions={suggestions ?? []}
          suggestionsFailed={suggestions === null}
          prepared={prepared}
          running={running}
          workFailed={work === null}
          jobs={jobs}
          done={done}
          now={now}
          onDecided={decided}
          initialKind={initialKind}
        />
      ) : null}
      {hasTeam && view === "team" ? (
        team === null ? (
          <TeamUnavailable onRetry={live.refresh} />
        ) : (
          <WorkPlanView view={team} onChanged={live.refresh} />
        )
      ) : null}
      {hasTeam && view === "cost" ? (
        team === null ? (
          <TeamUnavailable onRetry={live.refresh} />
        ) : (
          <WorkCostDays
            overview={team.overview}
            jobs={team.jobs}
            work={work}
            now={now}
          />
        )
      ) : null}
    </div>
  );
}

function TeamUnavailable({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="cq-body-sm m-0 text-(--cq-text-secondary)">
        {t("Q’s team couldn’t load. It keeps working; this view catches up.")}
      </p>
      <button
        type="button"
        className={workButton("secondary")}
        onClick={onRetry}
      >
        {t("Try again")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The one input
// ---------------------------------------------------------------------------

function TaskComposer() {
  const t = useT();

  const session = useQSessionOptional();
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<Asked | null>(null);
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const toast = useCrmToast();

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
      toast(t("Q is planning it. It will ask before anything is sent."));
      setAsked({
        runId: started.value.runId,
        conversationId: started.value.conversationId ?? null,
      });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="cq-wk-composer" data-work-composer>
        <QRing className="size-6 text-[13px] text-(--cq-accent)" />
        <label htmlFor="work-task" className="sr-only">
          {t("Give Q a task")}
        </label>
        <input
          id="work-task"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("Give Q a task…")}
          autoComplete="off"
          maxLength={2000}
        />
        <button
          type="button"
          aria-label={t("Talk to Q")}
          disabled={session === null}
          onClick={() => void session?.talk()}
          className={workButton("quiet", "w-11 px-0")}
          data-work-mic
        >
          <Mic aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </button>
        <button
          type="submit"
          aria-label={t("Give Q this task")}
          disabled={busy || text.trim().length === 0}
          className={workButton("primary", "w-11 px-0")}
          data-work-send
        >
          <Send aria-hidden="true" size={16} strokeWidth={ICON_STROKE} />
        </button>
      </form>
      {notice === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(notice)}
        </p>
      )}
      {asked === null ? null : (
        <div className="rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4">
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
  const t = useT();

  const prepared = usePrepared(asked.runId);
  const qPage =
    asked.conversationId === null
      ? "/home"
      : `/home?c=${encodeURIComponent(asked.conversationId)}`;

  if (prepared === null || prepared.state === "WORKING") {
    return (
      <div className="flex flex-col gap-2" role="status">
        <span className="cq-body-sm text-(--cq-text-secondary)">
          {t("Q is preparing it…")}
        </span>
        <Skeleton lines={2} />
      </div>
    );
  }
  if (prepared.state === "FAILED") {
    return (
      <div className="flex flex-wrap items-center gap-3" role="status">
        <span className="cq-body-sm text-(--cq-text-secondary)">
          {t("Q couldn’t prepare that. Nothing was done.")}
        </span>
        <Link
          href={qPage}
          className="cq-body-sm font-medium text-(--cq-accent) underline-offset-4 hover:underline"
        >
          {t("Ask Q")}
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
            {t("Continue with Q")}
          </Link>
          <Button variant="quiet" size="compact" onClick={onClose}>
            {t(closeLabel)}
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
  hideNotNow = false,
}: {
  readonly approvalId: string;
  /** Already read on the server: shown at once, read again on a revision. */
  readonly initialView?: QApprovalView | undefined;
  readonly editHref?: string | undefined;
  readonly onDone: (approved: boolean) => void;
  readonly onNotNow: () => void;
  readonly notNowLabel?: string | undefined;
  /** In the decision queue, Dismiss sits beside it instead. */
  readonly hideNotNow?: boolean | undefined;
}) {
  const t = useT();

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
        {t(
          "This couldn’t load. Nothing was sent; it still waits for your yes.",
        )}
      </p>
    );
  }
  if (view === null) return <Skeleton lines={3} />;

  const plan = readPlan(view.action.preview);
  const canDecide = view.canDecide;

  return (
    <div className="flex flex-col gap-3" data-approval-plan>
      <p className="cq-body text-(--cq-text-primary)">
        {t(view.action.summary)}
      </p>
      {plan.quote === null ? null : (
        <blockquote className="bg-(--cq-surface-sunken) px-3 py-2.5 cq-body-sm whitespace-pre-wrap text-(--cq-text-secondary)">
          <span className="sr-only">{t("What Q will send:")} </span>
          {plan.quote}
        </blockquote>
      )}
      {plan.alone === null && plan.asks === null ? null : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 cq-body-sm">
          {plan.alone === null ? null : (
            <>
              <dt className="text-(--cq-text-tertiary)">{t("On its own")}</dt>
              <dd className="text-(--cq-text-primary)">{t(plan.alone)}</dd>
            </>
          )}
          {plan.asks === null ? null : (
            <>
              <dt className="text-(--cq-text-tertiary)">{t("Asks first")}</dt>
              <dd className="text-(--cq-text-primary)">{t(plan.asks)}</dd>
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
            {t("Full plan")}
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
              {t(plan.rest)}
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
      {view.action.actionType === "chat.message.send" && canDecide ? (
        // A chat reply's words too (live 2026-10-28), the same way.
        <ChatDraftEditor
          approvalId={approvalId}
          onRevised={() => setVersion((now) => now + 1)}
        />
      ) : null}
      {canDecide ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t("Already decided or expired.")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="primary"
          disabled={pending || !canDecide}
          onClick={approve}
          className="motion-safe:transition-transform active:scale-[0.97]"
        >
          {t("Approve")}
        </Button>
        {editHref === undefined ? null : (
          <Link
            href={editHref}
            className="inline-flex min-h-11 items-center rounded-md px-4 cq-body-sm font-medium text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) lg:min-h-10"
          >
            {t("Edit")}
          </Link>
        )}
        {hideNotNow ? null : (
          <Button
            variant="quiet"
            disabled={pending}
            onClick={onNotNow}
            className="text-(--cq-text-secondary)"
          >
            {t(notNowLabel)}
          </Button>
        )}
      </div>
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {t(message)}
        </p>
      )}
    </div>
  );
}

export { readPlan } from "./plan-words";

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
